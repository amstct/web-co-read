const DEBUG_LOG_LIMIT = 200;
const DEBUG_INGEST = "http://127.0.0.1:18765/log";

function redact(value) {
  if (!value || typeof value !== "object") return value;
  const clone = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|apikey|api_key|token|authorization|password/i.test(key)) {
      clone[key] = "[redacted]";
    } else if (item && typeof item === "object") {
      clone[key] = redact(item);
    } else {
      clone[key] = item;
    }
  }
  return clone;
}

async function xqLog(level, event, data) {
  const entry = {
    t: new Date().toISOString(),
    ts: Date.now(),
    level,
    event,
    data: redact(data || {})
  };
  const printer = level === "error" ? console.error : console.log;
  printer("[XQcoread]", event, entry.data);
  try {
    const { debugLogs = [] } = await chrome.storage.local.get("debugLogs");
    debugLogs.push(entry);
    await chrome.storage.local.set({ debugLogs: debugLogs.slice(-DEBUG_LOG_LIMIT) });
  } catch (error) {
    console.error("[XQcoread] persist log failed", error);
  }
  try {
    await fetch(DEBUG_INGEST, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
  } catch {
    // local ingest is optional
  }
  return entry;
}

async function getDebugLogs() {
  const { debugLogs = [] } = await chrome.storage.local.get("debugLogs");
  return debugLogs;
}

async function clearDebugLogs() {
  await chrome.storage.local.set({ debugLogs: [] });
}
