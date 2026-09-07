importScripts(
  "lib/logger.js",
  "lib/defaults.js",
  "lib/storage.js",
  "lib/shortcuts.js",
  "lib/extract.js",
  "lib/format.js",
  "lib/feishu.js",
  "lib/llm.js"
);

const OFFSCREEN_PATH = "src/offscreen.html";
const inFlight = new Map();

function isRestrictedUrl(url = "") {
  return /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url);
}

async function notify(title, message) {
  try {
    await chrome.notifications.create("xqcoread-status", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message: String(message || "").slice(0, 180),
      priority: 2
    });
  } catch {
    // ignore notification permission gaps
  }
}

async function toastOnTab(tabId, payload) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "XQ_TOAST", payload });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/lib/extract.js", "src/lib/shortcuts.js", "src/content.js"]
      });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] });
      await chrome.tabs.sendMessage(tabId, { type: "XQ_TOAST", payload });
    } catch {
      // restricted pages cannot receive toasts
    }
  }
}

async function announce(tab, payload) {
  const targetId = tab?.id || (await getActiveTab())?.id;
  await toastOnTab(targetId, payload);
  if (payload.kind === "success") {
    await notify("写入成功", payload.text);
  } else if (payload.kind === "error") {
    await notify("操作失败", payload.text);
  }
}

async function withLock(key, task) {
  if (inFlight.has(key)) {
    throw new Error("正在处理上一次操作，请稍后再试");
  }
  const run = Promise.resolve().then(task);
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "XQ_PING" });
    return true;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/lib/extract.js", "src/lib/shortcuts.js", "src/content.js"]
    });
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content.css"] });
    return true;
  }
}

async function collectFromTab(tabId, type) {
  await ensureContent(tabId);
  return chrome.tabs.sendMessage(tabId, { type });
}

async function collectSelection(tab) {
  if (!tab?.id) throw new Error("没有可用的标签页");
  if (isRestrictedUrl(tab.url)) throw new Error("当前页面受浏览器保护，无法读取划线内容");
  const result = await collectFromTab(tab.id, "XQ_GET_SELECTION");
  if (!result?.text) throw new Error("请先在页面中划选一段文字");
  return {
    text: result.text,
    title: result.title || tab.title || "",
    url: result.url || tab.url || ""
  };
}

async function collectPageFromTab(tab) {
  if (!tab?.id) throw new Error("没有可用的标签页");
  if (isRestrictedUrl(tab.url)) throw new Error("当前页面受浏览器保护，无法读取正文。请改用弹窗粘贴 URL。");
  try {
    const result = await collectFromTab(tab.id, "XQ_EXTRACT_PAGE");
    if (result?.text) return result;
  } catch {
    // fall through to injected extract
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/lib/extract.js"] });
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => extractPageContent()
  });
  if (!injected?.result?.text) throw new Error("未能提取到页面正文");
  return injected.result;
}

async function hasOffscreen() {
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["DOM_PARSER"],
    justification: "解析目标网页 HTML，提取可读正文后进行总结"
  });
}

async function extractViaOffscreen(url) {
  await ensureOffscreen();
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const page = await chrome.runtime.sendMessage({ type: "XQ_FETCH_AND_PARSE", url });
      if (page?.error) throw new Error(page.error);
      if (page) return page;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 160));
    }
  }
  throw lastError || new Error("解析页面失败");
}

async function extractViaTempTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id);
    return collectPageFromTab({ ...tab, url });
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      // tab may already be closed
    }
  }
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("页面加载超时"));
    }, timeoutMs);

    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.get(tabId, (existing) => {
      if (existing?.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    });
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function collectPageFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("请输入完整的 http/https 链接");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("仅支持 http/https 链接");

  try {
    const page = await extractViaOffscreen(parsed.href);
    if (page?.text && page.text.length >= 40) return page;
  } catch {
    // many sites block raw fetch; open a background tab instead
  }
  return extractViaTempTab(parsed.href);
}

async function saveSelectionFromTab(tab) {
  await announce(tab, { kind: "progress", text: "正在保存划线原文…", sticky: true });
  try {
    return await withLock("write", async () => {
      await xqLog("info", "action.saveSelection.start", {
        tabId: tab?.id,
        url: tab?.url,
        title: tab?.title
      });
      const settings = await getSettings();
      const selection = await collectSelection(tab);
      await xqLog("info", "action.saveSelection.gotText", {
        chars: selection.text.length,
        preview: selection.text.slice(0, 80)
      });
      const markdown = buildQuoteMarkdown(selection);
      const written = await appendMarkdownToFeishu(settings, markdown, { preferConvert: false });
      const activity = await pushActivity({
        type: "quote",
        title: selection.title,
        url: selection.url,
        preview: selection.text.slice(0, 80),
        status: "ok"
      });
      await announce(tab, { kind: "success", text: "划线原文已写入飞书文档" });
      await xqLog("info", "action.saveSelection.ok", written);
      return { ok: true, activity };
    });
  } catch (error) {
    await xqLog("error", "action.saveSelection.fail", {
      message: error.message,
      code: error.code,
      url: tab?.url
    });
    await announce(tab, { kind: "error", text: error.message });
    throw error;
  }
}

async function requireLlmReady(settings) {
  if (requiresApiKey(settings) && !settings.llmApiKey) {
    throw new Error("请先在设置中配置模型 API Key");
  }
  if (!settings.llmModel?.trim()) throw new Error("请先在设置中填写模型名");
}

async function summarizeSelectionFromTab(tab) {
  await announce(tab, { kind: "progress", text: "正在总结当前划线，请稍候…", sticky: true });
  try {
    return await withLock("write", async () => {
      await xqLog("info", "action.summarizeSelection.start", {
        tabId: tab?.id,
        url: tab?.url,
        title: tab?.title
      });
      const settings = await getSettings();
      await requireLlmReady(settings);
      const selection = await collectSelection(tab);
      await xqLog("info", "action.summarizeSelection.gotText", {
        chars: selection.text.length,
        preview: selection.text.slice(0, 80)
      });
      const summary = await summarizeSelectionContent(settings, selection);
      await xqLog("info", "action.summarizeSelection.llm.ok", { summaryChars: summary.length });
      const markdown = buildSummaryMarkdown({ summary });
      const written = await appendMarkdownToFeishu(settings, markdown, { preferConvert: true });
      const activity = await pushActivity({
        type: "selection-summary",
        title: selection.title,
        url: selection.url,
        preview: summary.slice(0, 80),
        status: "ok"
      });
      await announce(tab, { kind: "success", text: "划线摘要已写入飞书文档" });
      await xqLog("info", "action.summarizeSelection.ok", written);
      return { ok: true, activity };
    });
  } catch (error) {
    await xqLog("error", "action.summarizeSelection.fail", {
      message: error.message,
      code: error.code,
      url: tab?.url
    });
    await announce(tab, { kind: "error", text: error.message });
    throw error;
  }
}

async function summarizeAndSave({ tab, url }) {
  const toastTab = tab || (await getActiveTab());
  await announce(toastTab, { kind: "progress", text: "正在总结页面，请稍候…", sticky: true });
  try {
    return await withLock("write", async () => {
      await xqLog("info", "action.summarize.start", {
        tabId: tab?.id,
        url: url || tab?.url,
        title: tab?.title
      });
      const settings = await getSettings();
      await requireLlmReady(settings);
      const page = url ? await collectPageFromUrl(url) : await collectPageFromTab(tab);
      await xqLog("info", "action.summarize.extracted", {
        title: page.title,
        url: page.url,
        chars: page.text?.length || 0
      });
      const summary = await summarizePageContent(settings, page);
      await xqLog("info", "action.summarize.llm.ok", { summaryChars: summary.length });
      const markdown = buildSummaryMarkdown({ summary });
      const written = await appendMarkdownToFeishu(settings, markdown, { preferConvert: true });
      const activity = await pushActivity({
        type: "summary",
        title: page.title,
        url: page.url || url || "",
        preview: summary.slice(0, 80),
        status: "ok"
      });
      await announce(toastTab, { kind: "success", text: "页面摘要已写入飞书文档" });
      await xqLog("info", "action.summarize.ok", written);
      return { ok: true, activity };
    });
  } catch (error) {
    await xqLog("error", "action.summarize.fail", {
      message: error.message,
      code: error.code,
      url: url || tab?.url
    });
    await announce(toastTab, { kind: "error", text: error.message });
    throw error;
  }
}

let lastCommandAt = 0;
let lastCommandName = "";

function activityTypeForCommand(command) {
  if (command === "save-selection") return "quote";
  if (command === "summarize-selection") return "selection-summary";
  return "summary";
}

async function handleCommand(command, tab) {
  const now = Date.now();
  if (command === lastCommandName && now - lastCommandAt < 900) return;
  lastCommandAt = now;
  lastCommandName = command;
  const active = tab || (await getActiveTab());
  try {
    if (command === "save-selection") {
      await saveSelectionFromTab(active);
      return;
    }
    if (command === "summarize-selection") {
      await summarizeSelectionFromTab(active);
      return;
    }
    if (command === "summarize-page") {
      await summarizeAndSave({ tab: active });
    }
  } catch (error) {
    await pushActivity({
      type: activityTypeForCommand(command),
      title: active?.title || "",
      url: active?.url || "",
      preview: error.message,
      status: "error"
    });
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  handleCommand(command, tab);
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = (promise) => {
    promise.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  };

  switch (message?.type) {
    case "XQ_GET_SETTINGS":
      return respond(getSettings().then((settings) => ({ ok: true, settings })));
    case "XQ_SAVE_SETTINGS":
      return respond(saveSettings(message.settings).then((settings) => ({ ok: true, settings })));
    case "XQ_GET_ACTIVITY":
      return respond(getActivity().then((activity) => ({ ok: true, activity })));
    case "XQ_TEST_FEISHU":
      return respond(
        testFeishuConnection({ ...DEFAULT_SETTINGS, ...(message.settings || {}) }).then((data) => ({
          ok: true,
          ...data
        }))
      );
    case "XQ_TEST_LLM":
      return respond(
        testLlmConnection({ ...DEFAULT_SETTINGS, ...(message.settings || {}) }).then((reply) => ({
          ok: true,
          reply
        }))
      );
    case "XQ_LIST_OLLAMA_MODELS":
      return respond(
        listOllamaModels({ ...DEFAULT_SETTINGS, ...(message.settings || {}) }).then((models) => ({
          ok: true,
          models
        }))
      );
    case "XQ_SAVE_SELECTION":
      return respond((async () => {
        const tab = await getActiveTab();
        await xqLog("info", "msg.SAVE_SELECTION", { url: tab?.url, title: tab?.title, id: tab?.id });
        return saveSelectionFromTab(tab);
      })());
    case "XQ_SUMMARIZE_SELECTION":
      return respond((async () => {
        const tab = await getActiveTab();
        await xqLog("info", "msg.SUMMARIZE_SELECTION", { url: tab?.url, title: tab?.title, id: tab?.id });
        return summarizeSelectionFromTab(tab);
      })());
    case "XQ_SUMMARIZE_TAB":
      return respond((async () => {
        const tab = await getActiveTab();
        await xqLog("info", "msg.SUMMARIZE_TAB", { url: tab?.url, title: tab?.title, id: tab?.id });
        return summarizeAndSave({ tab });
      })());
    case "XQ_SUMMARIZE_URL":
      return respond((async () => {
        await xqLog("info", "msg.SUMMARIZE_URL", { url: message.url });
        return summarizeAndSave({ url: message.url, tab: sender.tab });
      })());
    case "XQ_PROBE_WRITE":
      return respond(
        probeFeishuWrite({ ...DEFAULT_SETTINGS, ...(message.settings || {}) }).then((data) => ({
          ok: true,
          ...data
        }))
      );
    case "XQ_GET_DEBUG_LOGS":
      return respond(getDebugLogs().then((logs) => ({ ok: true, logs })));
    case "XQ_CLEAR_DEBUG_LOGS":
      return respond(clearDebugLogs().then(() => ({ ok: true })));
    case "XQ_CONTENT_SHORTCUT":
      return respond(handleCommand(message.command, sender.tab).then(() => ({ ok: true })));
    case "XQ_OPEN_OPTIONS":
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;
    case "XQ_OPEN_SHORTCUTS":
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});

xqLog("info", "sw.ready", { version: chrome.runtime.getManifest().version });
