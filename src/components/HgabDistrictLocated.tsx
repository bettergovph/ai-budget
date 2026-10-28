/**
 * "Projects placed in this district" on `/hgab/2027/districts/:id`: the DPWH
 * lines the source workbench's location lens places in this legislative
 * district (`data/hgab/2027/locations.json`, contract in
 * `lib/hgab-locations.ts`), and where the rest of the district's office lines are.
 *
 * Rules this section keeps (docs/hgab-copy.md, lib/hgab-disclaimers.ts):
 * - A placed line is where the documents put the work: by the place its title
 *   names, or by an office that serves this district alone. Provisional, not a
 *   verified site, and never the representative's project. Nothing here names a person.
 * - The reconciliation for the district's office group is always shown: of the
 *   office's lines, how many are placed here, in its other districts,
 *   elsewhere, kept with the shared office, or at region only. Placed never
 *   reads as the whole story, and a shared office total stays undivided: the
 *   list is per line, never a share of a total.
 * - Lines located here but listed under another DPWH office (another DEO, the
 *   Central Office, a regional office) are a separate sub-list, office named.
 * - NEP and House bill amounts are compared, never added.
 *
 * Loaded only here: the locations file on mount, then the located lines' titles
 * and amounts from the DPWH parquet in the browser (DuckDB-Wasm).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionHead } from './shared';
import { HgabDetails } from './HgabBits';
import { downloadCsv } from '../lib/csv';
import { runQuery } from '../lib/duckdb';
import * as fmt from '../lib/format';
import {
  BRIDGE_LABELS, loadHgabLocations, projectsParquetUrl, recordPath, traceInfo,
  type DistrictCard, type HgabDistrictIndex, type OfficeHistory, type ProjectRow,
} from '../lib/hgab';
import { CHANGES_LIST_SITE, districtsServedText, shortOffice } from '../lib/hgab-changes-list';
import { cardOffices, dpwhOfficeName, officeParquetLabel, officeProjectsHref } from '../lib/hgab-districts';
import {
  LOCATION_BASIS_LABELS, LOCATION_FLAG_LABELS, TITLE_GATE_LABELS,
  type DistrictLocated, type LineLocation, type LocatedCell, type LocationBasis, type LocationsData, type OfficeLocatedSummary,
} from '../lib/hgab-locations';
import { letterSlug } from '../lib/hgab-letter';
import { LIST_COLUMNS, coerceRow, parquetSource, sqlStr, tableCsv } from '../lib/hgab-query';
import '../hgab-located.css';

/** Lines shown before "Show all". */
const FIRST_OWN = 20;
const FIRST_OTHER = 10;

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

type Kind = keyof DistrictLocated['kinds'];
const KIND_ORDER: readonly Kind[] = ['inserted', 'increased', 'decreased', 'scope_review', 'unchanged', 'dropped'];

const KINDS: Record<Kind, { tag: string; label: string; sub: string; help: string }> = {
  inserted: { tag: 'Inserted', label: 'Insertion candidates', sub: 'in the House bill only', help: BRIDGE_LABELS.house_only.help },
  increased: { tag: 'Increased', label: 'Increases', sub: 'higher in the House bill', help: BRIDGE_LABELS.increased.help },
  decreased: { tag: 'Decreased', label: 'Decreases', sub: 'lower in the House bill', help: BRIDGE_LABELS.decreased.help },
  scope_review: { tag: 'Scope review', label: 'Scope review', sub: 'same road, different stretch', help: BRIDGE_LABELS.scope_review.help },
  unchanged: { tag: 'Unchanged', label: 'Unchanged', sub: 'same amount in both', help: BRIDGE_LABELS.unchanged.help },
  dropped: { tag: 'Dropped', label: 'Deletion candidates', sub: 'in the NEP only', help: BRIDGE_LABELS.nep_only.help },
};

/** A line's kind from its workbench trace (TRACE_LABELS); `held` = its NEP match is unconfirmed. */
function kindOf(trace: string | null | undefined): { kind: Kind | null; held: boolean } {
  const t = traceInfo(trace);
  const kind: Kind | null = t.group === 'house_only' ? 'inserted' : t.group === 'nep_only' ? 'dropped' : t.group;
  return { kind, held: t.held };
}

function KindTag({ kind, held = false }: { kind: Kind | null; held?: boolean }) {
  if (!kind) return <span className="hgab-dl-tag">—</span>;
  const k = KINDS[kind];
  return (
    <span className="hgab-dl-tagwrap">
      <span className={`hgab-dl-tag is-${kind}`} title={`${k.label}, ${k.sub}. ${k.help}`}>{k.tag}</span>
      {held && <span className="hgab-dl-held" title="A similar NEP line exists but could not be confirmed as the same project.">unconfirmed match</span>}
    </span>
  );
}

/** Upstream lens source: the method, at the commit the lens was built from. */
const LENS_REPO = 'https://github.com/csiiiv/DPWH-NEP-HB-2027-ANALYSIS';

function BasisBadge({ loc }: { loc: LineLocation }) {
  const b = LOCATION_BASIS_LABELS[loc.basis];
  const why = [
    b.plain,
    loc.gate ? `Backed because ${TITLE_GATE_LABELS[loc.gate]}.` : '',
    ...loc.flags.map((f) => LOCATION_FLAG_LABELS[f]),
  ].filter(Boolean).join(' ');
  return (
    <span className={`hgab-dl-how is-${loc.basis}${loc.flags.length ? ' is-flagged' : ''}`} title={why}>
      {b.label}{loc.flags.length > 0 && <span aria-hidden="true"> ·&nbsp;!</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The district's office group (as the leaderboard keys it)
// ---------------------------------------------------------------------------

interface OfficeGroup {
  /** Leaderboard group key: the district id for a one-district group, else "shared:" + sorted office ids joined by "+". */
  key: string;
  offices: OfficeHistory[];
  districtIds: string[];
}

/** The connected group of DPWH engineering offices and the districts they serve, reached from this district. */
function officeGroup(card: DistrictCard, index: HgabDistrictIndex): OfficeGroup | null {
  const offices = new Map<string, OfficeHistory>();
  const districts = new Set<string>([card.id]);
  const queue = [card.id];
  while (queue.length) {
    const id = queue.pop();
    const d = index.districts.find((x) => x.id === id);
    if (!d) continue;
    for (const o of cardOffices(d, index)) {
      if (offices.has(o.id)) continue;
      offices.set(o.id, o);
      for (const did of o.district_ids) if (!districts.has(did)) { districts.add(did); queue.push(did); }
    }
  }
  if (!offices.size) return null;
  const ids = [...offices.keys()].sort();
  return {
    key: districts.size === 1 ? card.id : `shared:${ids.join('+')}`,
    offices: ids.map((id) => offices.get(id)!),
    districtIds: [...districts],
  };
}

function groupSummary(data: LocationsData, group: OfficeGroup | null, cardId: string): OfficeLocatedSummary | null {
  if (!group) return null;
  return data.offices.find((o) => o.group === group.key) ?? data.offices.find((o) => cardId in o.per_district) ?? null;
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

const lines = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'line' : 'lines'}`;

/** "₱1.40B", exact pesos on hover; "—" for no figure. */
function Php({ v, strong = false }: { v: number | null | undefined; strong?: boolean }) {
  if (v == null) return <span className="hgab-ds-null" title="No figure in this document">—</span>;
  const s = <span title={fmt.php(v, { unit: 'full' })}>{fmt.php(v)}</span>;
  return strong ? <strong>{s}</strong> : s;
}

/** "NEP ₱1.21B · House bill ₱1.40B" for a cell of lines. */
function CellAmounts({ c }: { c: LocatedCell }) {
  if (!c.rows) return null;
  return (
    <small className="hgab-dl-cellamt">
      NEP <Php v={c.nep_php} /> · House bill <Php v={c.house_php} />
    </small>
  );
}

/** Office label as the parquet lists it → "DPWH Metro Manila 3rd DEO", "DPWH Central Office". */
function officeDisplay(label: string | null | undefined): string {
  return label ? dpwhOfficeName(shortOffice(label)) : 'No office listed';
}

// ---------------------------------------------------------------------------
// The located lines' details, from the DPWH parquet
// ---------------------------------------------------------------------------

function useLineRows(ids: readonly string[]): { rows: Map<string, ProjectRow> | null; error: string | null } {
  const key = ids.join('|');
  const [state, setState] = useState<{ key: string; rows: Map<string, ProjectRow> | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const url = projectsParquetUrl('dpwh');
    const list = key.split('|');
    const sql = `SELECT ${LIST_COLUMNS.join(', ')} FROM ${parquetSource(url)} WHERE id IN (${list.map(sqlStr).join(', ')})`;
    runQuery(sql)
      .then((res) => {
        if (!live) return;
        const rows = new Map<string, ProjectRow>();
        for (const r of res.rows) { const row = coerceRow(r as Record<string, unknown>); rows.set(row.id, row); }
        setState({ key, rows, error: null });
      })
      .catch((e) => { if (live) setState({ key, rows: null, error: String((e as Error)?.message || e) }); });
    return () => { live = false; };
  }, [key]);
  if (!key) return { rows: new Map(), error: null };
  return state?.key === key ? { rows: state.rows, error: state.error } : { rows: null, error: null };
}

interface LocatedLine {
  id: string;
  loc: LineLocation | null;
  row: ProjectRow | null;
  kind: Kind | null;
  held: boolean;
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export default function DistrictLocated({ card, index }: { card: DistrictCard; index: HgabDistrictIndex }) {
  const [data, setData] = useState<LocationsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadHgabLocations()
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);

  return (
    <section className="nep-section hgab-dl" id="located" aria-labelledby="hgab-dl-title">
      <SectionHead
        eyebrow="2027 · Where the documents put each project"
        headline={<span id="hgab-dl-title">Projects placed in {card.label}</span>}
        dek={
          <>
            Placed by the place each title names, or by a DPWH office that serves only this district. Provisional: the
            documents do not certify sites, and do not say who asked for any project.
          </>
        }
      />
      {err ? (
        <div className="hgab-ds-parquet-err" role="alert">
          <p>Project locations could not be loaded. The office figures below are unaffected.</p>
          <HgabDetails><pre>{err}</pre></HgabDetails>
        </div>
      ) : !data ? (
        <p className="hgab-dd-projects-busy" role="status">
          <span className="busy-sweep" aria-hidden="true" />
          Loading project locations…
        </p>
      ) : (
        <LocatedBody key={card.id} card={card} index={index} data={data} />
      )}
    </section>
  );
}

function LocatedBody({ card, index, data }: { card: DistrictCard; index: HgabDistrictIndex; data: LocationsData }) {
  const lineById = useMemo(() => new Map(data.lines.map((l) => [l.id, l])), [data]);
  const dl = useMemo(() => data.districts.find((d) => d.district === card.id) ?? null, [data, card.id]);
  const group = useMemo(() => officeGroup(card, index), [card, index]);
  const summary = useMemo(() => groupSummary(data, group, card.id), [data, group, card.id]);
  const groupLabels = useMemo(() => new Set((group?.offices ?? []).map(officeParquetLabel)), [group]);
  const ids = useMemo(() => dl?.ids ?? [], [dl]);
  const { rows, error } = useLineRows(ids);

  const located: LocatedLine[] = useMemo(
    () => ids.map((id) => {
      const row = rows?.get(id) ?? null;
      return { id, loc: lineById.get(id) ?? null, row, ...kindOf(row?.trace) };
    }),
    [ids, rows, lineById],
  );
  const own = located.filter((l) => l.row?.office && groupLabels.has(l.row.office));
  const other = located.filter((l) => !(l.row?.office && groupLabels.has(l.row.office)));
  const multiOffice = (group?.offices.length ?? 0) > 1;

  const csvName = `bettergov-house-bill-2027-placed-${letterSlug(card.id)}.csv`;
  const exportCsv = () => {
    const csv = tableCsv<LocatedLine>([
      { key: 'kind', pick: (l) => l.kind ?? '' },
      { key: 'title', pick: (l) => l.row?.title ?? '' },
      { key: 'nep_php', pick: (l) => l.row?.nep_php ?? null },
      { key: 'house_php', pick: (l) => l.row?.hgab3_php ?? null },
      { key: 'change_php', pick: (l) => (l.row?.nep_php != null && l.row.hgab3_php != null ? l.row.hgab3_php - l.row.nep_php : null) },
      { key: 'place', pick: (l) => l.loc?.place ?? '' },
      { key: 'placed_by', pick: (l) => (l.loc ? LOCATION_BASIS_LABELS[l.loc.basis].label : '') },
      { key: 'lens_basis', pick: (l) => l.loc?.basis ?? '' },
      { key: 'lens_flags', pick: (l) => (l.loc?.flags ?? []).join(' ') },
      { key: 'dpwh_office', pick: (l) => (l.row ? officeDisplay(l.row.office) : '') },
      { key: 'record_url', pick: (l) => `${CHANGES_LIST_SITE}${recordPath('dpwh', l.id)}` },
    ], located);
    downloadCsv(csvName, csv, { excelBom: true });
  };

  const ownCell = dl?.by_office.own;
  const otherRows = dl ? dl.by_office.other_deo.rows + dl.by_office.central.rows + dl.by_office.regional.rows : 0;

  return (
    <>
      {/* ---- summary by kind ---- */}
      {dl && dl.all.rows > 0 ? (
        <div className="hgab-dl-kinds">
          <div className="hgab-dl-kinds-head">
            <p className="hgab-dd-sub">
              {lines(dl.all.rows)} placed here, by what the House bill did
            </p>
            <button
              type="button"
              className="hgab-dl-csv"
              disabled={!rows || located.length === 0}
              onClick={exportCsv}
              title="Every line placed here, exact pesos, with the place and how it was placed"
            >
              {rows ? `Download CSV (${located.length.toLocaleString()})` : 'Preparing CSV…'}
            </button>
          </div>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-dl-kinds-table">
              <thead>
                <tr>
                  <th>What changed</th>
                  <th className="num">Lines</th>
                  <th className="num">NEP</th>
                  <th className="num">House bill</th>
                </tr>
              </thead>
              <tbody>
                {KIND_ORDER.map((k) => {
                  const c = dl.kinds[k];
                  return (
                    <tr key={k} className={c.rows ? undefined : 'is-zero'}>
                      <td>
                        <KindTag kind={k} /> <span className="hgab-dl-kind-sub">{KINDS[k].label.toLowerCase()}, {KINDS[k].sub}</span>
                      </td>
                      <td className="num">{c.rows.toLocaleString()}</td>
                      <td className="num">{c.rows && k !== 'inserted' ? <Php v={c.nep_php} /> : <span className="hgab-ds-null">—</span>}</td>
                      <td className="num">{c.rows && k !== 'dropped' ? <Php v={c.house_php} /> : <span className="hgab-ds-null">—</span>}</td>
                    </tr>
                  );
                })}
                <tr className="is-total">
                  <td>All placed here</td>
                  <td className="num">{dl.all.rows.toLocaleString()}</td>
                  <td className="num"><Php v={dl.all.nep_php} /></td>
                  <td className="num"><Php v={dl.all.house_php} /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="nep-hier-note">
            {lines(dl.by_basis.title_psgc.rows)} by the place the title names
            {dl.by_basis.deo_to_leg.rows > 0 && <>; {lines(dl.by_basis.deo_to_leg.rows)} because the DPWH office serves only this district</>}.{' '}
            {ownCell && (
              <>
                {lines(ownCell.rows)} listed under {multiOffice ? 'this district’s DPWH offices' : 'this district’s DPWH office'}
                {otherRows > 0 && <>; {lines(otherRows)} under other DPWH offices, listed separately below</>}.{' '}
              </>
            )}
            {dl.unconfirmed.rows > 0 && (
              <>
                Insertion candidates include {lines(dl.unconfirmed.rows)} (<Php v={dl.unconfirmed.php} />) whose NEP match is
                unconfirmed.{' '}
              </>
            )}
            The NEP and the House bill are compared, never added.
          </p>
        </div>
      ) : (
        <p className="nep-empty">No 2027 DPWH line is placed in this district: no title fixes a place here, and no office serves it alone.</p>
      )}

      {/* ---- reconciliation for the office group ---- */}
      <Reconciliation card={card} index={index} group={group} summary={summary} />

      {/* ---- the lines ---- */}
      {dl && dl.all.rows > 0 && (
        error ? (
          <div className="hgab-ds-parquet-err" role="alert">
            <p>Could not load the placed lines’ titles and amounts. The counts above are unaffected.</p>
            <HgabDetails>
              <p>Reading <code>hgab/2027/dpwh/projects.parquet</code> in the browser failed:</p>
              <pre>{error}</pre>
            </HgabDetails>
          </div>
        ) : !rows ? (
          <p className="hgab-dd-projects-busy" role="status">
            <span className="busy-sweep" aria-hidden="true" />
            Loading the placed lines… the first load fetches the project file
          </p>
        ) : (
          <>
            {own.length > 0 && (
              <div className="hgab-dl-list">
                <p className="hgab-dd-sub">
                  Placed here: {lines(own.length)} under{' '}
                  {group ? group.offices.map((o) => dpwhOfficeName(o.name)).join(' and ') : 'this district’s DPWH office'}
                </p>
                <LinesTable items={own} first={FIRST_OWN} showOffice={multiOffice} index={index} />
              </div>
            )}
            {other.length > 0 && (
              <div className="hgab-dl-list is-other">
                <p className="hgab-dd-sub">Also placed here: {lines(other.length)} under other DPWH offices</p>
                <p className="hgab-dl-other-note">
                  These titles name a place in {card.label}, but the documents list them under another DPWH office.
                  They are in that office’s figures, not in this district’s office totals.
                </p>
                <LinesTable items={other} first={FIRST_OTHER} showOffice index={index} />
              </div>
            )}
            <BasisKey items={located} />
          </>
        )
      )}

      <HgabDetails title="Details for analysts: how lines were placed">
        <ul>
          <li>
            Placements are the source workbench’s “{data.lens.name}”, built from commit{' '}
            <a href={`${LENS_REPO}/tree/${data.lens_commit}`} target="_blank" rel="noopener noreferrer"><code>{data.lens_commit.slice(0, 7)}</code></a>{' '}
            with its own scripts (method:{' '}
            <a href={`${LENS_REPO}/blob/${data.lens_commit}/${data.lens.authority}`} target="_blank" rel="noopener noreferrer">{data.lens.authority}</a>).
            Amounts and matches: commit <code>{data.source_commit.slice(0, 7)}</code>, checked line for line against the lens.
          </li>
          <li>
            Every line is placed once, in this order: the place its title names, backed by its office, a coordinate, the
            title’s wording or a reviewed landmark; else an office that serves one district only; else its shared office,
            undivided; else its region.
          </li>
          <li>Upstream: “{data.lens.not_claimed}”</li>
          {data.build_notes.map((n) => <li key={n}>{n}</li>)}
          <li>
            Group key <code>{summary?.group ?? group?.key ?? 'none'}</code>; district id <code>{card.id}</code>. Built{' '}
            {new Date(data.built_at).toLocaleString('en-PH')}.
          </li>
          {data.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </HgabDetails>
    </>
  );
}

// ---------------------------------------------------------------------------
// Reconciliation: where the office group's lines are
// ---------------------------------------------------------------------------

function Reconciliation({ card, index, group, summary }: {
  card: DistrictCard;
  index: HgabDistrictIndex;
  group: OfficeGroup | null;
  summary: OfficeLocatedSummary | null;
}) {
  if (!group || !summary) {
    return (
      <p className="hgab-dl-recon-none">
        {group
          ? 'No location summary was published for this district’s DPWH office.'
          : 'No DPWH district engineering office (DEO) serves this district in the office-to-district map, so there is no office total to set these lines against.'}
      </p>
    );
  }
  const here = summary.per_district[card.id] ?? { rows: 0, nep_php: 0, house_php: 0 };
  const othersIds = group.districtIds.filter((id) => id !== card.id);
  const others: LocatedCell = { rows: 0, nep_php: 0, house_php: 0 };
  for (const [id, c] of Object.entries(summary.per_district)) {
    if (id === card.id) continue;
    others.rows += c.rows; others.nep_php += c.nep_php; others.house_php += c.house_php;
  }
  const cells: Array<{ key: string; label: string; sub: string; c: LocatedCell }> = [
    { key: 'here', label: 'Placed in this district', sub: 'listed above', c: here },
    ...(othersIds.length
      ? [{ key: 'others', label: othersIds.length === 1 ? 'Placed in its other district' : 'Placed in its other districts', sub: districtsServedText(othersIds.map((id) => index.districts.find((d) => d.id === id)).filter((d): d is DistrictCard => Boolean(d))), c: others }]
      : []),
    { key: 'elsewhere', label: 'Placed elsewhere', sub: 'the title names a place this office does not serve', c: summary.elsewhere },
    ...(othersIds.length
      ? [{ key: 'shared', label: 'Kept with the shared office', sub: 'no title fixes a district; not split', c: summary.shared }]
      : []),
    { key: 'unplaced', label: 'Region only', sub: 'the documents disagree on the office, or list none', c: summary.unplaced },
    { key: 'held_out', label: 'Held out for review', sub: 'the place named is outside this office’s districts', c: summary.held_out },
  ];
  // Always shown: this district, its other districts, the shared office; the rest only when they hold lines.
  const shown = cells.filter((x) => x.key === 'here' || x.key === 'others' || x.key === 'shared' || x.c.rows > 0);
  const total = summary.all.rows || 1;
  const name = group.offices.map((o) => dpwhOfficeName(o.name)).join(' and ');
  const sum = cells.filter((x) => x.c.rows > 0 || x.key === 'here').map((x) => x.c.rows.toLocaleString()).join(' + ');
  const adds = cells.reduce((a, x) => a + x.c.rows, 0) === summary.all.rows;

  return (
    <div className="hgab-dl-recon">
      <p className="hgab-dl-recon-head">
        <strong>Where {name}’s {lines(summary.all.rows)} are</strong>
        <span>
          NEP <Php v={summary.all.nep_php} /> · House bill <Php v={summary.all.house_php} />
          {othersIds.length > 0 && <> · shared office total, not split</>}
        </span>
      </p>
      <span
        className="hgab-dl-bar"
        role="img"
        aria-label={`By number of lines: ${shown.map((x) => `${x.label} ${x.c.rows}`).join(', ')}`}
      >
        {shown.map((x) => (x.c.rows ? <span key={x.key} className={`is-${x.key}`} style={{ width: `${(x.c.rows / total) * 100}%` }} /> : null))}
      </span>
      <dl className="hgab-dl-recon-grid">
        {shown.map((x) => (
          <div key={x.key} className={`is-${x.key} ${x.c.rows ? '' : 'is-zero'}`.trim()}>
            <dt>
              <span className={`hgab-dl-swatch is-${x.key}`} aria-hidden="true" />
              {x.label}
              <small>{x.sub}</small>
            </dt>
            <dd>
              <strong>{lines(x.c.rows)}</strong>
              <CellAmounts c={x.c} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="hgab-dl-recon-sum">
        {sum} = {lines(summary.all.rows)}{adds ? '' : ' (as published; the parts do not add up)'}. Each line is counted once,
        where the lens places it; the office total itself is {othersIds.length ? 'shared among its districts, not split' : 'not split'}.{' '}
        {(summary.shared.rows + summary.unplaced.rows + summary.held_out.rows > 0) && (
          <>
            The {lines(summary.shared.rows + summary.unplaced.rows + summary.held_out.rows)} not placed in a district are in{' '}
            {group.offices.map((o, i) => (
              <span key={o.id}>
                {i > 0 && ' and '}
                <Link to={officeProjectsHref(o)}>every project for {dpwhOfficeName(o.name)} →</Link>
              </span>
            ))}
          </>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lines table
// ---------------------------------------------------------------------------

function LinesTable({ items, first, showOffice, index }: {
  items: readonly LocatedLine[];
  first: number;
  showOffice: boolean;
  index: HgabDistrictIndex;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, first);
  // Office label → the legislative districts it serves, so a DEO is never named alone.
  const served = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of Object.values(index.offices)) {
      const ds = o.district_ids.map((id) => index.districts.find((d) => d.id === id)).filter((d): d is DistrictCard => Boolean(d));
      if (ds.length) m.set(officeParquetLabel(o), districtsServedText(ds));
    }
    return m;
  }, [index]);

  return (
    <>
      <div className="nep-table-wrap">
        <table className={`nep-table hgab-dl-table ${showOffice ? 'has-office' : ''}`.trim()}>
          <thead>
            <tr>
              <th className="hgab-ds-rank">#</th>
              <th className="nep-th-name">Project · where the title places it</th>
              <th>What changed</th>
              <th className="num">NEP → House bill</th>
              {showOffice && <th>DPWH office</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => {
              const r = l.row;
              const change = r?.nep_php != null && r.hgab3_php != null ? r.hgab3_php - r.nep_php : null;
              const kindOffice = r?.office_kind ?? '';
              return (
                <tr key={l.id} className={l.kind === 'inserted' ? 'is-inserted' : undefined}>
                  <td className="hgab-ds-rank">{i + 1}</td>
                  <td className="nep-td-name hgab-dl-td-name">
                    <Link to={recordPath('dpwh', l.id)}>{r?.title ?? l.id}</Link>
                    <span className="hgab-dl-place">
                      {l.loc && <BasisBadge loc={l.loc} />}
                      {l.loc?.place && <span className="hgab-dl-placename">{l.loc.place}</span>}
                    </span>
                  </td>
                  <td className="hgab-dl-td-kind"><KindTag kind={l.kind} held={l.held} /></td>
                  <td className="num hgab-dl-td-amt">
                    <span className="hgab-dl-flow">
                      <Php v={r?.nep_php} /> <span aria-hidden="true">→</span><span className="visually-hidden"> to </span> <Php v={r?.hgab3_php} strong />
                    </span>
                    {change != null && change !== 0 && (
                      <span className={`hgab-dl-change ${change > 0 ? 'is-up' : 'is-down'}`} title={fmt.php(change, { unit: 'full' })}>
                        {change > 0 ? '+' : '−'}{fmt.php(Math.abs(change))}
                      </span>
                    )}
                  </td>
                  {showOffice && (
                    <td className="hgab-dl-td-office">
                      <span className="hgab-dl-office">{officeDisplay(r?.office)}</span>
                      {r?.office && (
                        <small>
                          {kindOffice === 'Central Office' || kindOffice === 'Regional offices'
                            ? 'not assigned to a district'
                            : served.get(r.office) ? `serves ${served.get(r.office)}` : ''}
                        </small>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.length > first && (
        <button type="button" className="hgab-dl-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? `Show the first ${first}` : `Show all ${items.length.toLocaleString()} lines`}
        </button>
      )}
    </>
  );
}

/** One line under the lists: what each basis badge present means. */
function BasisKey({ items }: { items: readonly LocatedLine[] }) {
  const present = (['title_psgc', 'deo_to_leg'] as const satisfies readonly LocationBasis[]).filter((b) => items.some((l) => l.loc?.basis === b));
  if (!present.length) return null;
  const flagged = items.filter((l) => l.loc?.flags.length).length;
  return (
    <p className="nep-hier-note hgab-dl-howkey">
      How each line was placed:{' '}
      {present.map((b, i) => (
        <span key={b}>
          {i > 0 && ' '}
          <span className={`hgab-dl-how is-${b}`}>{LOCATION_BASIS_LABELS[b].label}</span> {LOCATION_BASIS_LABELS[b].plain}
        </span>
      ))}{' '}
      {flagged > 0 && <>A “!” marks {lines(flagged)} the source flags for review (hover for why). </>}
      Largest House bill amount first. A dash means that document does not list the project.
    </p>
  );
}
