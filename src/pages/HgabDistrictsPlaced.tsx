/**
 * `/hgab/2027/districts?view=list-legislative` — the projects placed in each legislative district. Jason
 * (2026-11-03): map every project to a place, as the multi-purpose buildings map does, and list them by district,
 * "a similar view [to `?view=list`] but their own individual district".
 *
 * One card per legislative district with its own 2027 DPWH lines: those the source workbench's location lens places
 * there, by the place the title names or by an office that serves that district alone (data/hgab/2027/locations.json,
 * lib/hgab-locations.ts; the card figures in lib/hgab-placed.ts). The office list (`?view=list`) gives each district
 * its office's whole figure, shared and not split; here each line counts once, in the district its title names, and
 * lines that name no district stay with their office, said above the cards and listed by reason at the foot.
 *
 * Copy (docs/hgab-copy.md): "placed", never "located" or the representative's. A placement is where the documents put
 * the work: not a verified site, and nothing about who asked for it. NEP and House bill amounts are compared, never
 * added. Search, region, sort and grouping live in the URL; `#region-<key>` and `#d-<district>` say where the reader
 * is, as on the office list, so Back from a district page returns to its card.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { Fy27Headline, Portrait, RepresentativeBlock } from '../components/HgabDistrictBits';
import DistrictSidebar from '../components/HgabDistrictSidebar';
import * as fmt from '../lib/format';
import { HGAB_SOURCE_REPO, PLAIN_TERMS, districtPath, loadHgabLocations, regionKeyOf, type DistrictCard, type HgabDistrictIndex } from '../lib/hgab';
import { DEO_MEANING } from '../lib/hgab-leaderboard';
import {
  districtAnchor, districtAnchorFromHash, districtListHref, districtRegionKey, filterDistricts, groupDistrictsByRegion,
  regionAnchor, regionFilterKey, regionFromHash, regionNames, regionOptionLabel, regionsOf,
  type RegionGroup, type RegionSectionKey, type SidebarDistrict, type SidebarRegion,
} from '../lib/hgab-districts';
import { LOCATION_BASIS_LABELS, type DistrictLocated, type LocatedCell, type LocationsData } from '../lib/hgab-locations';
import {
  PLACED_KIND_ROWS, PLACED_SORT_KEYS, PLACED_SORT_LABELS, kindPhp, paramsFromPlacedFilters, placedFiltersFromParams,
  placedNet, placedTotals, sortPlaced, type PlacedFilters, type PlacedKind, type PlacedSortKey,
} from '../lib/hgab-placed';
import '../hgab-districts.css';
import '../hgab-districts-placed.css';

/** Cards drawn before "Show more" in the flat list. */
const PAGE = 60;
/** Cards per region before "Show all" when the grouped list would draw more than PAGE. */
const REGION_PREVIEW = 3;
/** When a filter leaves this few districts, the sidebar opens every region. */
const NARROW = 40;

const SOURCES_LINE = 'SOURCE: NEP 2027 · HOUSE BILL 10858, THIRD READING · THE SOURCE WORKBENCH’S LOCATION LENS · PSGC2LEG · BILLS.JURIS.PH';

/** The office bridge's colour classes, by kind (hgab-districts.css `.is-house_only` …). */
const KIND_CLASS: Record<PlacedKind, string> = {
  inserted: 'house_only', dropped: 'nep_only', increased: 'increased', decreased: 'decreased', scope_review: 'scope_review', unchanged: 'unchanged',
};

const OFFICE_LABELS: Record<keyof DistrictLocated['by_office'], string> = {
  own: 'its own DPWH office',
  other_deo: 'another district office',
  central: 'the DPWH Central Office',
  regional: 'a DPWH regional office',
};

function plainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function projects(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'project' : 'projects'}`;
}

/** "+₱315.6M", "−₱25.0M", "₱688.8M"; "—" when the kind is empty. */
function kindAmount(sign: string, rows: number, php: number): string {
  if (!rows && !php) return '—';
  const s = sign === '±' ? (php > 0 ? '+' : php < 0 ? '−' : '±') : sign;
  return `${s}${fmt.php(Math.abs(php))}`;
}

export default function DistrictsPlaced({ index }: { index: HgabDistrictIndex }) {
  const [data, setData] = useState<LocationsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadHgabLocations().then(setData).catch((e) => setErr(String(e?.message || e)));
  }, []);
  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="where each 2027 project is placed" />;
  return <PlacedList index={index} data={data} />;
}

function PlacedList({ index, data }: { index: HgabDistrictIndex; data: LocationsData }) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => placedFiltersFromParams(params), [params]);
  // Written from the address bar as it is at write time (the router's params can lag a quick second change).
  const update = useCallback(
    (patch: Partial<PlacedFilters>) => {
      const current = placedFiltersFromParams(new URLSearchParams(window.location.search));
      setParams(paramsFromPlacedFilters({ ...current, ...patch }), { replace: true });
    },
    [setParams],
  );

  // The search box shows what you type at once; the URL follows 250 ms after a pause (as on the office list).
  const urlQ = filters.q;
  const [draft, setDraft] = useState(urlQ);
  const written = useRef(urlQ);
  useEffect(() => {
    if (urlQ !== written.current) {
      written.current = urlQ;
      setDraft(urlQ);
    }
  }, [urlQ]);
  useEffect(() => {
    const next = draft.trim();
    if (next === written.current) return;
    const t = setTimeout(() => {
      written.current = next;
      update({ q: next });
    }, 250);
    return () => clearTimeout(t);
  }, [draft, update]);
  const commitDraft = () => {
    written.current = draft.trim();
    update({ q: draft.trim() });
  };

  const placed = useMemo(() => new Map(data.districts.map((d) => [d.district, d] as const)), [data]);
  const totals = useMemo(() => placedTotals(data), [data]);
  const regionOptions = useMemo(() => regionsOf(index), [index]);
  const filtered = useMemo(() => filterDistricts(index, { q: filters.q, region: filters.region, tier: '', office: '' }), [index, filters.q, filters.region]);
  const visible = useMemo(() => sortPlaced(filtered, placed, filters.sort), [filtered, placed, filters.sort]);
  const grouped = filters.group;
  const groups = useMemo<RegionGroup[]>(() => (grouped ? groupDistrictsByRegion(visible) : []), [grouped, visible]);
  const regionSize = useMemo(() => {
    const m = new Map<RegionSectionKey, number>();
    for (const d of index.districts) m.set(districtRegionKey(d), (m.get(districtRegionKey(d)) ?? 0) + 1);
    return m;
  }, [index]);
  const tree = useMemo<SidebarRegion[]>(
    () => groupDistrictsByRegion(filtered).map((g) => ({
      key: g.key,
      anchor: regionAnchor(g.key),
      districts: g.cards
        .map<SidebarDistrict>((c) => ({
          id: c.id, label: c.label, anchor: districtAnchor(c.id), hgab3_php: placed.get(c.id)?.all.house_php ?? null,
          shared: false, none: false, placed: true,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true })),
    })),
    [filtered, placed],
  );
  const byAnchor = useMemo(() => new Map(index.districts.map((d) => [districtAnchor(d.id), d] as const)), [index]);

  // Where the reader is: `#region-<key>` or `#d-<district>`.
  const { hash } = useLocation();
  const navigate = useNavigate();
  const hashRegion = regionFromHash(hash);
  const hashAnchor = districtAnchorFromHash(hash);
  const hashCard = hashAnchor ? byAnchor.get(hashAnchor) ?? null : null;
  const hashCardRegion = hashCard ? districtRegionKey(hashCard) : null;
  const hashCardHidden = hashCard != null && !visible.some((c) => c.id === hashCard.id);

  // How many of `visible` the flat list draws, keyed to the filters so a new search starts again from the top.
  const filtersKey = `${filters.q}|${filters.region}|${filters.sort}`;
  const [reveal, setReveal] = useState({ key: filtersKey, limit: PAGE });
  const baseLimit = reveal.key === filtersKey ? reveal.limit : PAGE;
  const hashIdx = hashCard && !grouped ? visible.findIndex((c) => c.id === hashCard.id) : -1;
  const reach = (i: number) => Math.ceil((i + 1) / PAGE) * PAGE;
  const limit = hashIdx >= baseLimit ? reach(hashIdx) : baseLimit;
  const shown = useMemo(() => visible.slice(0, limit), [visible, limit]);
  const hidden = visible.length - shown.length;

  // Which regions show every card when grouped (kept across a re-sort).
  const openKey = `${filters.q}|${filters.region}`;
  const [open, setOpen] = useState<{ key: string; regions: RegionSectionKey[]; all: boolean }>({ key: openKey, regions: [], all: false });
  const opened = open.key === openKey ? open : { key: openKey, regions: [] as RegionSectionKey[], all: false };
  const openRegion = (k: RegionSectionKey) =>
    setOpen({ key: openKey, regions: opened.regions.includes(k) ? opened.regions : [...opened.regions, k], all: opened.all });
  const previewing = grouped && !opened.all && visible.length > PAGE;
  const regionLimit = (k: RegionSectionKey) =>
    previewing && !opened.regions.includes(k) && hashRegion !== k && hashCardRegion !== k ? REGION_PREVIEW : null;

  // Scroll to the hash on load, from the sidebar and on Back; a picked card is highlighted and its heading focused.
  useEffect(() => {
    const h = window.history;
    const prev = h.scrollRestoration;
    h.scrollRestoration = 'manual';
    return () => { h.scrollRestoration = prev; };
  }, []);
  const navType = useNavigationType();
  const mounted = useRef(false);
  const smooth = useRef(false);
  const picked = useRef(false);
  const scrollTo = useCallback((el: HTMLElement, isCard: boolean, glide: boolean, focus: boolean) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const near = Math.abs(el.getBoundingClientRect().top) < 3 * window.innerHeight;
    el.scrollIntoView({ block: 'start', behavior: glide && near && !reduce ? 'smooth' : 'auto' });
    if (!isCard) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 2000);
    if (focus) el.querySelector<HTMLElement>('.hgab-dc-district')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const id = hashCard ? districtAnchor(hashCard.id) : hashRegion ? regionAnchor(hashRegion) : hash === '#not-placed' ? 'not-placed' : null;
    const el = id ? document.getElementById(id) : null;
    if (el) scrollTo(el, Boolean(hashCard), smooth.current, picked.current);
    else if (mounted.current && navType === 'POP' && !hash) window.scrollTo(0, 0);
    mounted.current = true;
    smooth.current = false;
    picked.current = false;
  }, [hash, hashCard, hashRegion, navType, scrollTo]);

  const goRegion = useCallback((k: RegionSectionKey) => {
    const id = regionAnchor(k);
    if (window.location.hash === `#${id}`) {
      const el = document.getElementById(id);
      if (el) scrollTo(el, false, true, false);
      return;
    }
    smooth.current = true;
    navigate({ search: window.location.search, hash: id });
  }, [navigate, scrollTo]);
  const goDistrict = useCallback((d: SidebarDistrict) => {
    if (!grouped) {
      const i = visible.findIndex((c) => c.id === d.id);
      if (i >= baseLimit) setReveal({ key: filtersKey, limit: reach(i) });
    }
    if (window.location.hash === `#${d.anchor}`) {
      const el = document.getElementById(d.anchor);
      if (el) scrollTo(el, true, true, true);
      return;
    }
    smooth.current = true;
    picked.current = true;
    navigate({ search: window.location.search, hash: d.anchor });
  }, [grouped, visible, baseLimit, filtersKey, navigate, scrollTo]);

  // Before a link leaves for a district page, write that card into the list's address, so Back returns to it.
  const rememberCard = (e: MouseEvent<HTMLElement>) => {
    if (!plainClick(e)) return;
    const a = (e.target as HTMLElement).closest('a[href]');
    if (!a || !a.getAttribute('href')?.startsWith(`${districtPath()}/`)) return;
    const anchor = a.closest<HTMLElement>('.hgab-dc[id]')?.id;
    if (!anchor || window.location.hash === `#${anchor}`) return;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${anchor}`);
  };

  const track = useMemo(
    () => (grouped
      ? groups.map((g) => ({ id: regionAnchor(g.key), region: g.key }))
      : shown.map((c) => ({ id: districtAnchor(c.id), region: districtRegionKey(c) }))),
    [grouped, groups, shown],
  );

  const filtering = Boolean(filters.q.trim() || filters.region);
  const narrowed = filtering && (tree.length <= 3 || filtered.length <= NARROW);
  const clear = () => update({ q: '', region: '' });
  const regionKey = regionFilterKey(filters.region);
  const regionValue = regionKey ? regionOptions.find((r) => regionKeyOf(r) === regionKey) ?? filters.region : filters.region;
  const term = (text: string) => <span className="hgab-dx-term" title={PLAIN_TERMS.candidate.meaning}>{text}</span>;
  const off = totals.total.house_php - totals.placed.house_php;
  const offShare = totals.total.house_php ? off / totals.total.house_php : null;
  const sortPhrase = (k: PlacedSortKey) => PLACED_SORT_LABELS[k].charAt(0).toLowerCase() + PLACED_SORT_LABELS[k].slice(1);

  const chips: Array<{ key: string; label: string; value: string; remove: () => void }> = [];
  if (filters.q.trim()) chips.push({ key: 'q', label: 'Search', value: `“${filters.q.trim()}”`, remove: () => update({ q: '' }) });
  if (filters.region) chips.push({ key: 'region', label: 'Region', value: regionKey ? regionNames(regionKey).name : filters.region, remove: () => update({ region: '' }) });

  return (
    <>
      <HgabHeader
        crumb={<><Link to={districtPath()}>Districts</Link> › Legislative Districts</>}
        compiledMeta={`${index.districts.length.toLocaleString()} districts · ${totals.total.rows.toLocaleString()} DPWH projects`}
      />

      <HgabHero
        compact
        crumb={
          <>
            <Link to={districtPath()}>Districts</Link>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            <span className="hgab-crumb-here">Legislative Districts</span>
          </>
        }
        title="Legislative Districts"
        dek={
          <>
            One card per legislative district, with the 2027 DPWH projects placed in it: by the place the project’s title
            names, or by a DPWH office that serves only that district. Each project counts once. A shared office’s
            projects go to the districts their titles name, so no figure is shared.
          </>
        }
        note={
          <>
            A placement is where the documents put the work. It is not a verified site, and it says nothing about who
            asked for a project. The representative shown holds the seat in the 20th Congress; nothing here says or
            implies that a representative requested, sponsored or controlled a project. {DEO_MEANING}
          </>
        }
      />

      <main className="nep-main hgab-dx-listmain">
        {offShare != null && (
          <p className="hgab-dx-offcard">
            <strong>{fmt.pct(1 - offShare, 1)}</strong> of DPWH money in the 2027 House bill is placed in one district.
            The other <strong>{fmt.pct(offShare, 1)}</strong> ({fmt.php(off)}) is placed in none: it stays with an office
            that serves several districts, sits at its region, or is held for review.{' '}
            <a href="#not-placed" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); navigate({ search: window.location.search, hash: 'not-placed' }); }}>
              See why →
            </a>
          </p>
        )}

        <div className="hgab-dx-layout" onClickCapture={rememberCard}>
          <DistrictSidebar
            mode="list"
            figure="placed"
            regions={tree}
            regionSize={regionSize}
            query={draft}
            onQuery={setDraft}
            onCommit={commitDraft}
            selectedId={hashCard?.id ?? null}
            focusRegion={hashCardRegion ?? hashRegion ?? null}
            narrowed={narrowed}
            track={track}
            onRegion={grouped ? goRegion : undefined}
            onDistrict={goDistrict}
          />

          <div className="hgab-dx-content">
            <div className="nep-explore-controls hgab-dx-controls">
              <label className="hgab-dx-search">
                <span>Search</span>
                <input
                  className="text-input"
                  type="search"
                  placeholder="district, representative, office…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); }}
                  aria-label="Search districts, representatives and offices"
                />
              </label>
              <label>
                <span>Region</span>
                <select className="select-input" value={regionValue} onChange={(e) => update({ region: e.target.value })}>
                  <option value="">All regions</option>
                  {regionOptions.map((r) => <option key={r} value={r}>{regionOptionLabel(r)}</option>)}
                  {regionValue && !regionOptions.includes(regionValue) && <option value={regionValue}>{regionValue}</option>}
                </select>
              </label>
              <label>
                <span>Sort by</span>
                <select className="select-input" value={filters.sort} onChange={(e) => update({ sort: e.target.value as PlacedSortKey })}>
                  {PLACED_SORT_KEYS.map((k) => <option key={k} value={k}>{PLACED_SORT_LABELS[k]}</option>)}
                </select>
              </label>
              <label className="hgab-dx-toggle">
                <input type="checkbox" checked={grouped} onChange={(e) => update({ group: e.target.checked })} />
                <span>Group by region</span>
              </label>
            </div>

            <div className="hgab-dx-results" id="hgab-dx-results">
              {chips.length > 0 && (
                <div className="hgab-ds-chips hgab-dx-chips" role="group" aria-label="Active filters">
                  {chips.map((c) => (
                    <span key={c.key} className="hgab-ds-chip">
                      <em>{c.label}</em>
                      {c.value}
                      <button type="button" aria-label={`Remove the ${c.label.toLowerCase()} filter: ${c.value}`} title="Remove this filter" onClick={c.remove}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <p className="hgab-dx-count" role="status">
                <span><strong>{visible.length.toLocaleString()}</strong> of {index.districts.length.toLocaleString()} districts</span>
                {grouped && groups.length > 0 && <span>· in {groups.length} {groups.length === 1 ? 'region' : 'regions'}</span>}
                {previewing && (
                  <span>
                    · the first {REGION_PREVIEW} in each region shown{' '}
                    <button type="button" onClick={() => setOpen({ key: openKey, regions: opened.regions, all: true })}>Show every district</button>
                  </span>
                )}
                {!grouped && hidden > 0 && <span>· showing the first {shown.length.toLocaleString()}</span>}
                <span>· sorted by {sortPhrase(filters.sort)}{grouped ? ' within each region' : ''}</span>
                {filters.sort !== 'name' && <span>· districts with nothing placed come last</span>}
                {filtering && <button type="button" onClick={clear}>Clear filters</button>}
              </p>
            </div>

            <p className="hgab-dx-lede">
              The NEP is the budget the President submits to Congress each August. A 2027 project “not in the NEP” is
              an {term('insertion candidate')}. One “in the NEP only” is a {term('deletion candidate')}. Both are leads
              to check, not findings. For each office’s whole figure, see the <Link to={districtListHref()}>office list</Link>.
            </p>

            {hashCardHidden && (
              <p className="hgab-dx-hiddencard" role="status">
                {hashCard.label} is hidden by the filters.{' '}
                <button type="button" className="nep-more" onClick={clear}>Clear filters</button>{' '}
                or <Link to={districtPath(hashCard.id)}>open its page</Link>.
              </p>
            )}

            <h2 className="visually-hidden" id="hgab-dx-cards-title" tabIndex={-1}>District cards</h2>
            {visible.length === 0 ? (
              <p className="hgab-dx-empty">
                No district matches these filters.{' '}
                <button type="button" className="nep-more" onClick={clear}>Clear filters</button>
              </p>
            ) : grouped ? (
              groups.map((g) => (
                <PlacedRegion
                  key={g.key}
                  group={g}
                  placed={placed}
                  size={regionSize.get(g.key) ?? g.cards.length}
                  limit={regionLimit(g.key)}
                  onOpen={() => openRegion(g.key)}
                />
              ))
            ) : (
              <>
                <div className="hgab-dx-grid">
                  {shown.map((card) => <PlacedCard key={card.id} card={card} d={placed.get(card.id)} level={3} />)}
                </div>
                {hidden > 0 && (
                  <p className="hgab-dx-more">
                    <button type="button" className="nep-more" onClick={() => setReveal({ key: filtersKey, limit: limit + PAGE })}>
                      Show {Math.min(PAGE, hidden).toLocaleString()} more
                    </button>
                    <button type="button" className="nep-more" onClick={() => setReveal({ key: filtersKey, limit: visible.length })}>
                      Show all {visible.length.toLocaleString()}
                    </button>
                    <span>{hidden.toLocaleString()} more {hidden === 1 ? 'district matches' : 'districts match'}. Search, or pick one in the list of regions.</span>
                  </p>
                )}
              </>
            )}

            <NotPlaced data={data} />

            <p className="hgab-dx-note">
              Card figures add up the 2027 DPWH projects placed in each district, as the NEP and the House bill
              (third reading) list them. The two sit side by side; they are never added. A region’s totals add its
              districts’ projects, each counted once. A card’s “Projects” link opens the district’s page, which lists
              them one by one.
            </p>

            <DisclaimerNotice compact placements />
            <PlacedDetails data={data} />
          </div>
        </div>
      </main>
      <SiteFooter source={SOURCES_LINE} />
    </>
  );
}

// ---------------------------------------------------------------------------
// One region
// ---------------------------------------------------------------------------

function PlacedRegion({ group, placed, size, limit, onOpen }: {
  group: RegionGroup;
  placed: ReadonlyMap<string, DistrictLocated>;
  /** Every district in the region, before filters. */
  size: number;
  limit: number | null;
  onOpen: () => void;
}) {
  const names = regionNames(group.key);
  const anchor = regionAnchor(group.key);
  const cards = limit == null ? group.cards : group.cards.slice(0, limit);
  const rest = group.cards.length - cards.length;
  const n = group.cards.length;
  const sum = useMemo(() => group.cards.reduce(
    (a, c) => {
      const d = placed.get(c.id);
      return d ? { rows: a.rows + d.all.rows, nep_php: a.nep_php + d.all.nep_php, house_php: a.house_php + d.all.house_php } : a;
    },
    { rows: 0, nep_php: 0, house_php: 0 } as LocatedCell,
  ), [group.cards, placed]);
  return (
    <section className="hgab-dx-region" id={anchor} aria-labelledby={`${anchor}-title`}>
      <header className="hgab-dx-region-head">
        <h3 id={`${anchor}-title`}>
          <span className="hgab-dx-region-short">{names.short}</span> · {names.name}
        </h3>
        <p className="hgab-dx-region-sum">
          <span>{n === size ? n.toLocaleString() : `${n.toLocaleString()} of ${size.toLocaleString()}`} {size === 1 ? 'district' : 'districts'}</span>
          <span>{projects(sum.rows)} placed</span>
          <span>2027 NEP <strong title={fmt.php(sum.nep_php, { unit: 'full' })}>{fmt.php(sum.nep_php)}</strong></span>
          <span>2027 House bill <strong title={fmt.php(sum.house_php, { unit: 'full' })}>{fmt.php(sum.house_php)}</strong></span>
          <span className="hgab-dx-region-basis">the projects placed in these districts</span>
        </p>
      </header>
      <div className="hgab-dx-grid">
        {cards.map((card) => <PlacedCard key={card.id} card={card} d={placed.get(card.id)} level={4} />)}
      </div>
      {rest > 0 && (
        <p className="hgab-dx-region-more">
          <button type="button" className="nep-more" onClick={onOpen}>Show all {n.toLocaleString()} districts in {names.name}</button>
          <span>{rest.toLocaleString()} more</span>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/**
 * One legislative district: who holds the seat, then the 2027 projects placed in it, NEP → House bill with the net
 * change, a bar of how much moved in each kind of change (cuts hatched), every kind with its count and pesos, and how
 * the projects were placed and which offices list them. Memoised: the grid draws up to 254 of these.
 */
const PlacedCard = memo(function PlacedCard({ card, d, level }: { card: DistrictCard; d: DistrictLocated | undefined; level: 3 | 4 }) {
  const rep = card.representative;
  const ambiguous = rep?.status === 'ambiguous';
  const hid = `hgab-dp-${card.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const Heading = level === 4 ? 'h4' : 'h3';
  const regionKey = districtRegionKey(card);
  return (
    <article className="hgab-dc hgab-dp" id={districtAnchor(card.id)} aria-labelledby={hid}>
      <header className="hgab-dc-head">
        {!ambiguous && <Portrait rep={rep} />}
        <div className="hgab-dc-title">
          <p className="hgab-dc-eyebrow">
            <span title={card.region ?? undefined}>{regionKey === 'other' ? card.region ?? 'Region not recorded' : regionNames(regionKey).name}</span>
          </p>
          <Heading className="hgab-dc-district" id={hid} tabIndex={-1}>
            <Link to={districtPath(card.id)}>{card.label}</Link>
          </Heading>
          <RepresentativeBlock rep={rep} />
        </div>
      </header>

      {d ? <PlacedPanel d={d} /> : (
        <p className="hgab-dc-br-empty hgab-dp-none">
          No 2027 DPWH project is placed in this district. Its office’s projects name other places, or none.
        </p>
      )}

      <footer className="hgab-card-ctas">
        <Link className="hgab-cta hgab-cta-primary" to={districtPath(card.id)}>Open district →</Link>
        {d && (
          <Link className="hgab-cta" to={`${districtPath(card.id)}#located`} title={`The ${projects(d.all.rows)} placed in ${card.label}, one by one`}>
            Projects
          </Link>
        )}
        {!ambiguous && rep?.juris_url && (
          <a className="hgab-cta hgab-cta-quiet" href={rep.juris_url} target="_blank" rel="noopener noreferrer" title="Bills and profile on bills.juris.ph">More Info ↗</a>
        )}
      </footer>
    </article>
  );
});

function PlacedPanel({ d }: { d: DistrictLocated }) {
  const net = placedNet(d);
  const moving = PLACED_KIND_ROWS.filter((r) => r.kind !== 'unchanged');
  const moved = moving.reduce((a, r) => a + Math.abs(kindPhp(r.kind, d.kinds[r.kind])), 0);
  const barLabel = moving.map((r) => `${r.label} ${kindAmount(r.sign, d.kinds[r.kind].rows, kindPhp(r.kind, d.kinds[r.kind]))}`).join(', ');
  const offices = (Object.keys(OFFICE_LABELS) as Array<keyof DistrictLocated['by_office']>).filter((k) => d.by_office[k].rows > 0);
  return (
    <div className="hgab-dc-br hgab-dp-panel">
      <p className="hgab-dp-count">{projects(d.all.rows)}</p>
      <Fy27Headline nep={d.all.nep_php} hgab3={d.all.house_php} net={net} scope="The 2027 DPWH projects placed in this district, NEP against the House bill" />
      {moved > 0 && (
        <span className="hgab-dc-br-bar" role="img" aria-label={`How the House bill differs from the NEP: ${barLabel}`}>
          {moving.map((r) => {
            const v = Math.abs(kindPhp(r.kind, d.kinds[r.kind]));
            return v > 0 ? <span key={r.kind} className={`is-${KIND_CLASS[r.kind]}`} style={{ width: `${(v / moved) * 100}%` }} /> : null;
          })}
        </span>
      )}
      <dl className="hgab-dc-br-grid">
        {PLACED_KIND_ROWS.map((r) => {
          const cell = d.kinds[r.kind];
          return (
            <div key={r.kind} className={`hgab-dc-br-cell is-${KIND_CLASS[r.kind]} ${cell.rows ? '' : 'is-zero'}`.trim()}>
              <dt>
                {r.label}
                <small>{r.sub}</small>
              </dt>
              <dd>
                <strong>{kindAmount(r.sign, cell.rows, kindPhp(r.kind, cell))}</strong>
                <span>{projects(cell.rows)}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="hgab-dp-how">
        <p className="hgab-dp-how-head">Placed by <small>House bill</small></p>
        <ul>
          {(['title_psgc', 'deo_to_leg'] as const).filter((b) => d.by_basis[b].rows > 0).map((b) => (
            <li key={b} title={LOCATION_BASIS_LABELS[b].plain}>
              <span>{b === 'title_psgc' ? 'the place the title names' : 'an office that serves only here'}</span>
              <strong title={fmt.php(d.by_basis[b].house_php, { unit: 'full' })}>{fmt.php(d.by_basis[b].house_php)}</strong>
              <small>{d.by_basis[b].rows.toLocaleString()}</small>
            </li>
          ))}
        </ul>
        <p className="hgab-dp-how-head">Listed under <small>House bill</small></p>
        <ul>
          {offices.map((k) => (
            <li key={k}>
              <span>{OFFICE_LABELS[k]}</span>
              <strong title={fmt.php(d.by_office[k].house_php, { unit: 'full' })}>{fmt.php(d.by_office[k].house_php)}</strong>
              <small title={projects(d.by_office[k].rows)}>{d.by_office[k].rows.toLocaleString()}</small>
            </li>
          ))}
        </ul>
      </div>
      <p className="hgab-dc-br-note">
        Candidates are leads to check, not findings. Insertion candidates include lines whose NEP match is unconfirmed.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What is placed in no single district
// ---------------------------------------------------------------------------

function NotPlaced({ data }: { data: LocationsData }) {
  const t = placedTotals(data);
  const rows: Array<{ key: string; label: string; plain: string; cell: LocatedCell }> = [
    { key: 'shared', label: 'Kept with a shared office', plain: LOCATION_BASIS_LABELS.deo.plain, cell: t.shared },
    { key: 'region', label: 'Region only', plain: LOCATION_BASIS_LABELS.region.plain, cell: t.region },
    { key: 'held', label: 'Held for review', plain: 'The place the title names is outside every district its own DPWH office serves, so it is held out until checked.', cell: t.held },
    ...(t.unassigned.rows ? [{ key: 'unassigned', label: 'Unassigned', plain: LOCATION_BASIS_LABELS.unassigned.plain, cell: t.unassigned }] : []),
  ];
  return (
    <section className="nep-section hgab-dp-off" id="not-placed" aria-labelledby="hgab-dp-off-title">
      <h2 id="hgab-dp-off-title">Placed in no single district</h2>
      <p>
        These 2027 DPWH projects are on no card above. Each is counted once, here. The{' '}
        <Link to={districtListHref()}>office list</Link> shows the offices they sit under.
      </p>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-dp-offtable">
          <thead>
            <tr><th scope="col">Why</th><th scope="col" className="num">Projects</th><th scope="col" className="num">2027 NEP</th><th scope="col" className="num">2027 House bill</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row"><strong>{r.label}</strong><small>{r.plain}</small></th>
                <td className="num">{r.cell.rows.toLocaleString()}</td>
                <td className="num" title={fmt.php(r.cell.nep_php, { unit: 'full' })}>{fmt.php(r.cell.nep_php)}</td>
                <td className="num" title={fmt.php(r.cell.house_php, { unit: 'full' })}>{fmt.php(r.cell.house_php)}</td>
              </tr>
            ))}
            <tr className="is-placed">
              <th scope="row"><strong>Placed in one district</strong><small>The cards above.</small></th>
              <td className="num">{t.placed.rows.toLocaleString()}</td>
              <td className="num" title={fmt.php(t.placed.nep_php, { unit: 'full' })}>{fmt.php(t.placed.nep_php)}</td>
              <td className="num" title={fmt.php(t.placed.house_php, { unit: 'full' })}>{fmt.php(t.placed.house_php)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Every 2027 DPWH project</th>
              <td className="num">{t.total.rows.toLocaleString()}</td>
              <td className="num" title={fmt.php(t.total.nep_php, { unit: 'full' })}>{fmt.php(t.total.nep_php)}</td>
              <td className="num" title={fmt.php(t.total.house_php, { unit: 'full' })}>{fmt.php(t.total.house_php)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function PlacedDetails({ data }: { data: LocationsData }) {
  const t = data.totals;
  return (
    <HgabDetails>
      <p>
        Placements are the source workbench’s DPWH location district lens, built from its pinned commit{' '}
        <a href={`${HGAB_SOURCE_REPO}/tree/${data.lens_commit}`} target="_blank" rel="noopener noreferrer"><code>{data.lens_commit.slice(0, 7)}</code></a>{' '}
        with its own scripts (method:{' '}
        <a href={`${HGAB_SOURCE_REPO}/blob/${data.lens_commit}/${data.lens.authority}`} target="_blank" rel="noopener noreferrer">{data.lens.authority}</a>).
        Every line is placed once, in the source’s order: the place the title names (<code>title_psgc</code>,{' '}
        {t.title_psgc.rows.toLocaleString()} lines), else an office serving one district (<code>deo_to_leg</code>,{' '}
        {t.deo_to_leg.rows.toLocaleString()}), else its shared office (<code>deo</code>, {t.deo.rows.toLocaleString()}),
        else its region (<code>region</code>, {t.region.rows.toLocaleString()}).
      </p>
      <p>
        Split cities resolve through PSGC2LEG’s barangay rows. Our one check on top: a <code>title_psgc</code> line whose
        place is outside every district its own office serves (flag <code>office_location_mismatch</code>) is held out of
        every district. The cards add the district cells of <code>locations.json</code>; the verifier recomputes each from
        the project lines.
      </p>
    </HgabDetails>
  );
}
