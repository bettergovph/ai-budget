/**
 * The ₱1 trillion in red flags page and posters (src/lib/hgab-redflags.ts), for verify-hgab.ts. The figures are the
 * People's Budget Coalition's, as it publishes them; this checks that they add up the way PBC's table does, in 2026 and
 * 2027; that every line we tie to the House bill still has the exact amounts our data lists (the line-by-line explorer,
 * or the DPWH project pages by program, with their project counts) and that PBC's figures are those amounts rounded;
 * that the page's own explanations follow the copy rules; and that the posters' addresses carry their MD5.
 */
import type { DuckDBConnection } from "@duckdb/node-api";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DPWH_PROJECTS, PBC_ROUNDING, RED_FLAG_GROUPS, RED_FLAG_LINES, RED_FLAG_POSTERS, RED_FLAG_TOTALS, RED_FLAG_UNPROGRAMMED,
  TRILLION, isDpwhLine, linesOf, type BillRef, type RedFlagFigures,
} from "../src/lib/hgab-redflags";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }
interface ExNode { k: string; l: string; n: number; h: number; c?: ExNode[] }
interface ExDept { nep: number; house: number; agencies: { name: string; nep: number; house: number; tree: ExNode[] }[] }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const B = (php: number) => `₱${(php / 1e9).toFixed(3)}B`;
const near = (a: number, b: number, tol = PBC_ROUNDING) => Math.abs(a - b) <= tol;
const COLUMNS = ["nep2026", "gaa2026", "nep", "house", "change"] as const;

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

export async function verifyRedFlags(c: DuckDBConnection, check: Check, o: Opts): Promise<void> {
  process.stdout.write("\n₱1 trillion in red flags (PBC's red-flag basket; src/lib/hgab-redflags.ts)\n");
  const T = RED_FLAG_TOTALS, U = RED_FLAG_UNPROGRAMMED;
  const sum = (xs: readonly RedFlagFigures[]) => Object.fromEntries(COLUMNS.map((k) => [k, xs.reduce((a, x) => a + x[k], 0)])) as unknown as RedFlagFigures;
  const show = (x: RedFlagFigures) => COLUMNS.map((k) => B(x[k])).join(" / ");

  // PBC's table, as published: the groups make the programmed total, and unprogrammed appropriations the rest. PBC
  // rounds each figure, so a printed total can sit one step (₱0.1B) from the sum of the printed parts.
  const g = sum(RED_FLAG_GROUPS);
  check("the three groups add up to PBC's programmed total in every column (2026 NEP and GAA, 2027 NEP, House bill, change)",
    COLUMNS.every((k) => g[k] === T.programmed[k]), `${show(g)} vs ${show(T.programmed)}`);
  check("with unprogrammed appropriations they make PBC's total, within one rounding step; ₱976.0B in the NEP, ₱1,059.7B in the House bill",
    COLUMNS.every((k) => near(T.programmed[k] + U[k], T.all[k], 2 * PBC_ROUNDING)) && T.all.nep === 976_000_000_000 && T.all.house === 1_059_700_000_000,
    `${show(sum([T.programmed, U]))} vs ${show(T.all)}`);
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
    check(`${grp.short}: its ${ls.length} lines add up to PBC's subtotal within rounding, in every column`,
      COLUMNS.every((k) => near(s[k], grp[k], tol)), `lines ${show(s)} vs ${show(grp)}`);
  }
  const offChange = RED_FLAG_LINES.filter((l) => !near(l.change, l.house - l.nep, 2 * PBC_ROUNDING));
  check("every line's change is its House bill minus its NEP within rounding", offChange.length === 0, offChange.map((l) => l.key).join(", "));
  const multiple = [...RED_FLAG_LINES, ...RED_FLAG_GROUPS, U, T.programmed, T.all].filter((x) => COLUMNS.some((k) => x[k] % 100_000_000 !== 0));
  check("every figure is in PBC's steps of ₱0.1 billion", multiple.length === 0, multiple.length ? String(multiple.length) : "");

  // Against our reading of the House bill (the explorer): the exact amounts, and PBC's figures round them.
  const dDir = resolve(o.out, "explorer", "d");
  const refs = RED_FLAG_LINES.flatMap((l) => (l.bill.kind === "line" || l.bill.kind === "change" ? [{ l, ref: l.bill.ref, kind: l.bill.kind }] : []));
  const files = [...new Set(refs.map((r) => r.ref.dept))].map((d) => resolve(dDir, `${d}.json`));
  const present = files.every((p) => existsSync(p));
  check(`explorer department files present for the ${refs.length} lines tied to the explorer (npm run build:hgab-lines)`, present,
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
    check(`the ${refs.length} lines tied to the explorer have the exact amounts it lists`, stale.length === 0, stale.join("; "));
    check("PBC's figures are those amounts rounded (for TUPAD and the DA equipment lines, the change only)", unrounded.length === 0, unrounded.join("; "));
    check("each line's explorer link finds it (the search box text is in a line's name)", unfound.length === 0, unfound.join("; "));
  }
  const idxPath = resolve(o.out, "explorer", "index.json");
  if (existsSync(idxPath)) {
    const ix = readJson<{ unprogrammed: number }>(idxPath);
    check("unprogrammed appropriations: the explorer's exact amount, the same in both documents, and PBC's ₱112.0B rounds it",
      ix.unprogrammed === U.exact && U.nep === U.house && U.change === 0 && near(U.house, U.exact), `${ix.unprogrammed} vs ${U.exact}`);
  }

  // DPWH: each line is one or more programs of our DPWH project pages, whose exact amounts and project counts the
  // module holds; PBC's figures round them, and the six together are every DPWH project.
  const dp = RED_FLAG_LINES.filter(isDpwhLine).map((l) => ({ l, ref: l.bill.kind === "dpwh" ? l.bill.ref : null }));
  check("the six DPWH lines each name their DPWH programs", dp.length === 6 && dp.every((x) => x.ref && x.ref.programs.length > 0));
  const parquet = resolve(o.out, "dpwh", "projects.parquet");
  check("dpwh/projects.parquet present (npm run import:hgab)", existsSync(parquet), parquet);
  if (existsSync(parquet) && dp.every((x) => x.ref)) {
    const rows = (await c.runAndReadAll(
      `SELECT program, SUM(COALESCE(nep_php, 0))::BIGINT AS nep, SUM(COALESCE(hgab3_php, 0))::BIGINT AS house,
              COUNT(*) FILTER (WHERE hgab3_php IS NOT NULL) AS projects
         FROM read_parquet('${parquet.replace(/'/g, "''")}') GROUP BY program`,
    )).getRowObjects();
    const by = new Map(rows.map((r) => [String(r.program), { nep: Number(r.nep), house: Number(r.house), projects: Number(r.projects) }]));
    const stale: string[] = [], unrounded: string[] = [];
    for (const { l, ref } of dp) {
      const a = ref!.programs.map((p) => by.get(p) ?? { nep: NaN, house: NaN, projects: NaN })
        .reduce((x, y) => ({ nep: x.nep + y.nep, house: x.house + y.house, projects: x.projects + y.projects }), { nep: 0, house: 0, projects: 0 });
      if (a.nep !== ref!.nep || a.house !== ref!.house || a.projects !== ref!.projects) stale.push(`${l.key}: data ${a.nep} → ${a.house} (${a.projects}), module ${ref!.nep} → ${ref!.house} (${ref!.projects})`);
      if (!near(l.nep, ref!.nep) || !near(l.house, ref!.house) || !near(l.change, ref!.house - ref!.nep)) unrounded.push(`${l.key}: PBC ${B(l.nep)} → ${B(l.house)}, data ${B(ref!.nep)} → ${B(ref!.house)}`);
    }
    check("each DPWH line has the exact amounts and House bill project count our DPWH project pages list for its programs", stale.length === 0, stale.join("; "));
    check("PBC's DPWH figures are those amounts rounded, in all three columns", unrounded.length === 0, unrounded.join("; "));
    const all = [...by.values()].reduce((x, y) => ({ nep: x.nep + y.nep, house: x.house + y.house }), { nep: 0, house: 0 });
    const six = dp.reduce((x, { ref }) => ({ nep: x.nep + ref!.nep, house: x.house + ref!.house }), { nep: 0, house: 0 });
    check("the six DPWH lines are every DPWH project, in the NEP and the House bill (₱572,924,074,000 → ₱587,075,661,000)",
      six.nep === all.nep && six.house === all.house && six.nep === DPWH_PROJECTS.nep && six.house === DPWH_PROJECTS.house,
      `six ${six.nep} → ${six.house}, all programs ${all.nep} → ${all.house}`);
  }
  const sPath = resolve(o.out, "dpwh", "summary.json");
  if (existsSync(sPath)) {
    const s = readJson<{ dataset: { totals: { nep_php: number; hgab3_php: number } } }>(sPath).dataset.totals;
    check("those DPWH totals are our DPWH pages' own (dpwh/summary.json)", s.nep_php === DPWH_PROJECTS.nep && s.hgab3_php === DPWH_PROJECTS.house,
      `${s.nep_php} → ${s.hgab3_php}`);
  }

  // Our words (PBC's line and group names are its own, quoted as published).
  const why = [...RED_FLAG_GROUPS.map((x) => x.why), U.why, ...RED_FLAG_LINES.map((l) => l.why)];
  check("every line, group and unprogrammed appropriations has its explanation", why.length === 27 && why.every((t) => t.trim().length > 20));
  const copy = [...RED_FLAG_GROUPS.map((x) => x.plain), U.plain, ...why, ...RED_FLAG_LINES.flatMap((l) => [l.short, l.note ?? "", l.bill.kind === "change" || l.bill.kind === "pbc" ? l.bill.why : ""])]
    .filter(Boolean);
  const long = copy.filter((t) => t.split(/(?<=[.;:])\s+/).some((s) => o.words(s) > 25));
  check("the page's own sentences have at most 25 words", long.length === 0, long.join(" | "));
  const banned = copy.flatMap((t) => o.readerCopyHits(t).map((h) => `${h}: ${t}`));
  check("no pipeline words in the page's own copy", banned.length === 0, banned.join(" | "));
  const blame = copy.filter((t) => /\b(corrupt|corruption|pork|ghost|anomal|scam|steal|stole|kickback)/i.test(t));
  check("the explanations accuse no one (no corruption, pork, ghost or kickback words)", blame.length === 0, blame.join(" | "));

  // The posters the link preview points to: built, and the addresses carry each file's MD5.
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
