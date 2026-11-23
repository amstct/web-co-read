const EXTRACT_REMOVE_SELECTOR = [
  "script",
  "style",
  "noscript",
  "iframe",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "svg",
  "canvas",
  "button",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='complementary']",
  ".sidebar",
  ".advert",
  ".ads",
  ".ad",
  "#comments"
].join(",");

const EXTRACT_ARTICLE_SELECTOR = [
  "article",
  "main",
  "[role='main']",
  "#js_content",
  ".rich_media_content",
  ".Post-RichText",
  ".Post-RichTextContainer",
  ".article-content",
  ".article__bd",
  ".status-content",
  ".entry-content",
  ".post-content",
  ".content-article"
].join(",");

function extractFromDocument(doc, pageUrl) {
  const title =
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    doc.querySelector("title")?.textContent ||
    "";
  const url = pageUrl || doc.querySelector('link[rel="canonical"]')?.href || doc.baseURI || "";

  const source = doc.body ? doc.body.cloneNode(true) : doc.cloneNode(true);
  source.querySelectorAll(EXTRACT_REMOVE_SELECTOR).forEach((el) => el.remove());

  const article = source.querySelector(EXTRACT_ARTICLE_SELECTOR);
  let text = (article || source).innerText || source.textContent || "";
  text = text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const limit = typeof PAGE_TEXT_LIMIT === "number" ? PAGE_TEXT_LIMIT : 250000;
  return {
    title: title.trim(),
    url,
    text: text.slice(0, limit),
    truncated: text.length > limit,
    length: Math.min(text.length, limit)
  };
}

function extractPageContent() {
  return extractFromDocument(document, location.href);
}

let cachedSelection = { text: "", title: "", url: "" };

// 独立打开的 PDF（contentType 为 application/pdf）或页面里内嵌的 PDF：
// 划选发生在 PDF 查看器表面，DOM 选区读不到，需要后台改走剪贴板兜底。
function detectPdfPage() {
  try {
    return (
      document.contentType === "application/pdf" ||
      Boolean(document.querySelector('embed[type="application/pdf"]'))
    );
  } catch {
    return false;
  }
}

function extractSelection() {
  const live = (window.getSelection?.()?.toString() || "").trim();
  if (live) {
    cachedSelection = {
      text: live,
      title: document.title || "",
      url: location.href
    };
  }
  return { ...cachedSelection, isPdf: detectPdfPage() };
}

if (typeof document !== "undefined") {
  const remember = () => extractSelection();
  document.addEventListener("selectionchange", remember, true);
  document.addEventListener("mouseup", remember, true);
}
