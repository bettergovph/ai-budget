/**
 * `/2027/overview` — the FY2027 NEP as a vertical storytelling deck.
 *
 * Modelled on the national brand-guideline page itself: numbered chapters, one
 * display-scale statement per screen, a navy band top and bottom, and quiet
 * paper in between. The reader scrolls through the argument — how big, versus
 * what, where it lands, what moved — and exits into the working tools
 * (Browse, Search) once they want rows instead of story.
 *
 * Every figure is the same D1-served national index the rest of the microsite
 * uses; nothing here is restated by hand.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { NepError, NepHeader, NepLoading } from '../components/Nep2027Bits';
import * as fmt from '../lib/format';
import {
  BASE_YEAR, NEP_YEAR, formatPct, loadNepIndex, pctChange,
  type NepNationalIndex, type NepRollupRow,
} from '../lib/nep2027';
import { useState } from 'react';
import '../nep2027.css';
import '../nep2027-story.css';

export default function Nep2027Story() {
  const [idx, setIdx] = useState<NepNationalIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNepIndex().then(setIdx).catch((e) => setErr(String(e?.message || e)));
  }, []);

  // Chapter reveal: sections fade/rise in as they enter the viewport.
  // Reduced-motion users get everything visible immediately (CSS side).
  useEffect(() => {
    if (!idx) return;
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    root.querySelectorAll('.story-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [idx]);

  // Thin reading-progress bar under the masthead. Style is driven directly on
  // the ref so scrolling never re-renders the page.
  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const doc = document.documentElement;
        const max = doc.scrollHeight - doc.clientHeight;
        el.style.width = max > 0 ? `${(doc.scrollTop / max) * 100}%` : '0%';
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [idx]);

  if (err) return <NepError message={err} />;
  if (!idx) return <NepLoading what="the FY2027 NEP overview" />;

  const { amount, base_amount: base, line_items: items } = idx.national;
  const growth = pctChange(amount, base);
  const classes = idx.expense_classes;
  const classMax = Math.max(...classes.map((c) => c.amount));
  const agencySection = idx.sections.find((s) => s.code === '1');
  const autoSection = idx.sections.find((s) => s.code === '2');
  const programs = idx.top_programs.slice(0, 8);
  const programMax = Math.max(...programs.map((p) => p.amount));
  const regions = idx.regions.slice(0, 8);
  const regionMax = Math.max(...regions.map((r) => r.amount));
  const funds = idx.fund_subcategories.slice(0, 6);
  const fastestClass = [...classes].sort(
    (a, b) => (pctChange(b.amount, b.base_amount) ?? -Infinity) - (pctChange(a.amount, a.base_amount) ?? -Infinity),
  )[0];
  const topFundShare = funds[0] ? (funds[0].amount / amount) * 100 : 0;
  const moversUp = idx.top_movers_up.slice(0, 5);
  const moversDown = idx.top_movers_down.slice(0, 5);
  const moverMax = Math.max(...[...moversUp, ...moversDown].map((m) => Math.abs(m.delta)));

  return (
    <>
      <NepHeader crumb="Overview" compiledMeta={`${fmt.shortPhp(amount, 'T')} proposed`} hideSubNav />
      <div className="story-progress" aria-hidden="true"><div ref={progressRef} /></div>

      <main ref={rootRef} className="story">
        {/* ---- Hero: the navy band ---- */}
        <section className="story-band story-hero">
          <div className="story-hero-inner">
            <p className="story-kicker">Republic of the Philippines · Fiscal Year {NEP_YEAR}</p>
            <h1 className="story-hero-title">The National Expenditure Program</h1>
            <p className="story-hero-aka">Also known as the President’s Budget.</p>
            <p className="story-hero-sub">
              {fmt.shortPhp(amount, 'T')} proposed · {items.toLocaleString()} line items ·{' '}
              {idx.departments.length} spending groups · measured against the FY{BASE_YEAR} GAA
            </p>
            <span className="story-scroll-cue" aria-hidden="true">Scroll ↓</span>
          </div>
        </section>

        {/* ---- 01 ---- */}
        <section className="story-chapter story-reveal">
          <p className="story-ch-num">01 · The proposal</p>
          <h2 className="story-h">A proposal, not yet a law.</h2>
          <p className="story-lede">
            The National Expenditure Program is what the Executive submits to Congress. Congress can —
            and does — move these numbers before enacting them as the General Appropriations Act.
            Everything on this site compares the FY{NEP_YEAR} proposal to the FY{BASE_YEAR} law.
          </p>
          <div className="story-stats">
            <div><strong>{fmt.shortPhp(amount, 'T')}</strong><span>proposed for FY{NEP_YEAR}</span></div>
            <div><strong className={Number(growth) >= 0 ? 'up' : 'down'}>{formatPct(growth)}</strong><span>vs the FY{BASE_YEAR} GAA of {fmt.shortPhp(base, 'T')}</span></div>
            <div><strong>{items.toLocaleString()}</strong><span>line items across {idx.departments.length} groups</span></div>
          </div>
        </section>

        {/* ---- 02 ---- */}
        {agencySection && autoSection && (
          <section className="story-chapter story-chapter-tint story-reveal">
            <p className="story-ch-num">02 · Two kinds of money</p>
            <h2 className="story-h">
              {((autoSection.amount / amount) * 100).toFixed(0)}% never gets debated line by line.
            </h2>
            <p className="story-lede">
              {fmt.shortPhp(autoSection.amount, 'T')} is special-purpose funds and automatic
              appropriations — debt interest, the National Tax Allotment, pensions — money that flows
              by standing law. The {fmt.shortPhp(agencySection.amount, 'T')} in agency budgets is
              where the real deliberation happens.
            </p>
            <div className="story-split" role="img" aria-label={`Agency budgets ${fmt.shortPhp(agencySection.amount, 'T')}, special purpose and automatic ${fmt.shortPhp(autoSection.amount, 'T')}`}>
              <div style={{ flexGrow: agencySection.amount }}>
                <em>Agency budgets</em><strong>{fmt.shortPhp(agencySection.amount, 'T')}</strong>
              </div>
              <div className="alt" style={{ flexGrow: autoSection.amount }}>
                <em>Special purpose + automatic</em><strong>{fmt.shortPhp(autoSection.amount, 'T')}</strong>
              </div>
            </div>
          </section>
        )}

        {/* ---- 03 ---- */}
        <section className="story-chapter story-reveal">
          <p className="story-ch-num">03 · Where it goes</p>
          <h2 className="story-h">
            {fastestClass.description} grows fastest — {formatPct(pctChange(fastestClass.amount, fastestClass.base_amount))}.
          </h2>
          <div className="story-classes">
            {classes.map((c) => (
              <div className="story-class" key={c.code}>
                <div className="story-class-head">
                  <span>{c.description}</span>
                  <span className={`story-delta ${c.delta >= 0 ? 'up' : 'down'}`}>{formatPct(pctChange(c.amount, c.base_amount))}</span>
                </div>
                <div className="story-class-num">{fmt.shortPhp(c.amount, 'T')}</div>
                <div className="story-class-bar"><span style={{ width: `${(c.amount / classMax) * 100}%` }} /></div>
                <div className="story-class-base">FY{BASE_YEAR}: {fmt.shortPhp(c.base_amount, 'T')} · {((c.amount / amount) * 100).toFixed(1)}% of the NEP</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- 04 ---- */}
        <section className="story-chapter story-chapter-tint story-reveal">
          <p className="story-ch-num">04 · What moved</p>
          <h2 className="story-h">
            {moversUp[0]?.description.replace(/\s*\(.*\)$/, '')} gains the most.
          </h2>
          <div className="story-movers">
            <div>
              <h3>Largest increases</h3>
              <ol>
                {moversUp.map((m) => (
                  <li key={m.id}>
                    <Link to={`/2027/d/${m.id}`}>{m.description}</Link>
                    <span className="story-mover-bar"><span className="up" style={{ width: `${(Math.abs(m.delta) / moverMax) * 100}%` }} /></span>
                    <strong className="up">+{fmt.shortPhp(m.delta)}</strong>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3>Largest reductions</h3>
              <ol>
                {moversDown.map((m) => (
                  <li key={m.id}>
                    <Link to={`/2027/d/${m.id}`}>{m.description}</Link>
                    <span className="story-mover-bar"><span className="down" style={{ width: `${(Math.abs(m.delta) / moverMax) * 100}%` }} /></span>
                    <strong className="down">−{fmt.shortPhp(Math.abs(m.delta))}</strong>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ---- 05 ---- */}
        <section className="story-chapter story-reveal">
          <p className="story-ch-num">05 · The big programs</p>
          <h2 className="story-h">Eight programs carry {((programs.reduce((a, p) => a + p.amount, 0) / amount) * 100).toFixed(0)}% of the whole proposal.</h2>
          <ol className="story-ranked">
            {programs.map((p, i) => (
              <li key={p.code}>
                <span className="story-rank">{String(i + 1).padStart(2, '0')}</span>
                <span className="story-ranked-name">
                  {p.description}
                  {p.department_id && <Link to={`/2027/d/${p.department_id}`} className="story-ranked-dept">Group {p.department_id} →</Link>}
                </span>
                <span className="story-ranked-bar"><span style={{ width: `${(p.amount / programMax) * 100}%` }} /></span>
                <strong>{fmt.shortPhp(p.amount)}</strong>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- 06 ---- */}
        <section className="story-chapter story-chapter-tint story-reveal">
          <p className="story-ch-num">06 · Across the country</p>
          <h2 className="story-h">Most of the money is spent from the centre.</h2>
          <p className="story-lede">
            Region tags follow the implementing office, so NCR and the nationwide bucket dominate —
            that is where central offices, debt service and the big transfer funds sit, not
            necessarily where the pesos land.
          </p>
          <ol className="story-ranked story-ranked-tight">
            {regions.map((r) => (
              <li key={r.code}>
                <span className="story-ranked-name">{r.description}</span>
                <span className="story-ranked-bar"><span style={{ width: `${(r.amount / regionMax) * 100}%` }} /></span>
                <strong>{fmt.shortPhp(r.amount)}</strong>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- 07 ---- */}
        <section className="story-chapter story-reveal">
          <p className="story-ch-num">07 · Who pays for it</p>
          <h2 className="story-h">
            {topFundShare.toFixed(0)}% flows through a single fund subcategory.
          </h2>
          <p className="story-lede">
            “{funds[0]?.description}” — the general fund’s ordinary agency budgets — carries{' '}
            {fmt.shortPhp(funds[0]?.amount ?? 0, 'T')} on its own. The rest is standing
            appropriations, loan proceeds, and counterpart funds.
          </p>
          <ul className="story-funds">
            {funds.map((f: NepRollupRow) => (
              <li key={f.code}>
                <strong>{fmt.shortPhp(f.amount)}</strong>
                <span>{f.description}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---- Finale ---- */}
        <section className="story-band story-finale story-reveal">
          <p className="story-kicker">Now dig in</p>
          <h2 className="story-h story-h-paper">The story ends where the work starts.</h2>
          <div className="story-ctas">
            <Link to="/2027/browse"><strong>Browse</strong><span>every spending group, sortable</span></Link>
            <Link to="/2027/search"><strong>Search</strong><span>{items.toLocaleString()} line items, in your browser</span></Link>
            <Link to="/2027/methodology"><strong>Methodology</strong><span>field mapping, corrections, caveats</span></Link>
          </div>
          <p className="story-provenance">
            Generated {new Date(idx.generated_at).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })} from{' '}
            <code>{idx.source_file.split('/').pop()}</code> · aggregations served live from D1 ·
            FY{BASE_YEAR} baseline from the enacted GAA
          </p>
        </section>
      </main>
      <SiteFooter source={`SOURCE: NATIONAL EXPENDITURE PROGRAM · FY ${NEP_YEAR} · VS FY ${BASE_YEAR} GAA`} />
    </>
  );
}
