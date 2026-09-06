function showXqToast({ kind = "info", text = "" }) {
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
          bottom: 20px;
          z-index: 2147483647;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
          font-family: "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
        }
        .toast {
          min-width: 220px;
          max-width: 320px;
          padding: 12px 14px;
          border-radius: 12px;
          color: #0F3A47;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(8, 145, 178, 0.22);
          box-shadow: 0 12px 40px rgba(8, 145, 178, 0.16);
          backdrop-filter: blur(16px);
          font-size: 13px;
          line-height: 1.5;
          transform: translateY(8px);
          opacity: 0;
          animation: in 180ms ease forwards;
        }
        .toast strong {
          display: block;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 4px;
          color: #0E7490;
        }
        .toast.error strong { color: #BE123C; }
        .toast.error { border-color: rgba(225, 29, 72, 0.28); }
        @keyframes in {
          to { transform: translateY(0); opacity: 1; }
        }
      </style>
      <div class="wrap"></div>
    `;
    document.documentElement.appendChild(host);
  }

  const wrap = host.shadowRoot.querySelector(".wrap");
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.innerHTML = `<strong>${kind === "error" ? "FAILED" : "XQCOREAD"}</strong>${escapeHtml(text)}`;
  wrap.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shouldIgnoreShortcutTarget(target) {
  if (!target) return false;
  const el = target.closest?.("input, textarea, select, [contenteditable='true']");
  return Boolean(el);
}

async function matchShortcut(event) {
  if (isModifierOnly(event) || event.repeat) return;
  const combo = eventToShortcut(event);
  const settings = await chrome.storage.local.get(["saveSelectionShortcut", "summarizePageShortcut"]);
  const saveShortcut = settings.saveSelectionShortcut || DEFAULT_SAVE;
  const summarizeShortcut = settings.summarizePageShortcut || DEFAULT_SUMMARIZE;
  if (shortcutsEqual(combo, saveShortcut)) return "save-selection";
  if (shortcutsEqual(combo, summarizeShortcut)) return "summarize-page";
  return null;
}

const DEFAULT_SAVE = "Cmd+Shift+O";
const DEFAULT_SUMMARIZE = "Cmd+Shift+P";

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
    if (shouldIgnoreShortcutTarget(event.target) && !window.getSelection()?.toString()) return;
    const command = await matchShortcut(event);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    chrome.runtime.sendMessage({ type: "XQ_CONTENT_SHORTCUT", command });
  },
  true
);
