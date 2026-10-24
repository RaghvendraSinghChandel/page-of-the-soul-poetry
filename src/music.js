import fs from "node:fs";
import path from "node:path";

import { JobError, backoffDelay, sleep } from "./util.js";

// Background music for Reels: a new Bollywood-style instrumental composed for each post by Google Lyria
// (Gemini API with LYRIA_API_KEY, or GEMINI_API_KEY; Lyria needs billing enabled on that key's project). The prompt follows
// the post's mood. Real film songs are never used: the Instagram API cannot attach Instagram's licensed
// music, and uploading a film song ourselves would infringe its copyright.

const STYLE = {
  udaas: "slow and melancholic, a solo bansuri melody over soft piano chords and gentle strings, raag Yaman feel, like the sad interlude of a 2000s Hindi film song when someone remembers an old love",
  pyaar: "warm and romantic, santoor and soft acoustic guitar with a light tabla groove and lush strings, like the love theme of a 1990s Bollywood romance",
  ghar: "tender and nostalgic, sitar and harmonium over soft strings, homely and emotional, like a Hindi film scene of a family at home in the evening",
  josh: "uplifting and motivational, a sitar hook over a steady dhol and tabla rhythm with rising strings, hopeful, like a Bollywood training montage that builds slowly",
  dosti: "cheerful and warm, acoustic guitar with a playful bansuri melody and light tabla, carefree, like a Hindi film song about old friends on a road trip",
  soch: "calm and reflective, Sufi-style: a soft harmonium drone, a sarangi melody and gentle tabla, spiritual and thoughtful, like a quiet Hindi film moment about the meaning of life",
};

export function musicPrompt(mood) {
  const style = STYLE[mood] || STYLE.soch;
  return `Instrumental only: no vocals, no lyrics, no humming. An Indian Bollywood-style background score, ${style}. Clean, professional film mix. Starts softly, keeps one mood throughout, about 30 seconds long.`;
}

const EXT = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/aac": "aac", "audio/mp4": "m4a", "audio/flac": "flac" };

/** Composes the music for one post into `dir` (music.<ext>); returns { file, model, mood }. */
export async function composeMusic({ apiKey, model = "lyria-3-clip-preview", mood, dir, fetchImpl = fetch, sleepFn = sleep, retries = 2 }) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: musicPrompt(mood) }] }] }),
        signal: AbortSignal.timeout(180000),
      });
    } catch (error) {
      if (attempt < retries) {
        await sleepFn(backoffDelay(attempt, { baseMs: 5000, maxMs: 30000 }));
        continue;
      }
      throw new JobError(`Lyria unreachable: ${error.message}`, { kind: "retryable" });
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      const message = String(body.error?.message || `HTTP ${res.status}`).split("\n")[0];
      // "limit: 0" = Lyria is not available on the free tier: billing must be enabled for this API key.
      if (/limit: 0/.test(body.error?.message || "")) throw new JobError(`Lyria is not enabled for this API key (free-tier limit 0): enable billing in Google AI Studio. ${message}`, { kind: "permanent" });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleepFn(backoffDelay(attempt, { baseMs: 10000, maxMs: 60000 }));
        continue;
      }
      throw new JobError(`Lyria could not compose the music: ${message}`, { kind: res.status === 429 || res.status >= 500 ? "retryable" : "permanent" });
    }
    const audio = (body.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.mimeType?.startsWith("audio/"))?.inlineData;
    if (!audio?.data) throw new JobError("Lyria returned no audio", { kind: "retryable" });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `music.${EXT[audio.mimeType.split(";")[0]] || "audio"}`);
    fs.writeFileSync(file, Buffer.from(audio.data, "base64"));
    return { file, model, mood };
  }
}

/** Caption credit (Hinglish): the music is AI-made for this page, and says so. */
export const musicCredit = (music, brand) => (music ? `Dhun: ${brand} ke liye AI (Google Lyria) se banayi gayi` : "");

/** Instagram's "original audio" label on the Reel. */
export const audioName = brand => `Mool dhun — ${brand}`;
