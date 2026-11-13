/**
 * verify:hgab — supporting documents and review flags per House bill row (documents/, `npm run build:hgab-documents`),
 * re-read on the verifier's own path: every row once and on the right one of our rows; every file from its source
 * as published (Senate files by URL and SHA-256, Proposal files by record); no file or folder on two rows; reviewed
 * folders where FOLDER_REVIEWS puts them; the research site's missing-document flags and flag counts reproduced; and
 * each row's counts, types and missing flags following from its files.
 */
import type { DuckDBConnection } from "@duckdb/node-api";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPLETE_AT, DOCUMENTS_DIR, DOCUMENTS_SCHEMA, FOLDER_CODE_RE, FOLDER_REVIEWS, LINK_METHODS, NAMED_TYPES, PROPOSAL_TYPE_MAP,
  HOUSE_ONLY_TRACES, OUR_NEP_FLAGS, REVIEW_INDEX_PATH, detailShardPath, flagCode, flagFamily, parseHgabId, senateFileType, type ReviewDetailShard, type ReviewIndex,
} from "../src/lib/hgab-documents";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const q = (s: string) => s.replace(/'/g, "''");
async function rows<T>(c: DuckDBConnection, sql: string): Promise<T[]> {
  return (await c.runAndReadAll(sql)).getRowObjectsJson() as unknown as T[];
}
const first = async (c: DuckDBConnection, sql: string) => Number(Object.values((await rows<Record<string, unknown>>(c, sql))[0])[0]);

interface Manifest {
  schema: number; rows: number;
  sources: Record<string, { file: string; sha256: string }> & { shards: { file: string; sha256: string }[] };
  files: { total: number };
  outputs: Record<string, { md5: string; bytes: number }>;
  review_flags: { occurrences: number };
}

export async function verifyDocuments(c: DuckDBConnection, check: Check, o: Opts): Promise<void> {
  process.stdout.write("\ndocuments/ (supporting documents and review flags per House bill row)\n");
  const dir = resolve(o.out, DOCUMENTS_DIR);
  const P = resolve(dir, "projects.parquet"), F = resolve(dir, "files.parquet"), M = resolve(dir, "manifest.json");
  check("documents/projects.parquet, files.parquet and manifest.json present (npm run build:hgab-documents)", [P, F, M].every(existsSync), dir);
  if (![P, F, M].every(existsSync)) return;
  const man = readJson<Manifest>(M);
  check("manifest schema", man.schema === DOCUMENTS_SCHEMA, String(man.schema));
  const md5 = (p: string) => createHash("md5").update(readFileSync(p)).digest("hex");
  check("the manifest's output MD5s (for ?v= links) are the files'", ["projects.parquet", "files.parquet"].every((f) => man.outputs?.[f]?.md5 === md5(resolve(dir, f))));
  const { shards, ...main } = man.sources;
  const srcFiles = [...Object.values(main), ...shards];
  const badSrc = srcFiles.filter((s) => !existsSync(resolve(dir, s.file)) || sha256(resolve(dir, s.file)) !== s.sha256);
  check(`the ${srcFiles.length} source snapshots are on disk with the SHA-256 the manifest lists`, badSrc.length === 0, badSrc.map((s) => s.file).join(", "));
  if (badSrc.length) return;
  const src = (k: string) => resolve(dir, main[k].file);

  await c.run(`CREATE OR REPLACE TEMP TABLE doc_p AS SELECT * FROM read_parquet('${q(P)}')`);
  await c.run(`CREATE OR REPLACE TEMP TABLE doc_f AS SELECT * FROM read_parquet('${q(F)}')`);
  await c.run(`CREATE OR REPLACE TEMP TABLE doc_ours AS SELECT id, hgab3_php, hgab3_page, trace FROM read_parquet('${q(resolve(o.out, "dpwh/projects.parquet"))}') WHERE hgab3_php IS NOT NULL`);

  // Rows: the research site's rows, once each, on one of our House bill rows.
  const cov = readJson<{ projects: { hgabId: string; amountPesos: number; senateDocuments: { fileLinkId: number; path: string; documentType: string }[]; senateDocumentTypes: string[]; proposalDocumentTypes: string[]; proposalDocumentsMatched: boolean }[] }>(src("coverage"));
  const flags = readJson<{ summary: { existingReviewFlagOccurrences: number; combinedFlagCounts: Record<string, number> }; projects: { hgabId: string; existingReviewFlags: string[]; missingDocumentFlags: string[] }[] }>(src("flags"));
  const pRows = await rows<{ hgab_id: string; project_id: string; join_method: string; page: number; seq: number; amount_php: string; project_amount_php: string }>(c,
    "SELECT hgab_id, project_id, join_method, page, seq, amount_php, project_amount_php FROM doc_p");
  const ids = new Set(pRows.map((r) => r.hgab_id));
  check("one row per research row: 15,979, the same hgabIds as the coverage file and flags.json",
    pRows.length === 15_979 && ids.size === pRows.length && cov.projects.every((r) => ids.has(r.hgabId)) && flags.projects.every((r) => ids.has(r.hgabId)) && man.rows === pRows.length,
    `${pRows.length} rows, ${ids.size} ids`);
  check("every hgabId reads HB10858-3-<page>-<row>, and page and seq are its parts",
    pRows.every((r) => { const x = parseHgabId(r.hgab_id); return x && x.page === r.page && x.seq === r.seq; }));
  const covAmt = new Map(cov.projects.map((r) => [r.hgabId, r.amountPesos]));
  check("every row's amount is the coverage file's", pRows.every((r) => Number(r.amount_php) === covAmt.get(r.hgab_id)));
  const orphan = await first(c, "SELECT count(*) FROM doc_p p LEFT JOIN doc_ours o ON o.id = p.project_id WHERE o.id IS NULL");
  check("every row is on one of our House bill DPWH rows (dpwh/projects.parquet, third reading)", orphan === 0, `${orphan} rows`);
  const offPage = await first(c, `SELECT count(*) FROM doc_p p JOIN doc_ours o ON o.id = p.project_id
    WHERE (p.join_method <> 'merged_duplicate' AND (o.hgab3_page <> p.page OR o.hgab3_php <> p.amount_php OR p.project_amount_php <> p.amount_php))
       OR (p.join_method = 'merged_duplicate' AND (abs(o.hgab3_page - p.page) > 2 OR o.hgab3_php <> p.project_amount_php))`);
  check("exact and title-cleanup rows have our row's page and amount; merged duplicates are within two pages", offPage === 0, `${offPage} rows`);
  const merged = await rows<{ project_id: string; n: number; s: string; ours: string }>(c, `SELECT project_id, count(*)::INT n, sum(amount_php)::VARCHAR s, any_value(o.hgab3_php)::VARCHAR ours
    FROM doc_p p JOIN doc_ours o ON o.id = p.project_id GROUP BY 1 HAVING count(*) > 1`);
  check("only merged duplicates share one of our rows, at least two lines each, adding up to it to the peso",
    merged.every((m) => m.n >= 2 && m.s === m.ours) && pRows.filter((r) => r.join_method === "merged_duplicate").length === merged.reduce((s, m) => s + m.n, 0),
    merged.map((m) => `${m.project_id}: ${m.n} lines ₱${m.s} vs ₱${m.ours}`).join("; "));
  const exact = pRows.filter((r) => r.join_method === "exact").length;
  check("at least 15,960 rows tie on exact page, amount and title", exact >= 15_960, String(exact));

  // Files: from their sources as published, on one row each.
  const index = new Map(readFileSync(src("links"), "utf8").split("\n").filter(Boolean).map((l) => { const x = JSON.parse(l) as { id: number; url: string; sha256: string; path: string; bytes: number }; return [x.id, x]; }));
  const fRows = await rows<{ hgab_id: string; project_id: string; source: string; folder_code: string; file_link_id: number | null; doc_type: string; source_type: string; name: string; url: string; path: string | null; sha256: string | null; bytes: string | null; link_method: string }>(c,
    "SELECT hgab_id, project_id, source, folder_code, file_link_id, doc_type, source_type, name, url, path, sha256, bytes::VARCHAR bytes, link_method FROM doc_f");
  check("files.parquet holds the manifest's file count", fRows.length === man.files.total, `${fRows.length} vs ${man.files.total}`);
  const pById = new Map(pRows.map((r) => [r.hgab_id, r]));
  check("every file is on a row, with that row's project_id, and a known link method",
    fRows.every((f) => pById.get(f.hgab_id)?.project_id === f.project_id && (LINK_METHODS as readonly string[]).includes(f.link_method)));
  const senate = fRows.filter((f) => f.source === "senate"), proposal = fRows.filter((f) => f.source === "proposal");
  const badSenate = senate.filter((f) => { const x = index.get(f.file_link_id ?? -1); return !x || x.url !== f.url || x.sha256 !== f.sha256 || x.path !== f.path || String(x.bytes) !== f.bytes || FOLDER_CODE_RE.exec(x.path)?.[1] !== f.folder_code; });
  check("every Senate file is in the file index with its URL, path, size, SHA-256 and folder code", badSenate.length === 0, badSenate.slice(0, 3).map((f) => f.file_link_id).join(", "));
  const fileIds = senate.map((f) => f.file_link_id);
  check("no Senate file is on two rows", new Set(fileIds).size === fileIds.length);
  const folderRows = new Map<string, Set<string>>();
  for (const f of senate) folderRows.set(f.folder_code, (folderRows.get(f.folder_code) ?? new Set()).add(f.hgab_id));
  const split = [...folderRows].filter(([, s]) => s.size > 1);
  check("no Senate folder is on two rows", split.length === 0, split.slice(0, 3).map(([k]) => k).join(", "));
  const typeOff = senate.filter((f) => f.link_method !== "research" && f.link_method !== "reviewed" && f.source_type !== senateFileType(f.name));
  check("files on folders we tied carry the file-type rule's type", typeOff.length === 0, typeOff.slice(0, 3).map((f) => f.name).join(", "));
  check("doc_type is a named type or Other; Proposal doc_type follows the portal type",
    fRows.every((f) => f.doc_type === "Other" || (NAMED_TYPES as readonly string[]).includes(f.doc_type))
      && proposal.every((f) => f.doc_type === (PROPOSAL_TYPE_MAP[f.source_type] ?? "Other")));

  // The research site's folder links stand except where FOLDER_REVIEWS moved them.
  const researchFolder = new Map<string, string>();
  for (const r of cov.projects) for (const d of r.senateDocuments) researchFolder.set(FOLDER_CODE_RE.exec(d.path)![1], r.hgabId);
  const fileRow = new Map(senate.map((f) => [f.file_link_id, f]));
  const lost = cov.projects.flatMap((r) => r.senateDocuments.filter((d) => {
    const f = fileRow.get(d.fileLinkId);
    const code = FOLDER_CODE_RE.exec(d.path)![1];
    const want = FOLDER_REVIEWS[code]?.hgabId ?? r.hgabId;
    return !f || f.hgab_id !== want || f.source_type !== d.documentType;
  }));
  check(`all ${researchFolder.size.toLocaleString("en-US")} research folders' files are on their row (or the reviewed one), with the research type`, lost.length === 0, `${lost.length} files`);
  const reviewed = Object.entries(FOLDER_REVIEWS).filter(([code, r]) => !senate.some((f) => f.folder_code === code && f.hgab_id === r.hgabId && f.link_method === "reviewed"));
  check(`the ${Object.keys(FOLDER_REVIEWS).length} reviewed folders are on the row their POW names`, reviewed.length === 0, reviewed.map(([k]) => k).join(", "));
  const nonResearchOnResearchRow = senate.filter((f) => (f.link_method === "pow_title" || f.link_method === "tracker") && cov.projects.find((r) => r.hgabId === f.hgab_id)!.senateDocuments.length > 0);
  check("POW-title and tracker folders only go to rows the research site gave no Senate files", nonResearchOnResearchRow.length === 0, nonResearchOnResearchRow.slice(0, 3).map((f) => f.folder_code).join(", "));

  // Proposal files: one record per row, from the shards, with the research site's types.
  const inDepth = readJson<{ arrayShards: Record<string, { path: string }[]> }>(src("inDepth"));
  const recs = new Map(inDepth.arrayShards.projects.flatMap((s) => readJson<{ code: string; documentLinks: { type: string; url: string }[] }[]>(resolve(dir, "sources/shards", s.path.split("/").pop()!))).map((r) => [r.code, r]));
  const propByRow = new Map<string, typeof proposal>();
  for (const f of proposal) propByRow.set(f.hgab_id, [...(propByRow.get(f.hgab_id) ?? []), f]);
  const covById = new Map(cov.projects.map((r) => [r.hgabId, r]));
  const sameSet = (a: string[], b: string[]) => [...new Set(a)].sort().join("|") === [...new Set(b)].sort().join("|");
  const badProp = [...propByRow].filter(([h, fs]) => {
    const codes = new Set(fs.map((f) => f.folder_code));
    const rec = recs.get(fs[0].folder_code);
    const r = covById.get(h)!;
    return codes.size !== 1 || !rec || rec.documentLinks.length !== fs.length || !rec.documentLinks.every((d) => fs.some((f) => f.url === d.url && f.source_type === d.type))
      || !r.proposalDocumentsMatched || !sameSet(rec.documentLinks.map((d) => d.type), r.proposalDocumentTypes);
  });
  check(`Proposal files: one record per row (${propByRow.size.toLocaleString("en-US")} rows), all its links, and exactly the types the research site lists`, badProp.length === 0, badProp.slice(0, 3).map(([h]) => h).join(", "));
  check("at least 9,380 of the 9,577 rows with Proposal documents have their files", propByRow.size >= 9_380, String(propByRow.size));

  // Per-row fields follow from the files; the research site's own flags are reproduced.
  const pFull = await rows<{ hgab_id: string; senate_files: number; proposal_files: number; proposal_code: string | null; senate_folders: string[]; named_present: string[]; named_present_upstream: string[]; complete: boolean; complete_upstream: boolean; missing_flags: string[]; missing_flags_upstream: string[]; review_flags: { code: string; label: string; value: number | null; evidence: string[] }[] }>(c,
    "SELECT hgab_id, senate_files, proposal_files, proposal_code, senate_folders, named_present, named_present_upstream, complete, complete_upstream, missing_flags, missing_flags_upstream, review_flags FROM doc_p");
  const sByRow = new Map<string, typeof senate>();
  for (const f of senate) sByRow.set(f.hgab_id, [...(sByRow.get(f.hgab_id) ?? []), f]);
  const countsOff = pFull.filter((p) => p.senate_files !== (sByRow.get(p.hgab_id)?.length ?? 0) || p.proposal_files !== (propByRow.get(p.hgab_id)?.length ?? 0)
    || (p.proposal_code ?? null) !== (propByRow.get(p.hgab_id)?.[0].folder_code ?? null)
    || [...p.senate_folders].sort().join() !== [...new Set((sByRow.get(p.hgab_id) ?? []).map((f) => f.folder_code))].sort().join());
  check("each row's file counts, Proposal code and Senate folders are its files'", countsOff.length === 0, countsOff.slice(0, 3).map((p) => p.hgab_id).join(", "));
  const missingOf = (present: string[]) => NAMED_TYPES.filter((t) => !present.includes(t)).map((t) => `Missing ${t}`);
  const shapeOff = pFull.filter((p) => p.complete !== p.named_present.length >= COMPLETE_AT || p.complete_upstream !== p.named_present_upstream.length >= COMPLETE_AT
    || missingOf(p.named_present).join() !== p.missing_flags.join() || missingOf(p.named_present_upstream).join() !== p.missing_flags_upstream.join()
    || !(sByRow.get(p.hgab_id) ?? []).every((f) => f.doc_type === "Other" || p.named_present.includes(f.doc_type)));
  check("complete means at least 4 of 5 named types; missing flags are the named types absent; every Senate file's type is counted", shapeOff.length === 0, shapeOff.slice(0, 3).map((p) => p.hgab_id).join(", "));
  const flagById = new Map(flags.projects.map((f) => [f.hgabId, f]));
  const upOff = pFull.filter((p) => {
    const r = covById.get(p.hgab_id)!;
    const up = NAMED_TYPES.filter((t) => r.proposalDocumentTypes.some((x) => PROPOSAL_TYPE_MAP[x] === t) || r.senateDocumentTypes.includes(t));
    return up.join() !== p.named_present_upstream.join() || p.missing_flags_upstream.join() !== flagById.get(p.hgab_id)!.missingDocumentFlags.join();
  });
  check("upstream named types recomputed from the coverage file, and their missing flags equal flags.json, on every row", upOff.length === 0, upOff.slice(0, 3).map((p) => p.hgab_id).join(", "));
  const occ = pFull.reduce((s, p) => s + p.review_flags.length, 0);
  check("review flags: the occurrences flags.json reports, in its order per row", occ === flags.summary.existingReviewFlagOccurrences && occ === man.review_flags.occurrences
    && pFull.every((p) => p.review_flags.map((f) => f.label).join("|") === flagById.get(p.hgab_id)!.existingReviewFlags.join("|")), `${occ}`);
  const combined = new Map<string, number>();
  for (const p of pFull) for (const l of [...p.review_flags.map((f) => f.label), ...p.missing_flags_upstream]) combined.set(l, (combined.get(l) ?? 0) + 1);
  const combOff = Object.entries(flags.summary.combinedFlagCounts).filter(([k, v]) => combined.get(k) !== v);
  check(`all ${Object.keys(flags.summary.combinedFlagCounts).length} flag counts in flags.json's summary reproduced`, combOff.length === 0 && combined.size === Object.keys(flags.summary.combinedFlagCounts).length,
    combOff.slice(0, 3).map(([k]) => k).join("; "));
  const amountFlags = pFull.flatMap((p) => p.review_flags).filter((f) => /^allocation-(increase|decrease)$/.test(f.code));
  check("allocation increase/decrease flags carry their amount as value, matching the label",
    amountFlags.length > 0 && amountFlags.every((f) => f.value != null && f.label.includes(Number(f.value).toLocaleString("en-US"))), String(amountFlags.length));
  check("evidence is deduplicated per flag", pFull.every((p) => p.review_flags.every((f) => new Set(f.evidence).size === f.evidence.length)));
  const movedFrom = new Set(Object.entries(FOLDER_REVIEWS).map(([code]) => researchFolder.get(code)!).filter((h, i, a) => h && a.indexOf(h) === i));
  const dropped = pFull.filter((p) => p.complete_upstream && !p.complete && !movedFrom.has(p.hgab_id));
  // The reviewer's files say the same as the Parquet.
  const ixPath = resolve(o.out, REVIEW_INDEX_PATH);
  check("documents/review.json present", existsSync(ixPath));
  if (existsSync(ixPath)) {
    const ix = readJson<ReviewIndex>(ixPath);
    const pBy = new Map(pFull.map((p) => [p.hgab_id, p]));
    const meta = new Map((await rows<{ hgab_id: string; title: string; office: string; region: string; amount_php: string; project_id: string; trace: string }>(c,
      "SELECT p.hgab_id, p.title, p.office, p.region, p.amount_php::VARCHAR amount_php, p.project_id, o.trace FROM doc_p p JOIN doc_ours o ON o.id = p.project_id")).map((r) => [r.hgab_id, r]));
    // Our NEP comparison, on this path: House-only by our row's trace; disagreeing with the research site's insertion flag.
    const ourNep = (h: string, codes: string[]) => {
      const ours = HOUSE_ONLY_TRACES.includes(meta.get(h)?.trace ?? ''), theirs = codes.includes('potential-nep-insertion');
      return [...(ours ? [OUR_NEP_FLAGS.houseOnly.code] : []), ...(ours !== theirs ? [OUR_NEP_FLAGS.disagree.code] : [])];
    };
    check("review.json: every row once, in bill order", ix.rows.length === pFull.length && new Set(ix.rows.map((r) => r[0])).size === ix.rows.length
      && ix.rows.every((r, i) => i === 0 || parseHgabId(r[0])!.seq > parseHgabId(ix.rows[i - 1][0])!.seq));
    const rowOff = ix.rows.filter(([h, pid, title, oi, ri, , amt, fi, mask, nf]) => {
      const m = meta.get(h), p = pBy.get(h);
      if (!m || !p) return true;
      const research = p.review_flags.map((f) => f.code);
      const codes = [...research, ...ourNep(h, research), ...p.missing_flags.map((l) => flagCode(l).code)];
      return m.project_id !== pid || m.title !== title || ix.offices[oi]?.name !== m.office || ix.regions[ri] !== m.region || String(amt) !== m.amount_php
        || [...new Set(codes)].sort().join() !== fi.map((i) => ix.flags[i].code).sort().join()
        || NAMED_TYPES.filter((_, i) => mask & (1 << i)).join() !== p.named_present.join() || nf !== p.senate_files + p.proposal_files;
    });
    check("review.json: each row's ids, title, office, region, amount, flags, documents and file count are the Parquet's", rowOff.length === 0, rowOff.slice(0, 3).map((r) => r[0]).join(", "));
    const nOff = ix.flags.filter((f, i) => f.n !== ix.rows.filter((r) => r[7].includes(i)).length || flagFamily(f.code) !== f.family);
    check(`review.json: all ${ix.flags.length} flags' counts and families hold`, nOff.length === 0, nOff.map((f) => f.code).join(", "));
    const nOf = (code: string) => ix.flags.find((f) => f.code === code)?.n ?? -1;
    const theirs = nOf('potential-nep-insertion'), ours = nOf(OUR_NEP_FLAGS.houseOnly.code), dis = nOf(OUR_NEP_FLAGS.disagree.code);
    const both = ix.rows.filter((r) => { const cs = r[7].map((i) => ix.flags[i].code); return cs.includes('potential-nep-insertion') && cs.includes(OUR_NEP_FLAGS.houseOnly.code); }).length;
    check(`our NEP comparison beside the research site's: ${ours.toLocaleString('en-US')} House-only lines, ${theirs.toLocaleString('en-US')} research insertion flags, ${dis.toLocaleString('en-US')} where they disagree (= ours + theirs − 2 × both)`,
      ours > 6_000 && dis === ours + theirs - 2 * both && ix.flags.filter((f) => f.source === 'bettergov').every((f) => f.code.startsWith('missing-') || f.note), `both ${both}`);
    const deo = ix.offices.filter((x) => /Engineering Office/i.test(x.name) && (!x.districts.length || x.tier !== (x.districts.length === 1 ? "A" : "B")));
    check("review.json: every DPWH engineering office names the legislative districts it serves, lone or shared", deo.length === 0, deo.map((x) => x.name).join(", "));
    // Detail shards: every row in its shard, with exactly its files and flags.
    const shardCache = new Map<string, ReviewDetailShard | null>();
    const shard = (p: string) => { if (!shardCache.has(p)) { const f = resolve(o.out, p); shardCache.set(p, existsSync(f) ? readJson<ReviewDetailShard>(f) : null); } return shardCache.get(p); };
    const urlsBy = new Map<string, string[]>();
    for (const f of fRows) urlsBy.set(f.hgab_id, [...(urlsBy.get(f.hgab_id) ?? []), f.url]);
    const norm = (f: { code: string; label: string; value: number | string | null; evidence: string[] }) => [f.code, f.label, f.value == null ? null : Number(f.value), f.evidence];
    const detOff = pFull.filter((p) => {
      const d = shard(detailShardPath(parseHgabId(p.hgab_id)!.seq))?.[p.hgab_id];
      return !d || d.files.map((f) => f[5]).sort().join() !== (urlsBy.get(p.hgab_id) ?? []).sort().join()
        || JSON.stringify(d.flags.map(norm)) !== JSON.stringify(p.review_flags.map(norm)) || d.missing_upstream.join() !== p.missing_flags_upstream.join();
    });
    check(`detail shards (${shardCache.size}): every row in its shard with exactly its files, flags and evidence`, detOff.length === 0, detOff.slice(0, 3).map((p) => p.hgab_id).join(", "));
    const extra = [...shardCache.values()].reduce((s, x) => s + Object.keys(x ?? {}).length, 0);
    check("detail shards hold no other rows", extra === pFull.length, String(extra));
  }

  check("more rows are complete with our links than upstream, and none fewer except where a reviewed folder moved away",
    pFull.filter((p) => p.complete).length > pFull.filter((p) => p.complete_upstream).length && dropped.length === 0, dropped.slice(0, 3).map((p) => p.hgab_id).join(", "));
}
