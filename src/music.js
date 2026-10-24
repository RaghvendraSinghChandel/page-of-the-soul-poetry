// Credits for the voice Reels the Mac makes (scripts/voice-worker.mjs). Their background music is a bed
// synthesised in src/bed.js, so there is nothing to license; the voice is the page owner's, cloned with
// AI4Bharat IndicF5, and Instagram asks for realistic AI audio to be disclosed.

/** Reel caption credit (Hinglish). */
export const voiceCredit = brand => `Awaaz: ${brand} ki apni awaaz par AI (IndicF5) se bani`;

/** Instagram's "original audio" label on the Reel. */
export const audioName = (brand, { voice = false } = {}) => (voice ? `Kavita path — ${brand}` : `Mool dhun — ${brand}`);
