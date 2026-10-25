# Contributing to ai-budget

Thanks for your interest in the Philippine budget explorer behind
[budget.bettergov.ph](https://budget.bettergov.ph).

This project is part of [BetterGov.PH](https://github.com/bettergovph). The
community guidelines, Code of Conduct, and ways to reach the team live in the
main [`bettergov` contributing guide][main-guide] — please read that first. It
covers the things that apply across every BetterGov repository:

- the [Code of Conduct][coc] and ground rules
- the [Discord][discord] and `volunteers@bettergov.ph`
- the fork → branch → pull request workflow
- [Conventional Commits][commits] and the `<prefix>/<short-description>` branch
  convention

**This file covers only what is specific to this repository.** Where the two
disagree, the setup instructions here win — this project has a different stack.

---

## What is different about this repository

`ai-budget` is a React + TypeScript SPA served by a **Cloudflare Worker**, with
**D1** holding queryable aggregates, **R2** holding the larger JSON and Parquet
assets, and **DuckDB-Wasm** running columnar analysis in the browser.

Three consequences for contributors:

1. Node version is pinned tighter than the org default — see below.
2. **You do not need the multi-gigabyte dataset** to work on the UI.
3. Some commands are read-only and offline; others write to shared cloud
   infrastructure. Know which is which before you run one.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm
- Git

Wrangler authentication and R2 credentials are needed **only** for the data and
deploy commands listed further down. Everything else runs offline.

## Getting started

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open the URL Vite prints.

`.env.example` points `VITE_DATA_BASE_URL` at the public R2 data host, so the
dev server reads published data over the network. **This is why you do not need
a local copy of the dataset** for UI, styling, routing, or component work.

To serve from `public/data` instead, leave `VITE_DATA_BASE_URL` unset. In this
repository `public/data` may be a symlink to the Git-ignored local `data/`
directory.

Never commit credentials. `.env` and `.env.local` are Git-ignored.

## Which commands are safe to run

**Safe offline — no credentials, no cloud writes:**

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) and production build |
| `npm run lint` | ESLint |

CI runs `lint` and `build` on every pull request. Run both locally before you
push and you will not be surprised.

**Needs Wrangler authentication:**

| Command | Purpose |
| --- | --- |
| `npm run preview` | Build and serve through Wrangler |
| `npm run load:cycle-local` | Load budget-cycle SQL into **local** D1 |

**Writes to shared cloud infrastructure — do not run casually:**

| Command | Effect |
| --- | --- |
| `npm run upload:r2` | Publishes assets to the R2 bucket |
| `npm run upload:nep2027` | Publishes FY2027 assets to R2 |
| `npm run cleanup:r2` | **Deletes** objects from R2 |
| `npm run deploy` | Builds and deploys the Worker to production |

The `upload:*` scripts accept `--dry-run`. Use it. Most of the data scripts also
accept a single department, for example
`npm run build:parquet -- --dept=07 --table=objects`, which is far faster than
`--all` while iterating.

**Rebuilds the dataset — needs the local Hugging Face copy:**

`build:index`, `build:parquet`, `build:sqlite`, `build:gaa-summaries`,
`dump:sql`, `import:nep2027`, `import:cycle`. Source data is the
[BetterGov.PH GAA dataset][hf] (CC0-1.0). See [`docs/`](./docs) for the
pipelines.

## Working on the data

Source amounts are published in **thousands of pesos** and converted to full
pesos for display. If you touch an aggregation, keep the units straight and say
so in the pull request.

The `scripts/verify-*.ts` scripts reconcile generated data against the raw
source. **Run the relevant one after any change to an import or conversion
script** and paste the output into your pull request:

```sh
npm run verify:nep2027
npm run verify:cycle
```

Figures on this site may end up quoted in reporting. A wrong aggregate is worse
than an outage, because nobody notices. Treat reconciliation as part of the
change, not as a follow-up.

## Working on the public API

`/api/v1/*` (REST), `/mcp` (MCP server), and `/api/v1/openapi.json` all read
through one data layer, `src/worker/public-api.ts`, so the surfaces cannot
drift. If you add or change an endpoint:

- keep the shared data layer as the only source of figures
- update `src/worker/openapi.ts` in the same commit
- update the MCP tool description in `src/worker/mcp.ts` if the behaviour changes
- these are **public, CORS-open, and unversioned in practice** — treat response
  shapes as a contract other people depend on

## Pull requests

Follow the [main guide's workflow][main-guide]. Two points worth repeating:

- **Reference related issues** (`Refs #12`, or `Closes #12` if it resolves one).
- **Disclose AI-assisted work.** If you used AI tools to generate or
  significantly modify code, say so in the pull request description. This is an
  org-wide requirement and it helps maintainers review appropriately.

Keep pull requests small and single-purpose. A focused change is reviewed in
minutes; a large one waits.

## Reporting problems

Open an [issue][issues]. For a bug, include what you did, what you expected,
what happened, and — for anything data-related — the exact route or API call and
the figure you saw.

If a **published figure looks wrong**, please say so even if you are not sure.
That is the most valuable bug report this project can receive.

[main-guide]: https://github.com/bettergovph/bettergov/blob/main/CONTRIBUTING.md
[coc]: https://github.com/bettergovph/bettergov/blob/main/CODE_OF_CONDUCT.md
[discord]: https://discord.gg/mHtThpN8bT
[commits]: https://www.conventionalcommits.org/en/v1.0.0/
[hf]: https://huggingface.co/datasets/bettergovph/gaa
[issues]: https://github.com/bettergovph/ai-budget/issues
