const OLLAMA_DEFAULT_ORIGIN = "http://127.0.0.1:11434";
const OLLAMA_403_HINT = `Ollama 拒绝了 Chrome 插件请求（403）。这是它的跨域保护，不是模型名或 API Key 写错。

请在终端执行：
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"

然后点菜单栏 Ollama 图标 → Quit Ollama，再重新打开 Ollama。
若你是用终端启动的，请改用：
OLLAMA_ORIGINS="chrome-extension://*" ollama serve

设置里的 Base URL 填：http://127.0.0.1:11434/v1
API Key 可留空或填 ollama；模型名填终端执行 ollama list 看到的名称。`;

function isOllamaEndpoint(raw) {
  return /:11434\b|ollama/i.test(String(raw || ""));
}

function ollamaOrigin(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return OLLAMA_DEFAULT_ORIGIN;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value.replace(/\/(v\d+|api)$/i, "") || OLLAMA_DEFAULT_ORIGIN;
  }
}

function normalizeLlmBaseUrl(raw) {
  let base = String(raw || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先填写模型 API Base URL");
  if (isOllamaEndpoint(base)) return `${ollamaOrigin(base)}/v1`;
  if (!/\/v\d+$/i.test(base) && !base.includes("/openai")) base += "/v1";
  return base;
}

function requiresApiKey(settings) {
  return !isOllamaEndpoint(settings?.llmBaseUrl);
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

function ollamaRuntimeOptions(settings, maxTokens) {
  return {
    temperature: 0.3,
    num_ctx: contextTokens(settings),
    num_predict: maxTokens
  };
}

function stripThinkTags(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
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

function extractOllamaNativeText(payload) {
  const message = payload?.message || {};
  return firstNonEmptyText(flattenMessageContent(message.content), message.thinking, message.reasoning);
}

function llmErrorFromResponse(response, payload, url) {
  if (response.status === 403 && isOllamaEndpoint(url)) return OLLAMA_403_HINT;
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

async function chatCompleteOpenAi(settings, { system, user, maxTokens = 1200 }) {
  if (requiresApiKey(settings) && !settings.llmApiKey) {
    throw new Error("请先在设置中填写模型 API Key");
  }
  const base = normalizeLlmBaseUrl(settings.llmBaseUrl);
  const model = settings.llmModel?.trim();
  if (!model) throw new Error("请先填写模型名，例如 qwen2.5 或 gpt-4o-mini");

  const headers = { "Content-Type": "application/json" };
  if (settings.llmApiKey?.trim()) {
    headers.Authorization = `Bearer ${settings.llmApiKey.trim()}`;
  }

  const ollama = isOllamaEndpoint(settings.llmBaseUrl);
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: maxTokens,
      ...(ollama
        ? {
            reasoning_effort: "none",
            think: false,
            options: ollamaRuntimeOptions(settings, maxTokens)
          }
        : {}),
      messages: [
        { role: "system", content: system || DEFAULT_SUMMARY_PROMPT },
        { role: "user", content: user }
      ]
    })
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(llmErrorFromResponse(response, payload, base));
  }
  const text = extractOpenAiText(payload);
  if (!text) throw new Error("模型没有返回可用内容");
  return text;
}

async function chatCompleteOllamaNative(settings, { system, user, maxTokens = 1200 }) {
  const origin = ollamaOrigin(settings.llmBaseUrl);
  const model = settings.llmModel?.trim();
  if (!model) throw new Error("请先填写模型名。可在终端执行 ollama list 查看。");
  const response = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [
        { role: "system", content: system || DEFAULT_SUMMARY_PROMPT },
        { role: "user", content: user }
      ],
      options: ollamaRuntimeOptions(settings, maxTokens)
    })
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(llmErrorFromResponse(response, payload, origin));
  }
  const text = extractOllamaNativeText(payload);
  if (!text) throw new Error("Ollama 没有返回可用内容，请确认模型名与 ollama list 一致，且模型已拉取完成。");
  return text;
}

async function chatComplete(settings, params) {
  if (isOllamaEndpoint(settings.llmBaseUrl)) {
    try {
      return await chatCompleteOpenAi(settings, params);
    } catch (error) {
      if (/403/.test(error.message) || error.message.includes("跨域保护")) throw error;
      if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
        throw new Error("无法连接 Ollama。请确认应用已打开，Base URL 为 http://127.0.0.1:11434/v1");
      }
      return chatCompleteOllamaNative(settings, params);
    }
  }
  return chatCompleteOpenAi(settings, params);
}

async function listOllamaModels(settings) {
  const origin = ollamaOrigin(settings.llmBaseUrl || OLLAMA_DEFAULT_ORIGIN);
  let response;
  try {
    response = await fetch(`${origin}/api/tags`);
  } catch {
    throw new Error("无法连接 Ollama。请确认应用已打开，Base URL 为 http://127.0.0.1:11434/v1");
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(llmErrorFromResponse(response, payload, origin));
  }
  const names = (payload.models || []).map((item) => item.name).filter(Boolean);
  if (!names.length) throw new Error("Ollama 已连通，但还没有本地模型。请先执行 ollama pull <模型名>");
  return names;
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

async function summarizeSelectionContent(settings, selection) {
  return summarizeTextContent(settings, {
    title: selection.title,
    url: selection.url,
    text: typeof stripXueqiuFooter === "function" ? stripXueqiuFooter(selection.text) : selection.text,
    prompt: settings.selectionSummaryPrompt?.trim() || DEFAULT_SELECTION_SUMMARY_PROMPT,
    heading: "划选原文",
    minLength: 8,
    tooShort: "划选内容过短，无法总结。请先划选一段文字。"
  });
}

async function testLlmConnection(settings) {
  if (isOllamaEndpoint(settings.llmBaseUrl) && !settings.llmModel?.trim()) {
    const models = await listOllamaModels(settings);
    return `已连通，请选择模型：${models.slice(0, 8).join("、")}`;
  }
  return chatComplete(settings, {
    system: "只回复一个词：ok",
    user: "ping",
    maxTokens: 64
  });
}
