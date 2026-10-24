# page_of_the__soul: Hinglish poetry automation

Every day this publishes **two Instagram carousel posts** (drafted 2 per run) for the *page_of_the__soul* page (brand name: `BRAND_NAME` in `.env`). Each post is in Hinglish (Hindi in Roman script), with classical couplets kept in their original Devanagari. It runs on the same stack as `../instagram_automation`: Gemini free tier, Playwright and the Instagram Graph API.

It runs on **GitHub Actions** (`.github/workflows/poet.yml`), so the Mac can be off. Times are IST (Asia/Kolkata):

| When | What happens |
|---|---|
| **18:15:00** daily | Publishes the oldest draft as a carousel, then the same post as a Reel |
| **23:00:00** daily | Publishes the next draft as a carousel and a Reel, then writes `POSTS_PER_RUN` (2) new drafts for the next day |
| Once a week (inside a slot run) | Renews the 60-day Instagram token |

How "on time, every day" is achieved:
- **Triggers.** cron-job.org starts the workflow 20 minutes early, at 17:55 and 22:40 (main), and again at +5 and +30 minutes after each slot (backups). GitHub's own schedule is often hours late, so it is only a further fallback.
- **Exact time.** A run prepares the carousel early, then waits and calls `media_publish` exactly at the slot time.
- **No doubles.** Each slot's outcome is stored in `state/history.json`, so extra triggers do nothing. A slot that nobody publishes within 2 hours is logged as `missed`.
- **Never empty.** If no draft is waiting, the slot run writes one first.

State lives on the `poet-state` branch and is force-pushed after every run. It holds:
- `state/history.json` and `state/token.json`;
- `posts_log.csv`;
- the slides of unpublished drafts;
- `token.enc`: the renewed Instagram token, AES-256 encrypted with the `TOKEN_STATE_KEY` secret.

Repository secrets:
- `INSTAGRAM_USER_ID_POETRY`
- `INSTAGRAM_ACCESS_TOKEN_POETRY` (the starting token)
- `GEMINI_API_KEY`
- `FACEBOOK_PAGE_ID`
- `FACEBOOK_PAGE_ACCESS_TOKEN`
- `TOKEN_STATE_KEY`

Run a mode by hand under **Actions → page_of_the__soul — Instagram → Run workflow**:
- `tick`
- `generate`
- `publish-now`
- `refresh-token`
- `check` (settings and the Instagram account; publishes nothing)

To pause publishing, set the repository variable `PUBLISH_TO_INSTAGRAM=false`.

Set up or update the cron-job.org triggers with `npm run cron:setup`. It needs `CRONJOB_ORG_API_KEY` and `GH_DISPATCH_TOKEN` (a fine-grained token with access to this repo and **Actions: Read and write**) in `.env`.

The old Mac schedule (`npm run schedule:install`, launchd) still works for local use, but do not run it alongside GitHub Actions: the two keep separate histories and would post the same drafts twice.

## Reels and music

Each post also goes out as a **Reel**: a 1080×1920 video of the same slides with slow zooms and fades, set to background music.
- **Music.** It is a new Bollywood-style instrumental composed for that post by **Google Lyria** (Gemini API). The prompt follows the post's **mood** (`src/music.js`):

  | Mood | Instruments |
  |---|---|
  | udaas | bansuri over piano |
  | pyaar | santoor, guitar, tabla |
  | ghar | sitar, harmonium |
  | josh | sitar, dhol, strings |
  | dosti | guitar, bansuri |
  | soch | Sufi harmonium, sarangi |

  Every piece is instrumental only. The Reel caption says the music is AI-made for the page.
- **Billing.** Lyria is not on the Gemini free tier. Put a key from a **billed** Google AI Studio project in the `LYRIA_API_KEY` secret. The writing keeps using the free `GEMINI_API_KEY`.
- **Bollywood suggestion.** Both captions add `Is kavita ke saath suniye: "<gaana>" — <film> (<saal>)`. The song comes from the hand-checked list in `src/songs.js`, picked by the writer.
  - Only the song's name is printed. Real film audio is never used: the Instagram API cannot attach Instagram's licensed music, and uploading a film song ourselves would be copyright infringement.
- **Hosting.** Reel videos are hosted for Instagram on the `ig-media` branch of this public repo. It holds a single orphan commit, replaced each time.
- **If something fails.** If the music or the Reel fails, the carousel still goes out on time. Backup runs retry the Reel. A missing Lyria billing setup stops further retries.
- **Off switch.** Set the repository variable `REELS_ENABLED=false` to post carousels only.

## What one post contains

- **Cover slide:** an illustrated scene (13 scenes, matched to the category) with either a verified couplet in Devanagari plus its attribution, or the poem's title and a hook line.
- **Bhavarth slide** (only when there is a couplet): a simple Hinglish explanation of the couplet, labelled *"Bhavarth — hamari samajh · Shabdsah anuvaad nahi"*.
- **Poem slide:** the original Hinglish poem, labelled *"Mool Rachna — page_of_the__soul"*.
- **`post.md`:** theme, source with URL and permalink, verification, copyright note, the full caption exactly as it will be posted, and hashtags.
- **Tracking:** a row in `state/history.json` and in `posts_log.csv` (opens in Excel or Numbers).

## How authenticity is guaranteed

1. Couplets come only from public-domain editions on Hindi Wikisource:
   - Kabir: *Kavita-Kaumudi* (1918)
   - Rahim: *Rahim-Kavitavali* dohe and sorthe (1926)
2. Each run fetches the live pages and extracts the numbered couplets (about 436).
3. Gemini may only pick one **by id**. The image shows the edition's exact words, never text the model remembered or rewrote. The page revision is recorded.
4. An editor pass scores how honestly the couplet fits the poem. Below 4 out of 5, the couplet is dropped and the post goes out as original writing only.
5. Every draft is checked before it is saved, and rewritten (up to 3 times) if it fails:
   - no English sentences
   - Roman script for the poem and caption
   - 4–10 poem lines that fit the slide
   - a 50–110-word caption that ends in a question
   - 3–6 hashtags
   - nothing too similar to earlier posts
6. Categories rotate (least recently used first), and one run never repeats a category or, where possible, a poet.

To add more sources, append to `SOURCES` in `src/sources.js`. Use a Hindi Wikisource page whose couplets end with `॥n॥`.

## Commands

```bash
npm run generate                 # draft POSTS_PER_RUN posts now
node src/cli.js generate --count 2
npm run history                  # list all posts and their status
npm run rerender                 # re-render unpublished drafts after changing BRAND_NAME or the design
npm run check-config             # settings, the Instagram account and the token expiry (never publishes)
npm run refresh-token            # renew the Instagram token now (Instagram allows it once the token is 24 h old)
npm run publish-next             # publish the oldest draft (only when PUBLISH_TO_INSTAGRAM=true)
npm run tick                     # publish the slot that is due now, exactly at its time (what the schedule runs)
npm test
```

## Going live on Instagram (optional)

Publishing is **off** (`PUBLISH_TO_INSTAGRAM=false`). Until you switch it on, every run only drafts. To turn it on:

1. Make the page_of_the__soul Instagram account a **Professional** account.
2. Get a token for **that** account. The steps are the same as in `../instagram_automation/README.md` (Instagram Login: `instagram_business_basic` + `instagram_business_content_publish`).
   - Do **not** copy the Daily Fact Check token, or the poems would post there.
3. Fill in `.env`:
   - `INSTAGRAM_USER_ID_POETRY` (numeric, e.g. 17841420312966798)
   - `INSTAGRAM_ACCESS_TOKEN_POETRY` (the `_POETRY` suffix keeps it apart from the Daily Fact Check `INSTAGRAM_ACCESS_TOKEN`)
   - `INSTAGRAM_API_HOST`
   - hosting: `MEDIA_HOST=facebook` with `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_ACCESS_TOKEN`
4. Run `npm run check-config`. It must show the right username.
5. Set `PUBLISH_TO_INSTAGRAM=true`. The 18:15 and 23:00 runs then publish one draft each as a carousel.

Safety:
- A post whose publish outcome is unknown is checked with Instagram before anything else, so it is never posted twice.
- Permanent errors (an expired token, a missing permission) mark the post `failed`.
- The token is renewed weekly and its expiry is recorded in `state/token.json`. On GitHub Actions the renewed token goes, encrypted, to the state branch. Locally (`npm run refresh-token`), only the `INSTAGRAM_ACCESS_TOKEN_POETRY` line in `.env` is rewritten. `tick`, `publish-next` and `check-config` warn when fewer than 10 days are left.

## Limitations

- On-time starts depend on cron-job.org. If cron-job.org is down, GitHub's fallback schedule still publishes, but it can be late.
- There are 13 scenes: they are drawn illustrations, not photos. Add more in `src/scenes.js`.
- Gemini Flash writes well but not perfectly. Read the drafts before you switch on auto-publishing.
