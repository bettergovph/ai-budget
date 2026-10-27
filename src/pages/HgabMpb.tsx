/**
 * `/hgab/2027/multi-purpose-buildings`: the multi-purpose buildings (MPB) in
 * the FY2027 DPWH project lists, as one page of figures and tables.
 *
 * Every figure comes from `data/hgab/2027/mpb.json` (`npm run build:hgab-mpb`,
 * contract `lib/hgab-mpb.ts`). A line counts when its published title says
 * "multi-purpose"; nothing else is inferred. The page reads like the rest of
 * the section's office views (the leaderboards, Districts):
 *
 *   - amounts belong to DPWH offices, never to the people shown;
 *   - an office row is headed by its legislative district (one district, with
 *     the DPWH office as a small badge) or by the office itself (shared,
 *     Tier B, with every district it serves), and its tier is always shown;
 *     a shared office's figure is never split;
 *   - money no district carries (Central Office, regional offices, lines that
 *     changed office or name none) is shown in its own table, so the office
 *     table plus that table add up to the inserted total in the head;
 *   - the NEP and the House bill are compared, never added; inserted lines
 *     are insertion candidates, not findings, and the documents do not say
 *     who asked for any project.
 *
 * Sections: head and six figures, what changed, inserted by office (sortable,
 * top 25 then all), by region (chart and table), by type and program,
 * amounts, repeated titles, the largest inserted lines, money in no district,
 * and the notes, definition, download and disclaimers.
 *
 * Styles: src/hgab-mpb.css (.hgab-mpb-*) over the leaderboard tables
 * (src/hgab-leaderboard.css, .hgab-lb-*), which already collapse to three
 * columns on phones.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DeoBadges, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { Face } from '../components/HgabLeaderboardBits';
import { KpiStrip } from '../components/Nep2027Bits';
import { dataUrl } from '../lib/data-url';
import { HGAB_ROOT, REGION_LABELS, datasetPath, loadHgabMpb, recordPath, regionKeyOf, type RegionKey } from '../lib/hgab';
import { COMPARE_NOT_ADD } from '../lib/hgab-ui';
import { DEO_MEANING, displayName, formatPesoFull, formatValue, officeName } from '../lib/hgab-leaderboard';
import {
  MPB_CSV_NAME, MPB_CSV_PATH, MPB_KINDS, MPB_KIND_LABELS, MPB_TITLE, mpbProjectsHref,
  type MpbCell, type MpbData, type MpbKind, type MpbLine, type MpbOffice, type MpbRegion, type MpbSlice,
} from '../lib/hgab-mpb';
import '../nep2027.css';
import '../hgab-leaderboard.css';
import '../hgab-mpb.css';

const SOURCE_LINE = 'SOURCE: NEP 2027 · HOUSE BILL 10858, THIRD READING · DEO2LEG OFFICE-TO-DISTRICT MAP · BILLS.JURIS.PH';

/** Rows a long table shows before "Show all". */
const FIRST = 25;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const n = (v: number) => v.toLocaleString('en-US');
const php = (v: number | null | undefined) => formatValue(v, 'php');
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;
const lines = (v: number) => plural(v, 'line', 'lines');

/** "34%", "<1%", ">99%", or "—" when there is nothing to divide by. */
function pct(part: number, whole: number): string {
  if (!whole) return '—';
  const p = (part / whole) * 100;
  if (part > 0 && p < 1) return '<1%';
  if (part < whole && p > 99) return '>99%';
  return `${Math.round(p)}%`;
}

/** A data string as a sentence: trimmed, with a closing full stop. */
function sentenceOf(s: string | null | undefined): string {
  const t = (s ?? '').trim();
  return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`;
}

/** A share in [0, 1] as "52%"; null as "—". */
function share(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return pct(v, 1);
}

/** The bridge group each kind takes its colour from (hgab.css `.is-<group>`). */
const KIND_GROUP: Record<MpbKind, string> = {
  inserted: 'house_only',
  increased: 'increased',
  decreased: 'decreased',
  scope_review: 'scope_review',
  unchanged: 'unchanged',
  dropped: 'nep_only',
};

function regionName(key: string | null | undefined): string {
  if (!key) return 'No region';
  return REGION_LABELS[key as RegionKey]?.name ?? key;
}

function regionShort(key: string): string {
  return REGION_LABELS[key as RegionKey]?.short ?? key;
}

/** "Abra District Engineering Office" → "Abra DEO". */
const deoName = (label: string) => label.replace(/\bDistrict Engineering Office\b/i, 'DEO').trim();

/** One district (Tier A, one seat): headed by the district. Otherwise by the office. */
function isShared(o: MpbOffice): boolean {
  return !(o.tier === 'A' && o.people.length <= 1);
}

function officeTitle(o: MpbOffice): string {
  return isShared(o) ? officeName(o) : o.people[0]?.district ?? officeName(o);
}

function tierText(o: MpbOffice): string {
  return o.tier === 'A' ? 'Tier A · only this district' : `Tier B · shared by ${o.people.length} districts, not split`;
}

const TIER_HELP = {
  A: 'Tier A: the DPWH office serves only this legislative district, so its figure is the district’s.',
  B: 'Tier B: one DPWH office serves these legislative districts. Its amount is shown whole, not split between them.',
} as const;

/** "₱1.2B → ₱3.4B", each with its exact pesos on hover. */
function NepHouse({ cell }: { cell: Pick<MpbCell, 'nep_php' | 'house_php'> }) {
  return (
    <>
      <span title={`NEP ${formatPesoFull(cell.nep_php)}`}>{php(cell.nep_php)}</span>
      <span className="hgab-mpb-arrow" aria-label="to"> → </span>
      <span title={`House bill ${formatPesoFull(cell.house_php)}`}>{php(cell.house_php)}</span>
    </>
  );
}

/** A table that scrolls inside itself, never the page, and says so to a screen reader. */
function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nep-table-wrap hgab-mpb-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

function ShowAll({ total, open, onOpen, noun }: { total: number; open: boolean; onOpen: () => void; noun: string }) {
  if (total === 0) return null;
  const shown = open ? total : Math.min(total, FIRST);
  return (
    <p className="hgab-lb-tablefoot">
      <span>{shown < total ? `The first ${n(shown)} of ${n(total)} ${noun}` : `All ${n(total)} ${noun}`}</span>
      {!open && total > FIRST && (
        <button type="button" className="nep-more" onClick={onOpen}>
          Show all {n(total)}
        </button>
      )}
    </p>
  );
}

function SectionHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="hgab-lb-section-head hgab-mpb-head">
      <p className="hgab-mpb-eyebrow">{eyebrow}</p>
      <h2 id={`${id}-h`}>{title}</h2>
      {children && <p>{children}</p>}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

interface Index {
  byKey: Map<string, MpbOffice>;
  /** House-bill office label → its office group. */
  byLabel: Map<string, MpbOffice>;
  /** Titles as published, for the repeats table (its titles are normalised). */
  titleById: Map<string, string>;
}

function buildIndex(data: MpbData): Index {
  const byKey = new Map(data.offices.map((o) => [o.key, o]));
  const byLabel = new Map<string, MpbOffice>();
  for (const o of data.offices) for (const f of o.offices) if (f.label) byLabel.set(f.label, o);
  const titleById = new Map(data.largest_inserted.map((l) => [l.id, l.title]));
  return { byKey, byLabel, titleById };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HgabMpb() {
  const [data, setData] = useState<MpbData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadHgabMpb()
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);

  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="the multi-purpose buildings" />;
  return <MpbPage data={data} />;
}

const SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'what-changed', label: 'What changed' },
  { id: 'by-office', label: 'By DPWH office' },
  { id: 'by-region', label: 'By region' },
  { id: 'by-type', label: 'By type and program' },
  { id: 'amounts', label: 'Amounts' },
  { id: 'repeats', label: 'Repeated titles' },
  { id: 'largest', label: 'Largest lines' },
  { id: 'no-district', label: 'In no district' },
  { id: 'about', label: 'About the figures' },
];

function MpbPage({ data }: { data: MpbData }) {
  const { hash } = useLocation();
  const idx = useMemo(() => buildIndex(data), [data]);
  const mainRef = useRef<HTMLElement>(null);

  // The masthead is sticky and its height changes with the viewport: sections
  // keep their heading below it when a link jumps to them (scroll-margin-top).
  useEffect(() => {
    const head = document.querySelector<HTMLElement>('.masthead');
    const root = mainRef.current;
    if (!head || !root || typeof ResizeObserver === 'undefined') return;
    const set = () => root.style.setProperty('--hgab-mpb-top', `${Math.round(head.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  // The page renders after its data loads, so a link to one section (#by-office) scrolls once it exists.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [hash]);

  const t = data.totals;
  const ins = t.kinds.inserted;
  const crumb = (
    <>
      <Link to={datasetPath('dpwh')}>DPWH</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">{MPB_TITLE}</span>
    </>
  );

  return (
    <>
      <HgabHeader
        crumb={<><Link to={datasetPath('dpwh')}>DPWH</Link> › {MPB_TITLE}</>}
        compiledMeta={`${lines(t.all.rows)} · ${plural(data.offices.length, 'DPWH office', 'DPWH offices')}`}
      />
      <HgabHero
        compact
        crumb={crumb}
        title={MPB_TITLE}
        dek={
          <>
            {n(t.all.rows)} DPWH project lines in the NEP or the House bill are multi-purpose buildings (MPB):{' '}
            {pct(t.all.rows, data.dpwh.rows)} of all DPWH lines. {n(ins.rows)} are in the House bill only, worth{' '}
            {php(ins.house_php)}; {n(t.unconfirmed.rows)} of these have an unconfirmed NEP match.
          </>
        }
        note={
          <>
            <strong>What counts:</strong> {sentenceOf(data.definition)} Amounts belong to DPWH offices, not to people. The
            documents do not say who asked for any project. {DEO_MEANING}
          </>
        }
      />

      <main className="nep-main hgab-lb-main hgab-mpb" ref={mainRef}>
        <Headline data={data} />

        <nav className="hgab-mpb-toc" aria-label="On this page">
          <span>On this page</span>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}><a href={`#${s.id}`}>{s.label}</a></li>
            ))}
          </ul>
        </nav>

        <KindsSection data={data} />
        <OfficeSection data={data} />
        <RegionSection data={data} />
        <TypeSection data={data} />
        <AmountsSection data={data} />
        <RepeatsSection data={data} idx={idx} />
        <LargestSection data={data} idx={idx} />
        <ResidualSection data={data} />
        <AboutSection data={data} />
        <DisclaimerNotice offices />
      </main>
      <SiteFooter source={SOURCE_LINE} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

function Headline({ data }: { data: MpbData }) {
  const t = data.totals;
  const ins = t.kinds.inserted;
  const unconf = t.unconfirmed;
  const central = data.by_office_kind.central.all;
  const a = data.amounts;
  const top = a.top[0];
  return (
    <div className="hgab-mpb-kpis">
      <KpiStrip
        items={[
          {
            label: 'Multi-purpose lines',
            value: n(t.all.rows),
            sub: `${pct(t.all.rows, data.dpwh.rows)} of the ${n(data.dpwh.rows)} DPWH project lines`,
          },
          {
            label: 'Inserted',
            value: <span title={formatPesoFull(ins.house_php)}>{php(ins.house_php)}</span>,
            sub:
              `${n(ins.rows)} lines: ${n(ins.rows - unconf.rows)} insertion candidates worth ${php(ins.house_php - unconf.php)}, ` +
              `plus ${n(unconf.rows)} (${php(unconf.php)}) with an unconfirmed NEP match. ` +
              `${pct(ins.rows, data.dpwh.inserted_rows)} of inserted DPWH lines, ${pct(ins.house_php, data.dpwh.inserted_php)} of the pesos.`,
          },
          {
            label: 'NEP → House bill',
            value: <span className="hgab-mpb-kpi-pair"><NepHouse cell={t.all} /></span>,
            sub: `All multi-purpose lines. The two versions are compared, never added.`,
          },
          {
            label: 'Under Central Office',
            value: lines(central.rows),
            sub: `${php(central.house_php)} in the House bill. Central Office lines are in no legislative district.`,
          },
          {
            label: 'Most common amount',
            value: top ? formatPesoFull(top.php) : '—',
            sub: top ? `${lines(top.rows)}: ${pct(top.rows, a.house_lines)} of the lines with a House amount` : 'No House amounts',
          },
          {
            label: 'Round amounts',
            value: pct(a.multiple_of_1m, a.house_lines),
            sub: `of House amounts are whole millions. ${pct(a.multiple_of_500k, a.house_lines)} are multiples of ₱500,000.`,
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------

function KindsSection({ data }: { data: MpbData }) {
  const t = data.totals;
  const total = t.all.rows || 1;
  return (
    <section id="what-changed" className="hgab-mpb-section" aria-labelledby="what-changed-h">
      <SectionHead
        id="what-changed"
        eyebrow="What changed"
        title={`${n(t.kinds.inserted.rows)} of the ${n(t.all.rows)} lines are in the House bill only`}
      >
        Each line lands in one of six groups, by what happened to it between the NEP and the House bill.
      </SectionHead>

      <div className="hgab-mpb-kindbar" aria-hidden="true">
        {MPB_KINDS.map((k) => {
          const c = t.kinds[k];
          if (!c.rows) return null;
          return (
            <span
              key={k}
              className={`is-${KIND_GROUP[k]}`}
              style={{ width: `${(c.rows / total) * 100}%` }}
              title={`${MPB_KIND_LABELS[k].label}: ${lines(c.rows)} (${pct(c.rows, t.all.rows)})`}
            >
              {c.rows / total >= 0.08 && <em>{MPB_KIND_LABELS[k].label} {pct(c.rows, t.all.rows)}</em>}
            </span>
          );
        })}
      </div>

      <TableWrap label="Multi-purpose lines by what changed">
        <table className="nep-table hgab-lb-table hgab-mpb-table">
          <caption className="visually-hidden">Multi-purpose lines by what happened between the NEP and the House bill</caption>
          <thead>
            <tr>
              <th scope="col">What happened</th>
              <th scope="col" className="num">Lines</th>
              <th scope="col" className="num hgab-lb-col-wide">Share</th>
              <th scope="col" className="num">NEP</th>
              <th scope="col" className="num">House bill</th>
              <th scope="col"><span className="visually-hidden">Open the list</span></th>
            </tr>
          </thead>
          <tbody>
            {MPB_KINDS.map((k) => {
              const c = t.kinds[k];
              return (
                <tr key={k}>
                  <th scope="row">
                    <span className="hgab-mpb-kind">
                      <span className={`hgab-mpb-swatch is-${KIND_GROUP[k]}`} aria-hidden="true" />
                      <span>
                        <strong>{MPB_KIND_LABELS[k].label}</strong>
                        <small>{MPB_KIND_LABELS[k].plain}</small>
                        {k === 'inserted' && t.unconfirmed.rows > 0 && (
                          <small>
                            Includes {lines(t.unconfirmed.rows)} ({php(t.unconfirmed.php)}) whose NEP match is unconfirmed.
                          </small>
                        )}
                      </span>
                    </span>
                  </th>
                  <td className="num">{n(c.rows)}</td>
                  <td className="num hgab-lb-share hgab-lb-col-wide">{pct(c.rows, t.all.rows)}</td>
                  {/* Inserted lines have no NEP figure and dropped ones no House figure: a dash, not ₱0. */}
                  <td className="num" title={k === 'inserted' || !c.rows ? undefined : formatPesoFull(c.nep_php)}>
                    {k === 'inserted' || !c.rows ? '—' : php(c.nep_php)}
                  </td>
                  <td className="num" title={k === 'dropped' || !c.rows ? undefined : formatPesoFull(c.house_php)}>
                    {k === 'dropped' || !c.rows ? '—' : php(c.house_php)}
                  </td>
                  <td className="hgab-lb-go">
                    {c.rows > 0 && (
                      <Link to={mpbProjectsHref({ group: KIND_GROUP[k] })} aria-label={`List the ${MPB_KIND_LABELS[k].label.toLowerCase()} lines`}>
                        List →
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="is-total">
              <th scope="row">All multi-purpose lines</th>
              <td className="num">{n(t.all.rows)}</td>
              <td className="num hgab-lb-col-wide">100%</td>
              <td className="num" title={formatPesoFull(t.all.nep_php)}>{php(t.all.nep_php)}</td>
              <td className="num" title={formatPesoFull(t.all.house_php)}>{php(t.all.house_php)}</td>
              <td className="hgab-lb-go"><Link to={mpbProjectsHref()} aria-label="List every multi-purpose line">List →</Link></td>
            </tr>
          </tfoot>
        </table>
      </TableWrap>
      <p className="hgab-mpb-foot">
        The NEP and House bill columns are {COMPARE_NOT_ADD}. House amounts are the third reading.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// By DPWH office
// ---------------------------------------------------------------------------

type OfficeSort = 'php' | 'rows' | 'share' | 'all';
const OFFICE_SORTS: Record<OfficeSort, { label: string; value: (o: MpbOffice) => number | null }> = {
  php: { label: 'Inserted pesos', value: (o) => o.kinds.inserted.house_php },
  rows: { label: 'Inserted lines', value: (o) => o.kinds.inserted.rows },
  share: { label: 'Share of the office’s inserted budget', value: (o) => o.inserted_mpb_share },
  all: { label: 'All multi-purpose lines', value: (o) => o.all.rows },
};
const OFFICE_SORT_ORDER: readonly OfficeSort[] = ['php', 'rows', 'share', 'all'];

function SortTh({
  k, sort, dir, onSort, className = '', children,
}: {
  k: OfficeSort;
  sort: OfficeSort;
  dir: 'asc' | 'desc';
  onSort: (k: OfficeSort) => void;
  className?: string;
  children: ReactNode;
}) {
  const active = sort === k;
  return (
    <th
      scope="col"
      className={`num is-wrap ${active ? 'nep-th-active' : ''} ${className}`.trim()}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" onClick={() => onSort(k)}>
        {children}
        <span className="nep-sort-caret" aria-hidden="true">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}

/** Links to the projects list, filtered to each office's multi-purpose lines. */
function OfficeLinks({ office }: { office: MpbOffice }) {
  const linked = office.offices.filter((f) => f.href);
  if (!linked.length) return null;
  if (linked.length === 1) {
    return (
      <span className="hgab-mpb-officelinks">
        <Link to={linked[0].href!}>Its multi-purpose lines →</Link>
      </span>
    );
  }
  return (
    <span className="hgab-mpb-officelinks">
      Multi-purpose lines:{' '}
      {linked.map((f, i) => (
        <span key={f.id}>
          {i > 0 && ' · '}
          <Link to={f.href!}>{deoName(f.name)} →</Link>
        </span>
      ))}
    </span>
  );
}

/**
 * An office group, place first (as on the leaderboards). One district: the
 * legislative district, linking to its page, with its DPWH office as a small
 * badge. Shared: the DPWH office, then each seat holder with the district
 * they hold. The tier closes both; the amount beside it is the office's.
 */
function OfficeCell({ office }: { office: MpbOffice }) {
  const shared = isShared(office);
  const first = office.people[0];
  return (
    <th scope="row" className="hgab-lb-place-cell hgab-mpb-place">
      <p className="hgab-lb-place">
        {shared || !first ? officeTitle(office) : (
          <>
            <Link to={first.href}>{first.district}</Link>
            <DeoBadges offices={office.offices.map((f) => f.name)} jurisdiction={first.jurisdiction} />
          </>
        )}
      </p>
      <ul className="hgab-lb-lines is-seats">
        {office.people.map((p) => (
          <li key={p.district_id}>
            <Face person={p} size={28} />
            <span className="hgab-lb-who">
              <span className={`hgab-lb-rep ${p.name ? '' : 'is-missing'}`.trim()}>
                {p.name ? `Rep. ${displayName(p.name)}` : 'No representative found'}
              </span>
              {shared && <Link to={p.href} className="hgab-lb-dist">{p.district}</Link>}
            </span>
          </li>
        ))}
      </ul>
      <span className={`hgab-lb-tier is-${office.tier}`} title={TIER_HELP[office.tier]}>{tierText(office)}</span>
      <OfficeLinks office={office} />
    </th>
  );
}

function OfficeSection({ data }: { data: MpbData }) {
  const [sort, setSort] = useState<OfficeSort>('php');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const value = OFFICE_SORTS[sort].value;
    const m = dir === 'desc' ? -1 : 1;
    return [...data.offices].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av == null || bv == null) return av == null && bv == null ? 0 : av == null ? 1 : -1;
      return (av - bv) * m
        || b.kinds.inserted.house_php - a.kinds.inserted.house_php
        || officeTitle(a).localeCompare(officeTitle(b));
    });
  }, [data.offices, sort, dir]);

  const onSort = (k: OfficeSort) => {
    if (k === sort) setDir(dir === 'desc' ? 'asc' : 'desc');
    else { setSort(k); setDir('desc'); }
  };

  const withInserted = data.offices.filter((o) => o.kinds.inserted.rows > 0);
  const sum = data.offices.reduce((s, o) => s + o.kinds.inserted.house_php, 0);
  const shown = open ? rows : rows.slice(0, FIRST);
  const tierB = data.offices.filter((o) => o.tier === 'B').length;

  return (
    <section id="by-office" className="hgab-mpb-section" aria-labelledby="by-office-h">
      <SectionHead
        id="by-office"
        eyebrow="Inserted, by DPWH office"
        title={`${n(withInserted.length)} DPWH offices list inserted multi-purpose buildings, ${php(sum)} in all`}
      >
        Each row is a DPWH office and the legislative districts it serves. {n(tierB)} offices serve several
        districts (Tier B); their figures are shown whole, not split. Share is the multi-purpose part of all the
        office’s inserted DPWH pesos.
      </SectionHead>

      <div className="hgab-mpb-toolbar">
        <label className="hgab-lb-select">
          <span>Sort by</span>
          <select
            className="select-input"
            value={sort}
            onChange={(e) => { setSort(e.target.value as OfficeSort); setDir('desc'); }}
          >
            {OFFICE_SORT_ORDER.map((k) => <option key={k} value={k}>{OFFICE_SORTS[k].label}, largest first</option>)}
          </select>
        </label>
        <p>{n(data.offices.length)} DPWH offices list at least one multi-purpose line. Hover an amount for the exact pesos.</p>
      </div>

      <TableWrap label="Inserted multi-purpose buildings by DPWH office">
        <table className="nep-table hgab-lb-table hgab-mpb-table hgab-mpb-offices">
          <caption className="visually-hidden">
            Inserted multi-purpose buildings by DPWH office, sorted by {OFFICE_SORTS[sort].label.toLowerCase()},
            {dir === 'desc' ? ' largest first' : ' smallest first'}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="num hgab-lb-rank">#</th>
              <th scope="col" className="is-wrap">Legislative district or DPWH office · representative</th>
              <th scope="col" className="hgab-lb-col-wide">Region</th>
              <SortTh k="rows" sort={sort} dir={dir} onSort={onSort} className="hgab-lb-col-wide">Inserted lines</SortTh>
              <SortTh k="php" sort={sort} dir={dir} onSort={onSort}>Inserted</SortTh>
              <SortTh k="share" sort={sort} dir={dir} onSort={onSort} className="hgab-lb-col-wide">Share of its inserted budget</SortTh>
              <SortTh k="all" sort={sort} dir={dir} onSort={onSort} className="hgab-lb-col-wide">All lines</SortTh>
              <th scope="col" className="num is-wrap hgab-lb-col-wide">NEP → House bill</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o, i) => {
              const c = o.kinds.inserted;
              return (
                <tr key={o.key} className={o.tier === 'B' ? 'is-shared' : undefined}>
                  <td className="num hgab-lb-rank">{i + 1}</td>
                  <OfficeCell office={o} />
                  <td className="hgab-lb-region hgab-lb-col-wide">{regionName(o.region)}</td>
                  <td className="num hgab-lb-col-wide">
                    {n(c.rows)}
                    {o.unconfirmed.rows > 0 && <small className="hgab-mpb-sub">{n(o.unconfirmed.rows)} unconfirmed</small>}
                  </td>
                  <td className="num hgab-lb-val" title={formatPesoFull(c.house_php)}>
                    {php(c.house_php)}
                    <small className="hgab-lb-phone">
                      {lines(c.rows)} · {share(o.inserted_mpb_share)} of its inserted budget
                    </small>
                  </td>
                  <td className="num hgab-lb-col-wide">
                    {share(o.inserted_mpb_share)}
                    {o.inserted_mpb_share != null && (
                      <span className="hgab-mpb-minibar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, o.inserted_mpb_share * 100)}%` }} />
                      </span>
                    )}
                    <small className="hgab-mpb-sub" title={formatPesoFull(o.inserted_all_php)}>of {php(o.inserted_all_php)}</small>
                  </td>
                  <td className="num hgab-lb-col-wide">{n(o.all.rows)}</td>
                  <td className="num hgab-lb-col-wide hgab-mpb-pair"><NepHouse cell={o.all} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <ShowAll total={rows.length} open={open} onOpen={() => setOpen(true)} noun="DPWH offices" />
      <p className="hgab-mpb-foot">
        Not in this table: {php(data.totals.kinds.inserted.house_php - sum)} in inserted lines under Central Office,
        regional offices, lines that changed office and lines with no office. <a href="#no-district">See where it sits</a>.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// By region
// ---------------------------------------------------------------------------

function centralInserted(r: MpbRegion): number {
  return r.central_inserted?.house_php ?? 0;
}

function RegionSection({ data }: { data: MpbData }) {
  const regions = data.regions;
  const insSum = regions.reduce((s, r) => s + r.kinds.inserted.house_php, 0);
  const centralSum = regions.reduce((s, r) => s + centralInserted(r), 0);
  const allSum = regions.reduce((s, r) => s + r.all.rows, 0);
  const noRegion = data.totals.all.rows - allSum;
  const bars = [...regions].sort((a, b) => b.kinds.inserted.house_php - a.kinds.inserted.house_php);
  const max = Math.max(1, ...bars.map((r) => r.kinds.inserted.house_php));

  return (
    <section id="by-region" className="hgab-mpb-section" aria-labelledby="by-region-h">
      <SectionHead
        id="by-region"
        eyebrow="By region"
        title={`${php(insSum)} inserted across ${n(regions.length)} regions; ${php(centralSum)} of it under Central Office`}
      >
        Regions as published on each line. Central Office lines located in a region count in that region.
      </SectionHead>

      <figure className="hgab-mpb-chart">
        <figcaption>
          <span className="hgab-mpb-chart-title">Inserted pesos by region, largest first</span>
          <span className="hgab-mpb-legend">
            <span><i className="hgab-mpb-swatch is-office" aria-hidden="true" />Other DPWH offices</span>
            <span><i className="hgab-mpb-swatch is-central" aria-hidden="true" />Central Office</span>
          </span>
        </figcaption>
        <ol className="hgab-mpb-bars">
          {bars.map((r) => {
            const ins = r.kinds.inserted.house_php;
            const central = centralInserted(r);
            return (
              <li key={r.region}>
                <span className="hgab-mpb-bar-label">
                  <a href={`#region-${r.region}`}>{regionName(r.region)}</a>
                </span>
                <span className="hgab-mpb-bar-track" aria-hidden="true">
                  <span className="is-office" style={{ width: `${((ins - central) / max) * 100}%` }} title={`Other DPWH offices: ${formatPesoFull(ins - central)}`} />
                  <span className="is-central" style={{ width: `${(central / max) * 100}%` }} title={`Central Office: ${formatPesoFull(central)}`} />
                </span>
                <span className="hgab-mpb-bar-val" title={formatPesoFull(ins)}>
                  {php(ins)}
                  <small>{central > 0 ? `${pct(central, ins)} Central Office` : 'no Central Office'}</small>
                </span>
              </li>
            );
          })}
        </ol>
      </figure>

      <TableWrap label="Multi-purpose lines by region">
        <table className="nep-table hgab-lb-table hgab-mpb-table">
          <caption className="visually-hidden">Multi-purpose lines by region, north to south</caption>
          <thead>
            <tr>
              <th scope="col">Region</th>
              <th scope="col" className="num hgab-lb-col-wide">All lines</th>
              <th scope="col" className="num hgab-lb-col-wide">Inserted lines</th>
              <th scope="col" className="num">Inserted</th>
              <th scope="col" className="num is-wrap hgab-lb-col-wide">Of which Central Office</th>
              <th scope="col" className="num is-wrap hgab-lb-col-wide">NEP → House bill</th>
              <th scope="col" className="num is-wrap hgab-lb-col-wide">DPWH offices</th>
              <th scope="col"><span className="visually-hidden">Open the list</span></th>
            </tr>
          </thead>
          <tbody>
            {regions.map((r) => {
              const c = r.kinds.inserted;
              const central = centralInserted(r);
              return (
                <tr key={r.region} id={`region-${r.region}`}>
                  <th scope="row" className="nep-td-name">
                    <strong>{regionName(r.region)}</strong>
                    <span className="nep-code">{regionShort(r.region)}</span>
                  </th>
                  <td className="num hgab-lb-col-wide">{n(r.all.rows)}</td>
                  <td className="num hgab-lb-col-wide">{n(c.rows)}</td>
                  <td className="num hgab-lb-val" title={formatPesoFull(c.house_php)}>
                    {php(c.house_php)}
                    <small className="hgab-lb-phone">{lines(c.rows)} · {pct(central, c.house_php)} Central Office</small>
                  </td>
                  <td className="num hgab-lb-col-wide" title={formatPesoFull(central)}>
                    {php(central)} <small className="hgab-mpb-sub">{lines(r.central_inserted?.rows ?? 0)}</small>
                  </td>
                  <td className="num hgab-lb-col-wide hgab-mpb-pair"><NepHouse cell={r.all} /></td>
                  <td className="num hgab-lb-col-wide">{n(r.offices)}</td>
                  <td className="hgab-lb-go">
                    <Link to={r.href} aria-label={`List the multi-purpose lines in ${regionName(r.region)}`}>List →</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <p className="hgab-mpb-foot">
        {noRegion > 0 ? `${lines(noRegion)} name no region and are not in this table. ` : ''}
        The DPWH offices column counts Central Office once in each region.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// By type and program
// ---------------------------------------------------------------------------

function SliceRows<T extends MpbSlice>({ rows, name }: { rows: T[]; name: (r: T) => ReactNode }) {
  return (
    <tbody>
      {rows.map((r, i) => (
        <tr key={i}>
          <th scope="row" className="nep-td-name">{name(r)}</th>
          <td className="num">{n(r.all.rows)}</td>
          <td className="num hgab-lb-col-wide">{n(r.kinds.inserted.rows)}</td>
          <td className="num hgab-lb-val" title={formatPesoFull(r.kinds.inserted.house_php)}>
            {php(r.kinds.inserted.house_php)}
            <small className="hgab-lb-phone">{lines(r.kinds.inserted.rows)}</small>
          </td>
          <td className="num hgab-lb-col-wide hgab-mpb-pair"><NepHouse cell={r.all} /></td>
        </tr>
      ))}
    </tbody>
  );
}

function SliceHead({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th scope="col">{first}</th>
        <th scope="col" className="num">Lines</th>
        <th scope="col" className="num hgab-lb-col-wide">Inserted lines</th>
        <th scope="col" className="num">Inserted</th>
        <th scope="col" className="num hgab-lb-col-wide">NEP → House bill</th>
      </tr>
    </thead>
  );
}

function TypeSection({ data }: { data: MpbData }) {
  const t = data.totals;
  // Named types by size; "other or not stated" last.
  const subtypes = [...data.subtypes].sort((a, b) => Number(a.key === 'other') - Number(b.key === 'other') || b.all.rows - a.all.rows);
  const programs = [...data.by_program].sort((a, b) => b.all.rows - a.all.rows);
  const topType = subtypes.find((s) => s.key !== 'other');
  const topProg = programs[0];
  const typeSum = subtypes.reduce((s, r) => s + r.all.rows, 0);
  return (
    <section id="by-type" className="hgab-mpb-section" aria-labelledby="by-type-h">
      <SectionHead
        id="by-type"
        eyebrow="By type and program"
        title={topProg
          ? `${n(topProg.all.rows)} of the ${n(t.all.rows)} lines are under the ${topProg.program}`
          : 'By type and program'}
      >
        Types come from the words in each title. Programs are the DPWH programs the lines are published under.
      </SectionHead>
      <div className="nep-two-up hgab-mpb-two">
        <div>
          <h3 className="hgab-mpb-h3">
            By type{topType ? `: “${topType.label}” is named most often, in ${lines(topType.all.rows)}` : ''}
          </h3>
          <TableWrap label="Multi-purpose lines by type">
            <table className="nep-table hgab-lb-table hgab-mpb-table">
              <caption className="visually-hidden">Multi-purpose lines by type, from the title’s words</caption>
              <SliceHead first="Type" />
              <SliceRows rows={subtypes} name={(r) => r.label} />
            </table>
          </TableWrap>
          {typeSum === t.all.rows && <p className="hgab-mpb-foot">Each line counts under one type.</p>}
        </div>
        <div>
          <h3 className="hgab-mpb-h3">By program: {plural(programs.length, 'program', 'programs')}</h3>
          <TableWrap label="Multi-purpose lines by DPWH program">
            <table className="nep-table hgab-lb-table hgab-mpb-table">
              <caption className="visually-hidden">Multi-purpose lines by DPWH program</caption>
              <SliceHead first="Program" />
              <SliceRows rows={programs} name={(r) => r.program} />
            </table>
          </TableWrap>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

function AmountsSection({ data }: { data: MpbData }) {
  const a = data.amounts;
  const top = a.top;
  const max = Math.max(1, ...top.map((b) => b.rows));
  const first = top[0];
  return (
    <section id="amounts" className="hgab-mpb-section" aria-labelledby="amounts-h">
      <SectionHead
        id="amounts"
        eyebrow="Amounts"
        title={first ? `${formatPesoFull(first.php)} is the most common House amount: ${lines(first.rows)}` : 'House amounts'}
      >
        The exact amounts the House bill lists most often, across {lines(a.house_lines)} with a House amount.
      </SectionHead>

      <div className="hgab-mpb-amounts-grid">
        <figure className="hgab-mpb-chart">
          <figcaption>
            <span className="hgab-mpb-chart-title">The {n(top.length)} most common amounts</span>
            <span className="hgab-mpb-legend">
              <span><i className="hgab-mpb-swatch is-house_only" aria-hidden="true" />Inserted</span>
              <span><i className="hgab-mpb-swatch is-rest" aria-hidden="true" />Other lines</span>
            </span>
          </figcaption>
          <ol className="hgab-mpb-bars is-amounts">
            {top.map((b) => (
              <li key={b.php}>
                <span className="hgab-mpb-bar-label is-mono">{formatPesoFull(b.php)}</span>
                <span className="hgab-mpb-bar-track" aria-hidden="true">
                  <span className="is-house_only" style={{ width: `${(b.inserted_rows / max) * 100}%` }} title={`Inserted: ${lines(b.inserted_rows)}`} />
                  <span className="is-rest" style={{ width: `${((b.rows - b.inserted_rows) / max) * 100}%` }} title={`Other lines: ${lines(b.rows - b.inserted_rows)}`} />
                </span>
                <span className="hgab-mpb-bar-val">
                  {lines(b.rows)}
                  <small>{n(b.inserted_rows)} inserted · {pct(b.rows, a.house_lines)}</small>
                </span>
              </li>
            ))}
          </ol>
        </figure>

        <div className="hgab-mpb-round">
          <h3 className="hgab-mpb-h3">Most lines are round amounts</h3>
          <dl className="hgab-mpb-stats">
            <div>
              <dt>Whole millions</dt>
              <dd>{pct(a.multiple_of_1m, a.house_lines)}</dd>
              <small>{n(a.multiple_of_1m)} of {lines(a.house_lines)}</small>
            </div>
            <div>
              <dt>Multiples of ₱500,000</dt>
              <dd>{pct(a.multiple_of_500k, a.house_lines)}</dd>
              <small>{n(a.multiple_of_500k)} of {lines(a.house_lines)}</small>
            </div>
            <div>
              <dt>Middle amount (median)</dt>
              <dd>{a.median_php == null ? '—' : formatPesoFull(a.median_php)}</dd>
              <small>Half the lines are at or below it</small>
            </div>
            <div>
              <dt>9 in 10 lines are at most</dt>
              <dd>{a.p90_php == null ? '—' : formatPesoFull(a.p90_php)}</dd>
              <small>The 90th percentile</small>
            </div>
            <div>
              <dt>Largest House amount</dt>
              <dd>{a.max_php == null ? '—' : formatPesoFull(a.max_php)}</dd>
              <small><a href="#largest">The largest inserted lines</a></small>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lines: repeated titles and the largest inserted lines
// ---------------------------------------------------------------------------

const BASIS_NOTE: Record<string, string> = {
  central: 'In no legislative district',
  regional: 'A regional office; in no legislative district',
  office_change: 'The NEP and the House bill name different offices; in no district',
  no_office: 'In no legislative district',
};

/**
 * The DPWH office a line is listed under, with the legislative district(s) it
 * serves: one district as the district with the office as a small badge; a
 * shared office by name, with the districts it serves; Central Office and the
 * other residual kinds by name, in no district. No representative is named
 * beside a single line.
 */
function LineOffice({ label, basis, group, idx }: { label: string | null; basis: string | null; group: string | null; idx: Index }) {
  const o = (group ? idx.byKey.get(group) : undefined) ?? (label && basis !== 'office_change' ? idx.byLabel.get(label) : undefined);
  if (o && (basis == null || basis === 'office')) {
    const first = o.people[0];
    if (!isShared(o) && first) {
      return (
        <span className="hgab-mpb-lineoffice">
          <span>
            <Link to={first.href}>{first.district}</Link>
            <DeoBadges offices={[label ?? o.offices[0]?.name ?? '']} jurisdiction={first.jurisdiction} />
          </span>
        </span>
      );
    }
    return (
      <span className="hgab-mpb-lineoffice">
        <span>DPWH {deoName(label ?? o.offices[0]?.name ?? '')}</span>
        <small>
          Shared, Tier B: {o.people.map((p, i) => (
            <span key={p.district_id}>{i > 0 && ' · '}<Link to={p.href}>{p.district}</Link></span>
          ))}
        </small>
      </span>
    );
  }
  const kind = basis ?? (label === 'Central Office' ? 'central' : null);
  return (
    <span className="hgab-mpb-lineoffice">
      <span>{label ? `DPWH ${deoName(label)}` : 'No office listed'}</span>
      {kind && BASIS_NOTE[kind] && <small>{BASIS_NOTE[kind]}</small>}
    </span>
  );
}

/**
 * A repeat's title as published: its own `title` when the file carries one, else
 * the first of its lines among the largest, else the normalised (lower-cased) title.
 */
function titleOf(r: { title_norm: string; ids: string[]; title?: string | null }, idx: Index): string {
  if (r.title) return r.title;
  for (const id of r.ids) {
    const t = idx.titleById.get(id);
    if (t) return t;
  }
  return r.title_norm.charAt(0).toUpperCase() + r.title_norm.slice(1);
}

function RepeatsSection({ data, idx }: { data: MpbData; idx: Index }) {
  const [open, setOpen] = useState(false);
  const reps = data.repeats;
  const shown = open ? reps : reps.slice(0, FIRST);
  const extra = reps.reduce((s, r) => s + r.rows, 0);
  return (
    <section id="repeats" className="hgab-mpb-section" aria-labelledby="repeats-h">
      <SectionHead
        id="repeats"
        eyebrow="Same title, same office"
        title={reps.length
          ? `${plural(reps.length, 'title is', 'titles are')} listed more than once under the same DPWH office`
          : 'No title is listed twice under the same DPWH office'}
      >
        {reps.length > 0 && (
          <>
            Together they are {lines(extra)}. Repeats may be phases of one project, or different sites with the same
            title. Open each record to check.
          </>
        )}
      </SectionHead>
      {reps.length > 0 && (
        <>
          <TableWrap label="Titles listed more than once under the same DPWH office">
            <table className="nep-table hgab-lb-table hgab-mpb-table hgab-mpb-lines-table">
              <caption className="visually-hidden">Multi-purpose titles listed more than once under the same DPWH office</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col" className="is-wrap hgab-lb-col-wide">DPWH office · legislative district</th>
                  <th scope="col" className="num is-wrap">Times listed</th>
                  <th scope="col" className="num is-wrap hgab-lb-col-wide">House bill, together</th>
                  <th scope="col">Records</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.office ?? ''}|${r.title_norm}`}>
                    <th scope="row" className="hgab-mpb-title">
                      {titleOf(r, idx)}
                      <span className="hgab-lb-phone"><LineOffice label={r.office} basis={null} group={null} idx={idx} /></span>
                    </th>
                    <td className="hgab-lb-col-wide"><LineOffice label={r.office} basis={null} group={null} idx={idx} /></td>
                    <td className="num">
                      {n(r.rows)}
                      {r.inserted_rows > 0 && <small className="hgab-mpb-sub">{n(r.inserted_rows)} inserted</small>}
                    </td>
                    <td className="num hgab-lb-col-wide" title={formatPesoFull(r.house_php)}>{php(r.house_php)}</td>
                    <td className="hgab-mpb-records">
                      {r.ids.map((id, i) => (
                        <Link key={id} to={recordPath('dpwh', id)} aria-label={`Record ${i + 1} of ${r.ids.length}`}>{i + 1}</Link>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <ShowAll total={reps.length} open={open} onOpen={() => setOpen(true)} noun="titles" />
        </>
      )}
    </section>
  );
}

function UnconfirmedTag({ line }: { line: MpbLine }) {
  if (!line.unconfirmed) return null;
  return (
    <span className="hgab-mpb-flag" title="A possible match in the NEP was found but not confirmed. Counted with the inserted lines.">
      Unconfirmed NEP match
    </span>
  );
}

function LargestSection({ data, idx }: { data: MpbData; idx: Index }) {
  const [open, setOpen] = useState(false);
  const rows = data.largest_inserted;
  const shown = open ? rows : rows.slice(0, FIRST);
  const sum = rows.reduce((s, l) => s + (l.house_php ?? 0), 0);
  const ins = data.totals.kinds.inserted;
  const central = rows.filter((l) => l.basis === 'central').length;
  return (
    <section id="largest" className="hgab-mpb-section" aria-labelledby="largest-h">
      <SectionHead
        id="largest"
        eyebrow="Largest inserted lines"
        title={`The ${n(rows.length)} largest inserted lines: ${php(sum)}, ${pct(sum, ins.house_php)} of inserted pesos`}
      >
        {n(central)} of them are under Central Office. Each title opens the line’s record, with the page it is published on.
      </SectionHead>
      <TableWrap label="The largest inserted multi-purpose lines">
        <table className="nep-table hgab-lb-table hgab-mpb-table hgab-mpb-lines-table">
          <caption className="visually-hidden">The {n(rows.length)} largest inserted multi-purpose lines, by House bill amount</caption>
          <thead>
            <tr>
              <th scope="col" className="num hgab-lb-rank">#</th>
              <th scope="col">Project, as published</th>
              <th scope="col" className="is-wrap hgab-lb-col-wide">DPWH office · legislative district</th>
              <th scope="col" className="hgab-lb-col-wide">Region</th>
              <th scope="col" className="num">House bill</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => (
              <tr key={l.id}>
                <td className="num hgab-lb-rank">{i + 1}</td>
                <th scope="row" className="hgab-mpb-title">
                  <Link to={l.href}>{l.title}</Link>
                  <UnconfirmedTag line={l} />
                  <span className="hgab-lb-phone"><LineOffice label={l.office} basis={l.basis} group={l.group} idx={idx} /></span>
                </th>
                <td className="hgab-lb-col-wide"><LineOffice label={l.office} basis={l.basis} group={l.group} idx={idx} /></td>
                <td className="hgab-lb-region hgab-lb-col-wide">{l.region ? regionName(regionKeyOf(l.region) ?? l.region) : '—'}</td>
                <td className="num hgab-lb-val" title={formatPesoFull(l.house_php)}>{php(l.house_php)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <ShowAll total={rows.length} open={open} onOpen={() => setOpen(true)} noun="lines" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// In no district
// ---------------------------------------------------------------------------

type ResidKind = 'central' | 'regional' | 'office_change' | 'no_office';
const RESIDUAL: ReadonlyArray<{ key: ResidKind; label: string; note: string }> = [
  { key: 'central', label: 'Central Office', note: 'DPWH’s head office. Its lines are in no legislative district.' },
  { key: 'regional', label: 'Regional offices', note: 'Listed under a regional office, not a district office.' },
  { key: 'office_change', label: 'Lines that changed office', note: 'The NEP and the House bill name different offices. Held out of every district.' },
  { key: 'no_office', label: 'Lines with no office', note: 'The source lists these lines under no office.' },
];

function ResidualSection({ data }: { data: MpbData }) {
  const total = data.totals.kinds.inserted;
  const officeSum = data.offices.reduce(
    (s, o) => ({ rows: s.rows + o.kinds.inserted.rows, php: s.php + o.kinds.inserted.house_php }),
    { rows: 0, php: 0 },
  );
  const deo = data.by_office_kind.deo.kinds.inserted;
  const gap = { rows: deo.rows - officeSum.rows, php: deo.house_php - officeSum.php };
  const rows: Array<{ key: string; label: string; note?: string; rows: number; php: number; swatch: string }> = [
    { key: 'deo', label: 'DPWH offices that serve legislative districts', note: 'The office table above.', rows: officeSum.rows, php: officeSum.php, swatch: 'deo' },
  ];
  if (gap.rows || gap.php) {
    rows.push({ key: 'deo-gap', label: 'District office lines in no office group', note: 'Listed under a district office the map links to no district.', rows: gap.rows, php: gap.php, swatch: 'no_office' });
  }
  for (const r of RESIDUAL) {
    const c = data.by_office_kind[r.key].kinds.inserted;
    rows.push({ key: r.key, label: r.label, note: r.note, rows: c.rows, php: c.house_php, swatch: r.key });
  }
  const resid = rows.filter((r) => r.key !== 'deo');
  const residPhp = resid.reduce((s, r) => s + r.php, 0);
  const sumPhp = rows.reduce((s, r) => s + r.php, 0);
  const sumRows = rows.reduce((s, r) => s + r.rows, 0);
  const adds = sumPhp === total.house_php && sumRows === total.rows;
  const all = total.house_php || 1;

  return (
    <section id="no-district" className="hgab-mpb-section" aria-labelledby="no-district-h">
      <SectionHead
        id="no-district"
        eyebrow="Where the rest sits"
        title={`${php(residPhp)} of inserted pesos is in no legislative district: ${pct(residPhp, total.house_php)}`}
      >
        Central Office, regional offices and lines that changed office or name none sit in no district. No
        district or representative is shown beside them.
      </SectionHead>

      <div className="hgab-lb-shift-bar hgab-mpb-residbar" aria-hidden="true">
        {rows.map((r) => r.php > 0 && (
          <span key={r.key} className={`is-${r.swatch}`} style={{ width: `${(r.php / all) * 100}%` }} title={`${r.label}: ${formatPesoFull(r.php)}`} />
        ))}
      </div>

      <TableWrap label="Inserted multi-purpose lines by where they sit">
        <table className="nep-table hgab-lb-table hgab-mpb-table">
          <caption className="visually-hidden">Inserted multi-purpose lines by the kind of DPWH office they are listed under</caption>
          <thead>
            <tr>
              <th scope="col">Listed under</th>
              <th scope="col" className="num">Inserted lines</th>
              <th scope="col" className="num">Inserted</th>
              <th scope="col" className="num is-wrap">Share of inserted pesos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  <span className={`hgab-lb-swatch is-${r.swatch}`} aria-hidden="true" />
                  {r.key === 'deo' ? <a href="#by-office">{r.label}</a> : r.label}
                  {r.note && <small className="hgab-lb-kind-note">{r.note}</small>}
                </th>
                <td className="num">{n(r.rows)}</td>
                <td className="num" title={formatPesoFull(r.php)}>{php(r.php)}</td>
                <td className="num hgab-lb-share">{pct(r.php, total.house_php)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="is-total">
              <th scope="row">All inserted multi-purpose lines</th>
              <td className="num">{n(total.rows)}</td>
              <td className="num" title={formatPesoFull(total.house_php)}>{php(total.house_php)}</td>
              <td className="num">100%</td>
            </tr>
          </tfoot>
        </table>
      </TableWrap>
      <p className="hgab-mpb-foot" data-check={adds ? 'adds-up' : 'differs'}>
        {adds
          ? `These rows add up to the inserted total, ${formatPesoFull(total.house_php)} in ${lines(total.rows)}, to the peso.`
          : `These rows add up to ${formatPesoFull(sumPhp)} in ${lines(sumRows)}; the inserted total is ${formatPesoFull(total.house_php)} in ${lines(total.rows)}.`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// About the figures
// ---------------------------------------------------------------------------

function AboutSection({ data }: { data: MpbData }) {
  const built = data.built_at ? new Date(data.built_at) : null;
  const t = data.totals;
  return (
    <section id="about" className="hgab-mpb-section hgab-mpb-about" aria-labelledby="about-h">
      <h2 id="about-h">About these figures</h2>
      <p className="hgab-mpb-def"><strong>What counts.</strong> {sentenceOf(data.definition)}</p>
      {data.notes.length > 0 && (
        <ul>
          {data.notes.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
      <p>
        The “List” links open the DPWH projects list, searched for “multi”. That search can also show a few titles
        this page does not count, such as “multimedia” or a water project.
      </p>
      <p className="hgab-mpb-actions">
        <a className="hgab-lb-btn is-primary" href={dataUrl(MPB_CSV_PATH)} download={MPB_CSV_NAME}>
          Download the MPB list (CSV)
        </a>
        <Link to={`${HGAB_ROOT}/methodology`}>Methodology: how lines were matched →</Link>
      </p>
      <HgabDetails>
        <dl>
          <dt>Built</dt>
          <dd>{built && !Number.isNaN(built.getTime()) ? built.toLocaleString('en-PH') : '—'}</dd>
          <dt>Source commit</dt>
          <dd><code>{data.source_commit ? data.source_commit.slice(0, 7) : '—'}</code></dd>
          <dt>Lines and records</dt>
          <dd>{n(t.all.rows)} lines; {n(t.all.records)} House records, counting grouped House lines one by one.</dd>
          <dt>House amounts</dt>
          <dd>House Bill 10858, third reading.</dd>
          <dt>Comparison base</dt>
          <dd>
            {n(data.dpwh.rows)} DPWH lines; {n(data.dpwh.inserted_rows)} inserted, worth {formatPesoFull(data.dpwh.inserted_php)}.
          </dd>
        </dl>
      </HgabDetails>
    </section>
  );
}
