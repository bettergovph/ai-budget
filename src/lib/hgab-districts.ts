/**
 * Pure helpers for the Districts lens (`/hgab/2027/districts`): URL state,
 * the nine-slot fiscal history every chart and table draws, the metrics the
 * grid sorts on, and the filters. No React and no DOM, so the pages and the
 * presentational bits share one definition of every derived figure.
 *
 * Rules enforced here, matching the DEO2LEG lens conditions:
 *   - an office's money is never divided among the districts it serves; card
 *     metrics sum UNDIVIDED office totals and callers must label them so;
 *   - null stays null (an office not found in a year's data), never 0;
 *   - stages are compared, never added: a GAA subtotal counts GAA years only,
 *     and FY2027 NEP / HGAB 3R are proposals listed beside it.
 */
import {
  CONGRESS_TERMS, datasetPath, pctChange,
  type CongressTerm, type DistrictCard, type DistrictRepresentative, type FiscalStage,
  type HgabDistrictIndex, type OfficeHistory, type ResidualYear,
} from './hgab';

// ---------------------------------------------------------------------------
// URL state (`?q=…&region=…&tier=…&sort=…`)
// ---------------------------------------------------------------------------

export type DistrictSortKey = 'hgab3' | 'gaa2026' | 'change' | 'growth' | 'name';
/** `A` = attributable only; `B` = shared or mixed; `none` = no office ledger. */
export type TierFilter = '' | 'A' | 'B' | 'none';

export const DEFAULT_DISTRICT_SORT: DistrictSortKey = 'hgab3';

export const DISTRICT_SORT_LABELS: Record<DistrictSortKey, string> = {
  hgab3: 'FY2027 HGAB 3R · largest first',
  gaa2026: 'FY2026 GAA · largest first',
  change: 'FY2027 change vs NEP · largest first',
  growth: 'Growth, 18th → 20th Congress · largest first',
  name: 'District · A → Z',
};

export const TIER_FILTER_LABELS: Record<Exclude<TierFilter, ''>, string> = {
  A: 'Tier A · attributable to one district',
  B: 'Tier B or mixed · undivided office totals',
  none: 'No office ledger',
};

export interface DistrictFilters {
  /** Free text over district, representative, candidates, region and office names. */
  q: string;
  region: string;
  tier: TierFilter;
  sort: DistrictSortKey;
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
  };
}

/** Filters → URL, writing only non-default values so shared links stay short. */
export function paramsFromDistrictFilters(f: DistrictFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.region) p.set('region', f.region);
  if (f.tier) p.set('tier', f.tier);
  if (f.sort !== DEFAULT_DISTRICT_SORT) p.set('sort', f.sort);
  return p;
}

export function hasDistrictFilters(f: DistrictFilters): boolean {
  return Boolean(f.q.trim() || f.region || f.tier);
}

// ---------------------------------------------------------------------------
// Fiscal stages and the nine history slots
// ---------------------------------------------------------------------------

export const FISCAL_STAGE_SHORT: Record<FiscalStage, string> = { gaa: 'GAA', nep: 'NEP', hgab3: 'HGAB 3R' };
export const FISCAL_STAGE_LONG: Record<FiscalStage, string> = {
  gaa: 'General Appropriations Act — enacted',
  nep: 'National Expenditure Program — the President’s proposal',
  hgab3: 'House Bill 10858, third reading — the House’s proposal, not yet enacted',
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

/** "FY2026 GAA", "FY2027 HGAB 3R". */
export function slotLabel(s: { fy: number; stage: FiscalStage }): string {
  return `FY${s.fy} ${FISCAL_STAGE_SHORT[s.stage]}`;
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

export const ATTRIBUTION_LABELS: Record<DistrictCard['attribution'], { short: string; label: string; help: string }> = {
  A: {
    short: 'Tier A',
    label: 'Tier A · attributable',
    help: 'Every office serving this district serves it alone, so its totals are attributable to this district.',
  },
  B: {
    short: 'Tier B',
    label: 'Tier B · undivided office total',
    help: 'Every office serving this district also serves others. Figures are undivided office totals shared with the named co-served districts; nothing is split.',
  },
  mixed: {
    short: 'Mixed',
    label: 'Mixed · undivided office total',
    help: 'Some serving offices are shared with other districts. Figures add Tier A totals to undivided Tier B totals; nothing is split.',
  },
  none: {
    short: 'No ledger',
    label: 'No office ledger',
    help: 'No district engineering office ledger could be joined to this district, so there is no figure to show. The absence of a figure is not evidence of no funding.',
  },
};

/** "Tier A · attributable" or "Tier B · shared with 2". */
export function officeTierText(tier: 'A' | 'B', sharedWith: number): string {
  return tier === 'A' ? 'Tier A · attributable' : `Tier B · shared with ${sharedWith}`;
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

/** Display name of a seat's holder; ambiguous seats list every candidate. */
export function repName(rep: DistrictRepresentative | null | undefined): string {
  if (!rep) return 'Representative not resolved';
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

export function filterDistricts(index: HgabDistrictIndex, f: DistrictFilters): DistrictCard[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return index.districts.filter((card) => {
    if (f.region && (card.region ?? '') !== f.region) return false;
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

/** Distinct regions on the cards, sorted; the region select's options. */
export function regionsOf(index: HgabDistrictIndex): string[] {
  return [...new Set(index.districts.map((d) => d.region).filter((r): r is string => Boolean(r)))].sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true }),
  );
}

// ---------------------------------------------------------------------------
// Residual
// ---------------------------------------------------------------------------

/** Money under Central Office, regional offices and unmatched units — on no district card. */
export function residualUnattributed(y: ResidualYear): number {
  return y.central_office_php + y.regional_offices_php + y.unmatched_php;
}

/** Share of the year's total that no district card shows (0–1), null when the total is 0. */
export function residualShare(y: ResidualYear): number | null {
  return y.total_php ? residualUnattributed(y) / y.total_php : null;
}

/** The residual row the headline sentence quotes: FY2027 HGAB 3R, else the last listed year. */
export function headlineResidual(residual: readonly ResidualYear[]): ResidualYear | null {
  return residual.find((y) => y.fy === 2027 && y.stage === 'hgab3') ?? residual[residual.length - 1] ?? null;
}
