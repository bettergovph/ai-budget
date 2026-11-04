/**
 * The ₱1 trillion in red flags page and posters (src/lib/hgab-redflags.ts), for verify-hgab.ts. The figures are the
 * People's Budget Coalition's, as it publishes them; this checks that they add up the way PBC's table does, that every
 * line we tie to the House bill still has the exact amounts our line-by-line explorer lists and that PBC's figures are
 * those amounts rounded, that the six DPWH lines add up to our DPWH project pages' totals, and that the posters the
 * page links are the files on disk.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DPWH_PROJECTS, PBC_ROUNDING, RED_FLAG_GROUPS, RED_FLAG_LINES, RED_FLAG_POSTERS, RED_FLAG_TOTALS, RED_FLAG_UNPROGRAMMED,
  TRILLION, isDpwhLine, linesOf, type BillRef,
} from "../src/lib/hgab-redflags";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }
interface ExNode { k: string; l: string; n: number; h: number; c?: ExNode[] }
interface ExDept { nep: number; house: number; agencies: { name: string; nep: number; house: number; tree: ExNode[] }[] }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const B = (php: number) => `₱${(php / 1e9).toFixed(3)}B`;
const near = (a: number, b: number, tol = PBC_ROUNDING) => Math.abs(a - b) <= tol;

/** The amounts a reference stands for, read from the explorer: a department, an agency, or every top-most line whose name matches. */
function billAmounts(dept: ExDept, ref: BillRef): { nep: number; house: number; found: number } {
  if (ref.scope === "department") return { nep: dept.nep, house: dept.house, found: 1 };
  if ("agency" in ref.scope) {
    const re = new RegExp(ref.scope.agency);
    const hits = dept.agencies.filter((a) => re.test(a.name));
    return { nep: hits.reduce((s, a) => s + a.nep, 0), house: hits.reduce((s, a) => s + a.house, 0), found: hits.length };
  }
  const re = new RegExp(ref.scope.label);
  const hits: ExNode[] = [];
  const walk = (n: ExNode) => { if (re.test(n.l)) hits.push(n); else (n.c ?? []).forEach(walk); };
  dept.agencies.forEach((a) => a.tree.forEach(walk));
  return { nep: hits.reduce((s, n) => s + n.n, 0), house: hits.reduce((s, n) => s + n.h, 0), found: hits.length };
}
/** Whether the explorer's search box (a case-insensitive "contains" on line names) shows something for `q`. */
function searchFinds(dept: ExDept, q: string): boolean {
  const needle = q.toLowerCase();
  const any = (n: ExNode): boolean => n.l.toLowerCase().includes(needle) || (n.c ?? []).some(any);
  return dept.agencies.some((a) => a.name.toLowerCase().includes(needle) || a.tree.some(any));
}

export function verifyRedFlags(check: Check, o: Opts): void {
  process.stdout.write("\n₱1 trillion in red flags (PBC's red-flag basket; src/lib/hgab-redflags.ts)\n");
  const T = RED_FLAG_TOTALS, U = RED_FLAG_UNPROGRAMMED;
  const sum = (xs: readonly { nep: number; house: number; change: number }[]) =>
    xs.reduce((a, x) => ({ nep: a.nep + x.nep, house: a.house + x.house, change: a.change + x.change }), { nep: 0, house: 0, change: 0 });

  // PBC's table, as published: the groups make the programmed total, and unprogrammed appropriations the rest.
  const g = sum(RED_FLAG_GROUPS);
  const g26 = RED_FLAG_GROUPS.reduce((a, x) => a + x.gaa2026, 0);
  check("the three groups add up to PBC's programmed total, in the NEP, the House bill, the change and the 2026 GAA",
    g.nep === T.programmed.nep && g.house === T.programmed.house && g.change === T.programmed.change && g26 === T.programmed.gaa2026,
    `${B(g.nep)} / ${B(g.house)} / ${B(g.change)} / ${B(g26)}`);
  check("with unprogrammed appropriations they make PBC's total: ₱976.0B in the NEP, ₱1,059.7B in the House bill",
    T.programmed.nep + U.nep === T.all.nep && T.programmed.house + U.house === T.all.house && T.programmed.change === T.all.change
      && T.programmed.gaa2026 + U.gaa2026 === T.all.gaa2026 && T.all.nep === 976_000_000_000 && T.all.house === 1_059_700_000_000);
  check("every group's and total's change is its House bill minus its NEP",
    [...RED_FLAG_GROUPS, T.programmed, T.all].every((x) => x.change === x.house - x.nep));
  // The title: past ₱1 trillion in the House bill, not in the NEP, and only with unprogrammed appropriations.
  check("the House bill's basket is past ₱1 trillion and the NEP's is not; without unprogrammed appropriations neither is",
    T.all.house > TRILLION && T.all.nep < TRILLION && T.programmed.house < TRILLION);

  // The lines: PBC rounds each one, so a group's lines may miss its subtotal by a rounding step per line.
  const keys = new Set(RED_FLAG_LINES.map((l) => l.key));
  check("23 lines with unique keys: 9 patronage, 3 political offices, 11 infrastructure",
    RED_FLAG_LINES.length === 23 && keys.size === 23 && linesOf("patronage").length === 9 && linesOf("political").length === 3
      && linesOf("infrastructure").length === 11);
  for (const grp of RED_FLAG_GROUPS) {
    const ls = linesOf(grp.key), s = sum(ls), tol = (ls.length + 1) * PBC_ROUNDING;
    check(`${grp.short}: its ${ls.length} lines add up to PBC's subtotal within rounding`,
      near(s.nep, grp.nep, tol) && near(s.house, grp.house, tol) && near(s.change, grp.change, tol),
      `lines ${B(s.nep)} → ${B(s.house)} (${B(s.change)}) vs ${B(grp.nep)} → ${B(grp.house)} (${B(grp.change)})`);
  }
  const offChange = RED_FLAG_LINES.filter((l) => !near(l.change, l.house - l.nep, 2 * PBC_ROUNDING));
  check("every line's change is its House bill minus its NEP within rounding", offChange.length === 0, offChange.map((l) => l.key).join(", "));
  const multiple = RED_FLAG_LINES.filter((l) => [l.nep, l.house, l.change].some((v) => v % 100_000_000 !== 0));
  check("every figure is in PBC's steps of ₱0.1 billion", multiple.length === 0, multiple.map((l) => l.key).join(", "));

  // Against our reading of the House bill: the explorer still lists the exact amounts, and PBC's figures round them.
  const dDir = resolve(o.out, "explorer", "d");
  const refs = RED_FLAG_LINES.flatMap((l) => (l.bill.kind === "line" || l.bill.kind === "change" ? [{ l, ref: l.bill.ref, kind: l.bill.kind }] : []));
  const files = [...new Set(refs.map((r) => r.ref.dept))].map((d) => resolve(dDir, `${d}.json`));
  const present = files.every((p) => existsSync(p));
  check(`explorer department files present for the ${refs.length} lines tied to the bill (npm run build:hgab-lines)`, present,
    files.filter((p) => !existsSync(p)).join(", "));
  if (present) {
    const cache = new Map<string, ExDept>();
    const dept = (id: string) => cache.get(id) ?? cache.set(id, readJson<ExDept>(resolve(dDir, `${id}.json`))).get(id)!;
    const stale: string[] = [], unrounded: string[] = [], unfound: string[] = [];
    for (const { l, ref, kind } of refs) {
      const d = dept(ref.dept), a = billAmounts(d, ref);
      if (a.found === 0 || a.nep !== ref.nep || a.house !== ref.house) stale.push(`${l.key}: explorer ${a.found} × ${a.nep} → ${a.house}, module ${ref.nep} → ${ref.house}`);
      const levels = kind === "change" || (near(l.nep, ref.nep) && near(l.house, ref.house));
      if (!levels || !near(l.change, ref.house - ref.nep)) unrounded.push(`${l.key}: PBC ${B(l.nep)} → ${B(l.house)} (${B(l.change)}), bill ${B(ref.nep)} → ${B(ref.house)}`);
      if (ref.q && !searchFinds(d, ref.q)) unfound.push(`${l.key}: "${ref.q}"`);
    }
    check(`the ${refs.length} lines tied to the bill have the exact amounts the explorer lists`, stale.length === 0, stale.join("; "));
    check("PBC's figures are those amounts rounded (for TUPAD and the DA equipment lines, the change only)", unrounded.length === 0, unrounded.join("; "));
    check("each line's explorer link finds it (the search box text is in a line's name)", unfound.length === 0, unfound.join("; "));
  }
  const idxPath = resolve(o.out, "explorer", "index.json");
  if (existsSync(idxPath)) {
    const ix = readJson<{ unprogrammed: number }>(idxPath);
    check("unprogrammed appropriations: the explorer's exact amount, the same in both documents, and PBC's ₱112.0B rounds it",
      ix.unprogrammed === U.exact && U.nep === U.house && U.change === 0 && near(U.house, U.exact), `${ix.unprogrammed} vs ${U.exact}`);
  }

  // DPWH: PBC splits DPWH's projects by program; the six lines add up to every DPWH project line our DPWH pages compare.
  const dp = sum(RED_FLAG_LINES.filter(isDpwhLine));
  check("PBC's six DPWH lines add up to DPWH's projects within rounding (₱572.9B → ₱587.1B)",
    near(dp.nep, DPWH_PROJECTS.nep, 7 * PBC_ROUNDING) && near(dp.house, DPWH_PROJECTS.house, 7 * PBC_ROUNDING),
    `${B(dp.nep)} → ${B(dp.house)} vs ${B(DPWH_PROJECTS.nep)} → ${B(DPWH_PROJECTS.house)}`);
  const sPath = resolve(o.out, "dpwh", "summary.json");
  if (existsSync(sPath)) {
    const s = readJson<{ dataset: { totals: { nep_php: number; hgab3_php: number } } }>(sPath).dataset.totals;
    check("those DPWH totals are our DPWH pages' own (dpwh/summary.json)", s.nep_php === DPWH_PROJECTS.nep && s.hgab3_php === DPWH_PROJECTS.house,
      `${s.nep_php} → ${s.hgab3_php}`);
  }

  // Our words (PBC's line and group names are its own, quoted as published).
  const copy = [...RED_FLAG_GROUPS.map((x) => x.plain), U.plain, ...RED_FLAG_LINES.flatMap((l) => [l.short, l.note ?? "", l.bill.kind === "change" || l.bill.kind === "pbc" ? l.bill.why : ""])]
    .filter(Boolean);
  const long = copy.filter((t) => t.split(/(?<=[.;])\s+/).some((s) => o.words(s) > 25));
  check("the page's own sentences have at most 25 words", long.length === 0, long.join(" | "));
  const banned = copy.flatMap((t) => o.readerCopyHits(t).map((h) => `${h}: ${t}`));
  check("no pipeline words in the page's own copy", banned.length === 0, banned.join(" | "));

  // The posters the page and link previews point to: built, and the addresses carry each file's MD5.
  const camp = resolve(o.out, "campaign");
  const posters = RED_FLAG_POSTERS.map((p) => {
    const path = resolve(camp, p.file);
    const md5 = existsSync(path) ? createHash("md5").update(readFileSync(path)).digest("hex").slice(0, 8) : null;
    return { p, md5 };
  });
  check("the posters' addresses carry their MD5 (npm run build:hgab-poster-redflags)",
    posters.every(({ p, md5 }) => /^[0-9a-f]{8}$/.test(p.v) && (md5 == null || md5 === p.v)),
    posters.map(({ p, md5 }) => `${p.file}: v=${p.v || "—"}, file ${md5 ?? "absent"}`).join("; "));
}
