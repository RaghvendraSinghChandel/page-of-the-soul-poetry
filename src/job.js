import fs from "node:fs";
import path from "node:path";

import { createGemini } from "./gemini.js";
import { createHistory } from "./history.js";
import { createInstagram } from "./instagramPublisher.js";
import { safeErrorText } from "./logger.js";
import { createMediaHost, validatePublicMedia } from "./mediaHost.js";
import { SIZE, buildSlides, displayLine, formPhrase, launchBrowser, renderJpeg } from "./render.js";
import { loadCorpus } from "./sources.js";
import { pickCategories } from "./themes.js";
import { planSlots } from "./slots.js";
import { localDate, sleep } from "./util.js";
import { writePost } from "./writer.js";

// generate: drafts POSTS_PER_RUN carousel posts (different categories), saves slides + post.md under
//           output/<date>/<post-id>/ and records them in state/history.json and posts_log.csv.
// publishNext: when PUBLISH_TO_INSTAGRAM=true, publishes the oldest draft as an Instagram carousel.
// tick: what the schedule runs; publishes one draft per daily slot (18:00 and 23:00), exactly on time.

const FORM_ROMAN = { "साखी": "sakhi", "दोहा": "doha", "सोरठा": "sortha" };

export function historyFor(config) {
  return createHistory({ stateDir: config.stateDir, csvFile: "posts_log.csv" });
}

/** The caption exactly as it goes to Instagram: text, credits, hashtags (all Hinglish). */
export function fullCaption(post, brand) {
  const credits = post.couplet
    ? `${FORM_ROMAN[post.couplet.form] || "doha"}: ${post.couplet.poetRoman} · ${post.couplet.workRoman} (${post.couplet.year}), ${post.couplet.number}\nKavita: mool rachna — ${brand}`
    : `Mool rachna — ${brand}`;
  return `${post.caption}\n\n${credits}\n\n${post.hashtags.join(" ")}`;
}

function shuffle(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function postMarkdown(post, brand) {
  const c = post.couplet;
  return `# ${post.title} — ${brand} (DRAFT)

**Tareekh:** ${post.date}  ·  **Status:** ${post.status}  ·  **Category:** ${post.categoryName}
**Slides:** ${post.slides.map(s => path.basename(s)).join(", ")} (1080×1350, carousel)

## A. Aaj ka vishay
- **Topic:** ${post.topic}
- **Real-life anubhav:** ${post.realLife}
- **Reader se judaav:** ${post.audienceConnect}

## B. Source
${
  c
    ? `- **Doha (mool shabd, edition se hoobahoo):**\n  > ${c.lines.map(displayLine).join("\n  > ")}\n- **Kavi:** ${c.poet} (${c.poetRoman})\n- **Kitaab:** ${c.work} (${c.year}), ${c.editor} — ${c.form} ${c.number}\n- **Source URL:** ${c.url}\n- **Permanent link (jis version se match kiya):** ${c.permalink}\n- **Verification:** VERIFIED — text live Wikisource page (revision ${c.revid}) par hoobahoo mila, ${post.createdAt}\n- **Copyright:** ${c.rights}\n- **Bhavarth (hamari samajh, shabdsah anuvaad nahi):** ${post.bhavarth}`
    : "- Is post mein koi classical quote nahi hai. Poori rachna **Mool Rachna — ${brand}** hai."
}

## C. Kavita — Mool Rachna — ${brand}${c ? ` (prerna: ${formPhrase({ form: c.form, poet: { roman: c.poetRoman } })})` : ""}
**${post.title}**

${post.poem.map(line => `> ${line}`).join("\n")}

## D. Caption (Instagram par jaisa jayega)
${fullCaption(post, brand)}

## Visual
- Scene: ${post.scene}
- Cover hook: ${post.hook}
`;
}

export async function generate({ config, logger, count = config.postsPerRun, now = new Date(), deps = {} }) {
  const history = deps.history || historyFor(config);
  const gemini = deps.gemini || createGemini({ apiKey: config.geminiApiKey, model: config.geminiModel, fallbackModels: config.geminiFallbackModels });
  const random = deps.random || Math.random;
  const date = localDate(now, config.timezone);
  const recent = history.recent();
  const categories = pickCategories(count, recent, random);
  const corpus = deps.corpus || (await loadCorpus({ userAgent: `PoetryPageBot/1.0 (${config.botContact})`, logger }));
  const used = new Set(recent.map(p => p.couplet?.id).filter(Boolean));
  const sameDay = recent.filter(p => p.date === date).length;

  const browser = deps.browser || (await launchBrowser({ chromiumPath: config.chromiumPath }));
  const made = [];
  const runTopics = [];
  try {
    for (const [index, category] of categories.entries()) {
      const id = `${date}-${sameDay + index + 1}`;
      const log = logger.child({ post: id, category: category.id });
      try {
        // Equal share per poet; poets already used in this run sit out (while another poet is left), so one run mixes voices.
        const runPoets = new Set(made.map(p => p.couplet?.poetRoman).filter(Boolean));
        const unused = corpus.filter(c => !used.has(c.id));
        const fresh = unused.filter(c => !runPoets.has(c.source.poet.roman));
        const byPoet = Map.groupBy(fresh.length ? fresh : unused, c => c.source.poet.roman);
        const candidates = shuffle([...byPoet.values()].flatMap(group => shuffle(group, random).slice(0, 25)), random);
        const draft = await writePost({ gemini, brand: config.brandName, category, candidates, recent, runTopics, maxAttempts: config.jobMaxAttempts, logger: log });
        const c = draft.couplet;
        if (c) used.add(c.id);
        runTopics.push(draft.topic);

        const dir = path.join(config.outputDir, date, id);
        const { slides } = buildSlides(draft, { brandName: config.brandName, seed: [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) });
        const files = [];
        for (const [i, html] of slides.entries()) files.push(await renderJpeg(browser, { html, file: path.join(dir, `slide-${i + 1}.jpg`) }));

        const post = {
          id,
          date,
          createdAt: new Date().toISOString(),
          status: "draft",
          category: category.id,
          categoryName: category.name,
          topic: draft.topic,
          realLife: draft.realLife,
          audienceConnect: draft.audienceConnect,
          title: draft.title,
          hook: draft.hook,
          poem: draft.poem,
          bhavarth: draft.bhavarth,
          caption: draft.caption,
          hashtags: draft.hashtags,
          scene: draft.scene,
          couplet: c && {
            id: c.id,
            number: c.number,
            lines: c.lines,
            poet: c.source.poet.hi,
            poetRoman: c.source.poet.roman,
            work: c.source.work.hi,
            workRoman: c.source.work.roman,
            editor: c.source.editor,
            year: c.source.year,
            form: c.source.form,
            rights: c.source.rights,
            url: c.url,
            permalink: c.permalink,
            revid: c.revid,
          },
          slides: files,
        };
        fs.writeFileSync(path.join(dir, "post.md"), postMarkdown(post, config.brandName));
        history.add(post);
        made.push(post);
        log.info("Draft ready", { title: post.title, couplet: c?.id || "none", slides: files.length, dir });
      } catch (error) {
        log.error("Post could not be drafted", { error });
      }
    }
  } finally {
    if (!deps.browser) await browser.close();
  }
  return made;
}

/** Re-renders the slides and post.md of every unpublished draft (after a brand or design change). */
export async function rerenderDrafts({ config, logger, deps = {} }) {
  const history = deps.history || historyFor(config);
  const drafts = history.load().filter(p => p.status === "draft");
  const browser = await launchBrowser({ chromiumPath: config.chromiumPath });
  try {
    for (const post of drafts) {
      const c = post.couplet;
      const couplet = c && { number: c.number, lines: c.lines, source: { poet: { hi: c.poet, roman: c.poetRoman }, work: { roman: c.workRoman }, year: c.year, form: c.form } };
      const { slides } = buildSlides({ ...post, couplet }, { brandName: config.brandName, seed: [...post.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) });
      const dir = path.dirname(post.slides[0]);
      for (const [i, html] of slides.entries()) await renderJpeg(browser, { html, file: path.join(dir, `slide-${i + 1}.jpg`) });
      fs.writeFileSync(path.join(dir, "post.md"), postMarkdown(post, config.brandName));
      logger.info("Draft re-rendered", { post: post.id, brand: config.brandName });
    }
  } finally {
    await browser.close();
  }
  return drafts;
}

/** publishAt (Date): get the carousel ready, then wait and publish at that moment. */
export async function publishNext({ config, logger, publishAt, deps = {} }) {
  if (!config.publishEnabled) {
    logger.info("PUBLISH_TO_INSTAGRAM is false: drafts only, nothing published.");
    return null;
  }
  const history = deps.history || historyFor(config);
  const ig = deps.instagram || createInstagram({ host: config.instagramApiHost, version: config.graphApiVersion, userId: config.instagramUserId, token: config.instagramToken, appSecret: config.metaAppSecret });
  const posts = history.load();

  // A crash between media_publish and recording leaves a post in "publishing": settle it first, never post twice.
  const pending = posts.find(p => p.status === "publishing" && p.containerId);
  if (pending) {
    const { status_code: code } = await ig.containerStatus(pending.containerId);
    if (code === "PUBLISHED") {
      const match = (await ig.recentMedia()).find(m => String(m.caption || "").startsWith(pending.caption.slice(0, 60)));
      const done = history.update(pending.id, { status: "published", mediaId: match?.id || "", permalink: match?.permalink || "", publishedAt: match?.timestamp || new Date().toISOString() });
      logger.info("Earlier publish confirmed", { post: pending.id, permalink: match?.permalink });
      return done;
    }
    if (code !== "FINISHED") {
      history.update(pending.id, { status: "draft", containerId: "" });
      logger.warn("Earlier container unusable; post goes back to draft", { post: pending.id, code });
    } else {
      return finish(pending, pending.containerId);
    }
  }

  const post = history.load().find(p => p.status === "draft");
  if (!post) {
    logger.info("No draft waiting to be published.");
    return null;
  }
  const log = logger.child({ post: post.id });
  const host = deps.mediaHost || createMediaHost(config, { logger: log });
  const hosted = [];
  try {
    await ig.checkAccount();
    const limit = await ig.publishingLimit();
    if (limit.total && limit.used >= limit.total) {
      log.warn("Instagram API publishing limit reached; trying again next run", limit);
      return null;
    }
    const children = [];
    for (const file of post.slides) {
      const media = await host.upload(file);
      hosted.push(media.ref);
      await (deps.validateMedia || validatePublicMedia)(media.url, SIZE);
      children.push(await ig.createCarouselItem(media.url));
    }
    for (const child of children) await ig.waitForContainer(child);
    const containerId = await ig.createCarousel(children, fullCaption(post, config.brandName));
    await ig.waitForContainer(containerId);
    const wait = publishAt ? publishAt.getTime() - Date.now() : 0;
    if (wait > 0) {
      log.info("Carousel ready; publishing exactly at the slot time", { at: publishAt.toISOString(), waitSeconds: Math.round(wait / 1000) });
      await (deps.sleepFn || sleep)(wait);
    }
    history.update(post.id, { status: "publishing", containerId });
    return await finish(post, containerId);
  } catch (error) {
    if (error.kind === "ambiguous") {
      log.warn("Publish outcome unknown; the next run checks the container before doing anything else", { error });
      throw error;
    }
    const attempts = (post.attempts || 0) + 1;
    const giveUp = error.kind === "permanent" || attempts >= config.jobMaxAttempts;
    history.update(post.id, { attempts, lastError: safeErrorText(error), ...(giveUp ? { status: "failed" } : {}) });
    log.error(giveUp ? "Publish failed; post marked failed" : "Publish failed; will retry next run", { error, attempts });
    throw error;
  } finally {
    for (const ref of hosted) await host.remove(ref);
  }

  async function finish(target, containerId) {
    try {
      const mediaId = await ig.publishContainer(containerId);
      const info = await ig.mediaInfo(mediaId).catch(() => ({}));
      const done = history.update(target.id, { status: "published", mediaId, permalink: info.permalink || "", publishedAt: info.timestamp || new Date().toISOString() });
      logger.info("Published on Instagram", { post: target.id, permalink: info.permalink });
      return done;
    } catch (error) {
      if (error.kind !== "ambiguous") history.update(target.id, { status: "draft", containerId: "" });
      throw error;
    }
  }
}

/**
 * Runs every slot that is due now (see slots.js), then makes sure the next slot has a draft waiting.
 * Safe to trigger any number of times: a slot is published at most once.
 */
export async function tick({ config, logger, now = () => new Date(), checkOnly = false, deps = {} }) {
  const history = deps.history || historyFor(config);
  const plan = () =>
    planSlots({ now: now(), timeZone: config.timezone, prepareAheadMinutes: config.prepareAheadMinutes, runGraceMinutes: config.runGraceMinutes, maxAttempts: config.jobMaxAttempts, getState: key => history.slot(key) });

  if (checkOnly) return { work: plan().some(s => s.action === "run" || s.action === "missed") };

  const ran = [];
  const missed = [];
  const attempted = new Set();
  for (;;) {
    const current = plan();
    for (const slot of current.filter(s => s.action === "missed")) {
      history.updateSlot(slot.key, { status: "missed", scheduledFor: slot.at.toISOString() });
      logger.error("Slot missed: no run published it within the grace window", { slot: slot.key, graceMinutes: config.runGraceMinutes });
      missed.push(slot.key);
    }
    const next = current.find(s => s.action === "run" && !attempted.has(s.key));
    if (!next) break;
    attempted.add(next.key);
    ran.push({ key: next.key, status: await runSlot(next, { config, logger, history, deps }) });
  }

  // Draft the next posts right after the last one goes out, so a slow Gemini or a source outage never delays a slot.
  if (ran.some(r => r.status === "published") && !history.load().some(p => p.status === "draft")) {
    try {
      await generate({ config, logger, deps: { ...deps, history } });
    } catch (error) {
      logger.error("Next drafts could not be written; the next slot run writes one before publishing", { error });
    }
  }
  return { ran, missed };
}

async function runSlot(slot, { config, logger, history, deps }) {
  const log = logger.child({ slot: slot.key });
  history.updateSlot(slot.key, { status: "running", scheduledFor: slot.at.toISOString(), attempts: (history.slot(slot.key)?.attempts || 0) + 1 });
  try {
    if (!config.publishEnabled) {
      history.updateSlot(slot.key, { status: "dry_run" });
      log.info("PUBLISH_TO_INSTAGRAM is false: slot recorded as a dry run, nothing published.");
      return "dry_run";
    }
    if (!history.load().some(p => p.status === "draft" || p.status === "publishing")) {
      log.warn("No draft waiting for this slot; writing one now");
      await generate({ config, logger: log, count: 1, deps: { ...deps, history } });
    }
    const post = await publishNext({ config, logger: log, publishAt: slot.at, deps: { ...deps, history } });
    if (post?.status === "published") {
      history.update(post.id, { slot: slot.key });
      history.updateSlot(slot.key, { status: "published", post: post.id, permalink: post.permalink, publishedAt: post.publishedAt, lastError: "" });
      return "published";
    }
    history.updateSlot(slot.key, { status: "pending", lastError: "nothing published (no draft, or the API limit was reached)" });
    return "pending";
  } catch (error) {
    history.updateSlot(slot.key, { status: "pending", lastError: safeErrorText(error) });
    log.error("Slot run failed; a backup run will try again", { error });
    return "error";
  }
}
