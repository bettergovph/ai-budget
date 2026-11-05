/**
 * The NEP vs House bill page for multi-purpose buildings (/hgab/2027/multi-purpose/nep-vs-house-bill), for
 * verify-hgab.ts. Its figures come from src/lib/mpb-compare.ts over the map's lines; here they are checked against
 * mpb-years/summary.json (the map build's own totals) and recounted by class.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeMpbLines, type MpbLinesFile, type MpbSummary } from "../src/lib/hgab-mpb-years";
import { COMPARE_VIEW, compareByRegion, compareCopy, compareFigures, dotColor, inView, mapDots, sideDots } from "../src/lib/mpb-compare";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }

export function verifyMpbCompare(check: Check, o: Opts): void {
  process.stdout.write("\nmulti-purpose/nep-vs-house-bill (the 2027 NEP and House bill side by side)\n");
  const dir = resolve(o.out, "mpb-years");
  const files = ["lines.json", "summary.json"].map((f) => resolve(dir, f));
  check("the map's lines and summary present", files.every((f) => existsSync(f)), dir);
  if (!files.every((f) => existsSync(f))) return;
  const data = decodeMpbLines(JSON.parse(readFileSync(files[0], "utf8")) as MpbLinesFile);
  const S = JSON.parse(readFileSync(files[1], "utf8")) as MpbSummary;
  const f = compareFigures(data);
  const b = (key: string) => S.budgets.find((x) => x.key === key)!;
  check(`NEP: ${f.nep.lines.toLocaleString("en-US")} lines and their amount, as the map's summary has them`, f.nep.lines === b("nep-2027").lines && f.nep.php === b("nep-2027").php);
  check(`House bill: ${f.house.lines.toLocaleString("en-US")} lines and their amount, as the map's summary has them`, f.house.lines === b("house-2027").lines && f.house.php === b("house-2027").php);
  check("the three kinds add up: NEP = in both + not in the House bill, House bill = in both + not in the NEP",
    f.paired.lines + f.nepOnly.lines === f.nep.lines && f.paired.lines + f.houseOnly.lines === f.house.lines
      && f.paired.nep_php + f.nepOnly.php === f.nep.php && f.paired.house_php + f.houseOnly.php === f.house.php
      && f.paired.higher + f.paired.lower + f.paired.same === f.paired.lines);
  const regions = compareByRegion(data);
  check("the regions add up to the totals, on both sides",
    regions.reduce((a, r) => a + r.nep.php, 0) === f.nep.php && regions.reduce((a, r) => a + r.house.php, 0) === f.house.php
      && regions.reduce((a, r) => a + r.nep.lines, 0) === f.nep.lines && regions.reduce((a, r) => a + r.house.lines, 0) === f.house.lines);
  const nepDots = sideDots(data, "nep");
  const houseDots = sideDots(data, "house");
  const off = [...nepDots, ...houseDots].filter((d) => !inView(d)).length;
  check(`every line is a dot (${nepDots.length.toLocaleString("en-US")} NEP, ${houseDots.length.toLocaleString("en-US")} House bill); ${off} outside the drawn view [${COMPARE_VIEW.join(", ")}]`,
    f.unmapped === 0 && nepDots.length === f.nep.lines && houseDots.length === f.house.lines && off <= 25);
  // The figure compares the two totals only (Jason, 2026-11-05: "let's just compare the totals for both").
  const cp = compareCopy(f, S.built_at);
  const numbers = [...cp.cells.flatMap((c) => [c.strong, c.span]), ...Object.values(cp.sides).flatMap((s) => Object.values(s))];
  const words = [cp.notes, ...numbers, ...cp.legend.map((l) => l.label)];
  check("the figure's numbers compare the totals only: each side's lines and amount, and the change; no count by match",
    cp.sides.nep.lines === `${f.nep.lines.toLocaleString("en-US")} lines` && cp.sides.house.lines === `${f.house.lines.toLocaleString("en-US")} lines`
      && cp.cells.length === 2 && !/\b(only|in both|not in the|added)\b/i.test(numbers.join(" ")));
  // The House bill map: its lines in blue (also in the NEP) and red (added), and the NEP lines it lacks in yellow.
  const hm = mapDots(data, "house");
  const colours = (side: "nep" | "house", ds: typeof hm) => ds.reduce((m, d) => ({ ...m, [dotColor(side, d.cls)]: (m[dotColor(side, d.cls)] ?? 0) + 1 }), {} as Record<string, number>);
  const hc = colours("house", hm);
  const nc = colours("nep", mapDots(data, "nep"));
  check(`House bill map: ${hc.blue} blue (also in the NEP), ${hc.red} red (added), ${hc.yellow} yellow (in the NEP, not the House bill); NEP map all blue`,
    hc.blue === f.paired.lines && hc.red === f.houseOnly.lines && hc.yellow === f.nepOnly.lines && hc.blue + hc.red === f.house.lines
      && nc.blue === f.nep.lines && Object.keys(nc).length === 1
      && /yellow lines are not in the House bill’s total/i.test(cp.notes) && /candidates, not confirmed changes/.test(cp.notes));
  check("the figure's words are plain", words.flatMap(o.readerCopyHits).length === 0, words.flatMap(o.readerCopyHits).join(", "));
  process.stdout.write(`  NEP ${f.nep.lines} lines ₱${(f.nep.php / 1e9).toFixed(2)}B → House bill ${f.house.lines} lines ₱${(f.house.php / 1e9).toFixed(2)}B · House only ${f.houseOnly.lines} · NEP only ${f.nepOnly.lines}\n`);
}
