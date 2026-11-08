import { Link } from 'react-router-dom';
import { SectionHead } from '../components/shared';
import SiteFooter from '../components/SiteFooter';
import { CLAUDE_MODELS, GPT_MODELS } from '../lib/site-legal';

export default function Methodology() {
  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="masthead-top">
            <span className="masthead-meta-l">
              <Link to="/gaa" style={{ textDecoration: 'none' }}>← PHILIPPINES GAA</Link>
              {' · '}METHODOLOGY
            </span>
          </div>
          <h1 className="masthead-title">Methodology &amp; data quality</h1>
        </div>
      </header>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 32px 80px', fontSize: 14.5, lineHeight: 1.7 }}>
        <SectionHead
          eyebrow="What this portal is"
          headline="Philippine GAA records, 2000–2026"
          dek="The archive covers FY 2000–2026 with different levels of detail and coverage. The detailed department portal covers FY 2020–2026. The GAA is the budget law passed by Congress — the legal authority to spend, not actual obligations or disbursements."
        />

        <h3 style={hStyle}>Historical coverage · 2000–2019</h3>
        <p style={pStyle}>The archive preserves the published agency, fund, program, object, or line-item detail available for each year. Early years have partial coverage; missing dimensions remain missing. Historical department codes and classifications have not been crosswalked to the modern hierarchy. Recorded scope amounts must not be treated as a comparable 27-year national budget series.</p>
        <p style={pStyle}>FY 2001, 2004, and 2006 reenact the preceding budget. Their empty fact files mean no new GAA records, not zero budget or spending. Unprogrammed appropriations are conditional and displayed separately. FY 2003 first- and second-preference schedules are kept in distinct scopes.</p>
        <p style={pStyle}>FY 2019 published editions differ: the selected DPWH technical tables total ₱454,016,273,000; the Volume I summary reports ₱549,390,514,000. The archive retains the selected technical figures and records the discrepancy without assigning its cause. Each year page provides coverage notes; individual records retain source references and quality flags, including OCR review flags where applicable.</p>
        <p style={pStyle}>Download each year's dataset from its year page, or the full 2000–2026 dataset from the <Link to="/gaa">GAA overview</Link> (Parquet files: open them with DuckDB, pandas or polars). The normalized <code>amount</code> column is already in full PHP; do not multiply it by 1,000 again. Group summaries are computed from the selected source baseline, separated by appropriation scope.</p>
        <h3 style={hStyle}>Detailed portal coverage · 2020–2026</h3>
        <p style={pStyle}>
          Source data is published by the Department of Budget and Management. We track 40 numbered departments
          (codes 01–40), including five pseudo-departments that aggregate non-line-item appropriations:
          Automatic Appropriations (04), Budgetary Support to GOCCs (26), Allocation to LGUs (28), Unprogrammed
          Appropriations (35), and Other Executive Offices (36).
        </p>

        <h3 style={hStyle}>Units</h3>
        <p style={pStyle}>
          The legacy detailed portal source data is in <strong>thousands of pesos</strong>. Its loader multiplies by 1,000 so every
          number on this site is in <strong>full pesos</strong>. The formatter renders ₱T / ₱B / ₱M / ₱K for
          legibility — “₱6.79T” means 6.79 trillion pesos.
        </p>

        <h3 style={hStyle}>Hierarchy</h3>
        <p style={pStyle}>
          The 2020–2026 detailed portal organizes appropriations in a 7-level UACS tree: Department → Agency → Program (FPAP) →
          Operating Unit → Fund → Expense Class → Object. The first six levels are stable enough to compare
          across years. The seventh — <strong>Object</strong> — was re-coded by DBM between 2025 and 2026;
          identical line items appear under different sub-object codes in the two years.{' '}
          <strong>Object-level YoY comparisons are unreliable</strong> without a hand-curated mapping.
        </p>

        <h3 style={hStyle}>Program renames</h3>
        <p style={pStyle}>
          Programs are renamed and restructured almost every fiscal year. Two examples:
        </p>
        <ul style={pStyle}>
          <li>The <em>Internal Revenue Allotment</em> (IRA) was renamed <em>National Tax Allotment</em> (NTA) in 2022.</li>
          <li>The Department of Public Works &amp; Highways flood-control portfolio shows roughly 1,446 FPAP renames over the period.</li>
        </ul>
        <p style={pStyle}>
          Per-department Portals merge programs by normalised name within bureau, producing a continuous
          series wherever rename was clean. Renames that also moved between bureaus, or split a program in two,
          remain split.
        </p>

        <h3 style={hStyle}>Items outside the GAA</h3>
        <p style={pStyle}>
          Some agencies are self-funded and do not appear in the GAA line items:
          PhilHealth, the Procurement Service of DBM (PS-DBM), the SEC, NEA, and TPB/TIEZA. Comparing
          their activity to GAA-funded peers requires separate financial statements.
        </p>

        <h3 style={hStyle}>Known data-quality flags</h3>
        <ul style={pStyle}>
          <li>~36 line items have department mislabels carried over from source.</li>
          <li>~25 line items report zero amount across all years and are excluded from totals.</li>
          <li>DAR (Department of Agrarian Reform) line items appear under Automatic Appropriations (04) due to source classification.</li>
        </ul>

        <h3 style={hStyle}>AI-assisted compilation</h3>
        <p style={pStyle}>
          Aggregation, schema parsing, and editorial commentary were produced with help from Claude (Anthropic) — {CLAUDE_MODELS} — and{' '}
          {GPT_MODELS} (OpenAI), under human review. Always verify against the official GAA before citing.
        </p>

        <p className="note-block" style={{ marginTop: 32 }}>
          Return to the <Link to="/gaa">national overview</Link>.
        </p>
      </main>

      <SiteFooter source="SOURCE: DBM GAA ARCHIVE · FY 2000–2026 · COVERAGE VARIES BY YEAR" />
    </>
  );
}

const hStyle: React.CSSProperties = { fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 };
const pStyle: React.CSSProperties = { color: 'var(--ink-2)' };
