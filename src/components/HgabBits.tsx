/**
 * Shared chrome and small presentational pieces for the `/hgab` section.
 *
 * Exported names and props are the contract the hub and record pages import
 * (HgabHeader, BridgeStrip, StatusChip, StageAmounts, DisclaimerNotice,
 * HgabLoading, HgabError, DatasetSwitch). Do not change those signatures
 * without updating every caller. Additions — HgabHero, HgabStageStrip,
 * SignedPhp, HgabDetails, Caveats, WhatThisMeans — are conveniences so every
 * page in the section renders the same hero, the same timeline, the same signs
 * and the same "plain first, details on demand" furniture. Non-component
 * helpers (labels, status classes, formatters) live in `lib/hgab-ui.ts`.
 *
 * Copy rule for everything here: the reader is a citizen or reporter who has
 * never opened a budget document. Anything technical goes inside
 * `HgabDetails` ("Details for analysts"), never on the surface.
 *
 * Styles live in `src/hgab.css`, built on the /2027 microsite's tokens.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import * as fmt from '../lib/format';
import {
  BRIDGE_LABELS, BRIDGE_ORDER, DATASET_ORDER, DATA_BASE_OVERRIDE, HGAB_ROOT, STAGE_LABELS,
  datasetPath, traceInfo, type Bridge, type BridgeGroup, type DatasetKey, type ProjectRow,
} from '../lib/hgab';
import { DATASET_SHORT, DISTRICT_VIEWS, PLAIN, PROGRAM_NAV, districtsView, hubViews } from '../lib/hgab-ui';
import '../hgab.css';

/**
 * Section entries that are plain links (programs and Districts are dropdowns,
 * see PROGRAM_NAV). The first is Intro; the rest follow Districts, in order.
 */
const SECTION_LINKS: Array<{ to: string; label: string; match?: (path: string) => boolean }> = [
  {
    to: `${HGAB_ROOT}/intro`,
    label: 'Intro',
    match: (p) => p === HGAB_ROOT || p === '/hgab' || p === `${HGAB_ROOT}/intro`,
  },
  { to: `${HGAB_ROOT}/leaderboard`, label: 'Leaderboards' },
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
  const { pathname, search } = useLocation();
  const path = pathname.replace(/\/+$/, '') || HGAB_ROOT;
  const view = new URLSearchParams(search).get('view') ?? 'overview';
  const linkActive = (n: (typeof SECTION_LINKS)[number]) =>
    n.match ? n.match(path) : path === n.to || path.startsWith(`${n.to}/`);
  const programActive = (key: DatasetKey) => path === `${HGAB_ROOT}/${key}` || path.startsWith(`${HGAB_ROOT}/${key}/`);
  const link = (n: (typeof SECTION_LINKS)[number]) => (
    <Link key={n.to} to={n.to} className={linkActive(n) ? 'active' : ''} aria-current={linkActive(n) ? 'page' : undefined}>
      {n.label}
    </Link>
  );
  const [intro, ...rest] = SECTION_LINKS;
  // Districts: an overview, the list, and each district's page (which counts as the list).
  const districtsActive = path === `${HGAB_ROOT}/districts` || path.startsWith(`${HGAB_ROOT}/districts/`);
  const districtsKey = !districtsActive ? null
    : path !== `${HGAB_ROOT}/districts` ? 'list'
    : districtsView(new URLSearchParams(search));
  return (
    <SiteHeader
      headerClassName={heroBlend ? 'masthead-hero-blend' : undefined}
      crumb={crumb}
      compiledMeta={compiledMeta ?? 'House Bill 10858 · 2nd and 3rd reading'}
      subNav={
        <nav className="view-tabs section-tabs hgab-subnav" aria-label="FY2027 House bill sections">
          {link(intro)}
          {PROGRAM_NAV.map((p) => (
            <SectionMenu
              key={p.key}
              label={p.label}
              items={hubViews(p.hasReadings).map((v) => ({ key: v.key, label: v.label, to: datasetPath(p.key, v.key) }))}
              active={programActive(p.key)}
              currentKey={programActive(p.key) && path === `${HGAB_ROOT}/${p.key}` ? view : null}
            />
          ))}
          <SectionMenu
            label="Districts"
            items={DISTRICT_VIEWS.map((v) => ({ key: v.key, label: v.label, to: v.to }))}
            active={districtsActive}
            currentKey={districtsKey}
          />
          {rest.map(link)}
        </nav>
      }
      drawerExtras={
        <nav className="nep-drawer-nav hgab-drawer-nav" aria-label="FY2027 House bill sections">
          <p className="hgab-drawer-eyebrow">The House bill for 2027</p>
          {link(intro)}
          {PROGRAM_NAV.map((p) => (
            <div className="hgab-drawer-group" key={p.key}>
              <Link
                to={datasetPath(p.key)}
                className={programActive(p.key) ? 'active' : ''}
                aria-current={programActive(p.key) && view === 'overview' ? 'page' : undefined}
              >
                {p.label}
              </Link>
              <div className="hgab-drawer-sub">
                {hubViews(p.hasReadings).filter((v) => v.key !== 'overview').map((v) => {
                  const on = programActive(p.key) && view === v.key;
                  return (
                    <Link key={v.key} to={datasetPath(p.key, v.key)} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined}>
                      {v.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="hgab-drawer-group">
            <Link to={`${HGAB_ROOT}/districts`} className={districtsActive ? 'active' : ''} aria-current={districtsKey === 'overview' ? 'page' : undefined}>
              Districts
            </Link>
            <div className="hgab-drawer-sub">
              {DISTRICT_VIEWS.filter((v) => v.key !== 'overview').map((v) => (
                <Link key={v.key} to={v.to} className={districtsKey === v.key ? 'active' : ''} aria-current={districtsKey === v.key ? 'page' : undefined}>
                  {v.label}
                </Link>
              ))}
            </div>
          </div>
          {rest.map(link)}
        </nav>
      }
    />
  );
}

/**
 * One sub-nav entry (a program, or Districts): a button that opens a menu of its views.
 *
 * The sub-nav scrolls sideways on phones, which would clip an absolutely
 * positioned menu, so the panel is fixed to the viewport at the button's
 * position and closes on scroll, resize, Escape, an outside press, or any
 * navigation (it is keyed to the location, so a route change closes it
 * without an effect). Pointers that can hover open it on hover as well.
 */
function SectionMenu({
  label,
  items,
  active,
  currentKey,
}: {
  label: string;
  items: ReadonlyArray<{ key: string; label: string; to: string }>;
  active: boolean;
  /** The item being shown when this section is open, else null. */
  currentKey: string | null;
}) {
  const location = useLocation();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const menuId = useId();
  const open = openAt === location.key;

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 232;
    setPos({ top: Math.round(r.bottom + 6), left: Math.round(Math.max(8, Math.min(r.left - 12, window.innerWidth - width - 8))) });
  }, []);
  const show = useCallback(() => { place(); setOpenAt(location.key); }, [place, location.key]);
  const hide = useCallback(() => setOpenAt(null), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { hide(); btnRef.current?.focus(); }
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, hide]);

  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); }, []);

  const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const onEnter = () => {
    if (!canHover()) return;
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (!open) show();
  };
  const onLeave = () => {
    if (!canHover()) return;
    hoverTimer.current = window.setTimeout(hide, 180);
  };

  return (
    <span className={`hgab-subnav-item ${open ? 'is-open' : ''}`.trim()} ref={wrapRef} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        ref={btnRef}
        type="button"
        className={active ? 'active' : ''}
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={active ? 'true' : undefined}
        onClick={() => (open ? hide() : show())}
      >
        {label}
        <span className="hgab-subnav-caret" aria-hidden="true">▾</span>
      </button>
      <span
        id={menuId}
        className="hgab-subnav-menu"
        hidden={!open}
        style={pos ? { top: pos.top, left: pos.left } : undefined}
      >
        {items.map((v) => {
          const on = currentKey === v.key;
          return (
            <Link key={v.key} to={v.to} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined}>
              {v.label}
            </Link>
          );
        })}
      </span>
    </span>
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
  compact = false,
}: {
  crumb: ReactNode;
  title: ReactNode;
  dek?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
  /**
   * Subpages: breadcrumb, title and a short line on the page itself, with no
   * navy band. The landing pages (intro, overview) keep the full band.
   */
  compact?: boolean;
}) {
  const trail = (
    <span className="hgab-crumb" aria-label="Breadcrumb">
      <span>FY2027</span>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <Link to={HGAB_ROOT}>House Bill 10858</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      {typeof crumb === 'string' ? <span className="hgab-crumb-here">{crumb}</span> : crumb}
    </span>
  );
  if (compact) {
    return (
      <header className="hgab-pagehead">
        <div className="hgab-pagehead-inner">
          <p className="page-eyebrow">{trail}</p>
          <h1 className="page-title">{title}</h1>
          {dek && <p className="page-dek">{dek}</p>}
          {note && <p className="hgab-pagehead-note">{note}</p>}
          {children}
        </div>
      </header>
    );
  }
  return (
    <section className="nep-dept-hero hgab-hero">
      <div className="nep-dept-hero-inner">
        <p className="nep-dept-hero-eyebrow">{trail}</p>
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
 * Collapsed-by-default box for everything a reader does not need but an
 * analyst will ask for: page ranges, codes, extraction method, matching
 * keys, SQL. Quiet by design (hgab.css `.hgab-details`); the surface above it
 * must already make sense without opening it.
 */
export function HgabDetails({
  title = 'Details for analysts',
  children,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`hgab-details ${className}`.trim()}>
      <summary>{title}</summary>
      <div className="hgab-details-body">{children}</div>
    </details>
  );
}

/** Short bulleted note of things to know before comparing the numbers; renders nothing when empty. */
export function Caveats({ items, className = '' }: { items: readonly string[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={`hgab-caveats ${className}`.trim()} aria-label="Before you compare">
      {items.map((c) => <li key={c}>{c}</li>)}
    </ul>
  );
}

/** One line of plain explanation under a chart or strip: "What this means: …". */
export function WhatThisMeans({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`hgab-whatmeans ${className}`.trim()}>
      <strong>What this means:</strong> {children}
    </p>
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
 * How the two versions differ, as a row of six tiles (the five-group bridge),
 * with the identity it satisfies as a footer: house_only − nep_only +
 * increased − decreased + scope_review = House − NEP. Unchanged is shown for
 * scale but contributes zero. Every tile carries the group's plain label, its
 * `sub` and its help as a tooltip. Pass `explain` on the first strip of a page
 * to print the one-line "What this means" under it.
 */
/** What one tile row counts, per program, so tiles say "projects" rather than "rows". */
const BRIDGE_ROW_NOUN: Record<DatasetKey, [string, string]> = {
  dpwh: ['project', 'projects'],
  fmr: ['road', 'roads'],
  hfep: ['facility line', 'facility lines'],
  nia: ['project', 'projects'],
};

export function BridgeStrip({ bridge, dataset, explain = false }: { bridge: Bridge; dataset?: DatasetKey; explain?: boolean }) {
  // Only DPWH prints two House readings that differ; the other three programs
  // print one House list, identical at second and third reading.
  const houseShort = dataset && dataset !== 'dpwh'
    ? 'House bill'
    : bridge.house_stage === 'hgab3' ? 'House bill (3rd reading)' : 'House bill (2nd reading)';
  const nepShort = 'the NEP';
  const [oneRow, manyRows] = dataset ? BRIDGE_ROW_NOUN[dataset] : ['line', 'lines'];
  return (
    <div className="hgab-bridge-block" data-dataset={dataset}>
      <div className="hgab-bridge" role="list" aria-label="How the House bill differs from the NEP, in six groups">
        {BRIDGE_ORDER.map((g) => {
          const cell = bridge[g];
          const meta = BRIDGE_LABELS[g];
          let sign: string = GROUP_SIGN[g];
          if (g === 'scope_review') sign = cell.php > 0 ? '+' : cell.php < 0 ? '−' : '±';
          const bothSides = cell.rows > 0 && cell.nep_php != null && cell.house_php != null && g !== 'unchanged';
          return (
            <div className={`hgab-bridge-cell is-${g}`} role="listitem" key={g} title={meta.help}>
              <span className="hgab-bridge-label">{meta.label}</span>
              <span className="hgab-bridge-sub">{meta.sub}</span>
              <span className="hgab-bridge-value">
                {cell.rows === 0 && cell.php === 0 ? '—' : `${sign}${fmt.shortPhp(Math.abs(cell.php))}`}
              </span>
              <span className="hgab-bridge-rows">
                {cell.rows.toLocaleString()} {cell.rows === 1 ? oneRow : manyRows}
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
          {houseShort} minus {nepShort}: <SignedPhp value={bridge.net_php} />
        </span>
        <span title="The six groups add up to the difference between the two versions">
          House only − NEP only + raised − reduced ± different stretches = this difference
        </span>
      </p>
      {explain && <WhatThisMeans>{PLAIN.bridgeMeans}</WhatThisMeans>}
    </div>
  );
}

/** Coloured chip saying what happened to a line, with the plain meaning as a tooltip. */
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

/** Compact amounts for one row in each version: NEP, House 2R, House 3R and, for DPWH, the transparency site. */
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

/** The one-paragraph notice every page in the section carries, in plain words, with a link to the full text. */
export function DisclaimerNotice({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`hgab-disclaimer ${compact ? 'is-compact' : ''}`.trim()} aria-label="Disclaimer">
      <p className="hgab-disclaimer-eyebrow">Independent and unofficial</p>
      <p>
        This comparison is our own reading of the published documents. It is not an official record of
        the budget department, the agencies or the House. Matches between the NEP and
        the House bill are candidates found by written rules, not confirmed findings. A line found in
        only one document does not prove a project was added, dropped or cut. Nothing here says any
        office or official did anything wrong. Figures are the amounts published in the documents, not
        money spent.{' '}
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

/** Program switcher used inside hubs so a reader can jump between the four programs. */
export function DatasetSwitch({ current }: { current: DatasetKey }) {
  return (
    <nav className="hgab-dataset-switch" aria-label="Programs">
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
 * Where the House bill sits in the budget cycle: NEP → hearings → House bill →
 * Senate → bicameral → GAA. A plain list, no library; the current step is
 * marked, the ones still to come are dimmed. Every acronym is expanded.
 */
export function HgabStageStrip() {
  const stages: Array<{ name: string; meta: string; to?: string; state?: 'done' | 'current' | 'future' }> = [
    { name: 'NEP', meta: 'Submitted by the President to Congress, August 2026', to: '/2027', state: 'done' },
    { name: 'House hearings', meta: 'Agencies answer questions on their budgets', to: '/hearings', state: 'done' },
    { name: 'House bill', meta: 'HB 10858 · voted on twice (2nd and 3rd reading)', state: 'current' },
    { name: 'Senate', meta: 'Its own committee, then a floor vote', state: 'future' },
    { name: 'Bicameral', meta: 'Both chambers settle on one text', state: 'future' },
    { name: 'Enacted budget (GAA)', meta: 'Signed into law · FY2020–2026 so far', to: '/gaa', state: 'future' },
  ];
  return (
    <ol className="hgab-stage-strip" aria-label="Steps of the budget process">
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
