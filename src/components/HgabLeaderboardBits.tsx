/**
 * Pieces of the FY2027 House bill leaderboards (`/hgab/2027/leaderboard`):
 * the round portrait with an initials fallback, the gallery tiles, and the
 * accessible tables under each board's share image.
 *
 * Everything here is plain HTML. The canvas share image is drawn by
 * `HgabShareCard` on the board page only, one at a time, because it loads
 * about ten portraits; a gallery of seventeen canvases would load hundreds.
 *
 * Integrity rules carried from the section: amounts belong to DPWH district
 * offices, never to the people shown; a shared office (Tier B) is listed with
 * every district it serves and its amount is never split; nothing here says
 * who asked for a project.
 *
 * Styles: src/hgab-leaderboard.css (.hgab-lb-*).
 */
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { REGION_LABELS, type RegionKey } from '../lib/hgab';
import {
  BOARDS, displayName, formatPesoFull, formatValue, leaderboardPath, officeLabel, rankByCongress, rankEntries,
  rankMembers, rankRegions, shortDistrict,
  type BoardDef, type LeaderEntry, type LeaderPerson, type LeaderRegion, type LeaderSlice, type LeaderboardData,
  type RankedPerson, type RankedRow, type ShareFormat, type ValueKind,
} from '../lib/hgab-leaderboard';

// ---------------------------------------------------------------------------
// Wording the contract does not carry: column headings per board
// ---------------------------------------------------------------------------

const VALUE_HEADING: Record<string, string> = {
  'regions-added': 'In added projects',
  'regions-change': 'Change from the NEP',
  'house-bill-largest': 'House bill total',
  'added-money': 'In added projects',
  'added-count': 'Added projects',
  increase: 'Change from the NEP',
  'increase-pct': 'Change from the NEP',
  cuts: 'Change from the NEP',
  dropped: 'In NEP-only projects',
  'added-share': 'Share in added projects',
  'enacted-total': 'Enacted, 2020 to 2026',
  'enacted-2026': 'Enacted, 2026',
  'by-congress': 'Enacted total',
  growth: 'Change in yearly average',
  decline: 'Change in yearly average',
  bills: 'Bills as principal author',
};

const DETAIL_HEADING: Record<string, string> = {
  'house-bill-largest': 'Budget lines',
  'added-money': 'Projects',
  'added-count': 'Worth',
  increase: 'NEP → House bill',
  'increase-pct': 'NEP → House bill',
  cuts: 'NEP → House bill',
  dropped: 'Projects',
  'added-share': 'Added of the total',
  'enacted-total': 'Years with a figure',
  growth: 'Yearly average, 2020–2022 → 2026',
  decline: 'Yearly average, 2020–2022 → 2026',
};

/**
 * The growth boards carry no detail line in the contract; the table shows the
 * two averages the percentage compares (the 18th Congress years with a
 * figure, against 2026), the same rule as `growth_pct`.
 */
function yearlyShift(e: LeaderEntry): string | null {
  const years = e.gaa_years.filter((y) => y >= 2020 && y <= 2022).length;
  const c18 = e.congress['18'];
  const y26 = e.gaa['2026'];
  if (!years || c18 == null || y26 == null) return null;
  return `${formatValue(c18 / years, 'php')} a year → ${formatValue(y26, 'php')}`;
}

function detailOf(board: BoardDef): ((e: LeaderEntry) => string | null) | undefined {
  return board.detail ?? (board.id === 'growth' || board.id === 'decline' ? yearlyShift : undefined);
}

/** What the detail column says when a board's detail line is empty on purpose. */
const DETAIL_EMPTY: Record<string, string> = {
  'enacted-total': 'All 7 years',
};

/** Unit printed after a count on a tile ("214 projects"). */
const COUNT_UNIT: Record<string, [string, string]> = {
  'added-count': ['project', 'projects'],
  bills: ['bill', 'bills'],
};

function valueHeading(board: BoardDef): string {
  return VALUE_HEADING[board.id] ?? 'Figure';
}

const isMoney = (k: ValueKind) => k === 'php' || k === 'signed_php';

function toneOf(v: number, kind: ValueKind): string {
  if (kind !== 'signed_php' && kind !== 'pct') return '';
  return v > 0 ? 'is-up' : v < 0 ? 'is-down' : '';
}

/** "Metro Manila", or the key itself when it is not one of the eighteen. */
function regionName(key: string): string {
  return REGION_LABELS[key as RegionKey]?.name ?? key;
}

// ---------------------------------------------------------------------------
// Portrait
// ---------------------------------------------------------------------------

const SKIP = /^(Jr\.?|Sr\.?|I{1,3}|IV|V|Atty\.?|Dr\.?|Engr\.?|Hon\.?|RN|MD)$/i;

/** First and last initials of the display name: "JB Bernos" → "JB"; nicknames and suffixes are skipped. */
function initials(raw: string | null | undefined): string {
  if (!raw) return '?';
  const first = raw.split(' / ')[0];
  const words = displayName(first)
    .replace(/[“"][^”"]*[”"]/g, ' ')
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SKIP.test(w) && /\p{L}/u.test(w));
  if (!words.length) return '?';
  const a = words[0].match(/\p{L}/u)?.[0] ?? '';
  const b = words.length > 1 ? words[words.length - 1].match(/\p{L}/u)?.[0] ?? '' : '';
  return (a + b).toUpperCase() || '?';
}

/**
 * A round portrait. The name is always printed beside it, so the image is
 * decorative (empty alt). Initials sit underneath and show when there is no
 * portrait or it fails to load; the failure flips a class instead of setting
 * state, as the district cards do, so a blocked image host costs nothing.
 */
export function Face({
  person,
  size = 32,
  className = '',
}: {
  person: Pick<LeaderPerson, 'name' | 'portrait_url'> | null | undefined;
  size?: number;
  className?: string;
}) {
  const url = person?.portrait_url ?? null;
  return (
    <span
      className={`hgab-lb-face ${url ? '' : 'is-empty'} ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}
      aria-hidden="true"
    >
      <span className="hgab-lb-face-init">{initials(person?.name)}</span>
      {url && (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={(e) => e.currentTarget.parentElement?.classList.add('is-broken')}
        />
      )}
    </span>
  );
}

/** Up to three overlapping faces for an office that serves several districts. */
function Faces({ people, size }: { people: LeaderPerson[]; size: number }) {
  const shown = people.slice(0, 3);
  return (
    <span className={`hgab-lb-faces ${shown.length > 1 ? 'is-stack' : ''}`.trim()}>
      {shown.map((p) => <Face key={p.district_id} person={p} size={size} />)}
    </span>
  );
}

/** The seat holder's name, or the district when no representative was found. */
function personLabel(p: LeaderPerson | undefined): string {
  if (!p) return '—';
  return p.name ? displayName(p.name) : p.district;
}

// ---------------------------------------------------------------------------
// Gallery tile
// ---------------------------------------------------------------------------

interface TileRow {
  key: string;
  rank: number;
  people: LeaderPerson[];
  label: string;
  sub: string;
  value: number;
}

/** A shared group is headlined by its office, never by one representative, so its total never reads as one person's. */
function entryTileRow(rank: number, e: LeaderEntry, value: number): TileRow {
  const p0 = e.people[0];
  const office = officeLabel(e);
  return {
    key: e.key,
    rank,
    people: e.people,
    label: office ?? personLabel(p0),
    sub: office ? `Serves ${e.people.length} districts · not split` : p0 ? shortDistrict(p0) : e.key,
    value,
  };
}

function personTileRow(r: RankedPerson): TileRow {
  return { key: r.person.district_id, rank: r.rank, people: [r.person], label: personLabel(r.person), sub: shortDistrict(r.person), value: r.value };
}

/** The value as a tile prints it: "₱3.42B", "+41.7%", "214 projects". */
function tileValue(board: BoardDef, v: number): string {
  const unit = COUNT_UNIT[board.id];
  const s = formatValue(v, board.value);
  return unit ? `${s} ${v === 1 ? unit[0] : unit[1]}` : s;
}

/**
 * One board in the gallery: kicker, title, the top three and a link to the
 * board. The whole tile is the link target (the title's link is stretched),
 * so "Open" is decoration rather than a second link to the same page.
 */
export function BoardTile({ data, board, region }: { data: LeaderboardData; board: BoardDef; region: string | null }) {
  const scoped = board.regionFilter ? region : null;
  const to = leaderboardPath(board.id, { region: scoped });
  let body: ReactNode;

  if (board.kind === 'shift') {
    body = <ShiftMini data={data} />;
  } else if (board.kind === 'regions') {
    body = <RegionsMini data={data} board={board} />;
  } else if (board.kind === 'congress') {
    const terms = rankByCongress(data, { region: scoped, limit: 1 });
    body = (
      <ol className="hgab-lb-top is-congress">
        {terms.map((t) => {
          const r = t.rows[0];
          if (!r) return <li key={t.congress} className="hgab-lb-top-empty">{t.congress}th Congress: no figure</li>;
          const row = entryTileRow(r.rank, r.entry, r.value);
          return (
            <li key={t.congress}>
              <span className="hgab-lb-top-rank is-term">{t.congress}th</span>
              <Faces people={row.people} size={32} />
              <span className="hgab-lb-top-who">
                <strong>{row.label}</strong>
                <small>{t.years} · {row.sub}</small>
              </span>
              <span className="hgab-lb-top-val" title={formatPesoFull(r.value)}>{formatValue(r.value, 'php')}</span>
            </li>
          );
        })}
      </ol>
    );
  } else {
    const rows: TileRow[] = board.kind === 'members'
      ? rankMembers(data, { region: scoped, limit: 3 }).rows.map(personTileRow)
      : rankEntries(data, board, { region: scoped, limit: 3 }).rows.map((r) => entryTileRow(r.rank, r.entry, r.value));
    const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0) || 1;
    body = rows.length === 0 ? (
      <p className="hgab-lb-top-none">No district office {scoped ? `in ${regionName(scoped)} ` : ''}is on this board.</p>
    ) : (
      <ol className="hgab-lb-top">
        {rows.map((r, i) => (
          <li key={r.key} className={i === 0 ? 'is-first' : undefined}>
            <span className="hgab-lb-top-rank">{r.rank}</span>
            <Faces people={r.people} size={i === 0 ? 44 : 32} />
            <span className="hgab-lb-top-who">
              <strong>{r.label}</strong>
              <small>{r.sub}</small>
              <span className="hgab-lb-top-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(4, (Math.abs(r.value) / max) * 100)}%` }} />
              </span>
            </span>
            <span
              className={`hgab-lb-top-val ${toneOf(r.value, board.value)}`.trim()}
              title={isMoney(board.value) ? formatPesoFull(r.value) : undefined}
            >
              {tileValue(board, r.value)}
            </span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <article className={`hgab-lb-tile is-${board.kind}`}>
      <p className="hgab-lb-tile-kicker">{board.kicker}</p>
      <h3 className="hgab-lb-tile-title">
        <Link to={to}>{board.title}</Link>
      </h3>
      {scoped && <p className="hgab-lb-tile-scope">{regionName(scoped)} only</p>}
      {body}
      <span className="hgab-lb-tile-open" aria-hidden="true">Open →</span>
    </article>
  );
}

const KINDS: ReadonlyArray<{ key: keyof LeaderboardData['totals']['by_office_kind']; label: string }> = [
  { key: 'deo', label: 'District offices' },
  { key: 'central', label: 'Central Office' },
  { key: 'regional', label: 'Regional offices' },
];

/** Two stacked bars (NEP, House bill) split by type of office, with a three-line key. */
function ShiftMini({ data }: { data: LeaderboardData }) {
  const k = data.totals.by_office_kind;
  const nepAll = KINDS.reduce((s, x) => s + k[x.key].nep_php, 0) || 1;
  const houseAll = KINDS.reduce((s, x) => s + k[x.key].hgab3_php, 0) || 1;
  const bar = (label: string, pick: (s: LeaderSlice) => number, all: number) => (
    <div className="hgab-lb-shift-row">
      <span className="hgab-lb-shift-label">{label}</span>
      <span className="hgab-lb-shift-bar" aria-hidden="true">
        {KINDS.map((x) => (
          <span key={x.key} className={`is-${x.key}`} style={{ width: `${(pick(k[x.key]) / all) * 100}%` }} />
        ))}
      </span>
    </div>
  );
  return (
    <div className="hgab-lb-shift">
      {bar('NEP', (s) => s.nep_php, nepAll)}
      {bar('House bill', (s) => s.hgab3_php, houseAll)}
      <ul className="hgab-lb-shift-key">
        {KINDS.map((x) => (
          <li key={x.key}>
            <span className={`hgab-lb-swatch is-${x.key}`} aria-hidden="true" />
            <span className="hgab-lb-shift-name">{x.label}</span>
            <span className="hgab-lb-shift-vals">
              <span title={formatPesoFull(k[x.key].nep_php)}>{formatValue(k[x.key].nep_php, 'php')}</span>
              {' → '}
              <span title={formatPesoFull(k[x.key].hgab3_php)}>{formatValue(k[x.key].hgab3_php, 'php')}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The top three regions with a bar each. */
function RegionsMini({ data, board }: { data: LeaderboardData; board: BoardDef }) {
  const rows = rankRegions(data, board).slice(0, 3);
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0) || 1;
  return (
    <ol className="hgab-lb-top is-regions">
      {rows.map((r) => (
        <li key={r.region.region}>
          <span className="hgab-lb-top-rank">{r.rank}</span>
          <span className="hgab-lb-top-who">
            <strong>{regionName(r.region.region)}</strong>
            <small>{REGION_LABELS[r.region.region as RegionKey]?.short ?? r.region.region} · {r.region.units.toLocaleString()} district offices</small>
            <span className="hgab-lb-top-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(4, (Math.abs(r.value) / max) * 100)}%` }} />
            </span>
          </span>
          <span className={`hgab-lb-top-val ${toneOf(r.value, board.value)}`.trim()} title={formatPesoFull(r.value)}>
            {formatValue(r.value, board.value)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Tables under the share image
// ---------------------------------------------------------------------------

const FIRST = 20;

/**
 * Phones drop the district, region and detail columns (`.hgab-lb-col-wide`)
 * so the figure stays on screen; the same facts then show inside the name and
 * value cells (`.hgab-lb-phone`), which desktop hides.
 */
function ValueCell({ value, kind, title, sub }: { value: number; kind: ValueKind; title?: string; sub?: string | null }) {
  return (
    <td className={`num hgab-lb-val ${toneOf(value, kind)}`.trim()} title={title ?? (isMoney(kind) ? formatPesoFull(value) : undefined)}>
      {formatValue(value, kind)}
      {sub && <small className="hgab-lb-phone">{sub}</small>}
    </td>
  );
}

function SharedBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`hgab-lb-shared ${className}`.trim()}
      title="One DPWH office serves these districts. Its amount is shown whole, not split between them."
    >
      Shared office · not split
    </span>
  );
}

/**
 * Representative(s): one line per district served, photo and name linking to
 * the district page. A shared group opens with its office's name, so the
 * amount beside it reads as the office's, not any one person's.
 */
function PeopleCell({ people, office = null }: { people: LeaderPerson[]; office?: string | null }) {
  const shared = office != null;
  return (
    <td className="hgab-lb-people-cell">
      {office && <p className="hgab-lb-office">{office}</p>}
      <ul className="hgab-lb-lines">
        {people.map((p) => (
          <li key={p.district_id}>
            <Face person={p} size={32} />
            <span className="hgab-lb-who">
              <Link to={p.href} className={p.name ? undefined : 'is-missing'}>
                {p.name ? displayName(p.name) : 'No representative found'}
              </Link>
              <small className="hgab-lb-phone">{p.district}</small>
            </span>
          </li>
        ))}
      </ul>
      {shared && <SharedBadge className="hgab-lb-phone" />}
    </td>
  );
}

function DistrictsCell({ entry, office }: { entry: LeaderEntry; office: string | null }) {
  return (
    <td className="hgab-lb-districts-cell hgab-lb-col-wide">
      {office && <p className="hgab-lb-office is-note">Serves {entry.people.length} districts</p>}
      <ul className="hgab-lb-lines is-text">
        {entry.people.map((p) => <li key={p.district_id}>{p.district}</li>)}
      </ul>
      {entry.tier === 'B' && <SharedBadge />}
    </td>
  );
}

function ShowAll({ total, open, onOpen }: { total: number; open: boolean; onOpen: () => void }) {
  if (open || total <= FIRST) return null;
  return (
    <button type="button" className="nep-more" onClick={onOpen}>
      Show all {total.toLocaleString()}
    </button>
  );
}

function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="hgab-lb-empty">{children}</td>
    </tr>
  );
}

/** A ranking board: every eligible office group, best first. */
export function RankingTable({ data, board, region }: { data: LeaderboardData; board: BoardDef; region: string | null }) {
  const [open, setOpen] = useState(false);
  const { rows, eligible } = rankEntries(data, board, { region });
  const shown: RankedRow[] = open ? rows : rows.slice(0, FIRST);
  const detail = detailOf(board);
  const cols = 4 + (region ? 0 : 1) + (detail ? 1 : 0);
  return (
    <>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-lb-table">
          <caption className="visually-hidden">
            {board.title}{region ? `, ${regionName(region)}` : ''}: {eligible.toLocaleString()} ranked
          </caption>
          <thead>
            <tr>
              <th className="num hgab-lb-rank">Rank</th>
              <th>Representative</th>
              <th className="hgab-lb-col-wide">District</th>
              {!region && <th className="hgab-lb-col-wide">Region</th>}
              <th className="num">{valueHeading(board)}</th>
              {detail && <th className="hgab-lb-col-wide">{DETAIL_HEADING[board.id] ?? 'Detail'}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <EmptyRow cols={cols}>No district office {region ? `in ${regionName(region)} ` : ''}is on this board.</EmptyRow>
            )}
            {shown.map((r) => (
              <tr key={r.entry.key} className={r.entry.tier === 'B' ? 'is-shared' : undefined}>
                <td className="num hgab-lb-rank">{r.rank}</td>
                <PeopleCell people={r.entry.people} office={officeLabel(r.entry)} />
                <DistrictsCell entry={r.entry} office={officeLabel(r.entry)} />
                {!region && <td className="hgab-lb-region hgab-lb-col-wide">{regionName(r.entry.region)}</td>}
                <ValueCell value={r.value} kind={board.value} sub={detail?.(r.entry)} />
                {detail && <td className="hgab-lb-detail hgab-lb-col-wide">{detail(r.entry) ?? DETAIL_EMPTY[board.id] ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableFoot shown={shown.length} total={eligible} open={open} onOpen={() => setOpen(true)} />
    </>
  );
}

function TableFoot({ shown, total, open, onOpen }: { shown: number; total: number; open: boolean; onOpen: () => void }) {
  if (total === 0) return null;
  return (
    <p className="hgab-lb-tablefoot">
      <span>{shown < total ? `The first ${shown.toLocaleString()} of ${total.toLocaleString()}` : `All ${total.toLocaleString()}`}</span>
      <ShowAll total={total} open={open} onOpen={onOpen} />
    </p>
  );
}

/** The members board: one row per representative with a bill count. */
export function MembersTable({ data, board, region }: { data: LeaderboardData; board: BoardDef; region: string | null }) {
  const [open, setOpen] = useState(false);
  const { rows, eligible } = rankMembers(data, { region });
  const shown = open ? rows : rows.slice(0, FIRST);
  return (
    <>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-lb-table">
          <caption className="visually-hidden">
            {board.title}{region ? `, ${regionName(region)}` : ''}: {eligible.toLocaleString()} representatives
          </caption>
          <thead>
            <tr>
              <th className="num hgab-lb-rank">Rank</th>
              <th>Representative</th>
              <th className="hgab-lb-col-wide">District</th>
              {!region && <th className="hgab-lb-col-wide">Region</th>}
              <th className="num">{valueHeading(board)}</th>
              <th className="hgab-lb-col-wide">Roles and record</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <EmptyRow cols={region ? 5 : 6}>No representative {region ? `in ${regionName(region)} ` : ''}is on this board.</EmptyRow>}
            {shown.map((r) => (
              <tr key={r.person.district_id}>
                <td className="num hgab-lb-rank">{r.rank}</td>
                <PeopleCell people={[r.person]} />
                <td className="hgab-lb-districts-cell hgab-lb-col-wide">{r.person.district}</td>
                {!region && <td className="hgab-lb-region hgab-lb-col-wide">{regionName(r.person.region)}</td>}
                <ValueCell value={r.value} kind={board.value} />
                <td className="hgab-lb-detail hgab-lb-col-wide">
                  {r.person.leadership_roles.length > 0 && <span className="hgab-lb-roles">{r.person.leadership_roles.join('; ')}</span>}
                  {r.person.juris_url && (
                    <a href={r.person.juris_url} target="_blank" rel="noopener noreferrer">Bills on bills.juris.ph ↗</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableFoot shown={shown.length} total={eligible} open={open} onOpen={() => setOpen(true)} />
    </>
  );
}

/** The by-Congress board: three small tables, the top five under each Congress with every district served. */
export function CongressTables({ data, region }: { data: LeaderboardData; region: string | null }) {
  const terms = rankByCongress(data, { region, limit: 5 });
  return (
    <div className="hgab-lb-congress">
      {terms.map((t) => (
        <div key={t.congress} className="hgab-lb-congress-col">
          <h3>
            {t.congress}th Congress <small>{t.years}</small>
          </h3>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-lb-table is-small">
              <caption className="visually-hidden">
                Largest enacted DPWH budgets under the {t.congress}th Congress ({t.years}){region ? `, ${regionName(region)}` : ''}
              </caption>
              <thead>
                <tr>
                  <th className="num hgab-lb-rank">Rank</th>
                  <th>District office serving</th>
                  <th className="num">Enacted</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.length === 0 && <EmptyRow cols={3}>No figure.</EmptyRow>}
                {t.rows.map((r) => (
                  <tr key={r.entry.key}>
                    <td className="num hgab-lb-rank">{r.rank}</td>
                    <td>
                      {officeLabel(r.entry) && <p className="hgab-lb-office">{officeLabel(r.entry)}</p>}
                      <ul className="hgab-lb-lines is-stacked">
                        {r.entry.people.map((p) => (
                          <li key={p.district_id}>
                            <Face person={p} size={28} />
                            <span>
                              <Link to={p.href}>{p.name ? displayName(p.name) : p.district}</Link>
                              {p.name && <small>{p.district}</small>}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {r.entry.tier === 'B' && <SharedBadge />}
                    </td>
                    <ValueCell value={r.value} kind="php" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The big-picture split: each type of office in the NEP and in the House bill. */
export function ShiftTable({ data }: { data: LeaderboardData }) {
  const k = data.totals.by_office_kind;
  const all = data.totals.all;
  const share = (v: number, total: number) => {
    if (!total) return '—';
    const pct = (v / total) * 100;
    return v > 0 && pct < 0.5 ? '<1%' : `${Math.round(pct)}%`;
  };
  const row = (label: string, s: LeaderSlice, kind: string | null) => {
    const delta = s.hgab3_php - s.nep_php;
    return (
      <tr key={label} className={kind ? undefined : 'is-total'}>
        <th scope="row" className="nep-td-name">
          {kind && <span className={`hgab-lb-swatch is-${kind}`} aria-hidden="true" />}
          {label}
        </th>
        <td className="num" title={formatPesoFull(s.nep_php)}>{formatValue(s.nep_php, 'php')}</td>
        <td className="num hgab-lb-share hgab-lb-col-wide">{share(s.nep_php, all.nep_php)}</td>
        <td className="num" title={formatPesoFull(s.hgab3_php)}>{formatValue(s.hgab3_php, 'php')}</td>
        <td className="num hgab-lb-share hgab-lb-col-wide">{share(s.hgab3_php, all.hgab3_php)}</td>
        <ValueCell value={delta} kind="signed_php" />
      </tr>
    );
  };
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-lb-table">
        <caption className="visually-hidden">DPWH project money by type of office, in the NEP and in the House bill</caption>
        <thead>
          <tr>
            <th>Type of office</th>
            <th className="num">NEP</th>
            <th className="num hgab-lb-col-wide">Share</th>
            <th className="num">House bill</th>
            <th className="num hgab-lb-col-wide">Share</th>
            <th className="num">Change from the NEP</th>
          </tr>
        </thead>
        <tbody>{KINDS.map((x) => row(x.label, k[x.key], x.key))}</tbody>
        <tfoot>{row('All DPWH projects compared', all, null)}</tfoot>
      </table>
    </div>
  );
}

/** A regions board: each region's district offices summed, with a link to the offices behind it. */
export function RegionsTable({ data, board }: { data: LeaderboardData; board: BoardDef }) {
  const rows = rankRegions(data, board);
  const offices = (r: LeaderRegion, v: number) => {
    const id = board.id === 'regions-added' ? 'added-money' : v < 0 ? 'cuts' : 'increase';
    return leaderboardPath(id, { region: r.region });
  };
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-lb-table">
        <caption className="visually-hidden">{board.title}</caption>
        <thead>
          <tr>
            <th className="num hgab-lb-rank">Rank</th>
            <th>Region</th>
            <th className="num">{valueHeading(board)}</th>
            <th className="num hgab-lb-col-wide">NEP</th>
            <th className="num hgab-lb-col-wide">House bill</th>
            <th className="num hgab-lb-col-wide">District offices</th>
            <th className="num hgab-lb-col-wide">Districts</th>
            <th><span className="visually-hidden">Offices in the region</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.region.region}>
              <td className="num hgab-lb-rank">{r.rank}</td>
              <td className="nep-td-name">
                <strong>{regionName(r.region.region)}</strong>
                <span className="nep-code">{REGION_LABELS[r.region.region as RegionKey]?.short ?? r.region.region}</span>
              </td>
              <ValueCell
                value={r.value}
                kind={board.value}
                sub={`NEP ${formatValue(r.region.nep_php, 'php')} → ${formatValue(r.region.hgab3_php, 'php')}`}
              />
              <td className="num hgab-lb-col-wide" title={formatPesoFull(r.region.nep_php)}>{formatValue(r.region.nep_php, 'php')}</td>
              <td className="num hgab-lb-col-wide" title={formatPesoFull(r.region.hgab3_php)}>{formatValue(r.region.hgab3_php, 'php')}</td>
              <td className="num hgab-lb-col-wide">{r.region.units.toLocaleString()}</td>
              <td className="num hgab-lb-col-wide">{r.region.districts.toLocaleString()}</td>
              <td className="hgab-lb-go">
                <Link to={offices(r.region, r.value)} aria-label={`District offices in ${regionName(r.region.region)}`}>Offices →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Previous and next board in BOARDS order, and the way back to the gallery. */
export function BoardPager({ board, region, format }: { board: BoardDef; region: string | null; format: ShareFormat }) {
  const i = BOARDS.findIndex((b) => b.id === board.id);
  const prev = i > 0 ? BOARDS[i - 1] : null;
  const next = i >= 0 && i < BOARDS.length - 1 ? BOARDS[i + 1] : null;
  const href = (b: BoardDef) => leaderboardPath(b.id, { region: b.regionFilter ? region : null, format });
  return (
    <nav className="hgab-lb-pager" aria-label="Other leaderboards">
      {prev ? (
        <Link className="is-prev" to={href(prev)}>
          <small>← Previous</small>
          <span>{prev.title}</span>
        </Link>
      ) : <span />}
      <Link className="is-all" to={leaderboardPath()}>All leaderboards</Link>
      {next ? (
        <Link className="is-next" to={href(next)}>
          <small>Next →</small>
          <span>{next.title}</span>
        </Link>
      ) : <span />}
    </nav>
  );
}

/** Every board as a plain list of links, for the not-found state. */
export function BoardLinks() {
  return (
    <ul className="hgab-lb-links">
      {BOARDS.map((b) => (
        <li key={b.id}>
          <Link to={leaderboardPath(b.id)}>{b.title}</Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Share-image error boundary
// ---------------------------------------------------------------------------

/**
 * Keeps the page usable if the share image cannot be drawn: the table, the
 * notes and the links stay, and the image area says what happened.
 */
export class CardBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: string | null }> {
  state: { failed: string | null } = { failed: null };

  static getDerivedStateFromError(e: unknown) {
    return { failed: String((e as Error)?.message || e) };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: null });
  }

  componentDidCatch(e: unknown, info: ErrorInfo) {
    console.warn('Share image failed', e, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <p className="hgab-lb-card-failed" role="status">The image could not be drawn here. The table below has every figure.</p>;
    }
    return this.props.children;
  }
}
