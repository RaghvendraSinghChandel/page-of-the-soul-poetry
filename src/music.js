import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Background music for Reels: 45-second excerpts of Indian instrumentals (veena, sitar, bansuri, shehnai,
// tabla) in assets/music/, all from Wikimedia Commons under CC0, public domain or CC BY. The license of each
// was read from the Commons API when it was added (assets/music/tracks.json); CC BY tracks are credited in
// the Reel caption, as the license requires.

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "music");

let cache = null;
export function loadTracks() {
  cache ??= JSON.parse(fs.readFileSync(path.join(DIR, "tracks.json"), "utf8")).tracks.map(t => ({ ...t, path: path.join(DIR, t.file) }));
  return cache;
}

/** A track for the mood, avoiding the ones used by the last few posts. */
export function pickTrack(mood, recent = [], random = Math.random, tracks = loadTracks()) {
  const used = new Set(recent.slice(0, 6).map(p => p.reel?.track?.id).filter(Boolean));
  const fit = tracks.filter(t => t.moods.includes(mood));
  const pool = fit.filter(t => !used.has(t.id));
  const from = pool.length ? pool : fit.length ? fit : tracks;
  return from[Math.floor(random() * from.length)];
}

/** Caption credit, e.g. 'Dhun: "Naraina" — Kevin MacLeod (incompetech.com) · CC BY 3.0 … · ansh'. */
export function musicCredit(track) {
  if (!track) return "";
  const who = track.artist ? ` — ${track.artist}${/Kevin MacLeod/.test(track.artist) ? " (incompetech.com)" : ""}` : "";
  const license = track.attributionRequired ? `${track.license} (${track.licenseUrl})` : track.license;
  return `Dhun: "${track.title}"${who} · ${license} · Wikimedia Commons · ansh`;
}

/** Instagram's "original audio" label on the Reel. */
export const audioName = track => (track ? `${track.title}${track.artist ? ` — ${track.artist}` : ""}`.slice(0, 80) : "");
