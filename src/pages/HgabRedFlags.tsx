/**
 * `/hgab/2027/1T-redflags` — ₱1 trillion in red flags: the People's Budget Coalition's red-flag basket through the
 * FY 2027 House bill, the page the campaign poster points to (scripts/build-hgab-poster-redflags.ts).
 *
 * Every figure is PBC's (src/lib/hgab-redflags.ts), shown as PBC publishes it, in billions of pesos, with its 2026
 * columns: what was proposed (NEP) and what Congress enacted (GAA). Jason (2026-11-09) asked for each line's name to
 * open the page where we show its data, and for reasons rather than a bare list: so each name links to the line in
 * the explorer or its DPWH program's projects, a plain sentence under it says why PBC watches it, and a short section
 * sets out PBC's reasons for the basket as a whole. Changes are coloured as on the poster (red: more in the House
 * bill; blue: less).
 *
 * Copy: factual headings with the number in them, plain sentences, PBC named as the basket's owner, and a red flag
 * always a reason to look closer, never a finding; the checking and the rounding sit in "Details for analysts".
 */
import { Fragment, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabDetails, HgabHeader, HgabHero } from '../components/HgabBits';
import { pageMeta } from '../lib/seo';
import { LINES_UNDER_REVIEW } from '../lib/hgab-explorer';
import {
  DPWH_PROJECTS, PBC_REPORT, RED_FLAGS_ROOT, RED_FLAGS_TITLE, RED_FLAG_GROUPS, RED_FLAG_LINES, RED_FLAG_TOTALS,
  RED_FLAG_UNPROGRAMMED, TRILLION, UNPROGRAMMED_HREF, billHref, isDpwhLine, linesOf, pbcBillions, pbcBillionsWords,
  pbcChange, type RedFlagFigures, type RedFlagGroupKey, type RedFlagLine,
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
const PBC_TABLE_URL = `${PBC_REPORT.url}${PBC_REPORT.anchor}`;
/** Lines whose three 2027 figures match our data, and those where only the change does. */
const MATCHED = RED_FLAG_LINES.filter((l) => l.bill.kind === 'line' || l.bill.kind === 'dpwh');
const CHANGE_ONLY = RED_FLAG_LINES.filter((l) => l.bill.kind === 'change');
const DPWH_LINES = RED_FLAG_LINES.filter(isDpwhLine);
const LOCAL = RED_FLAG_LINES.find((l) => l.key === 'dpwh-local')!;
/** The exact amounts behind a line, from the explorer or the DPWH project pages. */
const exactOf = (l: RedFlagLine) => (l.bill.kind === 'pbc' ? null : l.bill.ref);

/** The notes under the table, in table order. */
const NOTED = RED_FLAG_LINES.filter((l) => l.note);
const noteNo = (l: RedFlagLine) => NOTED.indexOf(l) + 1;

function Change({ php }: { php: number }) {
  if (php === 0) return <span className="hgab-rf-same">same</span>;
  return <span className={php > 0 ? 'hgab-rf-up' : 'hgab-rf-down'}>{pbcChange(php)}</span>;
}

/** The five figure cells of a row: 2026 proposed and enacted, then 2027 NEP, House bill and change. On a phone the
 *  row stacks and each cell shows its `data-label` (hgab-redflags.css). */
function Figures({ x, strong = false }: { x: RedFlagFigures; strong?: boolean }) {
  return (
    <>
      <td className="num hgab-rf-2026" data-label="2026 NEP">{pbcBillions(x.nep2026)}</td>
      <td className="num hgab-rf-2026" data-label="2026 enacted">{pbcBillions(x.gaa2026)}</td>
      <td className="num hgab-rf-2027" data-label="2027 NEP">{pbcBillions(x.nep)}</td>
      <td className={`num ${strong ? 'hgab-rf-house' : ''}`.trim()} data-label="House bill">{pbcBillions(x.house)}</td>
      <td className="num" data-label="Change"><Change php={x.change} /></td>
    </>
  );
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

/** A line: its name, linked to the page that shows its data, PBC's reason under it, and its figures. */
function LineRow({ l }: { l: RedFlagLine }) {
  const href = billHref(l);
  return (
    <tr>
      <td className="hgab-rf-name">
        {href ? <Link to={href}>{l.name}</Link> : <span className="hgab-rf-nolink">{l.name}</span>}
        {l.note && <sup><a href={`#rf-note-${noteNo(l)}`} aria-label={`Note ${noteNo(l)}`}>{noteNo(l)}</a></sup>}
        {l.nep === 0 && l.house > 0 && <span className="hgab-rf-new">New</span>}
        <span className="hgab-rf-why">{l.why}</span>
      </td>
      <Figures x={l} strong />
    </tr>
  );
}

function GroupHead({ name, plain, why, k }: { name: string; plain: string; why: string; k: string }) {
  return (
    <tr className={`hgab-rf-group is-${k}`}>
      <th scope="rowgroup" colSpan={6}>
        <div className="hgab-rf-group-in">
          <span className="hgab-rf-group-name">{name}</span>
          <span className="hgab-rf-group-plain">{plain} {why}</span>
        </div>
      </th>
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

        <section className="nep-section hgab-rf-section" aria-labelledby="rf-why">
          <h2 id="rf-why" className="hgab-rf-h2">Why PBC flags these lines</h2>
          <p className="hgab-rf-dek">
            A red flag marks a line worth a closer look, and the documents behind it. It is not a finding that
            anything is wrong.
          </p>
          <ul className="hgab-rf-reasons">
            <li>
              <b>Politicians can shape them.</b> Who receives aid, and which roads and buildings get built, can be
              decided through a politician’s referral or district by district.
            </li>
            <li>
              <b>Congress has raised them before.</b> In 2026 it more than doubled the patronage-risk group, from{' '}
              {pbcBillionsWords(PATRONAGE.nep2026)} proposed to {pbcBillionsWords(PATRONAGE.gaa2026)} enacted.
            </li>
            <li>
              <b>Their documents should be public.</b> PBC asks that these budgets come with project lists, allocation
              rules or documents the public can see before any of it is released.
            </li>
          </ul>
        </section>

        <section className="nep-section hgab-rf-section" aria-labelledby="rf-lines">
          <h2 id="rf-lines" className="hgab-rf-h2">The {RED_FLAG_LINES.length} lines, in PBC’s three groups</h2>
          <p className="hgab-rf-dek">
            In billions of pesos, as PBC publishes them, with what was proposed and enacted for 2026. Each name opens
            the line in our own data; the sentence under it says why PBC watches it.
          </p>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-rf-table">
              <thead>
                <tr>
                  <th scope="col" rowSpan={2}>Line</th>
                  <th scope="colgroup" colSpan={2} className="hgab-rf-yr">2026</th>
                  <th scope="colgroup" colSpan={3} className="hgab-rf-yr">2027</th>
                </tr>
                <tr>
                  <th scope="col" className="num">NEP</th>
                  <th scope="col" className="num">Enacted</th>
                  <th scope="col" className="num">NEP</th>
                  <th scope="col" className="num">House bill</th>
                  <th scope="col" className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {RED_FLAG_GROUPS.map((g) => (
                  <Fragment key={g.key}>
                    <GroupHead k={g.key} name={g.name} plain={g.plain} why={g.why} />
                    {linesOf(g.key).map((l) => <LineRow key={l.key} l={l} />)}
                    <tr className="hgab-rf-subtotal">
                      <td>Subtotal</td>
                      <Figures x={g} />
                    </tr>
                  </Fragment>
                ))}
                <tr className="hgab-rf-total">
                  <td>All three groups</td>
                  <Figures x={T.programmed} />
                </tr>
                <GroupHead k="unprogrammed" name={U.name} plain={U.plain} why={U.why} />
                <tr>
                  <td className="hgab-rf-name"><Link to={UNPROGRAMMED_HREF}>{U.name}</Link></td>
                  <Figures x={U} strong />
                </tr>
                <tr className="hgab-rf-total is-all">
                  <td>Red flags, with unprogrammed appropriations</td>
                  <Figures x={T.all} />
                </tr>
              </tbody>
            </table>
          </div>
          <ol className="hgab-rf-notes">
            {NOTED.map((l) => (
              <li key={l.key} id={`rf-note-${noteNo(l)}`}>
                <b>{l.short}.</b> {l.note}
              </li>
            ))}
          </ol>
          <p className="hgab-rf-small">
            Change is the House bill against the 2027 NEP. PBC rounds each figure to ₱0.1 billion and works out
            changes before rounding, so a group’s lines can miss its subtotal by a little.
          </p>
        </section>

        <section className="nep-section hgab-rf-section" aria-labelledby="rf-sources">
          <h2 id="rf-sources" className="hgab-rf-h2">Where the figures come from</h2>
          <ul className="hgab-rf-sources">
            <li>
              <a href={PBC_TABLE_URL} target="_blank" rel="noopener noreferrer">{PBC_REPORT.title}</a>, {PBC_REPORT.by},{' '}
              {PBC_REPORT.date}: the table “{PBC_REPORT.table}”, and the reasons in its sections on red flags.
            </li>
            <li>
              <Link to="/hgab/2027/explorer">The House bill, line by line</Link> and the{' '}
              <Link to="/hgab/2027/dpwh?view=projects">DPWH projects</Link>: our own reading of the bill, which the line
              names open.
            </li>
          </ul>
          <HgabDetails>
            <p>
              <strong>How we checked PBC’s figures.</strong> For {MATCHED.length} lines, PBC’s 2027 NEP, House bill and
              change figures are the exact amounts below, rounded to ₱0.1 billion:{' '}
              {MATCHED.length - DPWH_LINES.length} from the line-by-line explorer and the {DPWH_LINES.length} DPWH lines
              from our DPWH project pages, by program. For {CHANGE_ONLY.map((l) => l.short).join(' and ')} only the change
              matches, for the reasons in the notes; confidential funds are PBC’s own count. The 2026 figures are PBC’s.
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
                  {RED_FLAG_LINES.map((l) => {
                    const x = exactOf(l);
                    if (!x) return null;
                    return (
                      <tr key={l.key}>
                        <td><Link to={billHref(l)!}>{l.short}</Link></td>
                        <td className="num">{peso(x.nep)}</td>
                        <td className="num">{peso(x.house)}</td>
                        <td>{l.bill.kind === 'change' ? 'The change' : 'All three figures'}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td><Link to={UNPROGRAMMED_HREF}>{U.short}</Link></td>
                    <td className="num">{peso(U.exact)}</td>
                    <td className="num">{peso(U.exact)}</td>
                    <td>All three figures</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <strong>DPWH.</strong> PBC’s {DPWH_LINES.length} DPWH lines are DPWH’s programs. Our DPWH project pages list
              each project’s program, and the {DPWH_LINES.length} add up to every DPWH project: {peso(DPWH_PROJECTS.nep)} in
              the NEP and {peso(DPWH_PROJECTS.house)} in the House bill. PBC’s {LOCAL.short} also counts the one National
              Building Program project.
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
