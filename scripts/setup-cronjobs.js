#!/usr/bin/env node
import "dotenv/config";

// Creates (or updates) the cron-job.org jobs that trigger the GitHub workflow on time.
// GitHub's own schedule often starts runs late; a workflow_dispatch from cron-job.org starts within seconds.
// Every trigger runs `tick`, which only does what is due, so extra or duplicate triggers never double-post.
//
// Needs in .env (never committed):
//   CRONJOB_ORG_API_KEY – console.cron-job.org → Settings → API → Create API key
//   GH_DISPATCH_TOKEN   – fine-grained GitHub token, only this repo, "Actions: Read and write"
//   GITHUB_REPOSITORY   – owner/repo (defaults to the repo below)
//
// Usage: npm run cron:setup [-- --dry-run]

const API = "https://api.cron-job.org";
const TITLE_PREFIX = "Poetry IG";
const repo = process.env.GITHUB_REPOSITORY || "RaghvendraSinghChandel/page-of-the-soul-poetry";
const dryRun = process.argv.includes("--dry-run");

// IST trigger times: each main run starts ~20 min before its slot (setup, and a fresh draft if none is waiting),
// gets the carousel ready, then publishes exactly at 18:00 / 23:00; the backups catch a failed or dropped run.
const TRIGGERS = [
  { title: "18:00 post – main", hour: 17, minute: 40 },
  { title: "18:00 post – backup", hour: 18, minute: 5 },
  { title: "18:00 post – backup 2", hour: 18, minute: 30 },
  { title: "23:00 post – main", hour: 22, minute: 40 },
  { title: "23:00 post – backup", hour: 23, minute: 5 },
  { title: "23:00 post – backup 2", hour: 23, minute: 30 },
];

const apiKey = process.env.CRONJOB_ORG_API_KEY;
const ghToken = process.env.GH_DISPATCH_TOKEN;
if (!apiKey || !ghToken) {
  console.error("Set CRONJOB_ORG_API_KEY and GH_DISPATCH_TOKEN in .env first (see the comments at the top of this file).");
  process.exit(2);
}

const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/poet.yml/dispatches`;
const dispatchHeaders = {
  Authorization: `Bearer ${ghToken}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "page-of-the-soul-cron",
};
const dispatchBody = JSON.stringify({ ref: "main", inputs: { mode: "tick" } });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function cron(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    // The API rate-limits bursts (notably job creation); wait and try again.
    if (res.status === 429 && attempt < 5) {
      const wait = 20000 * (attempt + 1);
      console.log(`  cron-job.org rate limit; waiting ${wait / 1000}s…`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`cron-job.org ${method} ${path} → HTTP ${res.status} ${JSON.stringify(json)}`);
    await sleep(1100); // stay under the per-second request limit
    return json;
  }
}

const jobFor = trigger => ({
  url: dispatchUrl,
  title: `${TITLE_PREFIX} – ${trigger.title}`,
  enabled: true,
  saveResponses: true,
  requestMethod: 1, // POST
  requestTimeout: 30,
  schedule: { timezone: "Asia/Kolkata", expiresAt: 0, hours: [trigger.hour], minutes: [trigger.minute], mdays: [-1], months: [-1], wdays: [-1] },
  extendedData: { headers: dispatchHeaders, body: dispatchBody },
  notification: { onFailure: true, onSuccess: false, onDisable: true },
});

// 1. Prove the GitHub token can trigger the workflow (a tick outside a slot window just exits).
const check = await fetch(dispatchUrl, { method: "POST", headers: dispatchHeaders, body: dispatchBody });
if (check.status !== 204) {
  console.error(`GitHub rejected GH_DISPATCH_TOKEN (HTTP ${check.status}): ${(await check.text()).slice(0, 300)}`);
  console.error("It needs: Only select repositories → this repo, and Repository permissions → Actions: Read and write.");
  process.exit(1);
}
console.log("✔ GH_DISPATCH_TOKEN can trigger the workflow (a test tick was started)");

// 2. Create or update the jobs, matched by title.
const { jobs = [] } = await cron("GET", "/jobs");
const existing = new Map(jobs.filter(j => j.title?.startsWith(TITLE_PREFIX)).map(j => [j.title, j.jobId]));
for (const trigger of TRIGGERS) {
  const job = jobFor(trigger);
  const id = existing.get(job.title);
  const when = `${String(trigger.hour).padStart(2, "0")}:${String(trigger.minute).padStart(2, "0")} IST`;
  if (dryRun) {
    console.log(`would ${id ? "update" : "create"}: ${job.title} at ${when}`);
    continue;
  }
  if (id) await cron("PATCH", `/jobs/${id}`, { job });
  else await cron("PUT", "/jobs", { job });
  console.log(`✔ ${id ? "updated" : "created"}: ${job.title} at ${when}`);
  existing.delete(job.title);
}
// Jobs from an older schedule (titles no longer in TRIGGERS) are removed.
for (const [title, id] of existing) {
  if (dryRun) console.log(`would delete old job: ${title}`);
  else {
    await cron("DELETE", `/jobs/${id}`);
    console.log(`✔ deleted old job: ${title}`);
  }
}
