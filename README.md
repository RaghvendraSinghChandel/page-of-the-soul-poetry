# page_of_the__soul: Hinglish poetry automation

Every day this publishes **two Instagram carousel posts** (drafted 2 per run) for the *page_of_the__soul* page (brand name: `BRAND_NAME` in `.env`). Each post is in Hinglish (Hindi in Roman script), with classical couplets kept in their original Devanagari. It runs on the same stack as `../instagram_automation`: Gemini free tier, Playwright and the Instagram Graph API.

It runs on **GitHub Actions** (`.github/workflows/poet.yml`), so the Mac can be off. Times are IST (Asia/Kolkata):

| When | What happens |
|---|---|
| **18:15:00** daily | Publishes the oldest draft as a carousel, then the same post as a Reel |
| **23:00:00** daily | Publishes the next draft as a carousel and a Reel, then tops the queue back up to `DRAFT_BUFFER` (10) drafts, `POSTS_PER_RUN` (3) at a time |
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

The Mac's only scheduled job is the voice worker (`npm run voice:install`). It also removes the old Mac publishing agents, which would post twice if they ran alongside GitHub Actions.

## Voice Reels (made on the Mac)

After its carousel, each post goes out as a **Reel recited in the page owner's voice**, if the Mac has made one.
- **Who does what.** The Mac only makes the voice Reels. GitHub Actions does everything else: drafting, publishing and keeping `DRAFT_BUFFER` (10) drafts waiting.
- **The voice worker.** `scripts/voice-worker.mjs` runs from launchd at login and every 30 minutes (`npm run voice:install`). It skips work on battery below 40%. For each of the next 10 drafts without a Reel it does this:
  1. Writes the post in Devanagari (Gemini), so the voice model pronounces it right.
  2. Recites it **page by page** in the owner's voice, cloned with AI4Bharat **IndicF5** (MIT) from `assets/voice/reference.wav` (`scripts/voice/speak.py`, Mac GPU, ~10 minutes a post):
     - **Cover:** the title, slower and stronger, then the hook (or the couplet).
     - **Bhavarth:** read out when the post has a couplet.
     - **Poem:** recited like shers. Pairs get a short pause inside and a longer one between them, and the last line comes once more, slower.
     - **Outro:** a cheerful *like, share aur follow* on a closing card.
  3. Lays a light **self-made background bed** under the poem only (`src/bed.js`). It is a kalimba-like pentatonic arpeggio, a soft pad and a faint water hush, so there is nothing to license. It is ducked under the voice and silent during the outro.
  4. Pushes the Reel to the **`poet-voice`** branch as `voice/<post-id>/reel.mp4`. The branch is one orphan commit holding only the Reels still needed.
- **If the Mac is off.** Up to 10 Reels made earlier keep going out. A post with no Reel goes out as a carousel only (`reel.status = "skipped"`), and nothing is missed.
- **Caption.** It says the voice is AI-made, as Instagram asks for realistic AI audio: *"Awaaz: page_of_the__soul ki apni awaaz par AI (IndicF5) se bani"*.
- **Privacy.** The voice sample stays on the Mac. `assets/voice/` is git-ignored, and so are `.voice-env/` (the Python environment) and `.voice-work/`.
- **Mac setup, once.**
  1. Create the Python environment: `python3.11 -m venv .voice-env && .voice-env/bin/pip install git+https://github.com/ai4bharat/IndicF5.git "datasets==3.2.0" "transformers==4.48.3" "pyarrow==16.1.0" "numpy==1.26.4"`.
  2. Accept the model's terms on Hugging Face and put `HF_TOKEN` in `.env`.
  3. Add the reference recording and its transcript (`reference.wav` / `reference.txt`).
- **Bollywood suggestion.** Both captions add `Is kavita ke saath suniye: "<gaana>" — <film> (<saal>)` from the hand-checked list in `src/songs.js`. Only the name is printed, never the song.
- **Off switch.** Set `REELS_ENABLED=false` (repository variable) to post carousels only.

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
