import fs from "node:fs";

// A light background bed for recited Reels, synthesised here (so there is nothing to license):
// a slow tanpura-like drone (Pa–Sa–Sa–Sa plucks), a soft sustained pad and, now and then, a quiet
// bell-like note from the pentatonic scale. It sits far below the voice and is ducked further by it.

const RATE = 44100;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Writes a mono 16-bit WAV of `seconds` to `file`. key = Sa in Hz (C3 ≈ 130.8). */
export function writeBed(file, seconds, { key = 130.81, seed = 7 } = {}) {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  const random = rng(seed);

  // Tanpura: plucks every 0.95 s, each a decaying stack of harmonics (a little brighter in the middle, like jawari).
  const cycle = [key * 0.75, key, key, key / 2];
  for (let t = 0, i = 0; t < seconds; t += 0.95, i++) {
    const f = cycle[i % cycle.length];
    const start = Math.round(t * RATE);
    const len = Math.min(n - start, Math.round(4.5 * RATE));
    for (let k = 1; k <= 14; k++) {
      if (f * k > 6000) break;
      const amp = (k >= 3 && k <= 8 ? 0.55 : 0.35) / k ** 0.8;
      const w = (2 * Math.PI * f * k * (1 + 0.0004 * k)) / RATE;
      for (let j = 0; j < len; j++) out[start + j] += 0.05 * amp * Math.sin(w * j) * Math.exp(-j / (RATE * (1.6 - k * 0.06)));
    }
  }

  // Pad: Sa, Ga, Pa, Sa' held softly, breathing with a slow swell.
  const pad = [key, key * 1.26, key * 1.5, key * 2];
  for (let j = 0; j < n; j++) {
    const swell = 0.6 + 0.4 * Math.sin((2 * Math.PI * j) / (RATE * 9));
    let v = 0;
    for (const f of pad) v += Math.sin((2 * Math.PI * f * j) / RATE) + 0.25 * Math.sin((4 * Math.PI * f * j) / RATE);
    out[j] += 0.012 * swell * v;
  }

  // Bells: a quiet pentatonic note every 3–5 s.
  const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2].map(r => r * key * 2);
  for (let t = 1.5; t < seconds - 2; t += 3 + 2 * random()) {
    const f = scale[Math.floor(random() * scale.length)];
    const start = Math.round(t * RATE);
    const len = Math.min(n - start, Math.round(3 * RATE));
    for (let j = 0; j < len; j++) {
      const env = Math.min(1, j / 400) * Math.exp(-j / (RATE * 0.9));
      out[start + j] += 0.05 * env * (Math.sin((2 * Math.PI * f * j) / RATE) + 0.3 * Math.sin((2 * Math.PI * f * 2.76 * j) / RATE));
    }
  }

  // Normalise, then a 2 s fade-in and fade-out.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const fade = 2 * RATE;
  const pcm = Buffer.alloc(44 + n * 2);
  for (let j = 0; j < n; j++) {
    const env = Math.min(1, j / fade, (n - j) / fade);
    pcm.writeInt16LE(Math.round((out[j] / (peak || 1)) * 0.8 * env * 32767), 44 + j * 2);
  }
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(file, pcm);
  return file;
}
