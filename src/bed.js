import fs from "node:fs";

// A light background bed for recited Reels, synthesised here (so there is nothing to license).
//   style "focus" (default): a calm, refreshing focus/meditation texture — a slow kalimba-like pentatonic
//     arpeggio over soft major chords, a low Sa–Pa drone and a faint flowing-water hush.
//   style "tanpura": a tanpura-like drone, a sustained pad and occasional bells.
// It sits far below the voice and is ducked further by it.

const RATE = 44100;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Writes a mono 16-bit WAV of `seconds` to `file`. key = Sa in Hz (C3 ≈ 130.8). */
export function writeBed(file, seconds, { key = 130.81, seed = 7, style = "focus" } = {}) {
  const n = Math.round(seconds * RATE);
  const out = style === "focus" ? focusBed(n, key, rng(seed)) : tanpuraBed(n, seconds, key, rng(seed));
  return writeWav(file, out);
}

function focusBed(n, key, random) {
  const out = new Float32Array(n);
  const sa = key * 2;
  const ratio = { S: 1, R: 9 / 8, G: 5 / 4, P: 3 / 2, D: 5 / 3 };
  // Chords (Sa, Dha, Ma-less IV → Re-Pa, Pa) as pentatonic voicings, 4.8 s each.
  const chords = [["S", "G", "P"], ["D", "S", "G"], ["R", "P", "D"], ["P", "R", "G"]];
  const STEP = 0.6;
  for (let t = 0.8, i = 0; t * RATE < n - RATE; t += STEP, i++) {
    const chord = chords[Math.floor(t / 4.8) % chords.length];
    // up-and-down arpeggio across two octaves, a note skipped now and then so it breathes
    const order = [0, 1, 2, 3, 2, 1][i % 6];
    if (random() < 0.12) continue;
    const f = sa * ratio[chord[order % 3]] * (order >= 3 ? 2 : 1);
    const start = Math.round(t * RATE);
    const len = Math.min(n - start, Math.round(2.4 * RATE));
    const vel = 0.75 + 0.25 * random();
    for (let j = 0; j < len; j++) {
      const env = Math.min(1, j / 220) * Math.exp(-j / (RATE * 0.75));
      const x = (2 * Math.PI * f * j) / RATE;
      out[start + j] += 0.06 * vel * env * (Math.sin(x) + 0.18 * Math.sin(2.0 * x) + 0.08 * Math.sin(5.4 * x) * Math.exp(-j / (RATE * 0.08)));
    }
  }
  for (let j = 0; j < n; j++) {
    const t = j / RATE;
    const index = Math.floor(t / 4.8);
    // pad: the chord an octave down with a slow swell, crossfading smoothly (0.8 s) into the next chord
    const into = Math.min(1, (t % 4.8) / 0.8);
    const w = t < 4.8 ? 1 : into * into * (3 - 2 * into);
    const swell = 0.65 + 0.35 * Math.sin((2 * Math.PI * t) / 7);
    const voice = chord => chord.reduce((sum, note) => {
      const f = key * ratio[note];
      return sum + Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 1.003 * t);
    }, 0);
    const pad = w * voice(chords[index % chords.length]) + (w < 1 ? (1 - w) * voice(chords[(index + chords.length - 1) % chords.length]) : 0);
    // drone: Sa and Pa, very low
    const drone = Math.sin(2 * Math.PI * (key / 2) * t) + 0.6 * Math.sin(2 * Math.PI * (key * 0.75) * t);
    out[j] += 0.010 * swell * pad + 0.010 * drone;
  }
  // flowing-water hush: smoothed noise with a slow, uneven swell
  let low = 0;
  let lower = 0;
  for (let j = 0; j < n; j++) {
    low += 0.08 * (random() * 2 - 1 - low);
    lower += 0.3 * (low - lower);
    const t = j / RATE;
    const flow = 0.6 + 0.25 * Math.sin(2 * Math.PI * t / 5.3) + 0.15 * Math.sin(2 * Math.PI * t / 2.1);
    out[j] += 0.05 * flow * (low - lower);
  }
  return out;
}

function tanpuraBed(n, seconds, key, random) {
  const out = new Float32Array(n);

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

  return out;
}

function writeWav(file, out) {
  const n = out.length;
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
