/**
 * "Projects placed in each district" (`/hgab/2027/districts?view=list-legislative`): the list's URL state, its sort,
 * and the figures its cards and banner show, all from locations.json (contract: lib/hgab-locations.ts). Pure.
 *
 * Jason (2026-11-03): map every project to a place, as the multi-purpose buildings map does, and list it by district,
 * "a similar view [to `?view=list`] but their own individual district". The office list gives each district its DPWH
 * office's whole figure, shared and not split; here each district has only the lines placed in it.
 */
import type { DistrictCard } from './hgab';
import type { DistrictLocated, LocatedCell, LocationsData } from './hgab-locations';

export const PLACED_VIEW = 'list-legislative';

export type PlacedSortKey = 'house' | 'nep' | 'up' | 'down' | 'inserted' | 'dropped' | 'name';
export const PLACED_SORT_KEYS: readonly PlacedSortKey[] = ['house', 'nep', 'up', 'down', 'inserted', 'dropped', 'name'];
export const DEFAULT_PLACED_SORT: PlacedSortKey = 'house';
export const PLACED_SORT_LABELS: Record<PlacedSortKey, string> = {
  house: 'Largest House bill amount',
  nep: 'Largest NEP amount',
  up: 'Biggest increase from the NEP',
  down: 'Biggest cut from the NEP',
  inserted: 'Most in insertion candidates',
  dropped: 'Most in deletion candidates',
  name: 'Name',
};

export interface PlacedFilters {
  /** Free text over district, representative, region and office names (as the office list searches). */
  q: string;
  region: string;
  sort: PlacedSortKey;
  /** Cards under region headings (the default); `group=none` gives one sorted list. */
  group: boolean;
}

export function placedFiltersFromParams(params: URLSearchParams): PlacedFilters {
  const sort = params.get('sort');
  return {
    q: params.get('q') ?? '',
    region: params.get('region') ?? '',
    sort: (PLACED_SORT_KEYS as readonly string[]).includes(sort ?? '') ? (sort as PlacedSortKey) : DEFAULT_PLACED_SORT,
    group: params.get('group') !== 'none',
  };
}

export function paramsFromPlacedFilters(f: PlacedFilters): URLSearchParams {
  const p = new URLSearchParams({ view: PLACED_VIEW });
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.region) p.set('region', f.region);
  if (f.sort !== DEFAULT_PLACED_SORT) p.set('sort', f.sort);
  if (!f.group) p.set('group', 'none');
  return p;
}

/** The list, optionally at a card (`#d-…`) or a region (`#region-…`). */
export function placedListHref(anchor?: string): string {
  return `/hgab/2027/districts?view=${PLACED_VIEW}${anchor ? `#${anchor}` : ''}`;
}

// ---------------------------------------------------------------------------
// A district's figures
// ---------------------------------------------------------------------------

export type PlacedKind = keyof DistrictLocated['kinds'];

/**
 * The six kinds as a card lists them, in the office cards' order (insertion and deletion candidates first), with the
 * sign each adds to House bill − NEP.
 */
export const PLACED_KIND_ROWS: ReadonlyArray<{ kind: PlacedKind; label: string; sub: string; sign: '+' | '−' | '±' | '' }> = [
  { kind: 'inserted', label: 'Insertion candidates', sub: 'in the House bill only', sign: '+' },
  { kind: 'dropped', label: 'Deletion candidates', sub: 'in the NEP only', sign: '−' },
  { kind: 'increased', label: 'Increases', sub: 'higher in the House bill', sign: '+' },
  { kind: 'decreased', label: 'Decreases', sub: 'lower in the House bill', sign: '−' },
  { kind: 'scope_review', label: 'Scope review', sub: 'same road, different stretch', sign: '±' },
  { kind: 'unchanged', label: 'Unchanged', sub: 'same amount in both', sign: '' },
];

/**
 * What a kind shows, in pesos: an insertion candidate's House amount, a deletion candidate's NEP amount, the change
 * (House − NEP) for increases, decreases and scope review, and the amount itself when unchanged.
 */
export function kindPhp(kind: PlacedKind, c: LocatedCell): number {
  if (kind === 'inserted' || kind === 'unchanged') return c.house_php;
  if (kind === 'dropped') return c.nep_php;
  return c.house_php - c.nep_php;
}

/** House bill − NEP over the district's placed lines. */
export function placedNet(d: DistrictLocated): number {
  return d.all.house_php - d.all.nep_php;
}

const EMPTY: LocatedCell = { rows: 0, nep_php: 0, house_php: 0 };

/** Districts in the chosen order; those with nothing placed come last, by name. */
export function sortPlaced(cards: readonly DistrictCard[], placed: ReadonlyMap<string, DistrictLocated>, sort: PlacedSortKey): DistrictCard[] {
  const value = (c: DistrictCard): number => {
    const d = placed.get(c.id);
    if (!d) return Number.NEGATIVE_INFINITY;
    switch (sort) {
      case 'house': return d.all.house_php;
      case 'nep': return d.all.nep_php;
      case 'up': return placedNet(d);
      case 'down': return -placedNet(d);
      case 'inserted': return d.kinds.inserted.house_php;
      case 'dropped': return d.kinds.dropped.nep_php;
      case 'name': return 0;
    }
  };
  const byName = (a: DistrictCard, b: DistrictCard) => a.label.localeCompare(b.label, 'en', { numeric: true });
  return [...cards].sort((a, b) => {
    const pa = placed.has(a.id);
    const pb = placed.has(b.id);
    if (pa !== pb) return pa ? -1 : 1;
    return sort === 'name' ? byName(a, b) : value(b) - value(a) || byName(a, b);
  });
}

// ---------------------------------------------------------------------------
// What is placed, and what is not
// ---------------------------------------------------------------------------

export interface PlacedTotals {
  /** Every DPWH line of the comparison. */
  total: LocatedCell;
  /** Placed in one legislative district (the cards). */
  placed: LocatedCell;
  /** The title fixes no district and the office serves several: kept with the office, undivided. */
  shared: LocatedCell;
  /** No district engineering office to place it by: at its region. */
  region: LocatedCell;
  unassigned: LocatedCell;
  /** Placed by the source, held out by our check (the place named is outside its office's districts). */
  held: LocatedCell;
}

const add = (a: LocatedCell, b: LocatedCell): LocatedCell => ({
  rows: a.rows + b.rows, nep_php: a.nep_php + b.nep_php, house_php: a.house_php + b.house_php,
});

export function placedTotals(data: LocationsData): PlacedTotals {
  return {
    total: Object.values(data.totals).reduce(add, EMPTY),
    placed: data.districts.map((d) => d.all).reduce(add, EMPTY),
    shared: data.totals.deo,
    region: data.totals.region,
    unassigned: data.totals.unassigned,
    held: Object.values(data.held_out).reduce(add, EMPTY),
  };
}
