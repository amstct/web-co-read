chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
