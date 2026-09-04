# Budget Briefing/Hearings — transcript pipeline and the `/hearings` pages

How the House Committee on Appropriations budget hearings go from YouTube live
streams to the `/hearings` grid and the analyst-brief detail pages, and what
runs every day without human intervention.

- Scraper/pipeline repo: `/home/jason/projects/transcriptions` (Python, its own `.venv`)
- Site repo: this repository (`src/pages/Hearings*.tsx`, `src/worker/hearings.ts`, `src/lib/hearings.ts`)
- Live: `https://budget.bettergov.workers.dev/hearings` (grid) and `/hearings/:videoId`
- Data host (R2 public): `https://budget-assets.bettergov.ph/hearings/<videoId>/…`

## Data flow

```
YouTube channel @HouseofRepresentativesPH
        │  yt-dlp flat listing of the /streams tab (free — hearings are live
        │  streams, so the regular Videos tab does not show them)
        ▼
transcriptions/scrape.py  ── discover ──►  data/videos.json (122 committee
        │                                   videos; FY2027 season = ranks 1–73)
        │  ScrapeCreators /v1/youtube/video/transcript (1 credit/video)
        ▼
data/transcripts/<slug>-<videoId>/
      meta.json · transcript.json · transcript.txt · summary.md · brief.json
        │
        ├─► summarize.py        extractive summary (LLM key upgrades it)
        ├─► build_rag.py        data/rag/chunks.jsonl (briefs indexed first)
        └─► sync_to_site.py ──► R2  hearings/<videoId>/*   (ETag-checked PUTs)
                             └► D1  hearings table (upsert every scrape)
                                     │
                                     ▼
                        Worker GET /api/hearings[/:videoId]
                                     │
                                     ▼
                        SPA grid + detail pages (brief panel,
                        click-to-seek interactive transcript)
```

Everything is resumable; every step skips work already done.

## Daily automation

A ZCode automation (cron `0 15 * * *` = 23:00 Manila) runs
`/home/jason/projects/transcriptions/daily.sh`, which chains:

1. `scrape.py daily` — streams-tab discovery (free), retry flagged no-caption
   videos, select the FY2027 season (title `FY 2027` or stream date within
   `SEASON_START..SEASON_END` in `config.py`), fetch missing transcripts,
   write `data/season_ids.txt`.
2. `summarize.py` — summaries for anything missing.
3. `build_rag.py` — rebuild `data/rag/chunks.jsonl`.
4. `sync_to_site.py` — R2 + D1 sync.
5. **Analyst briefs** — the automation prompt itself instructs the agent to
   extract `brief.json` for any hearing missing one (schema:
   `brief.schema.json`, validate with `validate_brief.py`, style reference:
   the DOH brief), then re-runs RAG + sync.

Quiet-day cost is ~2–3 ScrapeCreators credits; new hearing days cost ~3.

## Storage layout

| Store | Key / table | Contents |
| --- | --- | --- |
| R2 `budget` | `hearings/<videoId>/meta.json` | video metadata (title, agency, dates, duration) |
| R2 `budget` | `hearings/<videoId>/transcript.json` | caption segments (`text`, `startMs`, `endMs`, `startTimeText`) |
| R2 `budget` | `hearings/<videoId>/transcript.txt` | `[timestamp] text` lines |
| R2 `budget` | `hearings/<videoId>/summary.md`, `highlights.md` | extractive/LLM summaries (not rendered on the site) |
| R2 `budget` | `hearings/<videoId>/brief.json` | analyst brief (see below) |
| D1 `budget` | `hearings` | one row per hearing; upserted on every scrape; served by `/api/hearings` |

D1 schema lives in `transcriptions/d1/hearings.sql` (migrations in
`d1/migrations/`). Statuses: `ok` / `no_captions` (`missing.flag` in the local
folder marks the latter; retried automatically each daily run).

The browser fetches heavy content (transcript.json, brief.json) straight from
the R2 public host via `dataUrl('hearings/<videoId>/…')` — same split as the
GAA/NEP datasets. A dev mirror is written to `ai-reports/data/hearings/` so
`npm run dev` (unset `VITE_DATA_BASE_URL`) serves identical paths.

## Analyst briefs

`brief.json` per hearing — the structured layer budget analysts consume:
topline (proposed vs prior GAA vs change), `budget_figures[]` (entity, metric,
type, peso amount + as-spoken text, speaker, timestamp + seconds), `issues[]`
(category, raised-by, agency response, resolution), `committee_actions[]`,
and the ask-vs-give trio (`asks.agency_ask` / `nep_gave` /
`restorations_sought`). Every extract cites a timestamp; the detail page
renders it as a figures table + issues/actions lists whose cue buttons seek
the embedded player.

- Produced **manually by an LLM session** (method: `manual-llm`) — all 33
  hearings with transcripts are covered as of 2026-09-04.
- `validate_brief.py` enforces structure, timestamp/seconds consistency,
  duration bounds, and fuzzy grounding of amounts against captions.
- Caveat: YouTube auto-captions garble names and figures; each brief carries
  an `extraction.confidence_note`, and every figure is timestamped for
  verification against the video.

## Hard-won gotchas

- **Never pass `language=en`** to the transcript endpoint: these hearings'
  auto-caption tracks are often tagged Filipino even when mostly English, and
  the strict filter silently returns `transcript: null`.
- Captions work fine for 8+ hour streams (the "under 2 minutes" API
  limitation does not apply here).
- `youtube-transcript-api` (free fallback) is IP-blocked from datacenter IPs;
  yt-dlp with cookies/proxies is the alternative escape hatch.
- Speaker names are not in captions — briefs attribute only clearly
  identifiable people, and names are often transliterated wrong.
- Two videos genuinely have no captions on YouTube (DOH Part II
  `Wo--jqr-Ffk`, a truncated PCO stream `aG6yKXA_7BE`); their primary
  full-length recordings are transcribed. Flags retry daily.
- Local `wrangler dev` fails on the 1 GiB `dist/client/data/budget.sql`
  asset; use `npm run dev` (Vite) for local work.

## Current state (2026-09-04)

- 35 FY2027 hearings indexed; **33/35 transcripts**, **33/33 briefs**
  (the 2 gaps are the caption-less videos above; ~146 hours of hearings,
  157K caption segments).
- RAG corpus: `data/rag/chunks.jsonl` — 2,885 chunks (briefs indexed first
  with an `[ANALYST BRIEF]` header), embeddings not yet computed.
- Deployed and committed (worker version `04bd7453…`); check `git log --oneline` and `wrangler deployments list` for the exact latest.

## Next steps

1. **RAG chatbot**: add an OpenAI-compatible key → `build_rag.py --embed`
   (text-embedding-3-small) → load `chunks.jsonl` into a vector store; each
   chunk's `metadata.urlAtStart` lets the bot cite deep links.
2. **Summaries**: drop an LLM key into `.env` and rerun `summarize.py
   --force` to upgrade the extractive summaries to narrative ones.
3. **Season end**: when FY2027 hearings wrap, the daily run simply stops
   finding new items; FY2028 is a three-line change in `config.py`
   (`SEASON_TITLE_TAG`, `SEASON_START`, `SEASON_END`).
4. **Backlog**: 122 committee videos indexed back to the 19th Congress;
   `scrape.py fetch` (no args) or `sync_to_site.py --all` extends the corpus
   when wanted.

## Verification one-liners

```bash
# site API
curl -s "https://budget.bettergov.workers.dev/api/hearings?limit=3"
# a hearing row incl. has_brief
curl -s "https://budget.bettergov.workers.dev/api/hearings/7U4YvhlnbZY"
# R2 content
curl -sI "https://budget-assets.bettergov.ph/hearings/7U4YvhlnbZY/brief.json"
# D1 (from this repo)
npx wrangler d1 execute budget --remote --command "SELECT video_id,slug,status,has_brief FROM hearings LIMIT 5"
# pipeline (from ../transcriptions)
.venv/bin/python validate_brief.py && .venv/bin/python sync_to_site.py --dry-run
```
