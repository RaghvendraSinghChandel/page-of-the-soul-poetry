import fs from "node:fs";
import path from "node:path";

import { refreshInstagramToken } from "./instagramPublisher.js";

// The Instagram Login token (graph.instagram.com) lasts 60 days. A weekly run renews it and writes the new
// value back into .env (INSTAGRAM_ACCESS_TOKEN_POETRY only; nothing else in the file changes), or, on GitHub
// Actions, into the file given by `out` (the workflow stores it encrypted). The expiry is kept in
// state/token.json so other commands can warn when it is close.

const ENV_KEY = "INSTAGRAM_ACCESS_TOKEN_POETRY";
const WARN_DAYS = 10;

const stateFile = config => path.join(config.stateDir, "token.json");

export function tokenState(config) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(config), "utf8"));
  } catch {
    return {};
  }
}

/** Days until the stored expiry, or null when no refresh has recorded one yet. */
export function daysLeft(config, now = Date.now()) {
  const { expiresAt } = tokenState(config);
  return expiresAt ? (Date.parse(expiresAt) - now) / 86400000 : null;
}

export function warnTokenExpiry(config, logger) {
  const days = daysLeft(config);
  if (days !== null && days < WARN_DAYS) logger.warn("Instagram token expires soon; check the weekly refresh-token run (logs/refresh-token.*.log)", { expiresAt: tokenState(config).expiresAt, daysLeft: Math.floor(days) });
}

/** Replaces only the token line of an .env file, atomically, keeping its permissions. */
export function writeEnvToken(envFile, token) {
  const text = fs.readFileSync(envFile, "utf8");
  const line = new RegExp(`^${ENV_KEY}=.*$`, "m");
  const next = line.test(text) ? text.replace(line, `${ENV_KEY}=${token}`) : `${text.replace(/\n?$/, "\n")}${ENV_KEY}=${token}\n`;
  const tmp = `${envFile}.tmp`;
  fs.writeFileSync(tmp, next, { mode: fs.statSync(envFile).mode & 0o777 });
  fs.renameSync(tmp, envFile);
}

/** maxAgeDays: skip when the last renewal is more recent than this. */
export async function refreshToken({ config, logger, envFile = ".env", out = "", maxAgeDays = 0, fetchImpl = fetch }) {
  if (config.instagramApiHost !== "graph.instagram.com") {
    logger.info("Facebook Login tokens are not renewed this way; nothing to refresh.");
    return null;
  }
  if (!config.instagramToken) {
    logger.error(`${ENV_KEY} is missing; nothing to refresh.`);
    return null;
  }
  const { refreshedAt } = tokenState(config);
  if (maxAgeDays && refreshedAt && Date.now() - Date.parse(refreshedAt) < maxAgeDays * 86400000) {
    logger.info("Instagram token renewed recently; nothing to do", { refreshedAt });
    return null;
  }
  const { token, expiresAt } = await refreshInstagramToken({ token: config.instagramToken, fetchImpl });
  if (out) fs.writeFileSync(out, token, { mode: 0o600 });
  else writeEnvToken(envFile, token);
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.writeFileSync(stateFile(config), `${JSON.stringify({ refreshedAt: new Date().toISOString(), expiresAt }, null, 2)}\n`);
  logger.info(`Instagram token renewed and saved to ${out ? "the workflow's token file" : ".env"}`, { expiresAt, changed: token !== config.instagramToken });
  return { expiresAt };
}
