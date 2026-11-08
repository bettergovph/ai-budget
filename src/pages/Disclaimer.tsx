import { Link } from 'react-router-dom';
import { SectionHead } from '../components/shared';
import SiteFooter from '../components/SiteFooter';
import {
  DEO_RESTRICTIONS_LINK_TEXT, DEO_RESTRICTIONS_PATH, DISCLAIMERS_PATH, DISCLAIMER_NO_ALLEGATIONS, DISCLAIMER_OFFICES,
  type Disclaimer as SectionDisclaimer,
} from '../lib/hgab-disclaimers';
import { ABOUT_URL, CONTACT_EMAIL, ISSUES_URL, LEGAL_EFFECTIVE, TERMS_PAGE } from '../lib/site-legal';

/**
 * /disclaimer — what the site is and is not, for everyone who cites or shares it: the sources,
 * the AI-assisted compilation, what an insertion is and is not, projects and representatives,
 * hearings, posters and letters, and how to report an error. The House bill section's two
 * disclaimers are quoted from src/lib/hgab-disclaimers.ts, so they stay word for word.
 */

/** One of the House bill section's disclaimers, its closing words linked as on the Methodology page. */
function Quoted({ d }: { d: SectionDisclaimer }) {
  const tail = `See the ${DEO_RESTRICTIONS_LINK_TEXT}.`;
  const linked = d.body.endsWith(tail);
  return (
    <p style={quoteStyle}>
      <strong>{d.title}</strong> {linked ? d.body.slice(0, -tail.length) : d.body}
      {linked && <>See the <Link to={DEO_RESTRICTIONS_PATH}>{DEO_RESTRICTIONS_LINK_TEXT}</Link>.</>}
    </p>
  );
}

export default function Disclaimer() {
  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="masthead-top">
            <span className="masthead-meta-l">
              <Link to="/" style={{ textDecoration: 'none' }}>← BETTERGOV BUDGET</Link>
              {' · '}DISCLAIMER
            </span>
          </div>
          <h1 className="masthead-title">Disclaimer</h1>
        </div>
      </header>

      <main style={mainStyle}>
        <SectionHead
          eyebrow="Read this before you cite or share"
          headline="An independent analysis, not an official government record"
          dek="BetterGov Budget is run by BetterGov.ph. It reads the published budget documents and explains them in plain words. It is not a government website, and it does not speak for any agency, Congress or official."
        />

        <h3 style={hStyle}>Where the figures come from</h3>
        <p style={pStyle}>
          The figures come from published documents: the General Appropriations Acts and the National Expenditure
          Program from the Department of Budget and Management, the House budget bill (House Bill No. 10858) and the
          project lists published with it, DPWH’s published contract list, published election results, and the
          People’s Budget Coalition’s FY 2026 tracker. Each page names its sources. Check them before you cite a
          figure. Where our figures differ from an official document, the official document governs.
        </p>
        <p style={pStyle}>The amounts are allocations: what a budget sets aside. They are not what was spent.</p>

        <h3 style={hStyle}>AI-assisted, reviewed by people</h3>
        <p style={pStyle}>
          The figures, breakdowns and commentary were parsed, aggregated and drafted with Claude (Anthropic), under
          human review. They may contain errors, misclassifications or out-of-date figures. Verify them against the
          official documents before you cite them.
        </p>

        <h3 style={hStyle}>No accusations of wrongdoing</h3>
        <p style={pStyle}>
          Nothing on this site accuses any person, office, party, contractor or official of a crime, an irregularity,
          corruption or any other wrongdoing, and nothing on it should be read or shared that way.
        </p>
        <p style={pStyle}>
          An insertion is a project in the House bill with no matching line in the President’s budget, the National
          Expenditure Program (NEP). Insertions are not illegal: Congress may amend the President’s budget. An
          insertion does not mean corruption.
        </p>
        <p style={pStyle}>
          We find insertions, deletions and changed amounts by comparing two published documents. Red flags, rankings,
          totals, and links between budget lines and contracts come from the same kind of reading. Each one is a
          question to ask and a candidate for review, not a finding of wrongdoing by any office or official.
        </p>

        <h3 style={hStyle}>Projects and representatives</h3>
        <p style={pStyle}>
          DPWH projects are assigned to DPWH offices, not to representatives. Where a page shows a representative
          beside an office’s figures, it is because that office serves the representative’s district. The documents
          do not say who asked for any project. Nothing on this site says that a representative requested, sponsored
          or controlled a project.
        </p>

        <h3 style={hStyle}>Our reading, in good faith</h3>
        <p style={pStyle}>
          Headlines, notes and commentary are our reading of public documents, written in good faith and in the public
          interest. They describe what the documents show, not anyone’s intentions or conduct.
        </p>

        <h3 style={hStyle}>The House bill section’s disclaimers, in full</h3>
        <p style={pStyle}>
          They appear word for word across the House bill section, its API and its MCP server, and on the{' '}
          <Link to={DISCLAIMERS_PATH}>House bill methodology page</Link>. Share images carry a shorter form.
        </p>
        <Quoted d={DISCLAIMER_NO_ALLEGATIONS} />
        <Quoted d={DISCLAIMER_OFFICES} />

        <h3 style={hStyle}>Budget hearings</h3>
        <p style={pStyle}>
          Hearing summaries and transcripts are made by machine from the public videos. Names and speakers can be
          wrong. Each moment links to the video, so you can check what was said.
        </p>

        <h3 style={hStyle}>Posters, share images and letters</h3>
        <p style={pStyle}>
          Our posters and share images carry their own disclaimer, date and credit. Share them whole, without cropping
          any of these out. The letters to representatives are templates for you to send in your own name.
          BetterGov.ph does not send them.
        </p>
        <p style={pStyle}>
          Representatives’ photos are from the House of Representatives, in the public domain, via Wikimedia Commons.
        </p>

        <h3 style={hStyle}>Found an error?</h3>
        <p style={pStyle}>
          Tell us.{' '}
          <a href={ISSUES_URL} target="_blank" rel="noopener">Open an issue on GitHub</a> or write to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Include the page, the figure, and what the source
          document says. We review every report in good faith.
        </p>

        <p className="note-block" style={{ marginTop: 32 }}>
          Using the site, its data or its posters? Read the <Link to={TERMS_PAGE}>Terms of Service</Link>. About
          BetterGov.ph: <a href={ABOUT_URL} target="_blank" rel="noopener">about.bettergov.ph</a>. Effective{' '}
          {LEGAL_EFFECTIVE}.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}

const mainStyle: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '32px 32px 80px', fontSize: 14.5, lineHeight: 1.7 };
const hStyle: React.CSSProperties = { fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 };
const pStyle: React.CSSProperties = { color: 'var(--ink-2)' };
const quoteStyle: React.CSSProperties = { color: 'var(--ink-2)', margin: '0 0 12px', paddingLeft: 14, borderLeft: '2px solid var(--rule)' };
