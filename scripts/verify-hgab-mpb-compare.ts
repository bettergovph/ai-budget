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
  COMPARE_TOPICS, COMPARE_VIEW, GAA_PANEL_COLOR, compareByRegion, compareCopy, compareFigures, foreignOnlyBudgets, inView, panelDots,
  type BudgetKey, type CompareTopic, type FloodCompareSummary,
} from "../src/lib/mpb-compare";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }

const n = (v: number) => v.toLocaleString("en-US");
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/);

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
  const words = [cp.notes, ...numbers, ...cp.legend.map((l) => l.label), ...cp.panels.map((p) => p.sub)];
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
}
