/**
 * `/hgab/2027/parties/:party` (from the page by party): one party's representatives and every DPWH line behind its
 * row, or, at `/hgab/2027/parties/shared`, the same for the offices shared across parties.
 *
 *   1. The check: the lines on this page added up again, beside the figures in the party table. They must agree to
 *      the peso (the builder and verify:hgab check it too); the page says so, or says they do not.
 *   2. Its representatives: every seat the party holds, with the office that serves it. Seats in offices shared
 *      across parties are listed apart and counted on the shared page, never split.
 *   3. Every line at its offices, as the NEP and the House bill list it, each linked to its record and the pages it
 *      is published on. Filter by status or office, search, and download what is shown.
 *
 * Data: `parties/parties.json` and `parties/p/<party>.json` (npm run build:hgab-parties; lib/hgab-parties.ts).
 * State is in the URL (`?status=&office=&q=`), so a filtered list can be shared.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DeoBadges, DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading, SignedPhp } from '../components/HgabBits';
import { PartyName } from '../components/HgabPartyBits';
import { districtPath, loadHgabParties, loadPartyLines, recordPath, traceInfo } from '../lib/hgab';
import { billions, count, fullPeso } from '../lib/hgab-history-view';
import { DEO_MEANING, displayName } from '../lib/hgab-leaderboard';
import {
  PARTIES_ROOT, PARTIES_TITLE, PARTY_MEANING, SHARED_KEY, decodePartyLines, lineTotals, partyName, partyPath, partyShort,
  partySlug, resultText, type PartiesData, type PartyLine, type PartyLineTotals, type PartyUnit, type Seat,
} from '../lib/hgab-parties';
import { downloadCsv, plural, short } from '../lib/hgab-parties-view';
import { pageMeta } from '../lib/seo';
import '../nep2027.css';
import '../hgab-parties.css';

const LINE_PAGE = 50;
/** Representatives shown before "Show all". */
const PEOPLE_PAGE = 20;

/** How a line counts, from its trace (lib/hgab.ts TRACE_LABELS): the filters, in this order. */
type Status = 'added' | 'held' | 'increased' | 'decreased' | 'dropped' | 'same' | 'scope';
const STATUS_LABELS: Record<Status, string> = {
  added: 'Added by the House',
  held: 'Possible NEP match, unconfirmed',
  increased: 'Higher in the House bill',
  decreased: 'Lower in the House bill',
  dropped: 'In the NEP only',
  same: 'Same amount',
  scope: 'Different stretch of the same road',
};
const STATUS_ORDER = Object.keys(STATUS_LABELS) as Status[];
function statusOf(trace: string): Status {
  const t = traceInfo(trace);
  if (t.group === 'house_only') return t.held ? 'held' : 'added';
  if (t.group === 'nep_only') return 'dropped';
  if (t.group === 'increased') return 'increased';
  if (t.group === 'decreased') return 'decreased';
  if (t.group === 'scope_review') return 'scope';
  return 'same';
}

export default function HgabParty() {
  const { party: slug = '' } = useParams();
  const [data, setData] = useState<PartiesData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadHgabParties()
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);
  const code = data ? [...Object.keys(data.parties), SHARED_KEY].find((c) => partySlug(c) === slug) ?? null : null;
  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="the party" />;
  if (!code || (code !== SHARED_KEY && !data.seats.some((s) => s.party === code))) {
    return <HgabError message={`No party holds a seat as “${slug}”. The page by party lists every party with a seat.`} />;
  }
  return <PartyLoader key={code} data={data} code={code} />;
}

function PartyLoader({ data, code }: { data: PartiesData; code: string }) {
  const [lines, setLines] = useState<{ lines: PartyLine[]; totals: PartyLineTotals } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadPartyLines(code)
      .then((f) => { if (live) setLines({ lines: decodePartyLines(f), totals: f.totals }); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, [code]);
  const name = code === SHARED_KEY ? 'Offices shared across parties' : partyName(code);
  useEffect(() => { document.title = `${name} — ${pageMeta(`${PARTIES_ROOT}/${partySlug(code)}`).title}`; }, [code, name]);
  if (err) return <HgabError message={err} />;
  if (!lines) return <HgabLoading what={`the lines behind ${name}`} />;
  return <PartyPage data={data} code={code} name={name} lines={lines.lines} filed={lines.totals} />;
}

function Crumb({ name }: { name: string }) {
  return (
    <>
      <Link to={districtPath()}>Districts</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <Link to={PARTIES_ROOT}>{PARTIES_TITLE}</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">{name}</span>
    </>
  );
}

interface View {
  /** The row in the party table this page checks. */
  row: { units: number; seats: number; nep_php: number; hgab3_php: number; added_php: number; added_rows: number; held_php: number; held_rows: number; dropped_php: number; dropped_rows: number };
  /** The office groups behind the row. */
  units: PartyUnit[];
  /** Its representatives: counted here, in offices shared across parties, with no office. */
  counted: Seat[];
  sharedSeats: Seat[];
  noOffice: Seat[];
}

function viewOf(data: PartiesData, code: string): View {
  const partyOf = new Map(data.seats.map((s) => [s.district_id, s.party]));
  const unitParty = (u: PartyUnit) => {
    const set = new Set(u.district_ids.map((id) => partyOf.get(id) ?? null));
    return set.size === 1 && !set.has(null) ? [...set][0]! : SHARED_KEY;
  };
  const units = data.units.filter((u) => unitParty(u) === code);
  const keys = new Set(units.map((u) => u.key));
  const f = data.fy2027;
  if (code === SHARED_KEY) {
    const counted = data.seats.filter((s) => s.unit && keys.has(s.unit));
    return { row: { ...f.shared, seats: f.shared.seats }, units, counted, sharedSeats: [], noOffice: [] };
  }
  const r = f.rows.find((x) => x.party === code)!;
  const mine = data.seats.filter((s) => s.party === code);
  return {
    row: { ...r, seats: r.seats_counted },
    units,
    counted: mine.filter((s) => s.unit && keys.has(s.unit)),
    sharedSeats: mine.filter((s) => s.unit && !keys.has(s.unit)),
    noOffice: mine.filter((s) => !s.unit),
  };
}

function PartyPage({ data, code, name, lines, filed }: { data: PartiesData; code: string; name: string; lines: PartyLine[]; filed: PartyLineTotals }) {
  const v = useMemo(() => viewOf(data, code), [data, code]);
  const shared = code === SHARED_KEY;
  const all = v.counted.length + v.sharedSeats.length + v.noOffice.length;
  return (
    <>
      <HgabHeader crumb={name} />
      <HgabHero
        compact
        crumb={<Crumb name={name} />}
        title={shared
          ? <>Offices shared across parties: {billions(v.row.hgab3_php)} in the House bill, {billions(v.row.added_php)} of it added</>
          : <>{name}: {billions(v.row.hgab3_php)} in the House bill at the offices serving only its districts, {billions(v.row.added_php)} of it added</>}
        dek={shared ? (
          <>
            {plural(v.units.length, 'DPWH office serves', 'DPWH offices serve')} districts whose representatives ran for different parties:{' '}
            {plural(v.counted.length, 'seat', 'seats')}. Their figures stay whole, so no party is given them.
          </>
        ) : (
          <>
            Representatives who ran for {name} in May 2025 hold {plural(all, 'seat', 'seats')}. {plural(v.units.length, 'DPWH office serves', 'DPWH offices serve')} only
            their districts: {plural(v.counted.length, 'seat', 'seats')}.
            {v.sharedSeats.length > 0 && <> The other {plural(v.sharedSeats.length, 'seat is', 'seats are')} in offices shared across parties, counted there.</>}
            {v.noOffice.length > 0 && <> {plural(v.noOffice.length, 'seat has', 'seats have')} no DPWH office.</>}
          </>
        )}
        note={<>{PARTY_MEANING} Every line below opens its record, with the pages of the NEP and the House bill it is published on. The documents do not say who asked for any project.</>}
      />
      <main className="nep-main hgab-pty-main">
        <Check view={v} lines={lines} filed={filed} />
        <People data={data} code={code} view={v} lines={lines} />
        <Lines data={data} code={code} view={v} lines={lines} />
        <DisclaimerNotice compact offices parties className="hgab-pty-notice" />
      </main>
      <SiteFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. The check
// ---------------------------------------------------------------------------

function Check({ view, lines, filed }: { view: View; lines: PartyLine[]; filed: PartyLineTotals }) {
  const t = useMemo(() => lineTotals(lines), [lines]);
  const r = view.row;
  const cells: Array<[string, number, number, string?]> = [
    ['NEP', t.nep_php, r.nep_php],
    ['House bill', t.hgab3_php, r.hgab3_php],
    ['Added by the House', t.added_php, r.added_php, `${count(t.added_rows)} lines`],
    ['Possible NEP match, unconfirmed', t.held_php, r.held_php, `${count(t.held_rows)} lines`],
    ['In the NEP only', t.dropped_php, r.dropped_php, `${count(t.dropped_rows)} lines`],
  ];
  const ok = cells.every(([, a, b]) => a === b) && t.added_rows === r.added_rows && t.held_rows === r.held_rows && t.dropped_rows === r.dropped_rows
    && t.lines === filed.lines;
  return (
    <section className="hgab-pty-section" aria-labelledby="hgab-pty-check-h" style={{ marginTop: 8 }}>
      <h2 id="hgab-pty-check-h" className="hgab-pty-h2">
        {ok ? `These ${count(t.lines)} lines add up to the party table, to the peso` : 'These lines do not add up to the party table'}
      </h2>
      <p className="hgab-pty-dek">
        Every line at the {plural(view.units.length, 'office', 'offices')} behind this row, added up on this page. A line counts as added when the House
        bill lists it and no matching NEP line was found; an unconfirmed match stays in the House bill budget but is not counted as added.
      </p>
      <div className="hgab-pty-tablewrap">
        <table className="hgab-pty-table hgab-pty-check">
          <thead>
            <tr><th scope="col" />{cells.map(([k]) => <th key={k} scope="col" className="is-num">{k}</th>)}</tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">The {count(t.lines)} lines below</th>
              {cells.map(([k, a, , n]) => <td key={k} className="is-num" title={fullPeso(a)}>{short(a)}{n && <span className="hgab-pty-sub">{n}</span>}</td>)}
            </tr>
            <tr>
              <th scope="row">The party table</th>
              {cells.map(([k, , b]) => <td key={k} className="is-num" title={fullPeso(b)}>{short(b)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`hgab-pty-verdict ${ok ? 'is-ok' : 'is-off'}`} role="status">
        {ok ? '✓ Equal to the peso: every figure in the row is the sum of the lines below.' : '✗ The lines and the row differ. Please report it.'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Its representatives
// ---------------------------------------------------------------------------

function People({ data, code, view, lines }: { data: PartiesData; code: string; view: View; lines: PartyLine[] }) {
  const [, setParams] = useSearchParams();
  const [everyone, setEveryone] = useState(false);
  const units = useMemo(() => new Map(data.units.map((u) => [u.key, u])), [data]);
  const linesIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.unit, (m.get(l.unit) ?? 0) + 1);
    return m;
  }, [lines]);
  const partiesIn = (u: PartyUnit) => [...new Set(u.district_ids.map((id) => data.seats.find((s) => s.district_id === id)?.party).filter((p): p is string => !!p))];
  const byAdded = (a: Seat, b: Seat) => (units.get(b.unit!)?.added_php ?? 0) - (units.get(a.unit!)?.added_php ?? 0) || a.label.localeCompare(b.label);
  const shared = code === SHARED_KEY;
  const show = (key: string) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set('office', key); n.delete('page'); return n; }, { replace: true });
    document.getElementById('lines')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const row = (s: Seat, here: boolean) => {
    const u = s.unit ? units.get(s.unit) : undefined;
    const office = !u ? 'No DPWH office'
      : u.district_ids.length === 1 ? 'Its own office'
      : here && !shared ? `Shared by ${u.district_ids.length} ${partyName(code)} districts`
      : `Shared by ${u.district_ids.length} districts: ${partiesIn(u).map(partyShort).join(', ')}`;
    return (
      <tr key={s.district_id}>
        <td>
          <span className="hgab-pty-name"><Link to={districtPath(s.district_id)}>{s.label}</Link>{u && <DeoBadges offices={u.offices.map((o) => o.name)} jurisdiction={s.jurisdiction} />}</span>
        </td>
        <td>
          {s.holder ? displayName(s.holder) : '—'}
          {s.roles.map((x) => <span key={x} className="hgab-pty-role">{x.replace(/ of the House$/, '')}</span>)}
          <span className="hgab-pty-sub">{resultText(s)}{shared && s.party ? <> · <PartyName code={s.party} /></> : null}</span>
        </td>
        <td>{office}{!here && u && <span className="hgab-pty-sub"><Link to={`${partyPath(SHARED_KEY)}?office=${encodeURIComponent(u.key)}#lines`}>Counted with the shared offices →</Link></span>}</td>
        <td className="is-num">{u ? <span title={fullPeso(u.hgab3_php ?? 0)}>{short(u.hgab3_php)}</span> : '—'}{u && <span className="hgab-pty-sub">NEP {short(u.nep_php)}</span>}</td>
        <td className="is-num">{u ? <span title={fullPeso(u.added_php)}>{short(u.added_php)}</span> : '—'}{u && <span className="hgab-pty-sub">{plural(u.added_rows, 'project', 'projects')}</span>}</td>
        <td className="is-num">
          {here && u ? <button type="button" className="hgab-pty-linkbtn" onClick={() => show(u.key)}>{plural(linesIn.get(u.key) ?? 0, 'line', 'lines')} →</button> : '—'}
        </td>
      </tr>
    );
  };
  const head = (
    <thead>
      <tr>
        <th scope="col">Legislative district</th>
        <th scope="col">Representative</th>
        <th scope="col">DPWH office</th>
        <th scope="col" className="is-num">House bill budget at the office</th>
        <th scope="col" className="is-num">Added at the office</th>
        <th scope="col" className="is-num">Its lines</th>
      </tr>
    </thead>
  );
  const all = view.counted.length + view.sharedSeats.length + view.noOffice.length;
  return (
    <section className="hgab-pty-section" aria-labelledby="hgab-pty-people-h">
      <h2 id="hgab-pty-people-h" className="hgab-pty-h2">
        {shared ? `The ${count(all)} representatives these offices serve` : `The ${count(all)} representatives who ran for ${partyName(code)}`}
      </h2>
      <p className="hgab-pty-dek">
        Each representative with the DPWH office that serves their district and its whole figures. An office shared by several districts shows the same
        figures on each of them: never add those up. {DEO_MEANING}
      </p>
      <div className="hgab-pty-tablewrap">
        <table className="hgab-pty-table">
          {head}
          <tbody>{[...view.counted].sort(byAdded).slice(0, everyone ? undefined : PEOPLE_PAGE).map((s) => row(s, true))}</tbody>
        </table>
      </div>
      {view.counted.length > PEOPLE_PAGE && (
        <p className="hgab-pty-more">
          {everyone ? `${plural(view.counted.length, 'representative', 'representatives')}.` : <>Showing {count(PEOPLE_PAGE)} of {count(view.counted.length)}, largest added first.{' '}
            <button type="button" className="hgab-pty-linkbtn" onClick={() => setEveryone(true)}>Show all {count(view.counted.length)}</button></>}
        </p>
      )}
      {view.sharedSeats.length > 0 && (
        <>
          <h3 className="hgab-pty-h3">In offices shared across parties: {plural(view.sharedSeats.length, 'seat', 'seats')}, counted with the shared offices</h3>
          <div className="hgab-pty-tablewrap">
            <table className="hgab-pty-table">
              {head}
              <tbody>{[...view.sharedSeats].sort(byAdded).map((s) => row(s, false))}</tbody>
            </table>
          </div>
        </>
      )}
      {view.noOffice.length > 0 && (
        <p className="hgab-pty-more">
          With no DPWH office (served by the BARMM regional grouping): {view.noOffice.map((s, i) => (
            <span key={s.district_id}>{i ? ' · ' : ''}<Link to={districtPath(s.district_id)}>{s.label}</Link>, {displayName(s.holder)}</span>
          ))}.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Every line at its offices
// ---------------------------------------------------------------------------

function unitLabel(u: PartyUnit, labelOf: Map<string, string>): string {
  const offices = u.offices.map((o) => o.name).join(' + ');
  const districts = u.district_ids.map((id) => labelOf.get(id) ?? id);
  return `${offices} · ${districts.length === 1 ? districts[0] : `${districts.length} districts`}`;
}

function Lines({ data, code, view, lines }: { data: PartiesData; code: string; view: View; lines: PartyLine[] }) {
  const [params, setParams] = useSearchParams();
  const labelOf = useMemo(() => new Map(data.seats.map((s) => [s.district_id, s.label])), [data]);
  const units = useMemo(() => new Map(view.units.map((u) => [u.key, u])), [view]);
  const statusParam = params.get('status') as Status | null;
  const status = statusParam && statusParam in STATUS_LABELS ? statusParam : null;
  const officeParam = params.get('office');
  const office = officeParam && units.has(officeParam) ? officeParam : null;
  const q = params.get('q') ?? '';
  const [typed, setTyped] = useState({ base: q, text: q });
  const text = typed.base === q ? typed.text : q;
  const set = (patch: Record<string, string | null>) => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const [k, val] of Object.entries(patch)) if (val) n.set(k, val); else n.delete(k);
    return n;
  }, { replace: true });
  useEffect(() => {
    const t = setTimeout(() => { if (text !== q) set({ q: text.trim() || null }); }, 250);
    return () => clearTimeout(t);
  });
  const withStatus = useMemo(() => lines.map((l) => ({ l, s: statusOf(l.trace) })), [lines]);
  const inOffice = useMemo(() => withStatus.filter((x) => !office || x.l.unit === office), [withStatus, office]);
  const counts = useMemo(() => {
    const m = new Map<Status, number>();
    for (const x of inOffice) m.set(x.s, (m.get(x.s) ?? 0) + 1);
    return m;
  }, [inOffice]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inOffice.filter((x) => (!status || x.s === status) && (!needle || `${x.l.title} ${x.l.office} ${x.l.id}`.toLowerCase().includes(needle)));
  }, [inOffice, status, q]);
  const [more, setMore] = useState<{ of: typeof list; n: number }>({ of: list, n: LINE_PAGE });
  const shown = more.of === list ? more.n : LINE_PAGE;
  const sums = useMemo(() => lineTotals(list.map((x) => x.l)), [list]);
  const csv = () => {
    const cell = (v: string | number | null) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const head = ['id', 'title', 'dpwh_office', 'office_group', 'legislative_districts', 'status', 'nep_php', 'house_bill_php', 'record_url'];
    const rows = list.map(({ l, s }) => {
      const u = units.get(l.unit);
      return [l.id, l.title, l.office, l.unit, u ? u.district_ids.map((id) => labelOf.get(id) ?? id).join('; ') : '', STATUS_LABELS[s], l.nep_php, l.hgab3_php,
        `https://budget.bettergov.ph${recordPath('dpwh', l.id)}`].map(cell).join(',');
    });
    downloadCsv(`bettergov-house-bill-2027-${partySlug(code)}-lines.csv`, [head.join(','), ...rows].join('\n'));
  };
  return (
    <section className="hgab-pty-section" id="lines" aria-labelledby="hgab-pty-lines-h">
      <div className="hgab-pty-head">
        <div>
          <h2 id="hgab-pty-lines-h" className="hgab-pty-h2">Every project line at {office ? 'this office' : 'these offices'}</h2>
          <p className="hgab-pty-dek">
            Each line as the NEP and the House bill list it, with the DPWH office that carries it out. Open one for its record and the pages it is
            published on.
          </p>
        </div>
        <div className="hgab-pty-controls">
          <label className="hgab-pty-search">
            <span>Search</span>
            <input type="search" value={text} onChange={(e) => setTyped({ base: q, text: e.target.value })} placeholder="Title, office or record id" />
          </label>
          <label>
            <span>DPWH office</span>
            <select value={office ?? ''} onChange={(e) => set({ office: e.target.value || null })}>
              <option value="">All {plural(view.units.length, 'office', 'offices')}</option>
              {[...view.units].sort((a, b) => b.added_php - a.added_php).map((u) => <option key={u.key} value={u.key}>{unitLabel(u, labelOf)}</option>)}
            </select>
          </label>
          <button type="button" className="hgab-cta" onClick={csv}>These lines (CSV)</button>
        </div>
      </div>
      <div className="hgab-pty-chips" role="group" aria-label="Status">
        <button type="button" aria-pressed={!status} onClick={() => set({ status: null })}>All <span>{count(inOffice.length)}</span></button>
        {STATUS_ORDER.filter((k) => counts.get(k)).map((k) => (
          <button key={k} type="button" aria-pressed={status === k} className={`is-${k}`} onClick={() => set({ status: k })}>
            {STATUS_LABELS[k]} <span>{count(counts.get(k) ?? 0)}</span>
          </button>
        ))}
      </div>
      <p className="hgab-pty-sums">
        <b>{plural(list.length, 'line', 'lines')}</b> · NEP <b title={fullPeso(sums.nep_php)}>{short(sums.nep_php)}</b> · House bill{' '}
        <b title={fullPeso(sums.hgab3_php)}>{short(sums.hgab3_php)}</b>
        {(!status || status === 'added') && <> · added <b title={fullPeso(sums.added_php)}>{short(sums.added_php)}</b></>}
        {office && <> · <button type="button" className="hgab-pty-linkbtn" onClick={() => set({ office: null })}>every office</button></>}
      </p>
      <div className="hgab-pty-tablewrap">
        <table className="hgab-pty-table">
          <thead>
            <tr>
              <th scope="col">Project, as published</th>
              <th scope="col">DPWH office</th>
              <th scope="col" className="is-num">NEP</th>
              <th scope="col" className="is-num">House bill</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map(({ l, s }) => {
              const u = units.get(l.unit);
              const districts = u ? u.district_ids.map((id) => labelOf.get(id) ?? id) : [];
              return (
                <tr key={l.id}>
                  <td><Link to={recordPath('dpwh', l.id)} className="hgab-pty-line">{l.title || l.id}</Link></td>
                  <td>
                    DPWH {l.office}
                    <span className="hgab-pty-sub" title={districts.join('; ')}>{districts.length === 1 ? districts[0] : `${districts.length} districts`}</span>
                  </td>
                  <td className="is-num" title={l.nep_php != null ? fullPeso(l.nep_php) : 'No NEP line'}>{l.nep_php != null ? short(l.nep_php) : '—'}</td>
                  <td className="is-num" title={l.hgab3_php != null ? fullPeso(l.hgab3_php) : 'No House bill line'}>{l.hgab3_php != null ? short(l.hgab3_php) : '—'}</td>
                  <td>
                    <span className={`hgab-pty-status is-${s}`}>{STATUS_LABELS[s]}</span>
                    {(s === 'increased' || s === 'decreased') && <span className="hgab-pty-sub"><SignedPhp value={(l.hgab3_php ?? 0) - (l.nep_php ?? 0)} /></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hgab-pty-more">
        {list.length > shown ? (
          <>
            Showing {count(shown)} of {count(list.length)}.{' '}
            <button type="button" className="hgab-pty-linkbtn" onClick={() => setMore({ of: list, n: shown + LINE_PAGE * 4 })}>Show {count(Math.min(LINE_PAGE * 4, list.length - shown))} more</button>
            {' · '}<button type="button" className="hgab-pty-linkbtn" onClick={() => setMore({ of: list, n: list.length })}>Show all</button>
          </>
        ) : !list.length ? 'No line matches. Try another status, office or search.' : `${plural(list.length, 'line', 'lines')}.`}
        {' · '}<Link to={PARTIES_ROOT}>Every party</Link>
      </p>
    </section>
  );
}
