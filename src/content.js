function showXqToast({ kind = "info", text = "", sticky = false }) {
  const hostId = "xqcoread-toast-host";
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap {
          position: fixed;
          right: 20px;
          top: 20px;
          z-index: 2147483647;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
          font-family: "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
        }
        .toast {
          min-width: 240px;
          max-width: 340px;
          padding: 12px 14px;
          border-radius: 14px;
          color: #0F3A47;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(8, 145, 178, 0.24);
          box-shadow: 0 16px 40px rgba(15, 58, 71, 0.16);
          backdrop-filter: blur(16px);
          font-size: 13px;
          line-height: 1.5;
          display: grid;
          grid-template-columns: 22px 1fr;
          gap: 10px;
          align-items: start;
          transform: translateY(-8px);
          opacity: 0;
          animation: in 180ms ease forwards;
        }
        .toast strong {
          display: block;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: none;
          margin-bottom: 2px;
          color: #0E7490;
        }
        .mark {
          width: 22px;
          height: 22px;
          margin-top: 1px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          background: #0E7490;
        }
        .toast.progress .mark {
          background: transparent;
          border: 2px solid rgba(14, 116, 144, 0.25);
          border-top-color: #0E7490;
          animation: spin 700ms linear infinite;
          color: transparent;
        }
        .toast.success { border-color: rgba(5, 150, 105, 0.35); }
        .toast.success strong { color: #047857; }
        .toast.success .mark { background: #059669; }
        .toast.error strong { color: #BE123C; }
        .toast.error { border-color: rgba(225, 29, 72, 0.28); }
        .toast.error .mark { background: #E11D48; }
        @keyframes in {
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="wrap"></div>
    `;
    document.documentElement.appendChild(host);
  }

  const wrap = host.shadowRoot.querySelector(".wrap");
  let toast = wrap.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    wrap.appendChild(toast);
  }
  const titles = {
    progress: "处理中",
    success: "写入成功",
    error: "失败",
    info: "XQcoread"
  };
  const marks = {
    progress: "",
    success: "✓",
    error: "!",
    info: "i"
  };
  toast.className = `toast ${kind}`;
  toast.innerHTML = `<span class="mark">${marks[kind] || "i"}</span><div><strong>${titles[kind] || "XQcoread"}</strong>${escapeHtml(text)}</div>`;
  toast.style.animation = "none";
  void toast.offsetWidth;
  toast.style.animation = "";
  if (toast._timer) clearTimeout(toast._timer);
  const stay = sticky || kind === "progress";
  if (!stay) {
    toast._timer = setTimeout(() => toast.remove(), kind === "success" ? 5200 : 4500);
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 快捷键无需避开输入框：组合键只会匹配插件注册的 Cmd/Ctrl+Shift+字母，
// 不会与普通打字冲突；按这些组合即代表用户明确想触发捕获。

async function matchShortcut(event) {
  if (isModifierOnly(event) || event.repeat) return;
  const combo = eventToShortcut(event);
  const settings = await chrome.storage.local.get([
    "saveSelectionShortcut",
    "summarizePageShortcut",
    "summarizeSelectionShortcut"
  ]);
  const saveShortcut = settings.saveSelectionShortcut || DEFAULT_SAVE;
  const summarizeShortcut = settings.summarizePageShortcut || DEFAULT_SUMMARIZE;
  const summarizeSelectionShortcut = settings.summarizeSelectionShortcut || DEFAULT_SUMMARIZE_SELECTION;
  if (shortcutsEqual(combo, saveShortcut)) return "save-selection";
  if (shortcutsEqual(combo, summarizeSelectionShortcut)) return "summarize-selection";
  if (shortcutsEqual(combo, summarizeShortcut)) return "summarize-page";
  return null;
}

const DEFAULT_SAVE = "Cmd+Shift+O";
const DEFAULT_SUMMARIZE = "Cmd+Shift+P";
const DEFAULT_SUMMARIZE_SELECTION = "Cmd+Shift+K";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "XQ_PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "XQ_GET_SELECTION") {
    sendResponse(extractSelection());
    return false;
  }
  if (message?.type === "XQ_EXTRACT_PAGE") {
    sendResponse(extractPageContent());
    return false;
  }
  if (message?.type === "XQ_TOAST") {
    showXqToast(message.payload || {});
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

window.addEventListener(
  "keydown",
  async (event) => {
    // 扩展重载后旧 content script 已失联，访问 API 会抛异常，直接放弃
    if (!chrome.runtime?.id) return;
    if (isModifierOnly(event) || event.repeat) return;
    const command = await matchShortcut(event);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    chrome.runtime.sendMessage({ type: "XQ_CONTENT_SHORTCUT", command });
  },
  true
);
