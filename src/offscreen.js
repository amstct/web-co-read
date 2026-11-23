// 内置 PDF 查看器等无法注入内容脚本的页面，划线读不到，
// 用 offscreen 文档 execCommand('paste') 读剪贴板兜底（clipboardRead 权限内，无弹窗）。
function readClipboardViaPaste() {
  return new Promise((resolve, reject) => {
    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    let pasted = false;
    try {
      pasted = document.execCommand("paste");
    } catch {
      // older engines may throw; fall through to value check
    }
    const text = textarea.value || "";
    textarea.remove();
    if (!pasted && !text) {
      reject(new Error("无法读取剪贴板。请重新加载扩展（chrome://extensions 里点刷新），确认已授予「读取剪贴板」权限后重试。"));
      return;
    }
    resolve(text);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "XQ_READ_CLIPBOARD") {
    (async () => {
      try {
        const text = await readClipboardViaPaste();
        sendResponse({ text });
      } catch (error) {
        sendResponse({ text: "", error: error.message });
      }
    })();
    return true;
  }
  if (message?.type !== "XQ_FETCH_AND_PARSE") return false;
  (async () => {
    try {
      const response = await fetch(message.url, { credentials: "omit" });
      if (!response.ok) throw new Error(`抓取页面失败 (${response.status})`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      sendResponse(extractFromDocument(doc, message.url));
    } catch (error) {
      sendResponse({ title: "", url: message.url, text: "", error: error.message });
    }
  })();
  return true;
});
