/**
 * `/hgab/2027/districts` — public works money by district engineering office,
 * in two views on one route (`districtsView` in `lib/hgab-ui.ts`):
 *
 *   Overview (default): the full navy hero, the KPI strip, the money no
 *   district card shows (per year), a table of regions (each office summed
 *   once), "How to read this" with the four conditions, and a link to the
 *   list. No cards.
 *
 *   Districts (`?view=list`, or any list filter without a view so older
 *   links still open it): one card per legislative district with the
 *   representative who holds the seat in the 20th Congress, the office(s)
 *   that serve it and their budget by Congress and year. A sidebar lists
 *   regions → districts (`HgabDistrictSidebar`); search, region, tier, sort
 *   and grouping live in the URL; `#region-<key>` and `#d-<district>` say
 *   where the reader is, so a position is shareable and Back returns to it.
 *
 * The page groups money by office, not by district. DPWH lists the
 * implementing office on every project row; the DEO2LEG crosswalk says which
 * districts each office serves. Nothing here infers which district a project
 * is in, no shared office's money is divided, and the residual that no card
 * can carry — Central Office, regional offices, unmatched units — is published
 * per year on the overview and named in one line above the cards.
 *
 * Copy is for a reader who has never opened a budget document; provenance
 * (crosswalk version, source commit, join counts) sits in "Details for
 * analysts" at the foot of each view.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading, SignedPhp } from '../components/HgabBits';
import { ChartKeyRow, DistrictCardView, ResidualPanel } from '../components/HgabDistrictBits';
import DistrictSidebar from '../components/HgabDistrictSidebar';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import {
  HGAB_ROOT, HGAB_SOURCE_REPO, PLAIN_TERMS, districtPath, formatPct, loadHgabDistricts, pctChange, regionKeyOf,
  type DistrictCard, type HgabDistrictIndex,
} from '../lib/hgab';
import { districtsView } from '../lib/hgab-ui';
import {
  DISTRICT_SORT_LABELS, FISCAL_STAGE_LONG, REGION_SECTION_ORDER, TIER_FILTER_LABELS, TIER_MEANING, bangsamoroDistricts,
  districtAnchor, districtAnchorFromHash, districtFiltersFromParams, districtListHref, districtRegionKey,
  filterDistricts, groupDistrictsByRegion, hasDistrictFilters, headlineResidual, isOfficeLedger,
  paramsFromDistrictFilters, regionAnchor, regionFilterKey, regionFromHash, regionNames, regionOptionLabel,
  regionTotals, regionsOf, residualShare, residualUnattributed, residualWhere, sidebarRegions, slotLabel,
  sortDistricts, sortPhrase,
  type DistrictFilters, type DistrictSortKey, type RegionGroup, type RegionSectionKey, type RegionTotals, type SidebarDistrict,
  type TierFilter,
} from '../lib/hgab-districts';
import '../hgab-districts.css';

/** Cards drawn before "Show more": 250 SVG cards at once is a 60,000 px wall and a slow mount. */
const PAGE = 60;
/**
 * Cards per region before "Show all" when the grouped grid would draw more
 * than PAGE: one desktop row, so the first screens show every region's top
 * districts by the chosen sort. The sidebar or `#region-<key>` opens a region.
 */
const REGION_PREVIEW = 3;
/** When a filter leaves this few districts, the sidebar opens every region. */
const NARROW = 40;

const SOURCES_LINE = 'SOURCE: ENACTED BUDGETS (GAA) 2020–2026 · NEP 2027 · HOUSE BILL 10858, THIRD READING · DEO2LEG OFFICE-TO-DISTRICT MAP · BILLS.JURIS.PH';

export default function HgabDistricts() {
  const [index, setIndex] = useState<HgabDistrictIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const view = districtsView(params);
  // A position hash with no view (`/districts#region-III`, the old back link)
  // belongs to the list: rewrite the address so the page and the sub-nav agree.
  const legacyListHash = !params.has('view') && view === 'overview' && Boolean(regionFromHash(hash) || districtAnchorFromHash(hash));

  useEffect(() => {
    loadHgabDistricts().then(setIndex).catch((e) => setErr(String(e?.message || e)));
  }, []);
  useEffect(() => {
    const t = pageMeta(districtPath()).title;
    document.title = view === 'list' ? `All districts · ${t}` : t;
  }, [view]);

  if (legacyListHash) return <Navigate replace to={`${districtListHref()}${hash}`} />;
  if (err) return <HgabError message={err} />;
  if (!index) return <HgabLoading what="the 2027 district index" heroBlend={view === 'overview'} />;
  return view === 'list' ? <DistrictsList index={index} /> : <DistrictsOverview index={index} />;
}

function plainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function DistrictsOverview({ index }: { index: HgabDistrictIndex }) {
  const all = index.districts;
  const offices = Object.values(index.offices).filter(isOfficeLedger);
  const tierA = all.filter((d) => d.attribution === 'A').length;
  const shared = all.filter((d) => d.attribution === 'B' || d.attribution === 'mixed').length;
  const none = all.filter((d) => d.attribution === 'none').length;
  const head = headlineResidual(index.residual);
  const share = head ? residualShare(head) : null;
  const browse = `Browse all ${all.length.toLocaleString()} districts →`;

  return (
    <>
      <HgabHeader crumb="Districts" compiledMeta={`${all.length.toLocaleString()} districts · ${offices.length.toLocaleString()} offices`} heroBlend />

      <HgabHero
        crumb="Districts"
        title="Public works money by district office"
        dek="DPWH money grouped by the district engineering office (DEO) that carries out the work. An office that serves several districts is shown whole, not split."
      />

      <main className="nep-main">
        <div className="hgab-dx-kpis">
          <KpiStrip
            items={[
              {
                label: 'Congressional districts',
                value: all.length.toLocaleString(),
                sub: `${offices.length.toLocaleString()} district offices · ${index.crosswalk.relationships.toLocaleString()} office-to-district links`,
              },
              { label: 'Tier A districts', value: tierA.toLocaleString(), sub: 'the office serves only this district, so its figure is the district’s' },
              {
                label: 'Tier B or mixed',
                value: shared.toLocaleString(),
                sub: `the office is shared with other districts; the figure is not split${none ? ` · ${none.toLocaleString()} ${none === 1 ? 'district has' : 'districts have'} no office found` : ''}`,
              },
              {
                label: head ? `On no card · ${slotLabel(head)}` : 'On no card',
                value: share == null ? '—' : fmt.pct(share, 1),
                tone: 'down',
                sub: head ? `${fmt.php(residualUnattributed(head))} of ${fmt.php(head.total_php)} is listed under ${residualWhere(head)}` : '',
              },
            ]}
          />
        </div>

        <ResidualPanel residual={index.residual} scopeNotes={index.scope_notes} />

        <section className="nep-section" aria-labelledby="hgab-dx-regions">
          <SectionHead
            eyebrow="By region · each office counted once"
            headline={<span id="hgab-dx-regions">District office money in each region</span>}
            dek="Each row adds up the district engineering offices serving that region’s districts. An office that serves several districts is counted once."
            right={<Link className="hgab-ds-seeall" to={districtListHref()}>{browse}</Link>}
          />
          <RegionTable index={index} />
        </section>

        <aside className="hgab-dd-howto hgab-dx-howto" aria-labelledby="hgab-dx-howto-title">
          <h2 id="hgab-dx-howto-title">How to read this</h2>
          <ol>
            <li>
              <strong>Every figure says whose it is.</strong> {TIER_MEANING}
            </li>
            <li>
              <strong>Shared money is never split.</strong> A shared office’s total is shown whole, with the other
              districts named beside it. Splitting it by population or road length would invent a figure.
            </li>
            <li>
              <strong>Most DPWH money is on no district card.</strong> Money listed under the DPWH Central Office or
              a regional office is not assigned to a district. The panel above shows how much, every year.
            </li>
            <li>
              <strong>The representative shown holds the seat in the 20th Congress.</strong> The 2020–2025 budgets
              were passed by the 18th and 19th Congresses, whose members are not shown. Nothing here says or
              implies that a representative requested, sponsored or controlled a project.
            </li>
          </ol>
        </aside>

        <section className="hgab-dx-callout hgab-dx-browse" aria-labelledby="hgab-dx-browse-title">
          <div>
            <p className="hgab-dx-callout-eyebrow">One card per district</p>
            <h2 id="hgab-dx-browse-title">All {all.length.toLocaleString()} congressional districts</h2>
            <p>
              Each card shows the representative, the office that builds there and its budget from 2020 to the
              2027 House bill. A sidebar lists every region and district. Offices ranked by amount are on
              the <Link to={`${HGAB_ROOT}/leaderboard`}>leaderboards</Link>.
            </p>
          </div>
          <Link className="hgab-cta hgab-cta-primary" to={districtListHref()}>{browse}</Link>
        </section>

        <DisclaimerNotice compact offices />
        <Provenance />
        <DistrictsDetails index={index} />
      </main>
      <SiteFooter source={SOURCES_LINE} />
    </>
  );
}

/**
 * One row per region (`REGION_ORDER`): its districts, the offices serving
 * them and those offices' totals, each office summed once; a total row that
 * equals the "on district cards" figure of the panel above; and a link that
 * opens the list at the region. Bangsamoro gets a row saying where its
 * districts are listed, since the office-to-district map files them elsewhere.
 */
function RegionTable({ index }: { index: HgabDistrictIndex }) {
  const barmm = useMemo(() => bangsamoroDistricts(index.districts, index), [index]);
  // One entry per region in order; Bangsamoro, which files no district of its
  // own, becomes a note row in its place when districts are served by it.
  const rows = useMemo(() => {
    const groups = new Map(groupDistrictsByRegion(index.districts).map((g) => [g.key, g] as const));
    return REGION_SECTION_ORDER.flatMap((k): Array<{ key: RegionSectionKey; cards: DistrictCard[] | null; t: RegionTotals | null }> => {
      const g = groups.get(k);
      if (g) return [{ key: k, cards: g.cards, t: regionTotals(g.cards, index) }];
      return k === 'BARMM' && barmm.length > 0 ? [{ key: k, cards: null, t: null }] : [];
    });
  }, [index, barmm]);
  const total = useMemo(() => regionTotals(index.districts, index), [index]);
  const barmmRegions = [...new Set(barmm.map(districtRegionKey))].map((k) => regionNames(k).name);

  const money = (v: number | null) => (
    <td className="num" title={v == null ? 'No figure' : fmt.php(v, { unit: 'full' })}>
      {v == null ? <span className="hgab-ds-null">—</span> : fmt.php(v)}
    </td>
  );
  const change = (delta: number | null, base: number | null) => (
    <td className="num hgab-dx-rt-change" title={delta == null ? 'No comparison' : `${fmt.php(delta, { unit: 'full' })} on the same named projects`}>
      <SignedPhp value={delta} />
      {delta != null && base ? <small>{formatPct(pctChange(base + delta, base))}</small> : null}
    </td>
  );

  return (
    <>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-dx-rt">
          <thead>
            <tr>
              <th className="nep-th-name">Region</th>
              <th className="num">Districts</th>
              <th className="num">Offices</th>
              <th className="num" title={`${FISCAL_STAGE_LONG.gaa} Whole office.`}>2026 enacted</th>
              <th className="num" title={`${FISCAL_STAGE_LONG.nep} Whole office.`}>2027 NEP</th>
              <th className="num" title={`${FISCAL_STAGE_LONG.hgab3} Named projects only.`}>2027 House bill</th>
              <th className="num" title="House bill minus the NEP, for the same named projects in both">Change, same projects</th>
              <th><span className="visually-hidden">Open the list</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, cards, t }) => {
              const n = regionNames(key);
              const name = (
                <td className="nep-td-name">
                  <strong>{n.name}</strong>
                  <span className="nep-code">{n.short}</span>
                </td>
              );
              if (!cards || !t) {
                return (
                  <tr key={key} className="is-note">
                    {name}
                    <td colSpan={7} className="hgab-dx-rt-note">
                      No district is filed here. The {barmm.length} {barmm.length === 1 ? 'district' : 'districts'} served
                      by its regional grouping are listed under {andList(barmmRegions)}. That grouping’s money is not
                      assigned to a district.
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={key}>
                  {name}
                  <td className="num">{cards.length.toLocaleString()}</td>
                  <td className="num">{t.offices.toLocaleString()}</td>
                  {money(t.gaa2026_php)}
                  {money(t.nep2027_php)}
                  {money(t.hgab3_php)}
                  {change(t.delta_php, t.compared_nep_php)}
                  <td className="hgab-dx-rt-go">
                    <Link to={districtListHref(regionAnchor(key))} aria-label={`See the ${cards.length} districts in ${n.name}`}>
                      See districts →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="is-total">
              <td className="nep-td-name"><strong>All regions</strong></td>
              <td className="num">{total.districts.toLocaleString()}</td>
              <td className="num">{total.offices.toLocaleString()}</td>
              {money(total.gaa2026_php)}
              {money(total.nep2027_php)}
              {money(total.hgab3_php)}
              {change(total.delta_php, total.compared_nep_php)}
              <td className="hgab-dx-rt-go"><Link to={districtListHref()}>See all →</Link></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="nep-hier-note">
        The NEP is the budget the President submits to Congress each August. Its column is the whole office;
        the House bill column counts named projects only. The change compares the same named projects in
        both, so it is not the gap between those two columns. Money under
        the Central Office and regional offices is in no row. Hover a figure for the exact pesos.
      </p>
    </>
  );
}

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function DistrictsList({ index }: { index: HgabDistrictIndex }) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => districtFiltersFromParams(params), [params]);

  // Built from the address bar as it is at write time, not from the router's
  // last committed params: the router applies navigation as a transition, and
  // on a page with 250 cards that commit can lag a quick second change (clear
  // the search, then pick a region), which would otherwise be clobbered.
  const update = useCallback(
    (patch: Partial<DistrictFilters>) => {
      const current = districtFiltersFromParams(new URLSearchParams(window.location.search));
      setParams(paramsFromDistrictFilters({ ...current, ...patch }), { replace: true });
    },
    [setParams],
  );

  // The search box shows what you type at once; the URL follows 250 ms after a
  // pause. `written` is the last value we pushed, so a URL change from outside
  // (Back, a link) replaces the draft while our own write — even one the router
  // has not committed yet — never pulls the draft back to the old value.
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

  const regionOptions = useMemo(() => regionsOf(index), [index]);
  const visible = useMemo(() => sortDistricts(filterDistricts(index, filters), index, filters.sort), [index, filters]);
  const grouped = filters.group;
  const groups = useMemo(() => (grouped ? groupDistrictsByRegion(visible) : []), [grouped, visible]);
  // Every district per region, unfiltered: the "5 of 24 districts" in a region's summary and the sidebar.
  const regionSize = useMemo(() => {
    const m = new Map<RegionSectionKey, number>();
    for (const d of index.districts) m.set(districtRegionKey(d), (m.get(districtRegionKey(d)) ?? 0) + 1);
    return m;
  }, [index]);
  const tree = useMemo(() => sidebarRegions(visible), [visible]);
  const byAnchor = useMemo(() => new Map(index.districts.map((d) => [districtAnchor(d.id), d] as const)), [index]);

  // Where the reader is: `#region-<key>` or `#d-<district>`.
  const { hash } = useLocation();
  const navigate = useNavigate();
  const hashRegion = regionFromHash(hash);
  const hashAnchor = districtAnchorFromHash(hash);
  const hashCard = hashAnchor ? byAnchor.get(hashAnchor) ?? null : null;
  const hashCardRegion = hashCard ? districtRegionKey(hashCard) : null;
  const hashCardHidden = hashCard != null && !visible.some((c) => c.id === hashCard.id);

  // How many of `visible` are drawn in the flat list. Keyed to the filters so a
  // new search starts from the first page again without an effect-driven reset,
  // and never fewer than reach the district in the hash.
  const filtersKey = `${filters.q}|${filters.region}|${filters.tier}|${filters.sort}`;
  const [reveal, setReveal] = useState({ key: filtersKey, limit: PAGE });
  const baseLimit = reveal.key === filtersKey ? reveal.limit : PAGE;
  const hashIdx = hashCard && !grouped ? visible.findIndex((c) => c.id === hashCard.id) : -1;
  const reach = (i: number) => Math.ceil((i + 1) / PAGE) * PAGE;
  const limit = hashIdx >= baseLimit ? reach(hashIdx) : baseLimit;
  const shown = useMemo(() => visible.slice(0, limit), [visible, limit]);
  const hidden = visible.length - shown.length;

  // Which region sections show every card when grouped. Keyed to the filters
  // but not the sort, so re-sorting keeps an opened region open. The region in
  // the hash, and the region of the district in the hash, are always whole.
  const openKey = `${filters.q}|${filters.region}|${filters.tier}`;
  const [open, setOpen] = useState<{ key: string; regions: RegionSectionKey[]; all: boolean }>({ key: openKey, regions: [], all: false });
  const opened = open.key === openKey ? open : { key: openKey, regions: [] as RegionSectionKey[], all: false };
  const openRegion = (k: RegionSectionKey) =>
    setOpen({ key: openKey, regions: opened.regions.includes(k) ? opened.regions : [...opened.regions, k], all: opened.all });
  const previewing = grouped && !opened.all && visible.length > PAGE;
  const regionLimit = (k: RegionSectionKey) =>
    previewing && !opened.regions.includes(k) && hashRegion !== k && hashCardRegion !== k ? REGION_PREVIEW : null;

  // Scroll to the hash: on load (the detail page and the overview link here
  // this way), from the sidebar, and on Back. A picked district's card is
  // highlighted and its heading takes focus. The browser's own scroll
  // restoration is off while the list is open: it would land after ours on
  // Back and put the reader somewhere other than the hash says. Back to an
  // entry with no hash goes to the top, where that entry began.
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
    // A short hop glides; a long one jumps, so the card is there at once.
    const near = Math.abs(el.getBoundingClientRect().top) < 3 * window.innerHeight;
    el.scrollIntoView({ block: 'start', behavior: glide && near && !reduce ? 'smooth' : 'auto' });
    if (!isCard) return;
    el.classList.remove('is-flash');
    void el.offsetWidth; // restart the highlight when the same card is picked again
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 2000);
    if (focus) el.querySelector<HTMLElement>('.hgab-dc-district')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const id = hashCard ? districtAnchor(hashCard.id) : hashRegion ? regionAnchor(hashRegion) : null;
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

  // Before a link leaves for a district page, write that district's card into
  // the list's own address, so Back returns to the card.
  const rememberCard = (e: MouseEvent<HTMLElement>) => {
    if (!plainClick(e)) return;
    const a = (e.target as HTMLElement).closest('a[href]');
    if (!a || !a.getAttribute('href')?.startsWith(`${districtPath()}/`)) return;
    const host = a.closest<HTMLElement>('.hgab-dc[id], [data-anchor]');
    const anchor = host?.dataset.anchor ?? host?.id;
    if (!anchor || window.location.hash === `#${anchor}`) return;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${anchor}`);
  };

  // What the sidebar watches for the region in view: the sections when
  // grouped, the drawn cards when flat.
  const track = useMemo(
    () => (grouped
      ? groups.map((g) => ({ id: regionAnchor(g.key), region: g.key }))
      : shown.map((c) => ({ id: districtAnchor(c.id), region: districtRegionKey(c) }))),
    [grouped, groups, shown],
  );

  const all = index.districts;
  const offices = Object.values(index.offices).filter(isOfficeLedger);
  const head = headlineResidual(index.residual);
  const share = head ? residualShare(head) : null;
  const narrowed = hasDistrictFilters(filters) && (tree.length <= 3 || visible.length <= NARROW);
  // Clears search, region and tier; the sort and the grouping are kept.
  const clear = () => update({ q: '', region: '', tier: '' });
  const regionKey = regionFilterKey(filters.region);
  const regionValue = regionKey ? regionOptions.find((r) => regionKeyOf(r) === regionKey) ?? filters.region : filters.region;
  const term = (text: string) => <span className="hgab-dx-term" title={PLAIN_TERMS.candidate.meaning}>{text}</span>;

  return (
    <>
      <HgabHeader
        crumb={<><Link to={districtPath()}>Districts</Link> › All districts</>}
        compiledMeta={`${all.length.toLocaleString()} districts · ${offices.length.toLocaleString()} offices`}
      />

      <HgabHero
        compact
        crumb={
          <>
            <Link to={districtPath()}>Districts</Link>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            <span className="hgab-crumb-here">All districts</span>
          </>
        }
        title="Districts"
        dek={<>One card per congressional district, with the office that builds there. {TIER_MEANING}</>}
        note={
          <>
            The representative shown holds the seat in the 20th Congress. The 2020–2025 budgets were passed by
            the 18th and 19th Congresses, whose members are not shown. Nothing here says or implies that a
            representative requested, sponsored or controlled a project.
          </>
        }
      >
        <ChartKeyRow terms={index.terms?.length ? index.terms : undefined} />
      </HgabHero>

      <main className="nep-main hgab-dx-listmain">
        {head && share != null && (
          <p className="hgab-dx-offcard">
            <strong>{fmt.pct(share, 1)}</strong> of DPWH money in the {slotLabel(head)} is on no district card.
            It is listed under {residualWhere(head)}.{' '}
            <Link to={districtPath()}>See how much, every year →</Link>
          </p>
        )}

        <div className="hgab-dx-layout" onClickCapture={rememberCard}>
          <DistrictSidebar
            mode="list"
            regions={tree}
            regionSize={regionSize}
            query={draft}
            onQuery={setDraft}
            onCommit={commitDraft}
            selectedId={hashCard?.id ?? null}
            focusRegion={hashCardRegion ?? hashRegion}
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
                <span>Whose budget?</span>
                <select className="select-input" value={filters.tier} onChange={(e) => update({ tier: e.target.value as TierFilter })}>
                  <option value="">All districts</option>
                  {(Object.keys(TIER_FILTER_LABELS) as Array<Exclude<TierFilter, ''>>).map((k) => (
                    <option key={k} value={k}>{TIER_FILTER_LABELS[k]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Sort by</span>
                <select className="select-input" value={filters.sort} onChange={(e) => update({ sort: e.target.value as DistrictSortKey })}>
                  {(Object.keys(DISTRICT_SORT_LABELS) as DistrictSortKey[]).map((k) => (
                    <option key={k} value={k}>{DISTRICT_SORT_LABELS[k]}</option>
                  ))}
                </select>
              </label>
              <label className="hgab-dx-toggle">
                <input type="checkbox" checked={grouped} onChange={(e) => update({ group: e.target.checked })} />
                <span>Group by region</span>
              </label>
            </div>

            <p className="hgab-dx-count" role="status">
              <span><strong>{visible.length.toLocaleString()}</strong> of {all.length.toLocaleString()} districts</span>
              {grouped && groups.length > 0 && <span>· in {groups.length} {groups.length === 1 ? 'region' : 'regions'}</span>}
              {previewing && (
                <span>
                  · the first {REGION_PREVIEW} in each region shown{' '}
                  <button type="button" onClick={() => setOpen({ key: openKey, regions: opened.regions, all: true })}>Show every district</button>
                </span>
              )}
              {!grouped && hidden > 0 && <span>· showing the first {shown.length.toLocaleString()}</span>}
              <span>· sorted by {sortPhrase(filters.sort)}{grouped ? ' within each region' : ''}</span>
              {filters.sort !== 'name' && <span>· districts without a figure come last</span>}
              {hasDistrictFilters(filters) && <button type="button" onClick={clear}>Clear filters</button>}
            </p>

            <p className="hgab-dx-lede">
              The NEP is the budget the President submits to Congress each August. A 2027 project “not in
              the NEP” is an {term('insertion candidate')}. One “in the NEP only” is a {term('deletion candidate')}.
              Both are leads to check, not findings.
            </p>

            {hashCardHidden && (
              <p className="hgab-dx-hiddencard" role="status">
                {hashCard.label} is hidden by the filters.{' '}
                <button type="button" className="nep-more" onClick={clear}>Clear filters</button>{' '}
                or <Link to={districtPath(hashCard.id)}>open its page</Link>.
              </p>
            )}

            <h2 className="visually-hidden">District cards</h2>
            {visible.length === 0 ? (
              <p className="hgab-dx-empty">
                No district matches these filters.{' '}
                <button type="button" className="nep-more" onClick={clear}>Clear filters</button>
              </p>
            ) : grouped ? (
              groups.map((g) => (
                <RegionSection
                  key={g.key}
                  group={g}
                  index={index}
                  size={regionSize.get(g.key) ?? g.cards.length}
                  limit={regionLimit(g.key)}
                  onOpen={() => openRegion(g.key)}
                />
              ))
            ) : (
              <>
                <div className="hgab-dx-grid">
                  {shown.map((card) => <DistrictCardView key={card.id} card={card} index={index} />)}
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

            <p className="hgab-dx-note">
              Card figures are the office’s totals as each document publishes them. The 2020–2026 figures are the
              enacted budgets (GAA) for the whole office. The 2027 NEP figure is the whole office’s listing. The
              2027 House bill figure, and the change beside it, cover named projects only. The three sit side by side; they are never added. A region’s totals add
              each office serving it once, so a shared office is not counted twice. A card’s “Projects” link opens
              every DPWH project recorded under that office.
            </p>

            <DisclaimerNotice compact offices />
            <Provenance />
            <DistrictsDetails index={index} />
          </div>
        </div>
      </main>
      <SiteFooter source={SOURCES_LINE} />
    </>
  );
}

// ---------------------------------------------------------------------------
// One region of the list
// ---------------------------------------------------------------------------

/**
 * A region heading ("Region III · Central Luzon"), its summary line — the
 * districts shown, the offices serving them and those offices' 2026 enacted
 * and 2027 House bill totals, each office summed once — and its cards in the
 * page's sort order. `limit` previews the first few with a "Show all" button.
 */
function RegionSection({ group, index, size, limit, onOpen }: {
  group: RegionGroup;
  index: HgabDistrictIndex;
  /** Every district in the region, before filters. */
  size: number;
  limit: number | null;
  onOpen: () => void;
}) {
  const names = regionNames(group.key);
  const anchor = regionAnchor(group.key);
  const t = useMemo(() => regionTotals(group.cards, index), [group.cards, index]);
  const barmm = useMemo(() => bangsamoroDistricts(group.cards, index), [group.cards, index]);
  const cards: DistrictCard[] = limit == null ? group.cards : group.cards.slice(0, limit);
  const rest = group.cards.length - cards.length;
  const n = group.cards.length;
  return (
    <section className="hgab-dx-region" id={anchor} aria-labelledby={`${anchor}-title`}>
      <header className="hgab-dx-region-head">
        <h3 id={`${anchor}-title`}>
          <span className="hgab-dx-region-short">{names.short}</span> · {names.name}
        </h3>
        <p className="hgab-dx-region-sum">
          <span>
            {n === size ? n.toLocaleString() : `${n.toLocaleString()} of ${size.toLocaleString()}`} {size === 1 ? 'district' : 'districts'}
          </span>
          <span>{t.offices.toLocaleString()} {t.offices === 1 ? 'office' : 'offices'}</span>
          <span>2026 enacted budget <strong title={fmt.php(t.gaa2026_php, { unit: 'full' })}>{fmt.php(t.gaa2026_php)}</strong></span>
          <span>2027 House bill <strong title={fmt.php(t.hgab3_php, { unit: 'full' })}>{fmt.php(t.hgab3_php)}</strong></span>
          <span className="hgab-dx-region-basis">sum of the offices serving these districts</span>
        </p>
        {barmm.length > 0 && (
          <p className="hgab-dx-region-aside">
            Also here: {barmm.map((c) => c.label).join('; ')}. {barmm.length === 1 ? 'It is' : 'They are'} served by
            the Bangsamoro (BARMM) regional grouping, whose money appears on no card.
          </p>
        )}
      </header>
      <div className="hgab-dx-grid">
        {cards.map((card) => <DistrictCardView key={card.id} card={card} index={index} level={4} />)}
      </div>
      {rest > 0 && (
        <p className="hgab-dx-region-more">
          <button type="button" className="nep-more" onClick={onOpen}>
            Show all {n.toLocaleString()} districts in {names.name}
          </button>
          <span>{rest.toLocaleString()} more</span>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared foot of both views
// ---------------------------------------------------------------------------

function Provenance() {
  return (
    <p className="nep-provenance">
      Sources: the enacted budgets for 2020–2026, the NEP for 2027, House Bill 10858
      at third reading, the DEO2LEG office-to-district map, and bills.juris.ph for representatives.
      {' · '}<Link to={`${HGAB_ROOT}/methodology`}>Methodology</Link>
      {' · '}<Link to={`${HGAB_ROOT}/sources`}>Sources</Link>
    </p>
  );
}

function DistrictsDetails({ index }: { index: HgabDistrictIndex }) {
  const built = index.built_at ? new Date(index.built_at) : null;
  return (
    <HgabDetails>
      <ul>
        {built && <li>Index built {built.toLocaleString('en-PH')}.</li>}
        <li>
          Office lists are joined by operating-unit name, as published, across this portal’s GAA data, the DBM NEP
          operating-unit listing and{' '}
          <a href={HGAB_SOURCE_REPO} target="_blank" rel="noopener noreferrer">the extraction workbench</a>
          {index.source_commit && <> at commit <code>{index.source_commit.slice(0, 7)}</code></>}.
          The FY2027 House 3R figure and its Δ cover the DPWH operations population compared in the House bill section.
        </li>
        <li>
          Office-to-district map: DEO2LEG crosswalk v{index.crosswalk.schema_version} ({index.crosswalk.build_date}),{' '}
          {index.crosswalk.offices.toLocaleString()} offices, {index.crosswalk.districts.toLocaleString()} districts,{' '}
          {index.crosswalk.relationships.toLocaleString()} office–district relationships. The crosswalk’s scanned
          allocation table is used for structure only; none of its amounts appear here.
        </li>
        <li>
          Regions: each district sits under the region label the crosswalk gives it (<code>card.region</code>),
          normalised with <code>regionKeyOf</code>; labels that do not normalise go to “Other”. Region totals sum
          the 2026 GAA, FY2027 NEP and FY2027 House bill (3R) slots of the distinct offices on the region’s cards; the
          change column sums the offices’ <code>fy2027</code> blocks (compared population). Districts served only
          by the BARMM regional grouping keep the crosswalk’s DPWH region (IX, X or XII).
        </li>
        <li>
          Representatives and portraits from{' '}
          <a href="https://bills.juris.ph" target="_blank" rel="noopener noreferrer">bills.juris.ph</a>
          {index.representatives_source?.fetched_at && <> (fetched {new Date(index.representatives_source.fetched_at).toLocaleDateString('en-PH')})</>}
          {index.representatives_source && <>, joined on the congress.gov.ph member code: {index.representatives_source.matched.toLocaleString()} seats joined, {index.representatives_source.unmatched.toLocaleString()} not</>}.
        </li>
        <li>
          URL: <code>view=list</code> opens the cards (any list parameter without a view does too);{' '}
          <code>region=</code> takes a label or a key (<code>III</code>, <code>IV-A</code>, <code>NCR</code>);{' '}
          <code>tier=A</code> attributable, <code>tier=B</code> shared or mixed, <code>tier=none</code> no office ledger;
          sort keys <code>hgab3</code>, <code>gaa2026</code>, <code>change</code> (fy2027 block, compared population),{' '}
          <code>growth</code> (mean annual GAA, 18th → 20th Congress), <code>name</code>; <code>group=none</code> for the
          flat list; <code>#region-III</code> opens one region and <code>#d-bulacan-1st</code> one card.
        </li>
      </ul>
    </HgabDetails>
  );
}
