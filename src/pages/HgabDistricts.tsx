/**
 * `/hgab/2027/districts` — one card per legislative district, with the
 * representative who holds the seat in the 20th Congress, the DPWH district
 * engineering office(s) that serve it, that office's budget by Congress and
 * fiscal year, and the FY2027 House bill against the NEP for its rows.
 *
 * The page groups money by office, not by district. DPWH prints the
 * implementing office on every project row; the DEO2LEG crosswalk says which
 * districts each office serves. Nothing here infers which district a project
 * is in, no shared office's money is divided, and the residual that no card
 * can carry — Central Office, regional offices, unmatched units — is published
 * first, per year, so a grid of cards cannot imply full coverage.
 *
 * Cards sit under region headings (`REGION_ORDER`), each with the region's
 * office totals (every office summed once), and a "Jump to region" row.
 * `group=none` gives the flat sorted list instead. Search, region, tier, sort
 * and grouping live in the URL so a view is shareable; `#region-<key>` opens
 * and scrolls to one region.
 *
 * Copy is for a reader who has never opened a budget document: acronyms are
 * expanded in the hero, every badge says what it means, and provenance
 * (crosswalk version, source commit, join counts) sits in "Details for
 * analysts" at the foot of the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { ChartKeyRow, DistrictCardView, ResidualPanel } from '../components/HgabDistrictBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import {
  HGAB_ROOT, HGAB_SOURCE_REPO, PLAIN_TERMS, districtPath, loadHgabDistricts,
  type DistrictCard, type HgabDistrictIndex,
} from '../lib/hgab';
import {
  DISTRICT_SORT_LABELS, TIER_FILTER_LABELS, TIER_MEANING, bangsamoroDistricts, districtFiltersFromParams,
  districtRegionKey, filterDistricts, groupDistrictsByRegion, hasDistrictFilters, headlineResidual, isOfficeLedger,
  paramsFromDistrictFilters, regionAnchor, regionFromHash, regionNames, regionOptionLabel, regionTotals, regionsOf,
  residualShare, residualUnattributed, residualWhere, slotLabel, sortDistricts, sortPhrase,
  type DistrictFilters, type DistrictSortKey, type RegionGroup, type RegionSectionKey, type TierFilter,
} from '../lib/hgab-districts';
import '../hgab-districts.css';

/** Cards drawn before "Show more": 250 SVG cards at once is a 60,000 px wall and a slow mount. */
const PAGE = 60;
/**
 * Cards per region before "Show all" when the grouped grid would draw more
 * than PAGE: one desktop row, so the first screens show every region's top
 * districts by the chosen sort. A jump chip or `#region-<key>` opens a region.
 */
const REGION_PREVIEW = 3;

export default function HgabDistricts() {
  const [index, setIndex] = useState<HgabDistrictIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => districtFiltersFromParams(params), [params]);

  useEffect(() => {
    document.title = pageMeta(districtPath()).title;
    loadHgabDistricts().then(setIndex).catch((e) => setErr(String(e?.message || e)));
  }, []);

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

  const regions = useMemo(() => (index ? regionsOf(index) : []), [index]);
  const visible = useMemo(
    () => (index ? sortDistricts(filterDistricts(index, filters), index, filters.sort) : []),
    [index, filters],
  );
  const grouped = filters.group;
  const groups = useMemo(() => (grouped ? groupDistrictsByRegion(visible) : []), [grouped, visible]);
  // Every district per region, unfiltered: the "5 of 24 districts" in a region's summary.
  const regionSize = useMemo(() => {
    const m = new Map<RegionSectionKey, number>();
    for (const d of index?.districts ?? []) m.set(districtRegionKey(d), (m.get(districtRegionKey(d)) ?? 0) + 1);
    return m;
  }, [index]);

  // How many of `visible` are drawn in the flat list. Keyed to the filters so a
  // new search starts from the first page again without an effect-driven reset.
  const filtersKey = `${filters.q}|${filters.region}|${filters.tier}|${filters.sort}`;
  const [reveal, setReveal] = useState({ key: filtersKey, limit: PAGE });
  const limit = reveal.key === filtersKey ? reveal.limit : PAGE;
  const shown = visible.slice(0, limit);
  const hidden = visible.length - shown.length;

  // Which region sections show every card when grouped. Keyed to the filters
  // but not the sort, so re-sorting keeps an opened region open.
  const openKey = `${filters.q}|${filters.region}|${filters.tier}`;
  const [open, setOpen] = useState<{ key: string; regions: RegionSectionKey[]; all: boolean }>({ key: openKey, regions: [], all: false });
  const opened = open.key === openKey ? open : { key: openKey, regions: [] as RegionSectionKey[], all: false };
  const openRegion = (k: RegionSectionKey) =>
    setOpen({ key: openKey, regions: opened.regions.includes(k) ? opened.regions : [...opened.regions, k], all: opened.all });
  const previewing = grouped && !opened.all && visible.length > PAGE;

  // The jump row sticks under the site masthead, whose height changes with the
  // viewport; publish it as a CSS variable for `top` and `scroll-margin-top`.
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
  }, [index]);

  // `#region-III` opens that region and scrolls to it: on load (the detail
  // page links back this way) and from the jump chips, which set the hash.
  const { hash } = useLocation();
  const navigate = useNavigate();
  const hashRegion = regionFromHash(hash);
  const smooth = useRef(false);
  useEffect(() => {
    if (!index) return;
    const k = regionFromHash(hash);
    const el = k ? document.getElementById(regionAnchor(k)) : null;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: smooth.current && !reduce ? 'smooth' : 'auto' });
    smooth.current = false;
  }, [hash, index]);
  const jump = (e: MouseEvent<HTMLAnchorElement>, k: RegionSectionKey) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    smooth.current = true;
    if (regionFromHash(window.location.hash) === k) {
      document.getElementById(regionAnchor(k))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      smooth.current = false;
      return;
    }
    navigate({ search: window.location.search, hash: regionAnchor(k) }, { replace: true });
  };

  if (err) return <HgabError message={err} />;
  if (!index) return <HgabLoading what="the 2027 district index" heroBlend />;

  const all = index.districts;
  const offices = Object.values(index.offices).filter(isOfficeLedger);
  const tierA = all.filter((d) => d.attribution === 'A').length;
  const shared = all.filter((d) => d.attribution === 'B' || d.attribution === 'mixed').length;
  const none = all.filter((d) => d.attribution === 'none').length;
  const head = headlineResidual(index.residual);
  const share = head ? residualShare(head) : null;
  const built = index.built_at ? new Date(index.built_at) : null;
  // Clears search, region and tier; the sort and the grouping are kept.
  const clear = () => update({ q: '', region: '', tier: '' });
  const term = (key: 'candidate', text: string) => (
    <span className="hgab-dx-term" title={PLAIN_TERMS[key].meaning}>{text}</span>
  );

  return (
    <>
      <HgabHeader crumb="Districts" compiledMeta={`${all.length.toLocaleString()} districts · ${offices.length.toLocaleString()} offices`} heroBlend />

      <HgabHero
        crumb="Districts"
        title="Public works money, by district office"
        dek={
          <>
            The Department of Public Works and Highways (DPWH) builds roads, bridges and flood control through
            its district engineering offices (DEOs). Every project in the budget names its office. This page
            adds up the money by office, then lists the congressional districts each office serves. It covers
            the enacted budget (GAA) for 2020 to 2026. For 2027 it compares the President’s proposed budget
            (NEP) with the House bill (third reading). An office that serves several districts is shown whole,
            not split.
          </>
        }
        note={
          <>
            The representative shown holds the seat in the 20th Congress. The 2020–2025 budgets were passed by
            the 18th and 19th Congresses, whose members are not shown. Nothing here says or implies that a
            representative requested, sponsored or controlled a project.
          </>
        }
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

        <section className="nep-section" aria-labelledby="hgab-dx-cards">
          <SectionHead
            eyebrow={grouped ? 'One card per district, by region' : 'One card per district'}
            headline={<span id="hgab-dx-cards">Districts</span>}
            dek={
              <>
                Every card says whose figures these are. {TIER_MEANING} Shared figures name the other districts
                beside them. A 2027 project “not in the proposal” is an {term('candidate', 'insertion candidate')};
                one “in the proposal only” is a {term('candidate', 'deletion candidate')}. Both are leads to check,
                not findings.
              </>
            }
          />

          <div className="nep-explore-controls hgab-dx-controls">
            <label>
              <span>Search</span>
              <input
                className="text-input"
                type="search"
                placeholder="district, representative, office…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { written.current = draft.trim(); update({ q: draft.trim() }); } }}
                aria-label="Search districts, representatives and offices"
              />
            </label>
            <label>
              <span>Region</span>
              <select className="select-input" value={filters.region} onChange={(e) => update({ region: e.target.value })}>
                <option value="">All regions</option>
                {regions.map((r) => <option key={r} value={r}>{regionOptionLabel(r)}</option>)}
                {filters.region && !regions.includes(filters.region) && <option value={filters.region}>{filters.region}</option>}
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

          <ChartKeyRow terms={index.terms?.length ? index.terms : undefined} />

          {visible.length === 0 ? (
            <p className="hgab-dx-empty">
              No district matches these filters.{' '}
              <button type="button" className="nep-more" onClick={clear}>Clear filters</button>
            </p>
          ) : grouped ? (
            <>
              <nav className="hgab-dx-jump" aria-label="Jump to region">
                <span className="hgab-dx-jump-label">Jump to region</span>
                <ul>
                  {groups.map((g) => {
                    const n = regionNames(g.key);
                    return (
                      <li key={g.key}>
                        <a
                          href={`#${regionAnchor(g.key)}`}
                          onClick={(e) => jump(e, g.key)}
                          title={`${n.full}: ${g.cards.length.toLocaleString()} ${g.cards.length === 1 ? 'district' : 'districts'}`}
                          aria-current={hashRegion === g.key ? 'location' : undefined}
                        >
                          {g.key === 'other' ? n.short : n.name} <span>{g.cards.length.toLocaleString()}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              {groups.map((g) => (
                <RegionSection
                  key={g.key}
                  group={g}
                  index={index}
                  size={regionSize.get(g.key) ?? g.cards.length}
                  limit={previewing && !opened.regions.includes(g.key) && hashRegion !== g.key ? REGION_PREVIEW : null}
                  onOpen={() => openRegion(g.key)}
                />
              ))}
            </>
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
                  <span>{hidden.toLocaleString()} more {hidden === 1 ? 'district matches' : 'districts match'}. Search or filter to find one directly.</span>
                </p>
              )}
            </>
          )}

          <p className="hgab-dx-note">
            Card figures are the office’s totals as each document prints them. The 2020–2026 figures are the
            enacted budgets (GAA) for the whole office. The 2027 proposal figure is the whole office’s listing
            in the President’s proposed budget (NEP). The 2027 House bill figure, and the change beside it,
            cover named projects only. The three sit side by side; they are never added. A region’s totals add
            each office serving it once, so a shared office is not counted twice. A card’s “Projects” link opens
            every DPWH project recorded under that office.
          </p>
        </section>

        <DisclaimerNotice compact />

        <p className="nep-provenance">
          Sources: the enacted budgets for 2020–2026, the President’s proposed budget for 2027, House Bill 10858
          at third reading, the DEO2LEG office-to-district map, and bills.juris.ph for representatives.
          {' · '}<Link to={`${HGAB_ROOT}/methodology`}>Methodology</Link>
          {' · '}<Link to={`${HGAB_ROOT}/sources`}>Sources</Link>
        </p>

        <HgabDetails>
          <ul>
            {built && <li>Index built {built.toLocaleString('en-PH')}.</li>}
            <li>
              Office lists are joined by printed operating-unit name across this portal’s GAA data, the DBM NEP
              operating-unit listing and{' '}
              <a href={HGAB_SOURCE_REPO} target="_blank" rel="noopener noreferrer">the extraction workbench</a>
              {index.source_commit && <> at commit <code>{index.source_commit.slice(0, 7)}</code></>}.
              The FY2027 House 3R figure and its Δ cover the DPWH operations population compared in the HGAB section.
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
              the 2026 GAA and FY2027 HGAB 3R slots of the distinct offices on the region’s visible cards. Districts
              served only by the BARMM regional grouping keep the crosswalk’s DPWH region (IX, X or XII).
            </li>
            <li>
              Representatives and portraits from{' '}
              <a href="https://bills.juris.ph" target="_blank" rel="noopener noreferrer">bills.juris.ph</a>
              {index.representatives_source?.fetched_at && <> (fetched {new Date(index.representatives_source.fetched_at).toLocaleDateString('en-PH')})</>}
              {index.representatives_source && <>, joined on the congress.gov.ph member code: {index.representatives_source.matched.toLocaleString()} seats joined, {index.representatives_source.unmatched.toLocaleString()} not</>}.
            </li>
            <li>
              URL: <code>tier=A</code> attributable, <code>tier=B</code> shared or mixed, <code>tier=none</code> no office ledger;
              sort keys <code>hgab3</code>, <code>gaa2026</code>, <code>change</code> (fy2027 block, compared population),{' '}
              <code>growth</code> (mean annual GAA, 18th → 20th Congress), <code>name</code>; <code>group=none</code> for the
              flat list; <code>#region-III</code> opens one region.
            </li>
          </ul>
        </HgabDetails>
      </main>
      <SiteFooter source="SOURCE: ENACTED BUDGETS (GAA) 2020–2026 · PRESIDENT’S PROPOSED BUDGET (NEP) 2027 · HOUSE BILL 10858, THIRD READING · DEO2LEG OFFICE-TO-DISTRICT MAP · BILLS.JURIS.PH" />
    </>
  );
}

// ---------------------------------------------------------------------------
// One region
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
