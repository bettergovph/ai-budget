/**
 * Client layer for Budget Briefing/Hearings.
 *
 * The index comes from the Worker's D1 route (/api/hearings); the heavy
 * content (transcript segments, markdown summaries) is fetched straight from
 * the public R2 data host via dataUrl(), like every other dataset here.
 */

import { dataUrl } from "./data-url";

export interface Hearing {
  video_id: string;
  slug: string;
  title: string;
  agency: string | null;
  fiscal_year: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  length_text: string | null;
  view_count: number | null;
  url: string | null;
  r2_prefix: string | null;
  segment_count: number | null;
  text_chars: number | null;
  has_transcript: number;
  has_summary: number;
  has_highlights: number;
  has_brief: number;
  /** 1 when sections.json (timeline + topic index) exists in R2 */
  has_sections: number;
  /** "captions" | "whisper" | "nova3" | "hybrid" — how the transcript was made */
  transcript_source: string | null;
  summary_method: string | null;
  status: string;
  updated_at: string;
}

/* ---- analyst brief (extracted from the transcript, see brief.schema.json) -- */

export interface BriefFigure {
  entity: string;
  metric: string;
  type: string;
  amount?: number | null;
  amount_text: string;
  change_amount?: number | null;
  change_pct?: number | null;
  context?: string;
  speaker?: string | null;
  timestamp: string;
  seconds: number;
}

export interface BriefIssue {
  description: string;
  category: string;
  raised_by?: string | null;
  agency_response?: string | null;
  resolution?: string;
  timestamp: string;
  seconds: number;
}

export interface BriefAction {
  action: string;
  kind: string;
  who?: string | null;
  amount?: number | null;
  timestamp: string;
  seconds: number;
}

export interface HearingBrief {
  videoId: string;
  agency: string;
  fiscal_year: string;
  hearing_date: string;
  phase: string;
  headline?: string;
  topline?: {
    proposed_fy?: number | null;
    prior_gaa?: number | null;
    change_amount?: number | null;
    change_pct?: number | null;
    note?: string;
  };
  budget_figures: BriefFigure[];
  issues: BriefIssue[];
  committee_actions: BriefAction[];
}

export function fetchBrief(videoId: string): Promise<HearingBrief | null> {
  return fetchMarkdown(hearingAsset(videoId, "brief.json")).then(
    (text) => {
      if (!text) return null;
      try {
        return JSON.parse(text) as HearingBrief;
      } catch {
        return null;
      }
    },
  );
}

/* ---- sections: timeline + per-topic index (see sections.schema.json) ---- */

export type SectionKind =
  | "procedural"
  | "presentation"
  | "interpellation"
  | "motion"
  | "suspension"
  | "other";

export type TopicStatus =
  | "resolved"
  | "committed"
  | "parked"
  | "unresolved"
  | "informational";

export type SectionActionKind =
  | "document_request"
  | "commitment"
  | "motion"
  | "manifestation"
  | "ruling"
  | "other";

export interface HearingSpeaker {
  /** diarization label(s) (S0, S1…) when the transcript is diarized; else null */
  label: string | string[] | null;
  name: string;
  role: string;
  side: "committee" | "agency" | "executive" | "other";
  confidence: "high" | "medium" | "low";
}

export interface SectionExchange {
  asked_by?: string | null;
  question: string;
  answered_by?: string | null;
  answer?: string | null;
  outcome?: string | null;
  seconds: number;
  timestamp: string;
}

export interface SectionFigure {
  amount_text: string;
  amount?: number | null;
  what: string;
  speaker?: string | null;
  seconds: number;
  timestamp: string;
}

export interface SectionAction {
  action: string;
  kind: SectionActionKind;
  who?: string | null;
  seconds: number;
  timestamp: string;
}

/** One contiguous stretch of the proceedings. */
export interface HearingSection {
  index: number;
  start_seconds: number;
  end_seconds: number;
  start: string;
  end: string;
  kind: SectionKind;
  title: string;
  summary: string;
  participants: string[];
  topics: string[];
  exchanges: SectionExchange[];
  figures: SectionFigure[];
  actions: SectionAction[];
}

/** What transpired on one topic across the whole hearing. */
export interface HearingTopic {
  topic: string;
  summary: string;
  /** indices into HearingSections.sections */
  sections: number[];
  positions: { who: string; position: string }[];
  status: TopicStatus;
  seconds: number | null;
  timestamp: string | null;
}

export interface HearingSections {
  videoId: string;
  slug?: string;
  title?: string;
  agency: string;
  fiscal_year: string;
  hearing_date: string | null;
  duration_seconds?: number | null;
  generated_at?: string;
  model?: string;
  transcript_source?: "captions" | "whisper" | "nova3" | "hybrid";
  diarized?: boolean;
  overview: string;
  speakers: HearingSpeaker[];
  sections: HearingSection[];
  topics: HearingTopic[];
  extraction: {
    method: string;
    windows?: number;
    window_minutes?: number;
    backend?: string;
    usage?: Record<string, unknown>;
    confidence_note?: string;
  };
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * sections.json for a hearing; null when it doesn't exist (404) or doesn't
 * parse. Nested arrays are normalised so the UI can index them freely.
 */
export function fetchSections(
  videoId: string,
): Promise<HearingSections | null> {
  return fetchMarkdown(hearingAsset(videoId, "sections.json")).then((text) => {
    if (!text) return null;
    try {
      const doc = JSON.parse(text) as Partial<HearingSections>;
      if (!Array.isArray(doc.sections) || !Array.isArray(doc.topics)) {
        return null;
      }
      const sections = asArray<HearingSection>(doc.sections).map((s) => ({
        ...s,
        participants: asArray<string>(s.participants),
        topics: asArray<string>(s.topics),
        exchanges: asArray<SectionExchange>(s.exchanges),
        figures: asArray<SectionFigure>(s.figures),
        actions: asArray<SectionAction>(s.actions),
      }));
      const topics = asArray<HearingTopic>(doc.topics).map((t) => ({
        ...t,
        sections: asArray<number>(t.sections).filter(
          (i) => Number.isInteger(i) && i >= 0 && i < sections.length,
        ),
        positions: asArray<HearingTopic["positions"][number]>(t.positions),
      }));
      return {
        ...doc,
        overview: doc.overview ?? "",
        speakers: asArray<HearingSpeaker>(doc.speakers),
        sections,
        topics,
        extraction: doc.extraction ?? { method: "unknown" },
      } as HearingSections;
    } catch {
      return null;
    }
  });
}

/** Human label for HearingSections.transcript_source / Hearing.transcript_source. */
export function transcriptSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "captions":
      return "YouTube captions";
    case "whisper":
      return "Whisper transcript";
    case "nova3":
      return "Nova-3 transcript";
    case "hybrid":
      return "hybrid transcript";
    default:
      return source || "transcript";
  }
}

export function formatPeso(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}₱${(abs / 1e12).toFixed(abs % 1e12 ? 2 : 0)}T`;
  if (abs >= 1e9) return `${sign}₱${(abs / 1e9).toFixed(abs % 1e9 ? 2 : 0)}B`;
  if (abs >= 1e6) return `${sign}₱${(abs / 1e6).toFixed(abs % 1e6 ? 1 : 0)}M`;
  return `${sign}₱${abs.toLocaleString("en-PH")}`;
}

/** One clickable/cueable block of the interactive transcript. */
export interface TranscriptBlock {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  /** speaker_name when identified, else the raw diarization label (S0, S1…) */
  speaker?: string;
}

export async function fetchHearings(): Promise<Hearing[]> {
  const r = await fetch("/api/hearings?limit=500");
  if (!r.ok) throw new Error(`hearings API ${r.status}`);
  const body = (await r.json()) as { hearings: { data: Hearing[] } };
  return body.hearings.data;
}

export async function fetchHearing(videoId: string): Promise<Hearing | null> {
  const r = await fetch(`/api/hearings/${encodeURIComponent(videoId)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`hearings API ${r.status}`);
  return (await r.json()) as Hearing;
}

/** R2 asset URL for a hearing file, e.g. hearingAsset(id, "summary.md"). */
export function hearingAsset(videoId: string, file: string): string {
  return dataUrl(`hearings/${videoId}/${file}`);
}

interface RawSegment {
  text: string;
  startMs: string;
  endMs: string;
  startTimeText?: string;
  /** diarization label (S0, S1…) — only consistent within one `chunk` */
  speaker?: string | null;
  chunk?: number;
  /** name resolved for `speaker`, when the sections pass identified one */
  speaker_name?: string | null;
}

export interface TranscriptDoc {
  videoId: string;
  source?: string;
  segments: RawSegment[];
}

export async function fetchTranscript(
  videoId: string,
): Promise<TranscriptDoc | null> {
  const r = await fetch(hearingAsset(videoId, "transcript.json"));
  if (!r.ok) return null;
  return (await r.json()) as TranscriptDoc;
}

/** Try to fetch a markdown asset; null when it doesn't exist (404/204). */
export async function fetchMarkdown(url: string): Promise<string | null> {
  const r = await fetch(url);
  if (!r.ok) return null;
  const text = await r.text();
  return text.trim() ? text : null;
}

/**
 * Identity of a segment's speaker for grouping. Raw labels are only
 * consistent within a chunk, so the chunk is part of the key; any change of
 * name, chunk or label starts a new block.
 */
function speakerKey(s: RawSegment): string {
  return `${s.speaker_name ?? ""}|${s.chunk ?? ""}|${s.speaker ?? ""}`;
}

function speakerOf(s: RawSegment): string | undefined {
  const v = (s.speaker_name || s.speaker || "").trim();
  return v || undefined;
}

/**
 * Group raw caption segments into cueable blocks (~45 s or ~700 chars, never
 * splitting mid-segment, never merging across a change of speaker) so the
 * transcript reads in paragraphs and each block maps to one seek target.
 */
export function groupBlocks(segments: RawSegment[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let buf: RawSegment[] = [];
  let key = "";
  const flush = () => {
    if (!buf.length) return;
    const speaker = speakerOf(buf[0]);
    blocks.push({
      index: blocks.length,
      startMs: Number(buf[0].startMs),
      endMs: Number(buf[buf.length - 1].endMs),
      text: buf.map((s) => s.text.trim()).join(" ").replace(/\s+/g, " ").trim(),
      ...(speaker ? { speaker } : {}),
    });
    buf = [];
  };
  for (const seg of segments) {
    const k = speakerKey(seg);
    if (buf.length && k !== key) flush();
    if (!buf.length) key = k;
    buf.push(seg);
    const span = Number(seg.endMs) - Number(buf[0].startMs);
    const chars = buf.reduce((n, s) => n + s.text.length, 0);
    if (span >= 45_000 || chars >= 700) flush();
  }
  flush();
  return blocks;
}

/** 4923123 → "1:22:03"; 65_000 → "1:05". */
export function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "Date unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
