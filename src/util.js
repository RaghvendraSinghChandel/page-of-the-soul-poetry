// Small shared helpers: errors, retries, time in the configured timezone, text similarity.

export class JobError extends Error {
  /** kind: retryable | permanent | quota | no_topic | ambiguous */
  constructor(message, { kind = "retryable", code, cause } = {}) {
    super(message, { cause });
    this.name = "JobError";
    this.kind = kind;
    if (code !== undefined) this.code = code;
  }
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Exponential back-off with full jitter. */
export function backoffDelay(attempt, { baseMs = 1000, maxMs = 30000, random = Math.random } = {}) {
  return Math.round(random() * Math.min(maxMs, baseMs * 2 ** attempt));
}

/** True for network-level failures (DNS, reset, timeout) raised by fetch. */
export function isNetworkError(error) {
  if (!error) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  if (error instanceof TypeError && /fetch failed|network|socket/i.test(error.message)) return true;
  const code = error.cause?.code || error.code;
  return typeof code === "string" && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_)/.test(code);
}

/** Date/time parts of `date` in `timeZone`. */
export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)])
  );
  return parts; // { year, month, day, hour, minute, second }
}

/** The UTC instant of wall-clock time `hh:mm` on the local date `ymd` (YYYY-MM-DD) in `timeZone`. */
export function zonedTimeToUtc(ymd, hhmm, timeZone) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Offset of the zone at that moment (two passes cover DST edges; IST has none).
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(ts), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    ts = guess - (asUtc - ts);
  }
  return new Date(ts);
}

export function localDate(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 22" for "2026-10-22". */
export function monthDay(ymd) {
  const [, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function formatInZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-IN", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
}

const STOP = new Set("a an the of in on at to for and or but is was were be been by with from as that this it its into their his her they he she which who after before during".split(" "));

export function tokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOP.has(word))
  );
}

/** Jaccard similarity of the content words of two texts (0..1). */
export function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Every number written in `text` (digits only, separators removed): "1,200 km in 1969" → ["1200", "1969"]. */
export function numbersIn(text) {
  return [...String(text || "").matchAll(/\d[\d,.]*/g)].map(match => match[0].replace(/[,.]+$/, "").replace(/,/g, ""));
}

/** Numbers in `text` that do not appear anywhere in `evidence`. */
export function unsupportedNumbers(text, evidence) {
  const known = new Set(numbersIn(evidence));
  return numbersIn(text).filter(n => !known.has(n));
}
