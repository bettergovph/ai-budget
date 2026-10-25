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

## Removed

- "What one row is" — no longer shown anywhere. The technical `grain` stays
  inside "Details for analysts" and on Methodology, labelled "Each row".

## Landing page

The intro hero (`/hgab/2027/intro`) shows only the title **House Budget
Analysis**. Anything the old hero said that readers still need (that this
covers four of the bill's programs, not the whole bill) moves into the first
chapter as one short line.

## Unchanged rules

Plain sentences of at most 20 words; factual headings with the number in them;
candidates, not findings; the NEP and the House bill are compared, never added;
amounts are published allocations, not spending; nothing attributes a project
to a person.
