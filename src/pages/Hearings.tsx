import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import {
  fetchHearings,
  formatDate,
  type Hearing,
} from '../lib/hearings';
import '../hearings.css';

/**
 * Budget Briefing/Hearings — grid of House Committee on Appropriations
 * hearing videos. The index is D1 via /api/hearings; thumbnails are the
 * videos' YouTube stills.
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

  const withTranscripts = (hearings ?? []).filter((h) => h.has_transcript).length;

  return (
    <div className="hearings-page">
      <SiteHeader
        crumb="Budget Briefing/Hearings"
        compiledMeta={`${withTranscripts} transcripts`}
      />
      <main className="hearings-main">
        <header className="hearings-intro">
          <p className="hearings-eyebrow">House of Representatives · Committee on Appropriations</p>
          <h1>Budget Briefing / Hearings</h1>
          <p className="hearings-sub">
            Every FY 2027 budget briefing and hearing streamed by the House of
            Representatives, with full transcripts, summaries, and highlights.
            Click any point in a transcript to jump straight to that moment in
            the video.
          </p>
        </header>

        <div className="hearings-controls">
          <input
            type="search"
            className="hearings-search"
            placeholder="Search hearings…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search hearings"
          />
          <select
            className="hearings-agency-select"
            value={agency}
            onChange={(e) => setAgency(e.target.value)}
            aria-label="Filter by agency"
          >
            <option value="">All agencies</option>
            {agencies.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="hearings-error">Could not load hearings: {error}</p>
        )}
        {!hearings && !error && <p className="hearings-loading">Loading hearings…</p>}
        {hearings && visible.length === 0 && (
          <p className="hearings-loading">No hearings match.</p>
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
                {h.has_summary ? (
                  <span className="hearing-has-summary">Summary + transcript →</span>
                ) : (
                  <span className="hearing-has-summary hearing-muted">Video →</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
