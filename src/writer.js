import { MOODS, SONGS } from "./songs.js";
import { SCENES } from "./themes.js";
import { JobError, similarity } from "./util.js";

// Writes one post with Gemini: topic, an optional classical couplet chosen by id from the verified corpus,
// its Hinglish bhavarth, an original Hinglish poem, caption, hashtags and a scene. Every draft is checked
// (language, length, couplet id, repetition) and rewritten with the reasons when it fails.

const systemFor = brand => `Tum "${brand}" naam ke Instagram page ke liye likhte ho: ek Hinglish poetry aur thoughts page.
Core concept: zindagi ke un emotions ko shabd dena jinhe log mehsoos toh karte hain, lekin keh nahi paate.
Readers: log jo past, rishton, family ki zimmedariyon, kaam ke pressure, heartbreak, regret, akelepan aur personal growth se guzre hain.
Reader ko lagna chahiye: "Yeh toh meri life ki baat hai."

LANGUAGE (sabse zaroori):
- Har field natural Hinglish mein likho: Hindi/Urdu, Roman (English) alphabets mein. Jaise: "Kuch yaadein waqt ke saath dhundhli nahi hoti, bas hum unke saath jeena seekh jaate hain."
- English sentences ya English phrases bilkul nahi. "and, you, your, with, this, that, what, when, have, will, from, they, about, because, never, always" jaise English shabd mat likho.
- Roz-marra ke chhote English nouns jo Hindi bolchaal ka hissa hain (office, phone, call) theek hain, lekin kam se kam.
- Devanagari sirf tab, jab field ka description kahe. Poem, caption, bhavarth Roman Hinglish mein.

TONE: gehra, sachcha, relatable; literary lekin simple. Drama, clichés ("time heals everything", "stay strong"), manipulation ya dard ko exploit karna nahi.
POEM: 4–10 lines, har line ka apna kaam ho, asli zindagi ki chhoti, dekhi hui details (chai, phone, purani photo, office ki late shaam). Aakhri line reader ko rukne par majboor kare. Har line 46 characters se chhoti.
CAPTION: chhota aur matlab bhara, 25–60 shabd: 2–3 vaakya jo poem ka gehra matlab kholein aur reader ko apni life se jodein (poem dohraana nahi), aakhir mein ek sochne wala sawaal. 2–4 emojis jo bhaav se mel khayein (jaise 🤍 🌙 ☕ 🍂 ✨ 🕊️ 💭 🌧️), vaakyon ke beech ya aakhir mein; har line par nahi. Poem mein emojis nahi.
AUTHENTICITY: classical doha sirf diye gaye candidates mein se id se chuno, apni yaad se kabhi nahi. Doha tabhi lo jab uska seedha arth (upma nahi) topic se aam reader ko turant jude; warna coupletId "" rakho. Bina doha ki mool rachna bilkul theek hai. Apni poem ko kisi kavi ke naam se kabhi mat jodo.`;

const SCHEMA = {
  type: "object",
  properties: {
    topic: { type: "string", description: "Aaj ka emotional topic, Hinglish, ek line" },
    realLife: { type: "string", description: "Kis real-life anubhav ki baat hai, Hinglish, 1-2 lines" },
    audienceConnect: { type: "string", description: "Reader isse kaise judega, Hinglish, 1 line" },
    coupletId: { type: "string", description: "Candidate couplet ki id, ya \"\" agar koi sach mein fit nahi" },
    bhavarth: { type: "string", description: "Sirf chune gaye doha ka saral Hinglish arth (2-3 lines), apne topic par apply kiye bina. coupletId khaali ho toh \"\"" },
    title: { type: "string", description: "Poem ka chhota Hinglish title, 2-5 shabd" },
    hook: { type: "string", description: "Cover image ke liye ek dil chhoo lene wali Hinglish line, 60-110 characters" },
    poem: { type: "array", items: { type: "string" }, description: "4-10 Hinglish lines, har line 46 characters se kam" },
    caption: { type: "string", description: "25-60 shabd ka chhota, matlab bhara Hinglish caption, 2-4 emojis, ek sawaal ke saath khatam" },
    hashtags: { type: "array", items: { type: "string" }, description: "3-6 hashtags, topic ke hisaab se, Hindi/Hinglish shabdon se bane" },
    scene: { type: "string", description: "Diye gaye scenes mein se ek key" },
    mood: { type: "string", enum: MOODS, description: "Poem ka mood (Reel ka music isi se chuna jaata hai)" },
    songId: { type: "string", description: "Di gayi Bollywood list mein se us gaane ki id jo is poem ke bhaav se sabse mel khaye" },
  },
  required: ["topic", "realLife", "audienceConnect", "coupletId", "bhavarth", "title", "hook", "poem", "caption", "hashtags", "scene", "mood", "songId"],
};

// English function words that never occur in Hinglish. Homographs of Hindi words are left out:
// the (thhe), is, to, in, me, do, so, us, has (hasna), had (hadd), are (arre).
const ENGLISH = new Set(
  "and you your yours with this that what when where which who whom whose have will would should could from they them their theirs about into been were because never always every our we its it's isn't don't can't won't doesn't of for but not can just only how why was being does did than then there these those very really something anything everything nothing someone everyone".split(" ")
);

export function englishWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/#\S+/g, " ")
    .split(/[^a-z']+/)
    .filter(word => ENGLISH.has(word));
}

const wordCount = text => String(text || "").split(/\s+/).filter(Boolean).length;
const DEVANAGARI = /[ऀ-ॿ]/;

/** Problems with a draft, in Hinglish-neutral plain words the model can act on. Empty = publishable. */
export function reviewDraft(draft, { candidates, category, recent = [] }) {
  const problems = [];
  const fields = { topic: draft.topic, hook: draft.hook, title: draft.title, bhavarth: draft.bhavarth, caption: draft.caption, poem: (draft.poem || []).join("\n") };
  for (const [name, value] of Object.entries(fields)) {
    const english = englishWords(value);
    if (english.length >= 2) problems.push(`${name} mein English shabd hain (${[...new Set(english)].join(", ")}). Poora Hinglish likho.`);
    if (DEVANAGARI.test(value || "")) problems.push(`${name} Roman Hinglish mein likho, Devanagari mein nahi.`);
  }
  const poem = draft.poem || [];
  if (poem.length < 4 || poem.length > 10) problems.push(`Poem mein ${poem.length} lines hain; 4-10 chahiye.`);
  const long = poem.filter(line => line.length > 48);
  if (long.length) problems.push(`Ye lines 46 characters se lambi hain, chhoti karo: ${long.map(l => `"${l}"`).join("; ")}`);
  const words = wordCount(draft.caption);
  if (words < 20 || words > 70) problems.push(`Caption ${words} shabd ka hai; 25-60 chahiye (chhota aur matlab bhara).`);
  const captionText = String(draft.caption || "").trim();
  if (!/\?[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]*$/u.test(captionText)) problems.push("Caption ek sawaal (?) par khatam karo (emoji uske baad aa sakta hai).");
  const emojis = captionText.match(/\p{Extended_Pictographic}/gu) || [];
  if (emojis.length < 1 || emojis.length > 5) problems.push(`Caption mein 2-4 emojis do (abhi ${emojis.length}).`);
  if (/\p{Extended_Pictographic}/u.test(fields.poem)) problems.push("Poem se emojis hata do.");
  const hook = String(draft.hook || "");
  if (hook.length < 30 || hook.length > 130) problems.push("Hook 60-110 characters ka rakho.");
  const tags = draft.hashtags || [];
  if (tags.length < 3 || tags.length > 6 || tags.some(tag => !/^#[\p{L}\p{N}_]+$/u.test(tag))) problems.push("3-6 sahi hashtags do (#Shabd, bina space ke).");
  if (!category.scenes.includes(draft.scene)) problems.push(`scene in mein se ek ho: ${category.scenes.join(", ")}.`);
  if (!MOODS.includes(draft.mood)) problems.push(`mood in mein se ek ho: ${MOODS.join(", ")}.`);
  if (!SONGS.some(s => s.id === draft.songId)) problems.push(`songId "${draft.songId}" list mein nahi hai. Sirf di gayi id do.`);
  if (draft.coupletId) {
    if (!candidates.some(c => c.id === draft.coupletId)) problems.push(`coupletId "${draft.coupletId}" candidates mein nahi hai. Sirf di gayi id ya "" do.`);
    if (wordCount(draft.bhavarth) < 8) problems.push("Doha chuna hai toh uska bhavarth 2-3 lines mein do.");
  } else if (draft.bhavarth) {
    draft.bhavarth = "";
  }
  for (const post of recent) {
    if (similarity(fields.poem, (post.poem || []).join("\n")) > 0.45) problems.push(`Poem ek purani post ("${post.title}") se bahut milti hai. Naya angle lo.`);
    if (similarity(draft.caption, post.caption) > 0.45) problems.push(`Caption purani post ("${post.title}") se bahut milta hai.`);
  }
  return problems;
}

function describeSongs(recent) {
  const used = new Set(recent.slice(0, 15).map(p => p.song?.id).filter(Boolean));
  return SONGS.filter(s => !used.has(s.id)).map(s => `${s.id} | "${s.title}" — ${s.film} (${s.year}) | ${s.moods.join(", ")}`).join("\n");
}

function describeCandidates(candidates) {
  return candidates.map(c => `${c.id} | ${c.source.poet.roman} | ${c.lines.join(" / ")}`).join("\n");
}

export async function writePost({ gemini, brand = "page_of_the__soul", category, candidates, recent, runTopics = [], maxAttempts = 3, logger }) {
  const avoid = [...recent.slice(0, 20).map(p => p.topic), ...runTopics].filter(Boolean);
  const scenes = category.scenes.map(key => `${key}: ${SCENES[key]}`).join("\n");
  let feedback = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = [
      `Category: ${category.name}`,
      `Is category ke kuch topics (inme se ek chuno ya inke paas ka koi sachcha angle): ${category.topics.join("; ")}`,
      avoid.length ? `In topics ko dobara mat lo (haal hi mein ho chuke hain):\n- ${avoid.join("\n- ")}` : "",
      `Scenes (ek key chuno jo mood se mile):\n${scenes}`,
      `Mood (${MOODS.join(", ")}) chuno, phir is list se ek Bollywood gaana jo poem ke bhaav se sabse mel khaye (sirf id do; apni yaad se koi gaana nahi):\n${describeSongs(recent)}`,
      candidates.length
        ? `Verified classical couplets (Hindi Wikisource ke public-domain editions se). Agar koi topic se gehrai se jude toh uski id do, warna "":\n${describeCandidates(candidates)}`
        : 'Is baar koi classical couplet nahi diya gaya: coupletId "" rakho.',
      feedback.length ? `Pichhla draft in wajahon se reject hua, theek karke dobara likho:\n- ${feedback.join("\n- ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const draft = await gemini.json({ system: systemFor(brand), prompt, schema: SCHEMA, effort: "high", maxTokens: 3000 });
    draft.poem = (draft.poem || []).map(line => String(line).trim()).filter(Boolean);
    draft.hashtags = [...new Set((draft.hashtags || []).map(tag => `#${String(tag).replace(/^#+/, "").replace(/\s+/g, "")}`))];
    const problems = reviewDraft(draft, { candidates, category, recent });
    if (!problems.length) {
      const final = await polish({ gemini, brand, draft, candidates, category, recent, logger });
      const couplet = final.coupletId ? candidates.find(c => c.id === final.coupletId) : null;
      return { ...final, couplet, attempts: attempt };
    }
    logger?.info("Draft rejected, rewriting", { category: category.id, attempt, problems });
    feedback = problems;
  }
  throw new JobError(`No acceptable draft for "${category.name}" after ${maxAttempts} attempts: ${feedback.join(" | ")}`, { kind: "retryable" });
}

const EDIT_SCHEMA = {
  type: "object",
  properties: {
    coupletFit: { type: "integer", description: "1-5: doha ka asli arth is poem ke emotion se kitna sachcha judta hai (5 = gehra, 1 = zabardasti). Doha na ho toh 0." },
    coupletFitReason: { type: "string" },
    editNotes: { type: "array", items: { type: "string" }, description: "Kya badla, chhote points mein" },
    ...Object.fromEntries(["title", "hook", "poem", "bhavarth", "caption", "hashtags"].map(key => [key, SCHEMA.properties[key]])),
  },
  required: ["coupletFit", "coupletFitReason", "editNotes", "title", "hook", "poem", "bhavarth", "caption", "hashtags"],
};

/**
 * Editor pass: an independent read of the draft that fixes Hinglish typos, punctuation and title/hook/poem
 * mismatches, and scores how honestly the couplet fits. A weak fit (< 4) drops the couplet: the post then
 * goes out as original writing only. If the edited version fails the checks, the accepted draft is kept.
 */
async function polish({ gemini, brand, draft, candidates, category, recent, logger }) {
  const couplet = draft.coupletId ? candidates.find(c => c.id === draft.coupletId) : null;
  const prompt = [
    "Tum is page ke editor ho. Neeche ka draft dhyaan se padho aur behtar karo, bina uska bhaav badle:",
    "- Hinglish spelling ki galtiyan aur typos theek karo (aam spelling: nahi, hai, mein, kya, toh, bhi).",
    "- Poem lines mein natural punctuation (comma, full stop) do; har line 46 characters se chhoti rahe; 4-10 lines.",
    "- Title aur hook poem ki asli baat se mel khayein; koi aisi cheez na ho jo poem mein hai hi nahi.",
    "- Bhavarth sirf doha ka arth bataye, topic par apply na kare. Doha ke shabdon se aage ka daava mat karo.",
    "- Caption chhota aur matlab bhara: 25-60 shabd, 2-4 bhaav se milte emojis, ek sawaal par khatam, English sentences nahi.",
    "- Har line ki grammar aur bolchaal jaanch lo: aisi ho jaise koi sach mein bolta hai. Zabardasti ki tukbandi (rhyme) se behtar hai seedhi, sachchi line.",
    "- coupletFit sakhti se do: 4-5 sirf tab jab ek aam reader bina samjhaye doha aur poem ka rishta mehsoos kare. Agar doha sirf ek shabd ya door ki upma se juda hai, ya uska arth aam reader ko ajeeb lagega, toh 3 ya kam.",
    couplet ? `Doha (${couplet.source.poet.roman}): ${couplet.lines.join(" / ")}` : "Is draft mein koi doha nahi hai: coupletFit 0, bhavarth \"\".",
    `Draft:\n${JSON.stringify({ title: draft.title, hook: draft.hook, poem: draft.poem, bhavarth: draft.bhavarth, caption: draft.caption, hashtags: draft.hashtags }, null, 2)}`,
  ].join("\n");
  let edited;
  try {
    edited = await gemini.json({ system: systemFor(brand), prompt, schema: EDIT_SCHEMA, effort: "high", maxTokens: 3000 });
  } catch (error) {
    logger?.warn("Editor pass failed; keeping the accepted draft", { error });
    return draft;
  }
  const dropCouplet = couplet && Number(edited.coupletFit) < 4;
  const candidate = {
    ...draft,
    ...Object.fromEntries(["title", "hook", "bhavarth", "caption"].map(key => [key, String(edited[key] ?? draft[key]).trim()])),
    poem: (edited.poem || draft.poem).map(line => String(line).trim()).filter(Boolean),
    hashtags: [...new Set((edited.hashtags || draft.hashtags).map(tag => `#${String(tag).replace(/^#+/, "").replace(/\s+/g, "")}`))],
    ...(dropCouplet ? { coupletId: "", bhavarth: "" } : {}),
  };
  const problems = reviewDraft(candidate, { candidates, category, recent });
  logger?.info("Editor pass", { coupletFit: edited.coupletFit, reason: edited.coupletFitReason, droppedCouplet: Boolean(dropCouplet), notes: edited.editNotes, kept: problems.length ? "original" : "edited", problems });
  if (!problems.length) return candidate;
  return dropCouplet ? { ...draft, coupletId: "", bhavarth: "" } : draft;
}
