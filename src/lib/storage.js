async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  const currentPrompt = String(settings.summaryPrompt || "").trim();
  const shouldMigrate =
    LEGACY_SUMMARY_PROMPTS.some((prompt) => prompt.trim() === currentPrompt) ||
    /再写一段不超过\s*180\s*字的综述/.test(currentPrompt);
  if (shouldMigrate) {
    settings.summaryPrompt = DEFAULT_SUMMARY_PROMPT;
    await chrome.storage.local.set({ summaryPrompt: DEFAULT_SUMMARY_PROMPT });
  }
  return settings;
}

async function saveSettings(partial) {
  const next = {};
  for (const [key, value] of Object.entries(partial)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (key === "llmContextTokens") {
      const tokens = Number(value);
      next[key] = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : DEFAULT_SETTINGS.llmContextTokens;
    } else {
      next[key] = value;
    }
  }
  await chrome.storage.local.set(next);
  return getSettings();
}

async function getActivity() {
  const { activity = [] } = await chrome.storage.local.get("activity");
  return activity;
}

async function pushActivity(entry) {
  const activity = await getActivity();
  activity.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: Date.now(),
    ...entry
  });
  await chrome.storage.local.set({ activity: activity.slice(0, ACTIVITY_LIMIT) });
  return activity.slice(0, ACTIVITY_LIMIT);
}

async function getCachedToken() {
  const { feishuTokenCache } = await chrome.storage.local.get("feishuTokenCache");
  return feishuTokenCache || null;
}

async function setCachedToken(cache) {
  await chrome.storage.local.set({ feishuTokenCache: cache });
}
