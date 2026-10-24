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
  udaas: ["rain night window", "foggy road", "empty bench"],
  pyaar: ["sunset golden hour", "flowers soft light", "candle light"],
  ghar: ["home window evening", "warm lamp room", "old house door"],
  josh: ["sunrise mountain", "road ahead sunrise", "city morning"],
  dosti: ["sunset road trip", "tea stall evening", "beach sunset"],
  soch: ["calm lake morning", "misty forest", "night sky stars"],
};

export function photoQueries(post, count) {
  const scene = SCENE_QUERIES[post.scene] || [];
  const mood = MOOD_QUERIES[post.mood] || MOOD_QUERIES.soch;
  const order = [scene[0], mood[0], scene[1], mood[1], mood[2]].filter(Boolean);
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
        const photo = results.find(p => !recent.has(p.id) && !picked.some(x => x.id === p.id) && p.width >= 1800);
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
