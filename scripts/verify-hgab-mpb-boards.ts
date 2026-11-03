/**
 * `mpb-boards/` (the leaderboards' four multi-purpose building boards, npm run build:hgab-mpb-boards), for
 * verify-hgab.ts. Every row is recomputed here from the map's lines (mpb-years/lines.json), their contracts
 * (contractors/mpb-links.json) and districts.json, with this file's own grouping, not the builder's.
 * The ranking itself (first row, order, pool) is checked with the other boards in verifyLeaderboard.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LINKED_YEARS, decodeContractorIndex, decodeMpbContracts, type ContractorIndexFile, type MpbContractsFile } from "../src/lib/hgab-contractors";
import { DISCLAIMER_MPB, MPB_CARD_DISCLAIMER } from "../src/lib/hgab-disclaimers";
import {
  BOARD_ALIASES, BOARDS, MPB_BOARD_SETS, decodeMpbBoards, type LeaderPerson, type LeaderboardData, type MpbBoardRow, type MpbBoardSet,
  type MpbBoardsFile,
} from "../src/lib/hgab-leaderboard";
import { MPB_MAP_ROOT, decodeMpbLines, type MpbLinesFile } from "../src/lib/hgab-mpb-years";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }
interface Agg { lines: number; gaa: number; first: number; last: number; region: string | null; contracts?: Set<string>; contractPhp?: number }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

export function verifyMpbBoards(check: Check, o: Opts): void {
  process.stdout.write("\nmpb-boards/ (multi-purpose building leaderboards)\n");
  const path = resolve(o.out, "mpb-boards", "boards.json");
  const inputs = {
    lines: resolve(o.out, "mpb-years", "lines.json"),
    contracts: resolve(o.out, "contractors", "mpb-links.json"),
    districts: resolve(o.out, "districts.json"),
  };
  const present = [path, ...Object.values(inputs)].every((p) => existsSync(p));
  check("boards.json present with its inputs (npm run build:hgab-mpb-boards)", present, path);
  if (!present) return;
  const raw = readJson<MpbBoardsFile>(path);
  const B = decodeMpbBoards(raw);
  check("schema 1, enacted budgets 2020 to 2026, built from the current map lines, contracts and districts.json",
    B.schema === 1 && B.years[0] === LINKED_YEARS[0] && B.years[1] === LINKED_YEARS[1]
      && Object.entries(inputs).every(([k, p]) => B.sources[k] === sha(p)),
    Object.entries(inputs).filter(([k, p]) => B.sources[k] !== sha(p)).map(([k]) => `${k} changed since the build`).join(", "));

  // Recompute every row.
  const data = decodeMpbLines(readJson<MpbLinesFile>(inputs.lines));
  const contracts = decodeMpbContracts(readJson<MpbContractsFile>(inputs.contracts));
  const D = readJson<{ districts: Array<{ id: string; label: string; region: string | null; representative: { name: string | null; status: string; candidates?: Array<{ name: string | null }> } | null }> }>(inputs.districts);
  const lines = data.lines.filter((l) => l.fy >= B.years[0] && l.fy <= B.years[1] && (l.gaa ?? 0) > 0);
  const gaaOf = (l: (typeof lines)[number]) => l.gaa ?? 0;
  check(`totals: ${lines.length.toLocaleString("en-US")} lines from 2020 to 2026 and their amount`,
    B.totals.lines === lines.length && B.totals.gaa_php === lines.reduce((a, l) => a + gaaOf(l), 0));
  const agg = (set: MpbBoardSet): { rows: Map<string, Agg>; rest: { lines: number; gaa: number } } => {
    const rows = new Map<string, Agg>();
    const rest = { lines: 0, gaa: 0 };
    const add = (k: string, l: (typeof lines)[number], region: string | null) => {
      const a = rows.get(k) ?? { lines: 0, gaa: 0, first: l.fy, last: l.fy, region };
      a.lines++; a.gaa += gaaOf(l); a.first = Math.min(a.first, l.fy); a.last = Math.max(a.last, l.fy);
      rows.set(k, a);
      return a;
    };
    for (const l of lines) {
      if (set === "contractors") {
        const c = contracts.get(l.id);
        if (!c) { rest.lines++; rest.gaa += gaaOf(l); continue; }
        for (const x of c.contractors) {
          const a = add(x.key, l, null);
          a.contracts ??= new Set();
          if (!a.contracts.has(c.contractId)) { a.contracts.add(c.contractId); a.contractPhp = (a.contractPhp ?? 0) + c.php; }
        }
      } else if (set === "barangays") {
        const p = l.place >= 0 ? data.places[l.place] : null;
        if (p && p.level === "barangay") add(p.key, l, p.region); else { rest.lines++; rest.gaa += gaaOf(l); }
      } else if (set === "offices") {
        if (l.office && /District Engineering Office/i.test(l.office)) add(l.office, l, null); else { rest.lines++; rest.gaa += gaaOf(l); }
      } else {
        if (l.district >= 0) add(data.districts[l.district].id, l, data.districts[l.district].region); else { rest.lines++; rest.gaa += gaaOf(l); }
      }
    }
    return { rows, rest };
  };
  const repOf = new Map(D.districts.map((d) => [d.id, d.representative]));
  const regionOf = new Map(D.districts.map((d) => [d.id, d.region ?? ""]));
  for (const set of MPB_BOARD_SETS) {
    const { rows, rest } = agg(set);
    const got = B[set];
    const bad: string[] = [];
    if (got.length !== rows.size || new Set(got.map((r) => r.key)).size !== got.length) bad.push(`${got.length} rows vs ${rows.size}`);
    for (const r of got) {
      const a = rows.get(r.key);
      if (!a || a.lines !== r.lines || a.gaa !== r.gaa_php || a.first !== r.first_year || a.last !== r.last_year
        || (set !== "offices" && set !== "contractors" && a.region !== r.region)
        || (set === "contractors" && (a.contracts?.size !== r.contracts || Math.abs((a.contractPhp ?? 0) - (r.contract_php ?? 0)) > 1))) bad.push(r.key);
      if (set === "districts") {
        // The district leads, its region under it; no representative in the row's text (the person is kept, unshown).
        const rep = repOf.get(r.key);
        const name = rep?.status === "ambiguous" && !rep.name ? (rep.candidates ?? []).map((x) => x.name).filter(Boolean).join(" / ") || null : rep?.name || null;
        const label = data.districts[data.districtIndex.get(r.key)!].label;
        const region = regionOf.get(r.key) ?? "";
        if (r.label !== label || r.sub !== region || /\bRep\./.test(`${r.label} ${r.sub}`) || r.person?.district_id !== r.key || (r.person?.name ?? null) !== name) {
          bad.push(`${r.key}: ${r.label} / ${r.sub} ≠ ${label} / ${region}`);
        }
      }
    }
    check(`${set}: ${got.length.toLocaleString("en-US")} rows, each one's lines, amount${set === "contractors" ? ", contracts, contract amount" : ""} and years recomputed${set === "districts" ? "; the district and its region, no representative named" : ""}`,
      bad.length === 0, bad.slice(0, 5).join("; "));
    check(`${set}: the lines left out (${rest.lines.toLocaleString("en-US")}) recomputed`, B.residual[set].lines === rest.lines && B.residual[set].gaa_php === rest.gaa);
    if (set !== "contractors") {
      check(`${set}: rows and lines left out add up to every line and peso`,
        got.reduce((a, r) => a + r.lines, 0) + rest.lines === lines.length && got.reduce((a, r) => a + r.gaa_php, 0) + rest.gaa === B.totals.gaa_php);
    }
  }

  // People: every district's, equal to leaderboard.json's for the districts an office serves (portraits and credits).
  const L = readJson<LeaderboardData>(resolve(o.out, "leaderboard.json"));
  const lbPeople = new Map<string, LeaderPerson>(L.entries.flatMap((e) => e.people.map((p) => [p.district_id, p] as const)));
  const diffPeople = [...lbPeople].filter(([id, p]) => JSON.stringify(B.people[id]) !== JSON.stringify(p)).map(([id]) => id);
  check(`representatives: all ${D.districts.length} districts, the same people leaderboard.json has for its ${lbPeople.size} (names, portraits, credits, links)`,
    Object.keys(B.people).length === D.districts.length && diffPeople.length === 0, diffPeople.slice(0, 5).join(", "));

  // Links: the map narrowed to the row, and the contractor's or district's page.
  const index = decodeContractorIndex(readJson<ContractorIndexFile>(resolve(o.out, "contractors", "index.json")));
  const districtIds = new Set(D.districts.map((d) => d.id));
  const badLinks = MPB_BOARD_SETS.flatMap((set) => B[set].filter((r: MpbBoardRow) => !r.href.startsWith(`${MPB_MAP_ROOT}?years=2020,2021,2022,2023,2024,2025,2026&`)
    || (set === "contractors" && (!r.page || !index.byKey.has(r.key)))
    || (set === "districts" && (!r.page || !districtIds.has(r.key)))).map((r) => `${set}:${r.key}`));
  check("every row links the map in 2020–2026, and contractors and districts their own page", badLinks.length === 0, badLinks.slice(0, 5).join(", "));

  // Copy of the four boards.
  const boards = BOARDS.filter((b) => b.kind === "mpb");
  const sentences = boards.flatMap((b) => [b.subtitle, ...b.notes]).flatMap((t) => t.split(/(?<=[.!?])\s+/));
  const long = sentences.filter((t) => o.words(t) > 25);
  const hits = boards.flatMap((b) => [b.title, b.subtitle, b.kicker, ...b.notes]).flatMap(o.readerCopyHits);
  check(`the ${boards.length} boards: one per set, sentences of at most 25 words, no banned words, regions on all but contractors`,
    boards.length === 4 && MPB_BOARD_SETS.every((s) => boards.some((b) => b.mpbSet === s)) && long.length === 0 && hits.length === 0
      && boards.every((b) => b.regionFilter === (b.mpbSet !== "contractors")),
    [...long, ...hits].join(" | "));
  const dist = boards.find((b) => b.mpbSet === "districts");
  check("the district board shows no representative for now (three Congresses), its card note says where a title places it and which Congresses",
    Boolean(dist && dist.mpbPeople !== true && /where a title places the building/.test(dist.notes[0]) && /18th, 19th and 20th Congresses/.test(dist.notes[0])
      && dist.notes.some((n) => /do not say who asked/.test(n)) && BOARD_ALIASES["mpb-legislators"] === dist.id));
  check("the disclaimers: the card's one sentence of at most 20 words, the page's on placement, the seat, wrongdoing and spending; no banned words",
    MPB_CARD_DISCLAIMER.split(/(?<=[.!?])\s+/).length === 1 && o.words(MPB_CARD_DISCLAIMER) <= 20
      && /title names/.test(DISCLAIMER_MPB.body) && /does not establish that any representative requested/.test(DISCLAIMER_MPB.body)
      && /18th, 19th and 20th Congresses/.test(DISCLAIMER_MPB.body)
      && /irregularity or wrongdoing/.test(DISCLAIMER_MPB.body) && /not spending/.test(DISCLAIMER_MPB.body)
      && [MPB_CARD_DISCLAIMER, DISCLAIMER_MPB.body].flatMap(o.readerCopyHits).length === 0);
  process.stdout.write(`  ${(readFileSync(path).length / 1e6).toFixed(1)} MB · ${MPB_BOARD_SETS.map((s) => `${s} ${B[s].length.toLocaleString("en-US")}`).join(" · ")}\n`);
  void raw;
}
