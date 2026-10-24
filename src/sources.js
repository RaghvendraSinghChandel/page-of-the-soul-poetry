import { JobError, isNetworkError, sleep } from "./util.js";

// Verified classical couplets come only from public-domain editions transcribed on Hindi Wikisource.
// Each run fetches the live page, extracts its numbered two-line couplets (dohe/sorthe/sakhi), and the
// writer may only pick one of those by id. The text shown on the post is therefore the edition's exact
// wording, never something the model remembers or rewrites. Editors' footnotes and commentary are dropped.

export const SOURCES = [
  {
    id: "kabir-kk",
    page: "कविता-कौमुदी १/३ कबीर साहब",
    poet: { hi: "कबीर", roman: "Kabir" },
    work: { hi: "कविता-कौमुदी, भाग १", roman: "Kavita-Kaumudi, Bhag 1" },
    editor: "Ramnaresh Tripathi (sampadak)",
    year: 1918,
    form: "साखी",
    rights: "Public domain: Kabir ki rachna (15vi sadi); sankalan 1918 mein chhapa, sampadak Ramnaresh Tripathi (d. 1962) — India mein 2023 se public domain.",
  },
  {
    id: "rahim-dohe",
    page: "रहीम-कवितावली/दोहे",
    poet: { hi: "रहीम", roman: "Rahim" },
    work: { hi: "रहीम-कवितावली", roman: "Rahim-Kavitavali" },
    editor: "Surendranath Tiwari (sampadak)",
    year: 1926,
    form: "दोहा",
    rights: "Public domain: Abdul Rahim Khan-e-Khana (1556–1627) ki rachna; 1926 edition. Sampadak ke footnotes use nahi kiye gaye.",
  },
  {
    id: "rahim-sorthe",
    page: "रहीम-कवितावली/सोरठे",
    poet: { hi: "रहीम", roman: "Rahim" },
    work: { hi: "रहीम-कवितावली", roman: "Rahim-Kavitavali" },
    editor: "Surendranath Tiwari (sampadak)",
    year: 1926,
    form: "सोरठा",
    rights: "Public domain: Abdul Rahim Khan-e-Khana (1556–1627) ki rachna; 1926 edition. Sampadak ke footnotes use nahi kiye gaye.",
  },
];

const API = "https://hi.wikisource.org/w/api.php";
const DIGITS = "०१२३४५६७८९0123456789";

export function pageUrl(title, revid) {
  const base = `https://hi.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  return revid ? `https://hi.wikisource.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&oldid=${revid}` : base;
}

/** Plain text of rendered Wikisource HTML: one line per paragraph/line break, footnote list removed. */
export function htmlToText(html) {
  let t = String(html || "");
  t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  t = t.replace(/<ol class="references"[\s\S]*?<\/ol>/gi, "");
  t = t.replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, "");
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d|dd|dt)>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return t;
}

/** Normalises one verse line: footnote markers, invisible characters and spacing. */
export function cleanLine(line) {
  return String(line || "")
    .replace(/\[[०-९0-9]+\]/g, "")
    .replace(/[​‌⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,।॥])/g, "$1")
    .trim();
}

const NUMBERED = new RegExp(`॥\\s*([${DIGITS}]+)\\s*॥\\s*$`);
const looksLikeVerse = line => line.length >= 12 && line.length <= 70 && /[,।॥]$/.test(line);

/**
 * Numbered two-line couplets in page text. A couplet is the two lines that end at "॥n॥"; it is kept only
 * if nothing verse-like comes right before it (so the last two lines of a longer pad are never mistaken
 * for a standalone couplet).
 */
export function extractCouplets(text) {
  const lines = String(text || "")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);
  const out = [];
  let blockStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(NUMBERED);
    if (!match) continue;
    const block = lines.slice(blockStart, i + 1);
    blockStart = i + 1;
    if (block.length < 2) continue;
    const [first, second] = block.slice(-2);
    const before = block.length > 2 ? block[block.length - 3] : "";
    if (before && looksLikeVerse(before)) continue;
    if (!looksLikeVerse(first) || !looksLikeVerse(second) || NUMBERED.test(first)) continue;
    out.push({ number: toArabic(match[1]), lines: [first, second] });
  }
  return out;
}

function toArabic(digits) {
  return Number([...digits].map(d => DIGITS.indexOf(d) % 10).join(""));
}

async function fetchPage(title, { fetchImpl, userAgent, sleepFn }) {
  const url = `${API}?${new URLSearchParams({ action: "parse", page: title, prop: "text|revid", format: "json", formatversion: "2", disablelimitreport: "1" })}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": userAgent }, signal: AbortSignal.timeout(45000) });
      const body = await res.json();
      if (!res.ok || body.error) throw new JobError(`Wikisource error for "${title}": ${body.error?.info || res.status}`);
      return { html: body.parse.text, revid: body.parse.revid };
    } catch (error) {
      if (attempt < 2 && (isNetworkError(error) || !(error instanceof JobError))) {
        await sleepFn(3000 * (attempt + 1));
        continue;
      }
      throw error instanceof JobError ? error : new JobError(`Wikisource unreachable: ${error.message}`);
    }
  }
}

/** Fetches every source and returns its couplets with stable ids such as "rahim-dohe#26". */
export async function loadCorpus({ fetchImpl = fetch, userAgent, logger, sleepFn = sleep, sources = SOURCES } = {}) {
  const corpus = [];
  for (const source of sources) {
    try {
      const { html, revid } = await fetchPage(source.page, { fetchImpl, userAgent, sleepFn });
      const couplets = extractCouplets(htmlToText(html));
      for (const c of couplets) {
        corpus.push({ id: `${source.id}#${c.number}`, ...c, source, revid, url: pageUrl(source.page), permalink: pageUrl(source.page, revid) });
      }
      logger?.info("Source loaded", { source: source.id, couplets: couplets.length, revid });
    } catch (error) {
      logger?.warn("Source could not be loaded; skipped this run", { source: source.id, error });
    }
  }
  return corpus;
}
