---
license: cc0-1.0
language:
- en
- tl
pretty_name: "House Committee on Appropriations: FY2027 budget hearings"
tags:
- government
- philippines
- budget
- house-of-representatives
- hearings
- transcripts
- public-finance
size_categories:
- 10K<n<100K
task_categories:
- automatic-speech-recognition
- summarization
- question-answering
configs:
- config_name: hearings
  default: true
  data_files: hearings.parquet
- config_name: segments
  data_files: segments.parquet
- config_name: sections
  data_files: sections.parquet
- config_name: topics
  data_files: topics.parquet
- config_name: exchanges
  data_files: exchanges.parquet
- config_name: figures
  data_files: figures.parquet
- config_name: actions
  data_files: actions.parquet
- config_name: speakers
  data_files: speakers.parquet
- config_name: briefs
  data_files: briefs.parquet
---

# House Committee on Appropriations: FY2027 budget hearings

This dataset covers {hearings} budget briefings and hearings of the House Committee on Appropriations on the FY2027 budget, as streamed on the House of Representatives' YouTube channel from {first} to {last}. That is {hours} hours of video. It has:
- our machine transcript, with speaker turns;
- for each hearing, a timeline of sections, a record of what was deliberated on each topic, every peso figure that was spoken, and the actions taken, all written by a language model from that transcript.

The same data is on [budget.bettergov.ph/hearings](https://budget.bettergov.ph/hearings).

> **Independent and unofficial. The video is the record.**
> - The transcripts are machine-made and contain errors, especially in Tagalog and Taglish passages.
> - Speaker names were inferred by a language model from context and can be wrong.
> - Sections, topics, overviews, figures, actions and briefs were written by language models, not by people.
> - A peso figure here is what someone said in the hearing, as transcribed. It is not a budget amount: for amounts, use the NEP, the House bill and the GAA.
> - Check the video at the timestamp before you quote, cite or attribute anything.

## What's in it

| Config | Rows | One row is |
| --- | ---: | --- |
| `hearings` (default) | {n_hearings} | A hearing: video, title, agenda, date, length, agency, phase, overview, how it was made |
| `segments` | {n_segments} | A transcript turn: start and end time, speaker label, inferred speaker name, text |
| `sections` | {n_sections} | A stretch of the hearing (roll call, presentation, a member's interpellation, a motion…) with a summary |
| `topics` | {n_topics} | The deliberation record for one topic: the question at issue, the thread of who said what, positions, figures, actions, outcome and status |
| `exchanges` | {n_exchanges} | One question and answer inside a section, with its outcome |
| `figures` | {n_figures} | A peso figure as spoken, with who said it and when |
| `actions` | {n_actions} | A document request, commitment, motion or ruling |
| `speakers` | {n_speakers} | A person identified in a hearing: name, role, side (committee, agency…), confidence |
| `briefs` | {n_briefs} | An analyst brief for a hearing: headline, topline, budget figures, issues, committee actions, asks |

`raw/<video_id>/` has the files the site serves, unchanged: `meta.json`, `transcript.json`, `sections.json` and, where one exists, `brief.json`. `manifest.json` lists every file with its bytes and SHA-256.

Join everything on `video_id`. `section` joins `exchanges`, `figures` and `actions` to `sections`. Times are seconds (or milliseconds, in `segments`) from the start of the video, so `https://www.youtube.com/watch?v=<video_id>&t=<seconds>` opens the moment.

In `figures`, `amount` is the model's reading of `amount_text`, and `amount_text` is what the transcript says. Where the transcript is garbled, so is the amount. {figures_with_amount} figures have an amount:
- {figures_implausible} read as more than ₱100 trillion, which no single budget item comes near;
- {figures_amount_blanked} of those were too large to store and are blank here. They are kept as read in `raw/` and in `topics`.

Prefer `amount_text`, and check it against the video.

Columns that hold lists of objects (`thread`, `positions`, `figures` and `actions` in `topics`; most of `briefs`) are JSON text. Parse them with `json.loads`.

## How it was made

1. **Video.** We list the live streams from the House's YouTube channel, [@HouseofRepresentativesPH](https://www.youtube.com/@HouseofRepresentativesPH).
2. **Transcript.** We cut the audio into 30-minute chunks and run each through Deepgram Nova-3 on Cloudflare Workers AI. It gives both the words and the speaker turns (`transcript_engine`, `speaker_engine`).
   - Nova-3 is built for English, so Tagalog and Taglish passages are often garbled.
   - **Speaker labels (`S0`, `S1`, …) restart in every 30-minute chunk** (`chunk`). `S0` in chunk 0 and `S0` in chunk 1 are not necessarily the same person.
3. **Record.** A language model ({record_models}, via OpenRouter) reads the transcript and writes the record in four passes:
   - a timeline of sections for each 30-minute window;
   - topics consolidated across the hearing;
   - a deliberation record for each topic;
   - an overview, the speaker list and name corrections.

   `speaker_name` in `segments` and every name in the record come from this step.
4. **Briefs.** Briefs were extracted in a separate language-model session (`extraction` in `briefs`). `published_at` is the date of the YouTube stream, which is the date the site shows. Each brief carries its own `hearing_date`, and it differs from the stream date in {briefs_date_differs} briefs.

We don't publish YouTube's captions, which some pipeline steps used for comparison. Records the site has held back are left out too: {held_back} file in this release.

## Hearings

| Streamed | Video | Agency | Length | Segments | Sections | Topics | Brief |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
{hearing_rows}

## Use it

```python
from datasets import load_dataset

hearings = load_dataset("bettergovph/house-budget-hearings-2027", "hearings", split="train")
segments = load_dataset("bettergovph/house-budget-hearings-2027", "segments", split="train")
```

```sql
-- DuckDB: every figure spoken in hearings about DPWH, with a link to the moment
SELECT h.published_at, f.amount_text, f.what, f.speaker,
       'https://www.youtube.com/watch?v=' || f.video_id || '&t=' || f.seconds AS cue
FROM 'hf://datasets/bettergovph/house-budget-hearings-2027/figures.parquet' f
JOIN 'hf://datasets/bettergovph/house-budget-hearings-2027/hearings.parquet' h USING (video_id)
WHERE h.agency ILIKE '%DPWH%'
ORDER BY h.published_at, f.seconds;
```

## License

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The hearings are proceedings of the House of Representatives, and no copyright subsists in works of the Government of the Philippines (Republic Act 8293, section 176). BetterGov dedicates the transcripts and records to the public domain. Credit is welcome: "BetterGov.ph, FY2027 House budget hearings".

## Report a problem

If a name, figure or attribution is wrong, open a discussion on this dataset's Community tab or file an issue at [bettergovph/ai-budget](https://github.com/bettergovph/ai-budget/issues). Include the video id and the timestamp.

## Citation

```bibtex
@misc{{bettergov_house_budget_hearings_2027,
  title        = {{House Committee on Appropriations: FY2027 budget hearings}},
  author       = {{{{BetterGov.ph}}}},
  year         = {{{year}}},
  howpublished = {{\url{{https://huggingface.co/datasets/bettergovph/house-budget-hearings-2027}}}}
}}
```
