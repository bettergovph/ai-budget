/**
 * `/senate/2027/provisions`: the Senate committee report's amendments to the bill's special and general
 * provisions (Annex B), by department, each with the House bill page and line it amends and its page in the
 * report. Text as published.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner } from '../components/SenateBits';
import { pdfUrl } from '../lib/hgab';
import { titleCase } from '../lib/hgab-explorer';
import { pageMeta } from '../lib/seo';
import { SENATE_PROVISIONS_ROOT, loadSenateProvisions, senateExplorerPath, senatePdfUrl, type SenateProvision } from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';

export default function SenateProvisions() {
  const [d, setD] = useState<SenateProvision[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    document.title = pageMeta(SENATE_PROVISIONS_ROOT).title;
    loadSenateProvisions().then((x) => setD(x.amendments)).catch((e) => setErr(String(e?.message || e)));
  }, []);
  const groups = useMemo(() => {
    const m = new Map<string, SenateProvision[]>();
    const needle = q.trim().toLowerCase();
    for (const p of d ?? []) {
      if (needle && !`${p.dept} ${p.agency} ${p.instruction} ${p.amended_text}`.toLowerCase().includes(needle)) continue;
      const k = p.part === 'general' ? 'General provisions' : p.dept ?? 'Other';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return m;
  }, [d, q]);
  if (err) return <SenateError message={err} />;
  if (!d) return <SenateLoading what="the amendments to the provisions" />;
  return (
    <>
      <SenateHeader crumb="Provisions" />
      <SenateHero
        compact
        crumb="Provisions"
        title={`${d.length} amendments to the bill's provisions`}
        dek="The rules attached to the money: the amounts written into special provisions, conditions on releasing funds, and reports agencies must file. Each amendment cites the House bill page and line it changes."
      />
      <main className="nep-main hgab-ex-main">
        <SenateReviewBanner compact />
        <div className="hgab-ex-controls">
          <input className="text-input nep-filter" type="search" placeholder="Find a word, an agency or an amount…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the amendments" />
        </div>
        {[...groups.entries()].map(([dept, items]) => (
          <section className="nep-section" key={dept}>
            <SectionHead
              eyebrow={items[0].part === 'general' ? 'General provisions' : 'Special provisions'}
              headline={titleCase(dept.replace(/^[IVXL]+\.\s*/, ''))}
              right={items[0].dept_id ? <Link to={senateExplorerPath(items[0].dept_id)}>Its amounts, line by line →</Link> : undefined}
            />
            {items.map((p, i) => (
              <article className="senate-prov" key={i}>
                <h3>
                  {p.agency ? `${titleCase(p.agency.replace(/^[A-Z]{1,2}(\.\d+)?\.\s*/, ''))} · ` : ''}
                  {p.volume ? `Vol. ${p.volume}, ` : ''}page {p.hb_page ?? '—'}, {/^\d/.test(p.line_ref) ? `line ${p.line_ref}` : p.line_ref}
                </h3>
                <p>{p.instruction}</p>
                {p.amended_text && (
                  <details>
                    <summary>The provision as amended</summary>
                    <p className="senate-prov-text">{p.amended_text}</p>
                  </details>
                )}
                <p className="senate-refs">
                  {p.hb_doc && p.hb_pdf_page && <a href={pdfUrl(p.hb_doc, p.hb_pdf_page)} target="_blank" rel="noreferrer">House bill page {p.hb_page} →</a>}
                  <a href={senatePdfUrl('senate-cr-annex-b', p.senate_pdf_page)} target="_blank" rel="noreferrer">Senate report, Annex B page {p.senate_pdf_page} →</a>
                </p>
              </article>
            ))}
          </section>
        ))}
        {!groups.size && <p className="nep-empty">No amendment matches.</p>}
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}
