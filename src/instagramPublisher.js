import crypto from "node:crypto";

import { JobError, backoffDelay, isNetworkError, sleep } from "./util.js";

// Official Instagram Graph API content publishing:
//   POST /{ig-user-id}/media           → one item container per slide (is_carousel_item=true)
//   POST /{ig-user-id}/media           → carousel container (media_type=CAROUSEL, children, caption)
//   POST /{ig-user-id}/media           → Reel container (media_type=REELS, video_url, caption, audio_name)
//   GET  /{container-id}?fields=status_code   until FINISHED
//   POST /{ig-user-id}/media_publish   → media ID
//
// Errors are classified so the job knows what to do:
//   permanent – expired/invalid token, missing permission, invalid media, bad request: never auto-retried
//   retryable – network, 5xx, rate limits, transient media fetch problems
//   ambiguous – the publish call itself failed without an answer; the job reconciles before any retry

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const RETRYABLE_SUBCODES = new Set([2207001, 2207003, 2207020, 2207042, 2207052]);

export function classifyMetaError(status, body) {
  const error = body?.error || {};
  const code = error.code;
  const sub = error.error_subcode;
  const detail = [error.message, error.error_user_msg].filter(Boolean).join(" – ") || `HTTP ${status}`;
  const message = `Instagram API error (code ${code ?? "?"}${sub ? `/${sub}` : ""}): ${detail}`;
  if (code === 190) return new JobError(`${message}. The access token is invalid or expired; generate a new one.`, { kind: "permanent", code });
  if (code === 10 || code === 3 || (code >= 200 && code <= 299)) {
    return new JobError(`${message}. The token lacks a required permission (e.g. instagram_content_publish).`, { kind: "permanent", code });
  }
  if (RATE_LIMIT_CODES.has(code) || RETRYABLE_SUBCODES.has(sub) || error.is_transient || status >= 500 || code === 9004 || code === 2) {
    return new JobError(message, { kind: "retryable", code });
  }
  return new JobError(message, { kind: "permanent", code });
}

export function createInstagram({ host = "graph.facebook.com", version = "v23.0", userId, token, appSecret = "", fetchImpl = fetch, sleepFn = sleep }) {
  const base = `https://${host}/${version}`;
  const proof = appSecret && host === "graph.facebook.com" ? crypto.createHmac("sha256", appSecret).update(token).digest("hex") : "";

  async function call(method, path, params = {}, { retries = 2 } = {}) {
    const query = new URLSearchParams({ ...params, access_token: token, ...(proof ? { appsecret_proof: proof } : {}) });
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res =
          method === "GET"
            ? await fetchImpl(`${base}/${path}?${query}`, { signal: AbortSignal.timeout(60000) })
            : await fetchImpl(`${base}/${path}`, { method, body: query, signal: AbortSignal.timeout(120000) });
      } catch (error) {
        if (attempt < retries && isNetworkError(error)) {
          await sleepFn(backoffDelay(attempt, { baseMs: 2000, maxMs: 20000 }));
          continue;
        }
        throw new JobError(`Instagram API unreachable: ${error.message}`, { kind: "retryable", cause: error });
      }
      const body = await res.json().catch(() => ({}));
      if (res.ok && !body.error) return body;
      const error = classifyMetaError(res.status, body);
      if (error.kind === "retryable" && attempt < retries && !RATE_LIMIT_CODES.has(error.code)) {
        await sleepFn(backoffDelay(attempt, { baseMs: 3000, maxMs: 30000 }));
        continue;
      }
      throw error;
    }
  }

  return {
    /** Confirms the token works for this account. */
    checkAccount: () => call("GET", userId, { fields: "id,username" }),

    /** Posts published through the API in the last 24 h vs the account's limit. */
    async publishingLimit() {
      const body = await call("GET", `${userId}/content_publishing_limit`, { fields: "quota_usage,config" });
      const row = body.data?.[0] || {};
      return { used: row.quota_usage ?? 0, total: row.config?.quota_total ?? null };
    },

    async createContainer({ imageUrl, caption, story }) {
      const params = story ? { image_url: imageUrl, media_type: "STORIES" } : { image_url: imageUrl, caption };
      return (await call("POST", `${userId}/media`, params, { retries: 0 })).id;
    },

    /** One image of a carousel (no caption; the caption goes on the parent). */
    async createCarouselItem(imageUrl) {
      return (await call("POST", `${userId}/media`, { image_url: imageUrl, is_carousel_item: "true" }, { retries: 0 })).id;
    },

    /** Carousel container from 2–10 FINISHED item containers. */
    async createCarousel(children, caption) {
      return (await call("POST", `${userId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }, { retries: 0 })).id;
    },

    /** Reel container from a public MP4 URL; thumb_offset 0 = the cover slide is the thumbnail. */
    async createReel({ videoUrl, caption, audioName = "" }) {
      const params = { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true", thumb_offset: "0", ...(audioName ? { audio_name: audioName } : {}) };
      return (await call("POST", `${userId}/media`, params, { retries: 0 })).id;
    },

    containerStatus: id => call("GET", id, { fields: "status_code,status" }),

    /** Polls until the container is FINISHED; ERROR/EXPIRED throw. */
    async waitForContainer(id, { timeoutMs = 120000, intervalMs = 4000 } = {}) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        let code, status;
        try {
          ({ status_code: code, status } = await call("GET", id, { fields: "status_code,status" }));
        } catch (error) {
          // A container created a moment ago can briefly read as "does not exist" (code 24 / 2207006).
          if (error.code !== 24 || Date.now() > until) throw error;
          code = "NOT_VISIBLE_YET";
        }
        if (code === "FINISHED" || code === "PUBLISHED") return code;
        if (code === "ERROR") throw new JobError(`Instagram could not process the media: ${status || "ERROR"}`, { kind: "permanent" });
        if (code === "EXPIRED") throw new JobError("Instagram media container expired before publishing.", { kind: "retryable" });
        if (Date.now() > until) throw new JobError(`Media container still ${code} after ${timeoutMs / 1000}s.`, { kind: "retryable" });
        await sleepFn(intervalMs);
      }
    },

    /** Publishes a FINISHED container. A failure without a response is reported as ambiguous, never retried here. */
    async publishContainer(id) {
      try {
        return (await call("POST", `${userId}/media_publish`, { creation_id: id }, { retries: 0 })).id;
      } catch (error) {
        if (error.kind === "retryable" && !error.code) throw new JobError(`Publish outcome unknown: ${error.message}`, { kind: "ambiguous" });
        throw error;
      }
    },

    mediaInfo: id => call("GET", id, { fields: "id,permalink,timestamp,media_product_type" }),
    recentMedia: () => call("GET", `${userId}/media`, { fields: "id,caption,timestamp,permalink,media_product_type", limit: "10" }).then(b => b.data || []),
    recentStories: () => call("GET", `${userId}/stories`, { fields: "id,timestamp,permalink,media_product_type" }).then(b => b.data || []),

    /** Metric values for one media object; metrics the API rejects are skipped individually. */
    async insights(id, metrics) {
      const out = {};
      for (const metric of metrics) {
        try {
          const body = await call("GET", `${id}/insights`, { metric }, { retries: 0 });
          const value = body.data?.[0]?.values?.[0]?.value ?? body.data?.[0]?.total_value?.value;
          if (value !== undefined) out[metric] = value;
        } catch (error) {
          if (error.kind === "permanent" && [190, 10].includes(error.code)) throw error;
        }
      }
      return out;
    },
  };
}

/**
 * Renews a long-lived Instagram Login token (graph.instagram.com). Instagram allows this once the token is
 * at least 24 hours old and not yet expired; the renewed token is valid for another 60 days.
 * Returns { token, expiresAt }.
 */
export async function refreshInstagramToken({ token, fetchImpl = fetch, now = () => new Date() }) {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new JobError(`Instagram token refresh unreachable: ${error.message}`, { kind: "retryable" });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error || !body.access_token) throw classifyMetaError(res.status, body.error ? body : { error: { message: "no access_token in refresh response" } });
  return { token: body.access_token, expiresAt: new Date(now().getTime() + Number(body.expires_in || 0) * 1000).toISOString() };
}
