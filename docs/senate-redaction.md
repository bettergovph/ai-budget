# Senate copies: signature redaction

The documents DPWH gave the Senate for the FY2027 House bill (R2 `hgab/2027/dpwh/supporting-documents/`, about 34,300 PDFs) carry the handwritten signatures and initials of officials. Those are personal data, so the copies are redacted before anyone publishes them. Scripts: `scripts/senate-redact/`.

Ported from the NEP signature stripper on vm3-server (`~/projects/dpwh`: `strip_signatures.py`, `model_scan_boxes.py`, `HANDOVER.md`). Read HANDOVER's warning about deleting annotations with PyMuPDF before changing the annotation step.

## Scope and decisions (Jason, 2026-11-13)

- PDFs of **19 pages or fewer** only, to keep model costs down; 20+ pages are skipped for now and listed in each region's `manifest.json`.
- **Black bars.** On typed pages the text under a bar is deleted too, so a hidden name can't be copied out.
- One **region** at a time.
- **Upload (Jason, 2026-11-14): the redacted copies overwrite the originals** on R2 (he keeps a backup of the originals). `upload_redacted.py ROOT slug…` writes every key of an identical-file group, only where R2 still holds the original or our earlier upload (logged in `<region>/upload.json`), then the CDN is purged by prefix (`budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/`, zone bettergov.ph, token in `~/.bettergov/.env`; edge cache is otherwise 4 hours). Object metadata: `sha256` (redacted), `original-sha256`, `redacted`.
- Still public as originals: PDFs of 20+ pages, damaged files, non-PDFs (jpg, docx, zip, kmz, xlsx) and a few PDFs without a `.pdf` extension. `update_links_jsonl.py ROOT` (Jason, 2026-11-14) rewrites `supporting-documents-file-links.jsonl` on R2 after each upload: uploaded rows get the redacted `bytes`/`sha256`/`md5`, `redacted: true` and `original_bytes`/`original_sha256`/`original_md5`; purge its URL afterwards. census reads the local copy in `scripts/senate-redact/cache/`, which keeps the originals' values.

## How it works

Per region (`run_regions.sh ROOT "Region VII" …`):

1. `census.py`: download the region's PDFs (curl: budget-assets refuses urllib), count pages, keep ≤19. Identical files are kept once. Damaged files (no readable pages) are skipped.
2. `redact_signatures.py detect`: every page with an image or annotation goes to two vision models on Z.ai (`GLM_API_KEY`, `~/.bettergovph/.env`): **glm-5v-turbo** (primary) and **glm-4.6v**. Each returns boxes round handwritten marks. Replies are cached by file sha256 under `ROOT/cache/`, so re-runs cost nothing.
3. `verify`: boxes found only by glm-4.6v are cropped and put to glm-5v-turbo ("handwriting, YES or NO?"). glm-4.6v alone boxes budget figures and printed names. The verifier is not a veto for anything else: it says NO to real signatures cropped over a printed name.
4. `apply` → `pass1/`: pasted signature images are removed whole; each box is grown over the pen strokes it touches and blacked out; scan pages that get a bar are **flattened** to one JPEG with the bars painted in (so nothing survives in scan layers, OCR text or annotations); Ink, Stamp and image-carrying annotations are dropped with pikepdf. Every output must read back in pikepdf and PyMuPDF with the source's page count, or it is deleted.
5. `sweep` + `apply --sweep glm-5v-turbo` → `redacted/`: glm-5v-turbo looks at each redacted page again for handwriting left outside the bars (loop tails, strokes between bars) and those get bars too.
6. `check_outputs.py`, then `build_gallery.py`: before | after images of every changed page, for a person to check.

`SWEEP=0 run_regions.sh …` defers step 5: `redacted/` starts as a hard-linked copy of `pass1/` and the region gets a `SWEEP_PENDING` marker; `sweep_regions.sh ROOT` later sweeps every marked region and replaces `redacted/` (Jason, 2026-11-13: sweep at the end, so regions finish faster). `redo_files.sh REGION_DIR file…` re-runs steps 4–6 for some files. `probe_limits.py` measures a model's concurrency.

## Facts worth knowing

- **Concurrency (2026-11-13):** glm-4.6v refuses an 11th call at once (429, code 1302). glm-5v-turbo never refused up to 30, but on real pages it runs at about 1.1–1.2 pages a second whatever the concurrency. Defaults: `glm-5v-turbo=10,glm-4.6v=10`. At 20 (with 4.6v at 10) Z.ai started refusing 5v-turbo calls in bulk (2,347 429s in Region II); rate-limit retries back off up to about 2 minutes.
- **Prompt:** both models skipped long diagonal "slash" signatures until the prompt named them (`PROMPT_VERSION` 2; cache folders are `<model>.p2`).
- **Saving:** PyMuPDF `garbage=3` or higher merges duplicate objects and looped the `/Pages` tree of some Cebu 7th DEO files; save with `garbage=2`.
- **Scans made of layers** (a photo plus 1-bit text masks) give striped artifacts with pixel redaction; that is why scan pages are flattened.
- **Letterhead logos** in one colour look like pasted signatures; in the top 15% of a page an image goes only when a model boxed it too.
- **Cost:** about $5–8 per 1,300 pages with the sweep (glm-5v-turbo $1.20/M input, $4/M output; glm-4.6v $0.30/$0.90).

## Quality (pilot, Region XIII)

Six reviewers checked every changed page and a quarter of the unchanged ones. No whole signature was missed; about 15 pages had a tail or loop outside a bar, which led to the sweep. Known leftovers: handwritten page numbers in corners are only sometimes barred, and a few bars cover printed figures next to a signature.

## The 2026 run

Output in `/data/senate-redact/<region>/` on the dev VM, gallery at `http://100.79.209.24:38118/` (Tailscale only: it shows the originals). Markdown extraction comes later, from the **redacted** copies with GLM-OCR (`layout_parsing`), never from the originals: OCR transcribes handwriting.
