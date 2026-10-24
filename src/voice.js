import crypto from "node:crypto";

import { displayLine } from "./render.js";
import { JobError } from "./util.js";

// The voice Reel's script: what is recited on each slide, at what pace, with which pauses.
//   cover   – the couplet (Devanagari, as printed), or the title (slower, stronger) and the hook
//   bhavarth – its meaning, when the post has a couplet
//   poem    – the title (if not said yet), then the poem like recited shers: a short pause inside a pair,
//             a longer one between pairs and stanzas, and the last line once more, slower
//   outro   – a cheerful like / share / follow, on its own closing card, with no music under it
// The Mac turns the post's Roman Hinglish into Devanagari first (Gemini), so the voice model says it right.

/**
 * About one draft in three is kept for the 19:00 carousel slot, so the Mac does not spend time voicing it.
 * Fixed per post id, so the choice never changes while the post waits in the queue.
 */
export const keptForCarousel = post => parseInt(crypto.createHash("sha1").update(post.id).digest("hex").slice(0, 8), 16) % 3 === 0;

/** Changes when any recited text changes, so a voice Reel is never used for an edited post. */
export function voiceTextHash(post) {
  const text = JSON.stringify([post.title, post.hook, post.bhavarth, post.poem, post.couplet?.lines || null]);
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
}

export const OUTRO = [
  { text: "अगर ये कविता आपके दिल को छू गई हो, तो लाइक और शेयर ज़रूर कीजिए!", speed: 1.12, pause: 0.3, gain: 1.5 },
  { text: "और ऐसी ही कविताओं के लिए, पेज ऑफ़ द सोल को फ़ॉलो कीजिए!", speed: 1.12, pause: 0.6, gain: 1.5 },
];

/** deva: { title, hook, bhavarth, poem[] } in Devanagari. Returns { segments, slides, outroSlide }. */
export function buildVoiceScript(post, deva) {
  const segments = [];
  const say = (slide, text, speed, pause, gain = 0) => segments.push({ slide, text, speed, pause, gain });
  let slide = 1;
  if (post.couplet) {
    const lines = post.couplet.lines.map(displayLine);
    lines.forEach((line, i) => say(slide, line, 0.8, i === lines.length - 1 ? 1.4 : 0.7));
    say(++slide, deva.bhavarth, 0.86, 1.3);
    slide++;
    say(slide, `${deva.title}।`, 0.76, 1.1, 2.5);
  } else {
    say(slide, `${deva.title}।`, 0.76, 1.1, 2.5);
    say(slide, deva.hook, 0.84, 1.4);
    slide++;
  }
  const poem = deva.poem;
  const half = poem.length >= 6 ? Math.ceil(poem.length / 2) : -1;
  poem.forEach((line, i) => {
    const last = i === poem.length - 1;
    const pause = last ? 0.9 : i + 1 === half ? 1.4 : i % 2 === 0 ? 0.55 : 1.1;
    say(slide, line, i % 2 === 0 ? 0.82 : 0.8, pause);
  });
  say(slide, poem[poem.length - 1].replace(/,\s*/, "... "), 0.72, 1.6);
  const outroSlide = slide + 1;
  for (const o of OUTRO) say(outroSlide, o.text, o.speed, o.pause, o.gain);
  return { segments, slides: slide, outroSlide };
}

const DEVA_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    hook: { type: "string" },
    bhavarth: { type: "string" },
    poem: { type: "array", items: { type: "string" } },
  },
  required: ["title", "hook", "bhavarth", "poem"],
};

/** The post's Roman Hinglish, written in Devanagari word for word (Gemini), checked line for line. */
export async function toDevanagari({ gemini, post }) {
  const prompt = [
    "Neeche diye Hinglish (Roman) text ko Devanagari lipi mein likho, taaki koi Hindi bolne wala use sahi padh sake.",
    "- Har shabd wahi rakho, koi shabd na badlo, na jodo, na hatao. Sirf lipi badlo.",
    "- Urdu shabdon mein nukta lagao (waqt → वक़्त, zindagi → ज़िंदगी, khud → ख़ुद).",
    "- Comma aur full stop wahi rakho; full stop ko । likho.",
    "- poem mein utni hi lines rakho jitni di gayi hain.",
    JSON.stringify({ title: post.title, hook: post.hook || "", bhavarth: post.bhavarth || "", poem: post.poem }, null, 2),
  ].join("\n");
  const deva = await gemini.json({ system: "Tum ek saavdhan Hindi lipyantaran (transliteration) sahayak ho.", prompt, schema: DEVA_SCHEMA, maxTokens: 2000 });
  const fields = [deva.title, ...(post.hook ? [deva.hook] : []), ...(post.bhavarth ? [deva.bhavarth] : []), ...(deva.poem || [])];
  if ((deva.poem || []).length !== post.poem.length) throw new JobError(`Devanagari poem has ${deva.poem?.length} lines, expected ${post.poem.length}`, { kind: "retryable" });
  if (fields.some(f => !/[ऀ-ॿ]/.test(f || "") || /[A-Za-z]{2,}/.test(f || ""))) throw new JobError("Devanagari text still has Roman words", { kind: "retryable" });
  return deva;
}
