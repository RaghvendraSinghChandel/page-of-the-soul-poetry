import fs from "node:fs";
import path from "node:path";

import { JobError } from "./util.js";

// Real photos for the cinematic voice Reels, from Unsplash (free under the Unsplash License, which needs no
// credit). Each section of a Reel gets its own portrait photo: the post's scene first, then its mood.
// As the API guidelines ask, every photo used is reported to its download endpoint. Photos used recently
// are not picked again (usedFile). Mostly places and things, so no stranger's face carries a sad poem.

const SCENE_QUERIES = {
  dusk_window: ["window sunset light", "evening window curtain"],
  rain_window: ["rain on window", "raindrops on glass"],
  two_cups: ["two cups of tea", "tea cup table window"],
  old_letters: ["old letters", "vintage photographs"],
  autumn_road: ["autumn road", "empty road trees"],
  kitchen_lamp: ["warm kitchen light", "lamp evening home"],
  doorway_light: ["sunlight through door", "doorway light"],
  office_night: ["office window night city", "desk lamp night"],
  city_commute: ["city lights night street", "rainy street night"],
  railway_platform: ["railway platform", "train station evening"],
  streetlight: ["street lamp night", "lonely street light"],
  sunrise_path: ["sunrise path", "morning mountains mist"],
  new_leaves: ["green leaves sunlight", "new leaves morning"],
};
const MOOD_QUERIES = {
  udaas: ["rain night window", "foggy road", "empty bench", "rainy city street", "wilted flower", "lonely lamp post", "train window rain", "empty chair room", "cloudy sky dusk", "dry leaves ground"],
  pyaar: ["sunset golden hour", "flowers soft light", "candle light", "two cups coffee", "fairy lights night", "rose petals", "sunset beach", "letters and flowers", "warm cafe window", "moon night sky"],
  ghar: ["home window evening", "warm lamp room", "old house door", "indian courtyard", "kitchen morning light", "family dinner table", "old wooden door", "village house", "balcony plants morning", "old photo album"],
  josh: ["sunrise mountain", "road ahead sunrise", "city morning", "mountain summit", "running track morning", "light through clouds", "bridge city dawn", "climbing stairs light", "ocean waves sunrise", "desk work morning"],
  dosti: ["sunset road trip", "tea stall evening", "beach sunset", "bicycle sunset", "campfire night", "old school bench", "road trip car window", "hills road", "street food lights", "railway track sunset"],
  soch: ["calm lake morning", "misty forest", "night sky stars", "desert dunes", "ocean horizon", "candle dark", "mountain road clouds", "old temple steps", "sand hourglass", "autumn park path"],
};

/** Queries for `count` sections: the scene first, then mood queries chosen per post (so posts of one mood differ). */
export function photoQueries(post, count) {
  const scene = SCENE_QUERIES[post.scene] || [];
  const mood = MOOD_QUERIES[post.mood] || MOOD_QUERIES.soch;
  let seed = [...String(post.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const picks = [...mood];
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  const order = [scene[Math.floor(random() * Math.max(1, scene.length))], ...picks].filter(Boolean);
  return Array.from({ length: count }, (_, i) => order[i % order.length]);
}

export function createFootage({ accessKey, usedFile, fetchImpl = fetch }) {
  const headers = { authorization: `Client-ID ${accessKey}`, "accept-version": "v1" };
  const api = async url => {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new JobError(`Unsplash ${res.status}: ${(await res.text()).slice(0, 200)}`, { kind: res.status === 401 || res.status === 403 ? "permanent" : "retryable" });
    return res.json();
  };
  const used = () => {
    try {
      return JSON.parse(fs.readFileSync(usedFile, "utf8"));
    } catch {
      return [];
    }
  };

  return {
    available: Boolean(accessKey),
    /** Downloads `count` distinct portrait photos for the post into dir; returns [{ file, id, query }]. */
    async photosFor(post, count, dir) {
      const recent = new Set(used().slice(-150));
      const picked = [];
      for (const query of photoQueries(post, count)) {
        const { results = [] } = await api(`https://api.unsplash.com/search/photos?${new URLSearchParams({ query, orientation: "portrait", content_filter: "high", per_page: "20" })}`);
        // not one of the top few every time, so posts with the same query still differ
        const fresh = results.filter(p => !recent.has(p.id) && !picked.some(x => x.id === p.id) && p.width >= 1800);
        const photo = fresh[[...String(post.id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % Math.min(fresh.length || 1, 6)];
        if (!photo) continue;
        const res = await fetchImpl(`${photo.urls.raw}&w=1080&h=1920&fit=crop&crop=entropy&q=85&fm=jpg`, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) continue;
        const file = path.join(dir, `photo-${picked.length + 1}.jpg`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        await api(photo.links.download_location).catch(() => {}); // Unsplash API guideline: count the download
        picked.push({ file, id: photo.id, query });
      }
      if (!picked.length) throw new JobError(`No photos found for "${post.title}"`, { kind: "retryable" });
      fs.writeFileSync(usedFile, JSON.stringify([...used(), ...picked.map(p => p.id)].slice(-300)));
      return Array.from({ length: count }, (_, i) => picked[i % picked.length]);
    },
  };
}
