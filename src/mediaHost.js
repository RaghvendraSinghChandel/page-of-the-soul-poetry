import fs from "node:fs";
import path from "node:path";

import { classifyMetaError } from "./instagramPublisher.js";
import { jpegSize } from "./render.js";
import { JobError, sleep } from "./util.js";

// Instagram downloads media from a public HTTPS URL, so each JPEG is hosted for free before publishing:
//   facebook – uploaded as an UNPUBLISHED photo to your Facebook Page (not shown on the Page);
//              Instagram fetches it from Facebook's CDN. Deleted again after publishing.
//   github   – committed to a media branch of a PUBLIC repo and served from raw.githubusercontent.com;
//              files older than MEDIA_RETENTION_DAYS are removed.

export function createMediaHost(config, { fetchImpl = fetch, logger } = {}) {
  return config.mediaHost === "github" ? githubHost(config, { fetchImpl, logger }) : facebookHost(config, { fetchImpl, logger });
}

function facebookHost(config, { fetchImpl }) {
  const base = `https://graph.facebook.com/${config.graphApiVersion}`;
  const token = config.facebookPageToken;

  async function graph(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw classifyMetaError(res.status, body);
    return body;
  }

  return {
    async upload(file) {
      const form = new FormData();
      form.set("published", "false");
      form.set("access_token", token);
      form.set("source", new Blob([fs.readFileSync(file)], { type: "image/jpeg" }), path.basename(file));
      const { id } = await graph(await fetchImpl(`${base}/${config.facebookPageId}/photos`, { method: "POST", body: form, signal: AbortSignal.timeout(120000) }));
      const { images = [] } = await graph(await fetchImpl(`${base}/${id}?fields=images&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(30000) }));
      const best = [...images].sort((a, b) => b.width - a.width)[0];
      if (!best?.source) throw new JobError("Facebook returned no URL for the uploaded photo.");
      return { url: best.source, ref: id };
    },
    async remove(ref) {
      await fetchImpl(`${base}/${ref}?access_token=${encodeURIComponent(token)}`, { method: "DELETE", signal: AbortSignal.timeout(30000) }).catch(() => {});
    },
    async cleanup() {},
  };
}

function githubHost(config, { fetchImpl, logger }) {
  const repo = config.githubRepository;
  const branch = config.mediaBranch;
  const headers = { authorization: `Bearer ${config.githubToken}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const api = async (method, url, body) => {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${url}`, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  };

  async function ensureBranch() {
    if ((await api("GET", `/branches/${branch}`)).ok) return;
    const repoInfo = await api("GET", "");
    const head = await api("GET", `/git/ref/heads/${repoInfo.json.default_branch}`);
    const created = await api("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: head.json.object?.sha });
    if (!created.ok && created.status !== 422) throw new JobError(`Could not create branch ${branch}: HTTP ${created.status} ${created.json.message || ""}`);
  }

  return {
    async upload(file) {
      await ensureBranch();
      const target = `media/${path.basename(path.dirname(file))}/${path.basename(file)}`;
      const existing = await api("GET", `/contents/${target}?ref=${branch}`);
      const put = await api("PUT", `/contents/${target}`, {
        message: `media: ${target}`,
        content: fs.readFileSync(file).toString("base64"),
        branch,
        ...(existing.ok ? { sha: existing.json.sha } : {}),
      });
      if (!put.ok) {
        throw new JobError(`GitHub upload failed: HTTP ${put.status} ${put.json.message || ""}`, { kind: put.status === 401 || put.status === 403 ? "permanent" : "retryable" });
      }
      return { url: `https://raw.githubusercontent.com/${repo}/${branch}/${target}`, ref: target };
    },
    async remove() {},
    async cleanup(now = new Date()) {
      const cutoff = now.getTime() - config.mediaRetentionDays * 86400000;
      const dirs = await api("GET", `/contents/media?ref=${branch}`);
      if (!dirs.ok) return;
      for (const dir of dirs.json.filter(entry => entry.type === "dir" && Date.parse(`${entry.name}T00:00:00Z`) < cutoff)) {
        const files = await api("GET", `/contents/${dir.path}?ref=${branch}`);
        for (const f of files.ok ? files.json : []) {
          await api("DELETE", `/contents/${f.path}`, { message: `media cleanup: ${f.path}`, sha: f.sha, branch });
        }
        logger?.info("Removed old hosted media", { dir: dir.path });
      }
    },
  };
}

/**
 * Confirms that Instagram will be able to fetch the media: public HTTPS, no auth, JPEG, ≤ 8 MB,
 * expected dimensions. Retries briefly because CDNs can take a few seconds to serve a new file.
 */
export async function validatePublicMedia(url, { width, height }, { fetchImpl = fetch, sleepFn = sleep, attempts = 4 } = {}) {
  if (!/^https:\/\//.test(url)) throw new JobError(`Media URL is not HTTPS: ${url}`, { kind: "permanent" });
  let last = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
      const type = res.headers.get("content-type") || "";
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        const size = jpegSize(bytes);
        if (!/image\/jpe?g/.test(type) && !size) throw new JobError(`Hosted media is ${type || "unknown type"}, not JPEG.`, { kind: "permanent" });
        if (bytes.length > 8 * 1024 * 1024) throw new JobError(`Hosted media is ${(bytes.length / 1048576).toFixed(1)} MB (max 8 MB).`, { kind: "permanent" });
        // Hosts may re-encode; what matters to Instagram is the aspect ratio and a sensible width.
        if (!size || Math.abs(size.width / size.height - width / height) > 0.01 || size.width < 1000 || size.width > 1440) {
          throw new JobError(`Hosted media is ${size ? `${size.width}×${size.height}` : "unreadable"}, expected ${width}×${height}.`, { kind: "permanent" });
        }
        return { bytes: bytes.length, ...size };
      }
      last = `HTTP ${res.status}`;
    } catch (error) {
      if (error instanceof JobError) throw error;
      last = error.message;
    }
    await sleepFn(3000 * (i + 1));
  }
  throw new JobError(`Hosted media is not publicly reachable (${last}).`, { kind: "retryable" });
}
