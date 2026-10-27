# House bill section — copy rules

Reader-facing wording for everything under `/hgab`, the HGAB API and the MCP
tools. Applies to page text, labels, tooltips, chart captions, generated data
strings (dataset summaries, caveats, document titles, notes) and API/MCP
descriptions. Code identifiers (`printed_json`, `nep_printed_php`, …) and code
comments are not reader-facing and keep their names.

## Names

| Say | Not |
| --- | --- |
| **NEP** (`the NEP` in running text) | the President's proposed budget, the President's proposed budget (NEP), the President's proposal, the proposal (when it means the NEP) |
| **House bill** (HB 10858 on first use where useful) | HGAB, House General Appropriations Bill (except in the glossary term itself) |
| enacted budget (GAA) on first use, then GAA | |

Where a reader needs to know what the NEP is, say it once, plainly: "the NEP,
the budget the President submits to Congress each August". Do not repeat that
gloss on every line.

Examples: "In the NEP only" (not "In the President's proposal only"); "No
match in the NEP"; "House bill minus the NEP"; "Change from the NEP"; "2027
NEP" in chart keys (not "2027 proposal").

## Published, not printed

The documents are published budget documents. Say what they **publish**, list
or show:

| Say | Not |
| --- | --- |
| as published | as printed |
| published in, listed in | printed in |
| the totals published in the document | the printed totals / printed controls |
| what each document lists | what each document prints |
| an error in the published list (noted by the source) | a printing error / printed defect |
| the page number shown on the page | the printed page (number) |

"PDF page" stays for the position in the file. "Print" in its everyday sense
(print this page) is fine.

## DPWH offices and legislative districts

A DPWH district engineering office (DEO) has its own number. It need not match
the legislative district it serves: the Davao de Oro 1st DEO serves the
province's 2nd legislative district. A reader who sees one without the other
will mix them up.

- Always pair a DPWH office with the legislative district it serves. Show
  both, side by side, never one only on hover.
- Name an office as "DPWH … DEO": "DPWH Isabela 4th DEO". Beside a district,
  label it: "DPWH office: Davao de Oro 1st DEO".
- Never call an office a "district office". That reads as a legislative
  district, or a representative's own office.
- Call the districts legislative districts at least once in every view.
- Say what DEO means once per page, near its first use (`DEO_MEANING` in
  `src/lib/hgab-leaderboard.ts`).

| Say | Not |
| --- | --- |
| Davao de Oro, 2nd District · DPWH office: Davao de Oro 1st DEO | Davao de Oro, 2nd District (office on hover only) |
| DPWH Isabela 4th DEO (shared row headline) | Isabela 4th district office |
| DPWH offices, DEOs | district offices |

## Removed

- "What one row is" — no longer shown anywhere. The technical `grain` stays
  inside "Details for analysts" and on Methodology, labelled "Each row".

## Landing page

The section lands on the overview (`/hgab/2027/overview`; `/hgab` and
`/hgab/2027` redirect there). Its hero shows only the title **House Budget
Analysis**; what the old hero said (what the NEP is, that this covers four of
the bill's programs, not the whole bill) opens the page under it.

The story page (`/hgab/2027/intro`) is the **Explainer**: that is its sub-nav
label, right after Overview, and its hero kicker over the same title.

## Candidate changes

The overview's "House bill vs. NEP: candidate changes" table uses the
workbench's vocabulary with a plain gloss: **Insertion candidates** (in the
House bill only), **Deletion candidates** (in the NEP only), **Unchanged**,
**Increases**, **Decreases**, and **Scope review** for same-road pairs on
different stretches. Every count names its record type; the Total row says its
counts mix record types.

## Unchanged rules

Plain sentences of at most 20 words; factual headings with the number in them;
candidates, not findings; the NEP and the House bill are compared, never added;
amounts are published allocations, not spending; nothing attributes a project
to a person.
