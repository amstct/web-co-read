function normalizeKeyName(key) {
  if (!key) return "";
  const map = {
    " ": "Space",
    Escape: "Esc",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Meta: "Meta",
    Control: "Ctrl",
    Alt: "Alt",
    Shift: "Shift"
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function eventToShortcut(event) {
  const parts = [];
  if (event.metaKey) parts.push("Cmd");
  if (event.ctrlKey && !event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key = normalizeKeyName(event.key);
  if (!["Meta", "Ctrl", "Alt", "Shift", "Cmd"].includes(key)) parts.push(key);
  return parts.join("+");
}

function isModifierOnly(event) {
  return ["Meta", "Control", "Alt", "Shift"].includes(event.key);
}

function shortcutsEqual(a, b) {
  if (!a || !b) return false;
  const split = (value) =>
    value
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => (part === "Command" || part === "Cmd" || part === "Meta" || part === "Ctrl" ? "Mod" : part))
      .map((part) => (part === "Option" ? "Alt" : part));
  const left = split(a);
  const right = split(b);
  if (left.length !== right.length) return false;
  return left.every((part, index) => part.toLowerCase() === right[index].toLowerCase());
}

function formatShortcutLabel(shortcut) {
  if (!shortcut) return "未设置";
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "Meta" || part === "Cmd" || part === "Command") return isMac ? "⌘" : "Ctrl";
      if (part === "Alt") return isMac ? "⌥" : "Alt";
      if (part === "Ctrl") return isMac ? "⌃" : "Ctrl";
      if (part === "Shift") return isMac ? "⇧" : "Shift";
      return part;
    })
    .join(isMac ? "" : "+");
}
