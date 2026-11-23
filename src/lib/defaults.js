const DEFAULT_SUMMARY_PROMPT = `你是阅读助手。请把网页正文提炼成适合写入知识库的中文要点。

输出要求：
1. 只用简体中文。
2. 只输出 4–8 条要点，使用 Markdown 无序列表，每行以 "- " 开头。
3. 每条格式：- **短标题**：一句话说明。信息密度高。
4. 不要输出文章标题、来源、URL、日期、时间。
5. 不要输出「摘要」「综述」「核心要点」这类小标题，也不要开场白或结尾。
6. 不要编造原文没有的信息；不确定就标明“原文未明确”。`;

const DEFAULT_SELECTION_SUMMARY_PROMPT = `你是阅读助手。请把用户划选的原文提炼成适合写入知识库的中文要点。

输出要求：
1. 只用简体中文。
2. 只根据划选原文总结，不要靠未提供的上下文去编造。
3. 输出 2–6 条要点，使用 Markdown 无序列表，每行以 "- " 开头。划选很短时，用 1–2 条把原意说清楚即可。
4. 每条格式：- **短标题**：一句话说明。信息密度高。
5. 不要输出文章标题、来源、URL、日期、时间。
6. 不要输出「摘要」「综述」「核心要点」这类小标题，也不要开场白或结尾。
7. 不要编造原文没有的信息；不确定就标明“原文未明确”。`;

const LEGACY_SUMMARY_PROMPTS = [
  `你是阅读助手。请把用户提供的网页正文提炼成适合写入知识库的中文笔记。

要求：
1. 用简体中文输出。
2. 先给 3–6 条核心要点（短句，信息密度高）。
3. 再写一段不超过 180 字的综述。
4. 如有关键数据、结论、出处或争议，单独列出。
5. 不要编造原文没有的信息；不确定就标明“原文未明确”。
6. 不要输出开场白或结尾寒暄。`
];

const DEFAULT_SETTINGS = {
  feishuAppId: "",
  feishuAppSecret: "",
  feishuDocUrl: "",
  feishuApiBase: "https://open.feishu.cn",
  llmBaseUrl: "http://192.168.1.10:3000/v1",
  llmApiKey: "",
  llmModel: "gpt-4o-mini",
  llmContextTokens: 131072,
  llmDisableThinking: true,
  summaryPrompt: DEFAULT_SUMMARY_PROMPT,
  selectionSummaryPrompt: DEFAULT_SELECTION_SUMMARY_PROMPT,
  saveSelectionShortcut: "Cmd+Shift+O",
  summarizePageShortcut: "Cmd+Shift+P",
  summarizeSelectionShortcut: "Cmd+Shift+K",
  saveClipboardShortcut: "Cmd+Shift+X",
  summarizeClipboardShortcut: "Cmd+Shift+L"
};

const ACTIVITY_LIMIT = 20;
const PAGE_TEXT_LIMIT = 250000;
const LLM_OUTPUT_TOKENS = 8192;
