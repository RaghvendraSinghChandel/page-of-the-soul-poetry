import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import { JobError } from "./util.js";

// A Reel (1080×1920, 9:16, H.264 + AAC) made from a post's carousel slides with ffmpeg:
// each slide sits on a blurred copy of itself, zooms in slowly and fades into the next; the music fades
// in and out. The slide is drawn smaller and above centre so Instagram's caption and buttons don't cover it.

const run = promisify(execFile);
export const REEL = { width: 1080, height: 1920, fps: 30 };
const FG = { width: 972, height: 1215, top: 200 }; // 90% of a 1080×1350 slide
const FADE = 0.7;

export function ffmpegPath(configured = "") {
  if (configured) return configured;
  try {
    const bundled = createRequire(import.meta.url)("ffmpeg-static");
    return bundled && fs.existsSync(bundled) ? bundled : "ffmpeg";
  } catch {
    return "ffmpeg";
  }
}

/** Seconds per slide: enough to read it. Cover 6 s, bhavarth 8 s, poem 9–15 s by its length. */
export function slideDurations(post) {
  const poem = Math.min(15, Math.max(9, 5 + 0.9 * (post.poem || []).length));
  return post.slides.length >= 3 ? [6, 8, poem] : [6, poem];
}

export function reelArgs({ slides, durations, music, file }) {
  const n = slides.length;
  const inputs = slides.flatMap((slide, i) => ["-loop", "1", "-framerate", String(REEL.fps), "-t", durations[i].toFixed(2), "-i", slide]);
  const total = durations.reduce((a, b) => a + b, 0) - FADE * (n - 1);
  const filters = slides.map((_, i) => {
    const frames = Math.round(durations[i] * REEL.fps);
    return [
      `[${i}:v]format=rgb24,split=2[a${i}][b${i}]`,
      `[a${i}]scale=${REEL.width}:${REEL.height}:force_original_aspect_ratio=increase,crop=${REEL.width}:${REEL.height},gblur=sigma=70,eq=brightness=-0.09:saturation=0.85[bg${i}]`,
      // zoompan on a 2× image keeps the slow zoom smooth (no 1-pixel jitter)
      `[b${i}]scale=${FG.width * 2}:${FG.height * 2},zoompan=z='1+0.035*in/${frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${FG.width}x${FG.height}:fps=${REEL.fps}[fg${i}]`,
      `[bg${i}][fg${i}]overlay=${(REEL.width - FG.width) / 2}:${FG.top}:shortest=1,setsar=1,format=yuv420p[v${i}]`,
    ].join(";");
  });
  let last = "v0";
  let offset = 0;
  for (let i = 1; i < n; i++) {
    offset += durations[i - 1] - FADE;
    filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}[x${i}]`);
    last = `x${i}`;
  }
  // apad: a clip shorter than the video ends in silence (under the fade) instead of cutting the video short
  filters.push(`[${n}:a]apad,atrim=0:${total.toFixed(2)},asetpts=N/SR/TB,afade=t=in:d=1.2,afade=t=out:st=${(total - 2.5).toFixed(2)}:d=2.5[aout]`);
  return {
    total,
    args: [
      "-v", "error", "-y",
      ...inputs,
      "-i", music,
      "-filter_complex", filters.join(";"),
      "-map", `[${last}]`, "-map", "[aout]",
      "-t", total.toFixed(2),
      "-r", String(REEL.fps),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
      "-movflags", "+faststart",
      file,
    ],
  };
}

/** Renders the Reel to `file`; returns { file, seconds }. */
export async function renderReel({ slides, durations, music, file, ffmpeg = ffmpegPath() }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { args, total } = reelArgs({ slides, durations, music, file });
  try {
    await run(ffmpeg, args, { maxBuffer: 1 << 24, timeout: 10 * 60000 });
  } catch (error) {
    throw new JobError(`Reel could not be rendered: ${String(error.stderr || error.message).slice(-400)}`, { kind: "retryable" });
  }
  if (!fs.existsSync(file) || fs.statSync(file).size < 50000) throw new JobError("Reel render produced no video", { kind: "retryable" });
  return { file, seconds: Number(total.toFixed(2)) };
}
