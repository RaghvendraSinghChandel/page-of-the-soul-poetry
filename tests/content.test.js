import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { createHistory } from "../src/history.js";
import { fullCaption, publishNext, tick } from "../src/job.js";
import { reelArgs, slideDurations } from "../src/reel.js";
import { SONGS, songLine } from "../src/songs.js";
import { buildVoiceScript, keptForCarousel, voiceTextHash } from "../src/voice.js";
import { silentLogger } from "../src/logger.js";
import { displayLine, formPhrase } from "../src/render.js";
import { planSlots } from "../src/slots.js";
import { cleanLine, extractCouplets } from "../src/sources.js";
import { CATEGORIES, pickCategories } from "../src/themes.js";
import { englishWords, reviewDraft } from "../src/writer.js";

test("extracts numbered two-line couplets and skips the tail of longer pads", () => {
  const text = [
    "साखी",
    "गुरु गोविंद दोऊ खड़े काके लागू पाँय।",
    "बलिहारी गुरु आपने जिन गोविंद दिया बताय॥१॥",
    "भावार्थ की लंबी पंक्ति जो गद्य है और छंद नहीं",
    "आछे दिन पाछे गये गुरु से किया न हेत।",
    "अब पछतावा क्या करै चिड़ियाँ चुग गई खेत॥१८॥",
    "मोको कहाँ ढूँढ़े बन्दे मैं तो तेरे पास में।",
    "ना मैं देवल ना मैं मसजिद ना काबे कैलास में।",
    "कहैं कबीर सुनो भाई साधो सब स्वाँसों की स्वाँस में॥१९०॥",
  ].join("\n");
  const couplets = extractCouplets(text);
  assert.deepEqual(couplets.map(c => c.number), [1, 18]);
  assert.equal(couplets[1].lines[1], "अब पछतावा क्या करै चिड़ियाँ चुग गई खेत॥१८॥");
});

test("cleans footnote markers and shows the couplet without its verse number", () => {
  assert.equal(cleanLine("बिपति कसौटी[२२] जे कसे, तेई साँचे मीत॥२६॥"), "बिपति कसौटी जे कसे, तेई साँचे मीत॥२६॥");
  assert.equal(displayLine("तेई साँचे मीत॥२६॥"), "तेई साँचे मीत॥");
  assert.equal(formPhrase({ form: "साखी", poet: { roman: "Kabir" } }), "Kabir ki sakhi");
  assert.equal(formPhrase({ form: "दोहा", poet: { roman: "Rahim" } }), "Rahim ka doha");
});

test("English detector ignores Hindi homographs", () => {
  assert.deepEqual(englishWords("Hum khush the, us din ki baat hai, woh has raha tha"), []);
  assert.deepEqual(englishWords("This is what you never said"), ["this", "what", "you", "never"]);
});

const category = CATEGORIES.find(c => c.id === "past");
const good = {
  topic: "Purani yaadein",
  hook: "Kuch yaadein waqt ke saath dhundhli nahi hoti, bas hum unke saath jeena seekh jaate hain.",
  title: "Purani Khidki",
  coupletId: "",
  bhavarth: "",
  poem: ["Main roz shaam khidki par baitha raha,", "jahan se suraj doobte dekha tha.", "Har baar socha, kaash woh ruk jaata,", "aur raat bhar taare intezaar karte rahe."],
  caption: Array(30).fill("shabd").join(" ") + " 🌙 kya aapne bhi kabhi aisa mehsoos kiya? 🤍",
  hashtags: ["#Yaadein", "#HinglishPoetry", "#Zindagi"],
  scene: "dusk_window",
  mood: "udaas",
  songId: "kahin-door",
};

test("a clean Hinglish draft passes review", () => {
  assert.deepEqual(reviewDraft({ ...good }, { candidates: [], category }), []);
});

test("review rejects English, Devanagari poems, unknown couplets and long lines", () => {
  const problems = reviewDraft(
    { ...good, caption: `${good.caption} This is what you never said?`, poem: [...good.poem, "यह देवनागरी है"], coupletId: "kabir-kk#9999", bhavarth: "kuch arth hai jo kaafi lamba aur saaf likha gaya hai yahan" },
    { candidates: [{ id: "kabir-kk#1" }], category }
  );
  assert.ok(problems.some(p => p.startsWith("caption mein English")));
  assert.ok(problems.some(p => p.startsWith("poem Roman Hinglish")));
  assert.ok(problems.some(p => p.includes("candidates mein nahi")));
});

test("categories rotate: least recently used first, never twice in one run", () => {
  const recent = [{ category: "past" }, { category: "love" }, { category: "family" }];
  const picked = pickCategories(3, recent, () => 0.5).map(c => c.id);
  assert.equal(new Set(picked).size, 3);
  assert.ok(!picked.includes("past") && !picked.includes("love") && !picked.includes("family"));
});

test("caption credits the couplet and the original writing in Hinglish", () => {
  const caption = fullCaption({ caption: "Kuch baatein?", hashtags: ["#Yaadein"], couplet: { form: "साखी", poetRoman: "Kabir", workRoman: "Kavita-Kaumudi, Bhag 1", year: 1918, number: 18 } }, "page_of_the__soul");
  assert.match(caption, /sakhi: Kabir · Kavita-Kaumudi, Bhag 1 \(1918\), 18/);
  assert.match(caption, /Kavita: mool rachna — page_of_the__soul/);
});

test("publish-next does nothing while publishing is switched off", async () => {
  const config = loadConfig({ GEMINI_API_KEY: "x", PUBLISH_TO_INSTAGRAM: "false" });
  assert.equal(await publishNext({ config, logger: silentLogger, deps: { instagram: {} } }), null);
});

test("publish-next posts the oldest draft as a carousel and records it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echoes-"));
  const history = createHistory({ stateDir: dir });
  history.add({ id: "d1", status: "draft", caption: "Pehli post?", hashtags: ["#Yaadein"], couplet: null, slides: ["a.jpg", "b.jpg"] });
  history.add({ id: "d2", status: "draft", caption: "Doosri post?", hashtags: [], couplet: null, slides: ["c.jpg"] });
  const calls = [];
  const instagram = {
    checkAccount: async () => ({ username: "echoes" }),
    publishingLimit: async () => ({ used: 0, total: 50 }),
    createCarouselItem: async url => (calls.push(["item", url]), `item-${url}`),
    createCarousel: async (children, caption) => (calls.push(["carousel", children, caption]), "parent"),
    waitForContainer: async () => "FINISHED",
    publishContainer: async id => (calls.push(["publish", id]), "media-1"),
    mediaInfo: async () => ({ permalink: "https://instagram.com/p/x", timestamp: "2026-10-24T03:30:00Z" }),
  };
  const mediaHost = { upload: async file => ({ url: `https://cdn/${file}`, ref: file }), remove: async () => {} };
  const config = loadConfig({ GEMINI_API_KEY: "x", PUBLISH_TO_INSTAGRAM: "true", REELS_ENABLED: "false", INSTAGRAM_USER_ID_POETRY: "1", INSTAGRAM_ACCESS_TOKEN_POETRY: "t" });
  const done = await publishNext({ config, logger: silentLogger, deps: { history, instagram, mediaHost, keptForCarousel: () => false, validateMedia: async () => ({}) } });
  assert.equal(done.status, "published");
  assert.equal(history.load().find(p => p.id === "d2").status, "draft");
  assert.deepEqual(calls.find(c => c[0] === "carousel")[1], ["item-https://cdn/a.jpg", "item-https://cdn/b.jpg"]);
  assert.match(calls.find(c => c[0] === "carousel")[2], /Pehli post\?\n\nIs kavita ke saath suniye: "[^"]+" — .+ \(\d{4}\)\n\nMool rachna — page_of_the__soul\n\n#Yaadein/);
});

test("reads only the _POETRY account settings, never the Daily Fact Check ones", () => {
  assert.equal(loadConfig({ INSTAGRAM_ACCESS_TOKEN_POETRY: "poetry", INSTAGRAM_ACCESS_TOKEN: "factcheck" }).instagramToken, "poetry");
  assert.equal(loadConfig({ INSTAGRAM_ACCESS_TOKEN: "factcheck" }).instagramToken, "");
  assert.equal(loadConfig({ INSTAGRAM_USER_ID_POETRY: "2", INSTAGRAM_USER_ID: "1" }).instagramUserId, "2");
});

test("token refresh rewrites only the poetry token line of .env and records the expiry", async () => {
  const { refreshToken, daysLeft } = await import("../src/token.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echoes-token-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, "INSTAGRAM_ACCESS_TOKEN=factcheck\nINSTAGRAM_ACCESS_TOKEN_POETRY=old\nBRAND_NAME=x\n", { mode: 0o600 });
  const config = loadConfig({ INSTAGRAM_ACCESS_TOKEN_POETRY: "old", STATE_DIR: dir });
  const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: "new", expires_in: 5184000 }) });
  await refreshToken({ config, logger: silentLogger, envFile, fetchImpl });
  assert.equal(fs.readFileSync(envFile, "utf8"), "INSTAGRAM_ACCESS_TOKEN=factcheck\nINSTAGRAM_ACCESS_TOKEN_POETRY=new\nBRAND_NAME=x\n");
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  assert.ok(Math.round(daysLeft(config)) === 60);
});

test("slots open 20 minutes early, stay open 2 hours, and are done once published", () => {
  const plan = (iso, state = {}) =>
    planSlots({ now: new Date(iso), timeZone: "Asia/Kolkata", prepareAheadMinutes: 20, runGraceMinutes: 120, maxAttempts: 3, getState: key => state[key] }).map(s => `${s.time}:${s.action}`);
  assert.deepEqual(plan("2026-10-25T12:05:00Z"), ["18:00:wait", "19:00:wait", "23:00:wait"]); // 17:35 IST
  assert.deepEqual(plan("2026-10-25T12:15:00Z"), ["18:00:run", "19:00:wait", "23:00:wait"]); // 17:45 IST
  assert.deepEqual(plan("2026-10-25T13:15:00Z", { "2026-10-25@18:00": { status: "published" } }), ["18:00:done", "19:00:run", "23:00:wait"]); // 18:45 IST
  assert.deepEqual(plan("2026-10-25T17:15:00Z", { "2026-10-25@19:00": { status: "published" } }), ["18:00:missed", "19:00:done", "23:00:run"]); // 22:45 IST
});

test("tick publishes the due slot exactly at its time, once, and drafts the next posts when none are left", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echoes-"));
  const history = createHistory({ stateDir: dir });
  history.add({ id: "d1", status: "draft", caption: "Pehli post?", hashtags: [], couplet: null, slides: ["a.jpg"] });
  history.updateSlot("2026-10-25@18:00", { status: "published" }); // the earlier Reel slot is done
  const at = Date.parse("2026-10-25T13:30:00Z"); // 19:00 IST (carousel slot)
  let clock = at - 10 * 60000;
  const slept = [];
  const instagram = {
    checkAccount: async () => ({}),
    publishingLimit: async () => ({ used: 0, total: 50 }),
    createCarouselItem: async url => `item-${url}`,
    createCarousel: async () => "parent",
    waitForContainer: async () => "FINISHED",
    publishContainer: async () => (assert.ok(clock >= at, "published before the slot time"), "media-1"),
    mediaInfo: async () => ({ permalink: "https://instagram.com/p/x", timestamp: "2026-10-25T12:30:01Z" }),
  };
  const deps = {
    history,
    instagram,
    mediaHost: { upload: async file => ({ url: `https://cdn/${file}`, ref: file }), remove: async () => {} },
    validateMedia: async () => ({}),
    sleepFn: async ms => (slept.push(ms), (clock += ms)),
    corpus: [],
  };
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const config = loadConfig({ GEMINI_API_KEY: "x", PUBLISH_TO_INSTAGRAM: "true", REELS_ENABLED: "false", INSTAGRAM_USER_ID_POETRY: "1", INSTAGRAM_ACCESS_TOKEN_POETRY: "t", STATE_DIR: dir });
    const drafted = [];
    const generateStub = { browser: { close: async () => {} }, gemini: { json: async () => (drafted.push(1), Promise.reject(new Error("no gemini in tests"))) } };
    const { ran } = await tick({ config, logger: silentLogger, now: () => new Date(clock), deps: { ...deps, ...generateStub } });
    assert.deepEqual(ran, [{ key: "2026-10-25@19:00", status: "published" }]);
    assert.equal(slept[0], 10 * 60000);
    assert.equal(history.slot("2026-10-25@19:00").post, "d1");
    assert.equal(history.load()[0].slot, "2026-10-25@19:00");
    assert.ok(drafted.length > 0, "tried to draft the next posts");
    const again = await tick({ config, logger: silentLogger, now: () => new Date(clock), deps });
    assert.deepEqual(again.ran, []);
  } finally {
    Date.now = realNow;
  }
});

test("Reel slots post a Mac-voiced draft as a Reel, the post slot a carousel, and a Reel slot without a voice Reel falls back to a carousel", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echoes-"));
  const history = createHistory({ stateDir: dir });
  const base = { status: "draft", category: "love", hashtags: ["#Yaadein"], couplet: null, poem: ["a", "b", "c", "d"], slides: ["a.jpg", "b.jpg"] };
  for (const id of ["d1", "d2", "d3"]) history.add({ ...base, id, caption: `Post ${id} 🤍 kya?` });
  const created = [];
  const instagram = {
    checkAccount: async () => ({}),
    publishingLimit: async () => ({ used: 0, total: 50 }),
    createCarouselItem: async url => `item-${url}`,
    createCarousel: async (children, caption) => (created.push(["carousel", caption]), `carousel-${created.length}`),
    createReel: async ({ videoUrl, caption, audioName }) => (created.push(["reel", caption, videoUrl, audioName]), `reel-${created.length}`),
    waitForContainer: async () => "FINISHED",
    publishContainer: async id => `media-${id}`,
    mediaInfo: async id => ({ permalink: `https://instagram.com/p/${id}`, timestamp: "2026-10-25T12:30:00Z" }),
  };
  const voiced = new Set(["d2"]); // the Mac has voiced d2 only
  const voiceReels = { find: async post => (voiced.has(post.id) ? { url: `https://raw/sha/voice/${post.id}/reel.mp4`, meta: {} } : null) };
  const deps = { history, instagram, voiceReels, keptForCarousel: () => false, mediaHost: { upload: async file => ({ url: `https://cdn/${file}`, ref: file }), remove: async () => {} }, validateMedia: async () => ({}) };
  const config = loadConfig({ GEMINI_API_KEY: "x", PUBLISH_TO_INSTAGRAM: "true", INSTAGRAM_USER_ID_POETRY: "1", INSTAGRAM_ACCESS_TOKEN_POETRY: "t" });

  const reel = await publishNext({ config, logger: silentLogger, format: "reel", deps });
  assert.equal(reel.id, "d2");
  assert.equal(reel.format, "reel");
  const [, reelCaption, videoUrl, audio] = created[0];
  assert.match(reelCaption, /Is kavita ke saath suniye: ".+" — .+ \(\d{4}\)/);
  assert.match(reelCaption, /Awaaz: page_of_the__soul ki apni awaaz par AI \(IndicF5\) se bani/);
  assert.equal(videoUrl, "https://raw/sha/voice/d2/reel.mp4");
  assert.equal(audio, "Kavita path — page_of_the__soul");

  const post = await publishNext({ config, logger: silentLogger, format: "carousel", deps });
  assert.equal(post.id, "d1");
  assert.equal(post.format, "carousel");
  assert.doesNotMatch(created[1][1], /Awaaz:/);

  // no voiced draft left: the Reel slot still posts (as a carousel)
  const fallback = await publishNext({ config, logger: silentLogger, format: "reel", deps });
  assert.equal(fallback.id, "d3");
  assert.equal(fallback.format, "carousel");
  assert.equal(created.length, 3);
});

test("voice script: cover, poem as recited pairs with the last line once more, then a cheerful outro", () => {
  const post = { id: "x", title: "Badalte Rishte", hook: "Kuch dost badal jaate hain.", poem: ["a,", "b.", "c,", "d.", "e,", "f."], couplet: null };
  const deva = { title: "बदलते रिश्ते", hook: "कुछ दोस्त बदल जाते हैं।", bhavarth: "", poem: ["क,", "ख।", "ग,", "घ।", "च, छ,", "ज।"] };
  const { segments, slides, outroSlide } = buildVoiceScript(post, deva);
  assert.equal(slides, 2);
  assert.equal(outroSlide, 3);
  assert.deepEqual(segments.filter(s => s.slide === 1).map(s => s.text), ["बदलते रिश्ते।", "कुछ दोस्त बदल जाते हैं।"]);
  const poem = segments.filter(s => s.slide === 2);
  assert.deepEqual(poem.map(s => s.pause), [0.55, 1.1, 1.4, 1.1, 0.55, 0.9, 1.6]);
  assert.equal(poem.at(-1).text, "ज।");
  assert.ok(poem.at(-1).speed < poem.at(-2).speed);
  assert.match(segments.filter(s => s.slide === 3).map(s => s.text).join(" "), /लाइक और शेयर.*फ़ॉलो/);
  // a couplet post: couplet on the cover, its bhavarth, then title + poem
  const withCouplet = buildVoiceScript({ ...post, couplet: { lines: ["रहिमन धागा प्रेम का॥१॥", "मत तोड़ो॥"] }, bhavarth: "x" }, { ...deva, bhavarth: "भावार्थ" });
  assert.equal(withCouplet.slides, 3);
  assert.equal(withCouplet.segments[0].text, "रहिमन धागा प्रेम का॥");
  assert.equal(withCouplet.segments.find(s => s.slide === 2).text, "भावार्थ");
  assert.notEqual(voiceTextHash(post), voiceTextHash({ ...post, poem: [...post.poem, "g"] }));
});

test("captions: song suggestions come from the checked list, by name only", () => {
  assert.equal(songLine(SONGS[0]), 'Is kavita ke saath suniye: "Kahin Door Jab Din Dhal Jaaye" — Anand (1971)');
  assert.equal(new Set(SONGS.map(s => s.id)).size, SONGS.length);
});

test("reel timing: slides stay long enough to read and cross-fade", () => {
  assert.deepEqual(slideDurations({ slides: [1, 2, 3], poem: Array(8) }), [6, 8, 12.2]);
  assert.deepEqual(slideDurations({ slides: [1, 2], poem: Array(4) }), [6, 9]);
  const { total, args } = reelArgs({ slides: ["a.jpg", "b.jpg"], durations: [6, 9], music: "m.m4a", file: "r.mp4" });
  assert.equal(total, 14.3);
  assert.match(args.join(" "), /xfade=transition=fade:duration=0.7:offset=5.30/);
});

test("about a third of the drafts are kept for the carousel slot, fixed per post", () => {
  const ids = Array.from({ length: 300 }, (_, i) => ({ id: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}-${i}` }));
  const kept = ids.filter(keptForCarousel).length;
  assert.ok(kept > 70 && kept < 130, String(kept));
  assert.equal(keptForCarousel(ids[5]), keptForCarousel({ ...ids[5] }));
});
