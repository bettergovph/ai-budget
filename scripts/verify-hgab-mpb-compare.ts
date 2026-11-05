/**
 * The NEP vs House bill page for multi-purpose buildings (/hgab/2027/multi-purpose/nep-vs-house-bill), for
 * verify-hgab.ts. Its figures come from src/lib/mpb-compare.ts over the map's lines; here they are checked against
 * mpb-years/summary.json (the map build's own totals) and recounted by class.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeMpbLines, type MpbLinesFile, type MpbSummary } from "../src/lib/hgab-mpb-years";
import { COMPARE_VIEW, HOUSE_ONLY_NOTE, compareByRegion, compareFigures, inView, sideDots } from "../src/lib/mpb-compare";

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
  check("the three kinds add up: NEP = in both + NEP only, House bill = in both + House bill only",
    f.paired.lines + f.nepOnly.lines === f.nep.lines && f.paired.lines + f.houseOnly.lines === f.house.lines
      && f.paired.nep_php + f.nepOnly.php === f.nep.php && f.paired.house_php + f.houseOnly.php === f.house.php
      && f.paired.higher + f.paired.lower + f.paired.same === f.paired.lines);
  const regions = compareByRegion(data);
  check("the regions add up to the totals, on both sides",
    regions.reduce((a, r) => a + r.nep.php, 0) === f.nep.php && regions.reduce((a, r) => a + r.house.php, 0) === f.house.php
      && regions.reduce((a, r) => a + r.houseOnly.lines, 0) === f.houseOnly.lines);
  const nepDots = sideDots(data, "nep");
  const houseDots = sideDots(data, "house");
  const off = [...nepDots, ...houseDots].filter((d) => !inView(d)).length;
  check(`every line is a dot (${nepDots.length.toLocaleString("en-US")} NEP, ${houseDots.length.toLocaleString("en-US")} House bill); ${off} outside the drawn view [${COMPARE_VIEW.join(", ")}]`,
    f.unmapped === 0 && nepDots.length === f.nep.lines && houseDots.length === f.house.lines && off <= 25);
  const copy = [HOUSE_ONLY_NOTE];
  check("the House-bill-only note says a candidate, not a confirmed insertion; plain words",
    /candidate, not a confirmed insertion/.test(HOUSE_ONLY_NOTE) && copy.flatMap(o.readerCopyHits).length === 0 && copy.every((t) => o.words(t) <= 25));
  process.stdout.write(`  NEP ${f.nep.lines} lines ₱${(f.nep.php / 1e9).toFixed(2)}B → House bill ${f.house.lines} lines ₱${(f.house.php / 1e9).toFixed(2)}B · House only ${f.houseOnly.lines} · NEP only ${f.nepOnly.lines}\n`);
}
