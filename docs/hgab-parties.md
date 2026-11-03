# The House bill by party (`/hgab/2027/parties`)

Each of the 254 legislative districts with the representative the House lists, the party they ran under in the May
2025 election, and the DPWH budget at the offices serving those districts. The same for the 18th and 19th Congresses,
from the 2019 and 2022 elections, with the enacted budgets (GAA) those Congresses passed.

Jason, 2026-11-03: "For our House insertions, I want to map the current political party … determine the budget
allocations based on the currently elected officials. But also get ready for past electoral years."

| | |
| --- | --- |
| Page | `/hgab/2027/parties` (Districts menu → By party); a party line on every district page |
| Contract | `src/lib/hgab-parties.ts` (pure: page, builder, verifier, Worker SEO) |
| Builder | `npm run build:hgab-parties` → `data/hgab/2027/parties/parties.json` (~480 KB, ~2 s) |
| Checks | `scripts/verify-hgab-parties.ts`, run by `npm run verify:hgab` (19 checks) |
| Publish | `npm run upload:hgab -- --only=parties --skip-verify` after a full verify |

## Sources

- **Parties and results:** Open Halalan's 2001–2025 results as BetterGov Dynasties builds them
  (`~/projects/dynasty/data/dynasty.sqlite`, read-only; equal to the live API at `officials.bettergov.ph/api/v1`,
  data vintage 2026-09-14). The builder takes `--elections=<path>`.
- **Seat holders:** the House 20th Congress directory already on the district pages (`districts.json`
  `representative`, from the DEO2LEG crosswalk).
- **Money:** `leaderboard.json`'s office groups, unchanged: FY2027 NEP vs House bill per group, and each group's
  FY2020–2026 enacted budget.

## Rules

1. **Party = the party the seat holder ran under for that seat in May 2025**, as the results publish it. Members may
   have changed party since; the page says so wherever it shows a party.
2. **Join a district to its race** by city or province and district number (`seatKeyOf`). Two aliases: "City of Sta.
   Rosa" → SANTA ROSA, "North Cotabato" → COTABATO. Taguig's two districts are one two-seat race in the results; each
   member is matched to their district by name.
3. **Join the representative to a candidate** by surname (particles like "Dela" dropped, two-letter surnames kept), then
   first name. Where the House lists two names for a seat, the first name must match.
4. **Bases** (`Seat.basis`): `winner` 247 · `top_votes` 3 (the results list no winner: Butuan, Cagayan de Oro 2nd,
   Santa Rosa) · `seated_other` 2 (Manila 6th: COMELEC voided the first-placed candidate's candidacy; Maguindanao del
   Sur) · `two_listed` 1 (Cavite 4th) · `special_election` 1 (Antipolo 2nd: Philip Conrad Acop won the March 2026
   special election for the NUP after Romeo Acop died). Facts from outside the results are in `SEAT_FACTS` in the
   builder, each with a source.
5. **A party's figure adds the office groups serving only its members' districts.** An office group whose districts
   were won by different parties stays whole in "shared across parties", listed with every party. Never divided.
6. **Residual first:** the Central Office's added lines (with regional, office-change and no-office lines) carry no
   party and are stated before the party table.
7. **Average per district** counts tier A only (one office, one district).
8. **Earlier Congresses:** a district is read only where a race of the same name had the same towns as in 2025
   (`sameTowns`: same count, each town matched by name, by one name inside the other, or half the words; a rename
   counts as a change). An office group counts only when every district it serves was read and the group is not
   `reorganised`. Everything else is "not compared". The 20th Congress uses the current seats, as FY2027 does.
9. **Abbreviations** are as published; `PARTY_NAMES` has our names for them. ASENSO (a party in Abra and another in
   Manila) and PPP (Palawan and elsewhere) are not expanded, and are counted together under the abbreviation.

## Key figures (build of 2026-11-03)

- 254 seats: Lakas–CMD 103, NUP 33, NPC 32, PFP 28, NP 22, independents 11, LP 6, others 19.
- Projects the House added (insertion candidates): ₱161.6B. Central Office and no district office ₱97.7B (60%);
  district offices ₱64.0B.
- Of the ₱64.0B: Lakas–CMD offices ₱21.4B (33.5%, 71 offices); PFP ₱7.4B; NPC ₱5.8B; independents ₱4.1B; NP ₱4.0B;
  NUP ₱2.5B; shared across parties ₱14.1B (22.1%, 25 offices, 74 seats). Davao City's three HTL seats: ₱0.
- 18th Congress (FY2020–22): PDP–Laban 84 seats, ₱173.7B (22.4%) of ₱773.7B at district offices; 42 groups not
  compared. 19th (FY2023–25): PDP–Laban 65 seats ₱128.9B, NP 38 seats ₱127.7B; 30 not compared.

## Refresh

```bash
npm run build:hgab-parties          # after districts.json or leaderboard.json change, or a new dynasty build
npm run verify:hgab                 # parties/ section: 19 checks
npm run upload:hgab -- --only=parties --skip-verify
```

## Not done yet

- House leadership beyond the Speaker (Majority Leader, Deputy Speakers, Appropriations chair and vice chairs): the
  directory we have lists only the Speaker.
- Post-election party switches: no source here; the House roster on congress.gov.ph is behind a bot check.
- The location lens (PR #28) would place ₱134.8B of added lines in single districts instead of ₱64.0B by office.
  Lakas–CMD's districts lead there too (46% of the placed amount, with 41% of the seats). Not used: unmerged, and built
  to say where, never who.
- Not in the API or MCP; no share images.
