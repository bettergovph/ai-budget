/**
 * `/hgab/2027/parties` (Districts menu → By party): each legislative district's representative, the party they ran
 * under in May 2025, and the DPWH budget at the offices serving those districts; then the 18th and 19th Congresses.
 * Each party opens its own page (`/hgab/2027/parties/:party`, pages/HgabParty.tsx): its people and every line behind
 * its row, added up again on the page.
 *
 *   1. What has no party: the Central Office's share of the House bill's DPWH budget and of what the House added
 *      (residual first, as everywhere here).
 *   2. By party: the seats its own offices serve, the House bill budget at those offices, and the part the House
 *      added, all counted on the same offices. A shared office's figure is never divided: offices shared across
 *      parties are their own row, with their own page and a list under the table.
 *   3. Every district: representative, party, 2025 result, earlier parties of the seat, its office's figures. CSV.
 *   4. Earlier Congresses: the enacted budgets each Congress passed, by the party of the seats its election filled.
 *   5. Where the parties come from, with every seat that needed more than the results.
 *
 * Data: `parties/parties.json` (npm run build:hgab-parties; contract in src/lib/hgab-parties.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { Caveats, DeoBadges, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading, SignedPhp } from '../components/HgabBits';
import { Metric, PartyName, ShareBar, SharedName } from '../components/HgabPartyBits';
import { districtPath, loadHgabParties } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { billions, count, fullPeso } from '../lib/hgab-history-view';
import { DEO_MEANING, displayName } from '../lib/hgab-leaderboard';
import {
  BASIS_LABELS, CENTRAL_NOTE, DYNASTIES_DEVELOPERS, DYNASTIES_SITE, NO_PARTY, OPEN_HALALAN_URL, PARTIES_CSV_NAME, PARTIES_DATA_PATH,
  PARTIES_ROOT, PARTIES_TITLE, PARTY_FIGURE_NOTE, PARTY_MEANING, SAME_OFFICES_NOTE, dynastyPersonUrl, partyFull, partyName, partyPath, partyShort,
  resultText, seatHistory, seatsCsv, type CongressByParty, type PartiesData, type PartyRow, type PartyUnit, type Seat,
} from '../lib/hgab-parties';
import { amount, downloadCsv, pct, plural, short } from '../lib/hgab-parties-view';
import { pageMeta } from '../lib/seo';
import '../nep2027.css';
import '../hgab-parties.css';

const SEAT_PAGE = 25;
/** Parties with fewer seats share one "Other parties" row in the party tables (the district list has each). */
const OWN_ROW_SEATS = 2;
const ADDED_NOTE = '“Added” means no matching line was found in the NEP: a candidate, not a confirmed insertion.';

function Crumb() {
  return (
    <>
      <Link to={districtPath()}>Districts</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">{PARTIES_TITLE}</span>
    </>
  );
}

export default function HgabParties() {
  const [data, setData] = useState<PartiesData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadHgabParties()
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => { document.title = pageMeta(PARTIES_ROOT).title; }, []);
  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="the seats by party" />;
  return <PartiesPage data={data} />;
}

function PartiesPage({ data }: { data: PartiesData }) {
  const f = data.fy2027;
  const units = useMemo(() => new Map(data.units.map((u) => [u.key, u])), [data]);
  const lead = f.rows[0];
  const seats = data.seats.length;
  return (
    <>
      <HgabHeader crumb={PARTIES_TITLE} />
      <HgabHero
        compact
        crumb={<Crumb />}
        title={<>Offices serving only {partyName(lead.party)} districts carry {billions(lead.hgab3_php)} in the House bill, {billions(lead.added_php)} of it added</>}
        dek={
          <>
            Representatives who ran for {partyName(lead.party)} in May 2025 hold {count(lead.seats)} of the {count(seats)} district seats; its own
            offices serve {count(lead.seats_counted)} of them. Of the {billions(f.deo.added_php)} the House added at DPWH offices serving legislative
            districts, {pct(lead.added_php, f.deo.added_php, 0)} is at those offices. Another {pct(f.shared.added_php, f.deo.added_php, 0)} is at offices
            shared across parties.
          </>
        }
        note={<>{PARTY_MEANING} {ADDED_NOTE} Open a party to see its people and every project line behind its figures. The documents do not say who asked for any project.</>}
      />
      <main className="nep-main hgab-pty-main">
        <Residual data={data} />
        <PartyTable data={data} />
        <SeatList data={data} units={units} />
        <Congresses data={data} />
        <Sources data={data} />
        <DisclaimerNotice compact offices parties className="hgab-pty-notice" />
      </main>
      <SiteFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. What has no party
// ---------------------------------------------------------------------------

/** One stacked bar: the residual, offices of one party, offices shared across parties. */
function Strip({ label, parts, total }: { label: string; parts: Array<{ key: string; label: string; php: number }>; total: number }) {
  return (
    <div className="hgab-pty-stripblock">
      <p className="hgab-pty-striplabel">{label} <b>{amount(total)}</b></p>
      <div className="hgab-pty-strip" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${billions(p.php)} (${pct(p.php, total, 0)})`).join('; ')}`}>
        {parts.map((p) => <span key={p.key} className={`is-${p.key}`} style={{ flexGrow: p.php }} title={`${p.label}: ${fullPeso(p.php)}`} />)}
      </div>
      <ul className="hgab-pty-strip-key">
        {parts.map((p) => (
          <li key={p.key}><span className={`hgab-pty-swatch is-${p.key}`} aria-hidden="true" />{p.label} <b>{billions(p.php)}</b> <span>{pct(p.php, total, 0)}</span></li>
        ))}
      </ul>
    </div>
  );
}

function Residual({ data }: { data: PartiesData }) {
  const f = data.fy2027;
  const sum = (k: 'hgab3_php' | 'added_php') => f.rows.reduce((a, r) => a + r[k], 0);
  const parts = (k: 'hgab3_php' | 'added_php') => [
    { key: 'central', label: 'Central Office, or no district office', php: f.residual[k] },
    { key: 'single', label: 'Offices serving one party’s districts', php: sum(k) },
    { key: 'shared', label: 'Offices shared across parties', php: f.shared[k] },
    ...(f.unknown[k] ? [{ key: 'unknown', label: 'Offices with a seat whose party is not known', php: f.unknown[k] }] : []),
  ];
  return (
    <section className="hgab-pty-section" aria-labelledby="hgab-pty-res-h" style={{ marginTop: 8 }}>
      <h2 id="hgab-pty-res-h" className="hgab-pty-h2">
        {billions(f.residual.added_php)} of the {billions(f.all.added_php)} the House added to DPWH projects sits with no district office
      </h2>
      <p className="hgab-pty-dek">
        So does {billions(f.residual.hgab3_php)} of the {billions(f.all.hgab3_php)} the House bill lists for DPWH projects in all. {CENTRAL_NOTE} The
        rest is at the DPWH offices that serve legislative districts, read by party below.
      </p>
      <Strip label="Every DPWH project in the House bill" parts={parts('hgab3_php')} total={f.all.hgab3_php} />
      <Strip label="Projects the House added (no matching NEP line)" parts={parts('added_php')} total={f.all.added_php} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. By party
// ---------------------------------------------------------------------------

function PartyTable({ data }: { data: PartiesData }) {
  const f = data.fy2027;
  const seats = data.seats.length;
  const deo = f.deo;
  const own = f.rows.filter((r) => r.seats >= OWN_ROW_SEATS);
  const rest = f.rows.filter((r) => r.seats < OWN_ROW_SEATS);
  const other: PartyRow | null = rest.length ? rest.reduce<PartyRow>((a, r) => ({
    ...a, seats: a.seats + r.seats, seats_counted: a.seats_counted + r.seats_counted, seats_a: a.seats_a + r.seats_a, added_php_a: a.added_php_a + r.added_php_a,
    units: a.units + r.units, nep_php: a.nep_php + r.nep_php, hgab3_php: a.hgab3_php + r.hgab3_php, added_php: a.added_php + r.added_php,
    added_rows: a.added_rows + r.added_rows, held_php: a.held_php + r.held_php, held_rows: a.held_rows + r.held_rows,
    dropped_php: a.dropped_php + r.dropped_php, dropped_rows: a.dropped_rows + r.dropped_rows,
  }), { ...rest[0], party: '', seats: 0, seats_counted: 0, seats_a: 0, added_php_a: 0, units: 0, nep_php: 0, hgab3_php: 0, added_php: 0, added_rows: 0, held_php: 0, held_rows: 0, dropped_php: 0, dropped_rows: 0 }) : null;
  // Every bar of a row counts the same offices: the seats they serve, the House bill budget there, the part added.
  const max = Math.max(
    ...f.rows.map((r) => Math.max(r.seats_counted / seats, r.hgab3_php / deo.hgab3_php, r.added_php / deo.added_php)),
    f.shared.seats / seats, f.shared.hgab3_php / deo.hgab3_php, f.shared.added_php / deo.added_php,
  );
  const parties = f.rows.filter((r) => r.party !== NO_PARTY).length;
  const independents = f.rows.find((r) => r.party === NO_PARTY)?.seats ?? 0;
  const figures = (r: Pick<PartyRow, 'seats_counted' | 'units' | 'nep_php' | 'hgab3_php' | 'added_php' | 'added_rows'>) => (
    <>
      <td className="is-num">
        {r.seats_counted ? <Metric value={count(r.seats_counted)} share={r.seats_counted / seats} max={max} tone="seats" /> : '—'}
      </td>
      <td className="is-num">
        {r.units ? <Metric value={short(r.hgab3_php)} share={r.hgab3_php / deo.hgab3_php} max={max} tone="total" title={fullPeso(r.hgab3_php)} note={`NEP ${short(r.nep_php)}`} /> : '—'}
      </td>
      <td className="is-num">
        {r.units ? <Metric value={short(r.added_php)} share={r.added_php / deo.added_php} max={max} tone="budget" title={fullPeso(r.added_php)} note={plural(r.added_rows, 'project', 'projects')} /> : '—'}
      </td>
      <td className="is-num">{r.units ? <SignedPhp value={r.hgab3_php - r.nep_php} /> : '—'}</td>
    </>
  );
  return (
    <section className="hgab-pty-section" aria-labelledby="hgab-pty-party-h">
      <h2 id="hgab-pty-party-h" className="hgab-pty-h2">
        {count(parties)} parties and {plural(independents, 'independent', 'independents')} hold the {count(seats)} district seats
      </h2>
      <p className="hgab-pty-dek">
        Each party’s row counts the DPWH offices that serve only its members’ districts: the seats they serve, their whole House bill budget,
        and the part the House added. Shares are of the {count(seats)} seats, the {billions(deo.hgab3_php)} and the {billions(deo.added_php)}. Open a
        party to check its figures line by line.
      </p>
      <div className="hgab-pty-tablewrap">
        <table className="hgab-pty-table is-parties">
          <thead>
            <tr>
              <th scope="col">Party, May 2025</th>
              <th scope="col" className="is-num">Seats its offices serve</th>
              <th scope="col" className="is-num">House bill budget at its offices</th>
              <th scope="col" className="is-num">Added by the House</th>
              <th scope="col" className="is-num">Change from the NEP</th>
            </tr>
          </thead>
          <tbody>
            {own.map((r) => (
              <tr key={r.party}>
                <td>
                  <PartyName
                    code={r.party}
                    sub={r.units
                      ? `${plural(r.seats, 'seat', 'seats')} in all · ${plural(r.units, 'office', 'offices')} of its own`
                      : `${plural(r.seats, 'seat', 'seats')} in all, every one in a shared office`}
                  />
                </td>
                {figures(r)}
              </tr>
            ))}
            {other && (
              <tr>
                <td>
                  <span className="hgab-pty-party">
                    Other parties
                    <span className="hgab-pty-sub">
                      {plural(rest.length, 'party', 'parties')} with one seat each:{' '}
                      {rest.map((x, i) => <span key={x.party}>{i ? ' · ' : ''}<Link to={partyPath(x.party)} title={partyFull(x.party)}>{partyShort(x.party)}</Link></span>)}
                    </span>
                  </span>
                </td>
                {figures(other)}
              </tr>
            )}
            <tr className="is-shared">
              <td><SharedName sub={`${plural(f.shared.units, 'office', 'offices')}, each serving districts of more than one party; figures undivided`} /></td>
              {figures({ ...f.shared, seats_counted: f.shared.seats })}
            </tr>
            {f.no_office_seats > 0 && (
              <tr className="is-muted">
                <td><span className="hgab-pty-party">No DPWH office<span className="hgab-pty-sub">Served by the BARMM regional grouping: no office figures</span></span></td>
                <td className="is-num"><Metric value={count(f.no_office_seats)} share={f.no_office_seats / seats} max={max} tone="seats" /></td>
                <td className="is-num">—</td><td className="is-num">—</td><td className="is-num">—</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">District offices, all parties</th>
              <td className="is-num">{count(seats)}</td>
              <td className="is-num" title={fullPeso(deo.hgab3_php)}>{short(deo.hgab3_php)}<span className="hgab-pty-sub">NEP {short(deo.nep_php)}</span></td>
              <td className="is-num" title={fullPeso(deo.added_php)}>{short(deo.added_php)}<span className="hgab-pty-sub">{plural(deo.added_rows, 'project', 'projects')}</span></td>
              <td className="is-num"><SignedPhp value={deo.hgab3_php - deo.nep_php} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <Caveats items={[PARTY_FIGURE_NOTE, SAME_OFFICES_NOTE, ADDED_NOTE, DEO_MEANING]} />
      <SharedOffices data={data} />
    </section>
  );
}

function SharedOffices({ data }: { data: PartiesData }) {
  const list = data.fy2027.shared_units;
  if (!list.length) return null;
  return (
    <details className="hgab-pty-shared">
      <summary>The {count(list.length)} offices shared across parties, and their districts</summary>
      <div className="hgab-pty-tablewrap">
        <table className="hgab-pty-table">
          <thead>
            <tr>
              <th scope="col">DPWH office</th>
              <th scope="col">Legislative districts it serves, and their party</th>
              <th scope="col" className="is-num">House bill budget</th>
              <th scope="col" className="is-num">Added</th>
              <th scope="col" className="is-num">Change from the NEP</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.key}>
                <td><span className="hgab-pty-name">DPWH {u.offices.map((o) => o.name).join(' + ')}</span></td>
                <td>
                  <ul className="hgab-pty-dlist">
                    {u.districts.map((d) => (
                      <li key={d.district_id}>
                        <Link to={districtPath(d.district_id)}>{d.label}</Link>{' '}
                        {d.party
                          ? <Link className="hgab-pty-chip" to={partyPath(d.party)} title={partyFull(d.party)}>{partyShort(d.party)}</Link>
                          : <span className="hgab-pty-chip">—</span>}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="is-num" title={fullPeso(u.hgab3_php)}>{short(u.hgab3_php)}<span className="hgab-pty-sub">NEP {short(u.nep_php)}</span></td>
                <td className="is-num" title={fullPeso(u.added_php)}>{short(u.added_php)}<span className="hgab-pty-sub">{plural(u.added_rows, 'project', 'projects')}</span></td>
                <td className="is-num"><SignedPhp value={u.hgab3_php - u.nep_php} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hgab-pty-more"><Link to={partyPath('shared')}>Every line at these offices →</Link></p>
    </details>
  );
}

// ---------------------------------------------------------------------------
// 3. Every district
// ---------------------------------------------------------------------------

/** Each district's earlier parties (seatHistory), computed once. */
function useEarlier(data: PartiesData) {
  return useMemo(() => new Map(data.seats.map((s) => [s.district_id, seatHistory(data, s.district_id)])), [data]);
}

function SeatList({ data, units }: { data: PartiesData; units: Map<string, PartyUnit> }) {
  const [party, setParty] = useState('');
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const earlier = useEarlier(data);
  const options = useMemo(() => {
    const n = new Map<string, number>();
    for (const s of data.seats) n.set(s.party ?? '', (n.get(s.party ?? '') ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [data]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.seats.filter((s) => (!party || (s.party ?? '') === party)
      && (!needle || `${s.label} ${s.holder ?? ''} ${s.person_name ?? ''}`.toLowerCase().includes(needle)));
  }, [data, party, q]);
  const shown = all ? list : list.slice(0, SEAT_PAGE);
  return (
    <section className="hgab-pty-section" aria-labelledby="hgab-pty-seats-h">
      <div className="hgab-pty-head">
        <div>
          <h2 id="hgab-pty-seats-h" className="hgab-pty-h2">Every legislative district, its representative and party</h2>
          <p className="hgab-pty-dek">
            The representative the House lists for each seat, the party they ran under in May 2025, their result, the seat’s party in
            the two elections before, and the budget at the DPWH office serving the district.
          </p>
        </div>
        <div className="hgab-pty-controls">
          <label className="hgab-pty-search">
            <span>Search</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="District, province or name" />
          </label>
          <label>
            <span>Party</span>
            <select value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">All parties ({count(data.seats.length)})</option>
              {options.map(([code, n]) => <option key={code} value={code}>{code ? partyName(code) : 'No party'} ({count(n)})</option>)}
            </select>
          </label>
          <button type="button" className="hgab-cta" onClick={() => downloadCsv(PARTIES_CSV_NAME, seatsCsv(data))}>Every district (CSV)</button>
        </div>
      </div>
      <div className="hgab-pty-tablewrap">
        <table className="hgab-pty-table">
          <thead>
            <tr>
              <th scope="col">Legislative district</th>
              <th scope="col">Representative</th>
              <th scope="col">Party, May 2025</th>
              <th scope="col">Result, May 2025</th>
              <th scope="col" className="is-num">House bill budget at its office</th>
              <th scope="col" className="is-num">Added at its office</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => <SeatRow key={s.district_id} s={s} unit={s.unit ? units.get(s.unit) : undefined} earlier={earlier.get(s.district_id) ?? []} />)}
          </tbody>
        </table>
      </div>
      <p className="hgab-pty-more">
        {list.length > shown.length ? (
          <>
            Showing {count(shown.length)} of {count(list.length)}.{' '}
            <button type="button" className="hgab-pty-linkbtn" onClick={() => setAll(true)}>Show all {count(list.length)}</button>
          </>
        ) : !list.length ? 'No district matches. Try another name, or all parties.' : `${plural(list.length, 'district', 'districts')}.`}
        {' '}A shared office’s figures repeat on each district it serves: never add those up.
      </p>
    </section>
  );
}

function SeatRow({ s, unit, earlier }: { s: Seat; unit: PartyUnit | undefined; earlier: Array<{ year: number; party: string | null; changed: boolean }> }) {
  const dyn = s.person_id && s.province_slug ? dynastyPersonUrl(s.province_slug, s.person_id) : null;
  const before = earlier.filter((e) => e.party || e.changed);
  const shared = unit && unit.district_ids.length > 1 ? `Office shared by ${unit.district_ids.length} districts` : null;
  return (
    <tr>
      <td>
        <span className="hgab-pty-name">
          <Link to={districtPath(s.district_id)}>{s.label}</Link>
          {unit && <DeoBadges offices={unit.offices.map((o) => o.name)} jurisdiction={s.jurisdiction} />}
        </span>
      </td>
      <td>
        {s.holder ? displayName(s.holder) : '—'}
        {s.roles.map((r) => <span key={r} className="hgab-pty-role">{r.replace(/ of the House$/, '')}</span>)}
        {s.note && (
          <span className="hgab-pty-sub hgab-pty-note">
            {s.note}
            {s.note_source && <> <a href={s.note_source} target="_blank" rel="noopener noreferrer">Source</a></>}
          </span>
        )}
      </td>
      <td>
        <PartyName code={s.party} />
        {before.length > 0 && (
          <span className="hgab-pty-sub">
            {before.map((e, i) => (
              <span key={e.year} title={e.changed ? 'The district had other towns then' : e.party ? partyFull(e.party) : undefined}>
                {i ? ' · ' : ''}{e.year} {e.changed ? 'redrawn' : partyShort(e.party!)}
              </span>
            ))}
          </span>
        )}
      </td>
      <td>
        {resultText(s)}
        {s.basis !== 'winner' && <span className="hgab-pty-sub">{BASIS_LABELS[s.basis]}</span>}
        {dyn && <span className="hgab-pty-sub"><a href={dyn} target="_blank" rel="noopener noreferrer">Election history ↗<span className="visually-hidden"> (BetterGov Dynasties, opens in a new tab)</span></a></span>}
      </td>
      <td className="is-num">
        {unit ? <span title={fullPeso(unit.hgab3_php ?? 0)}>{short(unit.hgab3_php)}</span> : '—'}
        <span className="hgab-pty-sub">{!unit ? 'No DPWH office' : `NEP ${short(unit.nep_php)}`}</span>
      </td>
      <td className="is-num">
        {unit ? <span title={fullPeso(unit.added_php)}>{short(unit.added_php)}</span> : '—'}
        <span className="hgab-pty-sub">{!unit ? '' : shared ?? plural(unit.added_rows, 'project', 'projects')}</span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 4. Earlier Congresses
// ---------------------------------------------------------------------------

function Congresses({ data }: { data: PartiesData }) {
  const [at, setAt] = useState(data.congresses[0]?.congress ?? 18);
  const c = data.congresses.find((x) => x.congress === at) ?? data.congresses[0];
  const tops = data.congresses.map((x) => ({ x, top: x.rows[0] }));
  const lead = tops.map(({ x, top }) => `${partyName(top.party)} in ${x.election} (${count(top.seats)})`);
  return (
    <section className="hgab-pty-section" aria-labelledby="hgab-pty-cong-h">
      <h2 id="hgab-pty-cong-h" className="hgab-pty-h2">Enacted budgets by the party of each Congress’s seats</h2>
      <p className="hgab-pty-dek">
        The most seats went to {lead.slice(0, -1).join(', ')} and {lead[lead.length - 1]}. Each Congress passed the budgets
        for the three years after it was elected.
      </p>
      <div className="hgab-pty-tabs" role="group" aria-label="Congress">
        {data.congresses.map((x) => (
          <button key={x.congress} type="button" aria-pressed={x.congress === c.congress} onClick={() => setAt(x.congress)}>
            {x.label}<span>{x.election} election · {x.years.length > 1 ? `${x.years[0]}–${x.years[x.years.length - 1]}` : x.years[0]}</span>
          </button>
        ))}
      </div>
      <CongressTable c={c} noOffice={data.fy2027.no_office_seats} />
    </section>
  );
}

function CongressTable({ c, noOffice }: { c: CongressByParty; noOffice: number }) {
  const seats = c.rows.reduce((a, r) => a + r.seats, 0);
  const own = c.rows.filter((r) => r.seats >= OWN_ROW_SEATS);
  const rest = c.rows.filter((r) => !own.includes(r));
  const other = rest.reduce((a, r) => ({ seats: a.seats + r.seats, units: a.units + r.units, districts: a.districts + (r.districts ?? 0), gaa_php: a.gaa_php + r.gaa_php }),
    { seats: 0, units: 0, districts: 0, gaa_php: 0 });
  // Like the 2027 table, both bars count the same offices: the districts they serve, and the budget enacted for them.
  const districts = c.rows.reduce((a, r) => a + (r.districts ?? 0), 0) + (c.shared.districts ?? 0) + (c.not_comparable.districts ?? 0) + noOffice;
  const counted = c.rows.every((r) => r.districts != null);
  const max = Math.max(...own.map((r) => Math.max((r.districts ?? 0) / districts, r.gaa_php / c.deo_php)), c.shared.gaa_php / c.deo_php, c.not_comparable.gaa_php / c.deo_php,
    (c.shared.districts ?? 0) / districts, (c.not_comparable.districts ?? 0) / districts);
  const dbar = (n: number | undefined) => (counted && n ? <><ShareBar value={n / districts} max={max} tone="seats" /><span className="hgab-pty-pct">{pct(n, districts)}</span></> : null);
  const years = c.years.length > 1 ? `${c.years[0]} to ${c.years[c.years.length - 1]}` : String(c.years[0]);
  const bar = (php: number) => <><ShareBar value={php / c.deo_php} max={max} tone="budget" /><span className="hgab-pty-pct">{pct(php, c.deo_php)}</span></>;
  return (
    <>
      <p className="hgab-pty-dek">
        DPWH offices serving legislative districts carry {amount(c.deo_php)} of the {amount(c.total_php)} enacted for DPWH in {years}.
        {' '}The Central Office and regional offices carry the rest, with no party.
      </p>
      <div className="hgab-pty-tablewrap">
        <table className="hgab-pty-table">
          <thead>
            <tr>
              <th scope="col">Party, {c.election} election</th>
              <th scope="col" className="is-num">Seats won</th>
              <th scope="col" className="is-num">Districts its offices serve</th>
              <th scope="col" className="hgab-pty-barcol">Share of districts</th>
              <th scope="col" className="is-num">Enacted at its offices, {years}</th>
              <th scope="col" className="hgab-pty-barcol">Share of district offices</th>
            </tr>
          </thead>
          <tbody>
            {own.map((r) => (
              <tr key={r.party}>
                <td><PartyName code={r.party} plain sub={r.units ? plural(r.units, 'office', 'offices') : 'No office of its own read'} /></td>
                <td className="is-num">{count(r.seats)}</td>
                <td className="is-num">{counted && r.districts ? count(r.districts) : '—'}</td>
                <td className="hgab-pty-barcol">{dbar(r.districts)}</td>
                <td className="is-num" title={r.units ? fullPeso(r.gaa_php) : undefined}>{r.units ? short(r.gaa_php) : '—'}</td>
                <td className="hgab-pty-barcol">{r.units ? bar(r.gaa_php) : null}</td>
              </tr>
            ))}
            {rest.length > 0 && (
              <tr>
                <td><span className="hgab-pty-party" title={rest.map((r) => partyFull(r.party)).join(', ')}>Other parties<span className="hgab-pty-sub">{plural(rest.length, 'party', 'parties')} with one seat each{other.units ? ` · ${plural(other.units, 'office', 'offices')}` : ''}</span></span></td>
                <td className="is-num">{count(other.seats)}</td>
                <td className="is-num">{counted && other.districts ? count(other.districts) : '—'}</td>
                <td className="hgab-pty-barcol">{dbar(other.districts)}</td>
                <td className="is-num">{other.units ? short(other.gaa_php) : '—'}</td>
                <td className="hgab-pty-barcol">{other.units ? bar(other.gaa_php) : null}</td>
              </tr>
            )}
            <tr className="is-shared">
              <td><span className="hgab-pty-party">Offices shared across parties<span className="hgab-pty-sub">{plural(c.shared.units, 'office', 'offices')}, figures undivided</span></span></td>
              <td className="is-num">—</td>
              <td className="is-num">{counted && c.shared.districts ? count(c.shared.districts) : '—'}</td>
              <td className="hgab-pty-barcol">{dbar(c.shared.districts)}</td>
              <td className="is-num" title={fullPeso(c.shared.gaa_php)}>{short(c.shared.gaa_php)}</td>
              <td className="hgab-pty-barcol">{bar(c.shared.gaa_php)}</td>
            </tr>
            {c.not_comparable.units > 0 && (
              <tr className="is-muted">
                <td>
                  <span className="hgab-pty-party">
                    Not compared
                    <span className="hgab-pty-sub">{plural(c.not_comparable.units, 'office', 'offices')}: a district had other towns or no seat then, or an office was created or renamed since 2020</span>
                  </span>
                </td>
                <td className="is-num">—</td>
                <td className="is-num">{counted && c.not_comparable.districts ? count(c.not_comparable.districts) : '—'}</td>
                <td className="hgab-pty-barcol">{dbar(c.not_comparable.districts)}</td>
                <td className="is-num" title={fullPeso(c.not_comparable.gaa_php)}>{short(c.not_comparable.gaa_php)}</td>
                <td className="hgab-pty-barcol">{bar(c.not_comparable.gaa_php)}</td>
              </tr>
            )}
            {counted && noOffice > 0 && (
              <tr className="is-muted">
                <td><span className="hgab-pty-party">No DPWH office<span className="hgab-pty-sub">Served by the BARMM regional grouping: no office figures</span></span></td>
                <td className="is-num">—</td>
                <td className="is-num">{count(noOffice)}</td>
                <td className="hgab-pty-barcol"><span className="hgab-pty-pct">{pct(noOffice, districts)}</span></td>
                <td className="is-num">—</td><td />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">District offices</th>
              <td className="is-num">{count(seats)}</td>
              <td className="is-num" title={counted ? `${count(noOffice)} more with no DPWH office` : undefined}>{counted ? count(districts) : '—'}</td><td />
              <td className="is-num" title={fullPeso(c.deo_php)}>{short(c.deo_php)}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>
      <Caveats
        items={c.congress === 20 ? [
          'Both bars count the same offices: the districts they serve, and the budget enacted for them.',
          'The 20th Congress uses the seats as they stand now, as above. It has passed one budget so far, for 2026.',
          'Enacted budgets list each office’s whole budget, every fund. The 2027 figures above count listed projects only.',
        ] : [
          'Both bars count the same offices: the districts they serve, on 2025 lines, and the budget enacted for them.',
          'Seats are the election’s winners as the results publish them. Changes during the term are not shown.',
          'An office counts only where each district it serves had the same towns as in 2025, and the office kept its name since 2020.',
          'Enacted budgets list each office’s whole budget, every fund.',
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Where the parties come from
// ---------------------------------------------------------------------------

function Sources({ data }: { data: PartiesData }) {
  const odd = data.seats.filter((s) => s.basis !== 'winner');
  const winners = data.seats.length - odd.length;
  const s = data.source;
  return (
    <section className="hgab-pty-section" aria-labelledby="hgab-pty-src-h">
      <h2 id="hgab-pty-src-h" className="hgab-pty-h2">{count(winners)} of the {count(data.seats.length)} representatives won their seat in the May 2025 results</h2>
      <p className="hgab-pty-dek">
        Parties come from <a href={s.url} target="_blank" rel="noopener noreferrer">Open Halalan</a>’s election results, as{' '}
        <a href={s.site} target="_blank" rel="noopener noreferrer">BetterGov Dynasties</a> publishes them. The representative in each seat
        is the House directory’s, as on the district pages. These {plural(odd.length, 'seat', 'seats')} needed more than the results:
      </p>
      <ul className="hgab-pty-odd">
        {odd.map((x) => (
          <li key={x.district_id}>
            <Link to={districtPath(x.district_id)}>{x.label}</Link>: {displayName(x.holder)}, <PartyName code={x.party} />.{' '}
            <span>{x.note ?? BASIS_LABELS[x.basis]}</span>
            {x.note_source && <> <a href={x.note_source} target="_blank" rel="noopener noreferrer">Source</a></>}
          </li>
        ))}
      </ul>
      <p className="hgab-pty-more">
        <a href={DYNASTIES_DEVELOPERS} target="_blank" rel="noopener noreferrer">BetterGov Dynasties API</a>
        {' · '}<a href={DYNASTIES_SITE} target="_blank" rel="noopener noreferrer">dynasties.bettergov.ph</a>
        {' · '}<a href={OPEN_HALALAN_URL} target="_blank" rel="noopener noreferrer">Open Halalan</a>
        {' · '}<a href={dataUrl(PARTIES_DATA_PATH)} target="_blank" rel="noopener noreferrer">parties.json</a>
      </p>
      <HgabDetails>
        <ul>
          <li>Each legislative district is joined to its race by province or city and district number. Taguig’s two districts are one two-seat race in the results; each member is matched to their district by name.</li>
          <li>Each representative is matched to a candidate in that race by surname, then first name. Where the House lists two names, the first name must match.</li>
          <li>Party abbreviations are as the results publish them; the names beside them are ours. “IND” is a candidate with no party. Local parties in different provinces can share an abbreviation (ASENSO in Abra and in Manila); they are counted together under it.</li>
          <li>Earlier elections are read for a district only where a district of the same name had the same towns as in 2025, town renames aside. A two-seat race gives a party only when both winners share it.</li>
          <li>Election data as of {s.data_vintage}. {s.citation} {s.license}</li>
          <li>Seat holders: {s.seat_holders}</li>
          <li>Built {new Date(data.built_at).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' })} from districts.json, leaderboard.json and the elections database (SHA-256 {data.inputs.elections.slice(0, 12)}).</li>
        </ul>
      </HgabDetails>
    </section>
  );
}
