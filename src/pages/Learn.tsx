/**
 * `/learn` — how to read the Philippine national budget.
 *
 * A citizen-facing explainer: the four-phase budget cycle, how an
 * appropriation becomes cash out the door, and a glossary of the terms the
 * budget documents assume you already know. Definitions are grounded in the
 * DBM's official BESF Glossary of Terms and the 1987 Constitution, rewritten
 * in plain language; the sources are linked at the bottom.
 *
 * Glossary entries carry optional `see` links into this site, so a term is
 * one click from the real numbers that illustrate it.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import SiteHeader from '../components/SiteHeader';
import '../nep2027.css';
import '../learn.css';

/* ---------------------------------------------------------------- glossary */

type Cat = 'documents' | 'appropriations' | 'classes' | 'release' | 'structure';

const CATS: Record<Cat, string> = {
  documents: 'Documents & process',
  appropriations: 'Kinds of appropriations',
  classes: 'Expense classes',
  release: 'How money moves',
  structure: 'Codes & structure',
};

interface Term {
  term: string;
  aka?: string;
  cat: Cat;
  def: string;
  detail?: string;
  see?: { to: string; label: string };
}

const TERMS: Term[] = [
  // ---- documents & process ----
  {
    term: 'National Expenditure Program',
    aka: 'NEP · the President’s Budget',
    cat: 'documents',
    def: 'The Executive’s detailed spending proposal, submitted to Congress within 30 days of the State of the Nation Address. It is the basis of the General Appropriations Bill — a proposal, not yet a law.',
    detail: 'Congress deliberates the NEP, may realign but not increase the total the President recommends, and enacts it as the GAA.',
    see: { to: '/2027/overview', label: 'Read the FY 2027 NEP' },
  },
  {
    term: 'General Appropriations Act',
    aka: 'GAA',
    cat: 'documents',
    def: 'The law appropriating funds for government agencies for one budget year — the NEP after Congress has deliberated, amended, and passed it, and the President has signed it.',
    see: { to: '/gaa', label: 'Browse the GAA, FY 2020–2026' },
  },
  {
    term: 'General Appropriations Bill',
    aka: 'GAB',
    cat: 'documents',
    def: 'The NEP in bill form as it moves through the House, then the Senate, then a bicameral conference committee that reconciles the two versions. It becomes the GAA when signed.',
  },
  {
    term: 'Budget Call',
    cat: 'documents',
    def: 'The DBM memorandum that starts each cycle: it sets the macroeconomic assumptions, budget priorities, ceilings, forms, and calendar every agency must follow in preparing its proposal.',
  },
  {
    term: 'Budget of Expenditures and Sources of Financing',
    aka: 'BESF',
    cat: 'documents',
    def: 'The companion document to the NEP, constitutionally required, showing where the money will come from — taxes, other revenues, and borrowings — alongside what will be spent.',
  },
  {
    term: 'Bicameral Conference Committee',
    aka: 'bicam',
    cat: 'documents',
    def: 'The panel of House and Senate members that reconciles the two chambers’ versions of the budget bill. Its report is voted on without amendment, which is why late changes here draw scrutiny.',
  },
  {
    term: 'Reenacted budget',
    cat: 'documents',
    def: 'If Congress fails to pass the GAA before the fiscal year starts, last year’s GAA stays in force until the new one is enacted — the Constitution’s failsafe against a shutdown, at the cost of funding new programs late.',
  },
  {
    term: 'Line-item veto',
    cat: 'documents',
    def: 'The President may veto individual items in an appropriations bill while signing the rest into law — a power that exists for the budget but not for ordinary legislation.',
  },
  {
    term: 'Supplemental appropriations',
    cat: 'documents',
    def: 'An additional appropriations law passed mid-year when the enacted budget proves insufficient. It must be supported by new revenue sources if it creates new offices or programs.',
  },
  // ---- kinds of appropriations ----
  {
    term: 'Appropriation',
    cat: 'appropriations',
    def: 'An authorization by law to spend public funds — up to a set amount, for a stated purpose, under stated conditions. No money leaves the Treasury without one; that rule is in the Constitution.',
  },
  {
    term: 'New General Appropriations',
    cat: 'appropriations',
    def: 'The part of the budget Congress actually votes on each year: the agency budgets and special purpose funds written into the annual GAA.',
  },
  {
    term: 'Automatic appropriations',
    cat: 'appropriations',
    def: 'Spending authorized once by a standing law and released every year without passing through the annual budget debate. Congress does not vote on these amounts each year — they are set aside automatically.',
    detail:
      'The biggest pieces: interest on the national debt (automatic since the 1977 Budget Reform Decree, carried into the Administrative Code), the National Tax Allotment for local governments, retirement and life insurance premiums for government employees (RLIP), net lending to government corporations, and tax expenditure subsidies. In the FY 2027 NEP these total ₱2.58 trillion — about 36% of the whole budget — before deliberation touches a single line.',
    see: { to: '/2027/d/AUTO', label: 'See the FY 2027 automatic appropriations' },
  },
  {
    term: 'Special Purpose Funds',
    aka: 'SPFs',
    cat: 'appropriations',
    def: 'Lump sums in the GAA for purposes whose final recipients aren’t known at budget time — released to agencies during the year as the need is established.',
    detail: 'Examples: the National Disaster Risk Reduction and Management (Calamity) Fund, the Contingent Fund, the Pension and Gratuity Fund, and the Miscellaneous Personnel Benefits Fund.',
    see: { to: '/2027/d/SPF', label: 'See the FY 2027 special purpose funds' },
  },
  {
    term: 'Unprogrammed appropriations',
    cat: 'appropriations',
    def: 'Standby authority at the back of the GAA: it can only be spent if extra money actually shows up — revenue collections above target, new revenue sources, or approved project loans.',
    detail: 'Because it depends on windfalls, moving big-ticket items into unprogrammed appropriations effectively makes their funding conditional.',
  },
  {
    term: 'Continuing appropriations',
    cat: 'appropriations',
    def: 'Appropriations that remain available beyond the year they were enacted for, under the rules of the annual GAA — as opposed to annual appropriations, which lapse.',
  },
  {
    term: 'National Tax Allotment',
    aka: 'NTA · formerly IRA',
    cat: 'appropriations',
    def: 'Local governments’ automatic share of national taxes: 40% of collections from the third preceding year, divided among provinces, cities, municipalities, and barangays by population, land area, and equal sharing.',
    detail: 'Renamed from the Internal Revenue Allotment after the Supreme Court’s Mandanas-Garcia ruling widened the base from internal revenue taxes to all national taxes, including customs collections.',
  },
  {
    term: 'Retirement and Life Insurance Premiums',
    aka: 'RLIP',
    cat: 'appropriations',
    def: 'The national government’s share of premium payments to GSIS for government employees’ life insurance and retirement benefits — released automatically, agency by agency.',
  },
  {
    term: 'Net lending',
    cat: 'appropriations',
    def: 'Advances by the national government to service the guaranteed debt of government corporations, and loans relent to them — automatically appropriated.',
  },
  {
    term: 'Debt service',
    cat: 'appropriations',
    def: 'Payments on the national debt. Interest payments are automatically appropriated and appear in the expenditure program; principal amortization is settled as financing, outside the program — so the budget’s “debt service” figure usually means interest only.',
  },
  {
    term: 'Budgetary Support to Government Corporations',
    aka: 'BSGC',
    cat: 'appropriations',
    def: 'National government assistance to GOCCs — equity, subsidies, or net lending — so corporations like PhilHealth or the National Food Authority can carry out public mandates their own revenues don’t cover.',
    see: { to: '/2027/d/35', label: 'See BSGC in the FY 2027 NEP' },
  },
  {
    term: 'Allocations to Local Government Units',
    aka: 'ALGU',
    cat: 'appropriations',
    def: 'The umbrella for national government transfers to LGUs: the automatic NTA plus GAA-appropriated items like the Local Government Support Fund, special shares in national taxes, and the Metropolitan Manila Development Authority.',
  },
  // ---- expense classes ----
  {
    term: 'Personnel Services',
    aka: 'PS',
    cat: 'classes',
    def: 'Pay for people: salaries and wages, allowances like PERA, bonuses, honoraria, and other compensation for permanent, temporary, contractual, and casual government employees.',
  },
  {
    term: 'Maintenance and Other Operating Expenses',
    aka: 'MOOE',
    cat: 'classes',
    def: 'The cost of keeping government running day to day: supplies and materials, travel, utilities like water and power, repairs, and services contracted out — everything operational that isn’t pay or capital.',
  },
  {
    term: 'Capital Outlays',
    aka: 'CO',
    cat: 'classes',
    def: 'Spending on things that last beyond the year and add to government assets: roads, buildings, equipment, and investments in the capital stock of government corporations.',
  },
  {
    term: 'Financial Expenses',
    aka: 'FinEx',
    cat: 'classes',
    def: 'Interest, guarantee and management fees, bank charges, and similar costs of owning or borrowing — in the national budget, dominated by interest on the public debt.',
  },
  // ---- how money moves ----
  {
    term: 'Allotment',
    cat: 'release',
    def: 'The share of an appropriation an agency is actually authorized to commit. An appropriation is permission on paper; the allotment is the spending limit released against it.',
  },
  {
    term: 'Obligation',
    cat: 'release',
    def: 'A binding commitment — a signed contract, a purchase order, a payroll — that ties the government to pay. Agencies may only obligate within their released allotments.',
  },
  {
    term: 'Disbursement',
    cat: 'release',
    def: 'The actual payment: cash (or its non-cash equivalent) leaving the government to settle an obligation. This is the step where the budget finally becomes money spent.',
  },
  {
    term: 'GAA as the Allotment Order',
    aka: 'GAARD / GAAAO',
    cat: 'release',
    def: 'For most items, the GAA itself now serves as the release document — agency budgets are considered released the moment the law takes effect, instead of waiting for individual paperwork.',
  },
  {
    term: 'Special Allotment Release Order',
    aka: 'SARO',
    cat: 'release',
    def: 'The DBM document releasing allotment for items that still need one — spending whose release is conditioned on laws, clearances, or documentary requirements, including most special purpose funds.',
  },
  {
    term: 'Notice of Cash Allocation',
    aka: 'NCA',
    cat: 'release',
    def: 'The DBM’s authority for actual cash: it tells the servicing banks how much an agency may draw to pay the obligations it has incurred. No NCA, no checks.',
  },
  {
    term: 'Cash Budgeting System',
    cat: 'release',
    def: 'The rule, in force since 2019, that appropriations are available for obligation only within the fiscal year (with a limited payment period after) — pushing agencies to implement within the year they are funded.',
  },
  // ---- codes & structure ----
  {
    term: 'Unified Accounts Code Structure',
    aka: 'UACS',
    cat: 'structure',
    def: 'The government-wide coding system — built jointly by DBM, COA, DOF, and the Treasury — that gives every funding source, agency, program, and expense object a consistent code, so budget, spending, and audit reports can be matched.',
    see: { to: '/2027/methodology', label: 'How this site uses UACS codes' },
  },
  {
    term: 'Program / Activity / Project',
    aka: 'P/A/P',
    cat: 'structure',
    def: 'The budget’s working unit: any work process an agency undertakes to deliver outputs, represented as an item of appropriation. Programs group activities and projects toward one outcome.',
  },
  {
    term: 'Program Expenditure Classification',
    aka: 'PREXC',
    cat: 'structure',
    def: 'The way agency budgets are structured into a hierarchy — organizational outcomes, programs, sub-programs, activities, and projects — so spending can be read against what it is supposed to achieve.',
  },
  {
    term: 'GAS · STO · Operations',
    cat: 'structure',
    def: 'Every agency budget splits into three cost components: General Administration and Support (overhead), Support to Operations (staff and technical support), and Operations (the direct delivery of the agency’s mandate).',
  },
  {
    term: 'Operating Unit',
    cat: 'structure',
    def: 'The organizational unit that actually implements — a regional office, a schools division, a hospital. Budgets are released down to this level.',
  },
  {
    term: 'Object of expenditure',
    cat: 'structure',
    def: 'The finest-grained classification under an expense class: “Salaries and Wages – Regular”, “Electricity Expenses”, “Buildings”. On this site, a line item is one object code in one fund in one operating unit.',
    see: { to: '/2027/search', label: 'Search line items by object' },
  },
  {
    term: 'Special Account in the General Fund',
    aka: 'SAGF',
    cat: 'structure',
    def: 'An earmark inside the General Fund: proceeds of a specific revenue measure recorded separately and reserved by law for a specific purpose — like the Malampaya fund for energy.',
  },
  {
    term: 'Off-budget funds',
    aka: 'retained income · revolving funds',
    cat: 'structure',
    def: 'Money agencies are allowed by law to keep and spend outside the annual appropriations — retained hospital income, business-type receipts, trust funds. It is public money, but you will not find it in the GAA’s totals.',
  },
];

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
      'Agencies report what they spent and delivered; the Commission on Audit examines whether funds were used legally and well; performance reviews feed the next Budget Call. Audit findings are public documents.',
    out: 'Output: audit reports, performance reviews',
  },
];

export default function Learn() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Cat | 'all'>('all');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return TERMS.filter(
      (t) =>
        (cat === 'all' || t.cat === cat) &&
        (!needle ||
          t.term.toLowerCase().includes(needle) ||
          (t.aka ?? '').toLowerCase().includes(needle) ||
          t.def.toLowerCase().includes(needle) ||
          (t.detail ?? '').toLowerCase().includes(needle)),
    );
  }, [q, cat]);

  return (
    <>
      <SiteHeader headerClassName="masthead-hero-blend" crumb="Learn" />

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

        {/* ---- glossary ---- */}
        <section className="nep-section" id="glossary">
          <p className="learn-eyebrow">Glossary</p>
          <h2 className="learn-h">The words the budget assumes you know.</h2>
          <div className="learn-gl-controls">
            <input
              className="text-input learn-gl-search"
              type="search"
              placeholder="Search terms — try “MOOE”, “SARO”, “automatic”…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="learn-gl-cats" role="tablist" aria-label="Glossary categories">
              <button
                type="button"
                className={cat === 'all' ? 'is-active' : ''}
                onClick={() => setCat('all')}
              >
                All ({TERMS.length})
              </button>
              {(Object.keys(CATS) as Cat[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cat === c ? 'is-active' : ''}
                  onClick={() => setCat(c)}
                >
                  {CATS[c]}
                </button>
              ))}
            </div>
          </div>

          <div className="learn-gl-list">
            {shown.map((t) => (
              <article className="learn-term" key={t.term} id={t.term.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}>
                <h3>
                  {t.term}
                  {t.aka && <span className="learn-term-aka">{t.aka}</span>}
                </h3>
                <p>{t.def}</p>
                {t.detail && <p className="learn-term-detail">{t.detail}</p>}
                {t.see && (
                  <Link className="learn-term-see" to={t.see.to}>
                    {t.see.label} →
                  </Link>
                )}
              </article>
            ))}
            {!shown.length && (
              <p className="nep-empty">No term matches “{q}”. Try a shorter word, or clear the category filter.</p>
            )}
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
          </ol>
        </section>

        {/* ---- sources ---- */}
        <section className="nep-section" id="sources">
          <p className="learn-eyebrow">Sources & further reading</p>
          <ul className="learn-sources">
            <li>
              <a href="https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2025/GLOSSARY.pdf" target="_blank" rel="noopener">
                DBM · BESF Glossary of Terms ↗
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
