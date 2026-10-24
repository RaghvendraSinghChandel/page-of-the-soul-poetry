import fs from "node:fs";
import path from "node:path";

// Structured JSON-lines logger. Every message, field and error passes through redact() first,
// so tokens and keys never reach the console, the log file or the content history.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const registeredSecrets = new Set();

/** Adds exact secret values (tokens, keys) that must be masked everywhere. */
export function registerSecrets(values) {
  for (const value of values) {
    if (value && String(value).length >= 6) registeredSecrets.add(String(value));
  }
}

const PATTERNS = [
  [/((?:access_token|input_token|client_secret|appsecret_proof|api[_-]?key|key)=)[^&\s"'<>]+/gi, "$1[REDACTED]"],
  [/\bEAA[A-Za-z0-9]{20,}/g, "[REDACTED_META_TOKEN]"],
  [/\bIG[A-Za-z0-9]{30,}/g, "[REDACTED_IG_TOKEN]"],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[REDACTED_GOOGLE_KEY]"],
  [/(Bearer|token)\s+[A-Za-z0-9._~+/=-]{12,}/g, "$1 [REDACTED]"],
];

export function redact(value) {
  if (typeof value !== "string") return value;
  let text = value;
  for (const secret of registeredSecrets) text = text.split(secret).join("[REDACTED]");
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

function redactDeep(value, depth = 0) {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), ...(value.kind ? { kind: value.kind } : {}), ...(value.code !== undefined ? { code: value.code } : {}) };
  }
  if (Array.isArray(value)) return value.map(item => redactDeep(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]));
  }
  return value;
}

/** Error text that is safe to store in the history or print. */
export function safeErrorText(error) {
  if (!error) return "";
  return redact(error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

export function createLogger({ level = "info", logDir = "", context = {}, console: out = console, now = () => new Date() } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  let file = "";
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    file = path.join(logDir, "app.log");
  }

  function write(levelName, message, fields = {}) {
    if (LEVELS[levelName] < threshold) return;
    const entry = redactDeep({ time: now().toISOString(), level: levelName, msg: message, ...context, ...fields });
    if (file) {
      try {
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
      } catch (error) {
        out.error(`Could not write log file: ${error.message}`);
      }
    }
    const extras = Object.entries(entry)
      .filter(([key]) => !["time", "level", "msg"].includes(key))
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join(" ");
    const line = `${entry.time} ${levelName.toUpperCase().padEnd(5)} ${entry.msg}${extras ? `  ${extras}` : ""}`;
    (levelName === "error" ? out.error : levelName === "warn" ? out.warn : out.log)(line);
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: fields => createLogger({ level, logDir, context: { ...context, ...fields }, console: out, now }),
  };
}

/** Logger that discards everything (tests). */
export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};
