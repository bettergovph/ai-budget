/**
 * The side-by-side pages, for verify-hgab.ts. Their figures come from src/lib/mpb-compare.ts over each topic's lines;
 * here they are checked against each build's own totals and recounted by class and colour:
 *   - multi-purpose buildings (/hgab/2027/multi-purpose/nep-vs-house-bill): the map's lines, against mpb-years/summary.json;
 *   - flood control (/hgab/2027/flood-control): flood-compare/, against its summary and the flood control series on the
 *     chart by year (history.json), in all four budgets.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMPARE_CARD_DISCLAIMER, DISCLAIMER_FLOOD } from "../src/lib/hgab-disclaimers";
import type { HistoryData } from "../src/lib/hgab-history";
import { decodeMpbLines, type MpbData, type MpbLinesFile, type MpbSummary } from "../src/lib/hgab-mpb-years";
import {
  COMPARE_TOPICS, COMPARE_VIEW, GAA_PANEL_COLOR, matrixCopy, compareByRegion, compareCopy, compareFigures, floodMatrix, foreignOnlyBudgets,
  inView, linesMatrix, panelDots, type BudgetKey, type CompareTopic, type FloodCompareSummary, type RegionYearMatrix,
} from "../src/lib/mpb-compare";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }

const n = (v: number) => v.toLocaleString("en-US");
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/);

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
    check(`matrix: the budgets with no multi-purpose building line (${m.budgets.filter((b) => b.note).map((b) => b.fy).join(", ")}) are marked`,
      m.budgets.filter((b) => b.note).every((b) => b.fy < 2018 && b.note === "title_only") && m.budgets.some((b) => b.note));
  }
  verifyFloodCompare(check, o);
}

function verifyFloodCompare(check: Check, o: Opts): void {
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
  check(`matrix: every budget we have, FY2015 GAA to the 2027 House bill; 2015 to 2017 marked as the older code set`,
    S.matrix.budgets.map((b) => b.key).join() === years.join()
      && S.matrix.budgets.every((b) => (b.note === "former_codes") === (b.stage === "gaa" && b.fy <= 2017)));

}
