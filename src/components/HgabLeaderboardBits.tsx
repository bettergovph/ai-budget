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
 * engineering offices (DEOs), never to the people shown; a shared office
 * (Tier B) is listed with every legislative district it serves and its amount
 * is never split; nothing here says who asked for a project.
 *
 * Office and district always appear together, each named as what it is: a
 * one-district row is headed by the legislative district with a small badge
 * for the DPWH office that serves it ("Davao de Oro, 2nd District · 1st DEO";
 * a DEO's number is its own); a shared row is headed by the office ("DPWH
 * Isabela 4th DEO") with each legislative district.
 *
 * Styles: src/hgab-leaderboard.css (.hgab-lb-*).
 */
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { REGION_LABELS, type RegionKey } from '../lib/hgab';
import { DeoBadges } from './HgabBits';
import {
  BOARDS, displayName, entryTitle, formatPesoFull, formatValue, leaderboardPath, officeLabel, rankByCongress,
  rankEntries, seatHolders, rankMembers, rankRegions, residualLine, shortDistrict, tierText,
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
  'added-budget': 'In added projects',
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
  'added-budget': 'Projects',
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

/** Each legislative district's office group, per data file, for the members board. */
const ENTRY_BY_DISTRICT = new WeakMap<LeaderboardData, Map<string, LeaderEntry>>();

/** The DPWH office names serving one legislative district (for its badge); empty when none does. */
function districtOffices(data: LeaderboardData, districtId: string): string[] {
  let map = ENTRY_BY_DISTRICT.get(data);
  if (!map) {
    map = new Map();
    for (const e of data.entries) for (const p of e.people) map.set(p.district_id, e);
    ENTRY_BY_DISTRICT.set(data, map);
  }
  return map.get(districtId)?.offices.map((o) => o.name) ?? [];
}

/** The badge(s) for the DPWH office of a one-district row, beside its legislative district. */
function EntryDeo({ entry }: { entry: LeaderEntry }) {
  if (officeLabel(entry) != null) return null;
  return <DeoBadges offices={entry.offices.map((o) => o.name)} jurisdiction={entry.people[0]?.jurisdiction} />;
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
  /** The DPWH office badge(s) beside a legislative district ("1st DEO"); none on a shared row, headed by its office. */
  deo?: { offices: string[]; jurisdiction: string };
  /** A second small line: the tier (and, for a shared office, its legislative districts). */
  sub2?: string;
  /** Every district served, for the title tooltip. */
  title?: string;
  value: number;
}

/**
 * The districts a shared office serves, compactly: "Aklan 1st, 2nd",
 * "Mandaluyong · Marikina 1st, 2nd · Pasig". A lone district is the place name.
 */
function districtList(people: LeaderPerson[]): string {
  const groups = new Map<string, string[]>();
  for (const p of people) {
    const place = p.jurisdiction.replace(/^City of /, '');
    const d = p.district_label.replace(/\s*District$/i, '');
    groups.set(place, [...(groups.get(place) ?? []), d]);
  }
  return [...groups].map(([place, ds]) => (ds.length === 1 && ds[0] === 'Lone' ? place : `${place} ${ds.join(', ')}`)).join(' · ');
}

/**
 * A tile row for an office group, headlined by the place: the legislative
 * district for a one-district office (its DPWH office as a small badge on the
 * tier line, "Tier A [1st DEO]", where it costs no line),
 * the DPWH office for a shared one. The amount is the office's, so it
 * never reads as a person's; the seat holder(s) and the tier (with every
 * legislative district a shared office serves) sit underneath.
 */
function entryTileRow(rank: number, e: LeaderEntry, value: number): TileRow {
  const shared = officeLabel(e) != null;
  return {
    key: e.key,
    rank,
    people: e.people,
    label: entryTitle(e),
    sub: seatHolders(e, 2),
    deo: shared ? undefined : { offices: e.offices.map((o) => o.name), jurisdiction: e.people[0]?.jurisdiction ?? '' },
    // One district: the short tier ("Tier A", the full words on hover) so its office badge fits on the same line.
    sub2: shared ? `Tier B · legislative districts: ${districtList(e.people)}` : tierText(e, true),
    title: shared ? `${tierText(e)}: ${e.people.map((p) => p.district).join('; ')}` : tierText(e),
    value,
  };
}

function personTileRow(r: RankedPerson, offices: string[]): TileRow {
  return {
    key: r.person.district_id, rank: r.rank, people: [r.person], label: personLabel(r.person), sub: shortDistrict(r.person),
    deo: { offices, jurisdiction: r.person.jurisdiction }, value: r.value,
  };
}

/**
 * The board's money in no district (Central Office, regional offices, lines
 * that changed office), in one sentence, or nothing where none applies.
 * Guarded: a data file older than the contract renders no line, not an error.
 */
export function ResidualNote({ data, board, className = '' }: { data: LeaderboardData; board: BoardDef; className?: string }) {
  let text: string | null;
  try {
    text = residualLine(data, board);
  } catch {
    text = null;
  }
  if (!text) return null;
  return <span className={`hgab-lb-resid ${className}`.trim()}>{text}</span>;
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
                <small>{row.sub}</small>
                <small title={row.title}>{t.years} · {row.sub2}{row.deo && <DeoBadges {...row.deo} />}</small>
              </span>
              <span className="hgab-lb-top-val" title={formatPesoFull(r.value)}>{formatValue(r.value, 'php')}</span>
            </li>
          );
        })}
      </ol>
    );
  } else {
    const rows: TileRow[] = board.kind === 'members'
      ? rankMembers(data, { region: scoped, limit: 3 }).rows.map((r) => personTileRow(r, districtOffices(data, r.person.district_id)))
      : rankEntries(data, board, { region: scoped, limit: 3 }).rows.map((r) => entryTileRow(r.rank, r.entry, r.value));
    const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0) || 1;
    body = rows.length === 0 ? (
      <p className="hgab-lb-top-none">No DPWH office {scoped ? `in ${regionName(scoped)} ` : ''}is on this board.</p>
    ) : (
      <ol className="hgab-lb-top">
        {rows.map((r, i) => (
          <li key={r.key} className={i === 0 ? 'is-first' : undefined}>
            <span className="hgab-lb-top-rank">{r.rank}</span>
            <Faces people={r.people} size={i === 0 ? 44 : 32} />
            <span className="hgab-lb-top-who">
              <strong>{r.label}</strong>
              <small>{r.sub}{board.kind === 'members' && r.deo && <DeoBadges {...r.deo} />}</small>
              {r.sub2 && <small title={r.title}>{r.sub2}{r.deo && <DeoBadges {...r.deo} />}</small>}
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
      <p className="hgab-lb-tile-foot">
        <ResidualNote data={data} board={board} />
      </p>
      <span className="hgab-lb-tile-open" aria-hidden="true">Open →</span>
    </article>
  );
}

type KindKey = keyof LeaderboardData['totals']['by_office_kind'];
const KINDS: ReadonlyArray<{ key: KindKey; label: string; note?: string }> = [
  { key: 'deo', label: 'District engineering offices' },
  { key: 'central', label: 'Central Office' },
  { key: 'regional', label: 'Regional offices' },
  { key: 'no_office', label: 'Lines with no office', note: 'The source lists these lines under no office. In no district.' },
  { key: 'office_change', label: 'Lines that changed office', note: 'The NEP and the House bill name different offices. Held out of every district.' },
];

/** The office kinds the data carries (`no_office` and `office_change` arrived later; an older file has three). */
function kindsIn(data: LeaderboardData): typeof KINDS {
  return KINDS.filter((x) => data.totals.by_office_kind[x.key] != null);
}

/** Two stacked bars (NEP, House bill) split by type of office, with a key. */
function ShiftMini({ data }: { data: LeaderboardData }) {
  const k = data.totals.by_office_kind;
  const kinds = kindsIn(data);
  const nepAll = kinds.reduce((s, x) => s + k[x.key].nep_php, 0) || 1;
  const houseAll = kinds.reduce((s, x) => s + k[x.key].hgab3_php, 0) || 1;
  const bar = (label: string, pick: (s: LeaderSlice) => number, all: number) => (
    <div className="hgab-lb-shift-row">
      <span className="hgab-lb-shift-label">{label}</span>
      <span className="hgab-lb-shift-bar" aria-hidden="true">
        {kinds.map((x) => (
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
        {kinds.map((x) => (
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
            <small>{REGION_LABELS[r.region.region as RegionKey]?.short ?? r.region.region} · {r.region.units.toLocaleString()} DEOs</small>
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
function ValueCell({
  value,
  kind,
  title,
  sub,
  notes,
}: {
  value: number;
  kind: ValueKind;
  title?: string;
  sub?: string | null;
  /** The source's uncertainty annotations for this row, under the figure. */
  notes?: ReactNode;
}) {
  return (
    <td className={`num hgab-lb-val ${toneOf(value, kind)}`.trim()} title={title ?? (isMoney(kind) ? formatPesoFull(value) : undefined)}>
      {formatValue(value, kind)}
      {sub && <small className="hgab-lb-phone">{sub}</small>}
      {notes}
    </td>
  );
}

/** The attribution tier of an office group: "Tier A · only this district", "Tier B · shared by 3 districts, not split". */
function TierTag({ entry, className = '' }: { entry: LeaderEntry; className?: string }) {
  return (
    <span
      className={`hgab-lb-tier is-${entry.tier} ${className}`.trim()}
      title={entry.tier === 'A'
        ? 'Tier A: the DPWH office serves only this legislative district, so its figure is the district’s.'
        : 'Tier B: one DPWH office serves these legislative districts. Its amount is shown whole, not split between them.'}
    >
      {tierText(entry)}
    </span>
  );
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const ADDED_BOARDS = new Set(['added-budget', 'added-count', 'added-share']);
const CHANGE_BOARDS = new Set(['increase', 'increase-pct', 'cuts']);

/**
 * The source's own uncertainty annotations for one row, never folded into
 * its figure: lines with an unconfirmed NEP match (the "added" boards), lines
 * in segment review (the change boards), lines whose office changed between
 * the NEP and the House bill (every 2027 board) and, on the enacted-budget
 * boards, an office's reorganisation notes.
 */
function RowNotes({ board, entry }: { board: BoardDef; entry: LeaderEntry }) {
  const lines: string[] = [];
  if (ADDED_BOARDS.has(board.id) && entry.held_rows > 0) {
    lines.push(`+${plural(entry.held_rows, 'line', 'lines')} with an unconfirmed NEP match, not counted`);
  }
  if (CHANGE_BOARDS.has(board.id) && (entry.scope_rows ?? 0) > 0) {
    lines.push(`${plural(entry.scope_rows, 'line', 'lines')} in segment review`);
  }
  if (board.section === 'fy2027' && (entry.office_change_rows ?? 0) > 0) {
    lines.push(`${plural(entry.office_change_rows, 'line', 'lines')} changed office; not counted`);
  }
  const reorg = board.section === 'history' && entry.reorganised_notes?.length ? entry.reorganised_notes : [];
  if (!lines.length && !reorg.length) return null;
  return (
    <span className="hgab-lb-annots">
      {lines.map((l) => <small key={l} className="hgab-lb-annot">{l}</small>)}
      {reorg.length > 0 && (
        <details className="hgab-lb-annot-more">
          <summary>Office history note</summary>
          {reorg.map((n) => <small key={n} className="hgab-lb-annot">{n}</small>)}
        </details>
      )}
    </span>
  );
}

/**
 * The members board only (person-first): photo and name linking to the
 * district page; on phones, the legislative district under the name (desktop
 * has it in its own column, with its DPWH office badge, which a phone's
 * narrow cell would push onto a line of its own).
 */
function PeopleCell({ people }: { people: LeaderPerson[] }) {
  return (
    <td className="hgab-lb-people-cell">
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
    </td>
  );
}

/**
 * An office group, place first. One district (Tier A): the legislative
 * district (linking to its page) with its DPWH office as a small badge beside
 * it ("Davao de Oro, 2nd District · 1st DEO"), so the two are always read
 * together, then the seat holder. Shared (Tier B): the DPWH office ("DPWH Isabela 4th DEO"), then
 * each seat holder with the legislative district they hold (linking to its
 * page). The tier closes both. The amount beside it is the office's, never a
 * person's.
 */
function PlaceCell({ entry, face = 28 }: { entry: LeaderEntry; face?: number }) {
  const shared = officeLabel(entry) != null;
  return (
    <td className="hgab-lb-place-cell">
      <p className="hgab-lb-place">
        {shared ? entryTitle(entry) : <><Link to={entry.href}>{entryTitle(entry)}</Link><EntryDeo entry={entry} /></>}
      </p>
      <ul className="hgab-lb-lines is-seats">
        {entry.people.map((p) => (
          <li key={p.district_id}>
            <Face person={p} size={face} />
            <span className="hgab-lb-who">
              <span className={`hgab-lb-rep ${p.name ? '' : 'is-missing'}`.trim()}>
                {p.name ? `Rep. ${displayName(p.name)}` : 'No representative found'}
              </span>
              {shared && <Link to={p.href} className="hgab-lb-dist">{p.district}</Link>}
            </span>
          </li>
        ))}
      </ul>
      <TierTag entry={entry} />
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
  const cols = 3 + (region ? 0 : 1) + (detail ? 1 : 0);
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
              <th className="is-wrap">Legislative district or DPWH office · representative</th>
              {!region && <th className="hgab-lb-col-wide">Region</th>}
              <th className="num">{valueHeading(board)}</th>
              {detail && <th className="hgab-lb-col-wide">{DETAIL_HEADING[board.id] ?? 'Detail'}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <EmptyRow cols={cols}>No DPWH office {region ? `in ${regionName(region)} ` : ''}is on this board.</EmptyRow>
            )}
            {shown.map((r) => (
              <tr key={r.entry.key} className={r.entry.tier === 'B' ? 'is-shared' : undefined}>
                <td className="num hgab-lb-rank">{r.rank}</td>
                <PlaceCell entry={r.entry} />
                {!region && <td className="hgab-lb-region hgab-lb-col-wide">{regionName(r.entry.region)}</td>}
                <ValueCell value={r.value} kind={board.value} sub={detail?.(r.entry)} notes={<RowNotes board={board} entry={r.entry} />} />
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
  const offices = (p: LeaderPerson) => districtOffices(data, p.district_id);
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
              <th className="hgab-lb-col-wide is-wrap">Legislative district · DPWH office</th>
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
                <td className="hgab-lb-districts-cell hgab-lb-col-wide">
                  {r.person.district}<DeoBadges offices={offices(r.person)} jurisdiction={r.person.jurisdiction} />
                </td>
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
export function CongressTables({ data, board, region }: { data: LeaderboardData; board: BoardDef; region: string | null }) {
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
                  <th>Legislative district or DPWH office</th>
                  <th className="num">Enacted</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.length === 0 && <EmptyRow cols={3}>No figure.</EmptyRow>}
                {t.rows.map((r) => (
                  <tr key={r.entry.key}>
                    <td className="num hgab-lb-rank">{r.rank}</td>
                    <PlaceCell entry={r.entry} face={26} />
                    <ValueCell value={r.value} kind="php" notes={<RowNotes board={board} entry={r.entry} />} />
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
  const row = (label: string, s: LeaderSlice, kind: string | null, note?: string) => {
    const delta = s.hgab3_php - s.nep_php;
    return (
      <tr key={label} className={kind ? undefined : 'is-total'}>
        <th scope="row" className="nep-td-name">
          {kind && <span className={`hgab-lb-swatch is-${kind}`} aria-hidden="true" />}
          {label}
          {note && <small className="hgab-lb-kind-note">{note}</small>}
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
        <caption className="visually-hidden">DPWH project budgets by type of office, in the NEP and in the House bill</caption>
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
        <tbody>{kindsIn(data).map((x) => row(x.label, k[x.key], x.key, x.note))}</tbody>
        <tfoot>{row('All DPWH projects compared', all, null)}</tfoot>
      </table>
    </div>
  );
}

/** A regions board: each region's DPWH district engineering offices summed, with a link to the offices behind it. */
export function RegionsTable({ data, board }: { data: LeaderboardData; board: BoardDef }) {
  const rows = rankRegions(data, board);
  const offices = (r: LeaderRegion, v: number) => {
    const id = board.id === 'regions-added' ? 'added-budget' : v < 0 ? 'cuts' : 'increase';
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
            <th className="num hgab-lb-col-wide" title="DPWH district engineering offices">DEOs</th>
            <th className="num hgab-lb-col-wide is-wrap">Legislative districts</th>
            <th><span className="visually-hidden">DPWH offices in the region</span></th>
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
                <Link to={offices(r.region, r.value)} aria-label={`DPWH offices in ${regionName(r.region.region)}`}>Offices →</Link>
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
