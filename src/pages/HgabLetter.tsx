/**
 * `/hgab/2027/letter/:slug` — one legislative district's letter to its
 * representative(s): the letter itself, as it prints, beside the downloads
 * (PDF to print and sign, text to edit), the recipients and how to send it.
 *
 * The preview is `letterHtml(composeLetter(data))`, the same markup the
 * builder prints to PDF, so what the reader sees is what they download. The
 * data is `letters/<slug>.json` (`npm run build:hgab-letters`).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DeoBadges, DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { dataUrl } from '../lib/data-url';
import { districtPath, loadHgabLetter } from '../lib/hgab';
import { DEO_MEANING, formatPesoFull } from '../lib/hgab-leaderboard';
import {
  HOUSE_ADDRESS, composeLetter, formalName, joinAnd, letterDownloadName, letterFile, letterHtml, letterOfficeText, letterPath,
  type LetterData, type LetterRecipient,
} from '../lib/hgab-letter';
import '../nep2027.css';
import '../hgab-letter.css';

function recipientName(r: LetterRecipient): string {
  if (!r.names.length) return 'No representative found';
  return r.names.map((n) => `Hon. ${formalName(n).full}`).join(' or ');
}

/** What the letter is about, in two sentences at most. */
function dek(d: LetterData): string {
  const n = d.recipients.length;
  const office = letterOfficeText(d.offices);
  const to = n === 1 ? recipientName(d.recipients[0]) : `the ${n} representatives of the districts the ${office} ${d.offices.length > 1 ? 'serve' : 'serves'}`;
  if (!d.figures) return `A letter to ${to}, asking about the 2027 projects for the district. The DPWH project lists name no district engineering office for it.`;
  const parts = [
    d.inserted.length && `${d.inserted.length.toLocaleString('en-US')} with no match in the NEP, worth ${formatPesoFull(d.figures.inserted_php)}`,
    d.adjusted.length && `${d.adjusted.length.toLocaleString('en-US')} with a changed amount`,
    d.dropped.length && `${d.dropped.length.toLocaleString('en-US')} in the NEP but not in the House bill`,
  ].filter(Boolean) as string[];
  if (!parts.length) return `A letter to ${to}, asking about the programs for the district. The House bill keeps every NEP project of the ${office} unchanged.`;
  const where = n === 1 ? `the ${office}` : d.offices.length > 1 ? 'those offices' : 'that office';
  return `A letter to ${to}, on the projects the House bill lists for ${where}: ${joinAnd(parts)}.`;
}

export default function HgabLetter() {
  const { slug = '' } = useParams();
  // Keyed by slug, so moving to another letter never shows the last one's data.
  const [loaded, setLoaded] = useState<{ slug: string; data: LetterData | null; err: string | null } | null>(null);
  const data = loaded?.slug === slug ? loaded.data : null;
  const err = loaded?.slug === slug ? loaded.err : null;

  useEffect(() => {
    let live = true;
    loadHgabLetter(slug)
      .then((d) => { if (live) setLoaded({ slug, data: d, err: null }); })
      .catch(() => {
        if (live) setLoaded({ slug, data: null, err: `There is no letter for “${slug}”. A saved link may be older than the current list of districts.` });
      });
    window.scrollTo(0, 0);
    return () => { live = false; };
  }, [slug]);

  const html = useMemo(() => (data ? letterHtml(composeLetter(data)) : ''), [data]);

  // The sticky download column sits under the site masthead, whose height
  // changes with the viewport (as in HgabDistrictSidebar).
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.masthead');
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--hgab-masthead-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--hgab-masthead-h');
    };
  }, [data]);
  useEffect(() => {
    if (data) document.title = `Letter to the representative of ${data.district.label} — the 2027 House bill · BetterGov Budget`;
  }, [data]);

  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="the letter" />;

  const { district, recipients } = data;
  const others = recipients.filter((r) => !r.own);
  const crumb = (
    <>
      <Link to={letterPath()}>Write a letter</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">{district.label}</span>
    </>
  );

  return (
    <>
      <HgabHeader crumb={<><Link to={letterPath()}>Write a letter</Link> › {district.label}</>} />
      <HgabHero
        compact
        crumb={crumb}
        title={
          <>
            {district.label}
            <DeoBadges offices={data.offices} jurisdiction={district.jurisdiction} />: letter to{' '}
            {recipients.length === 1 ? 'your representative' : `${recipients.length} representatives`}
          </>
        }
        dek={dek(data)}
        note={data.offices.length ? DEO_MEANING : undefined}
      >
        <p className="hgab-lt-back">
          <Link to={letterPath()}>← All letters</Link>
          <span aria-hidden="true"> · </span>
          <Link to={districtPath(district.id)}>This district’s budget page</Link>
        </p>
      </HgabHero>

      <main className="nep-main hgab-lt-main">
        <div className="hgab-lt-layout">
          <aside className="hgab-lt-side" aria-label="Download and send">
            <section className="hgab-lt-box">
              <h2>Download</h2>
              <div className="hgab-lt-btns">
                <a className="hgab-lt-btn is-primary" href={dataUrl(letterFile(data.slug, 'pdf'))} download={letterDownloadName(data.slug, 'pdf')}>
                  PDF <span>to print and sign</span>
                </a>
                <a className="hgab-lt-btn" href={dataUrl(letterFile(data.slug, 'txt'))} download={letterDownloadName(data.slug, 'txt')}>
                  Text <span>to edit</span>
                </a>
              </div>
              <p>The text file opens in Word, Google Docs or any editor. Fill in the parts in [square brackets], then change anything you like.</p>
            </section>

            <section className="hgab-lt-box">
              <h2>{recipients.length === 1 ? 'Addressed to' : `Addressed to ${recipients.length} representatives`}</h2>
              <ul className="hgab-lt-recipients">
                {recipients.map((r) => (
                  <li key={r.district_id}>
                    <strong>{recipientName(r)}</strong>
                    <span>
                      {r.district}
                      {r.own && <em className="hgab-lt-own">your district</em>}
                    </span>
                    {r.status === 'ambiguous' && <span className="hgab-lt-warn">The House member list names more than one member for this seat. Keep the right name.</span>}
                    {r.email && <a href={`mailto:${r.email}`}>{r.email}</a>}
                    {r.phone && <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}>{r.phone}</a>}
                    {r.profile_url && <a href={r.profile_url} target="_blank" rel="noopener">Official House profile</a>}
                  </li>
                ))}
              </ul>
              {others.length > 0 && (
                <p>
                  The {letterOfficeText(data.offices)} also {data.offices.length > 1 ? 'serve' : 'serves'}{' '}
                  {joinAnd(others.map((r) => r.district))}. {data.offices.length > 1 ? 'Their' : 'Its'} figures are shared and not split, so the letter goes to all of their representatives.
                </p>
              )}
            </section>

            <section className="hgab-lt-box">
              <h2>How to send it</h2>
              <ol className="hgab-lt-steps">
                <li>Fill in your name, address and the date.</li>
                <li>Print it, sign it, and ask other voters in your district to sign the signature sheet.</li>
                <li>
                  Deliver it to {HOUSE_ADDRESS.join(', ')}, or to your representative’s district office. Ask for a
                  stamped receiving copy.
                </li>
                <li>To email it instead, ask the district office for its email address and send a scan.</li>
                <li>The fifteen working days run from the day it is received. Keep your copy.</li>
              </ol>
            </section>
          </aside>

          <article className="hgab-lt-paper" aria-label="The letter, as it prints" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <DisclaimerNotice offices />
      </main>
      <SiteFooter />
    </>
  );
}
