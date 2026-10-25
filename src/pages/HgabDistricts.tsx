/**
 * `/hgab/2027/districts` — the DEO lens: one card per legislative district,
 * with the representative who holds the seat in the 20th Congress, the DPWH
 * district engineering office(s) that serve it, that office's budget by
 * Congress and fiscal year, and the FY2027 House bill against the NEP for its
 * rows.
 *
 * The page is an office lens, not a district ledger. DPWH prints the
 * implementing office on every project row; the DEO2LEG crosswalk says which
 * districts each office serves. Nothing here infers which district a project
 * is in, no shared office's money is divided, and the residual that no card
 * can carry — Central Office, regional offices, unmatched units — is published
 * first, per year, so a grid of cards cannot imply full coverage.
 *
 * Search, region, attribution and sort live in the URL so a view is shareable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { CongressLegend, DistrictCardView, HistoryKey, ResidualPanel } from '../components/HgabDistrictBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { HGAB_ROOT, HGAB_SOURCE_REPO, districtPath, loadHgabDistricts, type HgabDistrictIndex } from '../lib/hgab';
import {
  DISTRICT_SORT_LABELS, TIER_FILTER_LABELS, districtFiltersFromParams, filterDistricts, hasDistrictFilters,
  headlineResidual, isOfficeLedger, paramsFromDistrictFilters, regionsOf, residualShare, residualUnattributed,
  slotLabel, sortDistricts,
  type DistrictFilters, type DistrictSortKey, type TierFilter,
} from '../lib/hgab-districts';
import '../hgab-districts.css';

/** Cards drawn before "Show more": 250 SVG cards at once is a 60,000 px wall and a slow mount. */
const PAGE = 60;

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
  // How many of `visible` are drawn. Keyed to the filters so a new search
  // starts from the first page again without an effect-driven reset.
  const filtersKey = `${filters.q}|${filters.region}|${filters.tier}|${filters.sort}`;
  const [reveal, setReveal] = useState({ key: filtersKey, limit: PAGE });
  const limit = reveal.key === filtersKey ? reveal.limit : PAGE;
  const shown = visible.slice(0, limit);
  const hidden = visible.length - shown.length;

  if (err) return <HgabError message={err} />;
  if (!index) return <HgabLoading what="the FY2027 district index" heroBlend />;

  const all = index.districts;
  const offices = Object.values(index.offices).filter(isOfficeLedger);
  const tierA = all.filter((d) => d.attribution === 'A').length;
  const shared = all.filter((d) => d.attribution === 'B' || d.attribution === 'mixed').length;
  const none = all.filter((d) => d.attribution === 'none').length;
  const head = headlineResidual(index.residual);
  const share = head ? residualShare(head) : null;
  const built = index.built_at ? new Date(index.built_at) : null;
  const clear = () => setParams(new URLSearchParams(), { replace: true });

  return (
    <>
      <HgabHeader crumb="Districts" compiledMeta={`${all.length.toLocaleString()} districts · ${offices.length.toLocaleString()} offices`} heroBlend />

      <HgabHero
        crumb="Districts"
        title="District engineering offices and the districts they serve"
        dek={
          <>
            DPWH prints the implementing office on every project row, so this lens groups the FY2020–2026
            GAA, the FY2027 NEP and House Bill 10858 by district engineering office and lists the
            legislative districts the DEO2LEG crosswalk links to each one. It is an office lens, not a
            district ledger: nothing is inferred about where a project sits, an office shared by several
            districts is shown as one undivided total, and the money no card can carry is published first.
          </>
        }
        note={
          <>
            The representative shown holds the seat in the 20th Congress. FY2020–2025 budgets were passed by
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
                label: 'Legislative districts',
                value: all.length.toLocaleString(),
                sub: `${offices.length.toLocaleString()} office ledgers · ${index.crosswalk.relationships.toLocaleString()} office–district links`,
              },
              { label: 'Tier A · attributable', value: tierA.toLocaleString(), sub: 'served only by offices that serve one district' },
              {
                label: 'Tier B or mixed · undivided',
                value: shared.toLocaleString(),
                sub: `shared office totals, shown once, never split${none ? ` · ${none.toLocaleString()} ${none === 1 ? 'district has' : 'districts have'} no office ledger` : ''}`,
              },
              {
                label: head ? `On no card · ${slotLabel(head)}` : 'On no card',
                value: share == null ? '—' : fmt.pct(share, 1),
                tone: 'down',
                sub: head ? `${fmt.php(residualUnattributed(head))} of ${fmt.php(head.total_php)} under Central Office, regional offices or unmatched units` : '',
              },
            ]}
          />
        </div>

        <ResidualPanel residual={index.residual} scopeNotes={index.scope_notes} />

        <section className="nep-section" aria-labelledby="hgab-dx-congress">
          <SectionHead
            eyebrow="Reading the history"
            headline={<span id="hgab-dx-congress">Three Congresses, nine columns</span>}
            dek="Each card charts the serving office's budget in nine slots: seven enacted GAAs, then the FY2027 NEP and the House bill's third reading, grouped under the Congress that handled each year with that Congress's GAA subtotal printed. A dashed slot means the office was not found in that year's data — never a zero."
          />
          <CongressLegend terms={index.terms?.length ? index.terms : undefined} />
        </section>

        <section className="nep-section" aria-labelledby="hgab-dx-cards">
          <SectionHead
            eyebrow="One card per district"
            headline={<span id="hgab-dx-cards">Districts</span>}
            dek="Every figure carries its attribution tier. Tier A: the office serves this district alone. Tier B: the office is shared, so its total is undivided and the co-served districts are named beside it. FY2027 groups are the source's candidates — insertion and deletion are observations, not findings — and held rows are excluded upstream."
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
                {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                {filters.region && !regions.includes(filters.region) && <option value={filters.region}>{filters.region}</option>}
              </select>
            </label>
            <label>
              <span>Attribution</span>
              <select className="select-input" value={filters.tier} onChange={(e) => update({ tier: e.target.value as TierFilter })}>
                <option value="">All tiers</option>
                {(Object.keys(TIER_FILTER_LABELS) as Array<Exclude<TierFilter, ''>>).map((k) => (
                  <option key={k} value={k}>{TIER_FILTER_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select className="select-input" value={filters.sort} onChange={(e) => update({ sort: e.target.value as DistrictSortKey })}>
                {(Object.keys(DISTRICT_SORT_LABELS) as DistrictSortKey[]).map((k) => (
                  <option key={k} value={k}>{DISTRICT_SORT_LABELS[k]}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="hgab-dx-count" role="status">
            <span><strong>{visible.length.toLocaleString()}</strong> of {all.length.toLocaleString()} districts</span>
            {hidden > 0 && <span>· showing the first {shown.length.toLocaleString()}</span>}
            <span>· sorted by {DISTRICT_SORT_LABELS[filters.sort].toLowerCase()}</span>
            {filters.sort !== 'name' && <span>· districts without a figure sort last</span>}
            {hasDistrictFilters(filters) && <button type="button" onClick={clear}>Clear filters</button>}
          </p>
          <HistoryKey />

          {visible.length > 0 ? (
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
                  <span>{hidden.toLocaleString()} more {hidden === 1 ? 'district matches' : 'districts match'}; search or filter to find one directly.</span>
                </p>
              )}
            </>
          ) : (
            <p className="hgab-dx-empty">
              No district matches these filters.{' '}
              <button type="button" className="nep-more" onClick={clear}>Clear filters</button>
            </p>
          )}

          <p className="hgab-dx-note">
            Card figures are the serving offices’ totals as each document prints them. FY2020–2026 are enacted
            GAA appropriations for the whole office; the FY2027 NEP figure is DBM’s operating-unit listing for
            the whole office; the FY2027 HGAB 3R figure, and the Δ beside it, are the House bill against the
            NEP on the compared population of named projects only. The three are listed side by side, never
            added. A card’s “Projects” link opens every DPWH comparison row recorded under that office.
          </p>
        </section>

        <DisclaimerNotice compact />

        <p className="nep-provenance">
          {built && `Built ${built.toLocaleString('en-PH')} · `}
          Office ledgers joined by printed name across this portal’s GAA data, the DBM NEP listing and{' '}
          <a href={HGAB_SOURCE_REPO} target="_blank" rel="noopener noreferrer">the extraction workbench</a>
          {index.source_commit && <> at <code>{index.source_commit.slice(0, 7)}</code></>}
          {' · '}DEO2LEG crosswalk v{index.crosswalk.schema_version} ({index.crosswalk.build_date}):{' '}
          {index.crosswalk.offices.toLocaleString()} offices, {index.crosswalk.districts.toLocaleString()} districts,{' '}
          {index.crosswalk.relationships.toLocaleString()} links
          {' · '}Representatives and portraits from{' '}
          <a href="https://bills.juris.ph" target="_blank" rel="noopener noreferrer">bills.juris.ph</a>
          {index.representatives_source?.fetched_at && <> (fetched {new Date(index.representatives_source.fetched_at).toLocaleDateString('en-PH')})</>}
          {index.representatives_source && <>, {index.representatives_source.matched.toLocaleString()} seats joined, {index.representatives_source.unmatched.toLocaleString()} not</>}
          {' · '}<Link to={`${HGAB_ROOT}/methodology`}>Methodology</Link>
          {' · '}<Link to={`${HGAB_ROOT}/sources`}>Sources</Link>
        </p>
      </main>
      <SiteFooter source="SOURCE: GAA FY 2020–2026 · DBM NEP FY 2027 · HOUSE BILL 10858 (3RD READING) · DEO2LEG CROSSWALK · BILLS.JURIS.PH" />
    </>
  );
}
