const form = document.getElementById("settings-form");
const saveStatus = document.getElementById("save-status");
const feishuStatus = document.getElementById("feishu-status");
const llmStatus = document.getElementById("llm-status");
const DEFAULT_PROMPT = DEFAULT_SUMMARY_PROMPT;

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

function readForm() {
  const data = new FormData(form);
  const settings = {};
  for (const [key, value] of data.entries()) settings[key] = String(value).trim();
  settings.summaryPrompt = form.summaryPrompt.value;
  return settings;
}

function fillForm(settings) {
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements[key];
    if (!field) continue;
    field.value = value ?? "";
  }
}

function setText(el, text, kind = "") {
  el.textContent = text || "";
  el.className = `status ${kind}`.trim();
}

function collectSettingsForTest() {
  return { ...DEFAULT_SETTINGS, ...readForm() };
}

form.querySelectorAll(".toggle-secret").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.parentElement.querySelector("input");
    input.type = input.type === "password" ? "text" : "password";
  });
});

form.querySelectorAll(".shortcut").forEach((input) => {
  input.addEventListener("focus", () => {
    input.classList.add("listening");
    input.placeholder = "按下新的快捷键…";
  });
  input.addEventListener("blur", () => {
    input.classList.remove("listening");
    input.placeholder = "点击后按下新组合键";
  });
  input.addEventListener("keydown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      input.blur();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      input.value = "";
      return;
    }
    if (isModifierOnly(event)) return;
    const combo = eventToShortcut(event);
    if (!combo.includes("+")) return;
    input.value = combo;
    input.blur();
    setText(saveStatus, "快捷键已更新，记得保存。");
  });
});

function startShortcutCapture(name) {
  const input = form.elements[name];
  if (!input) return;
  input.value = "";
  input.focus();
}

form.querySelectorAll(".recapture-shortcut").forEach((button) => {
  button.addEventListener("click", () => {
    startShortcutCapture(button.dataset.target);
    setText(saveStatus, "请按下新的快捷键组合。");
  });
});

form.querySelectorAll(".reset-shortcut").forEach((button) => {
  button.addEventListener("click", () => {
    const input = form.elements[button.dataset.target];
    if (!input) return;
    input.value = button.dataset.default || "";
    input.blur();
    setText(saveStatus, "已复位为默认快捷键，记得保存。");
  });
});

document.getElementById("reset-shortcuts").addEventListener("click", () => {
  form.saveSelectionShortcut.value = DEFAULT_SETTINGS.saveSelectionShortcut;
  form.summarizePageShortcut.value = DEFAULT_SETTINGS.summarizePageShortcut;
  setText(saveStatus, "两个快捷键都已复位为 ⌘⇧O / ⌘⇧P，记得保存。");
});

document.getElementById("reset-prompt").addEventListener("click", () => {
  form.summaryPrompt.value = DEFAULT_PROMPT;
  setText(saveStatus, "已恢复默认提示词，记得保存。");
});

document.getElementById("open-chrome-shortcuts").addEventListener("click", () => {
  send("XQ_OPEN_SHORTCUTS").catch((error) => setText(saveStatus, error.message, "error"));
});

document.getElementById("test-feishu").addEventListener("click", async () => {
  setText(feishuStatus, "正在连接飞书…");
  try {
    const result = await send("XQ_TEST_FEISHU", { settings: collectSettingsForTest() });
    setText(feishuStatus, `已连接：${result.title || result.documentId}`, "ok");
  } catch (error) {
    setText(feishuStatus, error.message, "error");
  }
});

document.getElementById("probe-feishu").addEventListener("click", async () => {
  setText(feishuStatus, "正在试写一条到文档末尾…");
  try {
    const result = await send("XQ_PROBE_WRITE", { settings: collectSettingsForTest() });
    setText(feishuStatus, `试写成功（${result.method || "write"}）：${result.documentId}`, "ok");
    await loadDebugLogs();
  } catch (error) {
    setText(feishuStatus, error.message, "error");
    await loadDebugLogs();
  }
});

document.getElementById("test-llm").addEventListener("click", async () => {
  setText(llmStatus, "正在请求模型…");
  try {
    const result = await send("XQ_TEST_LLM", { settings: collectSettingsForTest() });
    setText(llmStatus, `模型可用：${result.reply}`, "ok");
  } catch (error) {
    setText(llmStatus, error.message, "error");
  }
});

const OLLAMA_URL = "http://127.0.0.1:11434/v1";
const providerSelect = document.getElementById("llm-provider");
const ollamaHelp = document.getElementById("ollama-help");
const listOllamaBtn = document.getElementById("list-ollama-models");

function isOllamaUrl(url) {
  return /:11434\b|ollama/i.test(url || "");
}

function syncOllamaUi() {
  const ollama = providerSelect.value === "ollama" || isOllamaUrl(form.llmBaseUrl.value);
  providerSelect.value = ollama ? "ollama" : "openai";
  ollamaHelp.hidden = !ollama;
  listOllamaBtn.hidden = !ollama;
}

providerSelect.addEventListener("change", () => {
  if (providerSelect.value === "ollama") {
    if (!isOllamaUrl(form.llmBaseUrl.value)) form.llmBaseUrl.value = OLLAMA_URL;
    if (form.llmModel.value === "gpt-4o-mini") form.llmModel.value = "";
  }
  syncOllamaUi();
});

form.llmBaseUrl.addEventListener("input", syncOllamaUi);

listOllamaBtn.addEventListener("click", async () => {
  setText(llmStatus, "正在读取 Ollama 模型列表…");
  try {
    const result = await send("XQ_LIST_OLLAMA_MODELS", { settings: collectSettingsForTest() });
    const list = document.getElementById("ollama-model-list");
    list.innerHTML = result.models.map((name) => `<option value="${name}"></option>`).join("");
    if (!form.llmModel.value && result.models[0]) form.llmModel.value = result.models[0];
    setText(llmStatus, `已发现：${result.models.join("、")}`, "ok");
  } catch (error) {
    setText(llmStatus, error.message, "error");
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const btn = document.getElementById("save-btn");
  btn.disabled = true;
  setText(saveStatus, "正在保存…");
  try {
    await send("XQ_SAVE_SETTINGS", { settings: readForm() });
    setText(saveStatus, "设置已保存", "ok");
  } catch (error) {
    setText(saveStatus, error.message, "error");
  } finally {
    btn.disabled = false;
  }
});

function formatLogs(logs) {
  if (!logs?.length) return "";
  return logs
    .slice()
    .reverse()
    .map((item) => `${item.t} [${item.level}] ${item.event} ${JSON.stringify(item.data)}`)
    .join("\n");
}

async function loadDebugLogs() {
  const view = document.getElementById("debug-log-view");
  try {
    const { logs } = await send("XQ_GET_DEBUG_LOGS");
    view.value = formatLogs(logs) || "还没有日志。请刷新扩展后，再点一次功能或「试写一条」。";
  } catch (error) {
    view.value = error.message;
  }
}

document.getElementById("refresh-logs").addEventListener("click", () => {
  loadDebugLogs().catch(() => {});
});

document.getElementById("clear-logs").addEventListener("click", async () => {
  try {
    await send("XQ_CLEAR_DEBUG_LOGS");
    await loadDebugLogs();
  } catch (error) {
    document.getElementById("debug-log-view").value = error.message;
  }
});

if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
  fillForm(DEFAULT_SETTINGS);
  syncOllamaUi();
} else {
  send("XQ_GET_SETTINGS")
    .then(({ settings }) => {
      fillForm(settings);
      syncOllamaUi();
      loadDebugLogs();
    })
    .catch((error) => setText(saveStatus, error.message, "error"));
}
