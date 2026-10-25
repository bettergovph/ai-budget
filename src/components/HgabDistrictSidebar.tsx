/**
 * The Districts sidebar: regions north to south, each a disclosure of its
 * districts, with a filter box on top. Used by the list
 * (`/hgab/2027/districts?view=list`) and by every district page.
 *
 * On the list (`mode="list"`) it is a table of contents for the cards: a
 * region button opens that region and scrolls to its section; a district row
 * scrolls to its card, and its arrow opens the district's page. The parent
 * owns the scrolling and the URL (`#region-<key>`, `#d-<district>`); this
 * component only says what was picked. It also watches the region sections
 * (or, in the flat list, the cards) with an IntersectionObserver and keeps
 * the region in view expanded and highlighted. That state lives here, so
 * scrolling re-renders the sidebar and never the 250 cards.
 *
 * On a district page (`mode="page"`) every row is a link to that district's
 * page; the current one is `aria-current="page"` and its region is open.
 *
 * At 1024 px and up it is a sticky column with its own scroll. Below that it
 * is a "Browse regions and districts" button that opens the same tree in a
 * full-height dialog (focus kept inside, Escape and Close, page scroll
 * locked); choosing a district closes it.
 *
 * Figures beside each district are the card's 2027 House bill amount: the
 * office's named projects, undivided. "Shared" marks an office that serves
 * other districts too (Tier B or mixed), so its total is not the district's.
 */
import {
  memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link } from 'react-router-dom';
import * as fmt from '../lib/format';
import { districtPath } from '../lib/hgab';
import {
  districtListHref, regionNames,
  type RegionSectionKey, type SidebarDistrict, type SidebarRegion,
} from '../lib/hgab-districts';
import '../hgab-districts.css';

/** The sidebar is a column from here up, a button and a dialog below. */
const WIDE = '(min-width: 1024px)';

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const SHARED_TITLE = 'Tier B or mixed: the office serves several districts, so this figure is shared and not split.';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DistrictSidebarProps {
  mode: 'list' | 'page';
  /** The tree, memoised by the caller: regions in `REGION_ORDER`, districts by name. */
  regions: readonly SidebarRegion[];
  /** Districts per region before any filter, for "5 of 24". */
  regionSize?: ReadonlyMap<RegionSectionKey, number>;
  /** The filter box. On the list it is the page's search (`q`). */
  query: string;
  onQuery: (q: string) => void;
  /** Enter in the filter box: write the search to the URL now. */
  onCommit?: () => void;
  /** List: the district picked (`#d-…`). Page: the district shown. */
  selectedId: string | null;
  /**
   * The region to open and highlight until the reader scrolls: the selected
   * district's, or the one in `#region-<key>`.
   */
  focusRegion: RegionSectionKey | null;
  /** True when a filter narrows the tree: every region with a match is opened. */
  narrowed?: boolean;
  /** List: the elements to watch for the region in view, in page order (region sections, or cards when flat). */
  track?: ReadonlyArray<{ id: string; region: RegionSectionKey }>;
  /** List: scroll to a region's section. */
  onRegion?: (key: RegionSectionKey) => void;
  /** List: scroll to a district's card. */
  onDistrict?: (district: SidebarDistrict) => void;
}

export default function DistrictSidebar(props: DistrictSidebarProps) {
  const { mode, regions, regionSize, query, onQuery, onCommit, selectedId, focusRegion, narrowed = false, track, onRegion, onDistrict } = props;
  const wide = useWide();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // The sticky column sits under the site masthead (with the section
  // sub-nav), whose height changes with the viewport; publish it as a CSS
  // variable for the column's `top` and the cards' `scroll-margin-top`.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.masthead');
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--hgab-masthead-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--hgab-masthead-h');
    };
  }, []);

  // ---- the region in view ------------------------------------------------
  // `focusRegion` wins until the reader scrolls: the observer's pick is kept
  // with the basis it was made under, so a new pick (or Back) resets it
  // without an effect.
  const basis = `${focusRegion ?? ''}|${selectedId ?? ''}`;
  const basisRef = useRef(basis);
  useEffect(() => { basisRef.current = basis; }, [basis]);
  const [seen, setSeen] = useState<{ basis: string; key: RegionSectionKey | null }>({ basis, key: focusRegion });
  const active = seen.basis === basis ? seen.key ?? focusRegion : focusRegion;

  // While a picked scroll runs, the sections it passes must not take over.
  const lockUntil = useRef(0);
  const holdToken = useRef(0);
  const recompute = useRef<() => void>(() => {});
  const hold = useCallback((key: RegionSectionKey) => {
    const token = ++holdToken.current;
    lockUntil.current = performance.now() + 1500;
    setSeen({ basis: basisRef.current, key });
    const release = () => {
      window.removeEventListener('scrollend', release);
      if (token !== holdToken.current) return;
      lockUntil.current = 0;
      recompute.current();
    };
    window.addEventListener('scrollend', release);
    window.setTimeout(release, 1600);
  }, []);

  useEffect(() => {
    if (!track?.length || typeof IntersectionObserver === 'undefined') return;
    const mast = document.querySelector('.masthead')?.getBoundingClientRect().height ?? 0;
    const order = new Map(track.map((t, i) => [t.id, i] as const));
    const regionOf = new Map(track.map((t) => [t.id, t.region] as const));
    const inBand = new Set<string>();
    const pick = (): RegionSectionKey | null => {
      let best: string | null = null;
      let at = Infinity;
      for (const id of inBand) {
        const i = order.get(id) ?? Infinity;
        if (i < at) { at = i; best = id; }
      }
      return best ? regionOf.get(best) ?? null : null;
    };
    const apply = () => {
      const k = pick();
      if (k) setSeen((s) => (s.basis === basisRef.current && s.key === k ? s : { basis: basisRef.current, key: k }));
    };
    // A band from just under the masthead to 40% down the screen: the first
    // section (or card) crossing it is "here".
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id);
          else inBand.delete(e.target.id);
        }
        if (performance.now() >= lockUntil.current) apply();
      },
      { rootMargin: `-${Math.round(mast + 8)}px 0px -60% 0px`, threshold: 0 },
    );
    for (const t of track) {
      const el = document.getElementById(t.id);
      if (el) io.observe(el);
    }
    recompute.current = apply;
    return () => {
      io.disconnect();
      recompute.current = () => {};
    };
  }, [track]);

  // ---- which regions are open ---------------------------------------------
  // Open: the region in view (or of the picked district), any the reader
  // opened, and every region when a filter narrows the tree. A region the
  // reader closes stays closed until the region in view changes.
  const [opened, setOpened] = useState<ReadonlySet<RegionSectionKey>>(() => new Set());
  const closedBasis = `${active ?? ''}|${narrowed}`;
  const [closed, setClosed] = useState<{ basis: string; keys: ReadonlySet<RegionSectionKey> }>({ basis: closedBasis, keys: new Set() });
  const closedNow = closed.basis === closedBasis ? closed.keys : null;
  const expanded = useMemo(() => {
    const out = new Set<RegionSectionKey>();
    for (const r of regions) {
      if (closedNow?.has(r.key)) continue;
      if (narrowed || opened.has(r.key) || r.key === active) out.add(r.key);
    }
    return out;
  }, [regions, closedNow, narrowed, opened, active]);

  const setOpen = useCallback((key: RegionSectionKey, open: boolean) => {
    setOpened((s) => {
      const n = new Set(s);
      if (open) n.add(key);
      else n.delete(key);
      return n;
    });
    setClosed((c) => {
      const keys = new Set(c.basis === closedBasis ? c.keys : []);
      if (open) keys.delete(key);
      else keys.add(key);
      return { basis: closedBasis, keys };
    });
  }, [closedBasis]);

  // ---- the dialog (below 1024 px) -------------------------------------------
  const [dialogOpen, setDialogOpen] = useState(false);
  const modal = !wide && dialogOpen;
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(true);

  useEffect(() => {
    if (!modal) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overflow, body.style.overflow];
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    restoreFocus.current = true;
    closeRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      html.style.overflow = prev[0];
      body.style.overflow = prev[1];
      if (restoreFocus.current) opener?.focus({ preventScroll: true });
    };
  }, [modal]);

  const closeDialog = useCallback((refocus = true) => {
    restoreFocus.current = refocus;
    setDialogOpen(false);
  }, []);

  const onDialogKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // ---- picks ------------------------------------------------------------------
  const pickRegion = useCallback((key: RegionSectionKey) => {
    hold(key);
    if (modal) closeDialog(false);
    onRegion?.(key);
  }, [hold, modal, closeDialog, onRegion]);

  const pickDistrict = useCallback((d: SidebarDistrict, region: RegionSectionKey) => {
    hold(region);
    if (modal) closeDialog(false);
    onDistrict?.(d);
  }, [hold, modal, closeDialog, onDistrict]);

  /** Desktop list: a closed region opens and scrolls there; an open one closes. In the dialog and on a district page it only opens or closes. */
  const toggleRegion = useCallback((key: RegionSectionKey, isOpen: boolean) => {
    if (isOpen) {
      setOpen(key, false);
      return;
    }
    setOpen(key, true);
    if (mode === 'list' && !modal && onRegion) pickRegion(key);
  }, [setOpen, mode, modal, onRegion, pickRegion]);

  // ---- keep the region in view visible inside the sidebar's own scroll ----
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || box.scrollHeight <= box.clientHeight) return;
    const target = (selectedId && box.querySelector<HTMLElement>(`[data-district="${CSS.escape(selectedId)}"]`))
      || (active && box.querySelector<HTMLElement>(`[data-region="${CSS.escape(active)}"]`));
    if (!target) return;
    const r = target.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top + 4 || r.bottom > b.bottom - 4) box.scrollTop += r.top - b.top - 48;
  }, [active, selectedId, modal, wide]);

  const total = regions.reduce((n, r) => n + r.districts.length, 0);
  const titleId = `hgab-dsb-${uid}-title`;
  const activeName = active ? regionNames(active).name : null;

  const panel = (
    <div
      ref={modal ? dialogRef : undefined}
      className={`hgab-dsb-panel ${modal ? 'is-dialog' : ''}`.trim()}
      role={modal ? 'dialog' : undefined}
      aria-modal={modal ? true : undefined}
      aria-labelledby={modal ? titleId : undefined}
      onKeyDown={modal ? onDialogKey : undefined}
    >
      <div className="hgab-dsb-head">
        <h2 className="hgab-dsb-title" id={titleId}>Regions and districts</h2>
        {modal && (
          <button type="button" className="hgab-dsb-close" ref={closeRef} onClick={() => closeDialog()}>
            Close
          </button>
        )}
      </div>
      <label className="hgab-dsb-find">
        <span>Find a district, member or office</span>
        <input
          type="search"
          className="text-input"
          value={query}
          placeholder="e.g. Bulacan, Cebu 1st, Davao"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommit?.(); }}
        />
      </label>
      <p className="hgab-dsb-key">
        Beside each district: its office’s 2027 House bill amount.{' '}
        <span className="hgab-dsb-shared" title={SHARED_TITLE}>shared</span> means the office serves other districts too.
      </p>
      <div className="hgab-dsb-scroll" ref={scrollRef}>
        <nav aria-label="Regions and districts">
          {total === 0 ? (
            <p className="hgab-dsb-empty">
              No district matches.{' '}
              <button type="button" onClick={() => { onQuery(''); onCommit?.(); }}>Clear the search</button>
            </p>
          ) : (
            <Tree
              uid={uid}
              mode={mode}
              dialog={modal}
              regions={regions}
              regionSize={regionSize}
              expanded={expanded}
              active={active}
              selectedId={selectedId}
              onToggle={toggleRegion}
              onPickRegion={onRegion ? pickRegion : undefined}
              onPickDistrict={pickDistrict}
              onLeave={modal ? closeDialog : undefined}
            />
          )}
        </nav>
      </div>
    </div>
  );

  if (wide) return <aside className="hgab-dsb">{panel}</aside>;
  return (
    <aside className="hgab-dsb is-narrow">
      <button
        type="button"
        ref={openerRef}
        className="hgab-dsb-opener"
        aria-haspopup="dialog"
        aria-expanded={dialogOpen}
        onClick={() => setDialogOpen(true)}
      >
        <span>Browse regions and districts</span>
        {activeName && <small>{activeName}</small>}
      </button>
      {modal && panel}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

function plainClick(e: ReactMouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * Regions → districts as nested lists. Memoised: typing in the filter box
 * re-renders the sidebar shell, and the 254 rows only when the tree, the
 * open regions or the current item change.
 */
const Tree = memo(function Tree({
  uid, mode, dialog, regions, regionSize, expanded, active, selectedId, onToggle, onPickRegion, onPickDistrict, onLeave,
}: {
  uid: string;
  mode: 'list' | 'page';
  dialog: boolean;
  regions: readonly SidebarRegion[];
  regionSize?: ReadonlyMap<RegionSectionKey, number>;
  expanded: ReadonlySet<RegionSectionKey>;
  active: RegionSectionKey | null;
  selectedId: string | null;
  onToggle: (key: RegionSectionKey, isOpen: boolean) => void;
  /** Absent in the flat list, which has no region sections to scroll to. */
  onPickRegion?: (key: RegionSectionKey) => void;
  onPickDistrict: (d: SidebarDistrict, region: RegionSectionKey) => void;
  /** In the dialog: a link that leaves the page closes it first. */
  onLeave?: (refocus?: boolean) => void;
}) {
  return (
    <ul className="hgab-dsb-regions">
      {regions.map((r) => {
        const names = regionNames(r.key);
        const open = expanded.has(r.key);
        const here = active === r.key;
        const listId = `hgab-dsb-${uid}-${r.key}`;
        const n = r.districts.length;
        const size = regionSize?.get(r.key) ?? n;
        return (
          <li key={r.key} className={`hgab-dsb-r ${here ? 'is-active' : ''} ${open ? 'is-open' : ''}`.trim()}>
            <button
              type="button"
              className="hgab-dsb-r-btn"
              data-region={r.key}
              aria-expanded={open}
              aria-controls={listId}
              aria-current={mode === 'list' && here ? 'location' : undefined}
              title={`${names.full}: ${n === size ? n : `${n} of ${size}`} ${size === 1 ? 'district' : 'districts'}`}
              onClick={() => onToggle(r.key, open)}
            >
              <span className="hgab-dsb-chev" aria-hidden="true" />
              <span className="hgab-dsb-r-name">{names.name}</span>
              <span className="hgab-dsb-r-n">
                {n === size ? n : <>{n}<small> of {size}</small></>}
                <span className="visually-hidden"> {size === 1 ? 'district' : 'districts'}</span>
              </span>
            </button>
            <ul className="hgab-dsb-ds" id={listId} hidden={!open}>
              {open && mode === 'list' && dialog && onPickRegion && (
                <li className="hgab-dsb-d is-go">
                  <a
                    href={`#${r.anchor}`}
                    onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); onPickRegion(r.key); }}
                  >
                    Go to the {n.toLocaleString()} {n === 1 ? 'card' : 'cards'} in {names.name}
                  </a>
                </li>
              )}
              {open && r.districts.map((d) => (
                <DistrictRow key={d.id} d={d} region={r.key} mode={mode} current={selectedId === d.id} onPick={onPickDistrict} onLeave={onLeave} />
              ))}
              {open && mode === 'page' && (
                <li className="hgab-dsb-d is-go">
                  <Link to={districtListHref(r.anchor)} onClick={() => onLeave?.(false)}>
                    All {size.toLocaleString()} in {names.name}, as cards →
                  </Link>
                </li>
              )}
            </ul>
          </li>
        );
      })}
    </ul>
  );
});

function Amount({ d }: { d: SidebarDistrict }) {
  if (d.none) return <span className="hgab-dsb-amt is-none" title="No district engineering office found, so no figure">no office</span>;
  return (
    <span className="hgab-dsb-amt">
      <span title={d.hgab3_php == null ? 'No House bill figure' : `2027 House bill: ${fmt.php(d.hgab3_php, { unit: 'full' })}`}>
        {d.hgab3_php == null ? '—' : fmt.php(d.hgab3_php)}
      </span>
      {d.shared && <span className="hgab-dsb-shared" title={SHARED_TITLE}>shared</span>}
    </span>
  );
}

function DistrictRow({ d, region, mode, current, onPick, onLeave }: {
  d: SidebarDistrict;
  region: RegionSectionKey;
  mode: 'list' | 'page';
  current: boolean;
  onPick: (d: SidebarDistrict, region: RegionSectionKey) => void;
  onLeave?: (refocus?: boolean) => void;
}) {
  const cls = `hgab-dsb-d ${current ? 'is-current' : ''}`.trim();
  if (mode === 'page') {
    return (
      <li className={cls} data-district={d.id}>
        <Link className="hgab-dsb-d-go" to={districtPath(d.id)} aria-current={current ? 'page' : undefined} onClick={() => onLeave?.(false)}>
          <span className="hgab-dsb-d-name">{d.label}</span>
          <Amount d={d} />
        </Link>
      </li>
    );
  }
  return (
    <li className={cls} data-district={d.id} data-anchor={d.anchor}>
      <a
        className="hgab-dsb-d-go"
        href={`#${d.anchor}`}
        aria-current={current ? 'location' : undefined}
        onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); onPick(d, region); }}
      >
        <span className="hgab-dsb-d-name">{d.label}</span>
        <Amount d={d} />
      </a>
      <Link
        className="hgab-dsb-d-open"
        to={districtPath(d.id)}
        aria-label={`Open the page for ${d.label}`}
        title="Open the district’s page"
        onClick={() => onLeave?.(false)}
      >
        <span aria-hidden="true">→</span>
      </Link>
    </li>
  );
}
