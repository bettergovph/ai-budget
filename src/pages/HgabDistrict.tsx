/**
 * `/hgab/2027/districts/:id` — one legislative district through the DEO lens.
 *
 * The representative who holds the seat in the 20th Congress; then, per
 * district engineering office that serves the district: its attribution tier
 * and co-served districts, the budget history as a table and a chart with
 * per-Congress GAA subtotals, the FY2027 House bill against the NEP for its
 * rows (KPIs and the five-group bridge), and its largest FY2027 projects read
 * from the DPWH parquet in the browser. Figures are the office's, undivided;
 * nothing here attributes a project or an amount to the representative.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  BridgeStrip, DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading, StageAmounts, StatusChip,
} from '../components/HgabBits';
import { DeltaCell, PageLinks } from '../components/HgabProjects';
import {
  AttributionBadge, CoServedLinks, CongressCaveat, CongressLegend, HistoryChart, HistoryKey, OfficeBridgeLine, Portrait,
  PortraitCredit, RepresentativeBlock, TierBadge,
} from '../components/HgabDistrictBits';
import { runQuery } from '../lib/duckdb';
import * as fmt from '../lib/format';
import {
  CONGRESS_TERMS, HGAB_ROOT, HGAB_SOURCE_REPO, STAGE_LABELS, districtPath, formatPct, loadHgabDistricts, loadHgabOverview,
  pctChange, projectsParquetUrl, recordPath,
  type DistrictCard, type HgabDatasetMeta, type HgabDistrictIndex, type HgabDocument, type HgabOverview, type OfficeHistory,
  type ProjectRow,
} from '../lib/hgab';
import {
  ATTRIBUTION_LABELS, FISCAL_STAGE_LONG, FISCAL_STAGE_SHORT, cardOffices, cardRegionalGroups, coServedIds,
  fiscalYearRange, findDistrict, gaaSubtotal, historySlots, officeParquetLabel, officeProjectsHref,
} from '../lib/hgab-districts';
import { LIST_COLUMNS, coerceRow, parquetSource, sqlStr } from '../lib/hgab-query';
import '../hgab-districts.css';

const TOP_N = 15;

export default function HgabDistrict() {
  const { id = '' } = useParams();
  const [index, setIndex] = useState<HgabDistrictIndex | null>(null);
  const [overview, setOverview] = useState<HgabOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadHgabDistricts()
      .then((ix) => { if (live) setIndex(ix); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    // The overview supplies the DPWH dataset meta and the document catalogue
    // that project rows cite; the page renders without it.
    loadHgabOverview().then((ov) => { if (live) setOverview(ov); }).catch(() => { /* optional */ });
    return () => { live = false; };
  }, []);

  const card = index ? findDistrict(index, id) : undefined;
  useEffect(() => {
    if (card) document.title = `${card.label} — DPWH offices by Congress, House bill vs NEP FY2027 · BetterGov Budget`;
  }, [card]);

  if (err) return <HgabError message={err} />;
  if (!index) return <HgabLoading what="the FY2027 district index" heroBlend />;
  if (!card) {
    return (
      <HgabError
        message={`There is no district with the id “${id}” in the FY2027 district index (${index.districts.length.toLocaleString()} districts). A bookmarked card may predate the current crosswalk; the Districts tab above lists every one.`}
      />
    );
  }

  const offices = cardOffices(card, index);
  const groups = cardRegionalGroups(card, index);
  const rep = card.representative;
  const ambiguous = rep?.status === 'ambiguous';
  const coServed = coServedIds(card, index);
  const dpwh = overview?.datasets.find((d) => d.key === 'dpwh') ?? null;
  const attribution = ATTRIBUTION_LABELS[card.attribution];
  const built = index.built_at ? new Date(index.built_at) : null;

  return (
    <>
      <HgabHeader
        crumb={
          <>
            <Link to={districtPath()}>Districts</Link> › {card.label}
          </>
        }
        compiledMeta={`${offices.length} ${offices.length === 1 ? 'office' : 'offices'} · ${attribution.label}`}
        heroBlend
      />

      <HgabHero
        crumb={
          <>
            <Link to={districtPath()}>Districts</Link>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            <span className="hgab-crumb-here">{card.label}</span>
          </>
        }
        title={card.label}
        dek={
          <>
            {card.region ?? 'Region not recorded'} ·{' '}
            {offices.length === 0
              ? 'no district engineering office ledger could be joined to this district'
              : offices.length === 1
                ? `served by ${offices[0].name} (${offices[0].tier === 'A' ? 'Tier A, attributable' : `Tier B, shared with ${offices[0].district_ids.length - 1} other ${offices[0].district_ids.length - 1 === 1 ? 'district' : 'districts'}`})`
                : `served by ${offices.length} offices — each shown on its own, never summed across tiers`}
            . {attribution.help}
          </>
        }
        note={
          <>
            An office lens, not a district ledger: it answers which districts an office’s ledger touches,
            never which district owns a project. Figures are the office’s, as each document prints them.
          </>
        }
      />

      <main className="nep-main">
        {/* ---- representative ---- */}
        <section className={`hgab-dd-rep ${ambiguous ? 'is-ambiguous' : ''}`.trim()} aria-labelledby="hgab-dd-rep-title">
          {!ambiguous && <Portrait rep={rep} large />}
          <div>
            <p className="hgab-dd-rep-eyebrow" id="hgab-dd-rep-title">Representative · 20th Congress</p>
            <RepresentativeBlock rep={rep} large showProfile />
            {!ambiguous && <PortraitCredit rep={rep} />}
            {ambiguous && rep?.candidates?.map((c) => <PortraitCredit key={c.name} rep={c} />)}
            <p className="hgab-dd-rep-source">
              Seat holder from the congress.gov.ph 20th Congress directory as captured by the DEO2LEG crosswalk,
              joined to <a href="https://bills.juris.ph" target="_blank" rel="noopener noreferrer">bills.juris.ph</a> on the
              member code. FY2020–2025 budgets were passed by the 18th and 19th Congresses, whose members are not
              shown. Nothing on this page says or implies that a representative requested, sponsored or controlled
              a project.
            </p>
          </div>
        </section>

        {/* ---- attribution summary ---- */}
        <section className="nep-section" aria-labelledby="hgab-dd-attr">
          <SectionHead
            eyebrow="Attribution"
            headline={<span id="hgab-dd-attr"><AttributionBadge attribution={card.attribution} /> {attribution.label}</span>}
            dek={attribution.help}
          />
          {coServed.length > 0 && (
            <p className="hgab-dd-coserved">
              <strong>Co-served districts:</strong> <CoServedLinks ids={coServed} index={index} />. Their cards show the
              same undivided office figures; the money is counted once on each and never split.
            </p>
          )}
          {groups.map((g) => (
            <p className="hgab-dd-coserved" key={g.id}>
              {g.name} is a regional grouping, not a district office. Its money is part of the residual on the
              Districts page and appears on no card.
            </p>
          ))}
          {offices.length === 0 && groups.length === 0 && (
            <p className="hgab-dd-coserved">{ATTRIBUTION_LABELS.none.help}</p>
          )}
        </section>

        {/* ---- one section per office ---- */}
        {offices.map((o) => (
          <OfficeSection key={o.id} office={o} card={card} index={index} dpwh={dpwh} docs={overview?.documents ?? null} />
        ))}

        {/* ---- how to read ---- */}
        <aside className="hgab-dd-howto" aria-labelledby="hgab-dd-howto-title">
          <h2 id="hgab-dd-howto-title">How to read this</h2>
          <ol>
            <li>
              <strong>Every figure carries its attribution tier.</strong> Tier A: the office serves exactly one
              district, so its total is attributable to that district. Tier B: the office serves two or more, so
              its total is an undivided figure shared with the named co-served districts. A tier-less number is
              not allowed on these pages.
            </li>
            <li>
              <strong>Shared money is never divided.</strong> A Tier B office total is shown once, in full, with
              the co-served districts beside it. Splitting it — equally, by population, by road length — would
              fabricate a district-level amount the data cannot support.
            </li>
            <li>
              <strong>The residual is published.</strong> Central Office, regional offices and unmatched units
              hold most DPWH money in every year; the Districts page shows that share per fiscal year before any
              card. Money under those labels appears on no district card.
            </li>
            <li>
              <strong>The source’s own caution is carried.</strong> FY2027 groups are candidates — “insertion
              candidates” and “deletion candidates” are matching observations, not findings; fuzzy and ambiguous
              rows are held out of headline counts upstream. The FY2027 NEP history slot is DBM’s whole-office
              listing; the HGAB 3R figure and its Δ cover the compared population of named projects only, and
              the two are never compared like for like.
            </li>
          </ol>
          <CongressCaveat />
        </aside>

        <section className="nep-section" aria-label="Congress terms">
          <CongressLegend terms={index.terms?.length ? index.terms : undefined} />
        </section>

        <DisclaimerNotice compact />

        <p className="nep-provenance">
          {built && `Built ${built.toLocaleString('en-PH')} · `}
          Sources: this portal’s GAA FY2020–2026 operating-unit data; the DBM NEP FY2027 operating-unit listing;
          House Bill 10858 third reading against the NEP from{' '}
          <a href={HGAB_SOURCE_REPO} target="_blank" rel="noopener noreferrer">the extraction workbench</a>
          {index.source_commit && <> at <code>{index.source_commit.slice(0, 7)}</code></>}
          ; DEO2LEG crosswalk v{index.crosswalk.schema_version} ({index.crosswalk.build_date}); representatives and
          portraits from <a href="https://bills.juris.ph" target="_blank" rel="noopener noreferrer">bills.juris.ph</a>.
          {' · '}<Link to={districtPath()}>All districts</Link>
          {' · '}<Link to={`${HGAB_ROOT}/methodology`}>Methodology</Link>
          {' · '}<Link to={`${HGAB_ROOT}/sources`}>Sources</Link>
        </p>
      </main>
      <SiteFooter source={`SOURCE: GAA FY 2020–2026 · DBM NEP FY 2027 · HOUSE BILL 10858 (3RD READING) · DEO2LEG · ${card.label.toUpperCase()}`} />
    </>
  );
}

// ---------------------------------------------------------------------------
// One office
// ---------------------------------------------------------------------------

function OfficeSection({ office, card, index, dpwh, docs }: {
  office: OfficeHistory;
  card: DistrictCard;
  index: HgabDistrictIndex;
  dpwh: HgabDatasetMeta | null;
  docs: readonly HgabDocument[] | null;
}) {
  const others = office.district_ids.filter((d) => d !== card.id);
  const f = office.fy2027;
  const delta = f && f.hgab3_php != null && f.nep_php != null ? f.hgab3_php - f.nep_php : null;
  const label = officeParquetLabel(office);
  const kind = office.kind.replace(/_/g, ' ');
  const sid = office.id.replace(/[^a-zA-Z0-9_-]/g, '-');

  return (
    <section className="hgab-dd-office" aria-labelledby={`${sid}-title`}>
      <div className="hgab-dd-office-head">
        <h2 id={`${sid}-title`}>{office.name}</h2>
        <TierBadge tier={office.tier} sharedWith={others.length} />
        <span className="hgab-dd-office-kind">{kind}{office.region ? ` · ${office.region}` : ''}</span>
      </div>
      <p className="hgab-dd-coserved">
        {office.tier === 'A' ? (
          <>Serves this district alone; every figure below is attributable to {card.label}.</>
        ) : (
          <>
            <strong>Undivided office total.</strong> This office also serves <CoServedLinks ids={others} index={index} />;
            the figures below are the office’s and are shared, not split, among the {others.length + 1} districts.
          </>
        )}
      </p>

      <div className="hgab-dd-two">
        <div>
          <p className="hgab-dd-sub">Budget by fiscal year and Congress</p>
          <HistoryTable office={office} />
        </div>
        <div>
          <p className="hgab-dd-sub">The same nine slots, drawn</p>
          <HistoryChart office={office} size="full" />
          <HistoryKey />
        </div>
      </div>
      <details className="hgab-dd-small">
        <summary>What each figure covers</summary>
        <ul>
          {index.scope_notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </details>

      {/* ---- FY2027 against the NEP, compared population ---- */}
      <div className="hgab-dd-fy27">
        <SectionHead
          size="sm"
          eyebrow="FY2027 · House bill against the NEP · this office’s rows"
          headline={`${STAGE_LABELS.hgab3.short} vs ${STAGE_LABELS.nep.short}, compared population`}
          dek="Named project rows recorded under this office in the DPWH comparison: the NEP, the House bill at second and third reading, and the five-group bridge between NEP and HGAB 3R. Insertions and deletions are candidates; held rows are excluded upstream."
        />
        {f ? (
          <>
            <KpiStrip
              items={[
                { label: STAGE_LABELS.nep.short, value: f.nep_php == null ? '—' : fmt.shortPhp(f.nep_php), sub: `${f.nep_records.toLocaleString()} NEP records · compared population` },
                { label: STAGE_LABELS.hgab2.short, value: f.hgab2_php == null ? '—' : fmt.shortPhp(f.hgab2_php), sub: STAGE_LABELS.hgab2.label },
                {
                  label: STAGE_LABELS.hgab3.short,
                  value: f.hgab3_php == null ? '—' : fmt.shortPhp(f.hgab3_php),
                  tone: delta == null ? undefined : delta >= 0 ? 'up' : 'down',
                  sub: delta == null
                    ? `${f.hgab3_records.toLocaleString()} House records`
                    : `${delta >= 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(delta))} vs NEP · ${formatPct(pctChange(f.hgab3_php, f.nep_php))} · ${f.hgab3_records.toLocaleString()} House records`,
                },
                {
                  label: 'Records per stage',
                  value: `${f.nep_records.toLocaleString()} → ${f.hgab3_records.toLocaleString()}`,
                  sub: 'NEP → House · compared, not added',
                },
              ]}
            />
            {f.bridge ? <BridgeStrip bridge={f.bridge} dataset="dpwh" /> : <p className="nep-empty">No bridge for this office’s rows.</p>}
            <OfficeBridgeLine office={office} />
          </>
        ) : (
          <p className="nep-empty">This ledger has no FY2027 comparison block.</p>
        )}
      </div>

      {/* ---- top projects from the parquet ---- */}
      <div className="hgab-dd-projects">
        <SectionHead
          size="sm"
          eyebrow="From dpwh/projects.parquet, in the browser"
          headline={`Largest FY2027 rows recorded under “${label}”`}
          dek={`The ${TOP_N} largest comparison rows by HGAB 3R amount, then by NEP amount for rows the House bill does not carry. Each links to its record page and to the PDF page it was read from.`}
          right={
            <Link className="hgab-ds-seeall" to={officeProjectsHref(office)}>
              See all rows for this office in Projects →
            </Link>
          }
        />
        <OfficeProjects label={label} dpwh={dpwh} docs={docs} />
      </div>

      {(office.notes.length > 0 || office.aliases_used.length > 0) && (
        <p className="hgab-dd-small">
          {office.aliases_used.length > 0 && (
            <>Joined across years by these printed labels: {office.aliases_used.map((a, i) => <span key={a}>{i > 0 && ', '}<code>{a}</code></span>)}. </>
          )}
          {office.notes.map((n) => <span key={n}>{n} </span>)}
          Crosswalk id <code>{office.id}</code>.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// History table: nine slots, per-Congress GAA subtotal rows
// ---------------------------------------------------------------------------

function HistoryTable({ office }: { office: OfficeHistory }) {
  const slots = historySlots(office);
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-dd-history">
        <thead>
          <tr>
            <th>Fiscal year</th>
            <th>Stage</th>
            <th>Congress</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {CONGRESS_TERMS.map((term) => {
            const own = slots.filter((s) => s.congress.congress === term.congress);
            const sub = gaaSubtotal(office, term.congress);
            return [
              ...own.map((s) => (
                <tr
                  key={`${s.fy}-${s.stage}`}
                  className={`${s.stage !== 'gaa' ? 'is-proposal' : ''} ${s.php == null ? 'is-null' : ''}`.trim()}
                  title={s.matched_label ? `Matched in that year's source as “${s.matched_label}”` : s.php == null ? 'Not found in that year’s data' : undefined}
                >
                  <td>FY{s.fy}</td>
                  <td><span className={`hgab-dd-stage is-${s.stage}`} title={FISCAL_STAGE_LONG[s.stage]}>{FISCAL_STAGE_SHORT[s.stage]}</span></td>
                  <td className="nep-td-dim">{s.congress.label}</td>
                  <td className="num" title={s.php == null ? 'Not found in that year’s data — not a zero' : fmt.php(s.php, { unit: 'full' })}>
                    {s.php == null ? <span className="hgab-ds-null">—</span> : fmt.shortPhp(s.php)}
                  </td>
                </tr>
              )),
              <tr key={`sub-${term.congress}`} className="is-subtotal">
                <td colSpan={3}>
                  {term.label} · GAA subtotal
                  <span className="nep-code">
                    {sub.years.length ? `${fiscalYearRange(sub.years)} · ${sub.years.length} ${sub.years.length === 1 ? 'year' : 'years'} counted` : 'no GAA figure found'}
                    {term.years.includes(2027) ? ' · FY2027 NEP and HGAB 3R listed, not added' : ''}
                  </span>
                </td>
                <td className="num" title={sub.php == null ? undefined : fmt.php(sub.php, { unit: 'full' })}>
                  {sub.php == null ? <span className="hgab-ds-null">—</span> : fmt.shortPhp(sub.php)}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <p className="nep-hier-note">
        Hover a row for the operating-unit label matched in that year’s source and the exact pesos. A dash is
        “not found in that year’s data”, never a zero. Subtotals add enacted GAA years only; proposals are listed
        beside them.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top projects for the office, via DuckDB-Wasm
// ---------------------------------------------------------------------------

type Tagged<T> = { key: string } & T;

function OfficeProjects({ label, dpwh, docs }: { label: string; dpwh: HgabDatasetMeta | null; docs: readonly HgabDocument[] | null }) {
  const url = useMemo(() => projectsParquetUrl('dpwh'), []);
  const sql = useMemo(
    () => `SELECT ${LIST_COLUMNS.join(', ')}
FROM ${parquetSource(url)}
WHERE office = ?
ORDER BY hgab3_php DESC NULLS LAST, nep_php DESC NULLS LAST, title ASC, id ASC
LIMIT ${TOP_N}`,
    [url],
  );
  const [result, setResult] = useState<Tagged<{ rows: ProjectRow[]; ms: number }> | null>(null);
  const [error, setError] = useState<Tagged<{ message: string }> | null>(null);

  useEffect(() => {
    let live = true;
    const key = `${sql}|${label}`;
    (async () => {
      try {
        let res;
        try {
          res = await runQuery(sql, [label]);
        } catch {
          // Parameter binding is not available in every DuckDB-Wasm build; inline the literal.
          res = await runQuery(sql.replace('WHERE office = ?', `WHERE office = ${sqlStr(label)}`));
        }
        if (!live) return;
        setResult({ key, rows: res.rows.map((r) => coerceRow(r as Record<string, unknown>)), ms: Math.round(res.ms) });
        setError(null);
      } catch (e) {
        if (!live) return;
        setError({ key, message: String((e as Error)?.message || e) });
      }
    })();
    return () => { live = false; };
  }, [sql, label]);

  const key = `${sql}|${label}`;
  const fresh = result?.key === key ? result : null;
  const failed = error?.key === key ? error : null;
  const loading = !fresh && !failed;
  const rows = fresh?.rows ?? [];

  if (loading) {
    return (
      <p className="hgab-dd-projects-busy" role="status">
        <span className="busy-sweep" aria-hidden="true" />
        Reading dpwh/projects.parquet… the first query fetches the file
      </p>
    );
  }
  if (failed) {
    return (
      <div className="hgab-ds-parquet-err" role="alert">
        <p>Could not read <code>hgab/2027/dpwh/projects.parquet</code> for this office.</p>
        <pre>{failed.message}</pre>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <p className="nep-empty">
        No FY2027 comparison row is recorded under “{label}”. The office’s GAA history above stands on its own.
      </p>
    );
  }
  return (
    <>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-dd-projects-table">
          <thead>
            <tr>
              <th className="hgab-ds-rank">#</th>
              <th className="nep-th-name">Project</th>
              <th>Status</th>
              <th>Stage amounts</th>
              <th className="num">Δ vs NEP</th>
              <th>Pages</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="hgab-ds-rank">{i + 1}</td>
                <td className="nep-td-name">
                  <Link to={recordPath('dpwh', r.id)}>{r.title}</Link>
                  <span className="nep-code">{[r.region, r.pap].filter(Boolean).join(' · ')}</span>
                </td>
                <td><StatusChip trace={r.trace} /></td>
                <td><StageAmounts row={r} /></td>
                <td className="num"><DeltaCell delta={r.delta_php} base={r.nep_php} /></td>
                <td>{dpwh ? <PageLinks row={r} dataset={dpwh} docs={docs} /> : <span className="hgab-ds-null">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="nep-hier-note">
        {rows.length} of the rows recorded under this office, by third-reading amount{fresh ? ` · ${fresh.ms} ms` : ''}.
        Stage amounts are compared, never added; a dash means the stage has no record. Office is the label printed on the
        House side of a paired row, as in the HGAB section.
      </p>
    </>
  );
}
