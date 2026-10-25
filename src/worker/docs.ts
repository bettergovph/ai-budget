/**
 * /docs — self-contained HTML documentation for the public API and MCP server.
 *
 * Rendered server-side with the request origin injected so every example is
 * copy-pasteable against the host it was read from. No external assets, no
 * JS framework — the page must work even when the SPA bundle doesn't.
 */

export function docsHtml(origin: string): string {
  const O = origin;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Philippine Budget Data API — Documentation</title>
<meta name="description" content="Public REST API and MCP server for Philippine GAA (FY2020–2026), NEP FY2027, the FY2027 House bill, and the House budget hearings.">
<style>
  :root {
    --bg: #ffffff; --fg: #1a1d21; --muted: #5b6470; --line: #e4e7eb;
    --accent: #0b5cad; --code-bg: #f4f6f8; --side-bg: #fafbfc;
    --badge-get: #0b7a3e; --badge-post: #8a4b08; --warn-bg: #fff8e6; --warn-line: #e8c76a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #101318; --fg: #e6e9ed; --muted: #9aa4b0; --line: #262c34;
      --accent: #6ab0f3; --code-bg: #191f27; --side-bg: #14181e;
      --badge-get: #4cc27d; --badge-post: #e0a35c; --warn-bg: #2a2413; --warn-line: #6b5a1e;
    }
  }
  * { box-sizing: border-box; }
  :root { --topbar-h: 52px; }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .topbar { position: sticky; top: 0; z-index: 10; height: var(--topbar-h); background: var(--bg); border-bottom: 1px solid var(--line); }
  .topbar-inner { max-width: 1180px; margin: 0 auto; height: 100%; display: flex; align-items: center; gap: 18px; padding: 0 20px; }
  .topbar .brand-link { display: flex; align-items: center; gap: 10px; color: var(--fg); font-weight: 700; font-size: 15px; white-space: nowrap; }
  .topbar .brand-link:hover { text-decoration: none; color: var(--accent); }
  .topbar .brand-link img { height: 22px; display: block; }
  .topbar .brand-sep { color: var(--line); }
  .topbar .brand-sub { color: var(--muted); font-weight: 400; font-size: 14px; }
  .topbar .spacer { flex: 1; }
  .topbar .tlink { color: var(--muted); font-size: 14px; white-space: nowrap; }
  .topbar .tlink:hover { color: var(--accent); text-decoration: none; }
  .topbar .tlink.active { color: var(--fg); font-weight: 600; }
  .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); max-width: 1180px; margin: 0 auto; }
  nav { position: sticky; top: var(--topbar-h); align-self: start; height: calc(100vh - var(--topbar-h)); overflow-y: auto; padding: 24px 16px; border-right: 1px solid var(--line); background: var(--side-bg); font-size: 14px; }
  html { scroll-padding-top: calc(var(--topbar-h) + 8px); }
  nav .brand { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  nav .sub { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
  nav h4 { margin: 16px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  nav a { display: block; padding: 3px 0; color: var(--fg); }
  nav a:hover { color: var(--accent); text-decoration: none; }
  main { padding: 32px 40px 96px; min-width: 0; }
  h1 { font-size: 30px; margin: 0 0 4px; }
  h2 { font-size: 22px; margin: 48px 0 12px; padding-top: 16px; border-top: 1px solid var(--line); }
  h3 { font-size: 17px; margin: 32px 0 8px; }
  h4 { font-size: 14px; margin: 20px 0 6px; }
  p, ul, ol { max-width: 76ch; }
  .lead { color: var(--muted); font-size: 17px; margin-bottom: 24px; }
  code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code-bg); padding: 2px 5px; border-radius: 4px; }
  pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; overflow-x: auto; max-width: 860px; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; max-width: 860px; margin: 12px 0; font-size: 14px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  td code { white-space: nowrap; }
  .ep { margin: 28px 0 8px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .ep .method { font: 700 12px/1 ui-monospace, monospace; color: #fff; background: var(--badge-get); padding: 4px 8px; border-radius: 5px; }
  .ep .method.post { background: var(--badge-post); }
  .ep code { font-size: 15px; background: none; padding: 0; }
  .note { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 8px; padding: 12px 16px; max-width: 828px; margin: 16px 0; }
  .pill-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0 8px; }
  .pill { border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; font-size: 13px; color: var(--muted); }
  @media (prefers-color-scheme: dark) {
    .topbar .brand-link img { filter: brightness(0) invert(1); }
  }
  @media (max-width: 860px) {
    .layout { grid-template-columns: 1fr; }
    nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
    main { padding: 24px 20px 80px; }
  }
  @media (max-width: 700px) {
    .topbar .brand-sub, .topbar .brand-sep, .topbar .thide { display: none; }
    .topbar-inner { gap: 14px; padding: 0 16px; }
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand-link" href="/">
      <img src="https://assets.bettergov.ph/logos/png/horizontal-primary.png" alt="BetterGov.ph">
      <span class="brand-sep">|</span>
      <span class="brand-sub">Budget Data API</span>
    </a>
    <span class="spacer"></span>
    <a class="tlink" href="/2027">NEP 2027</a>
    <a class="tlink" href="/gaa">GAA 2020–2026</a>
    <a class="tlink active" href="/docs">API docs</a>
    <a class="tlink thide" href="/api/v1/openapi.json">OpenAPI</a>
    <a class="tlink thide" href="#mcp">MCP</a>
  </div>
</header>
<div class="layout">
<nav>
  <div class="brand">PH Budget Data API</div>
  <div class="sub">v1 · REST + MCP</div>
  <h4>Getting started</h4>
  <a href="#overview">Overview</a>
  <a href="#datasets">Datasets &amp; units</a>
  <a href="#conventions">Conventions</a>
  <a href="#pagination">Pagination</a>
  <a href="#errors">Errors</a>
  <h4>GAA FY2020–2026</h4>
  <a href="#gaa-national">National totals</a>
  <a href="#gaa-departments">Departments</a>
  <a href="#gaa-department">Department detail</a>
  <a href="#gaa-expense-classes">Expense classes</a>
  <a href="#gaa-programs">Programs</a>
  <a href="#gaa-objects">Line items</a>
  <a href="#gaa-search">Search</a>
  <h4>NEP FY2027</h4>
  <a href="#nep-overview">National overview</a>
  <a href="#nep-departments">Departments</a>
  <a href="#nep-department">Department detail</a>
  <a href="#nep-dept-rollup">Department rollups</a>
  <a href="#nep-rollup">National rollups</a>
  <h4>Budget cycle</h4>
  <a href="#cycle-overview">Coverage</a>
  <a href="#cycle-department">Department facts</a>
  <h4>Budget hearings</h4>
  <a href="#hearings-list">List hearings</a>
  <a href="#hearings-search">Search what was said</a>
  <a href="#hearings-topics">Deliberation record by topic</a>
  <a href="#hearings-timeline">Timeline &amp; transcript</a>
  <h4>House bill FY2027 (HGAB)</h4>
  <a href="#hgab-rules">Rules &amp; terms</a>
  <a href="#hgab-overview">Overview</a>
  <a href="#hgab-datasets">Programs</a>
  <a href="#hgab-projects">Project rows</a>
  <a href="#hgab-project">One project row</a>
  <a href="#hgab-regions">Regions</a>
  <a href="#hgab-documents">Documents &amp; checks</a>
  <a href="#hgab-districts">Districts</a>
  <h4>Machine access</h4>
  <a href="#openapi">OpenAPI spec</a>
  <a href="#mcp">MCP server</a>
  <a href="#mcp-install">— install in AI clients</a>
  <a href="#mcp-examples">— example prompts</a>
</nav>
<main>

<h1 id="overview">Philippine Budget Data API</h1>
<p class="lead">A free, public, read-only API over Philippine national budget data — the enacted
General Appropriations Act (FY2020–2026), the FY2027 National Expenditure Program,
budget-cycle execution data, the House budget hearings (what was actually said, topic by
topic, with timestamps), and the FY2027 House bill set against the President's proposal project by
project. Also available as an <a href="#mcp">MCP server</a> for AI agents.</p>

<div class="pill-row">
  <span class="pill">Base URL <code>${O}/api/v1</code></span>
  <span class="pill">No auth required</span>
  <span class="pill">CORS: open (<code>*</code>)</span>
  <span class="pill">All amounts in exact ₱ pesos</span>
</div>

<pre><code>curl ${O}/api/v1/gaa/departments
curl "${O}/api/v1/gaa/search?q=school%20building"
curl ${O}/api/v1/nep/2027</code></pre>

<p>The API is free for public use under fair-use conditions. Responses are cached at the edge
(<code>Cache-Control: public, max-age=300, s-maxage=3600</code>); data updates at most a few times a year,
so aggressive client-side caching is encouraged. Please identify heavy automated use with a
descriptive <code>User-Agent</code>.</p>

<h2 id="datasets">Datasets &amp; units</h2>
<table>
  <tr><th>Dataset</th><th>Coverage</th><th>What it is</th></tr>
  <tr><td><code>gaa</code></td><td>FY2020–2026, 38 departments</td>
      <td>The <b>enacted</b> General Appropriations Act, down to UACS object-level line items (~2M rows).
      Hierarchy: department → agency → program (P/A/P) → operating unit → fund → expense class → object.</td></tr>
  <tr><td><code>nep/2027</code></td><td>FY2027, 39 departments</td>
      <td>The Executive's <b>proposed</b> ₱7.20&nbsp;T National Expenditure Program. Every figure carries
      <code>amount</code> (FY2027 proposal), <code>base_amount</code> (FY2026 GAA baseline), <code>delta</code>, and <code>pct</code>.</td></tr>
  <tr><td><code>budget-cycle</code></td><td>FY2018–2026, selected departments</td>
      <td>How appropriations moved through the cycle: NEP → GAA → authorized/adjusted appropriation →
      adjusted allotment → obligations → disbursements, per program × year × stage × expense class.</td></tr>
  <tr><td><code>hearings</code></td><td>FY2027 season, House Committee on Appropriations</td>
      <td>The budget <b>deliberations</b>: for each hearing (2–9 hours of video), a per-topic record of what
      transpired — the question at issue, who said what and when, the agency's answer, figures as spoken,
      commitments, and where it landed — plus a section-by-section timeline and the transcript. Every item
      is timestamped and deep-linked to the video.</td></tr>
  <tr><td><code>hgab/2027</code></td><td>FY2027, four programs, plus DPWH by district</td>
      <td>The House of Representatives' version of the FY2027 budget (<b>House Bill 10858</b>) set against
      the President's proposal (NEP), line by line, for the four programs where the bill lists projects:
      DPWH infrastructure, farm-to-market roads, health facilities and irrigation. Also DPWH money by
      district engineering office, with the congressional districts each office serves.</td></tr>
</table>

<p><b>Units.</b> Every amount anywhere in this API is an <b>exact Philippine peso</b> figure.
Each response's <code>meta</code> restates this (<code>"currency": "PHP", "scale": "pesos"</code>). The upstream
source publishes GAA figures in thousands; this API rescales them so you never have to.</p>

<p><b>Department ids.</b> GAA ids are two digits (<code>07</code> = Department of Education,
<code>18</code> = Public Works). The NEP FY2027 dataset uses the same two-digit ids <i>plus</i> two
synthetic departments carved out for correctness: <code>SPF</code> (special purpose funds) and
<code>AUTO</code> (automatic appropriations).</p>

<div class="note"><b>Caveats worth knowing.</b>
(1)&nbsp;<code>AUTO</code> is a synthetic NEP department — it is not GAA department <code>04</code>.
(2)&nbsp;Budget-cycle figures cover <i>Current New Appropriations only</i>, a narrower scope than the
main GAA series — never compare the two 1:1.
(3)&nbsp;GAA and NEP are different stages of the budget process: NEP is the proposal, GAA is the law.
(4)&nbsp;In NEP rollups, <code>__unassigned__</code> buckets rows the source didn't tag with that dimension,
and <code>__other__</code> is an explicit remainder row on capped lists — both exist so lists always
sum to the true total.</div>

<h2 id="conventions">Conventions</h2>
<p>Every endpoint is <code>GET</code> and returns JSON in a common envelope:</p>
<pre><code>{
  "meta": { "dataset": "gaa", "currency": "PHP", "scale": "pesos", ... },
  "data": [ ... ] | { ... },
  "next_cursor": "..." | null        // paginated lists only
}</code></pre>
<p>GAA rows carry per-year figures as a nested map — every year key is always present
(zeroed if the source has no row for that year):</p>
<pre><code>"years": { "2020": { "count": 12, "amount": 4491000 }, ..., "2026": { "count": 15, "amount": 5120000 } }</code></pre>
<p>Filtered list endpoints also report whole-result-set totals in <code>meta.matched</code> /
<code>meta.matched_amount</code>, so a single request answers "how many and how much in total?"
without fetching every page.</p>

<h2 id="pagination">Pagination</h2>
<p>Large lists use opaque keyset cursors. Take <code>next_cursor</code> from a response and pass it back
as <code>cursor</code>; when it is <code>null</code>, the list is exhausted. Cursors are tied to the exact filter
combination that produced them — changing any filter invalidates the cursor (you'll get
<code>400 bad_cursor</code> or wrong pages). The GAA and NEP lists have no page-number or offset
pagination; cursor performance does not degrade with depth.</p>
<p>The hearings and House bill (HGAB) lists are smaller and use <code>limit</code> / <code>offset</code>
instead. HGAB lists also return <code>total</code> (rows matched) and <code>next_offset</code>
(<code>null</code> on the last page).</p>

<h2 id="errors">Errors</h2>
<p>Errors are JSON with a machine-readable slug and a human-readable message:</p>
<pre><code>{ "error": "not_found", "message": "No GAA department 99" }</code></pre>
<table>
  <tr><th>Status</th><th>Slug</th><th>Meaning</th></tr>
  <tr><td>400</td><td><code>bad_request</code></td><td>Invalid parameter (year out of range, malformed id, …)</td></tr>
  <tr><td>400</td><td><code>bad_cursor</code></td><td>The cursor was not issued by this API (or filters changed)</td></tr>
  <tr><td>404</td><td><code>not_found</code></td><td>Unknown department / endpoint</td></tr>
  <tr><td>405</td><td><code>method_not_allowed</code></td><td>The API is read-only — use GET</td></tr>
  <tr><td>503</td><td><code>not_loaded</code></td><td>The dataset is not loaded on this deployment</td></tr>
  <tr><td>500</td><td><code>query_failed</code></td><td>Unexpected database error</td></tr>
</table>

<h2>GAA — General Appropriations Act, FY2020–2026</h2>

<div class="ep" id="gaa-national"><span class="method">GET</span><code>/api/v1/gaa</code></div>
<p>National totals per fiscal year, summed across all departments.</p>
<pre><code>curl ${O}/api/v1/gaa</code></pre>
<pre><code>{
  "meta": { "dataset": "gaa", "years": [2020, ..., 2026], "currency": "PHP", "scale": "pesos", "departments": 38 },
  "data": [
    { "year": 2020, "line_items": 725178, "amount": 4100000000000 },
    ...
    { "year": 2026, "line_items": 810081, "amount": 6326000000000 }
  ]
}</code></pre>

<div class="ep" id="gaa-departments"><span class="method">GET</span><code>/api/v1/gaa/departments</code></div>
<p>All 38 departments with per-year appropriations and line-item counts, largest FY2026 budget
first. This is where you discover valid <code>{id}</code> values.</p>
<pre><code>curl ${O}/api/v1/gaa/departments</code></pre>

<div class="ep" id="gaa-department"><span class="method">GET</span><code>/api/v1/gaa/departments/{id}</code></div>
<p>One department in full: yearly totals, its agencies/bureaus (whose <code>id</code>s work as
<code>agency_id</code> filters elsewhere), and the expense-class breakdown.</p>
<pre><code>curl ${O}/api/v1/gaa/departments/07</code></pre>

<div class="ep" id="gaa-expense-classes"><span class="method">GET</span><code>/api/v1/gaa/departments/{id}/expense-classes</code></div>
<p>Personnel Services / MOOE / Financial Expenses / Capital Outlays totals per year.</p>
<table>
  <tr><th>Code</th><th>Class</th></tr>
  <tr><td><code>1</code></td><td>Personnel Services (PS)</td></tr>
  <tr><td><code>2</code></td><td>Maintenance and Other Operating Expenses (MOOE)</td></tr>
  <tr><td><code>3</code></td><td>Financial Expenses (FinEx)</td></tr>
  <tr><td><code>6</code></td><td>Capital Outlays (CO)</td></tr>
</table>

<div class="ep" id="gaa-programs"><span class="method">GET</span><code>/api/v1/gaa/departments/{id}/programs</code></div>
<p>Program/activity/project (P/A/P) families — raw P/A/P rows deduplicated by normalized name
within an agency — ranked by appropriation in the chosen year. Paginated.</p>
<table>
  <tr><th>Param</th><th>Type</th><th>Description</th></tr>
  <tr><td><code>year</code></td><td>2020–2026</td><td>Ranking year (default 2026)</td></tr>
  <tr><td><code>q</code></td><td>string</td><td>Substring filter on program name</td></tr>
  <tr><td><code>agency_id</code></td><td>string</td><td>Scope to one agency/bureau</td></tr>
  <tr><td><code>limit</code></td><td>1–500</td><td>Page size (default 100)</td></tr>
  <tr><td><code>cursor</code></td><td>string</td><td>From a previous <code>next_cursor</code></td></tr>
</table>
<pre><code>curl "${O}/api/v1/gaa/departments/07/programs?year=2026&amp;q=computerization&amp;limit=5"</code></pre>

<div class="ep" id="gaa-objects"><span class="method">GET</span><code>/api/v1/gaa/departments/{id}/objects</code></div>
<p>UACS object-level line items — the finest granularity in the GAA (DepEd alone has about a
million rows). Filter tightly and paginate. Rows with a zero amount in the chosen year are
hidden unless <code>include_zero=1</code>.</p>
<table>
  <tr><th>Param</th><th>Type</th><th>Description</th></tr>
  <tr><td><code>year</code></td><td>2020–2026</td><td>Filter/ranking year (default 2026)</td></tr>
  <tr><td><code>q</code></td><td>string</td><td>Substring filter on description or UACS code</td></tr>
  <tr><td><code>agency_id</code></td><td>string</td><td>Scope to one agency/bureau</td></tr>
  <tr><td><code>expense_class</code></td><td>1, 2, 3, 6</td><td>1=PS, 2=MOOE, 3=FinEx, 6=CO</td></tr>
  <tr><td><code>sort</code></td><td>amount | description | code | total</td><td><code>total</code> ranks by the 7-year sum (implies include_zero)</td></tr>
  <tr><td><code>dir</code></td><td>asc | desc</td><td>Defaults: desc for amounts, asc otherwise</td></tr>
  <tr><td><code>limit</code>, <code>cursor</code></td><td></td><td>Page size 1–500 (default 100); keyset cursor</td></tr>
</table>
<pre><code>curl "${O}/api/v1/gaa/departments/07/objects?year=2026&amp;q=textbooks&amp;limit=10"</code></pre>
<p>Note that free-text search here matches the <em>object-level</em> description (the UACS
expense object, e.g. "Textbooks and Instructional Materials"), not program names — search
programs with <a href="#gaa-search"><code>/gaa/search</code></a> instead.</p>

<div class="ep" id="gaa-search"><span class="method">GET</span><code>/api/v1/gaa/search</code></div>
<p>Search program names across <em>all</em> departments at once — the quickest route from a topic
("school building", "flood control", "irrigation") to who funds it and with how much.</p>
<table>
  <tr><th>Param</th><th>Type</th><th>Description</th></tr>
  <tr><td><code>q</code></td><td>string, required</td><td>Search text (min 2 chars)</td></tr>
  <tr><td><code>department_id</code></td><td>string</td><td>Optional two-digit scope</td></tr>
  <tr><td><code>year</code></td><td>2020–2026</td><td>Ranking year (default 2026)</td></tr>
  <tr><td><code>limit</code></td><td>1–100</td><td>Max results (default 25)</td></tr>
</table>
<pre><code>curl "${O}/api/v1/gaa/search?q=flood%20control&amp;year=2026&amp;limit=10"</code></pre>

<div class="ep" id="gaa-year"><span class="method">GET</span><code>/api/v1/gaa/years/{year}</code></div>
<p>One fiscal year in isolation: the national total plus every department's appropriation,
line-item count, and share of that year's budget, largest first. The per-year counterpart of
<a href="#gaa-departments"><code>/gaa/departments</code></a>, which returns all seven years per row.
This is the API face of the <a href="https://budget.bettergov.ph/gaa/2022">per-year budget
browser</a>.</p>
<pre><code>curl ${O}/api/v1/gaa/years/2022</code></pre>
<pre><code>{
  "meta": { "dataset": "gaa", "year": 2022, "departments": 37, ... },
  "data": {
    "total": { "year": 2022, "line_items": 628666, "amount": 5023600000000 },
    "departments": [
      { "id": "07", "slug": "department-of-education-deped", "description": "Department of Education (DepEd)",
        "year": 2022, "line_items": 308586, "amount": 633323678000, "share": 0.12607 },
      ...
    ]
  }
}</code></pre>

<div class="ep" id="gaa-year-children"><span class="method">GET</span><code>/api/v1/gaa/years/{year}/departments/{id}/children</code></div>
<p>Walk one department's hierarchy a level at a time, scoped to a single fiscal year — the same
drill the per-year browser does: department → agency (bureau) → program (FPAP) → operating unit
→ fund → expense class. Rows carry that year's figures only, ranked largest first, and keep
their parent-id columns so each row's <code>id</code> feeds the next level's <code>parent</code>.
Rows with a zero amount in that year are hidden unless <code>include_zero=1</code>.</p>
<table>
  <tr><th>Param</th><th>Type</th><th>Description</th></tr>
  <tr><td><code>level</code></td><td>agencies | fpaps | operating_units | fund_subcategories | expenses</td><td>Level to list (default <code>agencies</code>)</td></tr>
  <tr><td><code>parent</code></td><td>string</td><td>Parent entity id — required below <code>agencies</code></td></tr>
  <tr><td><code>include_zero</code></td><td>1</td><td>Keep rows the year doesn't fund</td></tr>
  <tr><td><code>limit</code>, <code>cursor</code></td><td></td><td>Page size 1–500 (default 100); keyset cursor</td></tr>
</table>
<pre><code># DepEd's bureaus in FY2022
curl "${O}/api/v1/gaa/years/2022/departments/07/children"

# then programs of one bureau...
curl "${O}/api/v1/gaa/years/2022/departments/07/children?level=fpaps&amp;parent=07-001"

# ...down to the expense classes of one fund
curl "${O}/api/v1/gaa/years/2022/departments/07/children?level=expenses&amp;parent=07-001-310400100002000-0807002-01101101"</code></pre>

<h2>NEP FY2027 — National Expenditure Program</h2>
<p>The Executive's ₱7.20&nbsp;T proposal for FY2027, measured line by line against the FY2026 GAA.
Every row carries <code>amount</code>, <code>base_amount</code>, <code>delta</code>, and <code>pct</code> (null when the FY2026
baseline is zero, i.e. a new item).</p>

<div class="ep" id="nep-overview"><span class="method">GET</span><code>/api/v1/nep/2027</code></div>
<p>National overview: every department with its delta, expense classes, regions, top funds and
programs, and the biggest movers up/down.</p>
<pre><code>curl ${O}/api/v1/nep/2027</code></pre>

<div class="ep" id="nep-departments"><span class="method">GET</span><code>/api/v1/nep/2027/departments</code></div>
<p>All 39 departments (including synthetic <code>SPF</code> and <code>AUTO</code>) with amounts, baselines, and
per-dimension counts.</p>

<div class="ep" id="nep-department"><span class="method">GET</span><code>/api/v1/nep/2027/departments/{id}</code></div>
<p>Full department view: agencies, programs, expense classes, funds, and regions in full;
objects, operating units, and divisions capped at the top 50 with an explicit
<code>__other__</code> remainder row so lists still sum to the department total.</p>
<pre><code>curl ${O}/api/v1/nep/2027/departments/07
curl ${O}/api/v1/nep/2027/departments/SPF</code></pre>

<div class="ep" id="nep-dept-rollup"><span class="method">GET</span><code>/api/v1/nep/2027/departments/{id}/rollups/{dimension}</code></div>
<p>The complete, untruncated list for one dimension within one department, paginated.
Dimensions: <code>agency</code>, <code>program</code>, <code>expense_class</code>, <code>fund</code>, <code>region</code>, <code>object</code>,
<code>operating_unit</code>, <code>division</code>.</p>
<pre><code>curl "${O}/api/v1/nep/2027/departments/07/rollups/operating_unit?limit=500"</code></pre>

<div class="ep" id="nep-rollup"><span class="method">GET</span><code>/api/v1/nep/2027/rollups/{dimension}</code></div>
<p>National rollups. Two modes:</p>
<ul>
  <li>Default — national totals per code in the dimension, summed across all departments.
  Every dimension is complete, so these sums are exact.</li>
  <li><code>?code=X&amp;by=department</code> — one code broken down across departments
  (e.g. which departments spend in region <code>13</code>, or on object <code>5020399000</code>).</li>
</ul>
<pre><code>curl ${O}/api/v1/nep/2027/rollups/expense_class
curl "${O}/api/v1/nep/2027/rollups/region?code=13&amp;by=department"</code></pre>

<h2>Budget cycle — NEP → GAA → execution</h2>

<div class="ep" id="cycle-overview"><span class="method">GET</span><code>/api/v1/budget-cycle</code></div>
<p>Dataset manifest and coverage: which departments are included, fiscal years (2018–2026),
stages, and expense classes. <b>Scope is Current New Appropriations only</b> — narrower than the
main GAA series; do not compare the two directly.</p>
<pre><code>curl ${O}/api/v1/budget-cycle</code></pre>

<div class="ep" id="cycle-department"><span class="method">GET</span><code>/api/v1/budget-cycle/departments/{id}</code></div>
<p>For one covered department: its programs (with the source→portal crosswalk and match
confidence) and facts — one row per program × fiscal year × stage × expense class.</p>
<table>
  <tr><th>Field</th><th>Values</th></tr>
  <tr><td><code>stage</code></td><td><code>nep</code>, <code>gaa</code>, <code>authorized_appropriation</code>, <code>adjusted_appropriation</code>, <code>adjusted_allotment</code>, <code>obligations</code>, <code>disbursements</code></td></tr>
  <tr><td><code>expense_class</code></td><td><code>ps</code>, <code>mooe</code>, <code>finex</code>, <code>co</code>, <code>total</code></td></tr>
</table>
<pre><code>curl ${O}/api/v1/budget-cycle/departments/14</code></pre>

<h2>Budget hearings — what was said, topic by topic</h2>
<p>The House Committee on Appropriations deliberates each agency's proposed budget in hearings that
run 2–9 hours. We transcribe the streams (speaker-labelled) and build a <b>deliberation record</b>:
not a summary of the hearing, but an account of what transpired on <i>each topic</i>. Machine
transcripts are imperfect — names and figures are as heard — so every item carries a timestamp and a
<code>url</code> that opens the hearing page with the video at that moment. Treat the records as an
index into the video, and verify before you quote.</p>

<div class="ep" id="hearings-list"><span class="method">GET</span><code>/api/v1/hearings</code></div>
<p>All hearings, newest first. Filters: <code>fiscal_year</code>, <code>agency</code> (acronym as in the title,
e.g. <code>DOH</code>), <code>q</code> (title keyword), <code>limit</code>, <code>offset</code>. <code>has_record</code>
says whether the topic record exists; <code>transcript_source</code> says how the transcript was made.</p>
<pre><code>curl "${O}/api/v1/hearings?agency=DOH"</code></pre>

<div class="ep" id="hearings-search"><span class="method">GET</span><code>/api/v1/hearings/search?q=…</code></div>
<p>Keyword search over every topic record across all hearings — the topic, its summary, question, outcome,
and every spoken moment. All terms must match. Each hit returns the topic and the specific
<code>matching_moments</code> (timestamp, speaker, what was said, url). Optional <code>fiscal_year</code>,
<code>agency</code>, <code>status</code> (<code>resolved | committed | parked | unresolved | informational</code>).</p>
<pre><code>curl "${O}/api/v1/hearings/search?q=philhealth%20subsidy"
curl "${O}/api/v1/hearings/search?q=flood%20control&amp;status=committed"</code></pre>

<div class="ep" id="hearings-topics"><span class="method">GET</span><code>/api/v1/hearings/{video_id}</code></div>
<p>One hearing's metadata and its topic index (topic, status, first timestamp, summary, outcome).</p>
<div class="ep"><span class="method">GET</span><code>/api/v1/hearings/{video_id}/topics</code>
  &nbsp;·&nbsp; <code>/topics/{index}</code></div>
<p>The full deliberation record. For each topic: <code>question</code> (what the committee was trying to
establish), <code>thread</code> (chronological moments: <code>timestamp</code>, <code>speaker</code>, <code>side</code>,
<code>kind</code>, <code>said</code>, <code>url</code>), <code>agency_position</code>, <code>positions</code>,
<code>figures</code> (as spoken; <code>amount</code> is a best-effort peso parse), <code>actions</code> (document
requests, commitments, motions, rulings), <code>outcome</code> and <code>status</code>. <code>?thread=0</code> omits the
moment-by-moment thread.</p>
<pre><code>curl ${O}/api/v1/hearings/7U4YvhlnbZY/topics
curl "${O}/api/v1/hearings/7U4YvhlnbZY/topics?thread=0"</code></pre>

<div class="ep" id="hearings-timeline"><span class="method">GET</span><code>/api/v1/hearings/{video_id}/timeline</code></div>
<p>The proceedings in order — roll call, presentation, each interpellation, motions, suspensions — with
per-section summaries, exchanges, figures and actions.</p>
<div class="ep"><span class="method">GET</span><code>/api/v1/hearings/{video_id}/transcript?from=&amp;to=</code></div>
<p>Raw transcript segments for a time window (seconds; default 20 minutes from <code>from</code>, at most
1000 segments), with the inferred speaker name when known.</p>
<pre><code>curl "${O}/api/v1/hearings/7U4YvhlnbZY/transcript?from=3600&amp;to=3900"</code></pre>

<h2>House bill FY2027 (HGAB) — the House's version against the President's proposal</h2>
<p>For the four programs where House Bill 10858 lists projects one by one, every project line in the House
bill is set against the President's proposed budget (NEP): what was added, dropped, raised, reduced or
left unchanged. The programs (the <code>{key}</code> in every path):</p>
<table>
  <tr><th>Key</th><th>Program</th><th>One row is</th><th>House version compared</th></tr>
  <tr><td><code>dpwh</code></td><td>DPWH infrastructure (roads, bridges, flood control, buildings)</td><td>One named project</td><td>Third reading</td></tr>
  <tr><td><code>fmr</code></td><td>DA farm-to-market roads</td><td>One road</td><td>Second reading (the list is the same at third)</td></tr>
  <tr><td><code>hfep</code></td><td>DOH Health Facilities Enhancement Program</td><td>One facility and funding column</td><td>Second reading (the same at third)</td></tr>
  <tr><td><code>nia</code></td><td>NIA irrigation</td><td>One irrigation project</td><td>Second reading (the same at third)</td></tr>
</table>

<div class="note" id="hgab-rules"><b>Rules every HGAB endpoint follows.</b>
(1)&nbsp;Amounts are integer pesos. <code>null</code> means "this version has no such line", never zero.
(2)&nbsp;The President's proposal and the House bill are <b>two versions of one budget</b>: compare them,
never add them. Sums over a filtered set come per version, marked <code>not_additive_across_versions: true</code>.
(3)&nbsp;Pairings are <b>candidates</b>: matches and gaps found by comparing names, places and amounts. They
are leads for checking, not confirmed changes. A line found in one version only is an <i>insertion
candidate</i> or a <i>deletion candidate</i>, never a confirmed insertion or deletion. Each row has a plain
<code>status_label</code> next to its raw <code>trace</code> code.
(4)&nbsp;<code>held: true</code> marks an unconfirmed match (a fuzzy or ambiguous pairing). Bridge figures
include unconfirmed matches (so the six groups add up to <code>net_php</code>); each group's
<code>unconfirmed_rows</code> / <code>unconfirmed_php</code> says how much of it is unconfirmed. The 10
largest per group leave unconfirmed matches out.
(5)&nbsp;District figures carry their tier. A shared (Tier B) office's money is never split between the
districts it serves, and the money no district card shows (the residual) comes with every district list.
(6)&nbsp;Every response's <code>meta</code> carries the disclaimer <code>notice</code>. Rows with a page on the
site carry <code>url</code>; document page references carry <code>pdf_url</code>, which opens the source PDF
at that page (<code>#page=N</code>).</div>

<p><b>The six groups (the bridge).</b> Every row falls in exactly one:
<code>house_only</code> (in the House bill only: insertion candidates),
<code>nep_only</code> (in the proposal only: deletion candidates),
<code>unchanged</code> (same amount in both), <code>increased</code> (higher in the House bill),
<code>decreased</code> (lower in the House bill), and <code>scope_review</code> (a different stretch of the
same road, not counted as a change). The identity
<code>house_only − nep_only + increased − decreased + scope_review = net_php</code> holds to the peso.</p>
<p><b>Versions on a row.</b> <code>nep_php</code> (the President's proposal), <code>hgab2_php</code> /
<code>hgab3_php</code> (House bill at second / third reading), <code>house_php</code> (the latest House
reading), <code>api_php</code> (the DPWH transparency website's list, DPWH only), <code>delta_php</code>
(House minus proposal, when both exist).</p>

<div class="ep" id="hgab-overview"><span class="method">GET</span><code>/api/v1/hgab/2027</code></div>
<p>Start here. The four programs (plain summary, what one row is, caveats, totals per version, record counts,
the bridge with plain labels, links), the source documents, reconciliation status counts, the plain meaning
of every term, the rules, and the stage order NEP → House → Senate → GAA.</p>
<pre><code>curl ${O}/api/v1/hgab/2027</code></pre>
<pre><code>{
  "meta": { "dataset": "hgab", "fiscal_year": 2027, "currency": "PHP", "scale": "pesos",
            "source_commit": "a0caa77…", "built_at": "2026-10-25T08:01:58.449Z",
            "notice": "Independent and unofficial. …" },
  "data": {
    "datasets": [
      { "key": "dpwh", "label": "DPWH national infrastructure", "house_stage": "hgab3",
        "totals": { "nep_php": 572924074000, "hgab2_php": 586941661000, "hgab3_php": 587075661000,
                    "api_php": 445378063000, "not_additive_across_versions": true },
        "bridge": { "net_php": 14151587000, "groups": {
          "house_only": { "label": "In the House bill only", "sub": "insertion candidates",
                          "rows": 6193, "php": 172149788000,
                          "unconfirmed_rows": 389, "unconfirmed_php": 10517119000 }, … } },
        "url": "https://budget.bettergov.ph/hgab/2027/dpwh" }, …
    ], …
  }
}</code></pre>

<div class="ep" id="hgab-datasets"><span class="method">GET</span><code>/api/v1/hgab/2027/datasets</code>
  &nbsp;·&nbsp; <code>/datasets/{key}</code></div>
<p><code>/datasets</code> lists the four programs, compact. <code>/datasets/{key}</code> returns one program in
full: everything in its overview entry plus <code>controls</code> (the totals each document prints, with
<code>nep_pdf_url</code> / <code>house_pdf_urls</code>), <code>dims</code> (House against the proposal by region,
office kind, program and program line, as each program records them), <code>regions</code>,
<code>readings</code> (DPWH only: second against third reading), and <code>top</code>: the 10 largest rows
in each group by that group's amount, unconfirmed matches left out. Unknown keys return <code>404</code>.</p>
<pre><code>curl ${O}/api/v1/hgab/2027/datasets
curl ${O}/api/v1/hgab/2027/datasets/hfep</code></pre>

<div class="ep" id="hgab-projects"><span class="method">GET</span><code>/api/v1/hgab/2027/datasets/{key}/projects</code></div>
<p>Filter, sort and page one program's rows. Filters combine with AND. <code>total</code> counts every matched
row and <code>sums</code> adds each version over every matched row, not just the page; never add the sums
across versions. Rows with no amount in the sorted column always sort last.</p>
<table>
  <tr><th>Param</th><th>Values</th><th>Description</th></tr>
  <tr><td><code>q</code></td><td>words</td><td>Every word must appear in the title, program, program line, region or office</td></tr>
  <tr><td><code>group</code></td><td>comma list</td><td><code>house_only</code>, <code>nep_only</code>, <code>unchanged</code>, <code>increased</code>, <code>decreased</code>, <code>scope_review</code></td></tr>
  <tr><td><code>held</code></td><td>all | hide | only</td><td>Unconfirmed matches: keep (default), hide, or only them</td></tr>
  <tr><td><code>region</code></td><td>key or label</td><td>A region key (<code>NCR</code>, <code>CAR</code>, <code>I</code> … <code>IV-A</code>, <code>MIMAROPA</code> … <code>XIII</code>, <code>BARMM</code>, <code>NIR</code>) or a region label exactly as printed</td></tr>
  <tr><td><code>program</code>, <code>pap</code>, <code>office</code>, <code>office_kind</code></td><td>exact text</td><td>As printed (<code>office</code> is the DPWH implementing office)</td></tr>
  <tr><td><code>zone</code></td><td>local | fap</td><td>Locally funded or foreign-assisted (DPWH)</td></tr>
  <tr><td><code>trace</code>, <code>reading_status</code></td><td>code</td><td>Exact raw status, or DPWH second/third reading status (e.g. <code>third_only</code>)</td></tr>
  <tr><td><code>flag</code></td><td>code</td><td>One review flag that must be present, e.g. <code>office_difference</code></td></tr>
  <tr><td><code>has_coordinates</code></td><td>1 | 0</td><td>Rows whose documents print map coordinates (all farm-to-market roads, some DPWH)</td></tr>
  <tr><td><code>sort</code></td><td>house | nep | delta | abs_delta | title</td><td>Default <code>house</code> (latest House amount); <code>abs_delta</code> = size of the change</td></tr>
  <tr><td><code>order</code></td><td>desc | asc</td><td>Default desc for amounts, asc for title</td></tr>
  <tr><td><code>limit</code>, <code>offset</code></td><td>1–200, ≥ 0</td><td>Page size (default 50) and rows to skip</td></tr>
</table>
<pre><code># Insertion candidates in DPWH, largest first, unconfirmed matches hidden
curl "${O}/api/v1/hgab/2027/datasets/dpwh/projects?group=house_only&amp;held=hide&amp;limit=10"

# Calabarzon flood-control lines, biggest change first
curl "${O}/api/v1/hgab/2027/datasets/dpwh/projects?region=IV-A&amp;q=flood&amp;sort=abs_delta"

# Farm-to-market roads with printed coordinates
curl "${O}/api/v1/hgab/2027/datasets/fmr/projects?has_coordinates=1"</code></pre>
<pre><code>{
  "meta": { "dataset": "hgab", "dataset_key": "dpwh", "filters": { "group": ["house_only"], "held": "hide" },
            "sort": "house", "order": "desc", "limit": 10, "offset": 0, "returned": 10, "total": 5804, … },
  "data": {
    "total": 5804,
    "sums": { "nep_php": null, "hgab2_php": …, "hgab3_php": 161632669000, "api_php": null,
              "not_additive_across_versions": true, … },
    "rows": [
      { "id": "house-reading:848", "title": "Daang Maharlika Road Development Project - Package B3-A, …",
        "trace": "house_only_candidate", "status_label": "House bill only", "held": false,
        "nep_php": null, "hgab3_php": 1845741000, "house_php": 1845741000, "delta_php": null,
        "pdf_url": { "nep": null, "hgab3": "https://budget-assets.bettergov.ph/hgab/2027/pdf/hb10858-3r-vol-ic.pdf#page=150", … },
        "url": "https://budget.bettergov.ph/hgab/2027/dpwh/p/house-reading%3A848" }, …
    ],
    "next_offset": 10
  }
}</code></pre>

<div class="ep" id="hgab-project"><span class="method">GET</span><code>/api/v1/hgab/2027/datasets/{key}/projects/{id}</code></div>
<p>One row in full: its amounts, plain labels for its status (with what it means), how the pairing was made,
second against third reading, the DPWH website listing, zone and every review flag; a <code>pdf_url</code>
per version; the row's page <code>url</code>; and <code>record</code>, the source workbench's full record as
the workbench writes it. Percent-encode the id (ids can contain <code>:</code> and <code>|</code>).</p>
<pre><code>curl ${O}/api/v1/hgab/2027/datasets/dpwh/projects/house-reading%3A0
curl ${O}/api/v1/hgab/2027/datasets/hfep/projects/ib%3Ap877%3Ar12%7Cinfrastructure</code></pre>

<div class="ep" id="hgab-regions"><span class="method">GET</span><code>/api/v1/hgab/2027/datasets/{key}/regions</code></div>
<p>All 18 regions, north to south, under the region each document prints (<code>null</code> where a document
lists nothing there), plus <code>not_on_map</code>: amounts printed as nationwide or with no region. Nothing
is placed from place names. The irrigation lists print no region, so all of NIA is in
<code>not_on_map</code>.</p>
<pre><code>curl ${O}/api/v1/hgab/2027/datasets/dpwh/regions</code></pre>

<div class="ep" id="hgab-documents"><span class="method">GET</span><code>/api/v1/hgab/2027/documents</code>
  &nbsp;·&nbsp; <code>/reconciliation</code></div>
<p><code>/documents</code>: the eight source PDFs (proposal and House bill volumes) with <code>pdf_url</code>,
the page range used, sha256, size, and which programs cite each. Page numbers everywhere are positions in
the file, not the numbers printed on the pages. <code>/reconciliation</code>: the 69 checks of the source's
figures against this portal's own FY2027 NEP data (<code>ours_php</code>, from the DBM CSV) and the
source's extraction from the PDFs (<code>theirs_php</code>); filter with <code>dataset</code> and
<code>status</code> (<code>exact</code>, <code>explained</code>, <code>mismatch</code>, <code>info</code>).</p>
<pre><code>curl ${O}/api/v1/hgab/2027/documents
curl "${O}/api/v1/hgab/2027/reconciliation?dataset=dpwh&amp;status=explained"</code></pre>

<div class="ep" id="hgab-districts"><span class="method">GET</span><code>/api/v1/hgab/2027/districts</code>
  &nbsp;·&nbsp; <code>/districts/{id}</code></div>
<p>DPWH money by the district engineering office the documents print, with the congressional districts each
office serves. No project is assigned to a district. A <b>Tier A</b> office serves one district, so its figure
can be read as that district's. A <b>Tier B</b> office serves several, so its figure is shared and is
<b>not split</b>: when a card's <code>attribution</code> is <code>B</code> or <code>mixed</code>, its headline
carries <code>shared_office_total: true</code> and the co-served district ids, and should be read as a
range. Headline amounts are the 2026 enacted budget and the 2027 proposal (whole office) and the 2027 House
bill (named projects only); <code>fy2027_vs_proposal</code> is the like-for-like 2027 change on the same
project rows. Every list also returns <code>residual</code>: for all nine year slots, the DPWH money under
the Central Office, regional offices and unplaced office names, which no district card shows.
Representatives are listed so a reader can find their district; nothing here says a representative
requested or controlled any amount.</p>
<table>
  <tr><th>Param</th><th>Values</th><th>Description</th></tr>
  <tr><td><code>region</code></td><td>key or label</td><td>Region key (e.g. <code>III</code>) or a printed region label</td></tr>
  <tr><td><code>q</code></td><td>words</td><td>Every word must appear in the district, representative or office name</td></tr>
  <tr><td><code>attribution</code></td><td>A | B | mixed | none</td><td>Whose budget the figure is (none = no office found)</td></tr>
  <tr><td><code>sort</code></td><td>hgab3 | gaa2026 | change | name</td><td>Default <code>hgab3</code> (largest House bill amount)</td></tr>
  <tr><td><code>limit</code>, <code>offset</code></td><td>1–254, ≥ 0</td><td>Page size (default 50) and rows to skip</td></tr>
</table>
<p><code>/districts/{id}</code> returns one card, its representative, and every serving office's full
history: FY2020–2026 enacted, the FY2027 proposal and House bill, totals per Congress, the 2027 six-group
comparison, notes, and links to the office's DPWH project rows.</p>
<pre><code>curl "${O}/api/v1/hgab/2027/districts?region=III&amp;sort=change&amp;limit=5"
curl "${O}/api/v1/hgab/2027/districts?q=bulacan"
curl ${O}/api/v1/hgab/2027/districts/leg%3Aabra%3Alone</code></pre>
<pre><code>{
  "data": {
    "total": 24,
    "districts": [
      { "id": "leg:nueva-ecija:1st", "label": "Nueva Ecija, 1st District", "region_key": "III",
        "attribution": { "code": "B", "label": "Tier B · shared office total, not split", "meaning": "…" },
        "headline": { "fy2026_gaa_php": …, "fy2027_hgab3_php": 3856983000,
                      "shared_office_total": true, "co_served_district_ids": ["leg:nueva-ecija:2nd"] },
        "fy2027_vs_proposal": { "nep_php": …, "hgab3_php": …, "delta_php": 1146570000 },
        "url": "https://budget.bettergov.ph/hgab/2027/districts/leg%3Anueva-ecija%3A1st" }, …
    ],
    "residual": [ { "fy": 2027, "stage": "hgab3", "total_php": 587075661000, "deo_php": 176097432000,
                    "central_office_php": 410825229000, "not_on_any_district_php": 410978229000, … }, … ]
  }
}</code></pre>

<h2 id="openapi">OpenAPI specification</h2>
<p>A machine-readable OpenAPI 3.1 description of every endpoint, parameter, and schema:</p>
<pre><code>${O}/api/v1/openapi.json</code></pre>
<p>Import it into Postman, Insomnia, or any OpenAPI-aware code generator.</p>

<h2 id="mcp">MCP server</h2>
<p>The same data is exposed as an <a href="https://modelcontextprotocol.io">MCP</a> server for AI
agents — Claude, Cursor, and any other MCP-capable client. The transport is stateless
Streamable HTTP: no auth, no sessions, JSON-RPC over POST.</p>
<div class="pill-row"><span class="pill">Endpoint <code>${O}/mcp</code></span><span class="pill">Transport: Streamable HTTP</span><span class="pill">Read-only tools</span></div>

<h3 id="mcp-install">Install in your AI client</h3>

<h4>Claude Code (CLI)</h4>
<pre><code>claude mcp add --transport http ph-budget ${O}/mcp</code></pre>
<p>Then just ask: <i>"Using ph-budget, which departments gain the most in the FY2027 proposal?"</i></p>

<h4>Claude Desktop &amp; claude.ai</h4>
<p>Settings → <b>Connectors</b> → <b>Add custom connector</b> → paste
<code>${O}/mcp</code>. No authentication is needed; the server is read-only.</p>

<h4>Cursor</h4>
<p>Add to <code>~/.cursor/mcp.json</code> (global) or <code>.cursor/mcp.json</code> in a project:</p>
<pre><code>{
  "mcpServers": {
    "ph-budget": { "url": "${O}/mcp" }
  }
}</code></pre>

<h4>Windsurf</h4>
<p>Add to <code>~/.codeium/windsurf/mcp_config.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "ph-budget": { "serverUrl": "${O}/mcp" }
  }
}</code></pre>

<h4>VS Code (Copilot Chat)</h4>
<p>Run <b>MCP: Add Server…</b> from the command palette (choose HTTP), or add to
<code>.vscode/mcp.json</code>:</p>
<pre><code>{
  "servers": {
    "ph-budget": { "type": "http", "url": "${O}/mcp" }
  }
}</code></pre>

<h4>Gemini CLI</h4>
<p>Add to <code>~/.gemini/settings.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "ph-budget": { "httpUrl": "${O}/mcp" }
  }
}</code></pre>

<h4>Anything else</h4>
<p>Any client that speaks MCP over Streamable HTTP works: point it at
<code>${O}/mcp</code>, no auth, no session setup. Most clients accept the generic
<code>{"mcpServers": {"ph-budget": {"url": "${O}/mcp"}}}</code> shape.</p>

<h3>Tools</h3>
<table>
  <tr><th>Tool</th><th>What it answers</th></tr>
  <tr><td><code>list_gaa_departments</code></td><td>Which departments exist, with per-year budgets (start here)</td></tr>
  <tr><td><code>get_gaa_national_trends</code></td><td>National GAA totals per year, 2020–2026</td></tr>
  <tr><td><code>get_gaa_department</code></td><td>One department: yearly totals, agencies, expense classes</td></tr>
  <tr><td><code>search_gaa_programs</code></td><td>Find programs by name across all departments</td></tr>
  <tr><td><code>get_gaa_department_programs</code></td><td>All programs of one department, paginated</td></tr>
  <tr><td><code>search_gaa_line_items</code></td><td>Object-level line items with text/agency/expense-class filters</td></tr>
  <tr><td><code>get_gaa_year_snapshot</code></td><td>One fiscal year in isolation: national total and every department's share, largest first</td></tr>
  <tr><td><code>browse_gaa_hierarchy</code></td><td>Drill one department's hierarchy for a single year: agencies → programs → operating units → funds → expenses</td></tr>
  <tr><td><code>get_nep_2027_overview</code></td><td>The FY2027 proposal at national level, vs FY2026</td></tr>
  <tr><td><code>list_nep_2027_departments</code></td><td>All 39 NEP departments with deltas</td></tr>
  <tr><td><code>get_nep_2027_department</code></td><td>One department's FY2027 proposal in full</td></tr>
  <tr><td><code>get_nep_2027_rollup</code></td><td>Slice FY2027 by agency/program/region/object/… nationally, per department, or cross-department</td></tr>
  <tr><td><code>get_budget_cycle</code></td><td>NEP→GAA→execution stages for covered departments</td></tr>
  <tr><td><code>list_hearings</code></td><td>House appropriations hearings, newest first, filterable by fiscal year, agency, or title keyword</td></tr>
  <tr><td><code>search_hearings</code></td><td>What was said on a subject across all hearings: matching topics plus timestamped moments (start here for hearings)</td></tr>
  <tr><td><code>get_hearing</code></td><td>One hearing's metadata and topic index, with each topic's status, summary, and outcome</td></tr>
  <tr><td><code>get_hearing_topics</code></td><td>Full deliberation record per topic: who said what, positions, figures as spoken, commitments</td></tr>
  <tr><td><code>get_hearing_timeline</code></td><td>The proceedings in order, section by section</td></tr>
  <tr><td><code>get_hearing_transcript</code></td><td>Raw machine transcript for a time window, to check exact wording</td></tr>
  <tr><td><code>get_hgab_2027_overview</code></td><td>The FY2027 House bill against the President's proposal for the four programs: totals per version, the six groups, documents, rules (start here for the House bill)</td></tr>
  <tr><td><code>get_hgab_2027_dataset</code></td><td>One program in full: printed totals, House against the proposal by region and program, the 10 largest rows per group</td></tr>
  <tr><td><code>search_hgab_2027_projects</code></td><td>Filter, sort and page one program's project rows (at most 50 per call; <code>total</code> says when to page)</td></tr>
  <tr><td><code>get_hgab_2027_project</code></td><td>One project row with plain labels, PDF page links and the source record</td></tr>
  <tr><td><code>list_hgab_2027_districts</code></td><td>DPWH money by congressional district, with office tiers, representatives and the money on no district card</td></tr>
  <tr><td><code>get_hgab_2027_district</code></td><td>One district and the full history of every office that serves it</td></tr>
</table>
<p>Hearing records are built from machine transcripts: speaker names are inferred and figures are
recorded as spoken. Each moment carries a <code>url</code> that opens the video at that second —
cite it when quoting, and verify figures against the video or official documents.</p>
<p>House bill rows are <b>candidates</b>, not findings: a line found in one version only is an insertion or
deletion candidate. The President's proposal and the House bill are compared, never added. Bridge figures
include unconfirmed matches (so the six groups add up to <code>net_php</code>); each group's
<code>unconfirmed_rows</code> / <code>unconfirmed_php</code> says how much of it is unconfirmed. The 10
largest per group leave unconfirmed matches out. Cite each row's <code>url</code> and <code>pdf_url</code>.</p>

<h3 id="mcp-examples">Example prompts</h3>
<p>Once connected, ask your assistant things like:</p>
<ul>
  <li><i>"Which departments get the biggest increases in the FY2027 budget proposal, in pesos and in percent?"</i></li>
  <li><i>"How much has the government appropriated for flood control programs each year since 2020, and under which departments?"</i></li>
  <li><i>"Break down DepEd's FY2026 budget by expense class, then show its largest line items for capital outlays."</i></li>
  <li><i>"Which regions gain and which lose in the FY2027 NEP compared to the FY2026 GAA?"</i></li>
  <li><i>"For the Department of Health, compare what was proposed (NEP), enacted (GAA), obligated, and disbursed across recent years."</i></li>
  <li><i>"What are the special purpose funds in the FY2027 proposal and how much is each?"</i></li>
  <li><i>"What did the DOH say in its budget hearing about the PhilHealth subsidy, and what did members demand? Link me to the moments."</i></li>
  <li><i>"Across all FY2027 hearings, which topics ended with the agency committing to submit documents?"</i></li>
  <li><i>"Which DPWH projects in the FY2027 House bill are not in the President's proposal, largest first? Link the PDF pages."</i></li>
  <li><i>"How did the House bill change health facilities funding compared with the proposal?"</i></li>
  <li><i>"Which DPWH offices serve Bulacan's districts, and how did their budgets change from 2020 to the 2027 House bill?"</i></li>
</ul>

<h3>How an agent typically chains the tools</h3>
<p>A question like <i>"how much of DepEd's 2026 budget is textbooks?"</i> resolves in three calls:</p>
<ol>
  <li><code>list_gaa_departments</code> → find DepEd's id (<code>07</code>)</li>
  <li><code>get_gaa_department {"department_id": "07"}</code> → totals and agencies for context</li>
  <li><code>search_gaa_line_items {"department_id": "07", "query": "textbooks", "year": 2026}</code> →
  the matched line items, plus <code>meta.matched_amount</code> answering the question in one number</li>
</ol>
<p>National "who spends on X?" questions go straight to <code>search_gaa_programs</code> (GAA) or
<code>get_nep_2027_rollup</code> with <code>by_department: true</code> (FY2027 proposal).</p>
<p>Hearing questions like <i>"what did DOH say about medical assistance (MAIFIP) in its FY2027 hearing?"</i>
chain the same way:</p>
<ol>
  <li><code>search_hearings {"query": "MAIFIP", "agency": "DOH", "fiscal_year": "2027"}</code> → matching
  topics with their status and outcome, plus the timestamped moments that mention the term</li>
  <li><code>get_hearing_topics {"video_id": "…", "topic_index": 2}</code> → that topic's full thread,
  positions, figures, and commitments</li>
  <li><code>get_hearing_transcript {"video_id": "…", "from_seconds": 3600, "to_seconds": 3900}</code> →
  the exact wording around a moment, when a quote or figure needs checking</li>
</ol>
<p>Pair the result with <code>get_nep_2027_department</code> to set what was said against what was proposed.</p>
<p>House bill questions like <i>"which flood-control projects did the House add in Calabarzon?"</i>:</p>
<ol>
  <li><code>get_hgab_2027_overview</code> → the four programs, their totals and the six groups</li>
  <li><code>search_hgab_2027_projects {"dataset": "dpwh", "query": "flood", "region": "IV-A", "group": ["house_only"], "held": "hide"}</code>
  → the matching rows, <code>total</code>, and the per-version sums</li>
  <li><code>get_hgab_2027_project {"dataset": "dpwh", "id": "…"}</code> → one row's status explained, its source
  record, and the PDF pages to check</li>
</ol>

<h3>Raw protocol examples (curl)</h3>
<p>The transport is stateless JSON-RPC over POST — you can drive it with curl. Handshake:</p>
<pre><code>curl -X POST ${O}/mcp -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2025-06-18", "capabilities": {},
              "clientInfo": { "name": "curl", "version": "1.0" } }
}'

curl -X POST ${O}/mcp -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'</code></pre>
<p>Search flood-control programs across all departments:</p>
<pre><code>curl -X POST ${O}/mcp -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "search_gaa_programs",
              "arguments": { "query": "flood control", "limit": 3 } }
}'</code></pre>
<p>Break FY2027 spending in NCR (region code <code>13</code>) down by department:</p>
<pre><code>curl -X POST ${O}/mcp -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 4, "method": "tools/call",
  "params": { "name": "get_nep_2027_rollup",
              "arguments": { "dimension": "region", "code": "13", "by_department": true, "limit": 5 } }
}'</code></pre>
<p>Tool results arrive as JSON text inside <code>result.content[0].text</code>, in the same envelopes
the <a href="#overview">REST API</a> returns. Invalid inputs come back as a result with
<code>isError: true</code> and a message explaining what to fix.</p>

<h2>Data sources &amp; attribution</h2>
<p>Source data is derived from Department of Budget and Management publications, packaged as the
<a href="https://huggingface.co/datasets/bettergovph/gaa">BetterGov.PH GAA dataset</a>. Figures are
presented as published; always verify against official DBM documents before citing in formal
work. If this API is useful to you, attribution to <b>BetterGov.PH</b> is appreciated.</p>

</main>
</div>
</body>
</html>`;
}
