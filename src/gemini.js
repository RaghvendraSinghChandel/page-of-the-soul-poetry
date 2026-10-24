import { JobError, backoffDelay, isNetworkError, sleep } from "./util.js";

// Google Gemini via the REST API (free tier key from aistudio.google.com, no card needed).
//   json()       – structured JSON output (responseSchema), no web access
//   searchJson() – Grounding with Google Search; JSON parsed from text, plus the URLs the search used
// Per-minute rate limits (429) and overloads (503) are retried with back-off. A daily quota that is
// used up is reported as kind "quota" and never waited on: we don't know exactly when it resets.

const API = "https://generativelanguage.googleapis.com/v1beta";
const THINKING = { low: 512, medium: 1024, high: 4096 };
const MAX_RATE_LIMIT_WAIT_MS = 90000;

/** Converts a JSON Schema to Gemini's responseSchema dialect. */
export function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]));
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.required) out.required = schema.required;
  return out;
}

/** First balanced JSON object in a text (models sometimes wrap JSON in prose or code fences). */
export function extractJson(text) {
  const start = String(text || "").indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function createGemini({ apiKey, model = "gemini-2.5-flash", fallbackModels = [], fetchImpl = fetch, sleepFn = sleep, maxRetries = 4, onRequest = () => {} } = {}) {
  const exhausted = new Set();

  async function generate(body) {
    const usable = [model, ...fallbackModels.filter(m => m && m !== model)].filter(m => !exhausted.has(m));
    if (!usable.length) throw new JobError("Every configured Gemini model is out of free daily quota.", { kind: "quota" });
    for (let i = 0; ; i++) {
      try {
        return await generateWith(usable[i], body);
      } catch (error) {
        if (error.quotaExhausted) exhausted.add(usable[i]);
        if (!error.tryNextModel || i === usable.length - 1) throw error;
      }
    }
  }

  async function generateWith(modelName, body) {
    for (let attempt = 0; ; attempt++) {
      onRequest(modelName);
      let res;
      try {
        res = await fetchImpl(`${API}/models/${encodeURIComponent(modelName)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180000),
        });
      } catch (error) {
        if (attempt < maxRetries && isNetworkError(error)) {
          await sleepFn(backoffDelay(attempt, { baseMs: 3000, maxMs: 60000 }));
          continue;
        }
        throw new JobError(`Gemini API unreachable: ${error.message}`);
      }

      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;

      const message = json.error?.message || `HTTP ${res.status}`;
      const hint = json.error?.details?.find(d => d.retryDelay)?.retryDelay;
      const hinted = hint ? Math.ceil(parseFloat(hint) * 1000) + 1000 : 0;
      const daily = /PerDay/i.test(JSON.stringify(json.error?.details || [])) || hinted > MAX_RATE_LIMIT_WAIT_MS;
      // Grounding with Google Search has its own quota; a 429 without a retry hint means this key has
      // no (free) search quota at all. Plain requests may still work, so the model is not marked used up.
      if (res.status === 429 && body.tools && !hinted) {
        throw new JobError(`Google Search grounding is not available on this key (${modelName}): ${message}`, { kind: "search_unavailable" });
      }
      if (res.status === 429 && daily) {
        throw Object.assign(new JobError(`Gemini ${modelName} daily quota used up: ${message}`, { kind: "quota" }), { tryNextModel: true, quotaExhausted: true });
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await sleepFn(Math.max(hinted, backoffDelay(attempt, { baseMs: 5000, maxMs: 60000 })));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        throw Object.assign(new JobError(`Gemini ${modelName} unavailable (${res.status}): ${message}`), { tryNextModel: true });
      }
      if (/API key|API_KEY/i.test(message)) throw new JobError("Gemini rejected the API key. Check GEMINI_API_KEY.", { kind: "permanent" });
      throw Object.assign(new JobError(`Gemini rejected the request (${res.status}): ${message}`, { kind: "permanent" }), { tryNextModel: res.status === 404 });
    }
  }

  function textOf(response) {
    if (response.promptFeedback?.blockReason) throw new JobError(`Gemini blocked the prompt (${response.promptFeedback.blockReason}).`);
    const candidate = response.candidates?.[0];
    if (!candidate) throw new JobError("Gemini returned no answer.");
    if (candidate.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)) {
      throw new JobError(`Gemini stopped early (${candidate.finishReason}).`);
    }
    return (candidate.content?.parts || []).filter(part => part.text && !part.thought).map(part => part.text).join("");
  }

  const generationConfig = (effort, maxTokens) => {
    const thinkingBudget = THINKING[effort] ?? THINKING.medium;
    return { temperature: 0.7, maxOutputTokens: maxTokens + thinkingBudget, thinkingConfig: { thinkingBudget } };
  };

  async function json({ system, prompt, schema, effort = "medium", maxTokens = 4000 }) {
    const response = await generate({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { ...generationConfig(effort, maxTokens), responseMimeType: "application/json", responseSchema: toGeminiSchema(schema) },
    });
    try {
      return JSON.parse(textOf(response));
    } catch (error) {
      if (error instanceof JobError) throw error;
      throw new JobError(`Gemini returned invalid JSON: ${error.message}`);
    }
  }

  async function searchJson({ system, prompt, effort = "medium", maxTokens = 4000 }) {
    const response = await generate({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: generationConfig(effort, maxTokens),
    });
    const data = extractJson(textOf(response));
    if (!data) throw new JobError("Research response did not contain a JSON object.");
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    // Grounding chunks carry the page title (usually its domain) next to a redirect URL.
    const sources = chunks.map(chunk => ({ uri: chunk.web?.uri, title: chunk.web?.title || "" })).filter(s => s.uri);
    return { data, sources };
  }

  return { json, searchJson, model };
}

/** Distinct site names behind grounding chunks (titles are domains such as "britannica.com"). */
export function groundedDomains(sources) {
  return [...new Set(sources.map(s => String(s.title || "").toLowerCase().replace(/^www\./, "")).filter(Boolean))];
}
