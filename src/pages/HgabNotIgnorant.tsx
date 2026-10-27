/**
 * `/hgab/2027/we-are-not-ignorant` — "We are not ignorant": every inserted
 * and adjusted project in the FY2027 House bill, on one page.
 *
 * No site header, no sub-nav, no hero, no column headers: the BetterGov logo,
 * the title, one line of counts, the CSV link, then the whole list — every
 * row, House bill amount largest first, across the four programs — and one
 * footer line. Rendered from the prebuilt `changes-list.json` (one fetch,
 * `npm run build:hgab-changes-list`); no DuckDB here.
 *
 * Rules carried from the section (see src/lib/hgab-changes-list.ts): the
 * counts are the section's candidate changes; NEP and House amounts are shown
 * side by side, never added; a DPWH line names the office the House bill
 * lists, the districts that office serves and those districts' seat holders,
 * never "their" project; lines with no district name no one.
 *
 * Performance: ~7,500 items. They are split into chunks of CHUNK items, each
 * its own grid <ol>, filled left to right, numbered continuously, with
 * `content-visibility: auto`, so only the chunks on screen are laid out. The
 * first chunks commit as soon as the data lands; the rest render in one
 * transition right after, so the first screen never waits for the whole list.
 * Item links are plain anchors; one delegated click handler keeps them in the
 * SPA. Prints as a long poster (see the print rules in the CSS).
 */
import { startTransition, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pageMeta } from '../lib/seo';
import { dataUrl } from '../lib/data-url';
import { HGAB_ROOT, REGION_LABELS, regionKeyOf } from '../lib/hgab';
import { DEO_RESTRICTIONS_LINK_TEXT, DEO_RESTRICTIONS_PATH, DISCLAIMERS_PATH } from '../lib/hgab-disclaimers';
import {
  CHANGES_LIST_CSV_NAME, CHANGES_LIST_CSV_PATH, CHANGES_LIST_JSON_PATH, CHANGES_LIST_ROOT, CHANGES_LIST_TITLE,
  CHANGE_PROGRAM_LABELS, NO_DISTRICT_TEXT, seatHoldersText, shortOffice,
  type ChangesListData, type ChangesListRow,
} from '../lib/hgab-changes-list';
import '../hgab-not-ignorant.css';

const LOGO = '/brand/bettergov-horizontal-primary.png';
/** Items per multi-column chunk: divides evenly into 1–6 columns. */
const CHUNK = 60;
/** Chunks committed at once when the data lands; the rest follow in one interruptible transition. */
const FIRST_CHUNKS = 2;

const peso = (n: number) => `₱${n.toLocaleString('en-US')}`;
const signedPeso = (n: number) => `${n < 0 ? '−' : '+'}${peso(Math.abs(n))}`;

/** "Region I" for "REGION I - ILOCOS"; anything unrecognised ("Nationwide") as published. */
function regionText(r: string | null): string | null {
  if (!r) return null;
  const k = regionKeyOf(r);
  return k ? REGION_LABELS[k].short : r;
}

/** program · detail · region · province · office · [shared …] · districts served · representatives (or why no district). */
function metaText(r: ChangesListRow): { lead: string; reps: string } {
  const parts: string[] = [CHANGE_PROGRAM_LABELS[r.p]];
  if (r.pa) parts.push(r.pa);
  const region = regionText(r.r);
  if (region) parts.push(region);
  if (r.pv) parts.push(r.pv);
  if (r.o && r.w !== 'central') parts.push(shortOffice(r.o));
  if (r.w === 'office' && r.ds) {
    // A shared office is listed whole with every district it serves (the section's Tier B wording).
    if (r.tr === 'B') parts.push(`shared by ${r.rp?.length ?? 0} districts, not split`);
    parts.push(`serves ${r.ds}`);
  }
  else if (r.w && r.w !== 'office') parts.push(NO_DISTRICT_TEXT[r.w]);
  return { lead: parts.join(' · '), reps: r.w === 'office' ? seatHoldersText(r.rp) : '' };
}

function Item({ r, n }: { r: ChangesListRow; n: number }) {
  const { lead, reps } = metaText(r);
  const cls = r.k === 'inserted' ? 'is-in' : r.k === 'increased' ? 'is-up' : 'is-down';
  return (
    <li className={`hgab-wani-item ${cls}`}>
      <span className="hgab-wani-n" aria-hidden="true">{n.toLocaleString('en-US')}</span>
      <span className={`hgab-wani-tag ${cls}`}>{r.k}</span>{' '}
      <span className="hgab-wani-amt">
        {r.k === 'inserted' ? (
          <>
            <b>{peso(r.h ?? 0)}</b>
            {r.m ? <span className="hgab-wani-kind"> · listed as {r.m} lines</span> : null}
          </>
        ) : (
          <>
            <b>
              <span className="hgab-wani-num">{r.n == null ? 'none' : peso(r.n)}</span> <span aria-hidden="true">→</span>
              <span className="hgab-wani-sr"> to </span> <span className="hgab-wani-num">{r.h == null ? 'none' : peso(r.h)}</span>
            </b>{' '}
            <span className="hgab-wani-chg">({signedPeso(r.d ?? 0)})</span>
          </>
        )}
        {r.u ? <span className="hgab-wani-flag">unconfirmed match</span> : null}
      </span>
      <a className="hgab-wani-ttl" href={r.x}>{r.t}</a>
      <span className="hgab-wani-meta">
        {lead}
        {reps ? <> · <span className="hgab-wani-reps">{reps}</span></> : null}
      </span>
    </li>
  );
}

export default function HgabNotIgnorant() {
  const navigate = useNavigate();
  const [data, setData] = useState<ChangesListData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    document.title = pageMeta(CHANGES_LIST_ROOT).title;
    const url = dataUrl(CHANGES_LIST_JSON_PATH);
    let live = true;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return res.json() as Promise<ChangesListData>;
      })
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);

  // First screen at once, then every remaining item (no paging: the whole list ends up in the DOM).
  useEffect(() => {
    if (!data) return;
    if (!all) {
      performance.mark('hgab-wani-first');
      startTransition(() => setAll(true));
    } else {
      performance.mark('hgab-wani-rendered');
    }
  }, [data, all]);

  const chunks = useMemo(() => {
    const out: ChangesListRow[][] = [];
    for (let i = 0; data && i < data.rows.length; i += CHUNK) out.push(data.rows.slice(i, i + CHUNK));
    return out;
  }, [data]);

  // Item links are plain anchors (thousands of <Link>s would cost hooks each); keep a plain click in the SPA.
  const onListClick = useCallback((e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest('a');
    const href = a?.getAttribute('href');
    if (!href?.startsWith('/')) return;
    e.preventDefault();
    navigate(href);
  }, [navigate]);

  return (
    <div className="hgab-wani">
      <header className="hgab-wani-top">
        <Link to={`${HGAB_ROOT}/overview`} className="hgab-wani-logo" aria-label="BetterGov.ph House Budget Analysis">
          <img src={LOGO} alt="BetterGov.ph" width={800} height={206} />
        </Link>
        <h1 className="hgab-wani-h1">{CHANGES_LIST_TITLE}</h1>
        {data ? (
          <>
            <p className="hgab-wani-count">
              {data.totals.records.toLocaleString('en-US')} inserted and adjusted projects in the 2027 House bill: DPWH,
              farm-to-market roads, health facilities and irrigation.
            </p>
            <p className="hgab-wani-dl">
              <a href={dataUrl(CHANGES_LIST_CSV_PATH)} download={CHANGES_LIST_CSV_NAME}>Download the full list (CSV)</a>
            </p>
          </>
        ) : (
          <p className="hgab-wani-count" role="status">{err ? `The list could not be loaded: ${err}` : 'Loading the list…'}</p>
        )}
      </header>

      {data && (
        <main className="hgab-wani-list" onClick={onListClick}>
          {(all ? chunks : chunks.slice(0, FIRST_CHUNKS)).map((rows, ci) => (
            <ol key={ci} className="hgab-wani-chunk" start={ci * CHUNK + 1}>
              {rows.map((r, j) => <Item key={`${r.p}:${r.i}`} r={r} n={ci * CHUNK + j + 1} />)}
            </ol>
          ))}
        </main>
      )}

      <footer className="hgab-wani-foot">
        <p>
          Amounts are as published in the NEP and House Bill 10858 (third reading). Projects are listed by the DPWH
          office that carries them out; the documents do not say who asked for any project. Matches are candidates,
          not findings.{' '}
          <Link to={DISCLAIMERS_PATH}>Full disclaimers</Link>
          {' · '}
          <Link to={DEO_RESTRICTIONS_PATH}>{DEO_RESTRICTIONS_LINK_TEXT}</Link>
          {' · '}
          <Link to={`${HGAB_ROOT}/sources`}>Sources</Link>
        </p>
      </footer>
    </div>
  );
}
