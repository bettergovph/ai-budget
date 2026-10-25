import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import {
  fetchHearings,
  formatDate,
  type Hearing,
} from '../lib/hearings';
import '../nep2027.css';
import '../hearings.css';

/**
 * Budget Briefing/Hearings — grid of House Committee on Appropriations
 * hearing videos. The index is D1 via /api/hearings; thumbnails are the
 * videos' YouTube stills.
 *
 * Chrome follows the FY2027 microsite: masthead, .page-headline, a KPI strip
 * and the shared control inputs, so a hearing reads as another view of the
 * same budget rather than a separate product.
 */
export default function Hearings() {
  const [hearings, setHearings] = useState<Hearing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agency, setAgency] = useState<string>('');
  const [q, setQ] = useState('');

  useEffect(() => {
    document.title = 'Budget Briefing/Hearings — House Committee on Appropriations · BetterGov Budget';
    fetchHearings()
      .then(setHearings)
      .catch((e) => setError((e as Error).message));
  }, []);

  const agencies = useMemo(() => {
    const set = new Set<string>();
    for (const h of hearings ?? []) {
      if (h.agency) set.add(h.agency);
    }
    return [...set].sort();
  }, [hearings]);

  const visible = useMemo(() => {
    let list = hearings ?? [];
    if (agency) list = list.filter((h) => h.agency === agency);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (h) =>
          h.title.toLowerCase().includes(needle) ||
          (h.agency ?? '').toLowerCase().includes(needle),
      );
    }
    return list;
  }, [hearings, agency, q]);

  const all = hearings ?? [];
  const withTranscripts = all.filter((h) => h.has_transcript).length;
  const withRecord = all.filter((h) => h.has_sections || h.has_summary).length;
  const latest = all.reduce<string | null>(
    (a, h) => (h.published_at && (!a || h.published_at > a) ? h.published_at : a),
    null,
  );
  const isFiltered = visible.length !== all.length;

  return (
    <div className="hearings-page">
      <SiteHeader
        crumb="Budget Briefing/Hearings"
        compiledMeta={`${withTranscripts} transcripts`}
      />
      <main className="nep-main hearings-main">
        <div className="page-headline">
          <p className="page-eyebrow">
            House of Representatives · Committee on Appropriations
          </p>
          <h1 className="page-title">Budget Briefing / Hearings</h1>
          <p className="page-dek">
            Every FY 2027 budget briefing and hearing streamed by the House of
            Representatives, with full transcripts, summaries, and highlights.
            Click any point in a transcript to jump straight to that moment in
            the video.
          </p>
        </div>

        <div className="kpi-strip">
          <div className="kpi-cell">
            <div className="kpi-label">Hearings indexed</div>
            <div className="kpi-value">{all.length || '—'}</div>
            <div className="kpi-sub">streamed by the House</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">With transcripts</div>
            <div className="kpi-value">{hearings ? withTranscripts : '—'}</div>
            <div className="kpi-sub">time-coded and searchable</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">With a record</div>
            <div className="kpi-value">{hearings ? withRecord : '—'}</div>
            <div className="kpi-sub">topics, timeline or brief</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">Agencies covered</div>
            <div className="kpi-value">{hearings ? agencies.length : '—'}</div>
            <div className="kpi-sub">
              {latest ? `latest ${formatDate(latest)}` : 'departments and agencies'}
            </div>
          </div>
        </div>

        <section className="nep-section">
          <div className="hearings-controls">
            <input
              type="search"
              className="text-input hearings-search"
              placeholder="Search hearings…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search hearings"
            />
            <select
              className="select-input"
              value={agency}
              onChange={(e) => setAgency(e.target.value)}
              aria-label="Filter by agency"
            >
              <option value="">All agencies</option>
              {agencies.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            {hearings && (
              <span className="hearings-count">
                {visible.length.toLocaleString()}{' '}
                {visible.length === 1 ? 'hearing' : 'hearings'}
                {isFiltered && ` of ${all.length.toLocaleString()}`}
              </span>
            )}
          </div>

          {error && (
            <p className="hearings-error">Could not load hearings: {error}</p>
          )}
          {!hearings && !error && (
            <span className="visually-hidden" role="status">Loading hearings…</span>
          )}
          {hearings && visible.length === 0 && (
            <p className="nep-empty">No hearing matches that filter.</p>
          )}

          <div className="hearings-grid">
            {visible.map((h) => (
              <Link
                key={h.video_id}
                to={`/hearings/${h.video_id}`}
                className="hearing-card"
              >
                <div className="hearing-thumb">
                  <img
                    src={`https://i.ytimg.com/vi/${h.video_id}/hqdefault.jpg`}
                    alt=""
                    loading="lazy"
                  />
                  {h.length_text && (
                    <span className="hearing-duration">{h.length_text}</span>
                  )}
                  {!h.has_transcript && (
                    <span className="hearing-pending">Transcript pending</span>
                  )}
                </div>
                <div className="hearing-card-body">
                  <div className="hearing-card-meta">
                    {h.agency ? (
                      <span className="hearing-agency">{h.agency}</span>
                    ) : (
                      <span className="hearing-agency hearing-agency-generic">Appropriations</span>
                    )}
                    <span className="hearing-date">{formatDate(h.published_at)}</span>
                  </div>
                  <h2 className="hearing-title">{h.title}</h2>
                  {h.has_sections ? (
                    <span className="hearing-has-summary">Topics + timeline →</span>
                  ) : h.has_summary ? (
                    <span className="hearing-has-summary">Summary + transcript →</span>
                  ) : (
                    <span className="hearing-has-summary hearing-muted">Video →</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <p className="nep-provenance hearing-provenance">
          Video and captions from the House of Representatives' YouTube channel ·{' '}
          <Link to="/2027">FY2027 NEP overview</Link> ·{' '}
          <Link to="/glossary">budget glossary</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
