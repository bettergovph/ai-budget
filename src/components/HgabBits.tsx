/**
 * Shared chrome and small presentational pieces for the `/hgab` section.
 *
 * Exported names and props are the contract the hub and record pages import
 * (HgabHeader, BridgeStrip, StatusChip, StageAmounts, DisclaimerNotice,
 * HgabLoading, HgabError, DatasetSwitch). Do not change those signatures
 * without updating every caller. Additions — HgabHero, HgabStageStrip,
 * SignedPhp — are conveniences so every page in the section renders the same
 * hero, the same timeline and the same signs. Non-component helpers (labels,
 * status classes, formatters) live in `lib/hgab-ui.ts`.
 *
 * Styles live in `src/hgab.css`, built on the /2027 microsite's tokens.
 */
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import * as fmt from '../lib/format';
import {
  BRIDGE_LABELS, BRIDGE_ORDER, DATASET_ORDER, DATA_BASE_OVERRIDE, HGAB_ROOT, STAGE_LABELS,
  traceInfo, type Bridge, type BridgeGroup, type DatasetKey, type ProjectRow,
} from '../lib/hgab';
import { DATASET_SHORT } from '../lib/hgab-ui';
import '../hgab.css';

const SECTION_NAV: Array<{ to: string; label: string; match?: (path: string) => boolean }> = [
  {
    to: `${HGAB_ROOT}/intro`,
    label: 'Intro',
    match: (p) => p === HGAB_ROOT || p === '/hgab' || p === `${HGAB_ROOT}/intro`,
  },
  { to: `${HGAB_ROOT}/dpwh`, label: 'DPWH' },
  { to: `${HGAB_ROOT}/fmr`, label: 'Farm-to-Market Roads' },
  { to: `${HGAB_ROOT}/hfep`, label: 'Health Facilities' },
  { to: `${HGAB_ROOT}/nia`, label: 'Irrigation' },
  { to: `${HGAB_ROOT}/districts`, label: 'Districts' },
  { to: `${HGAB_ROOT}/sources`, label: 'Sources' },
  { to: `${HGAB_ROOT}/methodology`, label: 'Methodology' },
];

/**
 * Masthead + the section's own sub-nav, mirroring `NepHeader`.
 *
 * The sub-nav is page navigation, so each entry behaves as a tab: the one
 * matching the current route is marked active (`aria-current="page"`). A
 * record page (`/hgab/2027/dpwh/p/…`) counts as its dataset's tab. On
 * desktop the eight tabs sit on one row inside the navy band; on mobile the
 * band scrolls horizontally (site-header.css) and the drawer repeats the
 * links under an "FY2027 HGAB" eyebrow.
 */
export function HgabHeader({
  crumb,
  compiledMeta,
  heroBlend = false,
}: {
  crumb?: ReactNode;
  compiledMeta?: ReactNode;
  heroBlend?: boolean;
}) {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '') || HGAB_ROOT;
  const isActive = (n: (typeof SECTION_NAV)[number]) =>
    n.match ? n.match(path) : path === n.to || path.startsWith(`${n.to}/`);
  const links = SECTION_NAV.map((n) => (
    <Link
      key={n.to}
      to={n.to}
      className={isActive(n) ? 'active' : ''}
      aria-current={isActive(n) ? 'page' : undefined}
    >
      {n.label}
    </Link>
  ));
  return (
    <SiteHeader
      headerClassName={heroBlend ? 'masthead-hero-blend' : undefined}
      crumb={crumb}
      compiledMeta={compiledMeta ?? 'HB 10858 · 2nd & 3rd reading'}
      subNav={<nav className="view-tabs section-tabs" aria-label="FY2027 HGAB sections">{links}</nav>}
      drawerExtras={
        <nav className="nep-drawer-nav hgab-drawer-nav" aria-label="FY2027 HGAB sections">
          <p className="hgab-drawer-eyebrow">House Appropriations Bill 2027</p>
          {links}
        </nav>
      }
    />
  );
}

/**
 * The navy band every page in the section opens with: the story deck's hero
 * at page scale (`.nep-dept-hero`), with a breadcrumb in the eyebrow.
 *
 * `crumb` is the trail after "FY2027 · House Bill 10858" — a string for a
 * leaf page, or nodes with links for a deeper one. Pass `children` for
 * anything that should sit inside the band under the dek (a dataset switch,
 * a stage list).
 */
export function HgabHero({
  crumb,
  title,
  dek,
  note,
  children,
}: {
  crumb: ReactNode;
  title: ReactNode;
  dek?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="nep-dept-hero hgab-hero">
      <div className="nep-dept-hero-inner">
        <p className="nep-dept-hero-eyebrow">
          <span className="hgab-crumb" aria-label="Breadcrumb">
            <span>FY2027</span>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            <Link to={HGAB_ROOT}>House Bill 10858</Link>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            {typeof crumb === 'string' ? <span className="hgab-crumb-here">{crumb}</span> : crumb}
          </span>
        </p>
        <h1 className="nep-dept-hero-title">{title}</h1>
        {dek && <p className="nep-dept-hero-dek">{dek}</p>}
        {note && <p className="nep-dept-hero-note">{note}</p>}
        {children}
      </div>
    </section>
  );
}

/** A peso figure with its sign: "+1.2B", "−340.5M", or "0" for no movement. */
export function SignedPhp({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={`hgab-delta ${className}`.trim()}>—</span>;
  const tone = value > 0 ? 'is-up' : value < 0 ? 'is-down' : '';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return (
    <span className={`hgab-delta ${tone} ${className}`.trim()}>
      {sign}{value === 0 ? '0' : fmt.shortPhp(Math.abs(value))}
    </span>
  );
}

/**
 * The sign each bridge group contributes to House − NEP. The importer stores
 * `php` as a money basis (House side, NEP side, or the signed delta) so the
 * tile prints |php| with the group's sign rather than trusting the stored
 * sign; segment-scope review carries its own sign because it can go either way.
 */
const GROUP_SIGN: Record<BridgeGroup, '+' | '−' | '' | '±'> = {
  house_only: '+',
  nep_only: '−',
  unchanged: '',
  increased: '+',
  decreased: '−',
  scope_review: '±',
};

/**
 * The five-group bridge as a row of tiles, with the identity it satisfies as a
 * footer: house_only − nep_only + increased − decreased + scope_review =
 * House − NEP. Unchanged is shown for scale but contributes zero.
 */
export function BridgeStrip({ bridge, dataset }: { bridge: Bridge; dataset?: DatasetKey }) {
  const houseShort = STAGE_LABELS[bridge.house_stage]?.short ?? 'House';
  return (
    <div className="hgab-bridge-block" data-dataset={dataset}>
      <div className="hgab-bridge" role="list" aria-label="Five-group bridge from NEP to House">
        {BRIDGE_ORDER.map((g) => {
          const cell = bridge[g];
          const meta = BRIDGE_LABELS[g];
          let sign: string = GROUP_SIGN[g];
          if (g === 'scope_review') sign = cell.php > 0 ? '+' : cell.php < 0 ? '−' : '±';
          const bothSides = cell.nep_php != null && cell.house_php != null && g !== 'unchanged';
          return (
            <div className={`hgab-bridge-cell is-${g}`} role="listitem" key={g} title={meta.help}>
              <span className="hgab-bridge-label">{meta.label}</span>
              <span className="hgab-bridge-sub">{meta.sub}</span>
              <span className="hgab-bridge-value">
                {cell.rows === 0 && cell.php === 0 ? '—' : `${sign}${fmt.shortPhp(Math.abs(cell.php))}`}
              </span>
              <span className="hgab-bridge-rows">
                {cell.rows.toLocaleString()} {cell.rows === 1 ? 'row' : 'rows'}
              </span>
              {bothSides && (
                <span className="hgab-bridge-sides">
                  NEP {fmt.shortPhp(cell.nep_php!)} → House {fmt.shortPhp(cell.house_php!)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="hgab-bridge-net">
        <span>
          Net, {houseShort} − NEP: <SignedPhp value={bridge.net_php} />
        </span>
        <span>Insertions − deletions + increases − decreases ± scope review = net</span>
      </p>
    </div>
  );
}

/** Coloured chip for a row's lifecycle status. */
export function StatusChip({ trace }: { trace: string | null | undefined }) {
  const info = traceInfo(trace);
  return (
    <span
      className={`hgab-chip ${info.group ? `is-${info.group}` : ''} ${info.held ? 'is-held' : ''}`.trim()}
      title={info.help || undefined}
      data-trace={trace ?? undefined}
    >
      {info.label}
    </span>
  );
}

/** Compact NEP / HGAB2 / HGAB3 / Transparency amounts for one row. */
export function StageAmounts({ row }: { row: ProjectRow }) {
  const cells: Array<[string, string, number | null]> = [
    [STAGE_LABELS.nep.short, STAGE_LABELS.nep.label, row.nep_php],
    [STAGE_LABELS.hgab2.short, STAGE_LABELS.hgab2.label, row.hgab2_php],
    [STAGE_LABELS.hgab3.short, STAGE_LABELS.hgab3.label, row.hgab3_php],
  ];
  if (row.api_php != null) cells.push([STAGE_LABELS.api.short, STAGE_LABELS.api.label, row.api_php]);
  return (
    <dl className="hgab-stages">
      {cells.map(([k, long, v]) => (
        <div key={k} className={v == null ? 'is-empty' : undefined}>
          <dt title={long}>{k}</dt>
          <dd>{v == null ? '—' : fmt.shortPhp(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The one-paragraph disclaimer every HGAB page carries, with a link to the full text. */
export function DisclaimerNotice({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`hgab-disclaimer ${compact ? 'is-compact' : ''}`.trim()} aria-label="Disclaimer">
      <p className="hgab-disclaimer-eyebrow">Independent and unofficial</p>
      <p>
        This comparison is independent analysis of the printed documents, not an official record of
        DBM, the agencies or the House. Pairings between the NEP and the House bill are candidates
        produced by documented rules, not certified findings; unmatched rows alone do not establish
        that a project was inserted, removed or reduced, and no classification here alleges
        irregularity by any office or official. Figures are printed allocations, not obligations or
        spending.{' '}
        <Link to={`${HGAB_ROOT}/methodology#disclaimer`}>Read the full notice</Link>.
      </p>
    </aside>
  );
}

export function HgabLoading({ what, heroBlend }: { what: string; heroBlend?: boolean }) {
  return (
    <>
      <HgabHeader heroBlend={heroBlend} />
      <main className="nep-main" aria-busy="true">
        <span className="visually-hidden" role="status">Loading {what}…</span>
      </main>
    </>
  );
}

export function HgabError({ message }: { message: string }) {
  return (
    <>
      <HgabHeader />
      <main className="nep-status nep-status-error">
        <p>{message}</p>
        {DATA_BASE_OVERRIDE ? (
          <p className="nep-status-hint">
            The browser is reading assets from <code>{DATA_BASE_OVERRIDE}</code>, set via{' '}
            <code>VITE_DATA_BASE_URL</code>. Publish the <code>hgab/2027/</code> prefix there with{' '}
            <code>npm run upload:hgab</code>, or put <code>VITE_DATA_BASE_URL=</code> in{' '}
            <code>.env.local</code> to serve the locally generated tree from <code>public/data</code>.
          </p>
        ) : (
          <p className="nep-status-hint">
            Assets are being served from the local <code>public/data</code> tree. If{' '}
            <code>data/hgab/2027/</code> is missing, build it with <code>npm run import:hgab</code>.
          </p>
        )}
        <p className="nep-status-hint">
          <Link to={HGAB_ROOT}>Back to the House bill overview</Link>
        </p>
      </main>
    </>
  );
}

/** Dataset switcher used inside hubs so a reader can jump between the four programs. */
export function DatasetSwitch({ current }: { current: DatasetKey }) {
  return (
    <nav className="hgab-dataset-switch" aria-label="Datasets">
      {DATASET_ORDER.map((k) => (
        <Link
          key={k}
          to={`${HGAB_ROOT}/${k}`}
          className={k === current ? 'active' : ''}
          aria-current={k === current ? 'page' : undefined}
        >
          {DATASET_SHORT[k]}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Where the House bill sits in the budget cycle: NEP → hearings → HGAB →
 * Senate → bicameral → GAA. A plain list, no library; the current stage is
 * marked, the ones still to come are dimmed.
 */
export function HgabStageStrip() {
  const stages: Array<{ name: string; meta: string; to?: string; state?: 'done' | 'current' | 'future' }> = [
    { name: 'NEP', meta: 'President’s proposal, August 2026', to: '/2027', state: 'done' },
    { name: 'House hearings', meta: 'Committee on Appropriations briefings', to: '/hearings', state: 'done' },
    { name: 'House bill', meta: 'HB 10858 · 2nd & 3rd reading', state: 'current' },
    { name: 'Senate', meta: 'Committee on Finance, then plenary', state: 'future' },
    { name: 'Bicameral', meta: 'Conference committee reconciles both versions', state: 'future' },
    { name: 'GAA', meta: 'Enacted appropriations · FY2020–2026 so far', to: '/gaa', state: 'future' },
  ];
  return (
    <ol className="hgab-stage-strip" aria-label="Budget stages">
      {stages.map((s) => (
        <li key={s.name} className={s.state === 'current' ? 'is-current' : s.state === 'future' ? 'is-future' : ''}>
          {s.to ? (
            <Link className="hgab-stage-name" to={s.to}>{s.name} →</Link>
          ) : (
            <span className="hgab-stage-name">{s.name}</span>
          )}
          <span className="hgab-stage-meta">{s.meta}</span>
          {s.state === 'current' && <span className="hgab-stage-here">You are here</span>}
        </li>
      ))}
    </ol>
  );
}
