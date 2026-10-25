/**
 * Budget Briefing/Hearings API.
 *
 * The `hearings` table is the index; heavy content (transcript.json,
 * summary.md, highlights.md, brief.json, sections.json) lives in R2 under
 * the row's `r2_prefix` and is fetched by the browser straight from the
 * public data host
 * (budget-assets.bettergov.ph) — same split as the GAA/NEP data.
 *
 *   GET /api/hearings                 list, newest first
 *     ?fy=2027        fiscal year filter
 *     ?agency=DOH     agency filter
 *     ?status=ok      ok | no_captions
 *     ?limit=…&offset=…
 *   GET /api/hearings/:videoId        single row
 */

interface HearingRow {
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
  has_sections: number;
  transcript_source: string | null;
  summary_method: string | null;
  status: string;
  updated_at: string;
}

const LIST_COLUMNS = `video_id, slug, title, agency, fiscal_year, published_at,
  duration_seconds, length_text, view_count, url, r2_prefix, segment_count,
  text_chars, has_transcript, has_summary, has_highlights, has_brief,
  has_sections, transcript_source, summary_method, status, updated_at`;

export async function handleHearings(
  _request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const videoId = /^\/api\/hearings\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (videoId) {
    const { results } = await env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM hearings WHERE video_id = ?1`,
    )
      .bind(videoId)
      .all<HearingRow>();
    if (!results?.length) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json(results[0], {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=3600" },
    });
  }

  const where: string[] = [];
  const binds: unknown[] = [];
  const fy = url.searchParams.get("fy");
  if (fy) {
    where.push(`fiscal_year = ?${binds.length + 1}`);
    binds.push(fy);
  }
  const agency = url.searchParams.get("agency");
  if (agency) {
    where.push(`agency = ?${binds.length + 1}`);
    binds.push(agency.toUpperCase());
  }
  const status = url.searchParams.get("status");
  if (status) {
    where.push(`status = ?${binds.length + 1}`);
    binds.push(status);
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  binds.push(limit, offset);

  const sql = `SELECT ${LIST_COLUMNS} FROM hearings
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY published_at DESC, video_id
    LIMIT ?${binds.length - 1} OFFSET ?${binds.length}`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all<HearingRow>();

  return Response.json(
    {
      hearings: {
        metadata: {
          table: "hearings",
          total_items: results?.length ?? 0,
          filters: { fy, agency, status },
        },
        data: results ?? [],
      },
    },
    {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=3600" },
    },
  );
}
