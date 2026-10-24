import "dotenv/config";

// All settings come from environment variables (see .env.example).
// loadConfig() takes an env object so tests can build configs without touching process.env.

export function loadConfig(source = process.env) {
  const env = (key, fallback = "") => {
    const value = source[key];
    return value === undefined || value === "" ? fallback : String(value).trim();
  };
  const list = (key, fallback = "") =>
    env(key, fallback)
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
  const int = (key, fallback, min, max) => {
    const value = Number.parseInt(env(key, String(fallback)), 10);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  };
  const bool = (key, fallback) => ["true", "1", "yes", "on"].includes(env(key, String(fallback)).toLowerCase());
  const oneOf = (key, allowed, fallback) => {
    const value = env(key, fallback).toLowerCase();
    return allowed.includes(value) ? value : fallback;
  };

  return {
    // Instagram (official Graph API). Use this page's own account's own credentials,
    // never the Daily Fact Check account's.
    // *_POETRY names keep this account's settings apart from the Daily Fact Check ones
    // (INSTAGRAM_USER_ID / INSTAGRAM_ACCESS_TOKEN / META_APP_SECRET), which are deliberately never read here.
    instagramUserId: env("INSTAGRAM_USER_ID_POETRY"),
    instagramToken: env("INSTAGRAM_ACCESS_TOKEN_POETRY"),
    instagramApiHost: oneOf("INSTAGRAM_API_HOST", ["graph.facebook.com", "graph.instagram.com"], "graph.instagram.com"),
    graphApiVersion: env("GRAPH_API_VERSION", "v23.0"),
    metaAppSecret: env("META_APP_SECRET_POETRY"),
    // Master switch. While false, posts are only drafted (nothing is uploaded or published).
    publishEnabled: bool("PUBLISH_TO_INSTAGRAM", false),

    mediaHost: oneOf("MEDIA_HOST", ["facebook", "github"], "facebook"),
    facebookPageId: env("FACEBOOK_PAGE_ID"),
    facebookPageToken: env("FACEBOOK_PAGE_ACCESS_TOKEN"),
    githubToken: env("GITHUB_TOKEN"),
    githubRepository: env("GITHUB_REPOSITORY"),
    mediaBranch: env("MEDIA_BRANCH", "ig-media"),
    mediaRetentionDays: int("MEDIA_RETENTION_DAYS", 7, 1, 90),

    // Writing: Gemini free tier
    geminiApiKey: env("GEMINI_API_KEY"),
    geminiModel: env("GEMINI_MODEL", "gemini-3.5-flash"),
    geminiFallbackModels: list("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash-lite,gemini-flash-lite-latest"),
    botContact: env("BOT_CONTACT", "contact: set BOT_CONTACT"),

    // Content
    postsPerRun: int("POSTS_PER_RUN", 3, 1, 5),
    brandName: env("BRAND_NAME", "page_of_the__soul"),
    brandHandle: env("BRAND_HANDLE"),

    timezone: env("TIMEZONE", "Asia/Kolkata"),
    jobMaxAttempts: int("JOB_MAX_ATTEMPTS", 3, 1, 6),
    // A slot run may start this many minutes before the slot (it prepares, then waits to publish on time)…
    prepareAheadMinutes: int("PREPARE_AHEAD_MINUTES", 20, 0, 60),
    // …and still publishes up to this many minutes late (a backup run after a failed or dropped one).
    runGraceMinutes: int("RUN_GRACE_MINUTES", 120, 5, 360),

    // Paths
    stateDir: env("STATE_DIR", "state"),
    outputDir: env("OUTPUT_DIR", "output"),
    logDir: env("LOG_DIR", "logs"),
    logLevel: oneOf("LOG_LEVEL", ["debug", "info", "warn", "error"], "info"),
    chromiumPath: env("CHROMIUM_PATH"),
  };
}

/** Values that must never appear in logs. */
export function secretValues(config) {
  return [config.instagramToken, config.metaAppSecret, config.facebookPageToken, config.githubToken, config.geminiApiKey].filter(Boolean);
}

/** Returns { errors, warnings }. `publishing` adds the checks a live publish needs. */
export function validateConfig(config, { publishing = config.publishEnabled } = {}) {
  const errors = [];
  const warnings = [];

  if (!config.geminiApiKey) errors.push("GEMINI_API_KEY is missing (free key: aistudio.google.com → Get API key).");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.timezone });
  } catch {
    errors.push(`TIMEZONE "${config.timezone}" is not a valid IANA timezone.`);
  }
  if (!/^v\d+\.\d+$/.test(config.graphApiVersion)) errors.push(`GRAPH_API_VERSION "${config.graphApiVersion}" must look like v23.0.`);

  if (publishing) {
    if (!config.instagramUserId) errors.push("INSTAGRAM_USER_ID_POETRY is missing (this page's numeric professional account ID).");
    else if (!/^\d+$/.test(config.instagramUserId)) errors.push("INSTAGRAM_USER_ID_POETRY must be numeric (e.g. 17841420312966798), not the username.");
    if (!config.instagramToken) errors.push("INSTAGRAM_ACCESS_TOKEN_POETRY is missing.");
    if (config.mediaHost === "facebook" && (!config.facebookPageId || !config.facebookPageToken)) {
      errors.push("MEDIA_HOST=facebook needs FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN.");
    }
    if (config.mediaHost === "github" && (!config.githubToken || !config.githubRepository)) {
      errors.push("MEDIA_HOST=github needs GITHUB_TOKEN and GITHUB_REPOSITORY (owner/repo, public).");
    }
  }
  return { errors, warnings };
}
