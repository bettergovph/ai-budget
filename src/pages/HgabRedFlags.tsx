/**
 * `/hgab/2027/1T-redflags` — ₱1 trillion in red flags: the People's Budget Coalition's red-flag basket through the
 * FY 2027 House bill, the page the campaign poster points to (scripts/build-hgab-poster-redflags.ts).
 *
 * Every figure is PBC's (src/lib/hgab-redflags.ts), shown as PBC publishes it, in billions of pesos. The page adds
 * what we can: each line's place in our own reading of the House bill, with a link to it in the line-by-line
 * explorer, and verify:hgab checks that PBC's figures round the exact amounts there. Changes are coloured as on the
 * poster (red: more in the House bill; blue: less), since the page is the poster's own.
 *
 * Copy: factual headings with the number in them, sentences of at most 20 words, PBC named as the basket's owner
 * everywhere a total appears; the checking and the rounding sit in "Details for analysts".
 */
import { Fragment, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabDetails, HgabHeader, HgabHero } from '../components/HgabBits';
import { pageMeta } from '../lib/seo';
import { LINES_UNDER_REVIEW } from '../lib/hgab-explorer';
import {
  DPWH_PROJECTS, PBC_REPORT, RED_FLAGS_ROOT, RED_FLAGS_TITLE, RED_FLAG_GROUPS, RED_FLAG_LINES,
  RED_FLAG_TOTALS, RED_FLAG_UNPROGRAMMED, TRILLION, billHref, isDpwhLine, linesOf, pbcBillions,
  pbcBillionsWords, pbcChange, type RedFlagGroupKey, type RedFlagLine,
} from '../lib/hgab-redflags';
import '../nep2027.css';
import '../hgab-redflags.css';

const T = RED_FLAG_TOTALS;
const U = RED_FLAG_UNPROGRAMMED;
/** The bars' scale: zero to a little past the House bill, as on the poster. */
const SCALE = 1_100_000_000_000;
const PATRONAGE = RED_FLAG_GROUPS.find((g) => g.key === 'patronage')!;
const peso = (n: number) => `₱${n.toLocaleString('en-US')}`;
const pctOf = (php: number) => `${((php / SCALE) * 100).toFixed(3)}%`;
const tied = RED_FLAG_LINES.filter((l) => l.bill.kind === 'line' || l.bill.kind === 'change');
const exact = RED_FLAG_LINES.filter((l) => l.bill.kind === 'line');
const dpwh = RED_FLAG_LINES.filter(isDpwhLine);
const sumOf = (ls: readonly RedFlagLine[], side: 'nep' | 'house') => ls.reduce((a, l) => a + l[side], 0);
const PBC_TABLE_URL = `${PBC_REPORT.url}${PBC_REPORT.anchor}`;

/** The notes under the table, in table order: one per text, so the DPWH programs share theirs. */
const NOTES = [...new Set(RED_FLAG_LINES.flatMap((l) => (l.note ? [l.note] : [])))].map((text) => {
  const lines = RED_FLAG_LINES.filter((l) => l.note === text);
  return { text, label: lines.length > 1 && lines.every(isDpwhLine) ? 'DPWH programs' : lines.map((l) => l.short).join(', ') };
});
const noteNo = (l: RedFlagLine) => NOTES.findIndex((n) => n.text === l.note) + 1;

function Change({ php }: { php: number }) {
  if (php === 0) return <span className="hgab-rf-same">same</span>;
  return <span className={php > 0 ? 'hgab-rf-up' : 'hgab-rf-down'}>{pbcChange(php)}</span>;
}

/** Two bars to one scale from zero, the House bill over the NEP, and the line at ₱1 trillion across both. */
function Bars() {
  const parts = (side: 'nep' | 'house') => [
    ...RED_FLAG_GROUPS.map((g) => ({ key: g.key as RedFlagGroupKey | 'unprogrammed', name: g.short, php: g[side] })),
    { key: 'unprogrammed' as const, name: U.short, php: U[side] },
  ];
  const bar = (side: 'nep' | 'house') => (
    <div className={`hgab-rf-track is-${side}`}>
      {parts(side).map((p) => (
        <span key={p.key} className={`hgab-rf-seg is-${p.key}`} style={{ width: pctOf(p.php) }} title={`${p.name}: ${pbcBillions(p.php)}`} />
      ))}
    </div>
  );
  return (
    <figure className="hgab-rf-bars">
      <div className="hgab-rf-bars-grid" role="img"
        aria-label={`House bill ${pbcBillionsWords(T.all.house)}, past ₱1 trillion; NEP ${pbcBillionsWords(T.all.nep)}, short of it.`}>
        <span className="hgab-rf-bars-lab is-house">House bill</span>
        <div className="hgab-rf-tracks">
          {bar('house')}
          {bar('nep')}
          <span className="hgab-rf-tline" style={{ left: pctOf(TRILLION) }}><span>₱1 trillion</span></span>
        </div>
        <b className="hgab-rf-bars-tot is-house">{pbcBillions(T.all.house)}</b>
        <span className="hgab-rf-bars-lab is-nep">NEP</span>
        <b className="hgab-rf-bars-tot is-nep">{pbcBillions(T.all.nep)}</b>
      </div>
      <ul className="hgab-rf-key">
        {RED_FLAG_GROUPS.map((g) => (
          <li key={g.key}>
            <i className={`hgab-rf-swatch is-${g.key}`} aria-hidden="true" />
            <span>{g.short}</span> <b>{pbcBillions(g.house)}</b> <Change php={g.change} />
          </li>
        ))}
        <li>
          <i className="hgab-rf-swatch is-unprogrammed" aria-hidden="true" />
          <span>{U.short}</span> <b>{pbcBillions(U.house)}</b> <span className="hgab-rf-same">same</span>
        </li>
      </ul>
    </figure>
  );
}

/** Where a line stands against our reading of the bill: a link to it, or why there is none. */
function InTheBill({ l }: { l: RedFlagLine }) {
  const href = billHref(l);
  const c = l.bill;
  if (c.kind === 'pbc') return <span className="hgab-rf-chk is-pbc">PBC’s own figure</span>;
  if (c.kind === 'dpwh') return <Link className="hgab-rf-chk" to={href!}>DPWH projects, together</Link>;
  const tip = `In our reading of the House bill: NEP ${peso(c.ref.nep)}, House bill ${peso(c.ref.house)}`;
  return (
    <Link className={`hgab-rf-chk ${c.kind === 'line' ? 'is-match' : ''}`.trim()} to={href!} title={tip}>
      {c.kind === 'line' ? 'Matches the bill' : 'Change matches'}
    </Link>
  );
}

function LineRow({ l }: { l: RedFlagLine }) {
  return (
    <tr>
      <td className="hgab-rf-name">
        {l.name}
        {l.note && <sup><a href={`#rf-note-${noteNo(l)}`} aria-label={`Note ${noteNo(l)}`}>{noteNo(l)}</a></sup>}
        {l.nep === 0 && l.house > 0 && <span className="hgab-rf-new">New</span>}
      </td>
      <td className="num">{pbcBillions(l.nep)}</td>
      <td className="num hgab-rf-house">{pbcBillions(l.house)}</td>
      <td className="num"><Change php={l.change} /></td>
      <td><InTheBill l={l} /></td>
    </tr>
  );
}

export default function HgabRedFlags() {
  useEffect(() => {
    document.title = pageMeta(RED_FLAGS_ROOT).title;
  }, []);

  const crumb = 'Red flags';
  return (
    <>
      <HgabHeader crumb={crumb} />
      <HgabHero
        crumb={crumb}
        title={RED_FLAGS_TITLE}
        dek={
          <>
            The People’s Budget Coalition follows a fixed set of budget lines it calls red flags. In the House bill
            they add up to {pbcBillionsWords(T.all.house)}, {pbcBillionsWords(T.all.change)} more than in the NEP.
          </>
        }
        note={
          <>
            PBC’s figures, from{' '}
            <a href={PBC_TABLE_URL} target="_blank" rel="noopener noreferrer">“{PBC_REPORT.title}”</a> ({PBC_REPORT.date}),
            checked against our reading of the House bill.
          </>
        }
      />

      <main className="nep-main hgab-rf-main">
        <section className="hgab-rf-section" aria-labelledby="rf-total">
          <h2 id="rf-total" className="hgab-rf-h2">
            {pbcBillionsWords(T.all.house)} in the House bill, {pbcBillionsWords(T.all.nep)} in the NEP
          </h2>
          <p className="hgab-rf-dek">
            Both include {pbcBillionsWords(U.house)} in unprogrammed appropriations, the same in each. Without them the
            red flags come to {pbcBillionsWords(T.programmed.house)} and {pbcBillionsWords(T.programmed.nep)}.
          </p>
          <Bars />
          <p className="hgab-rf-dek">
            Patronage-risk programs rose {Math.round((PATRONAGE.change / PATRONAGE.nep) * 100)}%, to{' '}
            {pbcBillionsWords(PATRONAGE.house)}. Congress enacted {pbcBillionsWords(PATRONAGE.gaa2026)} for the same
            lines in 2026.
          </p>
        </section>

        <section className="nep-section hgab-rf-section" aria-labelledby="rf-lines">
          <h2 id="rf-lines" className="hgab-rf-h2">The {RED_FLAG_LINES.length} lines, in PBC’s three groups</h2>
          <p className="hgab-rf-dek">
            In billions of pesos, as PBC publishes them. Where a line is a line of the House bill, the link opens it in
            our own reading of the bill.
          </p>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-rf-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col" className="num">NEP</th>
                  <th scope="col" className="num">House bill</th>
                  <th scope="col" className="num">Change</th>
                  <th scope="col">In the bill</th>
                </tr>
              </thead>
              <tbody>
                {RED_FLAG_GROUPS.map((g) => (
                  <Fragment key={g.key}>
                    <tr className={`hgab-rf-group is-${g.key}`}>
                      <th scope="rowgroup" colSpan={5}>
                        <div className="hgab-rf-group-in">
                          <span className="hgab-rf-group-name">{g.name}</span>
                          <span className="hgab-rf-group-plain">{g.plain}</span>
                        </div>
                      </th>
                    </tr>
                    {linesOf(g.key).map((l) => <LineRow key={l.key} l={l} />)}
                    <tr className="hgab-rf-subtotal">
                      <td>Subtotal</td>
                      <td className="num">{pbcBillions(g.nep)}</td>
                      <td className="num">{pbcBillions(g.house)}</td>
                      <td className="num"><Change php={g.change} /></td>
                      <td />
                    </tr>
                  </Fragment>
                ))}
                <tr className="hgab-rf-total">
                  <td>All three groups</td>
                  <td className="num">{pbcBillions(T.programmed.nep)}</td>
                  <td className="num">{pbcBillions(T.programmed.house)}</td>
                  <td className="num"><Change php={T.programmed.change} /></td>
                  <td />
                </tr>
                <tr className="hgab-rf-group is-unprogrammed">
                  <th scope="rowgroup" colSpan={5}>
                    <div className="hgab-rf-group-in">
                      <span className="hgab-rf-group-name">{U.name}</span>
                      <span className="hgab-rf-group-plain">{U.plain}</span>
                    </div>
                  </th>
                </tr>
                <tr>
                  <td className="hgab-rf-name">{U.name}</td>
                  <td className="num">{pbcBillions(U.nep)}</td>
                  <td className="num hgab-rf-house">{pbcBillions(U.house)}</td>
                  <td className="num"><Change php={U.change} /></td>
                  <td>
                    <Link className="hgab-rf-chk is-match" to="/hgab/2027/explorer/unprogrammed-appropriations"
                      title={`In our reading of both documents: ${peso(U.exact)}`}>Matches the bill</Link>
                  </td>
                </tr>
                <tr className="hgab-rf-total is-all">
                  <td>Red flags, with unprogrammed appropriations</td>
                  <td className="num">{pbcBillions(T.all.nep)}</td>
                  <td className="num">{pbcBillions(T.all.house)}</td>
                  <td className="num"><Change php={T.all.change} /></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <ol className="hgab-rf-notes">
            {NOTES.map((n, i) => (
              <li key={n.label} id={`rf-note-${i + 1}`}>
                <b>{n.label}.</b> {n.text}
              </li>
            ))}
          </ol>
          <p className="hgab-rf-small">
            PBC rounds each figure to ₱0.1 billion and works out changes before rounding, so a group’s lines can miss
            its subtotal by a little.
          </p>
        </section>

        <section className="nep-section hgab-rf-section" aria-labelledby="rf-sources">
          <h2 id="rf-sources" className="hgab-rf-h2">Where the figures come from</h2>
          <ul className="hgab-rf-sources">
            <li>
              <a href={PBC_TABLE_URL} target="_blank" rel="noopener noreferrer">{PBC_REPORT.title}</a>, {PBC_REPORT.by},{' '}
              {PBC_REPORT.date}: the table “{PBC_REPORT.table}”.
            </li>
            <li>
              <Link to="/hgab/2027/explorer">The House bill, line by line</Link>: our own reading of every line, which
              the links above open.
            </li>
          </ul>
          <HgabDetails>
            <p>
              <strong>How we checked PBC’s figures.</strong> {tied.length} lines are lines of the House bill. For{' '}
              {exact.length} of them, PBC’s NEP, House bill and change figures are the amounts below, rounded to ₱0.1
              billion. For TUPAD and the DA equipment lines only the change matches, for the reasons in the notes.
              verify:hgab checks all of this whenever the data is rebuilt.
              {LINES_UNDER_REVIEW && ' Our line-by-line reading of the bill is still under citizen review.'}
            </p>
            <div className="nep-table-wrap">
              <table className="nep-table hgab-rf-exact">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col" className="num">NEP, exact</th>
                    <th scope="col" className="num">House bill, exact</th>
                    <th scope="col">Matches</th>
                  </tr>
                </thead>
                <tbody>
                  {tied.map((l) => l.bill.kind === 'line' || l.bill.kind === 'change' ? (
                    <tr key={l.key}>
                      <td><Link to={billHref(l)!}>{l.short}</Link></td>
                      <td className="num">{peso(l.bill.ref.nep)}</td>
                      <td className="num">{peso(l.bill.ref.house)}</td>
                      <td>{l.bill.kind === 'line' ? 'All three figures' : 'The change'}</td>
                    </tr>
                  ) : null)}
                  <tr>
                    <td><Link to="/hgab/2027/explorer/unprogrammed-appropriations">{U.short}</Link></td>
                    <td className="num">{peso(U.exact)}</td>
                    <td className="num">{peso(U.exact)}</td>
                    <td>All three figures</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <strong>DPWH.</strong> PBC’s {dpwh.length} DPWH lines add up to {pbcBillions(sumOf(dpwh, 'nep'))} in the NEP
              and {pbcBillions(sumOf(dpwh, 'house'))} in the House bill. That is every DPWH project line our{' '}
              <Link to="/hgab/2027/dpwh">DPWH pages</Link> compare: {peso(DPWH_PROJECTS.nep)} and{' '}
              {peso(DPWH_PROJECTS.house)}. PBC splits them into programs by budget code, which the House bill does not
              publish, so only the convergence program can be checked on its own.
            </p>
            <p>
              <strong>Do not add our project counts to these totals.</strong> Our DPWH insertion candidates are projects
              inside these six lines, so adding them would count the same budget twice.
            </p>
            <p>
              <strong>One overlap inside PBC’s total.</strong> The Office of the President’s confidential and
              intelligence funds are in its own budget and in the all-agency confidential funds line. PBC puts the
              overlap at about ₱4.5 billion in past years and gives no 2027 figure.
            </p>
          </HgabDetails>
        </section>

        <DisclaimerNotice redFlags className="hgab-rf-notice" />
      </main>
      <SiteFooter />
    </>
  );
}
