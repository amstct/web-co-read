const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      reject(new Error("请在 Chrome 扩展中打开此页面"));
      return;
    }
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "操作失败"));
        return;
      }
      resolve(response);
    });
  });
}

function setStatus(text, kind = "") {
  const el = $("global-status");
  el.textContent = text || "";
  el.className = `status ${kind}`.trim();
}

function setBusy(busy) {
  ["summarize-tab", "summarize-selection", "save-selection", "summarize-url"].forEach((id) => {
    $(id).disabled = busy;
  });
}

function formatTime(ts) {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function renderChips(settings) {
  const feishuReady = Boolean(settings.feishuAppId && settings.feishuAppSecret && settings.feishuDocUrl);
  const llmReady = Boolean(settings.llmModel && settings.llmBaseUrl && settings.llmApiKey);
  const feishu = $("chip-feishu");
  const llm = $("chip-llm");
  feishu.className = `chip ${feishuReady ? "ok" : "warn"}`;
  llm.className = `chip ${llmReady ? "ok" : "warn"}`;
  feishu.innerHTML = `<span class="dot"></span>${feishuReady ? "飞书已配置" : "飞书未配置"}`;
  llm.innerHTML = `<span class="dot"></span>${llmReady ? "模型已配置" : "模型未配置"}`;
}

function renderShortcuts(settings) {
  const save = settings.saveSelectionShortcut || "Cmd+Shift+O";
  const summary = settings.summarizePageShortcut || "Cmd+Shift+P";
  const selectionSummary = settings.summarizeSelectionShortcut || "Cmd+Shift+K";
  $("shortcut-hint").textContent = `划线后按 ${save} 保存原文，按 ${selectionSummary} 总结划线；在页面按 ${summary} 总结整页。`;
}

const COMMAND_LABELS = {
  "save-selection": "保存划线",
  "summarize-page": "总结整页",
  "summarize-selection": "总结划线"
};

function renderShortcutWarning(commands = []) {
  const unbound = commands.filter((c) => !c.shortcut && COMMAND_LABELS[c.name]);
  const hint = $("shortcut-hint");
  if (!unbound.length) {
    hint.classList.remove("warn");
    return;
  }
  const names = unbound.map((c) => `${COMMAND_LABELS[c.name]}（${c.shortcut || "未绑定"}）`).join("、");
  hint.classList.add("warn");
  hint.textContent += ` ⚠︎ ${names} 的 Chrome 级快捷键未绑定，请在 chrome://extensions/shortcuts 中手动设置。`;
}

async function loadCommands() {
  try {
    const { commands } = await send("XQ_GET_COMMANDS");
    renderShortcutWarning(commands);
  } catch {
    // ignore
  }
}

function activityKindLabel(type) {
  if (type === "quote") return "划线";
  if (type === "selection-summary") return "划线摘要";
  return "摘要";
}

function renderActivity(activity = []) {
  const list = $("activity-list");
  if (!activity.length) {
    list.innerHTML = `<li class="empty">还没有写入记录。划线或总结后会出现在这里。</li>`;
    return;
  }
  list.innerHTML = activity
    .slice(0, 6)
    .map((item) => {
      const kind = activityKindLabel(item.type);
      const state = item.status === "error" ? "失败" : "成功";
      return `<li>
        <div class="meta"><span>${kind} · ${state}</span><span>${formatTime(item.at)}</span></div>
        <div class="title">${escapeHtml(item.title || "未命名页面")}</div>
        <p class="preview">${escapeHtml(item.preview || "")}</p>
      </li>`;
    })
    .join("");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadPageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  $("page-title").textContent = tab.title || "未命名页面";
  $("page-url").textContent = tab.url || "";
}

async function refresh() {
  const [{ settings }, { activity }] = await Promise.all([
    send("XQ_GET_SETTINGS"),
    send("XQ_GET_ACTIVITY")
  ]);
  renderChips(settings);
  renderShortcuts(settings);
  renderActivity(activity);
}

async function run(label, task) {
  setBusy(true);
  setStatus(`${label}中，请稍候…`, "busy");
  try {
    const result = await task();
    if (result?.activity) renderActivity(result.activity);
    setStatus("写入成功", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

$("open-settings").addEventListener("click", () => send("XQ_OPEN_OPTIONS"));
$("summarize-tab").addEventListener("click", () => run("总结当前页", () => send("XQ_SUMMARIZE_TAB")));
$("summarize-selection").addEventListener("click", () => run("总结划线", () => send("XQ_SUMMARIZE_SELECTION")));
$("save-selection").addEventListener("click", () => run("保存划线", () => send("XQ_SAVE_SELECTION")));
$("url-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const url = $("url-input").value.trim();
  run("总结链接", () => send("XQ_SUMMARIZE_URL", { url }));
});

if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
  $("page-title").textContent = "示例：一篇待共读的文章";
  $("page-url").textContent = "https://example.com/article";
  renderChips({ feishuAppId: "cli", feishuAppSecret: "x", feishuDocUrl: "https://", llmApiKey: "k", llmModel: "gemma-4-26b-qat-4bit" });
  renderShortcuts({
    saveSelectionShortcut: "Cmd+Shift+O",
    summarizePageShortcut: "Cmd+Shift+P",
    summarizeSelectionShortcut: "Cmd+Shift+K"
  });
  renderActivity([]);
} else {
  loadPageInfo().catch(() => {});
  // 先渲染基础提示，再叠加未绑定命令的警告，避免覆盖
  refresh()
    .then(loadCommands)
    .catch((error) => setStatus(error.message, "error"));
}
