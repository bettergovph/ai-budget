# Budget Briefing/Hearings — transcript pipeline and the `/hearings` pages

How the House Committee on Appropriations budget hearings go from YouTube live
streams to the `/hearings` grid and the per-hearing detail pages (topics,
timeline, analyst brief, interactive transcript), and what runs every day
without human intervention.

- Scraper/pipeline repo: `/home/jason/projects/transcriptions` (Python, its own `.venv`; its README has the operator detail)
- Site repo: this repository (`src/pages/Hearings*.tsx`, `src/worker/hearings.ts`, `src/lib/hearings.ts`)
- Live: `https://budget.bettergov.workers.dev/hearings` (grid) and `/hearings/:videoId`
- Data host (R2 public): `https://budget-assets.bettergov.ph/hearings/<videoId>/…`

## Data flow

```
YouTube channel @HouseofRepresentativesPH
        │  yt-dlp flat listing of the /streams tab (free)
        ▼
transcriptions/scrape.py  ── discover ──►  data/videos.json
        │  ScrapeCreators /v1/youtube/video/transcript (captions, 1 credit)
        ▼
data/transcripts/<slug>-<videoId>/
      meta.json · transcript.json · transcript.txt
        │
        ├─► transcribe.py   (optional, needs audio — see blockers)
        │     yt-dlp audio → 30-min chunks → Workers AI
        │     Whisper-large-v3-turbo (words) + Deepgram Nova-3 (speakers)
        │     → transcript.json with `speaker`/`chunk` (captions kept as
        │       transcript.captions.json)
        │
        ├─► summarize_sections.py   GPT-5.6 Luna map/reduce
        │     → sections.json (timeline + per-topic index) · sections.md
        ├─► brief.json         analyst brief (manual LLM session, schema brief.schema.json)
        ├─► summarize.py       legacy summary.md / highlights.md
        ├─► build_rag.py       data/rag/chunks.jsonl (briefs, sections, transcript)
        └─► sync_to_site.py ──► R2  hearings/<videoId>/*   (ETag-checked PUTs)
                             └► D1  hearings table (upsert every scrape)
                                     │
                                     ▼
                        Worker GET /api/hearings[/:videoId]
                                     │
                                     ▼
                        SPA grid + detail pages
```

Everything is resumable; every step skips work already done.

## What the detail page shows

`sections.json` is the substance layer. The hearings run 5–9 hours, so the
page leads with **what transpired on each topic** rather than a single
summary:

- **Overview** — a paragraph on what was deliberated, contested, and how it ended.
- **By topic** — for each topic (PhilHealth subsidy, HFEP cuts, unpaid
  benefits, …): who raised it, what was asked, what the agency answered, the
  figures, where it landed (`resolved | committed | parked | unresolved |
  informational`), the positions members took, and links to the timeline
  sections where it came up.
- **Timeline** — contiguous sections (roll call, presentation, each member's
  interpellation, motions, suspensions) with a record of proceedings, Q&A
  exchanges with outcomes, every peso figure, and document requests /
  commitments. Every item has a cue button that seeks the video.
- **Analyst brief** — the tabulated figures/issues/actions layer (unchanged).
- **Transcript** — click-to-seek blocks; shows speaker names/labels when the
  transcript is diarized.

## Daily automation

A ZCode automation (cron `0 15 * * *` = 23:00 Manila) runs
`/home/jason/projects/transcriptions/daily.sh`:

1. `scrape.py daily` — discovery, flag retries, season selection, missing captions.
2. `transcribe.py all` — only when `YT_COOKIES_FILE` or `ASR_FROM_R2=1` is set
   (audio is not obtainable from the server otherwise; captions remain the fallback).
3. `summarize_sections.py` — sections for any hearing missing them (window
   results cached in `sections.work/`). Measured cost is ~1.7 ¢ per hour of
   hearing: $0.146 for the 8.9-hour DOH hearing, $0.047 for the 2.5-hour CHR
   one, so ~$3 for the whole season. Wall-clock depends on the LLM backend —
   minutes per hearing on Cloudflare, longer on the rate-limited OpenRouter
   fallback.
4. `summarize.py`, `build_rag.py`, `sync_to_site.py`.
5. **Analyst briefs** — the automation prompt instructs the agent to extract
   `brief.json` for hearings missing one (validate with `validate_brief.py`).

## Storage layout

| Store | Key / table | Contents |
| --- | --- | --- |
| R2 `budget` | `hearings/<videoId>/meta.json` | video metadata |
| R2 `budget` | `hearings/<videoId>/transcript.json` | segments (`text`, `startMs`, `endMs`, `startTimeText`; + `speaker`, `chunk`, `speaker_name` when diarized); `source` = `scrapecreators` (captions) or `hybrid|nova3|whisper` |
| R2 `budget` | `hearings/<videoId>/transcript.captions.json` | the caption transcript, kept when our own ASR replaced it |
| R2 `budget` | `hearings/<videoId>/sections.json`, `sections.md` | timeline + per-topic index (schema `transcriptions/sections.schema.json`) |
| R2 `budget` | `hearings/<videoId>/brief.json` | analyst brief |
| R2 `budget` | `hearings/<videoId>/summary.md`, `highlights.md` | legacy summaries (not rendered) |
| R2 `budget` | `hearings/<videoId>/audio.mp3` | optional: audio pushed from a residential machine for `transcribe.py` |
| D1 `budget` | `hearings` | one row per hearing; `has_brief`, `has_sections`, `transcript_source` (migration 002) |

The browser fetches heavy content (transcript.json, sections.json,
brief.json) straight from the R2 public host via `dataUrl('hearings/…')`. A
dev mirror is written to `ai-reports/data/hearings/` so `npm run dev` serves
identical paths.

## Cloudflare AI usage

- Speech-to-text runs on Workers AI over REST: Nova-3 takes a raw
  `audio/mpeg` body with `?diarize=true&smart_format=true&utterances=true`
  (30-min chunk → 19 s, $0.0052/min); Whisper takes `{audio: base64}`
  (30-min chunk → ~155 s, $0.0005/min). Both verified on this account.
- Text generation uses `openai/gpt-5.6-luna` through AI Gateway
  (`POST /ai/v1/responses`, header `cf-aig-gateway-id: hearings`). Gateway
  `hearings` was created with authentication on (the pre-existing `default`
  gateway has authentication off and is untouched). Third-party models bill
  against **prepaid Unified Billing credits**; with an empty balance the
  gateway returns 402 and `cf_ai.py` falls back to OpenRouter (same model,
  `OPENROUTER_API_KEY` in `.env`, $0.20/M in, $1.20/M out).

## Hard-won gotchas

- **YouTube blocks audio downloads from the Hetzner server**: every yt-dlp
  player client gets "Sign in to confirm you're not a bot"; the bgutil
  PO-token provider (built in `~/tools/bgutil-ytdlp-pot-provider`) does not
  get past it. Flat channel listing still works. Fix = cookies from a
  logged-in browser (`YT_COOKIES_FILE`) or download on a laptop and
  `transcribe.py upload-audio`.
- **Never pass `language=en`** to the caption endpoint (tracks are tagged Filipino).
- Captions garble names ("Beverly Hall" for PhilHealth's Beverly Ho, etc.);
  sections and briefs inherit that until the diarized transcript exists —
  every item is timestamped for verification.
- Nova-3 speaker numbers reset every request; the pipeline tags segments with
  their `chunk` and names speakers per chunk from context.
- Two videos have no captions on YouTube (DOH Part II `Wo--jqr-Ffk`, truncated
  PCO stream `aG6yKXA_7BE`); our own ASR would cover them once audio is available.
- Local `wrangler dev` fails on the 1 GiB `dist/client/data/budget.sql`
  asset; use `npm run dev` (Vite) for local work.

## Current state (2026-09-04)

- 35 FY2027 hearings indexed; 33/35 caption transcripts; 33/33 analyst briefs.
- `sections.json`: see the count in the D1 query below (built from captions;
  `transcript_source = captions`). No hearing has our own diarized transcript
  yet — blocked on audio access (above).
- AI Gateway `hearings` exists but has no credits; luna calls currently go to OpenRouter.

## Next steps

1. **Unblock audio**: export YouTube cookies to the server (`YT_COOKIES_FILE`)
   or run `transcribe.py fetch` + `upload-audio` from a residential machine;
   then `transcribe.py all` (≈ $50 for the season) and
   `summarize_sections.py --force` for the diarized hearings.
2. **Load AI Gateway credits** (Cloudflare dashboard → AI Gateway → Credits)
   so luna runs on Cloudflare as intended; nothing else changes.
3. **RAG chatbot**: `build_rag.py --embed` and load `chunks.jsonl` into a
   vector store; topic/section chunks carry deep links.
4. **Season end**: FY2028 is a three-line change in `config.py`.

## Verification one-liners

```bash
# site API (has_sections / transcript_source)
curl -s "https://budget.bettergov.workers.dev/api/hearings/7U4YvhlnbZY"
# R2 content
curl -s "https://budget-assets.bettergov.ph/hearings/7U4YvhlnbZY/sections.json" | head -c 600
# D1 (from this repo)
npx wrangler d1 execute budget --remote --command "SELECT count(*) AS n, sum(has_sections) AS sections, sum(has_brief) AS briefs FROM hearings"
# pipeline (from ../transcriptions)
.venv/bin/python validate_sections.py && .venv/bin/python sync_to_site.py --dry-run
```
