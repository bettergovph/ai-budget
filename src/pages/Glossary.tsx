/**
 * `/glossary` — the complete vocabulary of the Philippine national budget.
 *
 * All entries from the DBM's official BESF 2026 Glossary of Terms, rewritten
 * in plain language, searchable and filterable by category. Data lives in
 * src/lib/glossary-terms.ts; the /learn guide links here.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LearnHeader from '../components/LearnHeader';
import SiteFooter from '../components/SiteFooter';
import { CATS, TERMS, type Cat } from '../lib/glossary-terms';
import '../nep2027.css';
import '../learn.css';

export default function Glossary() {
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
    <div className="nep-page">
      <LearnHeader crumb="Glossary" />

      <section className="nep-dept-hero">
        <div className="nep-dept-hero-inner">
          <p className="nep-dept-hero-eyebrow">Glossary · Every term, in plain language</p>
          <h1 className="nep-dept-hero-title">The words the budget assumes you know</h1>
          <p className="nep-dept-hero-dek">
            The complete vocabulary of the DBM’s official BESF Glossary of Terms — all{' '}
            {TERMS.length} entries rewritten in plain language, from the documents and the players
            to taxes, debt, and how performance is measured.
          </p>
        </div>
      </section>

      <main className="nep-main learn">
        <section className="nep-section" id="glossary">
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

        <section className="nep-section" id="sources">
          <p className="learn-eyebrow">Source</p>
          <ul className="learn-sources">
            <li>
              <a href="https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2026/GLOSSARY.pdf" target="_blank" rel="noopener">
                DBM · BESF 2026 Glossary of Terms ↗
              </a>
              <span>
                — the official definitions every entry here is grounded in. New to the budget?{' '}
                <Link to="/learn">Start with the guide</Link>.
              </span>
            </li>
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
