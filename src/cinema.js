import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { displayLine } from "./render.js";
import { ffmpegPath } from "./reel.js";
import { JobError } from "./util.js";

// The cinematic voice Reel (1080×1920): real photos with slow Ken Burns moves, a warm film grade, vignette and
// grain, cross-fading section by section; the words appear as they are spoken (a soft fade and rise), over a
// dark band that keeps them readable; a like/share/follow card closes it. Text stays inside Instagram's safe
// area (clear of the top bar, the caption and the side buttons).

const run = promisify(execFile);
const W = 1080;
const H = 1920;
const FPS = 30;
const XFADE = 0.8;
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BASE_CSS = `.wrap{position:absolute;left:90px;right:90px;top:560px;height:760px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:#fffaf0;text-shadow:0 2px 22px rgba(0,0,0,.55),0 1px 3px rgba(0,0,0,.5)}
p{margin:0;text-wrap:balance}
.kicker{font:600 26px "Mukta";letter-spacing:.28em;text-transform:uppercase;color:#f3c98b;margin-bottom:34px}
.title{font:italic 400 76px/1.2 "Lora";margin-bottom:30px}
.hook{font:italic 400 52px/1.38 "Lora";opacity:.96}
.line{font:400 58px/1.42 "Lora"}
.line + .line{margin-top:18px}
.doha{font:400 60px/1.6 "Tiro"}
.att{margin-top:30px;font:600 30px "Mukta";letter-spacing:.06em;color:#f3c98b}
.meaning{font:400 48px/1.45 "Lora"}
.ask{font:italic 400 58px/1.3 "Lora";margin-bottom:46px}
.acts{display:flex;gap:44px;justify-content:center;margin-bottom:50px}
.acts span{font:600 30px "Mukta";letter-spacing:.2em;text-transform:uppercase;padding:16px 30px;border:2px solid rgba(255,250,240,.75);border-radius:999px}
.follow{font:400 40px/1.4 "Lora"}
.handle{display:block;margin-top:14px;font:600 44px "Mukta";color:#f3c98b}`;

/** The always-on layer: a soft dark band behind the text and the page name at the top. */
export function frameHtml(brand) {
  return {
    css: `.band{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.42) 0%,rgba(0,0,0,.08) 16%,rgba(0,0,0,.18) 28%,rgba(0,0,0,.5) 48%,rgba(0,0,0,.5) 66%,rgba(0,0,0,.18) 82%,rgba(0,0,0,.45) 100%)}
.brand{position:absolute;top:150px;left:0;right:0;text-align:center;font:500 26px "Mukta";letter-spacing:.3em;color:rgba(255,250,240,.85);text-shadow:0 1px 10px rgba(0,0,0,.5)}
.brand i{display:block;width:56px;height:1px;margin:18px auto 0;background:#f3c98b}`,
    body: `<div class="band"></div><div class="brand">${esc(brand)}<i></i></div>`,
  };
}

/** The text cards of a post, each with the voice segments it covers: { name, html: {css, body}, from, to }. */
export function textCards(post) {
  const cards = [];
  const card = (name, body, from, to) => cards.push({ name, html: { css: BASE_CSS, body: `<div class="wrap">${body}</div>` }, from, to });
  let seg = 0;
  if (post.couplet) {
    const lines = post.couplet.lines.map(displayLine);
    card("cover", `${lines.map(l => `<p class="doha">${esc(l)}</p>`).join("")}<p class="att">— ${esc(post.couplet.poet)}</p>`, seg, seg + lines.length - 1);
    seg += lines.length;
    card("bhavarth", `<p class="kicker">Bhavarth</p><p class="meaning">${esc(post.bhavarth)}</p>`, seg, seg);
    seg += 1;
    card("title", `<p class="kicker">${esc(post.title)}</p>`, seg, seg);
    seg += 1;
  } else {
    card("cover", `<p class="kicker">${esc(post.title)}</p><p class="hook">${esc(post.hook)}</p>`, seg, seg + 1);
    seg += 2;
  }
  const poem = post.poem;
  for (let i = 0; i < poem.length; i += 2) {
    const pair = poem.slice(i, i + 2);
    const last = i + 2 >= poem.length;
    // the last pair stays up while its last line is said once more
    card(`pair-${i / 2 + 1}`, pair.map(l => `<p class="line">${esc(l)}</p>`).join(""), seg + i, seg + i + pair.length - 1 + (last ? 1 : 0));
  }
  seg += poem.length + 1;
  card("outro", `<p class="ask">Kavita dil ko chhoo gayi?</p><div class="acts"><span>♥ Like</span><span>↗ Share</span></div><p class="follow">Aisi aur kavitaon ke liye follow karein<span class="handle">@${esc(post.brand)}</span></p>`, seg, seg + 1);
  return cards;
}

/**
 * Renders the Reel. photos: one per section ({ file, from, to } in seconds); cards: PNG overlays
 * ({ file, from, to }); frame: the always-on PNG; audio: the finished mix, started after audioDelay seconds.
 */
export async function renderCinematicReel({ photos, cards, frame, audio, audioDelay = 0, total, file, ffmpeg = ffmpegPath() }) {
  const inputs = [];
  const filters = [];
  photos.forEach((photo, i) => {
    const seconds = photo.to - photo.from + (i < photos.length - 1 ? XFADE : 0);
    const frames = Math.round(seconds * FPS);
    inputs.push("-i", photo.file);
    const zoomIn = i % 2 === 0;
    const z = zoomIn ? `1.0+0.09*on/${frames}` : `1.09-0.09*on/${frames}`;
    const x = `iw/2-iw/zoom/2${i % 3 === 1 ? "+" : "-"}iw*0.02*on/${frames}`; // a slow drift sideways
    filters.push(
      `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='${x}':y='ih/2-ih/zoom/2':d=${frames}:s=${W}x${H}:fps=${FPS},` +
        `eq=contrast=1.06:brightness=-0.04:saturation=0.82,colorbalance=rs=0.05:gs=0.01:bs=-0.04:rm=0.03:bm=-0.02,vignette=angle=PI/4.3,setsar=1,format=yuv420p[p${i}]`
    );
  });
  let base = "p0";
  let offset = 0;
  for (let i = 1; i < photos.length; i++) {
    offset += photos[i - 1].to - photos[i - 1].from;
    filters.push(`[${base}][p${i}]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(2)}[x${i}]`);
    base = `x${i}`;
  }
  filters.push(`[${base}]noise=alls=4:allf=t,format=yuv420p[graded]`);

  let next = photos.length;
  inputs.push("-loop", "1", "-t", total.toFixed(2), "-i", frame);
  filters.push(`[${next}:v]format=rgba[frame]`, `[graded][frame]overlay=0:0:shortest=1[v0]`);
  let layer = "v0";
  next++;
  cards.forEach((c, i) => {
    inputs.push("-loop", "1", "-t", total.toFixed(2), "-i", c.file);
    const fadeOut = Math.max(c.from + 0.5, c.to - 0.45);
    filters.push(
      `[${next}:v]format=rgba,fade=t=in:st=${c.from.toFixed(2)}:d=0.5:alpha=1,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.45:alpha=1[c${i}]`,
      `[${layer}][c${i}]overlay=x=0:y='26*max(0\\,1-(t-${c.from.toFixed(2)})/0.6)':enable='between(t,${c.from.toFixed(2)},${(c.to + 0.05).toFixed(2)})'[v${i + 1}]`
    );
    layer = `v${i + 1}`;
    next++;
  });
  inputs.push("-i", audio);
  filters.push(`[${next}:a]adelay=${Math.round(audioDelay * 1000)}:all=1,apad,atrim=0:${total.toFixed(2)},afade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8[aout]`);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = [
    "-v", "error", "-y", ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", `[${layer}]`, "-map", "[aout]", "-t", total.toFixed(2), "-r", String(FPS),
    // capped bitrate: moving film grain otherwise makes a 50 s Reel 60–100 MB (GitHub rejects files over 100 MB)
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "3500k", "-bufsize", "7000k", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", file,
  ];
  try {
    await run(ffmpeg, args, { maxBuffer: 1 << 24, timeout: 20 * 60000 });
  } catch (error) {
    throw new JobError(`Cinematic Reel could not be rendered: ${String(error.stderr || error.message).slice(-500)}`, { kind: "retryable" });
  }
  return { file, seconds: Number(total.toFixed(2)) };
}
