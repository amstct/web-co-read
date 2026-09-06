const FEISHU_TOKEN_SKEW_MS = 5 * 60 * 1000;

function normalizeApiBase(base) {
  return String(base || "https://open.feishu.cn").replace(/\/+$/, "");
}

function parseFeishuDocUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) throw new Error("请先填写飞书文档链接");

  let url;
  try {
    url = new URL(input);
  } catch {
    if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) {
      return { kind: "docx", token: input };
    }
    throw new Error("飞书文档链接格式不正确");
  }

  const match = url.pathname.match(/\/(docx|wiki|docs)\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("无法从链接中解析文档 token，请使用 docx 或 wiki 链接");
  return { kind: match[1], token: match[2] };
}

async function feishuFetch(apiBase, token, path, options = {}) {
  const response = await fetch(`${normalizeApiBase(apiBase)}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (typeof xqLog === "function") {
    await xqLog(response.ok && !(payload.code > 0) ? "info" : "error", "feishu.http", {
      method: options.method || "GET",
      path,
      status: response.status,
      code: payload.code,
      msg: payload.msg || payload.message || ""
    });
  }
  const failed = !response.ok || (typeof payload.code === "number" && payload.code !== 0);
  if (failed) {
    const message = explainFeishuError(payload.code, payload.msg || payload.message, response.status);
    const error = new Error(message);
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

function explainFeishuError(code, msg, status) {
  if (code === 1770032) {
    return [
      "飞书拒绝写入（1770032 forbidden）。应用能读这份文档，但没有编辑权限。",
      "请打开该飞书文档 → 右上角「…」→「更多」→「添加文档应用」，搜到你的应用并授予「可编辑」。",
      "若是知识库页面，要用知识库管理员身份添加，且开放平台权限需包含 docx:document（可编辑），改完后发布应用版本。"
    ].join("");
  }
  return msg || `飞书接口错误 (${status})`;
}

async function getTenantAccessToken(settings, force = false) {
  if (!settings.feishuAppId || !settings.feishuAppSecret) {
    throw new Error("请先在设置中填写飞书 App ID 和 App Secret");
  }

  if (!force) {
    const cache = await getCachedToken();
    if (
      cache?.token &&
      cache.appId === settings.feishuAppId &&
      cache.apiBase === settings.feishuApiBase &&
      cache.expireAt > Date.now() + FEISHU_TOKEN_SKEW_MS
    ) {
      return cache.token;
    }
  }

  const response = await fetch(`${normalizeApiBase(settings.feishuApiBase)}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: settings.feishuAppId.trim(),
      app_secret: settings.feishuAppSecret.trim()
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!payload.tenant_access_token) {
    throw new Error(payload.msg || "获取飞书 tenant_access_token 失败，请检查 App ID / Secret");
  }

  await setCachedToken({
    token: payload.tenant_access_token,
    appId: settings.feishuAppId,
    apiBase: settings.feishuApiBase,
    expireAt: Date.now() + (payload.expire || 7200) * 1000
  });
  return payload.tenant_access_token;
}

async function resolveDocumentId(settings, token) {
  const parsed = parseFeishuDocUrl(settings.feishuDocUrl);
  if (parsed.kind === "wiki") {
    const node = await feishuFetch(
      settings.feishuApiBase,
      token,
      `/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parsed.token)}`
    );
    const objToken = node?.node?.obj_token || node?.obj_token;
    const objType = node?.node?.obj_type || node?.obj_type;
    if (!objToken) throw new Error("无法解析 wiki 节点对应的文档 ID");
    if (objType && objType !== "docx" && objType !== "doc") {
      throw new Error("该 wiki 节点不是云文档，暂不支持写入");
    }
    return objToken;
  }
  return parsed.token;
}

function prepareDescendantBody(convertData, documentId) {
  const firstLevel = new Set(convertData.first_level_block_ids || []);
  const descendants = (convertData.blocks || []).map((block) => {
    const next = { ...block };
    if (firstLevel.has(block.block_id) || !block.parent_id) {
      next.parent_id = documentId;
    }
    if (next.table?.property?.merge_info) {
      const property = { ...next.table.property };
      delete property.merge_info;
      next.table = { ...next.table, property };
    }
    return next;
  });
  return {
    children_id: convertData.first_level_block_ids || descendants.map((block) => block.block_id).filter(Boolean),
    descendants,
    index: -1
  };
}

async function convertMarkdown(settings, token, markdown) {
  return feishuFetch(settings.feishuApiBase, token, "/open-apis/docx/v1/documents/blocks/convert", {
    method: "POST",
    body: { content_type: "markdown", content: markdown }
  });
}

async function appendDescendants(settings, token, documentId, convertData) {
  const body = prepareDescendantBody(convertData, documentId);
  if (!body.children_id.length || !body.descendants.length) {
    throw new Error("Markdown 转换结果为空");
  }
  return feishuFetch(
    settings.feishuApiBase,
    token,
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/descendant?document_revision_id=-1`,
    {
      method: "POST",
      body
    }
  );
}

function emptyParagraphBlock() {
  return {
    block_type: 2,
    text: { elements: [{ text_run: { content: "" } }] }
  };
}

async function appendChildren(settings, token, documentId, children) {
  const chunks = [];
  for (let i = 0; i < children.length; i += 40) chunks.push(children.slice(i, i + 40));
  for (const chunk of chunks) {
    await feishuFetch(
      settings.feishuApiBase,
      token,
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children?document_revision_id=-1`,
      {
        method: "POST",
        body: { children: chunk, index: -1 }
      }
    );
  }
}

async function appendSimpleBlocks(settings, token, documentId, markdown) {
  const children = markdownToSimpleBlocks(markdown);
  if (typeof xqLog === "function") {
    await xqLog("info", "feishu.simple.blocks", { count: children.length, types: children.map((item) => item.block_type) });
  }
  await appendChildren(settings, token, documentId, children);
}

async function appendTrailingBlankLine(settings, token, documentId) {
  await appendChildren(settings, token, documentId, [emptyParagraphBlock()]);
}

async function appendMarkdownToFeishu(settings, markdown, options = {}) {
  const content = String(markdown || "").trim();
  if (!content) throw new Error("没有可写入的内容");
  if (typeof xqLog === "function") {
    await xqLog("info", "feishu.append.start", {
      markdownChars: content.length,
      preferConvert: Boolean(options.preferConvert),
      docUrl: settings.feishuDocUrl
    });
  }
  const token = await getTenantAccessToken(settings);
  const documentId = await resolveDocumentId(settings, token);
  if (typeof xqLog === "function") {
    await xqLog("info", "feishu.append.resolved", { documentId });
  }

  const tryConvert = async () => {
    const converted = await convertMarkdown(settings, token, content);
    await appendDescendants(settings, token, documentId, converted);
    return "descendant";
  };
  const trySimple = async () => {
    await appendSimpleBlocks(settings, token, documentId, content);
    return "simple";
  };

  let method;
  if (options.preferConvert) {
    try {
      method = await tryConvert();
    } catch (error) {
      if (typeof xqLog === "function") {
        await xqLog("error", "feishu.append.convert.fail", { message: error.message, code: error.code });
      }
      method = await trySimple();
    }
  } else {
    try {
      method = await trySimple();
    } catch (error) {
      if (typeof xqLog === "function") {
        await xqLog("error", "feishu.append.simple.fail", { message: error.message, code: error.code });
      }
      method = await tryConvert();
    }
  }

  try {
    await appendTrailingBlankLine(settings, token, documentId);
  } catch (error) {
    if (typeof xqLog === "function") {
      await xqLog("error", "feishu.append.blank.fail", { message: error.message, code: error.code });
    }
  }

  if (typeof xqLog === "function") await xqLog("info", "feishu.append.ok", { documentId, method });
  return { documentId, method };
}

async function probeFeishuWrite(settings) {
  const markdown = [
    `## XQcoread 试写`,
    `时间：${new Date().toLocaleString()}`,
    "",
    "这是一条连通性测试，确认后可删除。",
    "",
    "---",
    ""
  ].join("\n");
  return appendMarkdownToFeishu(settings, markdown);
}

function markdownToSimpleBlocks(markdown) {
  const children = [];
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  let inQuote = false;
  let quoteLines = [];

  const flushQuote = () => {
    if (!quoteLines.length) return;
    children.push({
      block_type: 15,
      quote: {
        elements: [{ text_run: { content: quoteLines.join("\n").slice(0, 8000) } }]
      }
    });
    quoteLines = [];
    inQuote = false;
  };

  const pushText = (content, type = "text") => {
    const text = content.slice(0, 8000);
    if (!text) return;
    if (type === "h1") {
      children.push({ block_type: 3, heading1: { elements: [{ text_run: { content: text } }] } });
    } else if (type === "h2") {
      children.push({ block_type: 4, heading2: { elements: [{ text_run: { content: text } }] } });
    } else if (type === "h3") {
      children.push({ block_type: 5, heading3: { elements: [{ text_run: { content: text } }] } });
    } else if (type === "bullet") {
      children.push({ block_type: 12, bullet: { elements: [{ text_run: { content: text } }] } });
    } else if (type === "ordered") {
      children.push({ block_type: 13, ordered: { elements: [{ text_run: { content: text } }] } });
    } else {
      children.push({ block_type: 2, text: { elements: [{ text_run: { content: text } }] } });
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith(">")) {
      inQuote = true;
      quoteLines.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (inQuote) flushQuote();
    if (!line.trim()) continue;
    if (/^---+$/.test(line.trim())) {
      children.push({ block_type: 22, divider: {} });
      continue;
    }
    if (line.startsWith("### ")) pushText(line.slice(4), "h3");
    else if (line.startsWith("## ")) pushText(line.slice(3), "h2");
    else if (line.startsWith("# ")) pushText(line.slice(2), "h1");
    else if (/^[-*+]\s+/.test(line)) pushText(line.replace(/^[-*+]\s+/, ""), "bullet");
    else if (/^\d+\.\s+/.test(line)) pushText(line.replace(/^\d+\.\s+/, ""), "ordered");
    else pushText(line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2"));
  }
  flushQuote();
  if (!children.length) {
    children.push({ block_type: 2, text: { elements: [{ text_run: { content: "（空内容）" } }] } });
  }
  return children;
}

async function testFeishuConnection(settings) {
  const token = await getTenantAccessToken(settings, true);
  const documentId = await resolveDocumentId(settings, token);
  const info = await feishuFetch(settings.feishuApiBase, token, `/open-apis/docx/v1/documents/${documentId}`);
  return {
    documentId,
    title: info?.document?.title || info?.title || "已连接"
  };
}
