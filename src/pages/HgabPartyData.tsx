/**
 * `/hgab/2027/parties/by-congress`: how we read each district's party, 16th to 20th Congress, with every seat and its
 * source. Linked from Sources, the party grids, the party data disclaimer and the by-party pages.
 *
 * Jason (2026-11-06): "We need the data exposed on how we mapped the parties. This is risky so it requires
 * transparency. It could be a different page linked via sources. We need full disclaimers that members switch parties
 * and the data should be cited properly, the data are based on electoral data."
 *
 * Data: parties/congress-seats.json (`npm run build:hgab-congress-seats`; contract src/lib/hgab-congress-seats.ts), and
 * its CSV. The page reads the file as it is; the counts are the file's.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { loadCongressSeats } from '../lib/hgab';
import {
  CONGRESS_SEATS_CSV_FIELDS, CONGRESS_SEATS_CSV_NAME, CONGRESS_SEATS_CSV_PATH, CONGRESS_SEATS_PATH, CONGRESS_TERMS,
  PARTY_DATA_ROOT, PARTY_DATA_TITLE, type CongressSeat, type CongressSeatsFile,
} from '../lib/hgab-congress-seats';
import { dataUrl } from '../lib/data-url';
import {
  DYNASTIES_DEVELOPERS, DYNASTIES_SITE, OPEN_HALALAN_URL, PARTIES_ROOT, dynastyContestApi, dynastyPersonUrl, partyName,
} from '../lib/hgab-parties';
import { FLOOD_COMPARE_ROOT, MPB_COMPARE_ROOT } from '../lib/mpb-compare';
import { pageMeta } from '../lib/seo';
import '../nep2027.css';
import '../hgab-mpb-compare.css';

const n = (v: number) => v.toLocaleString('en-US');
const BUILDER_URL = 'https://github.com/bettergovph/ai-budget/blob/main/scripts/build-hgab-congress-seats.ts';
const TOWNS: Record<CongressSeat[2] | 'none', string> = { same: 'Same towns', changed: 'Towns changed', none: 'No race on record' };

export default function HgabPartyData() {
  const [data, setData] = useState<CongressSeatsFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadCongressSeats().then((x) => { if (live) setData(x); }).catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => { document.title = pageMeta(PARTY_DATA_ROOT).title; }, []);
  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="the seats by Congress" />;
  return (
    <>
      <HgabHeader crumb={PARTY_DATA_TITLE} />
      <HgabHero
        compact
        crumb={<><Link to={PARTIES_ROOT}>By party</Link><span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">{PARTY_DATA_TITLE}</span></>}
        title={<>How we read each district’s party, 16th to 20th Congress</>}
        dek={<>Every party on this site comes from election results. Here is every seat we read, the race it came from, and how a budget year gets its party, so each one can be checked.</>}
      />
      <main className="nep-main mpbc-main">
        <DisclaimerNotice partyData heading="Read this first" />
        <Method />
        <Coverage data={data} />
        <Seats data={data} />
        <PartyCodes data={data} />
        <Downloads data={data} />
        <Citation data={data} />
        <Caveats />
      </main>
      <SiteFooter />
    </>
  );
}

function Method() {
  return (
    <section className="nep-section mpbc-section" aria-labelledby="pd-method">
      <h2 id="pd-method" className="mpbc-h2">How a budget gets a party</h2>
      <ol className="mpbc-caveats">
        <li>A budget line sits in one of today’s 254 legislative districts, by the place its title names or the one district its DPWH office serves. Lines with no single district get no party.</li>
        <li>Each budget year carries the Congress that passed it. The 2027 NEP and House bill carry the 20th Congress.</li>
        <li>That Congress’s race for the district is found by province or city and district number, in the election results.</li>
        <li>The race must have the same towns as the district’s 2025 race. If its towns changed, the district gets no party that year.</li>
        <li>The party is the one the winner ran under, as the results print it. The 20th Congress uses the House directory’s member and the party they ran under in May 2025.</li>
      </ol>
      <div className="mpbc-tablewrap">
        <table className="mpbc-table">
          <thead><tr><th scope="col">Congress</th><th scope="col">Elected</th><th scope="col">Budgets it carries</th></tr></thead>
          <tbody>
            {CONGRESS_TERMS.map((t) => (
              <tr key={t.congress}>
                <td>{t.label}</td>
                <td>May {t.year}</td>
                <td>{t.budget_years.map((y) => (y === 2027 ? '2027 NEP and House bill' : `${y} GAA`)).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mpbc-more">
        The party grids that use these seats: <Link to={`${MPB_COMPARE_ROOT}#by-party-and-year`}>multi-purpose buildings</Link> and{' '}
        <Link to={`${FLOOD_COMPARE_ROOT}#by-party-and-year`}>flood control</Link>.
      </p>
    </section>
  );
}

function Coverage({ data }: { data: CongressSeatsFile }) {
  return (
    <section className="nep-section mpbc-section" aria-labelledby="pd-coverage">
      <h2 id="pd-coverage" className="mpbc-h2">Coverage</h2>
      <p className="mpbc-dek">Of today’s 254 districts, how many each election lets us read. Only “same towns” seats with a party carry one.</p>
      <div className="mpbc-tablewrap">
        <table className="mpbc-table">
          <thead>
            <tr>
              <th scope="col">Congress</th>
              <th scope="col" className="is-num">Same towns</th>
              <th scope="col" className="is-num">Towns changed</th>
              <th scope="col" className="is-num">No race on record</th>
              <th scope="col" className="is-num">No party on record</th>
            </tr>
          </thead>
          <tbody>
            {data.terms.map((t) => (
              <tr key={t.congress}>
                <td>{t.label} ({t.year})</td>
                <td className="is-num">{n(t.counts.same)}</td>
                <td className="is-num">{n(t.counts.changed)}</td>
                <td className="is-num">{n(t.counts.absent)}</td>
                <td className="is-num">{n(t.counts.no_party)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mpbc-more">
        No race on record: a district created since, or a race the results list only as a province or Metro Manila total
        (2013 has 61 such districts). A one-seat race the results list with several winners is an error in the source: it
        gets no party, and its note says so.
      </p>
    </section>
  );
}

function Seats({ data }: { data: CongressSeatsFile }) {
  const [params, setParams] = useSearchParams();
  const congress = Number(params.get('congress')) || 20;
  const q = (params.get('q') ?? '').toLowerCase();
  const term = data.terms.find((t) => t.congress === congress) ?? data.terms[data.terms.length - 1];
  const districts = data.districts ?? Object.keys(term.seats).map((id) => [id, id, null] as [string, string, string | null]);
  const rows = useMemo(() => districts.map(([id, label, region]) => ({ id, label, region, s: term.seats[id] as CongressSeat | undefined }))
    .filter((r) => !q || `${r.label} ${r.region ?? ''} ${r.s?.[1] ?? ''} ${r.s?.[0] ?? ''} ${r.s?.[0] ? partyName(r.s[0]) : ''}`.toLowerCase().includes(q)),
  [districts, term, q]);
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  return (
    <section className="nep-section mpbc-section" id="seats" aria-labelledby="pd-seats">
      <h2 id="pd-seats" className="mpbc-h2">Every seat</h2>
      <p className="mpbc-dek">Pick a Congress. Each row links its race and its winner on BetterGov Dynasties, so you can check the votes and the party.</p>
      <div className="pd-controls" role="group" aria-label="Congress">
        {data.terms.map((t) => (
          <button key={t.congress} type="button" className={`pd-tab${t.congress === term.congress ? ' is-on' : ''}`}
            aria-pressed={t.congress === term.congress} onClick={() => set('congress', String(t.congress))}>
            {t.label} <span>({t.year})</span>
          </button>
        ))}
        <input type="search" className="pd-search" placeholder="Search a district, member or party" defaultValue={params.get('q') ?? ''}
          aria-label="Search a district, member or party" onChange={(e) => set('q', e.target.value.trim() || null)} />
      </div>
      <p className="mpbc-more">{n(rows.length)} of 254 districts · {term.label}, elected May {term.year}</p>
      <div className="mpbc-tablewrap">
        <table className="mpbc-table pd-seats">
          <thead>
            <tr>
              <th scope="col">District (today)</th>
              <th scope="col">Representative</th>
              <th scope="col">Party</th>
              <th scope="col">Towns</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, label, region, s }) => (
              <tr key={id}>
                <td>{label}{region && <span className="mpbc-sub">{region}</span>}</td>
                <td>{s?.[1] ?? '—'}{s?.[7] && <span className="mpbc-sub">{s[7]}</span>}</td>
                <td>
                  {s?.[0] ? <>{partyName(s[0])}{partyName(s[0]) !== s[0] && <span className="mpbc-sub">{s[0]}</span>}</> : '—'}
                  {s?.[6] && <span className="mpbc-sub">printed {s[6]}</span>}
                </td>
                <td>{TOWNS[s ? s[2] : 'none']}</td>
                <td className="pd-links">
                  {s?.[3] ? <a href={dynastyContestApi(s[3])} target="_blank" rel="noopener noreferrer">Race ↗</a> : null}
                  {s?.[4] && s?.[5] ? <a href={dynastyPersonUrl(s[5], s[4])} target="_blank" rel="noopener noreferrer">Winner ↗</a> : null}
                  {!s?.[3] && '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PartyCodes({ data }: { data: CongressSeatsFile }) {
  const codes = useMemo(() => {
    const m = new Map<string, number[]>();
    data.terms.forEach((t, i) => {
      for (const s of Object.values(t.seats)) {
        if (!s[0] || s[2] !== 'same') continue;
        const row = m.get(s[0]) ?? data.terms.map(() => 0);
        row[i]++;
        m.set(s[0], row);
      }
    });
    return [...m].sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0) || a[0].localeCompare(b[0]));
  }, [data]);
  return (
    <section className="nep-section mpbc-section" aria-labelledby="pd-codes">
      <h2 id="pd-codes" className="mpbc-h2">Party codes</h2>
      <p className="mpbc-dek">
        Codes as the results print them, with the name we read them as, and the seats each carries (same towns only).
        One code is read as another: {Object.entries(data.aliases ?? {}).map(([a, b]) => `${a} (2016) as ${b}`).join('; ')}. Joint tickets
        (NUP/PPP) and local chapters are kept as printed.
      </p>
      <div className="mpbc-tablewrap">
        <table className="mpbc-table">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Read as</th>
              {data.terms.map((t) => <th key={t.congress} scope="col" className="is-num">{t.year}</th>)}
            </tr>
          </thead>
          <tbody>
            {codes.map(([code, seats]) => (
              <tr key={code}>
                <td><code>{code}</code></td>
                <td>{partyName(code) === code ? '—' : partyName(code)}</td>
                {seats.map((v, i) => <td key={i} className="is-num">{v || '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Downloads({ data }: { data: CongressSeatsFile }) {
  const csv = data.outputs?.['congress-seats.csv'];
  return (
    <section className="nep-section mpbc-section" aria-labelledby="pd-dl">
      <h2 id="pd-dl" className="mpbc-h2">Downloads and fields</h2>
      <p className="mpbc-dek">
        <a href={`${dataUrl(CONGRESS_SEATS_CSV_PATH)}${csv ? `?v=${csv.sha256.slice(0, 12)}` : ''}`} download={CONGRESS_SEATS_CSV_NAME}>
          Every district in every Congress (CSV{csv ? `, ${(csv.bytes / 1e3).toFixed(0)} KB` : ''})
        </a>
        {' · '}
        <a href={dataUrl(CONGRESS_SEATS_PATH)}>congress-seats.json</a>. One row per district and Congress: 1,270 rows.
      </p>
      <dl className="mpbc-fields">
        {CONGRESS_SEATS_CSV_FIELDS.map((f) => <div key={f.name}><dt><code>{f.name}</code></dt><dd>{f.about}</dd></div>)}
      </dl>
    </section>
  );
}

function Citation({ data }: { data: CongressSeatsFile }) {
  const src = data.source;
  return (
    <section className="nep-section mpbc-section" id="cite" aria-labelledby="pd-cite">
      <h2 id="pd-cite" className="mpbc-h2">Sources and how to cite</h2>
      <ul className="mpbc-caveats">
        <li>
          <strong>Election results:</strong> {src.citation ?? 'Open Halalan.'}{' '}
          <a href={OPEN_HALALAN_URL} target="_blank" rel="noopener noreferrer">Open Halalan ↗</a>, 2013 to 2025 House races.
        </li>
        <li>
          <strong>As compiled by:</strong>{' '}
          <a href={DYNASTIES_SITE} target="_blank" rel="noopener noreferrer">BetterGov Dynasties ↗</a>
          {' '}(<a href={DYNASTIES_DEVELOPERS} target="_blank" rel="noopener noreferrer">API ↗</a>)
          {src.data_vintage && <>, data of {src.data_vintage}</>}. {src.license}
        </li>
        <li>
          <strong>20th Congress members:</strong> the House directory, as on the district pages, with the party each ran under in May 2025
          (<Link to={PARTIES_ROOT}>the 2027 House bill by party</Link>).
        </li>
        <li>
          <strong>Our matching:</strong> <a href={BUILDER_URL} target="_blank" rel="noopener noreferrer">build-hgab-congress-seats.ts ↗</a>, built {data.built_at.slice(0, 10)}.
        </li>
      </ul>
      <p className="pd-cite">
        Cite as: BetterGov.ph, “{PARTY_DATA_TITLE}: House seats by Congress, 2013–2025,” budget.bettergov.ph{PARTY_DATA_ROOT}.
        Election results from {src.citation ?? 'Open Halalan'} Via BetterGov Dynasties.
      </p>
    </section>
  );
}

function Caveats() {
  return (
    <section className="nep-section mpbc-section" aria-labelledby="pd-caveats">
      <h2 id="pd-caveats" className="mpbc-h2">Caveats</h2>
      <ul className="mpbc-caveats">
        <li>Members of the House often switch parties during a term, often after a new President takes office. The party here is the one they ran under; switches are not recorded.</li>
        <li>So a party’s figure for a year can include members who had already joined another party, and leave out members who had joined it.</li>
        <li>A party’s figure grows with the seats it held. Compare it with the number of districts, which each grid’s cells show on hover.</li>
        <li>A seat that changed towns since an election gets no party for that election’s budgets, rather than a guess.</li>
        <li>The results print local parties and joint tickets as written; a code we do not recognise is shown as printed.</li>
        <li>Party-list representatives hold no district and are not in these figures.</li>
        <li>A district is where the budget documents place the work, not who asked for it. No figure here is evidence of wrongdoing.</li>
      </ul>
    </section>
  );
}
