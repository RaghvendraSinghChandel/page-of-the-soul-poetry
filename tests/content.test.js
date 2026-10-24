import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { createHistory } from "../src/history.js";
import { fullCaption, publishNext, publishReel, tick } from "../src/job.js";
import { composeMusic, musicPrompt } from "../src/music.js";
import { reelArgs, slideDurations } from "../src/reel.js";
import { SONGS, songLine } from "../src/songs.js";
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
  caption: Array(60).fill("shabd").join(" ") + " kya aapne bhi kabhi aisa mehsoos kiya?",
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
  const done = await publishNext({ config, logger: silentLogger, deps: { history, instagram, mediaHost, validateMedia: async () => ({}) } });
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
  assert.deepEqual(plan("2026-10-25T12:20:00Z"), ["18:15:wait", "23:00:wait"]); // 17:50 IST
  assert.deepEqual(plan("2026-10-25T12:30:00Z"), ["18:15:run", "23:00:wait"]); // 18:00 IST
  assert.deepEqual(plan("2026-10-25T17:15:00Z", { "2026-10-25@18:15": { status: "published" } }), ["18:15:done", "23:00:run"]); // 22:45 IST
  assert.deepEqual(plan("2026-10-25T17:15:00Z"), ["18:15:missed", "23:00:run"]);
});

test("tick publishes the due slot exactly at its time, once, and drafts the next posts when none are left", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echoes-"));
  const history = createHistory({ stateDir: dir });
  history.add({ id: "d1", status: "draft", caption: "Pehli post?", hashtags: [], couplet: null, slides: ["a.jpg"] });
  const at = Date.parse("2026-10-25T12:45:00Z"); // 18:15 IST
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
    assert.deepEqual(ran, [{ key: "2026-10-25@18:15", status: "published" }]);
    assert.equal(slept[0], 10 * 60000);
    assert.equal(history.slot("2026-10-25@18:15").post, "d1");
    assert.equal(history.load()[0].slot, "2026-10-25@18:15");
    assert.ok(drafted.length > 0, "tried to draft the next posts");
    const again = await tick({ config, logger: silentLogger, now: () => new Date(clock), deps });
    assert.deepEqual(again.ran, []);
  } finally {
    Date.now = realNow;
  }
});

test("each post goes out as a carousel and then as a Reel whose caption credits the music", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echoes-"));
  const history = createHistory({ stateDir: dir });
  history.add({ id: "d1", status: "draft", category: "love", caption: "Pehli post?", hashtags: ["#Yaadein"], couplet: null, poem: ["a", "b", "c", "d"], slides: [path.join(dir, "o/slide-1.jpg"), path.join(dir, "o/slide-2.jpg")] });
  const created = [];
  const published = [];
  const instagram = {
    checkAccount: async () => ({}),
    publishingLimit: async () => ({ used: 0, total: 50 }),
    createCarouselItem: async url => `item-${url}`,
    createCarousel: async (children, caption) => (created.push(["carousel", caption]), "carousel-1"),
    createReel: async ({ videoUrl, caption, audioName }) => (created.push(["reel", caption, videoUrl, audioName]), "reel-1"),
    waitForContainer: async () => "FINISHED",
    publishContainer: async id => (published.push(id), `media-${id}`),
    mediaInfo: async id => ({ permalink: `https://instagram.com/p/${id}`, timestamp: "2026-10-25T12:45:00Z" }),
  };
  const renderReel = async ({ file, music }) => (assert.ok(fs.existsSync(music), "music file exists"), fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, "mp4"), { file, seconds: 15 });
  const composeMusic = async ({ mood, dir }) => (fs.mkdirSync(dir, { recursive: true }), fs.writeFileSync(path.join(dir, "music.mp3"), "mp3"), { file: path.join(dir, "music.mp3"), model: "lyria-test", mood });
  const deps = {
    history,
    instagram,
    renderReel,
    composeMusic,
    mediaHost: { upload: async file => ({ url: `https://cdn/${file}`, ref: file }), remove: async () => {} },
    videoHost: { available: true, upload: async (file, name) => ({ url: `https://raw/${name}/reel.mp4` }) },
    validateMedia: async () => ({}),
  };
  const config = loadConfig({ GEMINI_API_KEY: "x", PUBLISH_TO_INSTAGRAM: "true", INSTAGRAM_USER_ID_POETRY: "1", INSTAGRAM_ACCESS_TOKEN_POETRY: "t" });
  const done = await publishNext({ config, logger: silentLogger, deps });
  assert.deepEqual(published, ["carousel-1", "reel-1"]);
  assert.equal(done.status, "published");
  assert.equal(done.reel.status, "published");
  assert.equal(done.reel.permalink, "https://instagram.com/p/media-reel-1");
  assert.equal(done.mood, "pyaar");
  const [, carouselCaption] = created.find(c => c[0] === "carousel");
  const [, reelCaption, videoUrl, audio] = created.find(c => c[0] === "reel");
  assert.match(carouselCaption, /Is kavita ke saath suniye: ".+" — .+ \(\d{4}\)/);
  assert.doesNotMatch(carouselCaption, /Dhun:/);
  assert.match(reelCaption, /Dhun: page_of_the__soul ke liye AI \(Google Lyria\) se banayi gayi/);
  assert.equal(done.reel.music.mood, "pyaar");
  assert.equal(videoUrl, "https://raw/d1/reel.mp4");
  assert.ok(audio.length > 3);
  // a later run does not post the Reel again
  assert.equal((await publishReel(history.load()[0], { config, logger: silentLogger, deps })).reel.status, "published");
  assert.deepEqual(published, ["carousel-1", "reel-1"]);
});

test("Lyria music: Bollywood-style instrumental prompt per mood; audio saved; missing billing is reported clearly", async () => {
  assert.match(musicPrompt("udaas"), /no vocals.*Bollywood.*bansuri/s);
  assert.ok(new Set(["udaas", "pyaar", "ghar", "josh", "dosti", "soch"].map(musicPrompt)).size === 6);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echoes-"));
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "x" }, { inlineData: { mimeType: "audio/mpeg", data: Buffer.from("ID3").toString("base64") } }] } }] }) });
  const music = await composeMusic({ apiKey: "k", mood: "pyaar", dir, fetchImpl: ok });
  assert.equal(path.basename(music.file), "music.mp3");
  assert.equal(fs.readFileSync(music.file, "utf8"), "ID3");
  const noBilling = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "Quota exceeded for metric: x, limit: 0, model: lyria-3-clip" } }) });
  await assert.rejects(composeMusic({ apiKey: "k", mood: "pyaar", dir, fetchImpl: noBilling }), e => e.kind === "permanent" && /enable billing/.test(e.message));
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
