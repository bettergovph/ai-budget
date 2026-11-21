/**
 * `/senate/2027/sources` and `/senate/2027/methodology`: the committee report's documents, and how the
 * section reads them and matches them to the House bill. The full write-up is docs/senate-cr-2027.md.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { SenateHeader, SenateHero, SenateNotice } from '../components/SenateBits';
import { HgabDetails } from '../components/HgabBits';
import { HGAB_ROOT } from '../lib/hgab';
import { pageMeta } from '../lib/seo';
import { SENATE_DOC, SENATE_ROOT, loadSenateOverview, senatePdfUrl, type SenateOverview } from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';

export default function SenateAbout({ which }: { which: 'sources' | 'methodology' }) {
  const [o, setO] = useState<SenateOverview | null>(null);
  useEffect(() => {
    document.title = pageMeta(`${SENATE_ROOT}/${which}`).title;
    loadSenateOverview().then(setO).catch(() => {});
  }, [which]);
  const title = which === 'sources' ? 'Sources' : 'Methodology';
  return (
    <>
      <SenateHeader crumb={title} />
      <SenateHero compact crumb={title} title={which === 'sources' ? 'Where the Senate figures come from' : 'How we read the Senate committee report'} dek={SENATE_DOC.plain} />
      <main className="nep-main hgab-ex-main">
        {which === 'sources' ? (
          <section className="nep-section">
            <SectionHead eyebrow="The documents" headline={o?.report.title ?? 'The Senate committee report'} dek={o ? `${o.report.committee}; prepared by ${o.report.prepared}.` : undefined} />
            <div className="nep-table-wrap">
              <table className="nep-table">
                <thead><tr><th>Document</th><th>What it holds</th><th>SHA-256</th></tr></thead>
                <tbody>
                  {(o?.documents ?? []).map((d) => (
                    <tr key={d.key}>
                      <td><a href={senatePdfUrl(d.key)} target="_blank" rel="noreferrer">{d.title}</a></td>
                      <td className="hgab-ex-sub">{ABOUT_DOC[d.key] ?? ''}</td>
                      <td><code title={d.sha256}>{d.sha256.slice(0, 12)}…</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="nep-provenance">
              The House bill and NEP documents are on the <Link to={`${HGAB_ROOT}/sources`}>House bill section's Sources page</Link>.
            </p>
          </section>
        ) : (
          <>
            <section className="nep-section">
              <SectionHead eyebrow="Reading" headline="Read from the PDFs' text, checked against their own totals" />
              <p>
                The committee report is published as PDFs with a text layer, so every figure is read from the text with its
                position on the page: no scanning and no AI reading the numbers. Every row's House bill amount, increase,
                decrease, net change and committee report amount are checked to add up, and every program and department to
                the report's printed totals. They do, to the peso, except where the report itself prints a row that does
                not add up; those are listed in the technical notes.
              </p>
            </section>
            <section className="nep-section">
              <SectionHead eyebrow="Matching" headline="Each Senate change, tied to the House bill line it amends" />
              <ul>
                <li>
                  <strong>Line-by-line amendments (Annex A)</strong> cite the House bill volume, page and line they change.
                  A row is matched to the House bill line printed there only when that line carries the same House bill
                  amount. A changed line keeps the report's amount; a line the report doesn't mention keeps the House bill's.
                </li>
                <li>
                  <strong>DPWH projects (Annex A-4)</strong> print the House bill's project name and amount beside the
                  report's revised name, so a renamed project stays linked to its House bill version. All 8,713 rows are
                  matched to a House bill project; 8,682 by exact name and amount.
                </li>
                <li>
                  <strong>Farm-to-market roads and irrigation (Annexes A-1 and A-3)</strong> are matched by name and House bill
                  amount; every House bill project is found. When the report removes a road and inserts it back with a corrected
                  name or new coordinates, the two are linked if they name the same municipality and the same site.
                </li>
                <li>
                  <strong>Health facilities (Annex A-2)</strong> lists the committee's changes by facility; each is added to the
                  House bill row for the same facility and kind of budget, or listed as a facility the House bill doesn't fund.
                </li>
              </ul>
            </section>
            <HgabDetails>
              <p>
                Pipeline: <code>npm run build:senate-cr</code> (scripts/senate-cr/), documented in docs/senate-cr-2027.md in
                the site's repository. Outputs are rebuilt from the PDFs; nothing is entered by hand.
              </p>
              <p>
                Known issues in the source: a few rows print no committee report amount or print it on the line above; the
                farm-to-market roads annex's regional totals count gross movements while its rows print net changes. In our
                House bill data, one DPWH row (a multi-purpose building in Taysan, Batangas) holds two printed lines; the
                report's two rows are matched to it together.
              </p>
            </HgabDetails>
          </>
        )}
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}

const ABOUT_DOC: Record<string, string> = {
  'senate-cr-general-summary': 'House bill vs committee report by department, agency and fund, in thousand pesos.',
  'senate-cr-annex-a': 'Every line amended in Vol. I-A and I-B, citing the House bill page and line.',
  'senate-cr-annex-a1': 'Farm-to-market roads: House bill description, committee report description, amounts.',
  'senate-cr-annex-a2': "The committee's changes to the Health Facilities Enhancement Program, by facility.",
  'senate-cr-annex-a3': 'National Irrigation Administration projects, as for farm-to-market roads.',
  'senate-cr-annex-a4': 'DPWH programs and projects (House bill Vol. I-C) changed or renamed.',
  'senate-cr-annex-a5': 'The Tourism Infrastructure and Enterprise Zone Authority and Tourism Promotions Board, inserted.',
  'senate-cr-annex-b': 'Amendments to the special and general provisions.',
};
