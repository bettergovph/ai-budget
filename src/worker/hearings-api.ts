/**
 * Budget hearings — public API data functions (v1) and MCP tool backends.
 *
 * Source of truth: the `hearings` table (index, one row per YouTube stream)
 * and `hearing_topics` (one row per deliberation topic, produced by
 * transcriptions/record.py and upserted by sync_to_site.py). Heavy per-hearing
 * documents (sections.json = timeline, transcript.json) live in R2 and are
 * fetched from the public data host on demand, edge-cached.
 *
 * Every timestamped item carries `seconds` and a `url` that opens the hearing
 * page at that moment (`/hearings/<id>?t=<seconds>`), so an answer built from
 * these records is always one click from the video that proves it.
 */

import { ApiError } from "./public-api";

/** Public R2 host the browser also reads from. */
const DATA_HOST = "https://budget-assets.bettergov.ph";
const SITE = "https://budget.bettergov.ph";
const YOUTUBE = "https://www.youtube.com/watch?v=";

export const HEARING_STATUSES = ["resolved", "committed", "parked", "unresolved", "informational"] as const;

interface HearingRow {
  video_id: string;
  slug: string;
  title: string;
  agency: string | null;
  fiscal_year: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  length_text: string | null;
  url: string | null;
  has_transcript: number;
  has_brief: number;
  has_sections: number;
  transcript_source: string | null;
  record_method: string | null;
  topic_count: number | null;
  status: string;
  updated_at: string;
}

interface TopicRow {
  video_id: string;
  idx: number;
  topic: string;
  status: string | null;
  summary: string | null;
  question: string | null;
  agency_position: string | null;
  outcome: string | null;
  first_seconds: number | null;
  timestamp: string | null;
  sections: string | null;
  positions: string | null;
  figures: string | null;
  actions: string | null;
  thread: string | null;
  moment_count: number;
}

const HEARING_COLS = `video_id, slug, title, agency, fiscal_year, published_at, duration_seconds,
  length_text, url, has_transcript, has_brief, has_sections, transcript_source, record_method,
  topic_count, status, updated_at`;

const TOPIC_COLS = `video_id, idx, topic, status, summary, question, agency_position, outcome,
  first_seconds, timestamp, sections, positions, figures, actions, thread, moment_count`;

const META = { dataset: "hearings", currency: "PHP", scale: "pesos" } as const;

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function momentUrl(videoId: string, seconds: number | null | undefined): string {
  return seconds == null ? `${SITE}/hearings/${videoId}` : `${SITE}/hearings/${videoId}?t=${seconds}`;
}

function publicHearing(r: HearingRow) {
  const id = r.video_id;
  return {
    video_id: id,
    title: r.title,
    agency: r.agency,
    fiscal_year: r.fiscal_year,
    hearing_date: r.published_at,
    duration_seconds: r.duration_seconds,
    length_text: r.length_text,
    youtube_url: r.url ?? `${YOUTUBE}${id}`,
    page_url: `${SITE}/hearings/${id}`,
    has_transcript: !!r.has_transcript,
    transcript_source: r.transcript_source,
    has_record: !!r.has_sections,
    record_method: r.record_method,
    topic_count: r.topic_count,
    has_brief: !!r.has_brief,
    status: r.status,
    updated_at: r.updated_at,
    links: {
      self: `/api/v1/hearings/${id}`,
      topics: `/api/v1/hearings/${id}/topics`,
      timeline: `/api/v1/hearings/${id}/timeline`,
      transcript: `/api/v1/hearings/${id}/transcript`,
      sections_json: `${DATA_HOST}/hearings/${id}/sections.json`,
      transcript_json: `${DATA_HOST}/hearings/${id}/transcript.json`,
    },
  };
}

interface Moment {
  seconds: number;
  timestamp: string;
  speaker: string | null;
  side: string;
  kind: string;
  said: string;
}

function publicTopic(r: TopicRow, opts: { thread: boolean }) {
  const id = r.video_id;
  const withUrl = <T extends { seconds?: number | null }>(x: T) => ({ ...x, url: momentUrl(id, x.seconds) });
  const base = {
    video_id: id,
    index: r.idx,
    topic: r.topic,
    status: r.status,
    summary: r.summary,
    question: r.question,
    agency_position: r.agency_position,
    outcome: r.outcome,
    first_seconds: r.first_seconds,
    timestamp: r.timestamp,
    url: momentUrl(id, r.first_seconds),
    timeline_sections: parseJson<number[]>(r.sections, []),
    positions: parseJson<Array<{ who: string; position: string }>>(r.positions, []),
    figures: parseJson<Array<Record<string, unknown> & { seconds?: number }>>(r.figures, []).map(withUrl),
    actions: parseJson<Array<Record<string, unknown> & { seconds?: number }>>(r.actions, []).map(withUrl),
    moment_count: r.moment_count,
  };
  if (!opts.thread) return base;
  return { ...base, thread: parseJson<Moment[]>(r.thread, []).map(withUrl) };
}

async function hearingRow(env: Env, videoId: string): Promise<HearingRow> {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new ApiError(400, "bad_request", "video_id must be a YouTube video id");
  }
  const row = await env.DB.prepare(`SELECT ${HEARING_COLS} FROM hearings WHERE video_id = ?1`)
    .bind(videoId)
    .first<HearingRow>();
  if (!row) throw new ApiError(404, "not_found", `No hearing with video_id ${videoId}`);
  return row;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// list / get

export interface HearingsListOpts {
  fiscal_year?: string;
  agency?: string;
  status?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export async function hearingsList(env: Env, opts: HearingsListOpts = {}) {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.fiscal_year) {
    where.push(`fiscal_year = ?${binds.length + 1}`);
    binds.push(opts.fiscal_year);
  }
  if (opts.agency) {
    where.push(`upper(agency) = ?${binds.length + 1}`);
    binds.push(opts.agency.toUpperCase());
  }
  if (opts.status) {
    where.push(`status = ?${binds.length + 1}`);
    binds.push(opts.status);
  }
  if (opts.query) {
    where.push(`(title LIKE ?${binds.length + 1} ESCAPE '\\' OR agency LIKE ?${binds.length + 1} ESCAPE '\\')`);
    binds.push(`%${escapeLike(opts.query)}%`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const { results } = await env.DB.prepare(
    `SELECT ${HEARING_COLS} FROM hearings ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY published_at DESC, video_id LIMIT ${limit} OFFSET ${offset}`,
  )
    .bind(...binds)
    .all<HearingRow>();
  const rows = results ?? [];
  return {
    meta: {
      ...META,
      filters: { fiscal_year: opts.fiscal_year ?? null, agency: opts.agency ?? null, status: opts.status ?? null, q: opts.query ?? null },
      limit,
      offset,
      returned: rows.length,
      note: "One row per House Committee on Appropriations budget hearing stream. has_record = a per-topic deliberation record exists (see /topics).",
    },
    data: rows.map(publicHearing),
  };
}

export async function hearingGet(env: Env, videoId: string) {
  const row = await hearingRow(env, videoId);
  const { results } = await env.DB.prepare(
    `SELECT ${TOPIC_COLS} FROM hearing_topics WHERE video_id = ?1 ORDER BY idx`,
  )
    .bind(videoId)
    .all<TopicRow>();
  const topics = (results ?? []).map((t) => {
    const p = publicTopic(t, { thread: false });
    return { index: p.index, topic: p.topic, status: p.status, timestamp: p.timestamp, first_seconds: p.first_seconds, url: p.url, summary: p.summary, outcome: p.outcome, moment_count: p.moment_count };
  });
  return {
    meta: { ...META, note: "Topic list is the index; GET /topics for the full deliberation record of each." },
    data: { ...publicHearing(row), topics },
  };
}

// ---------------------------------------------------------------------------
// topics

export async function hearingTopics(env: Env, videoId: string, opts: { thread?: boolean } = {}) {
  const row = await hearingRow(env, videoId);
  const { results } = await env.DB.prepare(
    `SELECT ${TOPIC_COLS} FROM hearing_topics WHERE video_id = ?1 ORDER BY idx`,
  )
    .bind(videoId)
    .all<TopicRow>();
  const thread = opts.thread ?? true;
  return {
    meta: {
      ...META,
      video_id: videoId,
      title: row.title,
      agency: row.agency,
      hearing_date: row.published_at,
      topics: results?.length ?? 0,
      thread_included: thread,
      note: "Each topic is a deliberation record built from the transcript: the question at issue, the chronological thread of who said what (with timestamps and deep links), the agency's position, members' positions, figures as spoken, actions, and where it landed. Figures are as spoken in the hearing; `amount` is a best-effort peso parse and may be null.",
    },
    data: (results ?? []).map((t) => publicTopic(t, { thread })),
  };
}

export async function hearingTopic(env: Env, videoId: string, index: number) {
  await hearingRow(env, videoId);
  const t = await env.DB.prepare(
    `SELECT ${TOPIC_COLS} FROM hearing_topics WHERE video_id = ?1 AND idx = ?2`,
  )
    .bind(videoId, index)
    .first<TopicRow>();
  if (!t) throw new ApiError(404, "not_found", `Hearing ${videoId} has no topic ${index}`);
  return { meta: { ...META, video_id: videoId }, data: publicTopic(t, { thread: true }) };
}

// ---------------------------------------------------------------------------
// search across hearings

export interface HearingsSearchOpts {
  query: string;
  fiscal_year?: string;
  agency?: string;
  status?: string;
  limit?: number;
}

export async function hearingsSearch(env: Env, opts: HearingsSearchOpts) {
  const q = (opts.query ?? "").trim();
  if (q.length < 2) throw new ApiError(400, "bad_request", "q must be at least 2 characters");
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 6);
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const term of terms) {
    where.push(`t.search_text LIKE ?${binds.length + 1} ESCAPE '\\'`);
    binds.push(`%${escapeLike(term)}%`);
  }
  if (opts.fiscal_year) {
    where.push(`h.fiscal_year = ?${binds.length + 1}`);
    binds.push(opts.fiscal_year);
  }
  if (opts.agency) {
    where.push(`upper(h.agency) = ?${binds.length + 1}`);
    binds.push(opts.agency.toUpperCase());
  }
  if (opts.status) {
    where.push(`t.status = ?${binds.length + 1}`);
    binds.push(opts.status);
  }
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const { results } = await env.DB.prepare(
    `SELECT ${TOPIC_COLS.replace(/\b(video_id|idx|topic|status|summary|question|agency_position|outcome|first_seconds|timestamp|sections|positions|figures|actions|thread|moment_count)\b/g, "t.$1")},
            h.title AS h_title, h.agency AS h_agency, h.published_at AS h_date, h.fiscal_year AS h_fy
     FROM hearing_topics t JOIN hearings h ON h.video_id = t.video_id
     WHERE ${where.join(" AND ")}
     ORDER BY h.published_at DESC, t.idx LIMIT ${limit}`,
  )
    .bind(...binds)
    .all<TopicRow & { h_title: string; h_agency: string | null; h_date: string | null; h_fy: string | null }>();

  const data = (results ?? []).map((r) => {
    const thread = parseJson<Moment[]>(r.thread, []);
    // the moments that mention the query terms — the evidence, with deep links
    const hits = thread
      .filter((m) => {
        const s = `${m.said} ${m.speaker ?? ""}`.toLowerCase();
        return terms.some((t) => s.includes(t));
      })
      .slice(0, 4)
      .map((m) => ({ ...m, url: momentUrl(r.video_id, m.seconds) }));
    const p = publicTopic(r, { thread: false });
    return {
      hearing: { video_id: r.video_id, title: r.h_title, agency: r.h_agency, hearing_date: r.h_date, fiscal_year: r.h_fy, page_url: `${SITE}/hearings/${r.video_id}` },
      topic: p,
      matching_moments: hits,
    };
  });
  return {
    meta: {
      ...META,
      q,
      terms,
      filters: { fiscal_year: opts.fiscal_year ?? null, agency: opts.agency ?? null, status: opts.status ?? null },
      limit,
      returned: data.length,
      note: "Matches deliberation topics whose record (topic, summary, question, outcome, or any spoken moment) contains every term. matching_moments are the timestamped lines that mention the terms.",
    },
    data,
  };
}

// ---------------------------------------------------------------------------
// R2-backed documents: timeline (sections.json) and transcript (transcript.json)

async function fetchDoc<T>(videoId: string, file: string): Promise<T | null> {
  const res = await fetch(`${DATA_HOST}/hearings/${videoId}/${file}`, {
    cf: { cacheEverything: true, cacheTtl: 3600 },
  } as RequestInit);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(502, "upstream_failed", `Could not fetch ${file} for ${videoId} (${res.status})`);
  return (await res.json()) as T;
}

interface SectionsDoc {
  overview?: string;
  speakers?: unknown[];
  sections?: Array<Record<string, unknown> & { start_seconds?: number; exchanges?: Array<Record<string, unknown> & { seconds?: number }>; figures?: Array<Record<string, unknown> & { seconds?: number }>; actions?: Array<Record<string, unknown> & { seconds?: number }> }>;
  extraction?: Record<string, unknown>;
  generated_at?: string;
  model?: string;
  transcript_source?: string;
  diarized?: boolean;
}

export async function hearingTimeline(env: Env, videoId: string) {
  const row = await hearingRow(env, videoId);
  const doc = await fetchDoc<SectionsDoc>(videoId, "sections.json");
  if (!doc) throw new ApiError(404, "not_found", `Hearing ${videoId} has no record yet`);
  const withUrl = <T extends { seconds?: number }>(x: T) => ({ ...x, url: momentUrl(videoId, x.seconds) });
  const sections = (doc.sections ?? []).map((s) => ({
    ...s,
    url: momentUrl(videoId, s.start_seconds),
    exchanges: (s.exchanges ?? []).map(withUrl),
    figures: (s.figures ?? []).map(withUrl),
    actions: (s.actions ?? []).map(withUrl),
  }));
  return {
    meta: {
      ...META,
      video_id: videoId,
      title: row.title,
      agency: row.agency,
      hearing_date: row.published_at,
      sections: sections.length,
      generated_at: doc.generated_at ?? null,
      model: doc.model ?? null,
      transcript_source: doc.transcript_source ?? row.transcript_source,
      diarized: doc.diarized ?? null,
      confidence_note: (doc.extraction ?? {}).confidence_note ?? null,
      note: "Contiguous sections of the proceedings in order (roll call, presentation, each interpellation, motions, suspensions), each with its exchanges, figures, and actions, timestamped and deep-linked.",
    },
    data: { overview: doc.overview ?? "", speakers: doc.speakers ?? [], sections },
  };
}

interface TranscriptDoc {
  source?: string;
  diarized?: boolean;
  segments?: Array<{ text: string; startMs: string | number; endMs: string | number; speaker?: string; speaker_name?: string }>;
}

export interface TranscriptOpts {
  from?: number;
  to?: number;
  limit?: number;
}

export async function hearingTranscript(env: Env, videoId: string, opts: TranscriptOpts = {}) {
  const row = await hearingRow(env, videoId);
  const doc = await fetchDoc<TranscriptDoc>(videoId, "transcript.json");
  if (!doc || !doc.segments?.length) throw new ApiError(404, "not_found", `Hearing ${videoId} has no transcript`);
  const from = Math.max(opts.from ?? 0, 0);
  const to = opts.to ?? from + 20 * 60;
  const limit = Math.min(Math.max(opts.limit ?? 300, 1), 1000);
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const out: Array<{ seconds: number; timestamp: string; speaker: string | null; text: string; url: string }> = [];
  let truncated = false;
  for (const seg of doc.segments) {
    const s = Math.floor(Number(seg.startMs) / 1000);
    if (s < from) continue;
    if (s > to) break;
    if (out.length >= limit) {
      truncated = true;
      break;
    }
    out.push({ seconds: s, timestamp: fmt(s), speaker: seg.speaker_name ?? seg.speaker ?? null, text: seg.text, url: momentUrl(videoId, s) });
  }
  return {
    meta: {
      ...META,
      video_id: videoId,
      title: row.title,
      agency: row.agency,
      from_seconds: from,
      to_seconds: to,
      returned: out.length,
      truncated,
      transcript_source: doc.source ?? row.transcript_source,
      diarized: !!doc.diarized,
      note: "Machine transcript segments in the requested window (default 20 minutes from `from`). Speaker is the inferred name when known, else the diarization label. Verify against the video via `url`.",
    },
    data: out,
  };
}
