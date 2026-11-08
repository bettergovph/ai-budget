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
 * responsibilities, professional advice, governing law), the same words. Added for this site: how
 * acceptance works (components/TermsGate.tsx), what the content is, no accusations, why we publish,
 * acceptable use, the licences, sharing posters, the API and MCP server, the letters, privacy,
 * indemnity and changes. Numbered so a section can be cited; each has an anchor.
 */

const L = ({ l }: { l: Licence }) => <a href={l.url} target="_blank" rel="noopener">{l.name}</a>;
const H = ({ id, children }: { id: string; children: React.ReactNode }) => <h3 id={id} style={hStyle}>{children}</h3>;

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
          dek="Please read these terms carefully. They are an agreement between you and BetterGov.ph. They follow BetterGov.ph’s own Terms of Service, adapted to this site."
        />

        <H id="acceptance">1. Acceptance of these terms</H>
        <p style={pStyle}>
          These Terms of Service, and the <Link to={DISCLAIMER_PAGE}>Disclaimer</Link>, which is part of them, are an
          agreement between you and BetterGov.ph (“we”, “us”) about your use of BetterGov Budget at
          budget.bettergov.ph: its pages, data downloads, API, MCP server, posters and share images (together, “the
          site”).
        </p>
        <p style={pStyle}>
          On your first visit, and again whenever these terms change, the site asks you to tick “I have read and agree”
          and select “I agree”. By doing so, or by accessing and using the site in any other way, including through the
          API or the MCP server, you accept and agree to be bound by these terms. If you do not agree to these terms,
          please discontinue use of the site.
        </p>
        <p style={pStyle}>
          If you are under 18, use the site with the permission of a parent or guardian. If you use the site for an
          organisation, you accept these terms for it too, and confirm that you may do so.
        </p>

        <H id="about">2. About this site</H>
        <p style={pStyle}>
          BetterGov Budget is run by BetterGov.ph. It is not an official government website, and BetterGov.ph is not a
          government agency. We are not affiliated with, endorsed by or acting for any government agency, Congress,
          political party or official. Nothing on the site is an official government record. A mention of an agency,
          official, party or organisation does not mean that it endorses the site.
        </p>

        <H id="content">3. What the content is, and is not</H>
        <p style={pStyle}>
          The site reads published public documents (the budget acts and bills, the National Expenditure Program, and
          the other sources each page names) and explains them in plain words.
        </p>
        <p style={pStyle}>
          The figures, comparisons, placements, summaries and commentary are prepared with the help of artificial
          intelligence tools and reviewed by people. They can contain errors, omissions, misclassifications and out-of-date figures.
          They are our reading of the documents, not the documents themselves. Where they differ, the official document
          governs.
        </p>
        <p style={pStyle}>
          Amounts are allocations: what a budget sets aside. They are not what was spent, released or paid, unless a
          page says otherwise. Hearing transcripts and summaries are made by machine from public videos, and names and
          speakers can be wrong. The <Link to={DISCLAIMER_PAGE}>Disclaimer</Link> explains each of these in full.
        </p>

        <H id="no-accusations">4. No accusation of wrongdoing</H>
        <p style={pStyle}>
          Nothing on the site states, implies or should be read as stating that any person, office, party, contractor
          or official has committed a crime, an irregularity, corruption or any other wrongdoing.
        </p>
        <p style={pStyle}>
          Insertions, deletions, changed amounts, red flags, rankings, totals, placements and links between budget lines
          and contracts come from comparing documents. They are prompts for public scrutiny and for questions to the
          offices concerned. They are not findings. Congress may amend the National Expenditure Program (NEP), and an
          insertion or amendment is not unlawful in itself. The documents do not say who asked for any project, and
          nothing on the site says that a representative requested, sponsored or controlled one.
        </p>
        <p style={pStyle}>
          Any conclusion that you or anyone else draws about a person from the site is your own, not ours.
        </p>

        <H id="why-we-publish">5. Why and how we publish</H>
        <p style={pStyle}>
          We publish in good faith and in the public interest, to help citizens read and question the national budget.
          The budget and the official acts of public officers are matters of public concern. The Constitution recognises
          the right of the people to information on matters of public concern (Article III, Section 7) and the State’s
          policy of full public disclosure of its transactions involving public interest (Article II, Section 28), and
          it protects freedom of speech and of expression (Article III, Section 4).
        </p>
        <p style={pStyle}>
          Our pages report and compare what official documents say. Our commentary is fair comment, made in good faith,
          on public documents and on the official acts of public officers. Representatives’ names, districts and parties
          come from public records: the House of Representatives’ roster and published election results. Information
          about public officers that relates to their positions or functions is outside the coverage of the Data
          Privacy Act of 2012 (Republic Act No. 10173, Section 4).
        </p>

        <H id="responsibilities">6. User responsibilities</H>
        <p style={pStyle}>
          Users are solely responsible for conducting their own independent verification of all information obtained
          from this website, reviewing original source links provided, and determining the suitability of information
          for their intended use.
        </p>
        <p style={pStyle}>
          We strongly encourage consulting official government websites and agencies for the most current information,
          and verifying dates, figures, and details through multiple reputable sources.
        </p>

        <H id="acceptable-use">7. Acceptable use</H>
        <p style={pStyle}>When you use the site, you agree not to:</p>
        <ul style={pStyle}>
          <li>present anything from it as an official government record, or as a finding of wrongdoing;</li>
          <li>
            change its figures, labels or dates, or crop or remove the disclaimers, sources, dates or credits on its
            posters, share images and downloads;
          </li>
          <li>
            use it to harass, threaten or intimidate anyone, to publish anyone’s private information, to incite hatred
            or violence, or to make false or defamatory statements about anyone;
          </li>
          <li>
            suggest that BetterGov.ph endorses you, your views, a candidate, a party or a product, or pretend to be
            BetterGov.ph;
          </li>
          <li>use the BetterGov.ph name or logo without our written permission;</li>
          <li>
            disrupt, overload or attack the site, the API or the MCP server, get around any limits on them, or try to
            reach parts of them that are not public;
          </li>
          <li>use the site for anything unlawful.</li>
        </ul>
        <p style={pStyle}>We may block access that breaks these terms.</p>

        <H id="licences">8. Content and licences</H>
        <p style={pStyle}>
          Unless otherwise noted, the text, charts, posters and share images BetterGov.ph publishes on this site are
          licensed under <L l={CONTENT_LICENCE} />. The data downloads (CSV and JSON), the API and the MCP server are
          licensed under <L l={DATA_LICENCE} />. The source code is released under the <L l={CODE_LICENCE} />.
        </p>
        <p style={pStyle}>
          Under {CONTENT_LICENCE.name}, you may copy and share the content unchanged, for non-commercial purposes, if
          you give appropriate credit and link to the licence. Sharing an adapted version needs separate permission.
          Under {DATA_LICENCE.name}, you may use and adapt the data for any purpose if you give appropriate credit.
          Credit “BetterGov.PH” and link to the page or dataset you used. Datasets we publish elsewhere, such as on
          Hugging Face, carry the licence stated there.
        </p>
        <p style={pStyle}>
          No licence covers the BetterGov.ph name or logo. Government documents we republish remain public records.
          Third-party material, such as the People’s Budget Coalition’s tracker and representatives’ photos, keeps its
          original terms; check them before reuse.
        </p>

        <H id="sharing">9. Sharing posters and figures</H>
        <p style={pStyle}>
          Share posters and share images whole, with their disclaimer, date and credit. Quote a figure with its source
          and date. Do not present anything from this site as an official government record. Do not use it to claim
          that a named person did something wrong: the documents do not say who asked for any project.
        </p>

        <H id="api">10. The API and the MCP server</H>
        <p style={pStyle}>
          The API (<a href="/docs">documentation</a>) and the MCP server are free and read-only. Keep the disclaimers
          each House bill result carries, show them to the people who use what you build, and credit BetterGov.PH. We
          may limit traffic that disrupts the service. The service, its endpoints and its data may change or stop
          without notice.
        </p>

        <H id="letters">11. Letters to representatives</H>
        <p style={pStyle}>
          The letters are templates. You decide whether to send one, and you send it in your own name. You are
          responsible for what you send. BetterGov.ph does not send, receive or store letters.
        </p>

        <H id="corrections">12. Corrections, content concerns and takedown requests</H>
        <p style={pStyle}>
          We work to be accurate, but errors, out-of-date figures or other concerns can arise. To report content you
          believe is wrong, harmful or unlawful,{' '}
          <a href={ISSUES_URL} target="_blank" rel="noopener">open an issue in the site’s GitHub repository</a> or
          write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Include the page’s address, a clear
          description of the concern, and supporting documents where you have them. We will review all legitimate
          concerns in good faith.
        </p>
        <p style={pStyle}>
          We may correct, update or remove any content at any time. When a correction changes a figure readers have
          already seen, we log the change on the page.
        </p>

        <H id="third-parties">13. Links and third-party content</H>
        <p style={pStyle}>
          The site links to and quotes other sites and documents, such as government portals, the People’s Budget
          Coalition, YouTube and Wikimedia Commons. We do not control them, and we are not responsible for their content,
          availability or practices.
        </p>

        <H id="privacy">14. Privacy</H>
        <p style={pStyle}>
          This site has no accounts, no forms and no cookies of its own, and it runs no tracking scripts. To remember
          that you accepted these terms, it saves one item in your browser’s local storage: the version of the terms and
          when you accepted them. That item stays on your device and is never sent to us; clearing your browser’s site
          data removes it.
        </p>
        <p style={pStyle}>
          Our host, Cloudflare, processes basic request data, such as IP addresses, to deliver and protect the site.
          Fonts load from Google Fonts, maps load from CARTO, and hearing pages play videos through YouTube; each
          follows its own privacy policy.
        </p>

        <H id="as-is">15. “As is” disclaimer</H>
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

        <H id="liability">16. Limitation of liability</H>
        <p style={pStyle}>
          To the fullest extent permitted by law, under no circumstances shall the website operators, contributors, or
          affiliated parties be liable for any direct, indirect, incidental, special, consequential, or punitive damages
          arising from your use of this website, any errors or omissions in the content, any interruption or cessation
          of transmission, any bugs or harmful components, or loss of data.
        </p>
        <p style={pStyle}>
          This limitation applies regardless of whether such damages arise from contract, tort, negligence, strict
          liability, or any other legal theory. Nothing in these terms excludes or limits any liability that cannot be
          excluded or limited under Philippine law.
        </p>

        <H id="indemnity">17. Indemnity</H>
        <p style={pStyle}>
          You agree to indemnify and hold harmless BetterGov.ph, its volunteers, contributors and partners against any
          claim, liability, damages, loss, cost or expense, including reasonable attorney’s fees, that arises from your
          use or misuse of the site, your breach of these terms, or anything you publish, share or send using material
          from the site, including any statement you make about any person.
        </p>

        <H id="no-advice">18. No professional advice</H>
        <p style={pStyle}>
          Information on this website is not intended as professional advice — legal, medical, financial, or
          otherwise. Users should consult qualified professionals for specific advice related to their situations.
        </p>

        <H id="changes">19. Changes to the site and to these terms</H>
        <p style={pStyle}>
          We may change, suspend or stop any part of the site at any time. We may also update these terms. When we
          change them materially, we will update the effective date and ask you to accept them again on your next
          visit. If you keep using the site after a change, you accept the updated terms.
        </p>

        <H id="governing-law">20. Governing law</H>
        <p style={pStyle}>
          These terms are governed by the laws of the Republic of the Philippines without regard to conflict of law
          principles, and any dispute about them is subject to the jurisdiction of the proper courts of the
          Philippines. If any provision is found to be unenforceable, the remaining provisions will continue in full
          force and effect.
        </p>
        <p style={pStyle}>
          These terms and the Disclaimer are the whole agreement between you and us about the site. If we do not
          enforce a provision, we do not waive it.
        </p>

        <p className="note-block" style={{ marginTop: 32 }}>
          Effective as of {LEGAL_EFFECTIVE}. Questions about these terms:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. They follow{' '}
          <a href={BETTERGOV_TERMS_URL} target="_blank" rel="noopener">BetterGov.ph’s Terms of Service</a>.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}

const mainStyle: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '32px 32px 80px', fontSize: 14.5, lineHeight: 1.7 };
const hStyle: React.CSSProperties = { fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8, scrollMarginTop: 16 };
const pStyle: React.CSSProperties = { color: 'var(--ink-2)' };
