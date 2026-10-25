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
        ├─► transcribe.py   LAPTOP ONLY (YouTube serves no media to the server)
        │     yt-dlp audio → 30-min chunks → Workers AI
        │     Whisper-large-v3-turbo (words) + Deepgram Nova-3 (speakers)
        │     → transcript.json with `speaker`/`chunk`/`speaker_name`
        │     → sync_to_site.py --only-transcripts   (publishes transcripts only)
        │
        ├─► pull_from_site.py   SERVER: mirror the published R2 files first
        ├─► record.py           GPT-5.6 Luna, four passes:
        │     map (30-min windows → timeline sections) → consolidate topics →
        │     per-topic DELIBERATION RECORD from the transcript (question at
        │     issue, thread of who said what, positions, figures, actions,
        │     outcome/status) → reduce (overview, speakers, name corrections)
        │     → sections.json (v2, method llm-record-v2) · sections.md
        ├─► brief.json         analyst brief (manual LLM session, schema brief.schema.json)
        ├─► summarize.py       legacy summary.md / highlights.md
        ├─► build_rag.py       data/rag/chunks.jsonl (briefs, sections, transcript)
        └─► sync_to_site.py ──► R2  hearings/<videoId>/*   (ETag-checked PUTs)
                             ├► D1  hearings table (upsert every run)
                             └► D1  hearing_topics (one row per topic, full record as JSON)
                                     │
                                     ▼
                  Worker  /api/hearings[/:id]            (SPA)
                          /api/v1/hearings…              (public API)
                          /mcp  list/search/get_hearing… (MCP tools)
                                     │
                                     ▼
                        SPA grid + detail pages (By topic = the thread)
```

Everything is resumable; every step skips work already done.

## What the detail page shows

`sections.json` is the substance layer. The hearings run 2–9 hours, so the
page leads with **what transpired on each topic** rather than a single
summary:

- **Overview** — a few paragraphs on what was deliberated, contested, and how it ended.
- **By topic** — the deliberation record (v2, `record.py`): for each topic
  (PhilHealth subsidy, HFEP cuts, unpaid benefits, …) the *question at
  issue*, the **thread** — every substantive moment in order, timestamped,
  each a cue into the video: who said it, which side, question / answer /
  commitment / motion / ruling, what they said — then the agency's position,
  members' positions, the figures as spoken (chips that cue the video),
  actions (document requests, commitments, motions, rulings), where it landed
  and a status (`resolved | committed | parked | unresolved | informational`),
  and links to the timeline sections where it came up. Records made by the
  earlier summariser lack the thread and render as before.
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
3. `pull_from_site.py` then `record.py` — deliberation records for any
   hearing without a v2 record built from the transcript that is on disk
   (the transcript is fingerprinted, so a re-transcribed hearing rebuilds
   itself). Every model response is cached in `record.work/`; reruns without
   `--force` are free. Measured on CHR (2.5 h): $0.14, 13.6 min on OpenRouter
   at concurrency 3 — about 5–6 ¢ per hour of hearing, roughly 3× the old
   summariser because each topic re-reads its stretches of the transcript.
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
| D1 `budget` | `hearings` | one row per hearing; `has_brief`, `has_sections`, `transcript_source` (migration 002); `record_method`, `topic_count` (migration 003) |
| D1 `budget` | `hearing_topics` | one row per topic per hearing (migration 003): summary, question, agency_position, outcome, status, first_seconds, and JSON columns `sections`, `positions`, `figures`, `actions`, `thread`; `search_text` for the keyword search. Replaced wholesale by `sync_to_site.py` when a record's fingerprint changes. |

The browser fetches heavy content (transcript.json, sections.json,
brief.json) straight from the R2 public host via `dataUrl('hearings/…')`. A
dev mirror is written to `ai-reports/data/hearings/` so `npm run dev` serves
identical paths.

## Public API and MCP

`src/worker/hearings-api.ts` (data functions), routed from `public-api.ts`,
documented in `openapi.ts` and `docs.ts`, and exposed as tools in `mcp.ts`:

| REST | MCP tool | Source |
| --- | --- | --- |
| `GET /api/v1/hearings` (`fiscal_year`, `agency`, `status`, `q`, `limit`, `offset`) | `list_hearings` | D1 `hearings` |
| `GET /api/v1/hearings/search?q=` (`fiscal_year`, `agency`, `status`) | `search_hearings` | D1 `hearing_topics.search_text` (LIKE, all terms), returns the topic + the moments that mention the terms |
| `GET /api/v1/hearings/{id}` | `get_hearing` | `hearings` + topic index |
| `GET /api/v1/hearings/{id}/topics[/{n}]` (`thread=0` to omit threads) | `get_hearing_topics` | `hearing_topics` |
| `GET /api/v1/hearings/{id}/timeline` | `get_hearing_timeline` | R2 `sections.json` (fetched from the public host, edge-cached) |
| `GET /api/v1/hearings/{id}/transcript?from=&to=` | `get_hearing_transcript` | R2 `transcript.json` |

Every timestamped item carries `url` = `https://budget.bettergov.ph/hearings/<id>?t=<seconds>`,
which the page honours by seeking the player — so an agent's answer is one
click from the moment in the video. Figures are as spoken (`amount_text`);
`amount` is a best-effort peso parse and may be null.

## Cloudflare AI usage

- Speech-to-text runs on Workers AI over REST: Nova-3 takes a raw
  `audio/mpeg` body with `?diarize=true&smart_format=true&utterances=true`
  (30-min chunk → 19 s, $0.0052/min); Whisper takes `{audio: base64}`
  (30-min chunk → ~155 s, $0.0005/min). Both verified on this account.
- Text generation uses `openai/gpt-5.6-luna` through AI Gateway
  (`POST /ai/v1/responses`, header `cf-aig-gateway-id: hearings`). Gateway
  `hearings` was created with authentication on (the pre-existing `default`
  gateway has authentication off and is untouched). Third-party models bill
  against **prepaid Unified Billing credits**; as of 2026-09-09 the gateway
  still answers `402 Insufficient balance; add money to your gateway or use
  BYOK`, so `cf_ai.py` falls back to OpenRouter on every call (same model,
  `OPENROUTER_API_KEY` in `.env`, $0.20/M in, $1.20/M out). Load credits or
  add an OpenAI key under BYOK in the dashboard and nothing else changes.

## Hard-won gotchas

- **YouTube serves no media to the Hetzner server**: every yt-dlp player
  client gets "Sign in to confirm you're not a bot"; cookies clear the bot
  check but not the media block (re-confirmed 2026-09-09 with fresh cookie
  files); the bgutil PO-token provider does not help. Flat channel listing
  still works. Audio is fetched on a laptop (`fetch_audio_locally.sh` /
  `transcribe.py fetch`), which also runs the ASR and publishes transcripts
  with `sync_to_site.py --only-transcripts`; the server does the rest.
- **Two machines, two roles.** The laptop is authoritative for transcripts,
  the server for records. `--only-transcripts` and `pull_from_site.py`'s
  newer-record guard exist so neither overwrites the other's work.
- **Video ids can start with `-`** (`-YAwilEO4sQ`): pass `--` before ids on
  the command line.
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

## Current state (2026-09-09)

- 40 FY2027 hearings indexed; 39 have a Nova-3 transcript (produced on the
  laptop; the PCO stream `aG6yKXA_7BE` is silent). No hearing has the hybrid
  Whisper transcript yet — Nova-3 alone drops most Filipino speech, and the
  hybrid pass is the next laptop step (see the transcriptions repo's
  `HANDOFF.md`, ≈ $4.52 for the season).
- Deliberation records (v2): 38 of 40 hearings, 577 topics, 15,621 timestamped moments — see the batch results below.
- API + MCP live: `https://budget.bettergov.ph/api/v1/hearings`, `/mcp`.
- AI Gateway `hearings` has no credits; luna runs on OpenRouter.

### Batch results — v2 rebuild of the season (2026-09-09)

| | |
| --- | --- |
| Hearings with a v2 record | 38 of 40 (the silent PCO stream and the near-silent DOH part II get no record) |
| Audio covered | 170.7 hours |
| Timeline sections | 1,039 |
| Topics | 577 (statuses: 477 committed, 66 unresolved, 20 informational, 11 resolved, 3 parked) |
| Moments in topic threads | 15,621 (4,153 questions, 4,540 answers, 2,166 figures, 1,355 commitments, 3,017 statements, 115 motions, 127 rulings) |
| Model calls recorded for the final records | 738 · 5.41M tokens in / 3.14M out ≈ **$4.85** |
| Spend actually incurred, including retries and one self-inflicted rebuild | 1,123 calls · 8.16M in / 4.73M out ≈ **$7.30** |
| Wall-clock | ~2 h 40 min for the main batch (4 shard processes × concurrency 3 on OpenRouter), plus ~50 min of targeted repairs |
| Largest record | DOH (8.9 h): 48 sections, 23 topics, 817 moments, $0.34 |

Everything above validates clean (`validate_sections.py`: 38 files, 0 problems).
The `hearing_topics` table holds 577 rows; `/api/v1/hearings/search` and the
`search_hearings` MCP tool search them.

Two lessons from the batch, both fixed in `record.py`:
- **Rate limits**: 12 concurrent OpenRouter requests produced a handful of
  429s and empty completions. The cache made every retry cheap (the rerun of a
  failed hearing paid only for the missing calls). Run at most ~9 concurrent
  requests, or load the Cloudflare gateway so luna is served natively.
- **The fingerprint must hash the spoken content, not the file**: the run
  writes speaker names back onto `transcript.json`, so a whole-file hash made
  every rerun look like a re-transcription and wiped its own cache (one
  hearing was rebuilt from scratch before this was caught).

## Next steps

1. **Hybrid Whisper transcripts (laptop)**: `transcribe.py all --engine hybrid`
   then `sync_to_site.py --only-transcripts`; the server's daily run rebuilds
   the affected records automatically (changed transcript fingerprint).
2. **Load AI Gateway credits or BYOK** so luna runs on Cloudflare.
3. **RAG chatbot**: `build_rag.py --embed`; topic threads are the natural
   chunks and already carry deep links.
4. **Season end**: FY2028 is a three-line change in `config.py`.

## Verification one-liners

```bash
# site API (has_sections / transcript_source)
curl -s "https://budget.bettergov.workers.dev/api/hearings/7U4YvhlnbZY"
# R2 content
curl -s "https://budget-assets.bettergov.ph/hearings/7U4YvhlnbZY/sections.json" | head -c 600
# D1 (from this repo)
npx wrangler d1 execute budget --remote --command "SELECT count(*) AS n, sum(has_sections) AS sections, sum(has_brief) AS briefs FROM hearings"
# public API / MCP
curl -s "https://budget.bettergov.ph/api/v1/hearings/search?q=philhealth%20subsidy" | head -c 600
# pipeline (from ../transcriptions)
.venv/bin/python validate_sections.py && .venv/bin/python sync_to_site.py --dry-run
```
