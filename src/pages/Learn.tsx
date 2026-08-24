/**
 * `/learn` — how to read the Philippine national budget.
 *
 * A citizen-facing explainer: the four-phase budget cycle, how an
 * appropriation becomes cash out the door, where the fine print lives, and
 * why watching matters. Grounded in the DBM's official documents and the
 * 1987 Constitution; the sources are linked at the bottom. The companion
 * glossary lives on its own page at /glossary.
 */
import { Link } from 'react-router-dom';
import LearnHeader from '../components/LearnHeader';
import SiteFooter from '../components/SiteFooter';
import { TERMS } from '../lib/glossary-terms';
import '../nep2027.css';
import '../learn.css';


/* ------------------------------------------------------------------- page */

const PHASES = [
  {
    n: '01',
    name: 'Preparation',
    who: 'Executive · DBM and every agency',
    what:
      'The DBM issues the Budget Call; agencies build proposals against ceilings; the DBM holds hearings, and the President approves the total. The output is the NEP and its companion BESF, due to Congress within 30 days of the SONA.',
    out: 'Output: the NEP — the President’s Budget',
  },
  {
    n: '02',
    name: 'Legislation',
    who: 'Congress · House, then Senate, then bicam',
    what:
      'The House deliberates first, then the Senate; a bicameral conference reconciles the two versions. Congress may realign but may not increase the total the President recommended. The President signs — with line-item vetoes if needed.',
    out: 'Output: the GAA — the budget as law',
  },
  {
    n: '03',
    name: 'Execution',
    who: 'Executive · DBM, agencies, the Treasury',
    what:
      'Allotments authorize agencies to commit; obligations bind the government; Notices of Cash Allocation let agencies actually pay. Most agency budgets are deemed released the day the GAA takes effect.',
    out: 'Output: programs delivered, money disbursed',
  },
  {
    n: '04',
    name: 'Accountability',
    who: 'COA, DBM, Congress, citizens',
    what:
      'Not a final step but a year-round one: agencies file accountability reports monthly and quarterly while the money is being spent, and the Commission on Audit examines whether funds were used legally and well after the year closes. Performance reviews feed the next Budget Call, and audit findings are public documents.',
    out: 'Output: audit reports, performance reviews',
  },
];

/* -------------------------------------------------------------- visuals */

/** Phase palette — categorical, validated (six checks incl. CVD) against
    paper white: green / Republic Blue / gold / purple in phase order. The
    tritan-floor pair is covered by direct labels and 2px surface gaps. */
const PHASE_COLOR = {
  prep: '#2f8a4c',
  legis: '#0b4fd9',
  exec: '#b8893a',
  acct: '#7a3fd2',
} as const;

const PHASE_NAME = {
  prep: 'Preparation',
  legis: 'Legislation',
  exec: 'Execution',
  acct: 'Accountability',
} as const;

/**
 * Three budgets in motion: 24 months (Jan 2026 – Dec 2027), one lane per
 * fiscal year's budget, segments per phase. Every segment is direct-labeled
 * where it fits, and carries a native <title> for hover/AT.
 */
function CycleTimeline() {
  const W = 960;
  const LANE_H = 44;
  const STRIP_H = 8;
  const GAP = 14;
  const LEFT = 118;
  const TOP = 34;
  const monthW = (W - LEFT - 8) / 24;
  const x = (m: number) => LEFT + m * monthW; // m = months since Jan 2026

  interface Seg { lane: number; from: number; to: number; phase: keyof typeof PHASE_COLOR; strip?: boolean }
  const lanes = ['FY 2026 budget', 'FY 2027 budget', 'FY 2028 budget'];
  /* Accountability is not a sequel to execution: in-year reports run monthly
     and quarterly WHILE the money is being spent (thin strip), and the COA
     audit follows after the year closes (full bar). */
  const segs: Seg[] = [
    { lane: 0, from: 0, to: 12, phase: 'exec' },
    { lane: 0, from: 0, to: 12, phase: 'acct', strip: true },
    { lane: 0, from: 12, to: 21, phase: 'acct' },
    { lane: 1, from: 0, to: 7, phase: 'prep' },
    { lane: 1, from: 7, to: 12, phase: 'legis' },
    { lane: 1, from: 12, to: 24, phase: 'exec' },
    { lane: 1, from: 12, to: 24, phase: 'acct', strip: true },
    { lane: 2, from: 12, to: 19, phase: 'prep' },
    { lane: 2, from: 19, to: 24, phase: 'legis' },
  ];
  const H = TOP + lanes.length * (LANE_H + GAP) + 30;
  const today = x(7.7); // ~late Aug 2026 on this Jan-2026-based window

  return (
    <figure className="learn-viz">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Timeline of 24 months showing three fiscal-year budgets in different phases at once: the FY 2026 budget is executed through 2026 with accountability reporting running concurrently all year and the audit continuing into 2027; the FY 2027 budget moves from preparation to legislation to execution; and the FY 2028 budget begins preparation. Accountability is not a final step — in-year reports are filed monthly and quarterly while the money is being spent."
      >
        {/* year gridlines + labels */}
        {[0, 12, 24].map((m) => (
          <line key={m} x1={x(m)} y1={TOP - 16} x2={x(m)} y2={H - 24} className="lv-grid" />
        ))}
        <text x={x(0) + 4} y={TOP - 20} className="lv-axis">2026</text>
        <text x={x(12) + 4} y={TOP - 20} className="lv-axis">2027</text>

        {/* lanes */}
        {lanes.map((name, i) => (
          <text key={name} x={LEFT - 10} y={TOP + i * (LANE_H + GAP) + LANE_H / 2 + 4} className="lv-lane" textAnchor="end">
            {name}
          </text>
        ))}

        {/* segments: 2px surface gaps via x+1/width-2, 4px rounded ends.
            Main bars use the top band; concurrent-accountability strips the
            thin bottom band, 2px below. */}
        {segs.map((sg, i) => {
          const y = TOP + sg.lane * (LANE_H + GAP);
          const w = x(sg.to) - x(sg.from);
          const label = sg.strip ? 'Accountability — in-year reports, monthly & quarterly' : PHASE_NAME[sg.phase];
          const barH = LANE_H - STRIP_H - 2;
          const showLabel = !sg.strip && w > 86;
          return (
            <g key={i}>
              <rect
                x={x(sg.from) + 1}
                y={sg.strip ? y + barH + 2 : y}
                width={w - 2}
                height={sg.strip ? STRIP_H : barH}
                rx={sg.strip ? 2 : 4}
                fill={PHASE_COLOR[sg.phase]}
                opacity={0.92}
              >
                <title>{`${lanes[sg.lane]} — ${label}`}</title>
              </rect>
              {showLabel && (
                <text x={x(sg.from) + w / 2} y={y + barH / 2 + 4} className="lv-seg" textAnchor="middle">
                  {PHASE_NAME[sg.phase]}
                </text>
              )}
            </g>
          );
        })}

        {/* today marker */}
        <line x1={today} y1={TOP - 12} x2={today} y2={H - 26} className="lv-today" />
        <text x={today} y={H - 10} className="lv-today-label" textAnchor="middle">Aug 2026 — you are here</text>
      </svg>
      <figcaption className="learn-viz-legend" aria-hidden="true">
        {(Object.keys(PHASE_NAME) as Array<keyof typeof PHASE_NAME>).map((k) => (
          <span key={k}>
            <i style={{ background: PHASE_COLOR[k] }} /> {PHASE_NAME[k]}
          </span>
        ))}
        <span className="lv-legend-note">
          The thin purple strip: accountability runs <em>during</em> execution — agencies report
          monthly and quarterly while spending — and the COA audit continues after the year closes.
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * The document flow, NEP to GAA, with the two things this page most wants a
 * citizen to notice pinned onto it: where the public can watch, and where the
 * fine print lives.
 */
function DocumentFlow() {
  const W = 960;
  const H = 210;
  const nodes = [
    { x: 8, w: 118, title: 'Budget Call', sub: 'DBM starts the cycle' },
    { x: 152, w: 128, title: 'NEP + BESF', sub: 'the President’s Budget' },
    { x: 306, w: 108, title: 'House', sub: 'public hearings' },
    { x: 440, w: 108, title: 'Senate', sub: 'public hearings' },
    { x: 574, w: 108, title: 'Bicam', sub: 'versions reconciled' },
    { x: 708, w: 116, title: 'President', sub: 'signs · item veto' },
    { x: 850, w: 102, title: 'GAA', sub: 'the budget as law' },
  ];
  const Y = 64;
  const NH = 64;
  return (
    <figure className="learn-viz">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Flow of the budget documents: the Budget Call leads to the NEP and BESF, through public hearings in the House and Senate, a bicameral conference, and the President's signature with possible item vetoes, becoming the GAA. Public checkpoints: hearings are public during legislation, and both the NEP and GAA are published as PDF volumes whose special and general provisions carry the fine print."
      >
        <defs>
          <marker id="lv-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--ink-3)" />
          </marker>
        </defs>
        {nodes.slice(0, -1).map((n, i) => (
          <line
            key={i}
            x1={n.x + n.w}
            y1={Y + NH / 2}
            x2={nodes[i + 1].x - 3}
            y2={Y + NH / 2}
            className="lv-flow-arrow"
            markerEnd="url(#lv-arrow)"
          />
        ))}
        {nodes.map((n) => {
          const isDoc = n.title === 'NEP + BESF' || n.title === 'GAA';
          return (
            <g key={n.title}>
              <rect x={n.x} y={Y} width={n.w} height={NH} rx={4} className={isDoc ? 'lv-node lv-node-doc' : 'lv-node'} />
              <text x={n.x + n.w / 2} y={Y + 27} className={isDoc ? 'lv-node-title lv-on-accent' : 'lv-node-title'} textAnchor="middle">{n.title}</text>
              <text x={n.x + n.w / 2} y={Y + 45} className={isDoc ? 'lv-node-sub lv-on-accent' : 'lv-node-sub'} textAnchor="middle">{n.sub}</text>
            </g>
          );
        })}
        {/* pins */}
        <g className="lv-pin">
          <line x1={441} y1={Y - 8} x2={441} y2={Y - 26} />
          <text x={441} y={Y - 32} textAnchor="middle">Hearings are public — watch, attend, submit positions</text>
        </g>
        <g className="lv-pin lv-pin-doc">
          <line x1={216} y1={Y + NH + 8} x2={216} y2={Y + NH + 26} />
          <line x1={901} y1={Y + NH + 8} x2={901} y2={Y + NH + 26} />
          <line x1={216} y1={Y + NH + 26} x2={901} y2={Y + NH + 26} />
          <text x={(216 + 901) / 2} y={Y + NH + 44} textAnchor="middle">Published as PDF volumes — the special & general provisions live here, not in any spreadsheet</text>
        </g>
      </svg>
    </figure>
  );
}

export default function Learn() {
  return (
    <>
      <LearnHeader crumb="Learn" />

      <section className="nep-dept-hero">
        <div className="nep-dept-hero-inner">
          <p className="nep-dept-hero-eyebrow">Learn · A citizen’s guide</p>
          <h1 className="nep-dept-hero-title">How to read the national budget</h1>
          <p className="nep-dept-hero-dek">
            The budget cycle in four phases, how an appropriation becomes money spent, and the
            terms the documents assume you already know — in plain language, grounded in the
            DBM’s own definitions.
          </p>
        </div>
      </section>

      <main className="nep-main learn">
        {/* ---- the cycle ---- */}
        <section className="nep-section" id="cycle">
          <p className="learn-eyebrow">The budget cycle</p>
          <h2 className="learn-h">One budget takes about two years — and three are always in motion.</h2>
          <p className="learn-lede">
            While agencies execute this year’s GAA, the next year’s budget is being written, and
            last year’s is being audited. Every phase below is happening right now for a different
            fiscal year. The FY 2027 NEP on this site is in phase 02: submitted to Congress in
            August 2026, under deliberation.
          </p>
          <CycleTimeline />
          <div className="learn-phases">
            {PHASES.map((p) => (
              <div className="learn-phase" key={p.n}>
                <span className="learn-phase-n">{p.n}</span>
                <h3>{p.name}</h3>
                <p className="learn-phase-who">{p.who}</p>
                <p className="learn-phase-what">{p.what}</p>
                <p className="learn-phase-out">{p.out}</p>
              </div>
            ))}
          </div>
          <div className="learn-facts">
            <div>
              <strong>30 days</strong>
              <span>after the SONA opens Congress — the constitutional deadline for the President to submit the budget</span>
            </div>
            <div>
              <strong>No increase</strong>
              <span>Congress may realign the budget but may not raise the total the President recommended</span>
            </div>
            <div>
              <strong>Reenaction</strong>
              <span>if the GAA isn’t passed in time, last year’s budget stays in force — the constitutional failsafe</span>
            </div>
            <div>
              <strong>Item veto</strong>
              <span>the President can strike individual items while signing the rest of the GAA into law</span>
            </div>
          </div>
          <DocumentFlow />
        </section>

        {/* ---- money flow ---- */}
        <section className="nep-section" id="flow">
          <p className="learn-eyebrow">From law to cash</p>
          <h2 className="learn-h">An appropriation is not money — it becomes money in four steps.</h2>
          <div className="learn-flow">
            <div>
              <em>1 · Appropriation</em>
              <p>Congress authorizes spending — an amount, a purpose, conditions. Nothing can be spent without it.</p>
            </div>
            <div>
              <em>2 · Allotment</em>
              <p>The DBM releases spending authority. Most agency budgets are deemed released when the GAA takes effect; the rest wait for a SARO.</p>
            </div>
            <div>
              <em>3 · Obligation</em>
              <p>The agency signs contracts, issues purchase orders, runs payroll — commitments the government is now bound to pay.</p>
            </div>
            <div>
              <em>4 · Disbursement</em>
              <p>Cash moves. The DBM issues a Notice of Cash Allocation, and the banks pay what the agency owes.</p>
            </div>
          </div>
          <p className="learn-note">
            Every figure on this site is an <strong>appropriation</strong> — step 1. Whether it was
            allotted, obligated, and finally disbursed is a separate question, answered in agency
            reports and COA audits, not in the GAA itself.
          </p>
        </section>

        {/* ---- glossary pointer ---- */}
        <section className="nep-section" id="glossary">
          <p className="learn-eyebrow">Glossary</p>
          <h2 className="learn-h">The words the budget assumes you know.</h2>
          <p className="learn-lede">
            Every term in the DBM’s official BESF Glossary — all {TERMS.length} of them, rewritten
            in plain language — now lives on its own page, searchable and filterable by category:
            documents, appropriations, how money moves, who’s who, taxes, debt, and performance.
          </p>
          <div className="learn-cta-row">
            <Link to="/glossary">Open the glossary →</Link>
          </div>
        </section>

        {/* ---- what the data can't show ---- */}
        <section className="nep-section" id="beyond-the-numbers">
          <p className="learn-eyebrow">Beyond the numbers</p>
          <h2 className="learn-h">The numbers on this site are only half the document.</h2>
          <p className="learn-lede">
            Our line items are parsed from the budget’s structured tables: amounts by department,
            program, fund, and object code. But the NEP and GAA are published as PDF volumes, and
            much of what makes a number mean something lives only in their prose — the{' '}
            <strong>special provisions</strong> beside each appropriation (conditions, earmarks,
            release requirements), the <strong>general provisions</strong> governing all spending,
            and the narratives explaining what a program is for. None of that survives into a
            spreadsheet. Diligent scrutiny means reading both: find the number here, then read the
            fine print in the volumes.
          </p>
          <div className="learn-pdf-cards">
            <a href="https://www.dbm.gov.ph/index.php/budget" target="_blank" rel="noopener">
              <em>PDF · dbm.gov.ph</em>
              <strong>The NEP & GAA volumes ↗</strong>
              <span>The full budget documents, agency by agency, with the special provisions beside each appropriation.</span>
            </a>
            <a href="https://www.dbm.gov.ph/wp-content/uploads/GAA/GAA2026/VolumeIB/GENPRO.pdf" target="_blank" rel="noopener">
              <em>PDF · example</em>
              <strong>FY 2026 General Provisions ↗</strong>
              <span>The rules behind every peso in the FY 2026 GAA — savings, realignment, disclosure, use of funds.</span>
            </a>
            <Link to="/2027/search">
              <em>This site</em>
              <strong>Search the line items →</strong>
              <span>Find the number first — then check its provisions in the volume for that agency.</span>
            </Link>
          </div>
        </section>

        {/* ---- civic participation ---- */}
        <section className="nep-section" id="participate">
          <p className="learn-eyebrow">Why this matters</p>
          <h2 className="learn-h">A budget is only as honest as its audience.</h2>
          <p className="learn-lede">
            Every phase of the cycle has a door built in for the public — and the DBM’s own
            glossary defines citizen participation as citizens becoming partners in formulating,
            monitoring, and evaluating the budget. Scrutiny is not an intrusion into the process;
            it is part of the process. Here is where the doors are:
          </p>
          <div className="learn-participate">
            <div>
              <em style={{ color: PHASE_COLOR.prep }}>During preparation</em>
              <p>
                Agencies consult civil society organizations on their proposals. If you belong to a
                sector an agency serves — health, schools, transport — its budget proposal is your
                business before it is even printed.
              </p>
            </div>
            <div>
              <em style={{ color: PHASE_COLOR.legis }}>During legislation</em>
              <p>
                House and Senate budget hearings are public and livestreamed. Watch your
                department’s hearing, compare what officials claim against the numbers here, and
                pay particular attention to what changes at the bicam — it votes without further
                amendment.
              </p>
            </div>
            <div>
              <em style={{ color: PHASE_COLOR.exec }}>During execution</em>
              <p>
                Agencies must publish budgets, targets, and procurement awards under the
                Transparency Seal, and the executive branch answers Freedom of Information
                requests through eFOI. If a project in the budget isn’t visible on the ground,
                these are the levers.
              </p>
            </div>
            <div>
              <em style={{ color: PHASE_COLOR.acct }}>During accountability</em>
              <p>
                COA’s annual audit reports are public documents, agency by agency — and its
                Citizen Participatory Audit invites civil society into audit teams. An audit
                finding nobody reads changes nothing; a read one has toppled programs.
              </p>
            </div>
          </div>
          <div className="learn-cta-row">
            <a className="story-cta" href="https://www.coa.gov.ph/reports/annual-audit-reports/" target="_blank" rel="noopener">Read a COA audit report ↗</a>
            <a className="story-cta" href="https://www.foi.gov.ph/" target="_blank" rel="noopener">File an eFOI request ↗</a>
            <Link className="story-cta" to="/2027/browse">Scrutinize the FY 2027 proposal →</Link>
          </div>
        </section>

        {/* ---- reading tips ---- */}
        <section className="nep-section" id="tips">
          <p className="learn-eyebrow">Reading the numbers</p>
          <h2 className="learn-h">Five habits that prevent wrong conclusions.</h2>
          <ol className="learn-tips">
            <li>
              <strong>Check which document you’re reading.</strong> The NEP is a proposal; the GAA
              is the law. Comparing an NEP to a GAA compares an ask to an outcome — useful, but not
              like-for-like.
            </li>
            <li>
              <strong>Mind the units.</strong> Official budget tables are published in thousands of
              pesos. This site converts everything to full pesos — but the source documents will not.
            </li>
            <li>
              <strong>Appropriation ≠ spending.</strong> A ₱1B appropriation may end the year
              partly unobligated or undisbursed. For what was actually spent, look to agency
              reports and COA audits.
            </li>
            <li>
              <strong>A “new” program may be a rename.</strong> Program codes and names are
              reshuffled between years; a program that vanished often continues under another name
              or agency. Large swings deserve a second look before they become headlines.
            </li>
            <li>
              <strong>Region tags show who implements, not who benefits.</strong> Money programmed
              through a central office is tagged to the capital even when it is spent nationwide.
            </li>
            <li>
              <strong>Read the provisions, not just the amounts.</strong> The special and general
              provisions in the PDF volumes are law too — they decide what a number may actually be
              spent on, and they are where conditions quietly appear or disappear.
            </li>
          </ol>
        </section>

        {/* ---- sources ---- */}
        <section className="nep-section" id="sources">
          <p className="learn-eyebrow">Sources & further reading</p>
          <ul className="learn-sources">
            <li>
              <a href="https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2026/GLOSSARY.pdf" target="_blank" rel="noopener">
                DBM · BESF 2026 Glossary of Terms ↗
              </a>
              <span>— the official definitions this page’s glossary is grounded in</span>
            </li>
            <li>
              <a href="https://www.dbm.gov.ph/wp-content/uploads/Executive%20Summary/2016/Budget%20Cycle.pdf" target="_blank" rel="noopener">
                DBM · The Budget Cycle ↗
              </a>
              <span>— the four phases, from the department that runs them</span>
            </li>
            <li>
              <a href="https://www.officialgazette.gov.ph/constitutions/1987-constitution/" target="_blank" rel="noopener">
                1987 Constitution, Art. VI §§24–29 & Art. VII §22 ↗
              </a>
              <span>— the appropriation rules: submission deadline, no-increase, reenaction, item veto</span>
            </li>
            <li>
              <a href="https://www.coa.gov.ph/" target="_blank" rel="noopener">
                Commission on Audit ↗
              </a>
              <span>— annual audit reports: what happened after the money was appropriated</span>
            </li>
            <li>
              <a href="https://cpbrd.congress.gov.ph/" target="_blank" rel="noopener">
                Congressional Policy and Budget Research Department ↗
              </a>
              <span>— briefers on each year’s enacted budget</span>
            </li>
          </ul>
          <p className="nep-provenance">
            Definitions paraphrased for plain language from the sources above — for citation, use
            the official documents. Spot an error? The{' '}
            <a href="https://github.com/bettergovph/ai-budget" target="_blank" rel="noopener">source is open</a>.
          </p>
        </section>
      </main>
      <SiteFooter source="A CITIZEN’S GUIDE TO THE PHILIPPINE NATIONAL BUDGET" />
    </>
  );
}
