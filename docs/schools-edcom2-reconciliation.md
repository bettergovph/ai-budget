# Schools directory × EDCOM 2's Classroom Construction Dashboard

**Status: built 2026-11-24** (see docs/schools-data.md, "EDCOM 2's terms, built in"); the questions in section 6 are still open.

A reconciliation of EDCOM 2's working document "Classroom Dashboard Comments" (Google Doc, tabs v3, v2, Field Notes and Feedback Form, read 2026-11-24) with what `/schools` does. It covers what matches, what to adopt, what differs and what to ask them. Figures are from our D1 on 2026-11-24.

## 1. Same data

- **Their sources** (v3 "Data Sources") are the same files as our data pack. The FY 2026 SBP Masterlist (DepEd, 5,652 projects, as of 20 August 2026) has 5,652 records in ours too. DepEd's list of public schools with IPEd and Last Mile tags (SY 2025–2026, 48,129 public schools, as of February 2026) matches the 48,129 schools in our registry marked `Public`. The school-level shortage is DepEd's for SY 2023–2024, submitted 13 October 2025. Enrolment is from DepEd's LIS for SY 2023–2024, as of 31 January 2024.
- **Their allocation-status table matches ours closely** (number of schools):

| Shortage level | Over-allocated: theirs / ours | Total in the level: theirs / ours |
|---|---|---|
| Moderate (1–4) | 1,028 / 1,016 | 16,860 / 16,768 |
| Severe (5–10) | 195 / 193 | 4,998 / 4,955 |
| Extreme (11+) | 128 / 128 | 3,387 / 3,381 |
| No recorded shortage | 1,691 / 1,666 | — |

Small gaps are expected: we round DepEd's fractional shortages to whole classrooms before setting the level.

## 2. One figure to raise with EDCOM 2: "Fully Allocated"

Their "Fully Allocated" counts (791, 454 and 510, marked "subject to data validation") are far above the schools whose allocation equals their shortage (ours: 397, 51 and 15). They are close to the schools that got **some allocation, up to their shortage** (ours: 788, 494 and 722), and their "Underallocated" counts are close to the schools with **no allocation** (ours: 14,964, 4,268 and 2,531, against their 15,041, 4,349 and 2,749). The column probably mixes partly allocated schools in with fully allocated ones. That should be confirmed with them before either dashboard publishes the split.

## 3. Definitions: adopt theirs, keep ours where they add something

| EDCOM 2 term (v3) | Ours today | Action |
|---|---|---|
| Classroom Shortage; Schools with Shortages | same | Use their names. Add "out of N schools / N classrooms in the area" to the tiles (their v3 items 2–4). |
| Classrooms for Allocation | "2026 list" classrooms | Rename. |
| **Allocation-to-Shortage Ratio** = allocated ÷ shortage × 100 (can pass 100%) | not shown | **Add**: 31,210 ÷ 164,763 = **18.9%** nationally. |
| Remaining Unfunded (after allocations, excess elsewhere not counted) | "Left short" / `gap` | Rename. Same rule: 147,811. |
| Underallocated / Fully Allocated / Overallocated / No Recorded Shortage / No Shortage Data | not per school | **Add a status per school** (list filter, map, school page) and their table by shortage level. |
| **Excess Allocated Classrooms** (incl. schools with no recorded shortage; no-data schools left out and flagged) | "listed at schools not short" (7,070), part of it | **Add the whole measure: 14,257** (7,281 at schools with no recorded shortage + 6,976 beyond need at short schools), with their two-way breakdown. |
| Estimated Funds for Excess Allocation (comment: assume ₱2.5M a classroom) | not shown | **Show both**: at their ₱2.5M, **₱35.6B**; from the projects' own budgets (funded projects, prorated), **₱25.3B**. Many excess classrooms are PSIP III "for bidding" and have no amount. |
| Shortage levels Moderate 1–4 / Severe 5–10 / Extreme 11+ | map classes 1–2, 3–5, 6–10, 10+ | **Built by rate instead** (Jason, 2026-11-24, taking their proposed change): Moderate up to 20%, Severe more than 20% to 50%, Extreme more than 50%. The section 2 comparison above uses their count-based levels. |
| Proposed **Classroom Shortage Rate** = shortage ÷ (available classrooms + shortage) × 100, absolute kept beside it | not shown | **Add** per school and area. It answers their comment on school size: 1 short of 6 needed (16.7%) is not 1 short of 31 (3.2%). |
| Funding and Implementation Modality | "who builds" table | Rename to "Allocation by Funding and Implementation". Add the modality column to school lists, as their v3 asks. |
| School list ordered by remaining unfunded or index | sort "shortage left after the 2026 list" | Already there; rename to "Remaining unfunded". |
| "NULL" shortage = School ID not in the SY 2023–2024 dataset (missing then, or opened after) | "No 2023 shortage data (not zero)" | **Use their explanation word for word** on "No data". |
| Colours: shortage blue, allocation green, remaining unfunded red, overallocated orange, no data brown | ours differ | Use their colours for the **allocation status** (with labels, never colour alone). Keep the map's shortage ramp but use their three levels. |
| LGU view: click an LGU for its schools; LGU income class (DOF–BLGF FY 2025) | region and schools division | **Add a city/municipality level** to `/schools/shortage`, with the income class the shortage file carries. |
| Distribution of shortages in steps of 10; the 90–100 tail (comments) | not shown | **Add a histogram** to the overview, plus the list of the biggest shortages (the list already sorts by shortage). |
| "Stretch: AI to summarise highlights" | computed "What the data says" | Already done without AI: every sentence is computed from the data. |

**Data note to carry** (theirs): "The dashboard uses the latest datasets submitted by DepEd to EDCOM II as of publication. Classroom shortage figures are from SY 2023–2024, while classroom allocations are from FY 2026. Reported concerns will be subject to review and validation before any changes are made to the dashboard." Our pages should say the same, and our "2023" labels should read "SY 2023–2024".

**Their sources go into our citations as they word them:** FY 2026 SBP Masterlist (as of 20 August 2026); shortage SY 2023–2024 (submitted 13 October 2025); LIS enrolment SY 2023–2024 (as of 31 January 2024); Project BUKAS facilities SY 2023–2024 (TLS, makeshift rooms, condemnation; as of July 2026); IPEd and Last Mile tags SY 2025–2026 (as of February 2026); LGU income classification FY 2025, DOF–BLGF (as of September 2026). Our 2022 coordinates (LIS before NSBI) are not in their list: ask which source they use for school locations.

## 4. Their field notes, checked against our data (Camarines Sur)

| Field note | What our data shows |
|---|---|
| Pasacao: Macad ES "received a classroom allocation despite a small student population and no identified shortage" | Confirmed. Macad ES (112909): shortage 0, 112 learners, 7 classrooms; 3 classrooms in the 2026 list (LGU – Province). It counts as **overallocated, no recorded shortage**. |
| Pasacao: San Antonio NHS "not reflected in the official shortage list" | Confirmed. San Antonio NHS (306377) has **no shortage row** and no enrolment row, and one DPWH contract names it. |
| Pasacao: Balogo ES "needing additional classrooms" | Short 4, 7 makeshift rooms and 1 TLS, **no 2026 allocation**; 2 DPWH contracts since 2016. |
| Pasacao: Caranan West, an unresolved concern from about six years ago | Caranan West ES (137200): **no shortage data**, 131 learners, 2 classrooms, no DPWH contract linked. |
| Pasacao: Pasacao Municipal HS covered court turned into classrooms | The registry has no "Pasacao Municipal HS"; its nearest match, Pasacao NHS (309769), is short 23 and allocated 2. To confirm with EDCOM 2. |

So the field notes and the data agree. Our school pages put this side by side for any school, and the field-report form is how other LGUs can send the same kind of observation.

## 5. Feedback form: merging theirs and ours

Their form asks "What would you like to report?" and offers four report types: (1) needs classrooms, (2) does not need them, (3) site issue for construction, (4) project status. Then it asks when the information was verified, the relationship to the school, uploads, and name and contact. Ours is one short report per school (listing, shortage, how many, what you see, projects, relationship, note, photo links). Proposed merged form (one report per school, sections that map one to one to their four types, so exports match their categories):

| # | Question | From | Notes |
|---|---|---|---|
| 1 | Is the school here and open? (here and open / open but elsewhere / closed or merged / could not find it) | ours | Checks DepEd's list itself; they don't ask it. |
| 2 | Does the school need more classrooms? **Yes / No / Not sure** | both | Their type 1 or 2. |
| 2a | If yes: why? (any) insufficient for current enrolment · enrolment increasing · damaged or unusable classrooms · relies on temporary or makeshift spaces · other | theirs | Replaces our "what do you see", which becomes 2c. |
| 2b | If yes: about how many more? (shown beside DepEd's SY 2023–2024 count **and the FY 2026 allocation**) | both | Showing the allocation answers their comment "schools that don't need THAT many". |
| 2c | Optional counts: makeshift rooms or TLS · classes in shifts · classrooms for condemnation | their comment (Karol) | Optional numbers; they map to the Project BUKAS fields. |
| 2d | If no: why? existing classrooms enough · new classrooms completed · enrolment decreased · other | theirs | |
| 3 | Is there space to build? (space available / no space / unsuitable / land ownership or permission issue / space available but not considered) | theirs | Shown when the school needs classrooms or has an allocation. |
| 4 | Each project at the school (FY 2026 list and DPWH contracts): not started · ongoing · **delayed or stalled** · completed and in use · completed, not in use · not sure | both | Adds their "delayed or stalled" (Pasacao's unfinished TLS). |
| 5 | When did you last see this? (date) | theirs | We dropped it earlier; their validation needs it. |
| 6 | Relationship: Principal/OIC · Teacher/school personnel · Parent/guardian · Student · LGU official/personnel · Concerned citizen · Other | theirs | Their list replaces ours. |
| 7 | Details (required when the answer disputes the data), photos or documents | both | Uploads: start with links. File uploads (R2, private until reviewed) need a policy on photos of minors. |
| 8 | Name and contact | theirs | Comes from the sign-in (verified email). The review team sees it, the public never does. A mobile number is optional. |

Everything submitted stays a report "subject to review and validation" (their data note). Pages show counts only.

## 6. Questions for EDCOM 2

1. Is "Fully Allocated" really schools with some allocation up to their shortage (section 2)?
2. Which shortage rule sets the levels: rounded, or fractional "at least 1"? Should shortage levels move to the Shortage Rate, as their v3 proposes?
3. Estimated funds for excess: keep the flat ₱2.5M, or use each project's own budget per classroom (₱25.3B against ₱35.6B)?
4. What is the source of school locations, and of LGU income class for cities?
5. Can field reports collected here flow into their review queue (a CSV or API export in their four categories)?

## 7. Cross-check with EDCOM 2's dashboard tiles (national, 2026-11-24)

| Tile | EDCOM 2 | Ours | Gap | Explained by |
|---|---:|---:|---:|---|
| Schools with shortages | 25,823 | 25,680 with any shortage above 0 (our tile shows 25,104, schools still short after rounding to whole classrooms) | 143 | Schools in DepEd's shortage list but not in the registry. Our pack keeps registry schools only, and 151 linked projects already point to such IDs. |
| Classroom shortage | 165,443 | 164,763 unrounded (our tile shows 164,685, rounded per school) | 680 | The same schools outside the registry. |
| "out of … total classroom shortage" (allocation tile) | 165,364 | 164,685 | 679 | Their own second figure is 79 below their first: the rounding per school we use (ours drops 78). |
| Total classrooms needed (available + shortage) | 821,724 | 815,530 | 6,194 | Available classrooms: 656,281 against our 650,767 (registry and LIS give the same figure). Partly the schools outside the registry; the rest unknown. |
| Classrooms with allocation | 32,305 | 31,210 at registry schools; 31,905 counting all ID-linked projects; 32,419 in every project | 1,095 / 400 / −114 | 695 classrooms are at shortage-list schools outside the registry. The other 400 are probably some of the 92 projects the pack left for review (514 classrooms), which EDCOM 2 may have linked another way. No subset matches exactly. |

**Conventions to align:**
- EDCOM 2 counts schools with **any** shortage above zero, and shows the unrounded total.
- The pages round each school to whole classrooms. That keeps covered + remaining = shortage exact, but understates the headline counts by 576 schools and 78 classrooms.

**To close the rest:** the source workbook (`source/classroom_shared_source.xlsx`, with the full `shortages 2023` sheet), or EDCOM 2's own extract, with its shortage-list schools outside the registry and their project links.
