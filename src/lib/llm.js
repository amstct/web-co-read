const DEFAULT_LLM_BASE_URL = "https://api.contentmaking.cc/v1";

function normalizeLlmBaseUrl(raw) {
  let base = String(raw || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先填写模型 API Base URL");
  if (!/\/v\d+$/i.test(base) && !base.includes("/openai")) base += "/v1";
  return base;
}

function llmAuthHeaders(settings) {
  const headers = { "Content-Type": "application/json" };
  if (settings.llmApiKey?.trim()) {
    headers.Authorization = `Bearer ${settings.llmApiKey.trim()}`;
  }
  return headers;
}

function contextTokens(settings) {
  const value = Number(settings?.llmContextTokens);
  return Number.isFinite(value) && value >= 2048 ? Math.floor(value) : 131072;
}

function outputTokens(settings, requested) {
  const ctx = contextTokens(settings);
  const want = requested || (typeof LLM_OUTPUT_TOKENS === "number" ? LLM_OUTPUT_TOKENS : 8192);
  return Math.min(want, Math.max(256, ctx - 1024));
}

function inputCharBudget(settings) {
  const ctx = contextTokens(settings);
  const reserved = outputTokens(settings) + 2048;
  // 中文模型大约 1 字 ≈ 1 token，留一点余量避免把 128K 窗口顶满。
  return Math.max(8000, Math.floor((ctx - reserved) * 0.95));
}

function stripThinkTags(text) {
  let out = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  // 部分 vLLM 部署会把思考开标签吃掉，正文前只剩一个 </think>：取最后一个 </think> 之后的内容。
  const closeIdx = out.lastIndexOf("</think>");
  if (closeIdx >= 0) out = out.slice(closeIdx + "</think>".length);
  // 只出现 <think> 说明思考被 max_tokens 截断，后面不会再有正文。
  const openIdx = out.indexOf("<think>");
  if (openIdx >= 0) out = out.slice(0, openIdx);
  return out.trim();
}

function thinkingDisabled(settings) {
  const value = settings?.llmDisableThinking;
  return !(value === false || value === "false" || value === "0" || value === "off");
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = stripThinkTags(typeof value === "string" ? value : "");
    if (text) return text;
  }
  return "";
}

function flattenMessageContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return part?.text || part?.content || "";
    })
    .join("");
}

function extractOpenAiText(payload) {
  const message = payload?.choices?.[0]?.message || {};
  return firstNonEmptyText(
    flattenMessageContent(message.content),
    message.reasoning,
    message.reasoning_content,
    message.thinking
  );
}

function llmErrorFromResponse(response, payload) {
  if (response.status === 401) return "令牌无效（401）。请检查设置里的 API Key 是否正确、额度是否充足。";
  return (
    payload.error?.message ||
    payload.message ||
    payload.error ||
    (typeof payload === "string" ? payload : "") ||
    `模型接口错误 (${response.status})`
  );
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

async function chatComplete(settings, { system, user, maxTokens = 1200 }) {
  if (!settings.llmApiKey?.trim()) {
    throw new Error("请先在设置中填写模型 API Key");
  }
  const base = normalizeLlmBaseUrl(settings.llmBaseUrl);
  const model = settings.llmModel?.trim();
  if (!model) throw new Error("请先填写模型名，可点「拉取模型列表」选择");

  const body = {
    model,
    temperature: 0.3,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system || DEFAULT_SUMMARY_PROMPT },
      { role: "user", content: user }
    ]
  };
  if (thinkingDisabled(settings)) {
    // 总结不需要推理链。vLLM 看 chat_template_kwargs，DashScope 系看顶层 enable_thinking，
    // 两种写法都带上，网关透传任一即可关闭；普通模型会忽略这两个字段。
    body.enable_thinking = false;
    body.chat_template_kwargs = { enable_thinking: false };
  }
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: llmAuthHeaders(settings),
    body: JSON.stringify(body)
  }).catch((error) => {
    throw new Error(`无法连接模型服务（${base}）。请确认地址可访问、端口/路径正确。（${error.message}）`);
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(llmErrorFromResponse(response, payload));
  }
  const text = extractOpenAiText(payload);
  if (!text) throw new Error("模型没有返回可用内容");
  return text;
}

async function listLlmModels(settings) {
  const base = normalizeLlmBaseUrl(settings.llmBaseUrl || DEFAULT_LLM_BASE_URL);
  if (!settings.llmApiKey?.trim()) {
    throw new Error("请先在设置中填写模型 API Key");
  }
  const response = await fetch(`${base}/models`, { headers: llmAuthHeaders(settings) }).catch((error) => {
    throw new Error(`无法连接模型服务（${base}）。请确认地址可访问、端口/路径正确。（${error.message}）`);
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(llmErrorFromResponse(response, payload));
  }
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  const ids = raw.map((item) => item?.id).filter(Boolean);
  if (!ids.length) {
    throw new Error("服务已连通，但没有可用模型。请检查该令牌是否有可用渠道和模型。");
  }
  return ids;
}

async function summarizeTextContent(settings, { title, url, text, prompt, heading, minLength, tooShort }) {
  const body = String(text || "").slice(0, inputCharBudget(settings));
  if (!body || body.length < minLength) throw new Error(tooShort);
  const user = [
    `标题：${title || "未命名"}`,
    `URL：${url || ""}`,
    "",
    `${heading}：`,
    body
  ].join("\n");
  return chatComplete(settings, {
    system: prompt,
    user,
    maxTokens: outputTokens(settings)
  });
}

async function summarizePageContent(settings, page) {
  return summarizeTextContent(settings, {
    title: page.title,
    url: page.url,
    text: page.text,
    prompt: settings.summaryPrompt?.trim() || DEFAULT_SUMMARY_PROMPT,
    heading: "正文",
    minLength: 40,
    tooShort: "页面正文过短，无法总结。请确认页面已加载完成。"
  });
}

async function summarizeSelectionContent(settings, selection, overrides = {}) {
  return summarizeTextContent(settings, {
    title: selection.title,
    url: selection.url,
    text: typeof stripXueqiuFooter === "function" ? stripXueqiuFooter(selection.text) : selection.text,
    prompt: settings.selectionSummaryPrompt?.trim() || DEFAULT_SELECTION_SUMMARY_PROMPT,
    heading: overrides.heading || "划选原文",
    minLength: 8,
    tooShort: overrides.tooShort || "划选内容过短，无法总结。请先划选一段文字。"
  });
}

async function testLlmConnection(settings) {
  if (!settings.llmModel?.trim()) {
    const models = await listLlmModels(settings);
    return `已连通，请选择模型：${models.slice(0, 8).join("、")}`;
  }
  return chatComplete(settings, {
    system: "只回复一个词：ok",
    user: "ping",
    maxTokens: 64
  });
}
