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
 *
 * "Browse by: District · Office" (`by=office`) puts each region's districts
 * under the office group that serves them (`officeGroups`): the office's name,
 * its tier and its whole-office 2027 House bill amount, then its districts,
 * which carry no figure of their own. Districts with no office sit in a "No
 * district office" group. On the list an office row filters the cards to
 * that group (`office=`); on a district page it opens that filtered list.
 */
import {
  memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link } from 'react-router-dom';
import * as fmt from '../lib/format';
import {
  NO_OFFICE_GROUP_NAME, districtListHref, districtPageHref, officeGroupTierShort, officeListHref, regionNames,
  type DistrictBrowse, type RegionSectionKey, type SidebarDistrict, type SidebarOffice, type SidebarRegion,
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
const OFFICE_AMOUNT_TITLE = 'The office’s 2027 House bill amount, named projects only. It belongs to the whole office and is not split between its districts.';
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
  /** How the tree is organised; in office mode `regions` carry `offices` (`sidebarOfficeRegions`). */
  by?: DistrictBrowse;
  /** Shows the "Browse by" switch. */
  onBy?: (by: DistrictBrowse) => void;
  /** List: the office group the cards are filtered to (`OfficeGroup.id`), marked in the tree. */
  activeOffice?: string | null;
  /** List: filter the cards to an office group and scroll to them. */
  onOffice?: (office: SidebarOffice) => void;
}

export default function DistrictSidebar(props: DistrictSidebarProps) {
  const {
    mode, regions, regionSize, query, onQuery, onCommit, selectedId, focusRegion, narrowed = false, track, onRegion, onDistrict,
    by = 'district', onBy, activeOffice = null, onOffice,
  } = props;
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

  const pickOffice = useCallback((o: SidebarOffice, region: RegionSectionKey) => {
    hold(region);
    if (modal) closeDialog(false);
    onOffice?.(o);
  }, [hold, modal, closeDialog, onOffice]);

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
      || (activeOffice && box.querySelector<HTMLElement>(`[data-office="${CSS.escape(activeOffice)}"]`))
      || (active && box.querySelector<HTMLElement>(`[data-region="${CSS.escape(active)}"]`));
    if (!target) return;
    // A district under an office row brings that row into view with it.
    const lead = target.matches('.hgab-dsb-d') ? target.closest<HTMLElement>('.hgab-dsb-o') ?? target : target;
    const r = target.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top + 4 || r.bottom > b.bottom - 4) box.scrollTop += lead.getBoundingClientRect().top - b.top - 48;
  }, [active, selectedId, activeOffice, by, modal, wide]);

  const total = regions.reduce((n, r) => n + r.districts.length, 0);
  const titleId = `hgab-dsb-${uid}-title`;
  const byOffice = by === 'office';
  const activeOfficeName = byOffice && activeOffice
    ? regions.flatMap((r) => r.offices ?? []).find((o) => o.id === activeOffice)?.name ?? null
    : null;
  const activeName = activeOfficeName ?? (active ? regionNames(active).name : null);
  const title = byOffice ? 'Regions and offices' : 'Regions and districts';

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
        <h2 className="hgab-dsb-title" id={titleId}>{title}</h2>
        {modal && (
          <button type="button" className="hgab-dsb-close" ref={closeRef} onClick={() => closeDialog()}>
            Close
          </button>
        )}
      </div>
      {onBy && <BrowseToggle by={by} onBy={onBy} />}
      <label className="hgab-dsb-find">
        <span>Find a district, member or office</span>
        <input
          type="search"
          className="text-input"
          value={query}
          placeholder={byOffice ? 'e.g. Abra DEO, Cebu 1st, Davao' : 'e.g. Bulacan, Cebu 1st, Davao'}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommit?.(); }}
        />
      </label>
      {byOffice ? (
        <p className="hgab-dsb-key">
          Each region lists its district engineering offices (DEOs) and the districts each serves. Amounts are the
          office’s 2027 House bill total, <span className="hgab-dsb-shared" title={OFFICE_AMOUNT_TITLE}>not split</span>.
        </p>
      ) : (
        <p className="hgab-dsb-key">
          Beside each district: its office’s 2027 House bill amount.{' '}
          <span className="hgab-dsb-shared" title={SHARED_TITLE}>shared</span> means the office serves other districts too.
        </p>
      )}
      <div className="hgab-dsb-scroll" ref={scrollRef}>
        <nav aria-label={title}>
          {total === 0 ? (
            <p className="hgab-dsb-empty">
              No district matches.{' '}
              <button type="button" onClick={() => { onQuery(''); onCommit?.(); }}>Clear the search</button>
            </p>
          ) : (
            <Tree
              uid={uid}
              mode={mode}
              by={by}
              dialog={modal}
              regions={regions}
              regionSize={regionSize}
              expanded={expanded}
              active={active}
              selectedId={selectedId}
              activeOffice={activeOffice}
              onToggle={toggleRegion}
              onPickRegion={onRegion ? pickRegion : undefined}
              onPickDistrict={pickDistrict}
              onPickOffice={onOffice ? pickOffice : undefined}
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
        <span>{byOffice ? 'Browse regions and offices' : 'Browse regions and districts'}</span>
        {activeName && <small>{activeName}</small>}
      </button>
      {modal && panel}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// "Browse by: District · Office"
// ---------------------------------------------------------------------------

/** Two pressed-state buttons: the tree (and, on the list, the cards) by district or under their office. */
function BrowseToggle({ by, onBy }: { by: DistrictBrowse; onBy: (by: DistrictBrowse) => void }) {
  return (
    <div className="hgab-dsb-by" role="group" aria-label="Browse by">
      <span className="hgab-dsb-by-label" aria-hidden="true">Browse by</span>
      <span className="hgab-dsb-by-seg">
        <button type="button" aria-pressed={by === 'district'} onClick={() => onBy('district')} title="Every district under its region">
          District
        </button>
        <button
          type="button"
          aria-pressed={by === 'office'}
          onClick={() => onBy('office')}
          title="Districts under the district engineering office (DEO) that serves them"
        >
          Office
        </button>
      </span>
    </div>
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
  uid, mode, by, dialog, regions, regionSize, expanded, active, selectedId, activeOffice, onToggle, onPickRegion, onPickDistrict,
  onPickOffice, onLeave,
}: {
  uid: string;
  mode: 'list' | 'page';
  by: DistrictBrowse;
  dialog: boolean;
  regions: readonly SidebarRegion[];
  regionSize?: ReadonlyMap<RegionSectionKey, number>;
  expanded: ReadonlySet<RegionSectionKey>;
  active: RegionSectionKey | null;
  selectedId: string | null;
  activeOffice: string | null;
  onToggle: (key: RegionSectionKey, isOpen: boolean) => void;
  /** Absent in the flat list, which has no region sections to scroll to. */
  onPickRegion?: (key: RegionSectionKey) => void;
  onPickDistrict: (d: SidebarDistrict, region: RegionSectionKey) => void;
  /** List: filter the cards to an office group. */
  onPickOffice?: (o: SidebarOffice, region: RegionSectionKey) => void;
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
              {open && by === 'office' && r.offices
                ? r.offices.map((o) => (
                  <OfficeRow
                    key={o.id}
                    o={o}
                    region={r.key}
                    mode={mode}
                    selectedId={selectedId}
                    filtered={activeOffice === o.id}
                    onPick={onPickOffice}
                    onPickDistrict={onPickDistrict}
                    onLeave={onLeave}
                  />
                ))
                : open && r.districts.map((d) => (
                  <DistrictRow key={d.id} d={d} region={r.key} mode={mode} by={by} current={selectedId === d.id} onPick={onPickDistrict} onLeave={onLeave} />
                ))}
              {open && mode === 'page' && (
                <li className="hgab-dsb-d is-go">
                  <Link to={districtListHref(r.anchor, by)} onClick={() => onLeave?.(false)}>
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

/**
 * An office group and the districts it serves. The row itself filters the
 * list to the group (list) or opens that filtered list (district page); the
 * districts under it behave like the district-mode rows, without a figure:
 * the office's amount is the group's, not any one district's. The no-office
 * group is a plain label over its districts.
 */
function OfficeRow({ o, region, mode, selectedId, filtered, onPick, onPickDistrict, onLeave }: {
  o: SidebarOffice;
  region: RegionSectionKey;
  mode: 'list' | 'page';
  selectedId: string | null;
  filtered: boolean;
  onPick?: (o: SidebarOffice, region: RegionSectionKey) => void;
  onPickDistrict: (d: SidebarDistrict, region: RegionSectionKey) => void;
  onLeave?: (refocus?: boolean) => void;
}) {
  const current = selectedId != null && o.districts.some((d) => d.id === selectedId);
  const cls = `hgab-dsb-o is-${o.tier ?? 'none'} ${filtered ? 'is-filter' : ''} ${current ? 'is-current' : ''}`.replace(/\s+/g, ' ').trim();
  const n = o.size;
  const amount = o.hgab3_php == null ? 'no House bill figure' : `2027 House bill ${fmt.php(o.hgab3_php)}, whole office${o.tier === 'B' ? ', not split' : ''}`;
  const shown = o.districts.length < n ? `, ${o.districts.length} of ${n} shown` : '';
  const body = (
    <>
      <span className="hgab-dsb-o-name" title={o.title}>{o.name}</span>
      <span className="hgab-dsb-o-meta">
        {o.tier && (
          <span className="hgab-dsb-o-amt" title={o.hgab3_php == null ? 'No House bill figure' : `${OFFICE_AMOUNT_TITLE} ${fmt.php(o.hgab3_php, { unit: 'full' })}.`}>
            {o.hgab3_php == null ? '—' : fmt.php(o.hgab3_php)}
            <small>whole office</small>
          </span>
        )}
        <span className={`hgab-dsb-o-tier is-${o.tier ?? 'none'}`}>{officeGroupTierShort(o.tier, n)}</span>
      </span>
    </>
  );
  const districts = (
    <ul className="hgab-dsb-ds hgab-dsb-o-ds" aria-label={`Districts served by ${o.name}`}>
      {o.districts.map((d) => (
        <DistrictRow key={d.id} d={d} region={region} mode={mode} by="office" bare current={selectedId === d.id} onPick={onPickDistrict} onLeave={onLeave} />
      ))}
    </ul>
  );
  if (!o.tier || !o.param) {
    return (
      <li className={cls} data-office={o.id}>
        <span className="hgab-dsb-o-go is-static" title="We found no district engineering office (DEO) for these districts, so there is no figure.">
          <span className="hgab-dsb-o-name">{NO_OFFICE_GROUP_NAME}</span>
          <span className="hgab-dsb-o-meta"><span className="hgab-dsb-o-tier is-none">no figure</span></span>
        </span>
        {districts}
      </li>
    );
  }
  const label = mode === 'page'
    ? `${o.name}: see its ${n === 1 ? 'district' : `${n} districts`} as cards${current ? ' (this district’s office)' : ''}. ${amount}.`
    : `${o.name}: show only ${n === 1 ? 'its district' : `its ${n} districts`}${shown}. ${amount}.`;
  return (
    <li className={cls} data-office={o.id}>
      {mode === 'page' ? (
        <Link className="hgab-dsb-o-go" to={officeListHref(o.param)} aria-label={label} onClick={() => onLeave?.(false)}>
          {body}
        </Link>
      ) : (
        <a
          className="hgab-dsb-o-go"
          href={officeListHref(o.param)}
          aria-label={label}
          aria-current={filtered ? 'true' : undefined}
          onClick={(e) => { if (!plainClick(e) || !onPick) return; e.preventDefault(); onPick(o, region); }}
        >
          {body}
        </a>
      )}
      {districts}
    </li>
  );
}

function DistrictRow({ d, region, mode, by, bare = false, current, onPick, onLeave }: {
  d: SidebarDistrict;
  region: RegionSectionKey;
  mode: 'list' | 'page';
  by: DistrictBrowse;
  /** Under an office row: no figure, which is the office's. */
  bare?: boolean;
  current: boolean;
  onPick: (d: SidebarDistrict, region: RegionSectionKey) => void;
  onLeave?: (refocus?: boolean) => void;
}) {
  const cls = `hgab-dsb-d ${current ? 'is-current' : ''}`.trim();
  if (mode === 'page') {
    return (
      <li className={cls} data-district={d.id}>
        <Link className="hgab-dsb-d-go" to={districtPageHref(d.id, by)} aria-current={current ? 'page' : undefined} onClick={() => onLeave?.(false)}>
          <span className="hgab-dsb-d-name">{d.label}</span>
          {!bare && <Amount d={d} />}
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
        {!bare && <Amount d={d} />}
      </a>
      <Link
        className="hgab-dsb-d-open"
        to={districtPageHref(d.id, by)}
        aria-label={`Open the page for ${d.label}`}
        title="Open the district’s page"
        onClick={() => onLeave?.(false)}
      >
        <span aria-hidden="true">→</span>
      </Link>
    </li>
  );
}
