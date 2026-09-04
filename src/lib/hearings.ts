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
 * Group raw caption segments into cueable blocks (~45 s or ~700 chars, never
 * splitting mid-segment) so the transcript reads in paragraphs and each block
 * maps to one seek target.
 */
export function groupBlocks(segments: RawSegment[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let buf: RawSegment[] = [];
  const flush = () => {
    if (!buf.length) return;
    blocks.push({
      index: blocks.length,
      startMs: Number(buf[0].startMs),
      endMs: Number(buf[buf.length - 1].endMs),
      text: buf.map((s) => s.text.trim()).join(" ").replace(/\s+/g, " ").trim(),
    });
    buf = [];
  };
  for (const seg of segments) {
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
