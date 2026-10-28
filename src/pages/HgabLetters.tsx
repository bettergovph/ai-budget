/**
 * `/hgab/2027/letter` — "Write to your representative": pick a legislative
 * district, get its letter (`/hgab/2027/letter/:slug`).
 *
 * One line per district, grouped by region, with the DPWH office badge beside
 * the district (docs/hgab-copy.md) and how many projects its letter lists.
 * The list is `letters/index.json` (`npm run build:hgab-letters`).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DeoBadges, DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { REGION_ORDER, loadHgabLetterIndex } from '../lib/hgab';
import { districtRegionKey, regionAnchor, regionNames, type RegionSectionKey } from '../lib/hgab-districts';
import { DEO_MEANING, asOfText } from '../lib/hgab-leaderboard';
import { letterPath, type LetterIndex, type LetterIndexEntry } from '../lib/hgab-letter';
import '../nep2027.css';
import '../hgab-letter.css';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function listedText(l: LetterIndexEntry): string {
  const n = l.inserted_rows + l.adjusted_rows + l.dropped_rows;
  if (!l.tier) return 'no DPWH office';
  return n ? `${n.toLocaleString('en-US')} project${n === 1 ? '' : 's'} listed` : 'no changes';
}

export default function HgabLetters() {
  const [index, setIndex] = useState<LetterIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [find, setFind] = useState('');

  useEffect(() => {
    document.title = 'Write to your representative — the 2027 House bill · BetterGov Budget';
    let live = true;
    loadHgabLetterIndex()
      .then((ix) => { if (live) setIndex(ix); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);

  const regions = useMemo(() => {
    if (!index) return [];
    const q = fold(find.trim());
    const hit = (l: LetterIndexEntry) =>
      !q || fold([l.label, ...l.offices, ...l.recipients].join(' ')).includes(q);
    const by = new Map<RegionSectionKey, LetterIndexEntry[]>();
    for (const l of index.letters) {
      if (!hit(l)) continue;
      const k = districtRegionKey(l);
      by.set(k, [...(by.get(k) ?? []), l]);
    }
    return [...REGION_ORDER, 'other' as const]
      .filter((k) => by.has(k))
      .map((k) => ({ key: k, letters: by.get(k)!.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true })) }));
  }, [index, find]);

  if (err) return <HgabError message={err} />;
  if (!index) return <HgabLoading what="the list of letters" />;

  const shared = index.letters.filter((l) => l.recipients.length > 1).length;
  const shown = regions.reduce((n, r) => n + r.letters.length, 0);

  return (
    <>
      <HgabHeader crumb="Write a letter" />
      <HgabHero
        compact
        crumb="Write a letter"
        title={`Write to your representative: ${index.letters.length.toLocaleString('en-US')} letters, one per legislative district`}
        dek={
          <>
            Each letter asks for an explanation of the DPWH projects the House bill lists for the office serving the
            district, for the documents behind them, and for accountability. Where one DPWH office serves several
            districts ({shared.toLocaleString('en-US')} letters), it goes to every representative it serves. Download it as
            a PDF to print and sign, or as text to edit.
          </>
        }
        note={<>{DEO_MEANING} {asOfText(index)}.</>}
      />
      <main className="nep-main hgab-lt-main">
        <div className="hgab-lt-find">
          <label htmlFor="hgab-lt-find">Find your district</label>
          <input
            id="hgab-lt-find"
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Province, city, DPWH office or representative"
            autoComplete="off"
          />
          {find.trim() && <span className="hgab-lt-find-count" role="status">{shown.toLocaleString('en-US')} of {index.letters.length.toLocaleString('en-US')}</span>}
        </div>
        {regions.map((r) => {
          const names = regionNames(r.key);
          return (
            <section key={r.key} className="hgab-lt-region" id={regionAnchor(r.key)} aria-labelledby={`${regionAnchor(r.key)}-h`}>
              <h2 id={`${regionAnchor(r.key)}-h`}>
                {names.short} · {names.name} <span>{r.letters.length.toLocaleString('en-US')} legislative districts</span>
              </h2>
              <ul>
                {r.letters.map((l) => (
                  <li key={l.slug}>
                    <Link to={letterPath(l.slug)}>
                      {l.label}
                      <DeoBadges offices={l.offices} jurisdiction={l.jurisdiction} />
                    </Link>
                    <span className="hgab-lt-meta">
                      {listedText(l)}
                      {l.recipients.length > 1 && ` · ${l.recipients.length} representatives`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {!regions.length && <p className="hgab-lt-empty">No district matches “{find}”.</p>}
        <DisclaimerNotice offices compact />
      </main>
      <SiteFooter />
    </>
  );
}
