/**
 * The side-by-side pages, for verify-hgab.ts. Their figures come from src/lib/mpb-compare.ts over each topic's lines;
 * here they are checked against each build's own totals and recounted by class and colour:
 *   - multi-purpose buildings (/hgab/2027/multi-purpose/nep-vs-house-bill): the map's lines, against mpb-years/summary.json;
 *   - flood control (/hgab/2027/flood-control): flood-compare/, against its summary and the flood control series on the
 *     chart by year (history.json), in all four budgets.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONGRESS_TERMS, PARTY_CODE_ALIASES, termOfYear, type CongressSeatsFile } from "../src/lib/hgab-congress-seats";
import { COMPARE_CARD_DISCLAIMER, DISCLAIMER_FLOOD, PARTY_CARD_DISCLAIMER } from "../src/lib/hgab-disclaimers";
import type { PartiesData } from "../src/lib/hgab-parties";
import type { HistoryData } from "../src/lib/hgab-history";
import { MPB_CSV_FIELDS, decodeMpbLines, type MpbData, type MpbLinesFile, type MpbSummary } from "../src/lib/hgab-mpb-years";
import {
  COMPARE_TOPICS, COMPARE_VIEW, FLOOD_CSV_FIELDS, GAA_PANEL_COLOR, budgetSource, floodDistrictMatrix, linesDistrictMatrix,
  matrixCopy, mpbScope, partyCopy, partyGrid, partyMatrix, type DistrictYearMatrix, compareByRegion, compareCopy, compareFigures, floodMatrix, foreignOnlyBudgets,
  inView, linesMatrix, panelDots, type BudgetKey, type CompareTopic, type FloodCompareSummary, type RegionYearMatrix,
} from "../src/lib/mpb-compare";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }

const n = (v: number) => v.toLocaleString("en-US");
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/);

/** RFC 4180 rows (quoted fields may hold commas, quotes and newlines). */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * The region-by-year matrix (Jason, 2026-11-06: "a matrix of the MPBs per region and per year … the same for flood
 * control"): each budget's column adds up to its total, the totals are the build's (and the chart's), and the columns the
 * page also maps equal the by-region figures from the drawn lines.
 */
function verifyMatrix(
  check: Check, topic: CompareTopic, data: MpbData, m: RegionYearMatrix, total: (key: string) => { lines: number; php: number } | undefined,
  o?: Opts, builtAt = "",
): void {
  // The shareable image's words (Jason, 2026-11-06: "a shareable version of that with our BetterGov logo, our disclaimer").
  if (o) {
    const mc = matrixCopy(topic, m, builtAt);
    const words = [mc.kicker, mc.title, mc.dek, ...mc.notes, mc.disclaimer];
    check(`matrix image: "${mc.title}", the disclaimer, the source and the address; ${mc.notes.length} notes, in plain words`,
      mc.disclaimer === COMPARE_CARD_DISCLAIMER && mc.source[1].startsWith(topic.url) && /As of /.test(mc.source[1])
        && mc.notes.some((x) => /not yet law/.test(x)) && mc.notes.some((x) => /not spending/.test(x))
        && (!m.budgets.some((b) => b.note) || mc.notes.some((x) => x.startsWith("* ")))
        && /\.png$/.test(topic.matrixImageName) && words.flatMap(o.readerCopyHits).length === 0,
      words.flatMap(o.readerCopyHits).join(", "));
  }
  const sums = m.budgets.map((_, i) => m.rows.reduce((a, r) => ({ lines: a.lines + r.cells[i].lines, php: a.php + r.cells[i].php }), { lines: 0, php: 0 }));
  check(`matrix: ${m.rows.length} regions × ${m.budgets.length} budgets (${m.budgets[0].key} to ${m.budgets[m.budgets.length - 1].key}); every column adds up to its total`,
    m.rows.every((r) => r.cells.length === m.budgets.length)
      && sums.every((s, i) => s.lines === m.totals[i].lines && s.php === m.totals[i].php));
  const off = m.budgets.filter((b, i) => { const t = total(b.key); return !t || t.php !== m.totals[i].php || t.lines !== m.totals[i].lines; });
  check(`matrix: every budget's total is the build's${topic.key === "flood" ? " and the flood control chart's" : ""}`, off.length === 0,
    off.map((b) => b.key).join(", "));
  const byRegion = compareByRegion(data, topic.budgets);
  const mapped = topic.budgets.map((k) => m.budgets.findIndex((b) => b.key === k));
  check(`matrix: its ${topic.budgets.join(", ")} columns equal the by-region figures of the mapped lines, region by region`,
    mapped.every((i) => i >= 0) && byRegion.length > 0 && byRegion.every((r) => {
      const row = m.rows.find((x) => x.region === r.region);
      return !!row && topic.budgets.every((k, j) => row.cells[mapped[j]].php === r.by[k].php && row.cells[mapped[j]].lines === r.by[k].lines);
    }));
}

/**
 * Each Congress's seats on today's districts (parties/congress-seats.json, `npm run build:hgab-congress-seats`): the five
 * Congresses, every district counted once per Congress, the 20th's parties the by-party page's, the 18th's and 19th's the
 * by-party page's election seats wherever that page matched a race to one district with the same towns.
 */
function verifyCongressSeats(check: Check, o: Opts): CongressSeatsFile | null {
  process.stdout.write("\nparties/congress-seats.json (each Congress's representative and party, for the party-by-year grids)\n");
  const path = resolve(o.out, "parties/congress-seats.json");
  check("congress-seats.json present (npm run build:hgab-congress-seats)", existsSync(path), path);
  if (!existsSync(path)) return null;
  const C = JSON.parse(readFileSync(path, "utf8")) as CongressSeatsFile;
  const P = JSON.parse(readFileSync(resolve(o.out, "parties/parties.json"), "utf8")) as PartiesData;
  check(`the five Congresses, 16th to 20th, with the budgets each passed (${C.terms.map((t) => `${t.congress}th: ${t.budget_years.join("/")}`).join("; ")})`,
    C.terms.map((t) => `${t.year}:${t.budget_years.join(",")}`).join("|") === CONGRESS_TERMS.map((t) => `${t.year}:${t.budget_years.join(",")}`).join("|")
      && [2015, 2019, 2020, 2023, 2026, 2027].every((fy) => termOfYear(fy)?.budget_years.includes(fy)));
  check(`every one of the 254 districts counted once per Congress (${C.terms.map((t) => `${t.year}: ${t.counts.same} same, ${t.counts.changed} changed, ${t.counts.absent} no race`).join("; ")})`,
    C.terms.every((t) => t.counts.same + t.counts.changed + t.counts.absent === 254 && Object.keys(t.seats).length === t.counts.same + t.counts.changed));
  const t25 = C.terms.find((t) => t.year === 2025)!;
  const off25 = P.seats.filter((s) => t25.seats[s.district_id]?.[0] !== s.party);
  check("20th Congress: each district's party is the by-party page's", off25.length === 0 && P.seats.length === 254, off25.slice(0, 3).map((s) => s.district_id).join(", "));
  const alias = (p: string | null) => (p ? PARTY_CODE_ALIASES[p] ?? p : null);
  const crossed: string[] = [];
  let compared = 0;
  for (const e of P.elections.filter((x) => x.year === 2019 || x.year === 2022)) {
    const t = C.terms.find((x) => x.year === e.year)!;
    for (const s of e.seats) {
      if (s.territory !== "same" || s.district_ids.length !== 1) continue;
      compared++;
      const ours = t.seats[s.district_ids[0]];
      if (!ours || ours[2] !== "same" || ours[0] !== alias(s.party)) crossed.push(`${e.year} ${s.district_ids[0]}: ${ours?.[0]} vs ${s.party}`);
    }
  }
  check(`18th and 19th Congress: ${compared} seats compared with the by-party page's elections, party and towns alike`, compared > 400 && crossed.length === 0, crossed.slice(0, 3).join("; "));
  check("party codes read alike across years (2016's LAKAS-CMD is LAKAS)",
    C.terms.every((t) => Object.values(t.seats).every((x) => !x[0] || !(x[0] in PARTY_CODE_ALIASES))));
  return C;
}

/**
 * The party-by-year grid (Jason, 2026-11-06: "map the charts based on their political party for that year"): every
 * column adds up to the region grid's total; each budget carries the Congress that passed it; a party's budget is only
 * districts it held with the same towns; the drawn rows (folded, plain) add up too; the words are plain.
 */
function verifyPartyMatrix(check: Check, o: Opts, topic: CompareTopic, dm: DistrictYearMatrix, regionTotals: Array<{ lines: number; php: number }>,
  C: CongressSeatsFile, builtAt: string): void {
  const m = partyMatrix(dm, C);
  const sum = (rows: typeof m.rows, i: number) => rows.reduce((a, r) => ({ lines: a.lines + r.cells[i].lines, php: a.php + r.cells[i].php }), { lines: 0, php: 0 });
  check(`party grid: every column's rows (parties and the rows with none) add up to the region grid's total`,
    m.budgets.every((_, i) => { const t = sum(m.rows, i); return t.php === regionTotals[i].php && t.lines === regionTotals[i].lines; })
      && dm.budgets.every((_, i) => dm.rows.reduce((a, r) => a + r.cells[i].php, 0) === regionTotals[i].php));
  check(`party grid: each budget carries the Congress that passed it (${m.terms.map((t, i) => `${m.budgets[i].key} ${t.congress}th`).filter((_, i) => i === 0 || m.terms[i].congress !== m.terms[i - 1].congress).join(", ")})`,
    m.budgets.every((b, i) => termOfYear(b.fy)?.year === m.terms[i].year));
  const wrong: string[] = [];
  m.budgets.forEach((b, i) => {
    const t = C.terms.find((x) => x.year === m.terms[i].year)!;
    let party = 0;
    for (const r of dm.rows) {
      const s = r.district ? t.seats[r.district] : undefined;
      if (s && s[2] === "same" && s[0]) party += r.cells[i].php;
    }
    const got = m.rows.filter((r) => r.kind === "party").reduce((a, r) => a + r.cells[i].php, 0);
    if (got !== party) wrong.push(b.key);
  });
  check("party grid: a party's budget is only the districts it held with the same towns; held counts within the Congress's",
    wrong.length === 0 && m.rows.filter((r) => r.kind === "party").every((r) => r.held.every((h, i) => h <= (C.terms.find((x) => x.year === m.terms[i].year)?.counts.same ?? 0))),
    wrong.join(", "));
  const grid = partyGrid(m);
  check(`party grid as drawn: ${grid.spec.rows.filter((r) => r.heat).length - (grid.folded.length ? 1 : 0)} parties, ${grid.folded.length} folded into Other parties, every column still adding up`,
    m.budgets.every((_, i) => grid.spec.rows.reduce((a, r) => a + r.cells[i].php, 0) === regionTotals[i].php)
      && grid.spec.groups!.reduce((a, g) => a + g.span, 0) === m.budgets.length && grid.spec.rows.every((r) => r.titles.length === m.budgets.length));
  const cp = partyCopy(topic, m, builtAt, grid.folded);
  const words = [cp.kicker, cp.title, cp.dek, ...cp.notes, cp.disclaimer];
  check("party grid's words: the Congress rule, no switches captured, districts held, the disclaimer; plain, sentences of at most 25 words",
    cp.disclaimer === PARTY_CARD_DISCLAIMER && sentences(cp.disclaimer).every((x) => o.words(x) <= 20)
      && cp.notes.some((x) => /Congress that passed it, elected in 2013 \(2015–2016\)/.test(x)) && cp.notes.some((x) => /switches during a term are not captured/.test(x))
      && cp.notes.some((x) => /number of districts it held/.test(x)) && /\.png$/.test(topic.partyImageName)
      && words.flatMap(o.readerCopyHits).length === 0 && cp.notes.flatMap(sentences).every((x) => o.words(x) <= 25),
    [...words.flatMap(o.readerCopyHits), ...cp.notes.flatMap(sentences).filter((x) => o.words(x) > 25)].join(" | "));
}

/** The checks both pages share: totals, kinds, regions, dots and colours, plain words, the title. */
function verifyTopic(
  check: Check, o: Opts, topic: CompareTopic, data: MpbData, builtAt: string,
  budget: (key: BudgetKey) => { lines: number; php: number }, foreignOnly: BudgetKey[],
): void {
  const f = compareFigures(data);
  for (const k of topic.budgets) {
    check(`${k}: ${n(f.budgets[k].lines)} lines and their amount, as the build's summary has them`,
      f.budgets[k].lines === budget(k).lines && f.budgets[k].php === budget(k).php);
  }
  check("the three kinds add up: NEP = in both + not in the House bill, House bill = in both + not in the NEP",
    f.paired.lines + f.nepOnly.lines === f.nep.lines && f.paired.lines + f.houseOnly.lines === f.house.lines
      && f.paired.nep_php + f.nepOnly.php === f.nep.php && f.paired.house_php + f.houseOnly.php === f.house.php
      && f.paired.higher + f.paired.lower + f.paired.same === f.paired.lines
      && f.nep.php === f.budgets["nep-2027"].php && f.house.php === f.budgets["house-2027"].php);
  const regions = compareByRegion(data, topic.budgets);
  check("the regions add up to the totals, in every budget",
    topic.budgets.every((k) => regions.reduce((a, r) => a + r.by[k].php, 0) === f.budgets[k].php
      && regions.reduce((a, r) => a + r.by[k].lines, 0) === f.budgets[k].lines));
  // Every map: one dot per placed line, coloured by match on the House bill / 2027 map, one colour on a budget's own
  // (the NEP blue; 2025 red, 2026 blue).
  const cp = compareCopy(topic, f, builtAt, { foreignOnly });
  const counts = topic.panels.map((p) => {
    const ds = panelDots(data, p);
    const c = { blue: 0, red: 0, yellow: 0, off: ds.filter((d) => !inView(d)).length };
    for (const d of ds) c[d.color]++;
    return { panel: p, ...c };
  });
  const drawn = (k: BudgetKey) => f.budgets[k].lines - f.undrawn[k].lines;
  const drawnCls = (cls: string, amount: "nep" | "house") =>
    data.lines.filter((l) => l.fy === 2027 && l.cls === cls && l.level !== "none" && l[amount] != null).length;
  const ok = counts.every((c) => {
    if (c.panel === "gaa-2025" || c.panel === "gaa-2026") return c[GAA_PANEL_COLOR[c.panel]] === drawn(c.panel) && c.blue + c.red + c.yellow === drawn(c.panel);
    if (c.panel === "nep") return c.blue === drawn("nep-2027") && c.red + c.yellow === 0;
    return c.blue === drawnCls("paired", "house") && c.red === drawnCls("house_only", "house") && c.yellow === drawnCls("nep_only", "nep")
      && c.blue + c.red === drawn("house-2027");
  });
  const colourWords = (c: { blue: number; red: number; yellow: number }) =>
    (["blue", "red", "yellow"] as const).filter((k) => c[k]).map((k) => `${n(c[k])} ${k}`).join(", ");
  check(`every placed line is a dot: ${counts.map((c) => `${c.panel} ${colourWords(c)}`).join("; ")}; `
    + `${counts.reduce((a, c) => a + c.off, 0)} outside the drawn view [${COMPARE_VIEW.join(", ")}]`,
    ok && counts.reduce((a, c) => a + c.off, 0) <= 25 && cp.panels.map((p) => p.key).join() === topic.panels.join());
  const unmapped = data.lines.filter((l) => l.fy === 2027 && l.level === "none");
  check(`FY2027 lines not drawn: ${unmapped.length}, all budgeted nationwide and named in the notes`,
    f.unmapped.lines === unmapped.length && unmapped.every((l) => l.region == null)
      && (unmapped.length === 0 || cp.notes.includes(`${n(unmapped.length)} lines budgeted nationwide`)));
  // The figure compares totals only (Jason, 2026-11-05: "let's just compare the totals for both").
  const numbers = [...cp.cells.flatMap((c) => [c.strong, c.span]), ...cp.panels.flatMap((p) => [p.lines, ...p.amounts.map((a) => a.php)])];
  const words = [cp.notes, ...numbers, ...cp.legend.flatMap((g) => [g.title ?? "", ...g.items.map((l) => l.label)]), ...cp.panels.map((p) => p.sub)];
  // Each map's colours are named on the legend (Jason, 2026-11-05: "the legend with red made it confusing for 2025 as
  // 2025 is red"): a GAA year's colour beside its year, the House bill / 2027 map's three in their own group.
  const gaaPanels = topic.panels.filter((p): p is "gaa-2025" | "gaa-2026" => p === "gaa-2025" || p === "gaa-2026");
  const matchGroup = cp.legend[cp.legend.length - 1];
  check(`the legend names each map's colours (${cp.legend.map((g) => `${g.title ? `${g.title} ` : ""}${g.items.map((l) => `${l.color} ${l.label}`).join(", ")}`).join(" | ")})`,
    gaaPanels.every((p) => cp.legend.some((g) => g.title == null && g.items.some((l) => l.color === GAA_PANEL_COLOR[p] && l.label.startsWith(p.slice(4)))))
      && matchGroup.items.map((l) => l.color).join() === "blue,red,yellow"
      && (gaaPanels.length === 0 ? cp.legend.length === 1 : cp.legend.length === 2 && /2027/.test(matchGroup.title ?? "")));
  check("the figure's numbers compare totals only: each map's lines and amount(s), and the changes; no count by match",
    !/\b(only|in both|not in the|added)\b/i.test(numbers.join(" "))
      && /yellow lines are not in the House bill’s total/i.test(cp.notes) && /candidates, not confirmed changes/.test(cp.notes));
  check("the figure's words are plain", words.flatMap(o.readerCopyHits).length === 0, words.flatMap(o.readerCopyHits).join(", "));
  // Jason (2026-11-05): "I need a disclaimer". The figure travels without the page, so it carries its own.
  check("the figure carries its disclaimer: independent and unofficial, not evidence of wrongdoing; two sentences of at most 20 words",
    cp.disclaimer === COMPARE_CARD_DISCLAIMER && sentences(cp.disclaimer).length === 2 && sentences(cp.disclaimer).every((x) => o.words(x) <= 20)
      && /independent and unofficial/i.test(cp.disclaimer) && /not evidence of wrongdoing/.test(cp.disclaimer)
      && o.readerCopyHits(cp.disclaimer).length === 0, cp.disclaimer);
  const title = cp.title.map((line) => line.map((r) => r.text).join(""));
  check(`the large title names the subject ("${topic.subject}"), then the totals`,
    title[0] === topic.subject && /in the (2027 )?House bill/.test(title.slice(1).join(" ")) && title.length >= 2, title.join(" / "));
  process.stdout.write(`  ${topic.budgets.map((k) => `${k} ${f.budgets[k].lines} lines ₱${(f.budgets[k].php / 1e9).toFixed(2)}B`).join(" · ")} · House only ${f.houseOnly.lines} · NEP only ${f.nepOnly.lines}\n`);
}

export function verifyMpbCompare(check: Check, o: Opts): void {
  const C = verifyCongressSeats(check, o);
  process.stdout.write("\nmulti-purpose/nep-vs-house-bill (the 2027 NEP and House bill side by side)\n");
  const dir = resolve(o.out, "mpb-years");
  const files = ["lines.json", "summary.json"].map((f) => resolve(dir, f));
  check("the map's lines and summary present", files.every((f) => existsSync(f)), dir);
  if (files.every((f) => existsSync(f))) {
    const data = decodeMpbLines(JSON.parse(readFileSync(files[0], "utf8")) as MpbLinesFile);
    const S = JSON.parse(readFileSync(files[1], "utf8")) as MpbSummary;
    verifyTopic(check, o, COMPARE_TOPICS.mpb, data, S.built_at, (key) => S.budgets.find((x) => x.key === key)!, []);
    const m = linesMatrix(data, S.budgets.map((b) => ({ key: b.key, fy: b.fy, stage: b.stage, ...(b.pap_rule ? {} : { note: "title_only" as const }) })));
    verifyMatrix(check, COMPARE_TOPICS.mpb, data, m, (key) => S.budgets.find((x) => x.key === key), o, S.built_at);
    if (C) verifyPartyMatrix(check, o, COMPARE_TOPICS.mpb, linesDistrictMatrix(data, m.budgets), m.totals, C, S.built_at);
    // About this data (Jason, 2026-11-06: "Let's do the same for MPBs"): the grouping, the fields, the CSV.
    const sc = mpbScope(data, S);
    check(`how we grouped them: one row per budget; budget lines by heading, then lines in by title; each adds up to the map's figures (${[...new Set(sc.flatMap((r) => r.parts.map((p) => p.label)))].join(" | ")})`,
      sc.length === S.budgets.length && sc.every((r, i) => {
        const b = S.budgets[i];
        const title = r.parts.find((p) => p.label.startsWith("Lines under other headings"));
        const budgetLines = r.parts.filter((p) => p !== title).reduce((a, p) => a + p.php, 0);
        return r.php === b.php && r.lines === b.lines && r.parts.reduce((a, p) => a + p.php, 0) === b.php
          && budgetLines === b.pap_php && (title?.php ?? 0) === b.title_only_php && (b.pap_rule || budgetLines === 0);
      }));
    check("how we grouped them: from 2020 the budget lines equal our chart by year; 2019 against the printed headings; the ₱0 items left out are counted",
      sc.every((r, i) => (r.fy >= 2020 ? r.check === "chart_budget_lines" && S.budgets[i].pap_php === r.chart_php : r.fy === 2019 ? r.check === "printed_headings" : r.check === null))
        && sc.every((r, i) => r.left_out?.lines === S.budgets[i].listed_at_zero) && sc.some((r) => r.left_out?.lines)
        && sc.every((r) => r.source === budgetSource(r.fy, r.stage)));
    const mpbCsv = resolve(dir, "lines.csv");
    if (existsSync(mpbCsv)) {
      const fd = readFileSync(mpbCsv).subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "");
      const head = fd.split("\n")[0].split(",");
      check(`the map's lines.csv: its ${head.length} columns are the fields the page describes, in order`,
        head.join() === MPB_CSV_FIELDS.map((f) => f.name).join(), head.join(","));
    }
    const mpbWords = [...MPB_CSV_FIELDS.map((f) => f.about), ...sc.map((r) => r.source), ...sc.flatMap((r) => r.parts.map((p) => p.label))];
    check("the fields and the grouping are in plain words", mpbWords.flatMap(o.readerCopyHits).length === 0, mpbWords.flatMap(o.readerCopyHits).join(", "));
    check(`matrix: the budgets with no multi-purpose building line (${m.budgets.filter((b) => b.note).map((b) => b.fy).join(", ")}) are marked`,
      m.budgets.filter((b) => b.note).every((b) => b.fy < 2018 && b.note === "title_only") && m.budgets.some((b) => b.note));
  }
  verifyFloodCompare(check, o, C);
}

function verifyFloodCompare(check: Check, o: Opts, C: CongressSeatsFile | null): void {
  process.stdout.write("\nflood-control (flood control in 2025, 2026 and 2027, side by side)\n");
  const dir = resolve(o.out, "flood-compare");
  const files = ["lines.json", "summary.json"].map((f) => resolve(dir, f));
  check("the flood control lines and summary present (npm run build:hgab-flood-compare)", files.every((f) => existsSync(f)), dir);
  if (!files.every((f) => existsSync(f))) return;
  const data = decodeMpbLines(JSON.parse(readFileSync(files[0], "utf8")) as MpbLinesFile);
  const S = JSON.parse(readFileSync(files[1], "utf8")) as FloodCompareSummary;
  const H = JSON.parse(readFileSync(resolve(o.out, "history.json"), "utf8")) as HistoryData;
  const col = (key: string) => H.columns.findIndex((c) => c.key === key);
  const flood = H.series.find((s) => s.key === "flood")!;
  const chart = (key: string) => flood.php[col(key)];
  check(`every budget equals the flood control chart by year: ${S.budgets.map((b) => `${b.key} ₱${n(b.php)}`).join(", ")}`,
    S.budgets.length === 4 && S.budgets.every((b) => b.php === chart(b.key) && b.history_php === b.php) && S.checks.every((c) => c.ok));
  const foreignOnly = foreignOnlyBudgets(S);
  check(`2026 is all foreign-assisted, as the chart has it (₱${n(flood.foreign_php?.[col("gaa-2026")] ?? 0)}), and only 2026`,
    foreignOnly.join() === "gaa-2026");
  check("every line is in the chart's flood control scope, in the build's format", data.lines.length > 0
    && data.lines.every((l) => l.rule === "pap" && (l.fy === 2027 ? l.cls != null : (l.fy === 2025 || l.fy === 2026) && l.gaa != null)));
  check(`the 2025 and 2026 lines are all drawn (head-office lines: ${Object.entries(S.head_office).map(([fy, h]) => `${fy} ${h.province_named} by the province named, ${h.listed_region} at the listed region`).join("; ")})`,
    data.lines.filter((l) => l.fy < 2027 && l.level === "none").length === 0
      && S.budgets.filter((b) => b.stage === "gaa").every((b) => b.not_drawn.lines === 0));
  check(`the FY2027 lines not on the map are the ${S.nationwide.lines} budgeted nationwide`,
    data.lines.filter((l) => l.fy === 2027 && l.level === "none").length === S.nationwide.lines);
  check("the page's disclaimer: enacted budgets beside proposals not yet law, placement our reading, candidates, no allegations, not spending",
    /enacted budgets/.test(DISCLAIMER_FLOOD.body) && /not yet law/.test(DISCLAIMER_FLOOD.body) && /can be wrong/.test(DISCLAIMER_FLOOD.body)
      && /candidates/.test(DISCLAIMER_FLOOD.body) && /irregularity or wrongdoing/.test(DISCLAIMER_FLOOD.body) && /not spending/.test(DISCLAIMER_FLOOD.body)
      && sentences(DISCLAIMER_FLOOD.body).every((x) => o.words(x) <= 25) && o.readerCopyHits(DISCLAIMER_FLOOD.body).length === 0,
    sentences(DISCLAIMER_FLOOD.body).map((x) => o.words(x)).join(", "));
  verifyTopic(check, o, COMPARE_TOPICS.flood, data, S.built_at, (key) => S.budgets.find((x) => x.key === key)!, foreignOnly);
  // The matrix's totals: the chart's from FY2020; before, the build's own (FY2019's lines add up to its printed headings).
  verifyMatrix(check, COMPARE_TOPICS.flood, data, floodMatrix(S), (key) => {
    const i = S.matrix.budgets.findIndex((b) => b.key === key);
    const php = col(key) >= 0 ? chart(key) : S.matrix.totals[i]?.[1];
    return i < 0 || php == null || php !== S.matrix.totals[i][1] ? undefined : { lines: S.matrix.totals[i][0], php };
  }, o, S.built_at);
  const years = Array.from({ length: 12 }, (_, i) => `gaa-${2015 + i}`).concat("nep-2027", "house-2027");
  if (C) verifyPartyMatrix(check, o, COMPARE_TOPICS.flood, floodDistrictMatrix(S), floodMatrix(S).totals, C, S.built_at);
  check(`matrix: every budget we have, FY2015 GAA to the 2027 House bill; 2015 to 2017 marked as the older code set`,
    S.matrix.budgets.map((b) => b.key).join() === years.join()
      && S.matrix.budgets.every((b) => (b.note === "former_codes") === (b.stage === "gaa" && b.fy <= 2017)));

  // How we grouped them (Jason, 2026-11-06: "we need a description how we grouped them, what fields and caveats").
  const partsOk = S.scope.every((r) => r.parts.length > 0 && r.parts.reduce((a, p) => a + p.php, 0) === r.php
    && r.parts.reduce((a, p) => a + p.lines, 0) === r.lines);
  const sameAsMatrix = S.scope.every((r, i) => r.key === S.matrix.budgets[i].key && r.php === S.matrix.totals[i][1] && r.lines === S.matrix.totals[i][0]);
  check(`how we grouped them: one row per budget; each row's parts add up to its total, which is the matrix's (${S.scope.map((r) => r.parts.map((p) => p.label).join(" + ")).filter((v, i, a) => a.indexOf(v) === i).join(" | ")})`,
    partsOk && sameAsMatrix && S.scope.length === years.length);
  check("how we grouped them: each total's check named — the chart from 2020, the printed headings in 2019, none before; flood-titled lines elsewhere tallied",
    S.scope.every((r) => (r.fy >= 2020 ? r.check === "chart" && r.chart_php === r.php : r.fy === 2019 ? r.check === "printed_headings" : r.check === null))
      && S.scope.every((r) => r.flood_titled_elsewhere.lines >= 0) && S.scope.some((r) => r.flood_titled_elsewhere.lines > 0)
      && S.scope.filter((r) => r.fy <= 2017).every((r) => r.parts.length === 1 && /Former flood control codes/.test(r.parts[0].label)));
  // The CSV: its header is the fields the page describes; one row per line; each budget's amounts add up to the matrix.
  const csvPath = resolve(dir, "lines.csv");
  check("lines.csv present, its checksum the summary's", existsSync(csvPath)
    && createHash("sha256").update(readFileSync(csvPath)).digest("hex") === S.outputs["lines.csv"].sha256);
  if (existsSync(csvPath)) {
    const rows = csvRows(readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""));
    const [head, ...body] = rows;
    const at = Object.fromEntries(head.map((h, i) => [h, i]));
    const sum = (k: string, fy: number) => body.reduce((a, r) => (Number(r[at.fiscal_year]) === fy && r[at[k]] !== "" ? { lines: a.lines + 1, php: a.php + Number(r[at[k]]) } : a), { lines: 0, php: 0 });
    const csvTotals = S.matrix.budgets.map((b) => sum(b.stage === "gaa" ? "gaa_php" : b.stage === "nep" ? "nep_php" : "house_bill_php", b.fy));
    check(`lines.csv: its ${head.length} columns are the fields the page describes, in order`, head.join() === FLOOD_CSV_FIELDS.map((f) => f.name).join(), head.join(","));
    check(`lines.csv: ${n(body.length)} rows, one per line; every budget's amounts add up to the matrix`,
      body.every((r) => r.length === head.length)
        && csvTotals.every((t, i) => t.lines === S.matrix.totals[i][0] && t.php === S.matrix.totals[i][1]));
  }
  const fieldWords = FLOOD_CSV_FIELDS.map((f) => f.about).concat(S.scope.map((r) => r.source), S.scope.flatMap((r) => r.parts.map((p) => p.label)));
  check("the fields and the grouping are in plain words", fieldWords.flatMap(o.readerCopyHits).length === 0, fieldWords.flatMap(o.readerCopyHits).join(", "));
}
