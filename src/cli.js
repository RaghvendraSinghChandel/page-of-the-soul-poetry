import { loadConfig, secretValues, validateConfig } from "./config.js";
import { createInstagram } from "./instagramPublisher.js";
import fs from "node:fs";

import { generate, historyFor, publishNext, rerenderDrafts, tick } from "./job.js";
import { createLogger, registerSecrets } from "./logger.js";
import { daysLeft, refreshToken, tokenState, warnTokenExpiry } from "./token.js";

// Commands:
//   generate [--count N]   draft N posts (default POSTS_PER_RUN) into output/<date>/
//   tick [--check]         what the schedule runs: publish today's due slot (18:15 / 23:00) on time;
//                          --check only reports whether anything is due (work=true|false)
//   publish-next           publish the oldest draft now (only when PUBLISH_TO_INSTAGRAM=true)
//   check-config           settings and, if credentials are set, the Instagram account (never publishes)
//   rerender               re-render unpublished drafts (after a brand or design change)
//   refresh-token [--out FILE] [--max-age-days N]
//                          renew the 60-day Instagram token and save it to .env (or FILE); skip if renewed < N days ago
//   history                list recorded posts

const [command = "generate", ...args] = process.argv.slice(2);
const config = loadConfig();
registerSecrets(secretValues(config));
const logger = createLogger({ level: config.logLevel, logDir: config.logDir, context: { cmd: command } });

function option(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  if (command === "history") {
    for (const p of historyFor(config).load()) console.log(`${p.id.padEnd(14)} ${p.status.padEnd(10)} ${(p.categoryName || p.category || "").padEnd(28)} ${p.title || p.topic}${p.permalink ? `  ${p.permalink}` : ""}`);
    return 0;
  }

  const { errors } = validateConfig(config, { publishing: ["publish-next", "tick"].includes(command) && config.publishEnabled });
  if (errors.length) {
    errors.forEach(e => logger.error(e));
    return 2;
  }

  if (command === "check-config") {
    logger.info("Config OK", { postsPerRun: config.postsPerRun, publish: config.publishEnabled, model: config.geminiModel });
    if (config.instagramUserId && config.instagramToken) {
      const ig = createInstagram({ host: config.instagramApiHost, version: config.graphApiVersion, userId: config.instagramUserId, token: config.instagramToken, appSecret: config.metaAppSecret });
      const account = await ig.checkAccount();
      const limit = await ig.publishingLimit();
      logger.info("Instagram account reachable", { username: account.username, publishedLast24h: limit.used, limit: limit.total });
      const days = daysLeft(config);
      logger.info(days === null ? "Token expiry not known yet (recorded after the first refresh-token run)" : "Token expiry", { expiresAt: tokenState(config).expiresAt, daysLeft: days === null ? undefined : Math.floor(days) });
    } else {
      logger.info("No Instagram credentials set: posts will be drafted only.");
    }
    return 0;
  }

  if (command === "generate") {
    const count = option("count") ? Math.min(5, Math.max(1, Number(option("count")))) : config.postsPerRun;
    const made = await generate({ config, logger, count });
    logger.info(`Run finished: ${made.length}/${count} drafts ready`, { posts: made.map(p => p.id) });
    return made.length ? 0 : 1;
  }

  if (command === "rerender") {
    const drafts = await rerenderDrafts({ config, logger });
    logger.info(`${drafts.length} drafts re-rendered`);
    return 0;
  }

  if (command === "refresh-token") {
    await refreshToken({ config, logger, out: option("out") || "", maxAgeDays: Number(option("max-age-days") || 0) });
    return 0;
  }

  if (command === "tick") {
    if (args.includes("--check")) {
      const { work } = await tick({ config, logger, checkOnly: true });
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `work=${work}\n`);
      logger.info(work ? "A slot is due: running" : "No slot due now");
      return 0;
    }
    warnTokenExpiry(config, logger);
    const { ran, missed } = await tick({ config, logger });
    logger.info("Tick finished", { ran, missed });
    return ran.some(r => r.status === "error") || missed.length ? 1 : 0;
  }

  if (command === "publish-next") {
    warnTokenExpiry(config, logger);
    await publishNext({ config, logger });
    return 0;
  }

  logger.error(`Unknown command "${command}". Use tick, generate, publish-next, rerender, refresh-token, check-config or history.`);
  return 2;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    logger.error("Run failed", { error });
    process.exit(1);
  });
