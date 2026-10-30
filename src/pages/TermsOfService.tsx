import { Link } from 'react-router-dom';
import { SectionHead } from '../components/shared';
import SiteFooter from '../components/SiteFooter';
import {
  BETTERGOV_TERMS_URL, CODE_LICENCE, CONTACT_EMAIL, CONTENT_LICENCE, DATA_LICENCE, DISCLAIMER_PAGE, ISSUES_URL,
  LEGAL_EFFECTIVE, type Licence,
} from '../lib/site-legal';

/**
 * /terms-of-service — BetterGov.ph's Terms of Service (bettergov.ph/terms-of-service, effective
 * October 7, 2026), adapted: the same sections and, for the legal clauses (as is, liability, user
 * responsibilities, professional advice, governing law), the same words. Added for this site: what
 * it is, the licences for content and data, sharing posters, the API and MCP server, the letters,
 * and privacy.
 */

const L = ({ l }: { l: Licence }) => <a href={l.url} target="_blank" rel="noopener">{l.name}</a>;

export default function TermsOfService() {
  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="masthead-top">
            <span className="masthead-meta-l">
              <Link to="/" style={{ textDecoration: 'none' }}>← BETTERGOV BUDGET</Link>
              {' · '}TERMS OF SERVICE
            </span>
          </div>
          <h1 className="masthead-title">Terms of Service</h1>
        </div>
      </header>

      <main style={mainStyle}>
        <SectionHead
          eyebrow={`Effective ${LEGAL_EFFECTIVE}`}
          headline="Using and sharing BetterGov Budget, its data and its posters"
          dek="These terms follow BetterGov.ph’s own Terms of Service, adapted to this site."
        />

        <h3 style={hStyle}>Acceptance of terms</h3>
        <p style={pStyle}>
          By accessing and using this website, you accept and agree to be bound by the terms and provisions of this
          agreement. If you do not agree to these terms, please discontinue use of the site.
        </p>

        <h3 style={hStyle}>About this site</h3>
        <p style={pStyle}>
          BetterGov Budget (budget.bettergov.ph) is run by BetterGov.ph. It is not an official government website.
          Nothing on it is an official government record, and it does not speak for any government agency, Congress or
          official. Read the <Link to={DISCLAIMER_PAGE}>Disclaimer</Link> before you cite or share anything from it.
        </p>

        <h3 style={hStyle}>Content and licences</h3>
        <p style={pStyle}>
          Unless otherwise noted, the text, charts, posters and share images BetterGov.ph publishes on this site are
          licensed under <L l={CONTENT_LICENCE} />. The data downloads (CSV and JSON), the API and the MCP server are
          licensed under <L l={DATA_LICENCE} />. The source code is released under the <L l={CODE_LICENCE} />.
        </p>
        <p style={pStyle}>
          Under {CONTENT_LICENCE.name}, you may copy and share the content unchanged, for non-commercial purposes, if
          you give appropriate credit and link to the licence. Sharing an adapted version needs separate permission.
          Under {DATA_LICENCE.name}, you may use and adapt the data for any purpose if you give appropriate credit.
          Credit “BetterGov.PH” and link to the page or dataset you used.
        </p>
        <p style={pStyle}>
          No licence covers the BetterGov.ph name or logo. Government documents we republish remain public records.
          Third-party material, such as the People’s Budget Coalition’s tracker and representatives’ photos, keeps its
          original terms; check them before reuse.
        </p>

        <h3 style={hStyle}>Sharing posters and figures</h3>
        <p style={pStyle}>
          Share posters and share images whole, with their disclaimer, date and credit. Quote a figure with its source
          and date. Do not present anything from this site as an official government record. Do not use it to claim
          that a named person did something wrong: the documents do not say who asked for any project.
        </p>

        <h3 style={hStyle}>The API and the MCP server</h3>
        <p style={pStyle}>
          The API (<a href="/docs">documentation</a>) and the MCP server are free and read-only. Keep the disclaimers
          each House bill result carries, and credit BetterGov.PH. We may limit traffic that disrupts the service. The
          service, its endpoints and its data may change or stop without notice.
        </p>

        <h3 style={hStyle}>Letters to representatives</h3>
        <p style={pStyle}>
          The letters are templates. You decide whether to send one, and you send it in your own name. You are
          responsible for what you send. BetterGov.ph does not send, receive or store letters.
        </p>

        <h3 style={hStyle}>Privacy</h3>
        <p style={pStyle}>
          This site has no accounts, no forms and no cookies of its own, and it runs no tracking scripts. Our host,
          Cloudflare, processes basic request data, such as IP addresses, to deliver and protect the site. Fonts load
          from Google Fonts, and hearing pages play videos through YouTube; each follows its own privacy policy.
        </p>

        <h3 style={hStyle}>“As is” disclaimer</h3>
        <p style={pStyle}>
          All information on this website is provided “as is” without warranty of any kind, either express or implied,
          including but not limited to warranties of merchantability, fitness for a particular purpose, or accuracy and
          completeness of information.
        </p>
        <ul style={pStyle}>
          {[
            'Warranties of merchantability',
            'Fitness for a particular purpose',
            'Non-infringement of intellectual property rights',
            'Accuracy, completeness, or reliability of information',
            'Freedom from errors, viruses, or other harmful components',
          ].map((x) => <li key={x}>{x}</li>)}
        </ul>

        <h3 style={hStyle}>Limitation of liability</h3>
        <p style={pStyle}>
          Under no circumstances shall the website operators, contributors, or affiliated parties be liable for any
          direct, indirect, incidental, special, consequential, or punitive damages arising from your use of this
          website, any errors or omissions in the content, any interruption or cessation of transmission, any bugs or
          harmful components, or loss of data.
        </p>
        <p style={pStyle}>
          This limitation applies regardless of whether such damages arise from contract, tort, negligence, strict
          liability, or any other legal theory.
        </p>

        <h3 style={hStyle}>User responsibilities</h3>
        <p style={pStyle}>
          Users are solely responsible for conducting their own independent verification of all information obtained
          from this website, reviewing original source links provided, and determining the suitability of information
          for their intended use.
        </p>
        <p style={pStyle}>
          We strongly encourage consulting official government websites and agencies for the most current information,
          and verifying dates, figures, and details through multiple reputable sources.
        </p>

        <h3 style={hStyle}>No professional advice</h3>
        <p style={pStyle}>
          Information on this website is not intended as professional advice — legal, medical, financial, or
          otherwise. Users should consult qualified professionals for specific advice related to their situations.
        </p>

        <h3 style={hStyle}>Governing law</h3>
        <p style={pStyle}>
          These terms are governed by the laws of the Republic of the Philippines without regard to conflict of law
          principles. If any provision is found to be unenforceable, the remaining provisions will continue in full
          force and effect.
        </p>

        <h3 style={hStyle}>Corrections, content concerns and takedown requests</h3>
        <p style={pStyle}>
          We work to be accurate, but errors, out-of-date figures or other concerns can arise. To report content you
          believe is wrong, harmful or unlawful,{' '}
          <a href={ISSUES_URL} target="_blank" rel="noopener">open an issue in the site’s GitHub repository</a> or
          write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Include the page’s address, a clear
          description of the concern, and supporting documents where you have them. We will review all legitimate
          concerns in good faith.
        </p>

        <p className="note-block" style={{ marginTop: 32 }}>
          Effective as of {LEGAL_EFFECTIVE}. These terms may be modified at any time without notice; continued use
          constitutes acceptance. They follow{' '}
          <a href={BETTERGOV_TERMS_URL} target="_blank" rel="noopener">BetterGov.ph’s Terms of Service</a>.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}

const mainStyle: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '32px 32px 80px', fontSize: 14.5, lineHeight: 1.7 };
const hStyle: React.CSSProperties = { fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 };
const pStyle: React.CSSProperties = { color: 'var(--ink-2)' };
