function escapeMd(text) {
  return String(text || "").replace(/\r/g, "").trim();
}

function stripXueqiuFooter(text) {
  return escapeMd(text)
    .replace(/\n+作者：[^\n]+\n链接：https?:\/\/[^\n]+(?:\n来源：雪球)?[\s\S]*$/u, "")
    .replace(/\n+风险提示：[\s\S]*$/u, "")
    .trim();
}

function unwrapMarkdownFence(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function cleanSummaryOutput(text) {
  return unwrapMarkdownFence(text)
    .replace(/\n+(#{1,6}\s*|\*\*)综述(\*\*)?[\s\S]*$/u, "")
    .replace(/^\s*(#{1,6}\s*)?(摘要|核心要点|综述)\s*$/gmi, "")
    .replace(/^\s*\*\*(摘要|核心要点|综述)\*\*\s*$/gmi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildQuoteMarkdown({ text }) {
  return stripXueqiuFooter(text);
}

function buildSummaryMarkdown({ summary }) {
  return cleanSummaryOutput(summary);
}
