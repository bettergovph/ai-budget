/**
 * The Senate committee report's district cards. Jason (2026-11-23): "the senate's design district is different, where
 * are the cards??" The Senate list (`/senate/2027/districts?view=list`) draws the House bill's cards, list and sidebar
 * (HgabDistrictBits, HgabDistrictSidebar, HgabDistricts' `DistrictsCardsList`) through `DistrictSiteContext`
 * (lib/district-site.ts), with the Senate's addresses, figures and words:
 *
 * - the card's first tab, "2027: House bill vs Senate": House bill → Senate on the office's projects, a bar of the
 *   budget the report moves (cut to ₱0, reduced, raised), and each status's projects and pesos, beside the House
 *   insertions it keeps;
 * - a fourth figure under History, the Senate's, with its change from the House bill;
 * - the sorts by the Senate's figure ("Largest Senate committee report amount", "Biggest cut from the House bill");
 * - the sidebar's and each region heading's figure, the Senate's.
 *
 * Office figures follow the House pages' rules (scripts/senate-cr/build_districts.py): an office that serves several
 * districts is shown whole, never split; lines that changed office or have none are held out.
 */
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DisclaimerNotice, SignedPhp } from './HgabBits';
import { Fy27Headline } from './HgabDistrictBits';
import { SenateHeader, SenateHero, SenateReviewBanner } from './SenateBits';
import * as fmt from '../lib/format';
import { longDate } from '../lib/seo';
import { DistrictSiteContext, type DistrictSite } from '../lib/district-site';
import type { DistrictCard, HgabDistrictIndex, OfficeHistory } from '../lib/hgab';
import { DISTRICT_SORT_LABELS, TIER_MEANING, cardOffices, dpwhOfficeName, type DistrictSortKey, type OfficeGroup } from '../lib/hgab-districts';
import { DEO_MEANING } from '../lib/hgab-leaderboard';
import { senateListPath } from '../lib/senate';
import {
  SENATE_DISTRICTS_ROOT, SenateDistrictsContext, senateDistrictPath, senateDistrictsHref, sumOfficeIds, useSenateDistricts,
  type SenateDistrictsData, type SenateDistrictsFile, type SenateOfficeStatus,
} from '../lib/senate-districts';

const SOURCES = 'SOURCES: SENATE COMMITTEE REPORT ON HOUSE BILL 10858 (ANNEX A-4); HOUSE BILL 10858, THIRD READING; ENACTED BUDGETS (GAA) 2020–2026; DEO2LEG OFFICE-TO-DISTRICT MAP; BILLS.JURIS.PH';

/** The panel's cells, in the House panel's colours: a cut reads as a deletion, a reduction as a decrease. */
const PANEL_ROWS: ReadonlyArray<{ status: SenateOfficeStatus; group: string; label: string; sub: string }> = [
  { status: 'cut', group: 'nep_only', label: 'Cut to ₱0', sub: 'the report removes it' },
  { status: 'reduced', group: 'decreased', label: 'Reduced', sub: 'less in the report' },
  { status: 'raised', group: 'increased', label: 'Raised', sub: 'more in the report' },
  { status: 'renamed', group: 'scope_review', label: 'Renamed', sub: 'same amount; name or stations corrected' },
  { status: 'unchanged', group: 'unchanged', label: 'Kept as is', sub: 'not in the report, so unchanged' },
];

/** "−₱1.2B", "+₱30.0M", "₱688.8M"; "—" when the group is empty. */
function amount(sign: '+' | '−' | '', rows: number, php: number): string {
  if (!rows && !php) return '—';
  return `${php ? sign : ''}${fmt.php(Math.abs(php))}`;
}

/** The 2027 House bill label the Senate rows carry for an office (the project list's office filter). */
const officeLabel = (o: OfficeHistory) => o.years.find((y) => y.fy === 2027 && y.stage === 'hgab3')?.matched_label ?? o.name;

/**
 * One office in the Senate committee report, in the House card's 2027 panel: House bill → Senate and the net change, a
 * bar of the budget the report moves (cuts hatched), then each status with its projects and pesos.
 */
export function SenateOfficePanel({ office, withName = false }: { office: OfficeHistory; withName?: boolean }) {
  const senate = useSenateDistricts();
  const s = senate?.offices[office.id];
  const name = withName ? <p className="hgab-dc-br-office">{dpwhOfficeName(office.name)}</p> : null;
  if (!s || !s.rows) {
    return (
      <div className="hgab-dc-br">
        {name}
        <p className="hgab-dc-br-empty">No House bill project of this office in the Senate committee report.</p>
      </div>
    );
  }
  const st = s.status;
  const cells = PANEL_ROWS.map((r) => {
    const t = st[r.status];
    const moved = r.status === 'cut' ? -t.house_php : r.status === 'reduced' || r.status === 'raised' ? t.senate_php - t.house_php : null;
    return {
      ...r, rows: t.rows,
      // Cut, reduced and raised show what the report moves; renamed and kept as is, what it gives.
      text: moved != null ? amount(moved < 0 ? '−' : '+', t.rows, moved) : amount('', t.rows, t.senate_php),
      title: `${r.label}: ${t.rows.toLocaleString()} ${t.rows === 1 ? 'project' : 'projects'}, House bill ${fmt.php(t.house_php, { unit: 'full' })} → Senate ${fmt.php(t.senate_php, { unit: 'full' })}`,
      moved: moved == null ? 0 : Math.abs(moved),
    };
  });
  const moving = cells.filter((c) => c.moved > 0);
  const total = moving.reduce((a, c) => a + c.moved, 0);
  const ins = s.inserted;
  return (
    <div className="hgab-dc-br">
      {name}
      <Fy27Headline
        nep={s.house_php}
        hgab3={s.senate_php}
        net={s.senate_php - s.house_php}
        from="House bill"
        to="Senate"
        scope="The office’s House bill projects, in the House bill and the Senate committee report"
      />
      {total > 0 && (
        <span className="hgab-dc-br-bar" role="img" aria-label={`What the Senate committee report changes: ${moving.map((c) => `${c.label} ${c.text}`).join(', ')}`}>
          {moving.map((c) => <span key={c.status} className={`is-${c.group}`} style={{ width: `${(c.moved / total) * 100}%` }} />)}
        </span>
      )}
      <dl className="hgab-dc-br-grid">
        {cells.map((c) => (
          <div key={c.status} className={`hgab-dc-br-cell is-${c.group} ${c.rows ? '' : 'is-zero'}`.trim()} title={c.title}>
            <dt>{c.label}<small>{c.sub}</small></dt>
            <dd>
              <strong>{c.text}</strong>
              <span>{c.rows.toLocaleString()} {c.rows === 1 ? 'project' : 'projects'}</span>
            </dd>
          </div>
        ))}
        <div
          className={`hgab-dc-br-cell is-house_only ${ins.rows ? '' : 'is-zero'}`.trim()}
          title={`House insertions (no matching NEP line): ${ins.rows.toLocaleString()}, ${fmt.php(ins.house_php, { unit: 'full' })} in the House bill. The report cuts ${ins.cut_rows.toLocaleString()} (${fmt.php(ins.cut_php, { unit: 'full' })}) and keeps ${ins.kept_rows.toLocaleString()} (${fmt.php(ins.kept_php, { unit: 'full' })}). Also counted in the cells beside.`}
        >
          <dt>House insertions kept<small>not in the NEP; also counted beside</small></dt>
          <dd>
            <strong>{amount('', ins.kept_rows, ins.kept_php)}</strong>
            <span>{ins.kept_rows.toLocaleString()} of {ins.rows.toLocaleString()} {ins.rows === 1 ? 'project' : 'projects'}</span>
          </dd>
        </div>
      </dl>
      <p className="hgab-dc-br-note">The report changes amounts; it does not say why, or who asked.</p>
    </div>
  );
}

/** A district's offices in the Senate committee report, added up (each office once). */
function cardSenate(d: SenateDistrictsFile, card: DistrictCard, index: HgabDistrictIndex) {
  return sumOfficeIds(d, cardOffices(card, index).map((o) => o.id));
}

function senateSite(data: SenateDistrictsData): DistrictSite {
  const { house, senate } = data;
  const byId = new Map(house.districts.map((c) => [c.id, c] as const));
  const placed = senateDistrictsHref('list-legislative');
  const offCard = senate.total.senate_php - senate.deo.senate_php;
  const sortMetric = (t: ReturnType<typeof sumOfficeIds>, key: DistrictSortKey) =>
    !t ? undefined : key === 'hgab3' ? t.senate_php : key === 'change' ? t.house_php - t.senate_php : undefined;
  return {
    root: SENATE_DISTRICTS_ROOT,
    districtHref: (id) => (id ? senateDistrictPath(id) : SENATE_DISTRICTS_ROOT),
    placedHref: (anchor) => `${placed}${anchor ? `#${anchor}` : ''}`,
    officeProjectsHref: (o) => senateListPath('dpwh', 'office', officeLabel(o)),
    fy27Label: '2027: House bill vs Senate',
    Fy27Panel: SenateOfficePanel,
    extraFigure: (offices) => {
      const t = sumOfficeIds(senate, offices.map((o) => o.id));
      if (!t) return null;
      return {
        label: '2027 Senate',
        title: 'The Senate committee report on the House bill (Annex A-4): the office’s House bill projects.',
        php: t.senate_php,
        delta: (
          <span className="hgab-delta-line" title={`Senate committee report against the House bill, same projects: House bill ${fmt.php(t.house_php, { unit: 'full' })} → Senate ${fmt.php(t.senate_php, { unit: 'full' })}`}>
            <SignedPhp value={t.senate_php - t.house_php} /> <span className="hgab-delta">vs the House bill</span>
          </span>
        ),
      };
    },
    sortLabels: { ...DISTRICT_SORT_LABELS, hgab3: 'Largest Senate committee report amount', change: 'Biggest cut from the House bill' },
    cardMetric: (card, index, key) => sortMetric(cardSenate(senate, card, index), key),
    groupMetric: (group: OfficeGroup, key) => sortMetric(sumOfficeIds(senate, group.offices.map((o) => o.id)), key),
    amountLabel: '2027 Senate committee report',
    officeAmount: (ids) => sumOfficeIds(senate, ids)?.senate_php ?? null,
    sidebarAmount: (id) => {
      const card = byId.get(id);
      const t = card ? cardSenate(senate, card, house) : null;
      return t ? { php: t.senate_php, title: `Senate committee report ${fmt.php(t.senate_php, { unit: 'full' })} (House bill ${fmt.php(t.house_php, { unit: 'full' })})` } : null;
    },
    regionFigure: (cards, index) => {
      const ids = cards.flatMap((c) => cardOffices(c, index).map((o) => o.id));
      const t = sumOfficeIds(senate, ids);
      return t ? { label: 'Senate committee report', php: t.senate_php } : null;
    },
    Header: SenateHeader,
    Hero: SenateHero,
    list: {
      dek: (
        <>
          One card per legislative district, with the DPWH office that serves it. Its first tab shows what the Senate
          committee report does with the office’s House bill projects; History shows the office’s budget since 2020. A
          DPWH office that serves several districts has one card, listing each district and its representative. {TIER_MEANING}
        </>
      ),
      heroNote: (
        <>
          The representative shown holds the seat in the 20th Congress. Nothing here says or implies that a representative
          requested, sponsored or controlled a project. The Senate committee report changes amounts; it does not say why, or
          who asked. {DEO_MEANING}
        </>
      ),
      banner: <SenateReviewBanner compact />,
      offCard: (
        <p className="hgab-dx-offcard">
          <strong>{fmt.pct(offCard / senate.total.senate_php, 1)}</strong> of the DPWH budget in the Senate committee report
          ({fmt.php(offCard)}) is on no district card, most of it under the Central Office.{' '}
          <Link to={SENATE_DISTRICTS_ROOT}>See where it is →</Link>{' '}
          <Link to={placed}>Or see each project placed in its district →</Link>
        </p>
      ),
      asOf: (
        <p className="hgab-dx-asof">
          {senate.built_at && <>As of {longDate(senate.built_at.slice(0, 10))} · </>}The Senate committee report on House Bill 10858 (Annex A-4),
          against the House bill at third reading
        </p>
      ),
      lede: (
        <p className="hgab-dx-lede">
          The Senate committee report lists the House bill’s DPWH projects it changes. A project it does not list keeps its
          House bill amount. A project it cuts to ₱0 is removed. The House bill and the report are versions of one budget:
          compare them, never add them.
        </p>
      ),
      note: (
        <p className="hgab-dx-note">
          Card figures are the office’s totals. The 2020–2026 figures are the enacted budgets (GAA) for the whole office. The
          2027 House bill and Senate figures cover the office’s named House bill projects; lines that changed office between
          the NEP and the House bill, or have no office, are held out, as on the House bill pages. A shared office has one card
          for all the districts it serves. A region’s totals add each office serving it once. A card’s “Projects” link opens
          the office’s projects in the Senate committee report.
        </p>
      ),
      foot: <DisclaimerNotice compact offices />,
      sources: SOURCES,
    },
  };
}

/** The Senate's site and data for the House district components under it. */
export function SenateDistrictsProvider({ data, children }: { data: SenateDistrictsData; children: ReactNode }) {
  const site = useMemo(() => senateSite(data), [data]);
  return (
    <SenateDistrictsContext.Provider value={data.senate}>
      <DistrictSiteContext.Provider value={site}>{children}</DistrictSiteContext.Provider>
    </SenateDistrictsContext.Provider>
  );
}
