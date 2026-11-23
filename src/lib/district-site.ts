/**
 * Which site's district pages are drawing: the House bill's (`/hgab/2027/districts`, the default) or the Senate committee
 * report's (`/senate/2027/districts`). Jason (2026-11-23): "the senate's design district is different, where are the
 * cards??" The Senate pages draw the House bill's district cards, list and sidebar, given the Senate's addresses, its
 * 2027 panel and its figures through this context, as the leaderboards do (`leaderboard-site.ts`, #107).
 *
 * The House site is the default: src/components/HgabDistrictBits.tsx, which owns the House 2027 panel, registers it when
 * it loads (every district page draws its cards, so it is always loaded first); `useDistrictSite()` returns it when no
 * provider is set.
 */
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { DistrictCard, HgabDistrictIndex, OfficeHistory } from './hgab';
import type { DistrictSortKey, OfficeGroup } from './hgab-districts';

export interface DistrictSite {
  /** `/hgab/2027/districts`: the list (`?view=list`) and every district page hang off it. */
  root: string;
  districtHref: (id?: string) => string;
  /** The projects placed in each district (`?view=list-legislative`), opened at a district's anchor. */
  placedHref: (anchor?: string) => string;
  /** Every project recorded under an office. */
  officeProjectsHref: (o: OfficeHistory) => string;
  /** The card's first tab: its label, and the panel for one office. */
  fy27Label: string;
  Fy27Panel: ComponentType<{ office: OfficeHistory; withName?: boolean }>;
  /** One more figure under the History tab's 2027 House bill (the Senate's), or none. */
  extraFigure?: (offices: readonly OfficeHistory[]) => { label: string; title: string; php: number | null; delta?: ReactNode } | null;
  /** The list's sort options, in the reader's words. */
  sortLabels: Record<DistrictSortKey, string>;
  /** The figure a sort ranks a card or an office group by, where the site's differs from the House bill's. */
  cardMetric?: (card: DistrictCard, index: HgabDistrictIndex, key: DistrictSortKey) => number | null | undefined;
  groupMetric?: (group: OfficeGroup, key: DistrictSortKey) => number | null | undefined;
  /** The sidebar's figures in words ("2027 Senate committee report"; unset: "2027 House bill"). */
  amountLabel?: string;
  /** The sidebar's figure for an office group, by its office ids (the Senate's), else the House bill's. */
  officeAmount?: (officeIds: string[]) => number | null;
  /** The sidebar's figure for a district (the Senate's), else the House bill's. */
  sidebarAmount?: (districtId: string) => { php: number | null; title: string } | null | undefined;
  /** A region heading's last figure (the Senate's, beside the House bill's), or none. */
  regionFigure?: (cards: readonly DistrictCard[], index: HgabDistrictIndex) => { label: string; php: number } | null;
  /** The list page's chrome: header and hero. */
  Header: ComponentType<{ crumb?: ReactNode; compiledMeta?: ReactNode; heroBlend?: boolean }>;
  Hero: ComponentType<{ crumb: ReactNode; title: ReactNode; dek?: ReactNode; note?: ReactNode; children?: ReactNode; compact?: boolean }>;
  /** The list page's words, where the site's differ from the House bill's (unset: the House bill's). */
  list?: {
    dek?: ReactNode;
    heroNote?: ReactNode;
    /** A notice under the hero (the Senate's "under review" banner). */
    banner?: ReactNode;
    /** The line on the money on no card, above the cards. */
    offCard?: ReactNode;
    asOf?: ReactNode;
    lede?: ReactNode;
    note?: ReactNode;
    /** Everything under the note: disclaimer, changes, provenance, details for analysts. */
    foot?: ReactNode;
    sources?: string;
  };
}

export const DistrictSiteContext = createContext<DistrictSite | null>(null);

let houseSite: DistrictSite | null = null;
/** Called once by src/components/HgabDistrictBits.tsx with the House bill's site. */
export function registerHouseDistrictSite(site: DistrictSite): void {
  houseSite = site;
}

/** The district site drawing: the provider's, else the House bill's. */
export function useDistrictSite(): DistrictSite {
  const site = useContext(DistrictSiteContext) ?? houseSite;
  if (!site) throw new Error('useDistrictSite: the House district site is not registered (import HgabDistrictBits first)');
  return site;
}
