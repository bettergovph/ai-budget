/**
 * Pure helpers for the Districts pages (`/hgab/2027/districts`): URL state,
 * the nine-slot fiscal history every chart and table draws, the metrics the
 * grid sorts on, the filters, and every reader-facing label the pages share.
 * No React and no DOM, so the pages and the presentational bits share one
 * definition of every derived figure and one wording for every idea.
 *
 * Rules enforced here, matching the DEO2LEG conditions:
 *   - an office's money is never divided among the districts it serves; card
 *     metrics sum UNDIVIDED office totals and callers must label them so;
 *   - null stays null (an office not found in a year's data), never 0;
 *   - documents are compared, never added: an enacted subtotal counts GAA
 *     years only, and the FY2027 NEP / House 3R are proposals listed beside it.
 *
 * Wording: labels here are what a reader sees. Technical terms (residual,
 * crosswalk, ledger, stage, matched label) stay in identifiers and comments;
 * the reader gets "not assigned to a district", "office-to-district map",
 * "list", "document" and nothing about matching outside a Details block.
 */
import {
  BRIDGE_LABELS, CONGRESS_TERMS, PLAIN_TERMS, REGION_LABELS, REGION_ORDER, datasetPath, districtPath, pctChange, regionKeyOf,
  type BridgeGroup, type CongressTerm, type DistrictCard, type DistrictRepresentative, type FiscalStage,
  type HgabDistrictIndex, type OfficeHistory, type RegionKey, type ResidualYear,
} from './hgab';

// ---------------------------------------------------------------------------
// URL state (`?view=list&q=…&region=…&tier=…&sort=…&group=none`)
// ---------------------------------------------------------------------------

export type DistrictSortKey = 'hgab3' | 'gaa2026' | 'change' | 'growth' | 'name';
/** `A` = attributable only; `B` = shared or mixed; `none` = no office ledger. */
export type TierFilter = '' | 'A' | 'B' | 'none';

export const DEFAULT_DISTRICT_SORT: DistrictSortKey = 'hgab3';

/** Sort options, in the reader's words. */
export const DISTRICT_SORT_LABELS: Record<DistrictSortKey, string> = {
  hgab3: 'Largest House bill amount',
  gaa2026: 'Largest 2026 budget',
  change: 'Biggest change from the proposal',
  growth: 'Fastest growth across Congresses',
  name: 'Name',
};

/** The sort label inside a sentence ("sorted by largest House bill amount"): only the first letter is lower-cased. */
export function sortPhrase(key: DistrictSortKey): string {
  const l = DISTRICT_SORT_LABELS[key];
  return l.charAt(0).toLowerCase() + l.slice(1);
}

/** The "Whose budget?" filter. */
export const TIER_FILTER_LABELS: Record<Exclude<TierFilter, ''>, string> = {
  A: 'Tier A · the office serves only this district',
  B: 'Tier B or mixed · the office is shared; figures not split',
  none: 'No office found',
};

export interface DistrictFilters {
  /** Free text over district, representative, candidates, region and office names. */
  q: string;
  region: string;
  tier: TierFilter;
  sort: DistrictSortKey;
  /** Cards grouped under region headings (the default); `group=none` in the URL gives the flat sorted list. */
  group: boolean;
}

function isSortKey(v: string | null): v is DistrictSortKey {
  return v != null && v in DISTRICT_SORT_LABELS;
}

/** URL → filters; unknown values fall back to defaults so a stale link still opens. */
export function districtFiltersFromParams(params: URLSearchParams): DistrictFilters {
  const tier = params.get('tier');
  const sort = params.get('sort');
  return {
    q: params.get('q') ?? '',
    region: params.get('region') ?? '',
    tier: tier === 'A' || tier === 'B' || tier === 'none' ? tier : '',
    sort: isSortKey(sort) ? sort : DEFAULT_DISTRICT_SORT,
    group: params.get('group') !== 'none',
  };
}

/**
 * Filters → URL, writing only non-default values so shared links stay short.
 * Always leads with `view=list`: these filters belong to the list, and
 * clearing every filter must not drop the reader back on the overview.
 */
export function paramsFromDistrictFilters(f: DistrictFilters): URLSearchParams {
  const p = new URLSearchParams({ view: 'list' });
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.region) p.set('region', f.region);
  if (f.tier) p.set('tier', f.tier);
  if (f.sort !== DEFAULT_DISTRICT_SORT) p.set('sort', f.sort);
  if (!f.group) p.set('group', 'none');
  return p;
}

/** True when search, region or tier narrows the list. Sort and grouping are views, not filters. */
export function hasDistrictFilters(f: DistrictFilters): boolean {
  return Boolean(f.q.trim() || f.region || f.tier);
}

// ---------------------------------------------------------------------------
// Fiscal stages (the three documents) and the nine history slots
// ---------------------------------------------------------------------------

/** Table-cell label of the document a figure comes from. Acronyms are expanded in every page's hero first. */
export const FISCAL_STAGE_SHORT: Record<FiscalStage, string> = { gaa: 'Enacted (GAA)', nep: 'Proposal (NEP)', hgab3: 'House bill' };
/** One-word form for chart ticks, residual rows and sentences: "2026 enacted budget", "2027 House bill". */
export const FISCAL_STAGE_WORD: Record<FiscalStage, string> = { gaa: 'enacted budget', nep: 'proposal', hgab3: 'House bill' };
/** Tooltip form: what the document is, in one plain sentence. */
export const FISCAL_STAGE_LONG: Record<FiscalStage, string> = {
  gaa: 'The enacted budget (GAA): the law Congress passed and the President signed for that year.',
  nep: 'The President’s proposed budget (NEP), sent to Congress in August.',
  hgab3: 'The House bill (third reading): the House of Representatives’ version of the 2027 budget, not yet law.',
};
/** What each document's figure covers for one office. */
export const FISCAL_STAGE_SCOPE: Record<FiscalStage, string> = {
  gaa: 'the whole office',
  nep: 'the whole office',
  hgab3: 'named projects only',
};

export interface HistorySlot {
  fy: number;
  stage: FiscalStage;
  congress: CongressTerm;
  /** Integer pesos; null when the office was not found in that year's data. */
  php: number | null;
  matched_label: string | null;
  /** False when the ledger carries no entry for this slot at all (as opposed to an explicit null). */
  listed: boolean;
}

/** "2026 enacted budget", "2027 proposal", "2027 House bill". */
export function slotLabel(s: { fy: number; stage: FiscalStage }): string {
  return `${s.fy} ${FISCAL_STAGE_WORD[s.stage]}`;
}

/** "2020–2022" (or "2020–22" when `short`): the budget years a Congress handled, as the key row's chips print them. */
export function congressBudgetYears(term: Pick<CongressTerm, 'years'>, short = false): string {
  const lo = Math.min(...term.years);
  const hi = Math.max(...term.years);
  if (lo === hi) return String(lo);
  return `${lo}–${short && Math.floor(lo / 100) === Math.floor(hi / 100) ? String(hi).slice(2) : hi}`;
}

/** "18th": the ordinal alone, for the second and third key-row chips. */
export function congressOrdinal(term: Pick<CongressTerm, 'congress'>): string {
  const n = term.congress;
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${tail}`;
}

/** "passed the 2020, 2021 and 2022 budgets" / "passed the 2026 budget; the 2027 budget is still before it". */
export function congressPlain(term: Pick<CongressTerm, 'years' | 'label'>): string {
  const enacted = term.years.filter((fy) => fy !== 2027);
  const list = enacted.length <= 1
    ? enacted.join('')
    : `${enacted.slice(0, -1).join(', ')} and ${enacted[enacted.length - 1]}`;
  const head = enacted.length ? `passed the ${list} ${enacted.length === 1 ? 'budget' : 'budgets'}` : 'passed no budget yet';
  return term.years.includes(2027) ? `${head}. The 2027 budget is still before it: the proposal and the House bill.` : `${head}.`;
}

export function congressOf(fy: number): CongressTerm | undefined {
  return CONGRESS_TERMS.find((t) => t.years.includes(fy));
}

/**
 * The nine slots every history draws, in order and grouped by Congress term:
 * FY2020–2022 GAA (18th), FY2023–2025 GAA (19th), FY2026 GAA, FY2027 NEP and
 * FY2027 HGAB 3R (20th). Built from `CONGRESS_TERMS` rather than from the
 * ledger so a missing year is a visible empty slot, never a shifted bar.
 */
export function historySlots(office: Pick<OfficeHistory, 'years'>): HistorySlot[] {
  const out: HistorySlot[] = [];
  for (const term of CONGRESS_TERMS) {
    for (const fy of term.years) {
      const stages: FiscalStage[] = fy === 2027 ? ['nep', 'hgab3'] : ['gaa'];
      for (const stage of stages) {
        const y = office.years.find((x) => x.fy === fy && x.stage === stage);
        out.push({ fy, stage, congress: term, php: y?.php ?? null, matched_label: y?.matched_label ?? null, listed: Boolean(y) });
      }
    }
  }
  return out;
}

export function yearAmount(office: Pick<OfficeHistory, 'years'>, fy: number, stage: FiscalStage): number | null {
  return office.years.find((x) => x.fy === fy && x.stage === stage)?.php ?? null;
}

/**
 * GAA subtotal of one Congress term: the ledger's own `by_congress` figure when
 * it carries one, else the sum of the term's GAA years that have a figure
 * (null when none does). FY2027 proposals are never part of a subtotal.
 */
export function gaaSubtotal(office: OfficeHistory, congress: number): { php: number | null; years: number[] } {
  const own = office.by_congress?.find((b) => b.congress === congress);
  if (own) return { php: own.gaa_php, years: own.years_counted ?? [] };
  const term = CONGRESS_TERMS.find((t) => t.congress === congress);
  if (!term) return { php: null, years: [] };
  let sum: number | null = null;
  const years: number[] = [];
  for (const fy of term.years) {
    if (fy === 2027) continue;
    const v = yearAmount(office, fy, 'gaa');
    if (v == null) continue;
    sum = (sum ?? 0) + v;
    years.push(fy);
  }
  return { php: sum, years };
}

/** "FY2020–2022", "FY2026", "—". */
export function fiscalYearRange(years: readonly number[]): string {
  if (!years.length) return '—';
  const sorted = [...years].sort((a, b) => a - b);
  return sorted.length === 1 ? `FY${sorted[0]}` : `FY${sorted[0]}–${sorted[sorted.length - 1]}`;
}

/**
 * The label the DPWH parquet prints for this office — the FY2027 HGAB 3R
 * `matched_label`, which the importer takes verbatim from `projects.parquet`;
 * else the crosswalk name. The Projects deep link (`deo=`) is an exact
 * `office` equality, so it must be that printed string. The GAA and NEP slots
 * carry DBM operating-unit labels instead (two spellings can be joined with
 * " + "), so they are never used for the link.
 */
export function officeParquetLabel(office: OfficeHistory): string {
  return office.years.find((x) => x.fy === 2027 && x.stage === 'hgab3' && x.matched_label)?.matched_label ?? office.name;
}

/** `/hgab/2027/dpwh?view=projects&deo=<printed office label>` — every DPWH comparison row under the office. */
export function officeProjectsHref(office: OfficeHistory): string {
  return `${datasetPath('dpwh', 'projects')}&deo=${encodeURIComponent(officeParquetLabel(office))}`;
}

/** A regional grouping (BARMM) is not an office: its money is in the residual, never on a chart. */
export function isOfficeLedger(office: Pick<OfficeHistory, 'kind'>): boolean {
  return office.kind !== 'regional_group';
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** The plain meaning of the two tiers, said once per page right after the first "Tier" badge. */
export const TIER_MEANING =
  'Tier A: the office serves one district, so its figure can be read as that district’s. Tier B: the office serves several districts, so the figure is shared and is not split between them.';

/**
 * A card's overall answer to "Whose budget is this?". `short` is the badge,
 * `badge` the small print beside it, `label` the heading, `help` one or two
 * plain sentences.
 */
export const ATTRIBUTION_LABELS: Record<DistrictCard['attribution'], { short: string; badge: string; label: string; help: string }> = {
  A: {
    short: 'Tier A',
    badge: 'only this district',
    label: 'Tier A · the office serves only this district',
    help: 'Every office that builds here serves only this district. Its figures can be read as this district’s.',
  },
  B: {
    short: 'Tier B',
    badge: 'shared, not split',
    label: 'Tier B · shared office total, not split',
    help: 'Every office that builds here also serves other districts. The figures are the whole office’s. They are shared, not split.',
  },
  mixed: {
    short: 'Mixed',
    badge: 'one office shared',
    label: 'Mixed · one office is shared, not split',
    help: 'Some offices here serve only this district; at least one is shared with others. A shared figure is the whole office’s, not split.',
  },
  none: {
    short: 'No office',
    badge: 'no figure',
    label: 'No office found',
    help: 'We could not find a district engineering office (DEO) for this district, so there is no figure to show. That is not evidence of no funding.',
  },
};

/** "Tier A · serves only this district" or "Tier B · shared with 2 other districts, not split". */
export function officeTierText(tier: 'A' | 'B', sharedWith: number): string {
  return tier === 'A'
    ? 'Tier A · serves only this district'
    : `Tier B · shared with ${sharedWith} other ${sharedWith === 1 ? 'district' : 'districts'}, not split`;
}

/** The short form on a badge: "serves only this district" / "shared with 2 · not split". */
export function officeTierBadgeText(tier: 'A' | 'B', sharedWith: number): string {
  return tier === 'A' ? 'serves only this district' : `shared with ${sharedWith} · not split`;
}

/** "District engineering office (DEO)" / "Sub-district engineering office" / "Regional grouping". */
export function officeKindText(office: Pick<OfficeHistory, 'kind'>): string {
  switch (office.kind) {
    case 'district_engineering_office': return 'District engineering office (DEO)';
    case 'sub_district_engineering_office': return 'Sub-district engineering office';
    default: return 'Regional grouping, not a district office';
  }
}

/** Tooltip of a group: insertion and deletion candidates get the plain meaning of "candidate"; the rest their own help. */
export function bridgeGroupTitle(group: BridgeGroup): string {
  const label = BRIDGE_LABELS[group];
  if (group === 'house_only' || group === 'nep_only') {
    const kind = group === 'house_only' ? 'Insertion candidate' : 'Deletion candidate';
    return `${label.label}: ${kind.toLowerCase()}s. ${PLAIN_TERMS.candidate.meaning}`;
  }
  return `${label.label}. ${label.help}`;
}

export function findDistrict(index: HgabDistrictIndex, id: string | undefined): DistrictCard | undefined {
  return id ? index.districts.find((d) => d.id === id) : undefined;
}

export function districtLabel(index: HgabDistrictIndex, id: string): string {
  return index.districts.find((d) => d.id === id)?.label ?? id;
}

/**
 * The office ledgers a card points at, in the card's order. Ids with no ledger
 * are dropped, and so are regional groupings (BARMM), which the lens must not
 * count as offices; see `cardRegionalGroups` for those.
 */
export function cardOffices(card: DistrictCard, index: HgabDistrictIndex): OfficeHistory[] {
  return card.office_ids
    .map((id) => index.offices[id])
    .filter((o): o is OfficeHistory => Boolean(o) && isOfficeLedger(o));
}

/** Regional groupings a card points at — named on the card as not-an-office, never charted. */
export function cardRegionalGroups(card: DistrictCard, index: HgabDistrictIndex): OfficeHistory[] {
  return card.office_ids
    .map((id) => index.offices[id])
    .filter((o): o is OfficeHistory => Boolean(o) && !isOfficeLedger(o));
}

/** Other districts served by any of the card's offices, deduplicated, excluding the card itself. */
export function coServedIds(card: DistrictCard, index: HgabDistrictIndex): string[] {
  const out = new Set<string>(card.co_served_district_ids ?? []);
  for (const o of cardOffices(card, index)) for (const id of o.district_ids) out.add(id);
  out.delete(card.id);
  return [...out];
}

/**
 * Growth between the 18th and 20th Congress, on mean annual GAA so a one-year
 * term (FY2026) is comparable with a three-year one. Summed over the card's
 * offices as undivided totals; null when either term has no figure.
 */
export function cardGrowth(card: DistrictCard, index: HgabDistrictIndex): number | null {
  const offices = cardOffices(card, index);
  const meanAnnual = (congress: number): number | null => {
    const term = CONGRESS_TERMS.find((t) => t.congress === congress);
    if (!term) return null;
    let total: number | null = null;
    for (const o of offices) {
      const vals = term.years.filter((fy) => fy !== 2027).map((fy) => yearAmount(o, fy, 'gaa')).filter((v): v is number => v != null);
      if (!vals.length) continue;
      total = (total ?? 0) + vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return total;
  };
  return pctChange(meanAnnual(20), meanAnnual(18));
}

/**
 * FY2027 on the compared population: the offices' `fy2027` blocks, which put
 * the NEP and the House bill on the same rows. Summed over the card's offices
 * as undivided totals; null when no office carries a block.
 *
 * This — not the headline pair — is what "change vs NEP" means on a card: the
 * FY2027 `nep` history slot is the DBM operating-unit listing for the whole
 * office, while the HGAB 3R figure covers named projects only, and the index's
 * scope notes forbid comparing the two like for like.
 */
export interface Fy27Compare {
  nep_php: number | null;
  hgab3_php: number | null;
  delta_php: number | null;
  /** Offices on the card that carry a `fy2027` block. */
  offices: number;
}

export function cardFy27(card: DistrictCard, index: HgabDistrictIndex): Fy27Compare {
  let nep: number | null = null;
  let h3: number | null = null;
  let delta: number | null = null;
  let n = 0;
  for (const o of cardOffices(card, index)) {
    const f = o.fy2027;
    if (!f) continue;
    n += 1;
    if (f.nep_php != null) nep = (nep ?? 0) + f.nep_php;
    if (f.hgab3_php != null) h3 = (h3 ?? 0) + f.hgab3_php;
    if (f.nep_php != null && f.hgab3_php != null) delta = (delta ?? 0) + (f.hgab3_php - f.nep_php);
  }
  return { nep_php: nep, hgab3_php: h3, delta_php: delta, offices: n };
}

/** The figure a sort key ranks on; null sinks to the bottom. */
export function cardMetric(card: DistrictCard, index: HgabDistrictIndex, key: DistrictSortKey): number | null {
  switch (key) {
    case 'hgab3': return card.headline.fy2027_hgab3_php;
    case 'gaa2026': return card.headline.fy2026_gaa_php;
    case 'change': return cardFy27(card, index).delta_php;
    case 'growth': return cardGrowth(card, index);
    default: return null;
  }
}

/** Display name of a seat's holder; ambiguous seats list every member named. */
export function repName(rep: DistrictRepresentative | null | undefined): string {
  if (!rep) return 'Representative not found';
  if (rep.status === 'ambiguous') {
    if (rep.name) return rep.name;
    const names = (rep.candidates ?? []).map((c) => c.name).filter(Boolean);
    return names.length ? names.join(' / ') : 'Members listed; none chosen';
  }
  return rep.name;
}

function repSearchText(rep: DistrictRepresentative | null): string {
  if (!rep) return '';
  const own = [rep.name, rep.seat, ...rep.leadership_roles];
  const cands = (rep.candidates ?? []).flatMap((c) => [c.name, c.seat]);
  return [...own, ...cands].filter(Boolean).join(' ');
}

export function districtSearchText(card: DistrictCard, index: HgabDistrictIndex): string {
  const offices = cardOffices(card, index).flatMap((o) => [o.name, officeParquetLabel(o), ...(o.aliases_used ?? [])]);
  return [card.label, card.jurisdiction, card.district_label, card.region ?? '', repSearchText(card.representative), ...offices]
    .join(' ')
    .toLowerCase();
}

/**
 * The region a `region=` value names: a key (`III`, `IV-A`, `NCR`, `other`)
 * or any label `regionKeyOf` reads ("Region III"). Null for a label it does
 * not recognise, which then matches the card's label exactly.
 */
export function regionFilterKey(value: string): RegionSectionKey | null {
  if (!value) return null;
  if (value === 'other' || (REGION_ORDER as readonly string[]).includes(value)) return value as RegionSectionKey;
  return regionKeyOf(value);
}

export function filterDistricts(index: HgabDistrictIndex, f: DistrictFilters): DistrictCard[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const regionKey = regionFilterKey(f.region);
  return index.districts.filter((card) => {
    if (f.region && (regionKey ? districtRegionKey(card) !== regionKey : (card.region ?? '') !== f.region)) return false;
    if (f.tier === 'A' && card.attribution !== 'A') return false;
    if (f.tier === 'B' && card.attribution !== 'B' && card.attribution !== 'mixed') return false;
    if (f.tier === 'none' && card.attribution !== 'none') return false;
    if (!words.length) return true;
    const hay = districtSearchText(card, index);
    return words.every((w) => hay.includes(w));
  });
}

export function sortDistricts(cards: readonly DistrictCard[], index: HgabDistrictIndex, key: DistrictSortKey): DistrictCard[] {
  if (key === 'name') return [...cards].sort((a, b) => a.label.localeCompare(b.label));
  const metric = new Map(cards.map((c) => [c.id, cardMetric(c, index, key)] as const));
  return [...cards].sort((a, b) => {
    const av = metric.get(a.id) ?? null;
    const bv = metric.get(b.id) ?? null;
    if (av == null && bv == null) return a.label.localeCompare(b.label);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av || a.label.localeCompare(b.label);
  });
}

/** Distinct region labels on the cards, north to south (`REGION_ORDER`), unrecognised ones last; the region select's options. */
export function regionsOf(index: HgabDistrictIndex): string[] {
  const rank = (r: string) => {
    const k = regionKeyOf(r);
    return k ? REGION_ORDER.indexOf(k) : REGION_ORDER.length;
  };
  return [...new Set(index.districts.map((d) => d.region).filter((r): r is string => Boolean(r)))].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true }),
  );
}

// ---------------------------------------------------------------------------
// Regions: the grid's sections
// ---------------------------------------------------------------------------

/** A region section: one of the 18 regions, or "other" for a label `regionKeyOf` does not recognise. */
export type RegionSectionKey = RegionKey | 'other';

/** The section a card sits in, from the region label the office-to-district map gives the district. */
export function districtRegionKey(card: Pick<DistrictCard, 'region'>): RegionSectionKey {
  return regionKeyOf(card.region) ?? 'other';
}

/** Element id of a region section, and the `#hash` that links to it: `region-III`, `region-IV-A`, `region-other`. */
export function regionAnchor(key: RegionSectionKey): string {
  return `region-${key}`;
}

/** `#region-III` → `III`; null for any other hash. */
export function regionFromHash(hash: string): RegionSectionKey | null {
  const m = /^#region-(.+)$/.exec(hash);
  if (!m) return null;
  const k = decodeURIComponent(m[1]);
  return k === 'other' || (REGION_ORDER as readonly string[]).includes(k) ? (k as RegionSectionKey) : null;
}

/** "Region III", "Central Luzon", "Region III · Central Luzon". */
export function regionNames(key: RegionSectionKey): { short: string; name: string; full: string } {
  if (key === 'other') return { short: 'Other', name: 'Region not recorded', full: 'Other · region not recorded' };
  const l = REGION_LABELS[key];
  return { ...l, full: `${l.short} · ${l.name}` };
}

/** The region select's option text for a label as the data prints it: "Region III · Central Luzon". */
export function regionOptionLabel(raw: string): string {
  const k = regionKeyOf(raw);
  return k ? regionNames(k).full : raw;
}

export interface RegionGroup {
  key: RegionSectionKey;
  /** In the caller's order, so a sort applies within each region. */
  cards: DistrictCard[];
}

/** Cards by region, in `REGION_ORDER` with "other" last. Empty regions are left out, so a filter hides them. */
export function groupDistrictsByRegion(cards: readonly DistrictCard[]): RegionGroup[] {
  const by = new Map<RegionSectionKey, DistrictCard[]>();
  for (const c of cards) {
    const k = districtRegionKey(c);
    const list = by.get(k);
    if (list) list.push(c);
    else by.set(k, [c]);
  }
  const order: RegionSectionKey[] = [...REGION_ORDER, 'other'];
  return order.filter((k) => by.has(k)).map((k) => ({ key: k, cards: by.get(k)! }));
}

export interface RegionTotals {
  districts: number;
  /** District engineering offices serving these districts, each counted once. */
  offices: number;
  /** Sum of those offices' 2026 enacted figures; null when none has one. */
  gaa2026_php: number | null;
  /** Sum of those offices' 2027 proposal (NEP) listings, whole office; null when none has one. */
  nep2027_php: number | null;
  /** Sum of those offices' 2027 House bill figures (named projects only); null when none has one. */
  hgab3_php: number | null;
  /**
   * House bill minus proposal on the compared population (the offices'
   * `fy2027` blocks, same named projects), summed over offices that carry
   * both figures; null when none does. Not `hgab3_php − nep2027_php`: the
   * proposal listing is the whole office, the House bill named projects only.
   */
  delta_php: number | null;
  /** The proposal side of `delta_php` (same named projects), for a percentage. */
  compared_nep_php: number | null;
}

/**
 * A region's summary line. Every office serving the given districts is summed
 * ONCE, so a shared (Tier B) office is never double-counted; an office's
 * districts all sit in its own region, so regions never overlap either.
 */
export function regionTotals(cards: readonly DistrictCard[], index: HgabDistrictIndex): RegionTotals {
  const offices = new Map<string, OfficeHistory>();
  for (const c of cards) for (const o of cardOffices(c, index)) offices.set(o.id, o);
  let gaa: number | null = null;
  let nep: number | null = null;
  let h3: number | null = null;
  let delta: number | null = null;
  let cnep: number | null = null;
  for (const o of offices.values()) {
    const g = yearAmount(o, 2026, 'gaa');
    if (g != null) gaa = (gaa ?? 0) + g;
    const n = yearAmount(o, 2027, 'nep');
    if (n != null) nep = (nep ?? 0) + n;
    const h = yearAmount(o, 2027, 'hgab3');
    if (h != null) h3 = (h3 ?? 0) + h;
    const f = o.fy2027;
    if (f && f.nep_php != null && f.hgab3_php != null) {
      delta = (delta ?? 0) + (f.hgab3_php - f.nep_php);
      cnep = (cnep ?? 0) + f.nep_php;
    }
  }
  return {
    districts: cards.length, offices: offices.size, gaa2026_php: gaa, nep2027_php: nep, hgab3_php: h3,
    delta_php: delta, compared_nep_php: cnep,
  };
}

/** Every region section in page order: `REGION_ORDER`, then "other". */
export const REGION_SECTION_ORDER: readonly RegionSectionKey[] = [...REGION_ORDER, 'other'];

// ---------------------------------------------------------------------------
// The list's addresses: `?view=list`, `#region-<key>`, `#d-<district>`
// ---------------------------------------------------------------------------

/** `/hgab/2027/districts?view=list`, with `#<anchor>` when given: the list, opened at a region or a card. */
export function districtListHref(anchor?: string): string {
  return `${districtPath()}?view=list${anchor ? `#${anchor}` : ''}`;
}

/**
 * Element id of a district's card, and the `#hash` that links to it:
 * `leg:bulacan:1st` → `d-bulacan-1st`. Ids are unique after slugging (the
 * verifier's district ids are lower-case words joined by `:`).
 */
export function districtAnchor(id: string): string {
  return `d-${id.replace(/^leg:/, '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

/** `#d-bulacan-1st` → `d-bulacan-1st`; null for any other hash. Resolve it with a map built from `districtAnchor`. */
export function districtAnchorFromHash(hash: string): string | null {
  const m = /^#(d-.+)$/.exec(hash);
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------------------------------------------------------------------------
// The sidebar's tree: regions → districts
// ---------------------------------------------------------------------------

export interface SidebarDistrict {
  id: string;
  label: string;
  anchor: string;
  /** The card's 2027 House bill figure (its offices' named projects, undivided); null when none. */
  hgab3_php: number | null;
  /** Tier B or mixed: the figure is a shared office total, not the district's own. */
  shared: boolean;
  /** No office found, so no figure. */
  none: boolean;
}

export interface SidebarRegion {
  key: RegionSectionKey;
  anchor: string;
  districts: SidebarDistrict[];
}

/** Districts by region in `REGION_ORDER`, each region's districts by name ("2nd" before "10th"). Empty regions are left out. */
export function sidebarRegions(cards: readonly DistrictCard[]): SidebarRegion[] {
  return groupDistrictsByRegion(cards).map((g) => ({
    key: g.key,
    anchor: regionAnchor(g.key),
    districts: g.cards
      .map((c) => ({
        id: c.id,
        label: c.label,
        anchor: districtAnchor(c.id),
        hgab3_php: c.headline.fy2027_hgab3_php,
        shared: c.attribution === 'B' || c.attribution === 'mixed',
        none: c.attribution === 'none',
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true })),
  }));
}

/**
 * Districts served by the Bangsamoro (BARMM) regional grouping that the
 * office-to-district map files under another region. Named on that region's
 * heading so a reader looking for Bangsamoro can find them.
 */
export function bangsamoroDistricts(cards: readonly DistrictCard[], index: HgabDistrictIndex): DistrictCard[] {
  return cards.filter(
    (c) => districtRegionKey(c) !== 'BARMM' && cardRegionalGroups(c, index).some((g) => regionKeyOf(g.name) === 'BARMM'),
  );
}

// ---------------------------------------------------------------------------
// Residual: the money that appears on no district card
// ---------------------------------------------------------------------------

/** Money under Central Office, regional offices and offices we could not place — on no district card. */
export function residualUnattributed(y: ResidualYear): number {
  return y.central_office_php + y.regional_offices_php + y.unmatched_php;
}

/** "the DPWH Central Office or a regional office", adding the unplaced offices only when that year has any. */
export function residualWhere(y: ResidualYear): string {
  return y.unmatched_php > 0
    ? 'the DPWH Central Office, a regional office or an office we could not place'
    : 'the DPWH Central Office or a regional office';
}

/** Share of the year's total that no district card shows (0–1), null when the total is 0. */
export function residualShare(y: ResidualYear): number | null {
  return y.total_php ? residualUnattributed(y) / y.total_php : null;
}

/** True when, in every listed year, more than half of DPWH money appears on no district card. */
export function residualMostlyOffCards(residual: readonly ResidualYear[]): boolean {
  return residual.length > 0 && residual.every((y) => (residualShare(y) ?? 0) > 0.5);
}

/** The residual row the headline sentence quotes: FY2027 HGAB 3R, else the last listed year. */
export function headlineResidual(residual: readonly ResidualYear[]): ResidualYear | null {
  return residual.find((y) => y.fy === 2027 && y.stage === 'hgab3') ?? residual[residual.length - 1] ?? null;
}
