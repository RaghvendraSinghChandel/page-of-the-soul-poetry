#!/usr/bin/env node
import "dotenv/config";

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { writeBed } from "../src/bed.js";
import { frameHtml, renderCinematicReel, textCards } from "../src/cinema.js";
import { loadConfig, secretValues } from "../src/config.js";
import { createFootage } from "../src/footage.js";
import { createGemini } from "../src/gemini.js";
import { createLogger, registerSecrets } from "../src/logger.js";
import { FADE, renderReel } from "../src/reel.js";
import { buildOutroSlide, launchBrowser, overlayPage, renderJpeg, renderPng } from "../src/render.js";
import { buildVoiceScript, keptForCarousel, toDevanagari, voiceTextHash } from "../src/voice.js";

// Mac voice worker (launchd, every 30 minutes and at login; npm run voice):
// keeps a voice Reel ready for each of the next DRAFT_BUFFER drafts, so Reels keep going out on days the
// Mac is off. For each draft without one it recites the post page by page in the owner's cloned voice
// (scripts/voice/speak.py, IndicF5 on the Mac GPU), lays a light self-made bed under the poem, adds a
// like/share/follow card, renders the Reel and pushes it to the poet-voice branch as voice/<id>/reel.mp4.
// GitHub Actions publishes it right after the post's carousel. The voice sample never leaves the Mac.

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WORK = path.join(ROOT, ".voice-work");
const PYTHON = path.join(ROOT, ".voice-env", "bin", "python");
const REF_AUDIO = path.join(ROOT, "assets", "voice", "reference.wav");
const REF_TEXT = path.join(ROOT, "assets", "voice", "reference.txt");
const POLISH = "highpass=f=75,afftdn=nr=8:nf=-50,deesser=i=0.4,equalizer=f=250:t=q:w=1:g=-1.5,equalizer=f=3200:t=q:w=1.2:g=2.5,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=150:makeup=2,aecho=0.9:0.5:35|65:0.10|0.06,loudnorm=I=-15:TP=-1.5:LRA=7";
const LEAD = 0.6; // reel.js starts a recitation after this breath

const config = loadConfig();
registerSecrets([...secretValues(config), process.env.HF_TOKEN].filter(Boolean));
const logger = createLogger({ level: config.logLevel, logDir: config.logDir, context: { cmd: "voice" } });
const repoUrl = `https://github.com/${config.githubRepository || "RaghvendraSinghChandel/page-of-the-soul-poetry"}.git`;

const git = (cwd, ...args) => run("git", args, { cwd, maxBuffer: 1 << 26 }).then(r => r.stdout.trim());
const ffmpeg = args => run("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1 << 26 });

function acquireLock() {
  const lock = path.join(WORK, "worker.lock");
  fs.mkdirSync(WORK, { recursive: true });
  try {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    process.kill(pid, 0);
    return null; // another run is still working
  } catch {
    fs.writeFileSync(lock, String(process.pid));
    return () => fs.rmSync(lock, { force: true });
  }
}

/** Skips work on a low battery: voicing keeps the GPU busy for minutes. */
async function powerOk() {
  const { stdout } = await run("pmset", ["-g", "batt"]).catch(() => ({ stdout: "AC Power" }));
  const percent = Number(stdout.match(/(\d+)%/)?.[1] ?? 100);
  return /AC Power/.test(stdout) || percent >= 40;
}

async function fetchBranch(branch, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    await run("git", ["clone", "-q", "--depth", "1", "-b", branch, repoUrl, dir], { maxBuffer: 1 << 26 });
    return true;
  } catch {
    fs.mkdirSync(dir, { recursive: true });
    await git(dir, "init", "-q", "-b", branch);
    await git(dir, "remote", "add", "origin", repoUrl);
    return false;
  }
}

/** Saves the voice branch as one orphan commit (only the Reels still needed), force-pushed. */
async function pushVoices(dir, message) {
  await git(dir, "checkout", "-q", "--orphan", `save-${Date.now()}`);
  await git(dir, "add", "-A");
  await git(dir, "-c", "user.name=page_of_the__soul voice worker", "-c", "user.email=voice-worker@users.noreply.github.com", "commit", "-q", "--allow-empty", "-m", message);
  await git(dir, "push", "-q", "-f", "origin", `HEAD:refs/heads/${config.voiceBranch}`);
}

/** Slide lengths so each slide is on screen while its part is spoken (the fade lands as it starts). */
function durationsFor(timings, slideCount) {
  const total = LEAD + timings.seconds + 0.6;
  const bounds = [];
  for (let k = 2; k <= slideCount; k++) bounds.push(LEAD + timings.slides[k].start + 0.1);
  const durations = [bounds[0]];
  for (let i = 1; i < bounds.length; i++) durations.push(bounds[i] - bounds[i - 1] + FADE);
  durations.push(total - bounds[bounds.length - 1] + FADE);
  return durations;
}

/**
 * Photo sections: the cover (and bhavarth), the poem in halves, the outro, as [from, to) in Reel seconds.
 * Cards: each text card from the start of its first voice segment to the end of its last.
 */
function cinematicTimeline(post, timings, script) {
  const segs = timings.segments.map(s => ({ start: LEAD + s.start, end: LEAD + s.end }));
  const total = LEAD + timings.seconds + 0.6;
  const cards = textCards({ ...post, brand: config.brandName }).map(c => ({ ...c, from: segs[c.from].start, to: c.to === segs.length - 1 ? total : segs[c.to].end }));
  const at = i => segs[i].start - 0.2;
  const poemSlide = script.segments.findIndex(x => x.slide === script.slides);
  const firstPoem = poemSlide + (post.couplet ? 1 : 0); // a couplet post says the title first on that slide
  const half = firstPoem + Math.ceil(post.poem.length / 2);
  const outro = script.segments.findIndex(x => x.slide === script.outroSlide);
  const cuts = [0, ...(post.couplet ? [at(script.segments.findIndex(x => x.slide === 2))] : []), at(firstPoem), at(half), at(outro)];
  const sections = cuts.map((from, i) => ({ from, to: cuts[i + 1] ?? total }));
  return { cards, sections, total };
}

async function makeReel(post, { stateDir, outDir, gemini, browser, footage }) {
  const tmp = fs.mkdtempSync(path.join(WORK, `${post.id}-`));
  try {
    const deva = await toDevanagari({ gemini, post });
    const script = buildVoiceScript(post, deva);
    fs.writeFileSync(path.join(tmp, "script.json"), JSON.stringify({ segments: script.segments }, null, 2));

    const raw = path.join(tmp, "voice-raw.wav");
    await run(PYTHON, [path.join(ROOT, "scripts", "voice", "speak.py"), "--script", path.join(tmp, "script.json"), "--ref-audio", REF_AUDIO, "--ref-text", fs.readFileSync(REF_TEXT, "utf8").trim(), "--out", raw], {
      env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: "1" },
      maxBuffer: 1 << 26,
      timeout: 90 * 60000,
    });
    const timings = JSON.parse(fs.readFileSync(`${raw}.json`, "utf8"));

    // Voice polish, then the bed under the poem only (it fades out before the outro) and ducked by the voice.
    const voice = path.join(tmp, "voice.wav");
    await ffmpeg(["-i", raw, "-af", POLISH, "-ar", "44100", voice]);
    const bedEnd = timings.slides[script.slides].spoken_end + 1.5;
    writeBed(path.join(tmp, "bed-raw.wav"), bedEnd + 2, { seed: parseInt(voiceTextHash(post).slice(0, 6), 16) });
    await ffmpeg(["-i", path.join(tmp, "bed-raw.wav"), "-af", "lowpass=f=7000,aecho=0.8:0.75:80|160|320:0.28|0.18|0.1,loudnorm=I=-20:TP=-3", "-ar", "44100", path.join(tmp, "bed.wav")]);
    const mix = path.join(tmp, "mix.m4a");
    await ffmpeg([
      "-i", voice, "-i", path.join(tmp, "bed.wav"),
      "-filter_complex",
      `[0:a]aformat=channel_layouts=mono,asplit[v1][v2];[1:a]aformat=channel_layouts=mono,atrim=0:${bedEnd.toFixed(2)},afade=t=out:st=${(bedEnd - 2.5).toFixed(2)}:d=2.5,volume=-15dB,apad[b];[b][v1]sidechaincompress=threshold=0.03:ratio=4:attack=20:release=400[bd];[v2][bd]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[out]`,
      "-map", "[out]", "-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "192k", mix,
    ]);

    if (footage?.available) {
      const { cards, sections, total } = cinematicTimeline(post, timings, script);
      const photos = await footage.photosFor(post, sections.length, path.join(tmp, "photos"));
      const cardFiles = [];
      for (const card of cards) {
        const file = path.join(tmp, `card-${card.name}.png`);
        await renderPng(browser, { html: overlayPage(card.html), file });
        cardFiles.push({ file, from: card.from, to: card.to });
      }
      const frame = await renderPng(browser, { html: overlayPage(frameHtml(config.brandName)), file: path.join(tmp, "frame.png") });
      fs.mkdirSync(outDir, { recursive: true });
      const { seconds } = await renderCinematicReel({
        photos: sections.map((s, i) => ({ ...s, file: photos[i].file })),
        cards: cardFiles,
        frame,
        audio: mix,
        audioDelay: LEAD,
        total,
        file: path.join(outDir, "reel.mp4"),
      });
      const reference = crypto.createHash("sha1").update(fs.readFileSync(REF_AUDIO)).digest("hex").slice(0, 10);
      fs.writeFileSync(path.join(outDir, "meta.json"), `${JSON.stringify({ postId: post.id, title: post.title, textHash: voiceTextHash(post), seconds, style: "cinematic", photos: photos.map(p => p.id), reference, device: timings.device, createdAt: new Date().toISOString() }, null, 2)}\n`);
      return seconds;
    }

    const seed = [...post.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
    const outro = path.join(tmp, "slide-outro.jpg");
    await renderJpeg(browser, { html: buildOutroSlide(post, { brandName: config.brandName, seed }), file: outro });
    const slides = [...post.slides.map(s => path.join(stateDir, s)), outro];
    fs.mkdirSync(outDir, { recursive: true });
    const { seconds } = await renderReel({ slides, durations: durationsFor(timings, slides.length), music: mix, file: path.join(outDir, "reel.mp4"), voice: true });
    const reference = crypto.createHash("sha1").update(fs.readFileSync(REF_AUDIO)).digest("hex").slice(0, 10);
    fs.writeFileSync(path.join(outDir, "meta.json"), `${JSON.stringify({ postId: post.id, title: post.title, textHash: voiceTextHash(post), seconds, reference, device: timings.device, createdAt: new Date().toISOString() }, null, 2)}\n`);
    return seconds;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  for (const [file, what] of [[PYTHON, "the voice environment (.voice-env)"], [REF_AUDIO, "assets/voice/reference.wav"], [REF_TEXT, "assets/voice/reference.txt"]]) {
    if (!fs.existsSync(file)) return logger.error(`Missing ${what}; no voice Reels can be made`);
  }
  if (!process.env.HF_TOKEN) return logger.error("HF_TOKEN is missing in .env");
  if (!(await powerOk())) return logger.info("On battery below 40%: voicing waits for the charger");

  const stateDir = path.join(WORK, "state");
  const voiceDir = path.join(WORK, "voice");
  if (!(await fetchBranch("poet-state", stateDir))) return logger.error("Could not fetch the poet-state branch");
  await fetchBranch(config.voiceBranch, voiceDir);
  const posts = JSON.parse(fs.readFileSync(path.join(stateDir, "state", "history.json"), "utf8")).posts || [];
  const queue = posts.filter(p => p.status === "draft").slice(0, config.draftBuffer);
  const keep = new Set([...queue, ...posts.filter(p => p.status === "publishing")].map(p => p.id));

  // Reels for posts that went out (or were dropped) are no longer needed.
  let pruned = 0;
  for (const id of fs.existsSync(path.join(voiceDir, "voice")) ? fs.readdirSync(path.join(voiceDir, "voice")) : []) {
    if (!keep.has(id)) fs.rmSync(path.join(voiceDir, "voice", id), { recursive: true, force: true }), pruned++;
  }
  const cinematic = Boolean((process.env.UNSPLASH_ACCESS_KEY || "").trim());
  const ready = id => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(voiceDir, "voice", id, "meta.json"), "utf8"));
      // with photos available, slide-style Reels made earlier are redone in the cinematic style
      return meta.textHash === voiceTextHash(posts.find(p => p.id === id)) && (!cinematic || meta.style === "cinematic");
    } catch {
      return false;
    }
  };
  const todo = queue.filter(p => !ready(p.id) && !keptForCarousel(p));
  logger.info("Voice queue", { drafts: queue.length, ready: queue.length - todo.length, todo: todo.map(p => p.id), pruned });
  if (pruned && !todo.length) await pushVoices(voiceDir, `Prune ${pruned} published Reel(s)`);
  if (!todo.length) return;

  const gemini = createGemini({ apiKey: config.geminiApiKey, model: config.geminiModel, fallbackModels: config.geminiFallbackModels });
  const browser = await launchBrowser({ chromiumPath: config.chromiumPath });
  const footage = createFootage({ accessKey: (process.env.UNSPLASH_ACCESS_KEY || "").trim(), usedFile: path.join(WORK, "used-photos.json") });
  if (!footage.available) logger.warn("UNSPLASH_ACCESS_KEY missing: Reels use the slides instead of real photos");
  try {
    for (const post of todo) {
      if (!(await powerOk())) return logger.info("Battery got low: stopping until the charger is in");
      const started = Date.now();
      try {
        const seconds = await makeReel(post, { stateDir, outDir: path.join(voiceDir, "voice", post.id), gemini, browser, footage });
        // GitHub refuses files over 100 MB: squeeze any Reel that came out too big before pushing
        const reel = path.join(voiceDir, "voice", post.id, "reel.mp4");
        if (fs.statSync(reel).size > 60 * 1048576) {
          await ffmpeg(["-i", reel, "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-maxrate", "2500k", "-bufsize", "5000k", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", `${reel}.small.mp4`]);
          fs.renameSync(`${reel}.small.mp4`, reel);
        }
        await pushVoices(voiceDir, `Voice Reel: ${post.id} ${post.title}`);
        logger.info("Voice Reel ready", { post: post.id, title: post.title, seconds, minutes: Math.round((Date.now() - started) / 60000) });
      } catch (error) {
        logger.error("Voice Reel failed; the next run tries again", { post: post.id, error });
      }
    }
  } finally {
    await browser.close();
  }
}

const release = acquireLock();
if (!release) {
  logger.info("Another voice run is still working");
} else {
  main()
    .catch(error => {
      logger.error("Voice worker failed", { error });
      process.exitCode = 1;
    })
    .finally(release);
}
