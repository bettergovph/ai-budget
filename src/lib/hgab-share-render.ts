/**
 * Share images for the FY2027 House bill leaderboards: one Canvas 2D renderer
 * for the in-page cards, the downloads and the pre-rendered link previews
 * (`npm run build:hgab-share` drives this module in a browser).
 *
 * `drawShareCard` is pure drawing: it takes the data, the board, the format
 * and already-loaded images and paints a card at the format's native size.
 * The loaders at the bottom (`ensureShareFonts`, `loadShareImages`,
 * `renderShareCard`) are the browser plumbing shared by the React component
 * and the build script, so every image goes through the same pipeline.
 *
 * Integrity carried from the contract (hgab-leaderboard.ts): the cards rank
 * district offices and show who holds each seat; a shared office is shown with
 * every district it serves and is never split; wording comes from the board
 * definitions, extra text follows docs/hgab-copy.md.
 */

import {
  PEOPLE_LINE,
  SHARE_FORMATS,
  displayName,
  formatValue,
  leaderboardPath,
  officeLabel,
  rankByCongress,
  rankEntries,
  rankMembers,
  rankRegions,
  shortDistrict,
  type BoardDef,
  type LeaderEntry,
  type LeaderPerson,
  type LeaderboardData,
  type ShareFormat,
} from './hgab-leaderboard';
import { REGION_LABELS, type RegionKey } from './hgab';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ShareImageSource = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

export interface ShareCardInput {
  data: LeaderboardData;
  board: BoardDef;
  format: ShareFormat;
  region?: string | null;
  /** Loaded images by URL (portraits and the logo). Missing → initials / text wordmark. */
  images?: ReadonlyMap<string, ShareImageSource>;
}

/** Same-origin copies of the BetterGov logo (assets.bettergov.ph sends no CORS header). */
export const SHARE_LOGO_PRIMARY = '/brand/bettergov-horizontal-primary.png';
export const SHARE_LOGO_WHITE = '/brand/bettergov-horizontal-white.png';
export const SHARE_SITE = 'budget.bettergov.ph';

// ---------------------------------------------------------------------------
// Palette and type (src/styles.css, src/hgab.css)
// ---------------------------------------------------------------------------

const C = {
  hero: '#0a44bd', // --accent-deep: the section's hero band
  heroDeep: '#083796',
  accent: '#0b4fd9',
  accentSoft: '#e8efff',
  ink: '#11151c',
  ink2: '#2b3340',
  ink3: '#5b6373',
  mute: '#8a92a1',
  paper: '#ffffff',
  paper2: '#f4f7fc',
  paper3: '#eceef2',
  rule: '#d4d8e0',
  ruleSoft: '#e7eaef',
  positive: '#3a6b3a',
  negative: '#b8341f',
  house: '#b07d3a', // --hgab-house-only (stage-4)
  houseText: '#8a5c25',
  nepOnly: '#95463f', // --hgab-nep-only
  tierB: '#5b4a9e',
  central: '#1f2a44',
  regional: '#c89b54',
};

const F = {
  display: '"Figtree", "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  body: '"Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

interface Theme { solid: string; text: string }
const THEME = {
  blue: { solid: C.accent, text: C.hero },
  gold: { solid: C.house, text: C.houseText },
  green: { solid: C.positive, text: C.positive },
  red: { solid: C.negative, text: C.negative },
  dropped: { solid: C.nepOnly, text: C.nepOnly },
} satisfies Record<string, Theme>;

function boardTheme(board: BoardDef): Theme {
  if (board.id.startsWith('added') || board.id === 'regions-added') return THEME.gold;
  if (board.id.startsWith('increase') || board.id === 'growth') return THEME.green;
  if (board.id === 'cuts' || board.id === 'decline') return THEME.red;
  if (board.id === 'dropped') return THEME.dropped;
  return THEME.blue;
}

/** Signed values take their own sign's colour; everything else the board's. */
function valueTheme(board: BoardDef, v: number): Theme {
  if (board.value === 'signed_php' || board.value === 'pct') {
    if (v > 0) return THEME.green;
    if (v < 0) return THEME.red;
  }
  return boardTheme(board);
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function setFont(ctx: Ctx, weight: number, size: number, family: string, tracking = 0): void {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.letterSpacing = `${tracking}px`;
}

function tw(ctx: Ctx, s: string): number {
  return ctx.measureText(s).width;
}

/** Cut `s` to fit `max` px, ending with an ellipsis. */
function ellipsize(ctx: Ctx, s: string, max: number): string {
  if (tw(ctx, s) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tw(ctx, s.slice(0, mid).trimEnd() + '…') <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? s.slice(0, lo).trimEnd() + '…' : '…';
}

/** Greedy word wrap; the last allowed line is ellipsized when the text runs over. */
function wrap(ctx: Ctx, text: string, max: number, maxLines = Infinity): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (tw(ctx, next) <= max) { cur = next; continue; }
    if (cur) {
      if (lines.length === maxLines - 1) {
        lines.push(ellipsize(ctx, [cur, ...words.slice(i)].join(' '), max));
        return lines;
      }
      lines.push(cur);
    }
    cur = tw(ctx, words[i]) > max ? ellipsize(ctx, words[i], max) : words[i];
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Wrap a " · "-separated line, keeping each part whole where it fits on a line. */
function wrapSegments(ctx: Ctx, text: string, max: number, maxLines = Infinity): string[] {
  const parts = text.split(' · ');
  const lines: string[] = [];
  let cur = '';
  for (const p of parts) {
    const next = cur ? `${cur} · ${p}` : p;
    if (tw(ctx, next) <= max) { cur = next; continue; }
    if (cur) lines.push(cur + ' ·');
    if (tw(ctx, p) <= max) cur = p;
    else {
      const sub = wrap(ctx, p, max);
      lines.push(...sub.slice(0, -1));
      cur = sub[sub.length - 1] ?? '';
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(ctx, lines.slice(maxLines - 1).join(' '), max);
  return kept;
}

/** Width of `s` drawn with tabular digits (every digit takes the widest digit's advance). */
function tabWidth(ctx: Ctx, s: string): number {
  const dw = digitWidth(ctx);
  let w = 0;
  for (const run of s.match(/\d+|\D+/g) ?? []) w += /^\d/.test(run) ? run.length * dw : tw(ctx, run);
  return w;
}

function digitWidth(ctx: Ctx): number {
  let m = 0;
  for (let d = 0; d <= 9; d++) m = Math.max(m, tw(ctx, String(d)));
  return m;
}

/** Draw figures with tabular digits so right-aligned columns line up. */
function drawTab(ctx: Ctx, s: string, x: number, y: number, align: 'left' | 'right' | 'center' = 'right'): number {
  const total = tabWidth(ctx, s);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const dw = digitWidth(ctx);
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const run of s.match(/\d+|\D+/g) ?? []) {
    if (/^\d/.test(run)) {
      for (const ch of run) {
        const w = tw(ctx, ch);
        ctx.fillText(ch, cx + (dw - w) / 2, y);
        cx += dw;
      }
    } else {
      ctx.fillText(run, cx, y);
      cx += tw(ctx, run);
    }
  }
  ctx.textAlign = prevAlign;
  return total;
}

function text(ctx: Ctx, s: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function personName(p: LeaderPerson): string {
  return displayName(p.name);
}

function initials(p: LeaderPerson): string {
  if (!p.name) return '?';
  const first = p.name.split(' / ')[0];
  const shown = displayName(first)
    .replace(/[“"][^”"]*[”"]/g, ' ')
    .replace(/\b(Jr|Sr|II|III|IV|V|Atty|Dr|RN)\b\.?,?/g, ' ')
    .split(/\s+/)
    .filter((w) => /^[A-Za-zÀ-ž]/.test(w));
  if (!shown.length) return '?';
  const a = shown[0][0];
  const b = shown.length > 1 ? shown[shown.length - 1][0] : '';
  return (a + b).toUpperCase();
}

function districtsSummary(people: LeaderPerson[]): string {
  const by = new Map<string, string[]>();
  for (const p of people) {
    const d = p.district_label.replace(/\s*District$/i, '');
    const list = by.get(p.jurisdiction) ?? [];
    list.push(d);
    by.set(p.jurisdiction, list);
  }
  return [...by.entries()].map(([j, ds]) => `${j} ${ds.join(', ')}`).join(' · ');
}

function sharedLabel(n: number): string {
  return `Shared by ${n} districts · not split`;
}

/** The Tier B mark, shortened only as far as the space needs. */
function fitShared(ctx: Ctx, n: number, max: number): string {
  for (const s of [sharedLabel(n), `Shared by ${n} districts`, `Shared by ${n}`]) if (tw(ctx, s) <= max) return s;
  return ellipsize(ctx, `Shared by ${n}`, max);
}

// ---------------------------------------------------------------------------
// Rows (what a card shows)
// ---------------------------------------------------------------------------

interface Item {
  rank: number;
  people: LeaderPerson[];
  tier: 'A' | 'B';
  /** officeLabel(entry): the headline of a shared group (never one person's name); null for one district. */
  office: string | null;
  value: number;
  detail: string | null;
}

function isGroup(it: Item): boolean {
  return it.people.length > 1;
}

/** What a row is called: the office for a shared group, else the representative. */
function headline(it: Item): string {
  if (isGroup(it)) return it.office ?? `${it.people.length} districts sharing one office`;
  return it.people[0] ? personName(it.people[0]) : '—';
}

function regionName(region: string | null | undefined): string | null {
  if (!region) return null;
  const r = REGION_LABELS[region as RegionKey];
  return r ? r.name : region;
}

function regionPill(region: string): string {
  const r = REGION_LABELS[region as RegionKey];
  if (!r) return region;
  return r.short === r.name ? r.name : `${r.name} · ${r.short}`;
}

function rankingItems(data: LeaderboardData, board: BoardDef, region: string | null, limit: number): { items: Item[]; eligible: number } {
  if (board.kind === 'members') {
    const { rows, eligible } = rankMembers(data, { region, limit });
    return {
      eligible,
      items: rows.map((r) => ({ rank: r.rank, people: [r.person], tier: 'A' as const, office: null, value: r.value, detail: r.value === 1 ? 'bill' : 'bills' })),
    };
  }
  const { rows, eligible } = rankEntries(data, board, { region, limit });
  return {
    eligible,
    items: rows.map((r) => ({ rank: r.rank, people: r.entry.people, tier: r.entry.tier, office: officeLabel(r.entry), value: r.value, detail: board.detail?.(r.entry) ?? null })),
  };
}

function entryItem(rank: number, e: LeaderEntry, value: number): Item {
  return { rank, people: e.people, tier: e.tier, office: officeLabel(e), value, detail: null };
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

function imgSize(img: ShareImageSource): { w: number; h: number } {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: img.width, h: img.height };
}

/** One circular portrait (face-weighted crop) or an initials disc. */
function drawFace(ctx: Ctx, img: ShareImageSource | undefined, p: LeaderPerson, cx: number, cy: number, r: number, ring: string | null, ringW = Math.max(2, r * 0.07)): void {
  ctx.save();
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + ringW, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const sz = img ? imgSize(img) : null;
  if (img && sz && sz.w > 0 && sz.h > 0) {
    ctx.fillStyle = C.paper3;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const side = Math.min(sz.w, sz.h) * 0.92;
    const fx = sz.w / 2;
    const fy = sz.h > sz.w * 1.05 ? sz.h * 0.37 : sz.h / 2;
    const sx = Math.max(0, Math.min(sz.w - side, fx - side / 2));
    const sy = Math.max(0, Math.min(sz.h - side, fy - side / 2));
    ctx.drawImage(img, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#dfe8fb');
    g.addColorStop(1, '#c7d5f5');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const ini = initials(p);
    setFont(ctx, 700, Math.round(r * (ini.length > 1 ? 0.78 : 0.9)), F.display);
    ctx.fillStyle = C.hero;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ini, cx, cy + r * 0.04);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

/** Width the avatar box needs for `n` people at diameter `d`. */
function avatarBoxWidth(maxPeople: number, d: number): number {
  return maxPeople > 1 ? Math.round(d * 2.05) : d;
}

/**
 * Portraits for one row: a single face, or up to three overlapping faces and a
 * "+N" chip for a shared office. Left-aligned in a box `boxW` wide.
 */
function drawAvatars(ctx: Ctx, images: ReadonlyMap<string, ShareImageSource>, people: LeaderPerson[], x: number, cy: number, d: number, boxW: number, ring: string, chipBg = C.ink2): void {
  if (people.length <= 1) {
    const p = people[0];
    if (p) drawFace(ctx, p.portrait_url ? images.get(p.portrait_url) : undefined, p, x + d / 2, cy, d / 2, ring);
    return;
  }
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  const k = shown.length + (extra > 0 ? 1 : 0);
  const r = (d / 2) * 0.86;
  const step = Math.min(r * 2 * 0.78, (boxW - r * 2) / (k - 1));
  const ringW = Math.max(2, r * 0.09);
  // Back to front: later faces sit behind the first; the "+N" chip sits on top at the end.
  for (let i = shown.length - 1; i >= 0; i--) {
    const p = shown[i];
    drawFace(ctx, p.portrait_url ? images.get(p.portrait_url) : undefined, p, x + r + step * i, cy, r, ring, ringW);
  }
  if (extra > 0) {
    const label = `+${extra}`;
    const cr = r * 0.62;
    const ccx = x + r + step * (shown.length - 1) + r * 0.78;
    const ccy = cy + r * 0.52;
    ctx.beginPath();
    ctx.arc(ccx, ccy, cr + ringW, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ccx, ccy, cr, 0, Math.PI * 2);
    ctx.fillStyle = chipBg;
    ctx.fill();
    setFont(ctx, 700, Math.round(cr * (label.length > 2 ? 0.8 : 0.95)), F.display);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, ccx, ccy + cr * 0.06);
    ctx.textBaseline = 'alphabetic';
  }
}

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------

/** The sun of the logo, faint, in the corner of the hero band. */
function drawSun(ctx: Ctx, cx: number, cy: number, R: number, alpha = 0.07): void {
  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.26, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    for (const [off, len, wid] of [[0, 1, 0.075], [-0.16, 0.78, 0.035], [0.16, 0.78, 0.035]] as const) {
      const aa = a + off;
      const r0 = R * 0.33;
      const r1 = R * len;
      const half = wid;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(aa - half) * r0, cy + Math.sin(aa - half) * r0);
      ctx.lineTo(cx + Math.cos(aa) * r1, cy + Math.sin(aa) * r1);
      ctx.lineTo(cx + Math.cos(aa + half) * r0, cy + Math.sin(aa + half) * r0);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawHeroBg(ctx: Ctx, x: number, y: number, w: number, h: number, sun: { cx: number; cy: number; R: number }): void {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, C.hero);
  g.addColorStop(1, C.heroDeep);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  drawSun(ctx, sun.cx, sun.cy, sun.R);
  ctx.restore();
}

function drawLogo(ctx: Ctx, images: ReadonlyMap<string, ShareImageSource>, url: string, x: number, y: number, h: number, align: 'left' | 'right', onDark: boolean): number {
  const img = images.get(url);
  if (img) {
    const { w: iw, h: ih } = imgSize(img);
    const w = (iw / ih) * h;
    ctx.drawImage(img, align === 'right' ? x - w : x, y, w, h);
    return w;
  }
  // Wordmark fallback when the logo could not be loaded.
  setFont(ctx, 700, Math.round(h * 0.62), F.display);
  const s = 'BetterGov.PH';
  const w = tw(ctx, s);
  text(ctx, s, align === 'right' ? x - w : x, y + h * 0.74, onDark ? '#ffffff' : C.hero);
  return w;
}

function drawChip(ctx: Ctx, label: string, x: number, y: number, size: number, fg: string, bg: string, border: string | null): number {
  setFont(ctx, 600, size, F.body);
  const padX = size * 0.55;
  const h = size * 1.6;
  const w = tw(ctx, label) + padX * 2;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = border;
    ctx.stroke();
  }
  ctx.textBaseline = 'middle';
  text(ctx, label, x + padX, y + h / 2 + 1, fg);
  ctx.textBaseline = 'alphabetic';
  return w;
}

/** Set false during a draw when a layout had to fall back (text cut or rows squeezed past their minimum). */
let layoutFits = true;

// ---------------------------------------------------------------------------
// Format specs
// ---------------------------------------------------------------------------

interface Spec {
  W: number;
  H: number;
  pad: number;
  heroTop: number;
  heroBottom: number;
  kicker: number;
  titleMax: number;
  titleMin: number;
  sub: number;
  subLines: number;
  rowName: number;
  rowSub: number;
  rowValue: number;
  rowDetail: number;
  rank: number;
  avatar: number;
  rowMin: number;
  rowMax: number;
  /** #1 on the hero band; `stacked` puts the value under the name instead of in a right column. */
  spot: null | { avatar: number; name: number; sub: number; value: number; detail: number; stacked: boolean };
  foot: number;
  logo: number;
  /** Footer top/bottom padding in units of the footer font size (default 1). */
  footPad?: number;
  /** Extra empty space under the footer text (story safe zone), px. */
  footBottom?: number;
  /** Smallest footer font the layout may fall back to (22 on 1080-wide cards, 20 on 1200×630). */
  footMin?: number;
}

const SPECS: Record<Exclude<ShareFormat, 'landscape'>, Spec> = {
  portrait: {
    W: 1080, H: 1350, pad: 60, heroTop: 52, heroBottom: 34,
    kicker: 22, titleMax: 64, titleMin: 44, sub: 25, subLines: 3,
    rowName: 26, rowSub: 22, rowValue: 30, rowDetail: 22, rank: 28, avatar: 56, rowMin: 67, rowMax: 98,
    spot: { avatar: 120, name: 37, sub: 24, value: 58, detail: 24, stacked: false },
    foot: 22, logo: 40, footPad: 0.85,
  },
  square: {
    W: 1080, H: 1080, pad: 56, heroTop: 46, heroBottom: 30,
    kicker: 22, titleMax: 58, titleMin: 40, sub: 24, subLines: 3,
    rowName: 27, rowSub: 22, rowValue: 31, rowDetail: 22, rank: 28, avatar: 60, rowMin: 70, rowMax: 108,
    spot: null,
    foot: 22, logo: 38,
  },
  story: {
    // Stories: the app's profile bar covers the top ~120px and the reply field the bottom ~150px.
    W: 1080, H: 1920, pad: 68, heroTop: 132, heroBottom: 40,
    kicker: 26, titleMax: 80, titleMin: 54, sub: 29, subLines: 4,
    rowName: 29, rowSub: 24, rowValue: 35, rowDetail: 24, rank: 31, avatar: 70, rowMin: 80, rowMax: 116,
    spot: { avatar: 210, name: 48, sub: 27, value: 88, detail: 28, stacked: true },
    foot: 25, logo: 50, footBottom: 150,
  },
};

// ---------------------------------------------------------------------------
// Shared blocks: hero, footer, row
// ---------------------------------------------------------------------------

interface Block {
  h: number;
  draw: (y: number) => void;
  /** False when some text had to be cut to fit (the caller then tries a smaller size). */
  fits?: boolean;
}

interface HeroText { kicker: string; title: string; subtitle: string; region: string | null; count: string | null }

function heroText(board: BoardDef, region: string | null, count: string | null): HeroText {
  return { kicker: board.kicker, title: board.title, subtitle: board.subtitle, region: region ? regionPill(region) : null, count };
}

/** Kicker, region pill, title, subtitle and count line, white on the band. */
function logoWidth(ctx: Ctx, images: ReadonlyMap<string, ShareImageSource>, url: string, h: number): number {
  const img = images.get(url);
  if (img) { const z = imgSize(img); return (z.w / z.h) * h; }
  setFont(ctx, 700, Math.round(h * 0.62), F.display);
  return tw(ctx, 'BetterGov.PH');
}

function heroBlock(ctx: Ctx, s: Spec, t: HeroText, titleSize: number, x: number, w: number, subLines = s.subLines, logo: { images: ReadonlyMap<string, ShareImageSource>; h: number } | null = null, kickerLines = 2, titleLines = 3): Block {
  const logoW = logo ? logoWidth(ctx, logo.images, SHARE_LOGO_WHITE, logo.h) : 0;
  setFont(ctx, 500, s.kicker, F.mono, s.kicker * 0.14);
  const kLines = wrapSegments(ctx, t.kicker.toUpperCase(), logo ? w - logoW - s.kicker * 1.5 : w, kickerLines);
  const kLH = s.kicker * 1.45;
  const kFits = (() => { setFont(ctx, 500, s.kicker, F.mono, s.kicker * 0.14); return wrapSegments(ctx, t.kicker.toUpperCase(), logo ? w - logoW - s.kicker * 1.5 : w).length <= kickerLines; })();
  setFont(ctx, 700, titleSize, F.display, -titleSize * 0.02);
  const titleMaxLines = titleLines;
  const tFits = wrap(ctx, t.title, w).length <= titleMaxLines;
  const tLines = wrap(ctx, t.title, w, titleMaxLines);
  const tLH = titleSize * 1.06;
  setFont(ctx, 400, s.sub, F.body);
  const sFits = wrap(ctx, t.subtitle, w).length <= subLines;
  const sLines = wrap(ctx, t.subtitle, w, subLines);
  const sLH = s.sub * 1.38;
  // The region pill sits after a one-line kicker when there is room, else on its own line.
  const pillSize = Math.round(s.kicker * 1.02);
  setFont(ctx, 600, pillSize, F.body);
  const pillW = t.region ? tw(ctx, t.region) + pillSize * 1.1 : 0;
  setFont(ctx, 500, s.kicker, F.mono, s.kicker * 0.14);
  const kRoom = logo ? w - logoW - s.kicker * 1.5 : w;
  // After the last kicker line (only the first line shares its row with the logo).
  const lastK = kLines[kLines.length - 1] ?? '';
  const lastRoom = kLines.length === 1 ? kRoom : w;
  const pillInline = !!t.region && kLines.length > 0 && tw(ctx, lastK) + s.kicker * 1.2 + pillW <= lastRoom;
  setFont(ctx, 700, titleSize, F.display, -titleSize * 0.02);
  const pillAfterTitle = !!t.region && !pillInline && tLines.length === 1 && tw(ctx, tLines[0]) + titleSize * 0.4 + pillW <= w;
  const pillH = t.region && !pillInline && !pillAfterTitle ? s.kicker * 1.7 : 0;
  setFont(ctx, 500, s.kicker, F.mono, s.kicker * 0.08);
  const cLines = t.count ? wrap(ctx, t.count, w, 2) : [];
  const cLH = s.kicker * 1.45;
  const gap = s.kicker * 0.7;
  const h = kLines.length * kLH + gap + (pillH ? pillH + gap : 0) + tLines.length * tLH + gap * 0.9 + sLines.length * sLH + (cLines.length ? gap * 0.6 + cLines.length * cLH : 0);
  return {
    h,
    fits: kFits && tFits && sFits,
    draw(y0) {
      let y = y0;
      if (logo) drawLogo(ctx, logo.images, SHARE_LOGO_WHITE, x + w, y + s.kicker * 0.62 - logo.h / 2, logo.h, 'right', true);
      setFont(ctx, 500, s.kicker, F.mono, s.kicker * 0.14);
      if (pillInline && t.region) {
        const kw = tw(ctx, lastK);
        const ly = y + (kLines.length - 1) * kLH;
        drawChip(ctx, t.region, x + kw + s.kicker * 1.2, ly + s.kicker * 0.62 - pillSize * 0.8, pillSize, C.hero, '#ffffff', null);
        setFont(ctx, 500, s.kicker, F.mono, s.kicker * 0.14);
      }
      for (const l of kLines) { text(ctx, l, x, y + s.kicker, 'rgba(255,255,255,0.74)'); y += kLH; }
      y += gap;
      if (t.region && pillH) {
        drawChip(ctx, t.region, x, y, pillSize, C.hero, '#ffffff', null);
        y += pillH + gap;
      }
      setFont(ctx, 700, titleSize, F.display, -titleSize * 0.02);
      if (pillAfterTitle && t.region) {
        const tw0 = tw(ctx, tLines[0]);
        drawChip(ctx, t.region, x + tw0 + titleSize * 0.4, y + titleSize * 0.5 - pillSize * 0.8, pillSize, C.hero, '#ffffff', null);
        setFont(ctx, 700, titleSize, F.display, -titleSize * 0.02);
      }
      for (const l of tLines) { text(ctx, l, x, y + titleSize * 0.86, '#ffffff'); y += tLH; }
      y += gap * 0.9;
      setFont(ctx, 400, s.sub, F.body);
      for (const l of sLines) { text(ctx, l, x, y + s.sub * 0.98, 'rgba(255,255,255,0.86)'); y += sLH; }
      if (cLines.length) {
        y += gap * 0.6;
        setFont(ctx, 500, s.kicker, F.mono, s.kicker * 0.08);
        for (const l of cLines) { text(ctx, l, x, y + s.kicker * 1.05, 'rgba(255,255,255,0.68)'); y += cLH; }
      }
      ctx.letterSpacing = '0px';
    },
  };
}

function sourceLines(board: BoardDef, withPhotos: boolean): string[] {
  const src = board.section === 'history'
    ? 'Source: GAA 2020 to 2026, DPWH offices'
    : board.section === 'members'
      ? 'Source: bills.juris.ph, 20th Congress bill authors'
      : 'Source: NEP 2027 and House Bill 10858, DPWH project lists';
  const out = [withPhotos ? `${src} · Photos: House of Representatives, public domain` : src];
  if (withPhotos && (board.section === 'history' || board.kind === 'congress')) out.push('The representative shown holds the seat in the 20th Congress.');
  // The lines are run together in the footer: end each but the last with a full stop.
  return out.map((l, i) => (i < out.length - 1 && !/[.!?]$/.test(l) ? `${l}.` : l));
}

function shareUrl(board: BoardDef, region: string | null): string {
  return SHARE_SITE + leaderboardPath(board.id, { region });
}

interface FitUrl { lines: string[]; size: number; family: string; weight: number }

/**
 * The link is never cut: mono from `max` down to 22px, then Inter, then two
 * lines broken before the board id or the query.
 */
function fitUrl(ctx: Ctx, url: string, w: number, max: number, min = 22): FitUrl {
  for (const [family, weight] of [[F.mono, 500], [F.body, 600]] as const) {
    for (let size = max; size >= min; size--) {
      setFont(ctx, weight, size, family);
      if (tw(ctx, url) <= w) return { lines: [url], size, family, weight };
    }
  }
  setFont(ctx, 500, min, F.mono);
  const cut = url.includes('?') ? url.indexOf('?') : url.lastIndexOf('/') + 1;
  const lines = [url.slice(0, cut), url.slice(cut)].map((l) => ellipsize(ctx, l, w));
  return { lines, size: min, family: F.mono, weight: 500 };
}

function drawUrl(ctx: Ctx, u: FitUrl, x: number, y: number): void {
  setFont(ctx, u.weight, u.size, u.family);
  u.lines.forEach((l, i) => text(ctx, l, x, y + u.size * 0.95 + i * u.size * 1.3, C.hero));
}

/**
 * The notes a card prints: the board's first note and, on a card that shows
 * people next to amounts (ranking and by-Congress boards with rows), the
 * people line when the first note does not already say it.
 */
function footerNotes(board: BoardDef, withPhotos: boolean): string[] {
  const out = board.notes[0] ? [board.notes[0]] : [];
  const showsPeopleWithAmounts = withPhotos && (board.kind === 'ranking' || board.kind === 'congress');
  if (showsPeopleWithAmounts && !(board.notes[0] ?? '').includes('do not say who asked for any project')) out.push(PEOPLE_LINE);
  return out;
}

/** Notes, source and the short link, on a pale strip. `fs` is the footer font size. */
function footerBlock(ctx: Ctx, s: Spec, board: BoardDef, region: string | null, withPhotos: boolean, fs = s.foot): Block {
  const x = s.pad;
  const w = s.W - s.pad * 2;
  const lh = fs * 1.36;
  // Notes run together as one paragraph, and so do the source lines: fewer half-empty lines.
  setFont(ctx, 500, fs, F.body);
  const note = wrap(ctx, footerNotes(board, withPhotos).join(' '), w, 5);
  setFont(ctx, 400, fs, F.body);
  const src = wrap(ctx, sourceLines(board, withPhotos).join(' '), w, 3);
  const url = fitUrl(ctx, shareUrl(board, region), w, fs + 2, Math.min(fs, 22));
  const pad = s.footPad ?? 1;
  const padT = fs * pad;
  const gap = fs * 0.45;
  const h = padT + note.length * lh + gap + src.length * lh + fs * 0.7 + url.lines.length * url.size * 1.3 + fs * 1.15 * pad + (s.footBottom ?? 0);
  return {
    h,
    draw(y0) {
      ctx.fillStyle = C.paper2;
      ctx.fillRect(0, y0, s.W, s.H - y0);
      ctx.fillStyle = C.rule;
      ctx.fillRect(0, y0, s.W, 2);
      let y = y0 + padT;
      setFont(ctx, 500, fs, F.body);
      for (const l of note) { text(ctx, l, x, y + fs * 0.95, C.ink2); y += lh; }
      y += gap;
      setFont(ctx, 400, fs, F.body);
      for (const l of src) { text(ctx, l, x, y + fs * 0.95, C.ink3); y += lh; }
      y += fs * 0.7;
      drawUrl(ctx, url, x, y);
    },
  };
}

interface RowGeom {
  x: number; // row left (rank column starts here)
  w: number;
  rankW: number;
  avatarD: number;
  avatarBoxW: number;
  valueW: number;
  nameSize: number;
  subSize: number;
  valueSize: number;
  detailSize: number;
  rankSize: number;
}

/**
 * The row headline at `size`, shrunk (to no less than 85% and never below
 * 22px) before it is ellipsized. Leaves the font set; returns the text.
 */
function fitHeadline(ctx: Ctx, it: Item, size: number, max: number): string {
  const s0 = headline(it);
  const floor = Math.max(22, Math.round(size * 0.85));
  for (let z = size; z >= floor; z--) {
    setFont(ctx, 600, z, F.body, -z * 0.005);
    if (tw(ctx, s0) <= max) return s0;
  }
  return ellipsize(ctx, s0, max);
}

function itemDistrict(ctx: Ctx, p: LeaderPerson, max: number): string {
  if (tw(ctx, p.district) <= max) return p.district;
  return ellipsize(ctx, shortDistrict(p), max);
}

/**
 * One ranked row: rank, portraits, name and district, value and detail, and
 * under the text a bar on a light track, as long as |value| / max |value|
 * among the rows on the card.
 */
function drawRow(ctx: Ctx, board: BoardDef, it: Item, g: RowGeom, y: number, h: number, maxAbs: number, images: ReadonlyMap<string, ShareImageSource>, opts: { ring?: string } = {}): void {
  const th = valueTheme(board, it.value);
  const barH = Math.max(5, Math.round(h * 0.07));
  const barGap = Math.max(4, Math.round(h * 0.07));
  const laneY = y + h - barH - barGap;
  // Text and value are centred in the space above the bar lane, clear of it.
  const cy = (y + laneY - Math.max(4, h * 0.06)) / 2 + 1;
  const ax = g.x + g.rankW + g.rankSize * 0.3;
  const right = g.x + g.w - g.rankSize * 0.45;
  const tx = ax + g.avatarBoxW + g.nameSize * 0.6;
  // Bar on its track
  const frac = maxAbs > 0 ? Math.max(0.006, Math.abs(it.value) / maxAbs) : 0;
  ctx.fillStyle = C.paper3;
  roundRect(ctx, tx, laneY, right - tx, barH, barH / 2);
  ctx.fill();
  ctx.fillStyle = th.solid;
  roundRect(ctx, tx, laneY, Math.max(barH, (right - tx) * frac), barH, barH / 2);
  ctx.fill();
  // Rank
  setFont(ctx, 700, g.rankSize, F.display);
  ctx.fillStyle = it.rank === 1 ? th.text : C.ink3;
  ctx.textBaseline = 'middle';
  drawTab(ctx, String(it.rank), g.x + g.rankW - g.rankSize * 0.55, y + h / 2 + 1, 'right');
  ctx.textBaseline = 'alphabetic';
  // Portraits (centred on the whole row)
  drawAvatars(ctx, images, it.people, ax, y + h / 2, g.avatarD, g.avatarBoxW, opts.ring ?? '#ffffff');
  // Value + detail (right column)
  const vText = formatValue(it.value, board.value);
  const hasDetail = !!it.detail;
  const stackH = g.valueSize * 0.98 + (hasDetail ? g.detailSize * 1.25 : 0);
  const vy = cy - stackH / 2 + g.valueSize * 0.78;
  setFont(ctx, 700, g.valueSize, F.display, -g.valueSize * 0.01);
  ctx.fillStyle = th.text;
  drawTab(ctx, vText, right, vy, 'right');
  if (hasDetail) {
    setFont(ctx, 500, g.detailSize, F.body);
    text(ctx, ellipsize(ctx, it.detail!, g.valueW), right, vy + g.detailSize * 1.22, C.ink3, 'right');
  }
  // Name + district
  const tmax = right - g.valueW - g.nameSize * 0.7 - tx;
  const lineGap = g.subSize * 0.3;
  const nh = g.nameSize + lineGap + g.subSize;
  const ny = cy - nh / 2 + g.nameSize * 0.8;
  text(ctx, fitHeadline(ctx, it, g.nameSize, tmax), tx, ny, C.ink);
  const sy = ny + lineGap + g.subSize * 1.02;
  if (isGroup(it)) {
    setFont(ctx, 600, g.subSize, F.body);
    const lab = fitShared(ctx, it.people.length, tmax);
    const lw = Math.min(tw(ctx, lab), tmax);
    text(ctx, lab, tx, sy, C.tierB);
    const restW = tmax - lw - g.subSize * 0.8;
    if (restW > g.subSize * 4) {
      setFont(ctx, 400, g.subSize, F.body);
      text(ctx, ellipsize(ctx, '· ' + districtsSummary(it.people), restW), tx + lw + g.subSize * 0.4, sy, C.ink3);
    }
  } else if (it.people[0]) {
    setFont(ctx, 400, g.subSize, F.body);
    text(ctx, itemDistrict(ctx, it.people[0], tmax), tx, sy, C.ink3);
  }
}

function valueColumnWidth(ctx: Ctx, board: BoardDef, items: Item[], valueSize: number, detailSize: number, cap: number): number {
  let w = 0;
  setFont(ctx, 700, valueSize, F.display, -valueSize * 0.01);
  for (const it of items) w = Math.max(w, tabWidth(ctx, formatValue(it.value, board.value)));
  setFont(ctx, 500, detailSize, F.body);
  for (const it of items) if (it.detail) w = Math.max(w, tw(ctx, it.detail));
  return Math.min(Math.ceil(w), cap);
}

function countLine(board: BoardDef, shown: number, eligible: number): string | null {
  if (!eligible) return null;
  const unit = board.kind === 'members' ? ['representative', 'representatives'] : ['district office', 'district offices'];
  const u = eligible === 1 ? unit[0] : unit[1];
  return shown < eligible ? `Top ${shown} of ${eligible.toLocaleString('en-US')} ${u}` : `${eligible.toLocaleString('en-US')} ${u}`;
}

// ---------------------------------------------------------------------------
// Spotlight (#1 in portrait and story), drawn on the hero band
// ---------------------------------------------------------------------------

function spotlightBlock(ctx: Ctx, s: Spec, board: BoardDef, it: Item, images: ReadonlyMap<string, ShareImageSource>, squeeze = 0): Block {
  const k = [1, 0.84, 0.7][squeeze] ?? 0.7;
  const base = s.spot!;
  const group0 = it.people.length > 1;
  // A shared office's faces sit in a wider box: start them smaller.
  const sp = { ...base, avatar: Math.round(base.avatar * k * (group0 ? 0.74 : 1)), name: Math.round(base.name * (k < 1 ? 0.92 : 1)), value: Math.round(base.value * (0.7 + 0.3 * k)) };
  const x = s.pad;
  const w = s.W - s.pad * 2;
  const group = it.people.length > 1;
  const d = sp.avatar;
  const boxW = group ? avatarBoxWidth(it.people.length, d) : d;
  const vText = formatValue(it.value, board.value);
  setFont(ctx, 700, sp.value, F.display, -sp.value * 0.02);
  const vw = tabWidth(ctx, vText);
  setFont(ctx, 500, sp.detail, F.body);
  const dw = it.detail ? tw(ctx, it.detail) : 0;
  // Side-by-side: value in a right column. Stacked: value under the name.
  const valueW = sp.stacked ? 0 : Math.min(Math.max(vw, dw), w * 0.46);
  const tx = x + boxW + sp.name * 0.7;
  const tmax = x + w - (sp.stacked ? 0 : valueW + sp.name * 0.7) - tx;
  setFont(ctx, 700, sp.name, F.display, -sp.name * 0.01);
  const nameLines = wrap(ctx, headline(it), tmax, 2);
  const nLH = sp.name * 1.1;
  const subLH = sp.sub * 1.4;
  const subLines = group ? 2 : 1;
  const detailBelow = sp.stacked && it.detail ? vw + sp.detail + dw > tmax : false;
  const valueH = sp.stacked ? sp.sub * 0.5 + sp.value * 1.0 + (detailBelow ? sp.detail * 1.35 : 0) : 0;
  const textH = nameLines.length * nLH + sp.sub * 0.4 + subLines * subLH + valueH;
  const h = Math.max(d + sp.name * 0.5, textH) + sp.name * 0.2;
  return {
    h,
    draw(y0) {
      const cy = y0 + h / 2;
      // Divider above the spotlight
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y0 - sp.name * 0.55, w, 2);
      drawAvatars(ctx, images, it.people, x, cy, d, boxW, '#ffffff', C.heroDeep);
      // Rank badge on the first face
      const br = d * (group ? 0.2 : 0.17);
      const bcx = x + br * 0.7;
      const bcy = cy + d / 2 - br * 0.7;
      ctx.beginPath();
      ctx.arc(bcx, bcy, br + 4, 0, Math.PI * 2);
      ctx.fillStyle = C.hero;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bcx, bcy, br, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      setFont(ctx, 700, Math.round(br * 1.15), F.display);
      ctx.fillStyle = C.hero;
      ctx.textBaseline = 'middle';
      drawTab(ctx, String(it.rank), bcx, bcy + 1, 'center');
      ctx.textBaseline = 'alphabetic';
      // Name + district
      let y = cy - textH / 2;
      setFont(ctx, 700, sp.name, F.display, -sp.name * 0.01);
      for (const l of nameLines) { text(ctx, l, tx, y + sp.name * 0.86, '#ffffff'); y += nLH; }
      y += sp.sub * 0.4;
      if (group) {
        setFont(ctx, 600, Math.round(sp.sub * 0.92), F.body);
        drawChip(ctx, fitShared(ctx, it.people.length, tmax - sp.sub), tx, y + (subLH - sp.sub * 1.6) / 2, Math.round(sp.sub * 0.92), '#ffffff', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.55)');
        y += subLH;
        setFont(ctx, 400, sp.sub, F.body);
        text(ctx, ellipsize(ctx, districtsSummary(it.people), tmax), tx, y + sp.sub * 1.0, 'rgba(255,255,255,0.82)');
      } else {
        setFont(ctx, 400, sp.sub, F.body);
        text(ctx, itemDistrict(ctx, it.people[0], tmax), tx, y + sp.sub * 1.0, 'rgba(255,255,255,0.82)');
      }
      y += subLH;
      if (sp.stacked) {
        y += sp.sub * 0.5;
        const vy = y + sp.value * 0.84;
        setFont(ctx, 700, sp.value, F.display, -sp.value * 0.02);
        ctx.fillStyle = '#ffffff';
        drawTab(ctx, vText, tx, vy, 'left');
        if (it.detail) {
          setFont(ctx, 500, sp.detail, F.body);
          if (detailBelow) text(ctx, ellipsize(ctx, it.detail, tmax), tx, vy + sp.detail * 1.35, 'rgba(255,255,255,0.8)');
          else text(ctx, it.detail, tx + vw + sp.detail, vy, 'rgba(255,255,255,0.8)');
        }
        return;
      }
      // Value (right column)
      const right = x + w;
      const stackH = sp.value * 0.92 + (it.detail ? sp.detail * 1.3 : 0);
      const vy = cy - stackH / 2 + sp.value * 0.76;
      setFont(ctx, 700, sp.value, F.display, -sp.value * 0.02);
      ctx.fillStyle = '#ffffff';
      drawTab(ctx, vText, right, vy, 'right');
      if (it.detail) {
        setFont(ctx, 500, sp.detail, F.body);
        text(ctx, ellipsize(ctx, it.detail, valueW), right, vy + sp.detail * 1.3, 'rgba(255,255,255,0.8)', 'right');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Vertical formats (portrait, square, story)
// ---------------------------------------------------------------------------

interface Body {
  /** Height the body needs at its smallest. */
  minH: number;
  /** Height it would like. */
  idealH: number;
  draw: (y: number, h: number) => void;
}

/**
 * Hero on top, body in the middle, footer at the bottom. The title shrinks
 * (down to the spec's minimum) until the body gets at least its minimum height.
 */
function layoutVertical(ctx: Ctx, s: Spec, input: ShareCardInput, t: HeroText, body: (squeeze: number) => { extra: Block | null; body: Body }, withPhotos: boolean): void {
  const images = input.images ?? new Map();
  const region = input.region ?? null;
  const x = s.pad;
  const w = s.W - s.pad * 2;
  const footMin = s.footMin ?? 22;
  const footers = Array.from({ length: Math.max(1, s.foot - footMin + 1) }, (_, i) => footerBlock(ctx, s, input.board, region, withPhotos, s.foot - i));
  const heroHeight = (hero: Block, parts: { extra: Block | null }) => s.heroTop + hero.h + s.heroBottom + (parts.extra ? parts.extra.h + s.heroBottom * 1.6 : 0);
  // Largest title, then a smaller spotlight, whose kicker, title and subtitle fit whole and leave the body its room.
  // Then a footer a pixel or two smaller (never below footMin).
  type Choice = { hero: Block; parts: { extra: Block | null; body: Body }; heroH: number; footer: Block };
  let chosen: Choice | null = null;
  let fallback: Choice | null = null;
  search: for (let squeeze = 0; squeeze <= 3; squeeze++) {
    const parts = body(squeeze);
    for (const f of footers) {
      for (let size = s.titleMax; size >= s.titleMin; size -= 2) {
        // The subtitle may drop a pixel or two (never below 22) where that saves a line.
        for (let sub = s.sub; sub >= Math.max(22, s.sub - 2); sub--) {
          const hero = heroBlock(ctx, sub === s.sub ? s : { ...s, sub }, t, size, x, w, s.subLines, { images, h: s.logo });
          const heroH = heroHeight(hero, parts);
          if (!hero.fits) continue;
          if (!fallback || heroH + f.h < fallback.heroH + fallback.footer.h) fallback = { hero, parts, heroH, footer: f };
          if (s.H - heroH - f.h >= parts.body.minH) { chosen = { hero, parts, heroH, footer: f }; break search; }
        }
      }
    }
  }
  if (!chosen) {
    layoutFits = false;
    if (fallback) chosen = fallback;
    else {
      const parts = body(3);
      const hero = heroBlock(ctx, s, t, s.titleMin, x, w, s.subLines + 2, { images, h: s.logo }, 3, 4);
      chosen = { hero, parts, heroH: heroHeight(hero, parts), footer: footers[footers.length - 1] };
    }
  }
  const { hero, parts, heroH, footer } = chosen;
  const footY = s.H - footer.h;
  // Background
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, s.W, s.H);
  drawHeroBg(ctx, 0, 0, s.W, heroH, { cx: s.W * 1.01, cy: -s.W * 0.03, R: s.W * 0.5 });
  hero.draw(s.heroTop);
  if (parts.extra) parts.extra.draw(s.heroTop + hero.h + s.heroBottom * 1.6);
  footer.draw(footY);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, heroH, s.W, footY - heroH);
  ctx.clip();
  parts.body.draw(heroH, footY - heroH);
  ctx.restore();
}

/** Rows under the hero; bars are scaled to `maxAbs` (the largest |value| on the card, spotlight included). */
function rowsBody(ctx: Ctx, s: Spec, board: BoardDef, items: Item[], images: ReadonlyMap<string, ShareImageSource>, maxAbs: number): Body {
  const x = s.pad - s.rank * 0.2;
  const w = s.W - x * 2;
  const n = items.length;
  const padY = s.rowSub * 0.9;
  const maxPeople = Math.max(1, ...items.map((i) => i.people.length));
  return {
    minH: n * s.rowMin + padY * 2,
    idealH: n * s.rowMax + padY * 2,
    draw(y0, hAvail) {
      const rowMax = n <= 4 ? s.rowMax * 1.25 : s.rowMax;
      const rowH = Math.max(s.rowMin, Math.min(rowMax, (hAvail - padY * 2) / Math.max(1, n)));
      const avatarD = Math.round(Math.min(s.avatar * Math.max(1, rowH / s.rowMin * 0.9), rowH - 10, s.avatar * 1.25));
      const g: RowGeom = {
        x, w,
        rankW: Math.round(s.rank * 1.9),
        avatarD,
        avatarBoxW: avatarBoxWidth(maxPeople, avatarD),
        valueW: 0,
        nameSize: s.rowName,
        subSize: s.rowSub,
        valueSize: s.rowValue,
        detailSize: s.rowDetail,
        rankSize: s.rank,
      };
      g.valueW = valueColumnWidth(ctx, board, items, g.valueSize, g.detailSize, w * 0.4);
      // A short list sits a little above the middle of the space instead of leaving a gap at the bottom.
      const spare = Math.max(0, hAvail - padY * 2 - rowH * n);
      const top = y0 + padY + spare * 0.4;
      items.forEach((it, i) => drawRow(ctx, board, it, g, top + i * rowH, rowH, maxAbs, images));
    },
  };
}

function emptyMessage(board: BoardDef, region: string | null): string {
  const who = board.kind === 'members' ? 'representative' : 'district office';
  return `No ${who} in ${regionName(region) ?? 'this region'} fits this board`;
}

/** A board with no rows for the chosen region: say so plainly, large. */
function emptyBody(ctx: Ctx, s: Spec, board: BoardDef, region: string | null): Body {
  const size = Math.round(s.titleMin * 0.95);
  return {
    minH: size * 4,
    idealH: size * 6,
    draw(y0, h) {
      const w = s.W - s.pad * 2;
      setFont(ctx, 700, size, F.display, -size * 0.015);
      const lines = wrap(ctx, emptyMessage(board, region), w * 0.9, 3);
      const lh = size * 1.12;
      const blockH = lines.length * lh;
      let y = y0 + (h - blockH) / 2;
      ctx.fillStyle = C.accent;
      ctx.fillRect(s.W / 2 - size * 0.9, y - size * 0.9, size * 1.8, 6);
      for (const l of lines) { text(ctx, l, s.W / 2, y + size * 0.86, C.ink2, 'center'); y += lh; }
    },
  };
}

function drawRankingVertical(ctx: Ctx, s: Spec, format: ShareFormat, input: ShareCardInput): void {
  const { data, board } = input;
  const region = input.region ?? null;
  const images = input.images ?? new Map();
  const n = SHARE_FORMATS[format].rows;
  const { items, eligible } = rankingItems(data, board, region, n);
  const t = heroText(board, region, countLine(board, items.length, eligible));
  if (!items.length) {
    layoutVertical(ctx, s, input, t, () => ({ extra: null, body: emptyBody(ctx, s, board, region) }), false);
    return;
  }
  const maxAbs = Math.max(...items.map((i) => Math.abs(i.value)));
  // Squeeze 0–2 shrink the #1 spotlight; 3 folds #1 back into the list.
  layoutVertical(ctx, s, input, t, (squeeze) => {
    const spot = s.spot && items.length >= 2 && squeeze < 3 ? items[0] : null;
    return {
      extra: spot ? spotlightBlock(ctx, s, board, spot, images, squeeze) : null,
      body: rowsBody(ctx, s, board, spot ? items.slice(1) : items, images, maxAbs),
    };
  }, true);
}

// --- by Congress -------------------------------------------------------------

const CONGRESS_LABEL: Record<'18' | '19' | '20', string> = { '18': '18th Congress', '19': '19th Congress', '20': '20th Congress' };

function congressBands(ctx: Ctx, s: Spec, board: BoardDef, cols: ReturnType<typeof rankByCongress>, images: ReadonlyMap<string, ShareImageSource>): Body {
  // Band headers align with the page margin; the cards use more of the width so office names fit.
  const x = s.pad;
  const w = s.W - s.pad * 2;
  const cx0 = Math.round(s.pad * 0.5);
  const cw = s.W - cx0 * 2;
  const perRow = Math.max(1, ...cols.map((c) => c.rows.length));
  const headH = s.rowName * 1.7;
  const faceMin = s.avatar * 0.95;
  const barH = Math.max(5, Math.round(s.rowSub * 0.24));
  const barLane = s.rowSub * 0.45 + barH + 8;
  const cardW = cw / perRow;
  const cardGap = Math.max(8, Math.round(s.rowSub * 0.4));
  const innerW = cardW - cardGap;
  const textW = innerW - 6;
  // Office names of shared groups can need three lines; every cell gets the same slot so values line up.
  setFont(ctx, 600, s.rowSub, F.body);
  // Stories have the height for a fourth line; portrait stops at three.
  const maxNameLines = s.H >= 1900 ? 4 : 3;
  const nameLinesN = Math.min(maxNameLines, Math.max(2, ...cols.flatMap((c) => c.rows.map((r) => wrap(ctx, headline(entryItem(r.rank, r.entry, r.value)), textW).length))));
  const lineH = s.rowSub * (nameLinesN > 2 ? 1.13 : 1.25);
  // The bar under each value is dropped only when keeping it would shrink the faces below faceMin.
  const textNoBar = lineH * (nameLinesN + 1) + s.rowValue * 1.2 + 8;
  const cardMinH = faceMin + textNoBar + 10;
  return {
    minH: cols.length * (headH + cardMinH) + s.rowSub * 2,
    idealH: cols.length * (headH + cardMinH + barLane) * 1.2,
    draw(y0, hAvail) {
      const bandH = (hAvail - s.rowSub * 1.2) / cols.length;
      const cardH0 = bandH - headH - s.rowSub * 0.5;
      const withBars = cardH0 - (textNoBar - 8 + barLane) - 8 >= faceMin;
      const textH = withBars ? textNoBar - 8 + barLane : textNoBar;
      cols.forEach((col, ci) => {
        const by = y0 + s.rowSub * 0.6 + ci * bandH;
        if (ci > 0) { ctx.fillStyle = C.ruleSoft; ctx.fillRect(x, by, w, 2); }
        // Band header
        setFont(ctx, 700, Math.round(s.rowName * 1.05), F.display);
        const hy = by + headH * 0.66;
        text(ctx, CONGRESS_LABEL[col.congress], x, hy, C.ink);
        const lw = tw(ctx, CONGRESS_LABEL[col.congress]);
        setFont(ctx, 500, s.rowSub, F.mono, s.rowSub * 0.06);
        text(ctx, col.years, x + lw + s.rowSub * 0.7, hy, C.ink3);
        const cardsTop = by + headH;
        const cardH = bandH - headH - s.rowSub * 0.5;
        const d = Math.round(Math.min(s.avatar * 1.45, cardH - textH - 8, cardW * 0.55));
        const maxAbs = Math.max(0, ...col.rows.map((r) => Math.abs(r.value)));
        col.rows.forEach((r, i) => {
          const it = entryItem(r.rank, r.entry, r.value);
          const cx = cx0 + cardW * i + cardW / 2;
          const group = isGroup(it);
          const boxW = group ? Math.min(avatarBoxWidth(it.people.length, d), innerW) : d;
          const ay = cardsTop + d / 2 + 4;
          // Card behind the face; the bar under the value is ∝ value within this Congress
          const th = boardTheme(board);
          const frac = maxAbs > 0 ? Math.abs(r.value) / maxAbs : 0;
          ctx.fillStyle = C.paper2;
          roundRect(ctx, cx - innerW / 2, cardsTop + d * 0.5, innerW, cardH - d * 0.5, 10);
          ctx.fill();
          drawAvatars(ctx, images, it.people, cx - boxW / 2, ay, d, boxW, '#ffffff');
          // rank badge
          const br = Math.max(s.rowSub * 0.72, d * 0.17);
          const bcx = cx - boxW / 2 + br * 0.55;
          const bcy = ay - d / 2 + br * 0.55;
          ctx.beginPath(); ctx.arc(bcx, bcy, br + 3, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
          ctx.beginPath(); ctx.arc(bcx, bcy, br, 0, Math.PI * 2); ctx.fillStyle = r.rank === 1 ? th.solid : C.ink2; ctx.fill();
          setFont(ctx, 700, Math.round(br * 1.1), F.display);
          ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle';
          drawTab(ctx, String(r.rank), bcx, bcy + 1, 'center');
          ctx.textBaseline = 'alphabetic';
          // Name (office for a shared group) and the district or shared mark, centred in a fixed slot
          const slotTop = ay + d / 2;
          setFont(ctx, 600, s.rowSub, F.body);
          const nl = wrap(ctx, headline(it), textW, nameLinesN);
          let ty = slotTop + lineH + ((nameLinesN - nl.length) * lineH) / 2;
          for (const l of nl) { text(ctx, l, cx, ty, C.ink, 'center'); ty += lineH; }
          setFont(ctx, group ? 600 : 400, s.rowSub, F.body);
          const sub = group ? fitShared(ctx, it.people.length, textW) : ellipsize(ctx, shortDistrict(it.people[0]), textW);
          text(ctx, sub, cx, ty, group ? C.tierB : C.ink3, 'center');
          ty = slotTop + lineH * (nameLinesN + 1) + s.rowValue * 1.2;
          setFont(ctx, 700, s.rowValue, F.display, -s.rowValue * 0.01);
          ctx.fillStyle = th.text;
          drawTab(ctx, formatValue(r.value, board.value), cx, ty, 'center');
          if (!withBars) return;
          const bw = innerW - s.rowSub * 1.2;
          const bh = barH;
          const by = ty + s.rowSub * 0.45;
          ctx.fillStyle = C.paper3;
          roundRect(ctx, cx - bw / 2, by, bw, bh, bh / 2);
          ctx.fill();
          ctx.fillStyle = th.solid;
          roundRect(ctx, cx - bw / 2, by, Math.max(bh, bw * frac), bh, bh / 2);
          ctx.fill();
        });
      });
    },
  };
}

/**
 * Three columns, one per Congress (square and landscape). Rows carry the name,
 * the district (or the shared mark) and the value on three lines, or on two
 * lines (value first on the second) when the space is short.
 */
function congressColumns(ctx: Ctx, board: BoardDef, cols: ReturnType<typeof rankByCongress>, images: ReadonlyMap<string, ShareImageSource>, x: number, w: number, sizes: { name: number; sub: number; value: number; head: number; avatar: number }): Body {
  const perCol = Math.max(1, ...cols.map((c) => c.rows.length));
  const gap = sizes.sub * 1.1;
  const colW = (w - gap * (cols.length - 1)) / cols.length;
  setFont(ctx, 700, sizes.head, F.display);
  const labelW = Math.max(...cols.map((c) => tw(ctx, CONGRESS_LABEL[c.congress])));
  setFont(ctx, 500, sizes.sub, F.mono, sizes.sub * 0.04);
  const yearsW = Math.max(...cols.map((c) => tw(ctx, c.years)));
  const oneLineHead = labelW + yearsW + sizes.sub <= colW;
  const headH = sizes.head * (oneLineHead ? 1.75 : 2.6);
  const full = sizes.name * 1.2 + sizes.sub * 1.25 + sizes.value * 1.1 + 12;
  const compact = Math.max(sizes.avatar + 10, sizes.name * 1.2 + sizes.value * 1.1 + 8);
  return {
    minH: headH + perCol * compact + sizes.sub,
    idealH: headH + perCol * full * 1.15 + sizes.sub,
    draw(y0, hAvail) {
      const top = y0 + sizes.sub * 0.5;
      const avail = (hAvail - headH - sizes.sub) / perCol;
      const isCompact = avail < full;
      const rowH = Math.min(avail, full * 1.3);
      const th = boardTheme(board);
      cols.forEach((col, ci) => {
        const cx = x + ci * (colW + gap);
        setFont(ctx, 700, sizes.head, F.display);
        text(ctx, CONGRESS_LABEL[col.congress], cx, top + sizes.head, C.ink);
        setFont(ctx, 500, sizes.sub, F.mono, sizes.sub * 0.04);
        if (oneLineHead) text(ctx, col.years, cx + colW, top + sizes.head, C.ink3, 'right');
        else text(ctx, col.years, cx, top + sizes.head + sizes.sub * 1.3, C.ink3);
        ctx.fillStyle = C.ink;
        ctx.fillRect(cx, top + headH - 5, colW, 3);
        const maxAbs = Math.max(0, ...col.rows.map((r) => Math.abs(r.value)));
        col.rows.forEach((r, i) => {
          const it = entryItem(r.rank, r.entry, r.value);
          const ry = top + headH + i * rowH;
          const cyy = ry + rowH / 2;
          const frac = maxAbs > 0 ? Math.abs(r.value) / maxAbs : 0;
          ctx.fillStyle = C.paper2;
          roundRect(ctx, cx, ry + 3, colW, rowH - 6, 8);
          ctx.fill();
          const d = Math.min(sizes.avatar, rowH - 12);
          const group = isGroup(it);
          const boxW = group ? Math.round(d * 1.6) : d;
          drawAvatars(ctx, images, it.people, cx + 6, cyy, d, boxW, '#ffffff');
          const tx = cx + 6 + boxW + sizes.sub * 0.5;
          const tmax = cx + colW - tx - 6;
          const vText = formatValue(r.value, board.value);
          const blockH = isCompact ? sizes.name * 1.2 + sizes.value * 1.05 : sizes.name * 1.2 + sizes.sub * 1.25 + sizes.value * 1.05;
          let ty = cyy - blockH / 2 + sizes.name * 0.85;
          // "1. Metro Manila 1st district office" (shrinks before it is cut) or "1. JB Bernos"
          const numbered: Item = isGroup(it) ? { ...it, office: `${r.rank}. ${headline(it)}` } : it;
          let line: string;
          if (group) line = fitHeadline(ctx, numbered, sizes.name, tmax);
          else {
            setFont(ctx, 600, sizes.name, F.body);
            line = ellipsize(ctx, `${r.rank}. ${headline(it)}`, tmax);
          }
          text(ctx, line, tx, ty, C.ink);
          if (isCompact) {
            ty += sizes.value * 1.12;
            setFont(ctx, 700, sizes.value, F.display);
            ctx.fillStyle = th.text;
            const vw = drawTab(ctx, vText, tx, ty, 'left');
            const room = tmax - vw - sizes.sub * 0.6;
            setFont(ctx, group ? 600 : 400, sizes.sub, F.body);
            const sub = group ? fitShared(ctx, it.people.length, room) : itemDistrict(ctx, it.people[0], room);
            if (room > sizes.sub * 3) text(ctx, sub, tx + vw + sizes.sub * 0.6, ty, group ? C.tierB : C.ink3);
            return;
          }
          ty += sizes.sub * 1.25;
          setFont(ctx, group ? 600 : 400, sizes.sub, F.body);
          text(ctx, group ? fitShared(ctx, it.people.length, tmax) : itemDistrict(ctx, it.people[0], tmax), tx, ty, group ? C.tierB : C.ink3);
          ty += sizes.value * 1.08;
          setFont(ctx, 700, sizes.value, F.display);
          ctx.fillStyle = th.text;
          const vw = drawTab(ctx, vText, tx, ty, 'left');
          // Bar beside the value, ∝ value within this Congress
          const bx0 = tx + vw + sizes.sub * 0.6;
          const bw = cx + colW - 12 - bx0;
          const bh = Math.max(5, Math.round(sizes.sub * 0.28));
          if (bw > sizes.sub * 2) {
            const by = ty - sizes.value * 0.32 - bh / 2;
            ctx.fillStyle = C.paper3;
            roundRect(ctx, bx0, by, bw, bh, bh / 2);
            ctx.fill();
            ctx.fillStyle = th.solid;
            roundRect(ctx, bx0, by, Math.max(bh, bw * frac), bh, bh / 2);
            ctx.fill();
          }
        });
      });
    },
  };
}

function drawCongressVertical(ctx: Ctx, s: Spec, format: ShareFormat, input: ShareCardInput): void {
  const { data, board } = input;
  const region = input.region ?? null;
  const images = input.images ?? new Map();
  const cols = rankByCongress(data, { region, limit: 5 });
  const t = heroText(board, region, null);
  if (!cols.some((c) => c.rows.length)) {
    layoutVertical(ctx, s, input, t, () => ({ extra: null, body: emptyBody(ctx, s, board, region) }), false);
    return;
  }
  if (format === 'square') {
    layoutVertical(ctx, s, input, t, () => ({
      extra: null,
      body: congressColumns(ctx, board, cols, images, s.pad, s.W - s.pad * 2, { name: 22, sub: 22, value: 28, head: 28, avatar: 52 }),
    }), true);
    return;
  }
  layoutVertical(ctx, s, input, t, () => ({ extra: null, body: congressBands(ctx, s, board, cols, images) }), true);
}

// --- shift (NEP vs House bill by office kind) -----------------------------------

const KINDS = [
  { key: 'deo', label: 'District offices', color: C.accent },
  { key: 'central', label: 'Central Office', color: C.central },
  { key: 'regional', label: 'Regional offices', color: C.regional },
] as const;

interface ShiftGeom { x: number; w: number; label: number; barH: number; gapH: number; statName: number; statValue: number; statSub: number; statGap: number; shares: boolean }

/**
 * Two bars on one scale (NEP above, House bill below), each split by office
 * kind, with each kind's slice flowing from one bar to the other; then one
 * line per kind with the peso change.
 */
function shiftBody(ctx: Ctx, data: LeaderboardData, g: ShiftGeom): Body {
  const k = data.totals.by_office_kind;
  const nepTotal = KINDS.reduce((a, kk) => a + (k[kk.key].nep_php ?? 0), 0);
  const houseTotal = KINDS.reduce((a, kk) => a + (k[kk.key].hgab3_php ?? 0), 0);
  const max = Math.max(nepTotal, houseTotal, 1);
  const labelH = g.label * 1.55;
  const chartH = labelH + g.barH + g.gapH + g.barH + labelH;
  const statRowH = g.statValue * 1.12 + g.statSub * 1.35;
  const statH = KINDS.length * statRowH + (KINDS.length - 1) * g.statGap;
  const need = chartH + statH + g.label * 1.2;
  return {
    minH: need,
    idealH: need * 1.15,
    draw(y0, hAvail) {
      const slack = Math.max(0, hAvail - need);
      const x = g.x;
      const w = g.w;
      let y = y0 + slack * 0.3;
      const bars = [
        { label: 'NEP', total: nepTotal, get: (kk: (typeof KINDS)[number]) => k[kk.key].nep_php ?? 0 },
        { label: 'House bill', total: houseTotal, get: (kk: (typeof KINDS)[number]) => k[kk.key].hgab3_php ?? 0 },
      ];
      const barLabel = (b: (typeof bars)[number], ly: number) => {
        setFont(ctx, 700, g.label, F.display);
        text(ctx, b.label, x, ly, C.ink);
        const lw = tw(ctx, b.label);
        setFont(ctx, 500, g.label, F.mono);
        ctx.fillStyle = C.ink3;
        drawTab(ctx, formatValue(b.total, 'php'), x + lw + g.label * 0.55, ly, 'left');
      };
      barLabel(bars[0], y + g.label * 1.0);
      y += labelH;
      const barY = [y, y + g.barH + g.gapH];
      const segs = bars.map((b, bi) => {
        let cx = x;
        const yy = barY[bi];
        return KINDS.map((kk) => {
          const v = b.get(kk);
          const sw = (v / max) * w;
          ctx.fillStyle = kk.color;
          ctx.fillRect(cx, yy, sw, g.barH);
          const pct = b.total > 0 ? (v / b.total) * 100 : 0;
          const label = pctText(pct);
          setFont(ctx, 700, Math.round(Math.min(g.barH * 0.42, g.label * 1.05)), F.display);
          if (sw > tw(ctx, label) + g.barH * 0.45) {
            ctx.fillStyle = kk.key === 'regional' ? C.ink : '#ffffff';
            ctx.textBaseline = 'middle';
            drawTab(ctx, label, cx + g.barH * 0.22, yy + g.barH / 2 + 1, 'left');
            ctx.textBaseline = 'alphabetic';
          }
          const seg = { x0: cx, x1: cx + sw };
          cx += sw;
          return seg;
        });
      });
      // White hairlines between the slices
      ctx.fillStyle = '#ffffff';
      segs.forEach((row, bi) => row.slice(1).forEach((sg) => ctx.fillRect(sg.x0 - 1, barY[bi], 2, g.barH)));
      // Flows: each kind's slice of the NEP bar to its slice of the House bar
      const yTop = barY[0] + g.barH;
      const yBot = barY[1];
      const ym = (yTop + yBot) / 2;
      KINDS.forEach((kk, i) => {
        const a = segs[0][i];
        const b = segs[1][i];
        ctx.beginPath();
        ctx.moveTo(a.x0 + 1, yTop);
        ctx.bezierCurveTo(a.x0 + 1, ym, b.x0 + 1, ym, b.x0 + 1, yBot);
        ctx.lineTo(b.x1 - 1, yBot);
        ctx.bezierCurveTo(b.x1 - 1, ym, a.x1 - 1, ym, a.x1 - 1, yTop);
        ctx.closePath();
        ctx.fillStyle = hexA(kk.color, kk.key === 'central' ? 0.13 : 0.2);
        ctx.fill();
      });
      y = barY[1] + g.barH;
      barLabel(bars[1], y + g.label * 1.25);
      y += labelH + g.label * 1.2 + slack * 0.4;
      // One line per kind: name and change; NEP → House bill and the share of the total under it
      KINDS.forEach((kk, i) => {
        const nep = k[kk.key].nep_php ?? 0;
        const house = k[kk.key].hgab3_php ?? 0;
        const delta = house - nep;
        const l1 = y + g.statValue * 0.86;
        const l2 = l1 + g.statSub * 1.45;
        ctx.fillStyle = kk.color;
        roundRect(ctx, x, l1 - g.statName * 0.72, g.statName * 0.72, g.statName * 0.72, 4);
        ctx.fill();
        const nx = x + g.statName * 1.05;
        setFont(ctx, 700, g.statName, F.display);
        text(ctx, kk.label, nx, l1, C.ink);
        const col = delta > 0 ? C.positive : delta < 0 ? C.negative : C.ink3;
        setFont(ctx, 700, g.statValue, F.display, -g.statValue * 0.02);
        ctx.fillStyle = col;
        drawTab(ctx, formatValue(delta, 'signed_php'), x + w, l1, 'right');
        setFont(ctx, 500, g.statSub, F.mono);
        const flow = `NEP ${formatValue(nep, 'php')} → House bill ${formatValue(house, 'php')}`;
        const fw = tabWidth(ctx, flow);
        ctx.fillStyle = C.ink3;
        drawTab(ctx, flow, nx, l2, 'left');
        const sh0 = nepTotal > 0 ? (nep / nepTotal) * 100 : 0;
        const sh1 = houseTotal > 0 ? (house / houseTotal) * 100 : 0;
        setFont(ctx, 500, g.statSub, F.body);
        const share = `${pctText(sh0)} → ${pctText(sh1)} of the total`;
        if (g.shares && nx + fw + g.statSub * 1.5 + tw(ctx, share) <= x + w) text(ctx, share, x + w, l2, C.ink3, 'right');
        y += statRowH;
        if (i < KINDS.length - 1) {
          ctx.fillStyle = C.ruleSoft;
          ctx.fillRect(x, y + g.statGap / 2 - 1, w, 2);
          y += g.statGap;
        }
      });
    },
  };
}

function pctText(p: number): string {
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawShiftVertical(ctx: Ctx, s: Spec, format: ShareFormat, input: ShareCardInput): void {
  const t = heroText(input.board, null, null);
  const big = format === 'story' ? 1.3 : format === 'square' ? 0.9 : 1;
  layoutVertical(ctx, s, input, t, () => ({
    extra: null,
    body: shiftBody(ctx, input.data, {
      x: s.pad, w: s.W - s.pad * 2,
      label: Math.round(28 * big),
      barH: Math.round(74 * big), gapH: Math.round((format === 'square' ? 64 : 104) * big),
      statName: Math.round(30 * big), statValue: Math.round(50 * big), statSub: Math.max(22, Math.round(23 * big)), statGap: Math.round((format === 'square' ? 16 : 30) * big), shares: true,
    }),
  }), false);
}

// --- regions -------------------------------------------------------------------

interface RegionRow { rank: number; region: string; value: number }

function regionRows(data: LeaderboardData, board: BoardDef): RegionRow[] {
  return rankRegions(data, board).map((r) => ({ rank: r.rank, region: r.region.region, value: r.value }));
}

/**
 * Horizontal bars, one line per region; signed values diverge from a zero line.
 * Rows may be cut to `limit` (landscape) — for signed boards the last rows then
 * show the bottom of the ranking so cuts are never hidden.
 */
function regionsBody(ctx: Ctx, board: BoardDef, all: RegionRow[], x: number, w: number, sizes: { name: number; value: number; rank: number; rowMin: number; rowMax: number }, limit = Infinity): Body {
  let rows: (RegionRow | null)[] = all;
  if (all.length > limit) {
    const signed = board.value === 'signed_php';
    const negs = all.filter((r) => r.value < 0);
    if (signed && negs.length) {
      const tail = Math.min(2, negs.length);
      rows = [...all.slice(0, limit - tail - 1), null, ...all.slice(all.length - tail)];
    } else rows = all.slice(0, limit);
  }
  const n = rows.length;
  const signed = board.value === 'signed_php' && all.some((r) => r.value < 0);
  const maxPos = Math.max(0, ...all.map((r) => r.value));
  const maxNeg = Math.max(0, ...all.map((r) => -r.value));
  return {
    minH: n * sizes.rowMin + sizes.name,
    idealH: n * sizes.rowMax + sizes.name,
    draw(y0, hAvail) {
      const rowH = Math.max(sizes.rowMin, Math.min(sizes.rowMax, (hAvail - sizes.name) / n));
      const top = y0 + sizes.name * 0.5 + Math.max(0, hAvail - sizes.name - rowH * n) * 0.4;
      const rankW = sizes.rank * 1.7;
      setFont(ctx, 600, sizes.name, F.body);
      const nameW = Math.min(w * 0.36, Math.max(...all.map((r) => tw(ctx, regionName(r.region) ?? r.region))) + sizes.name * 0.6);
      setFont(ctx, 700, sizes.value, F.display);
      const valW = Math.max(...all.map((r) => tabWidth(ctx, formatValue(r.value, board.value)))) + sizes.value * 0.5;
      const bx = x + rankW + nameW;
      const bw = w - rankW - nameW - valW;
      const zero = signed ? bx + bw * (maxNeg / (maxPos + maxNeg)) : bx;
      const scale = signed ? bw / (maxPos + maxNeg) : bw / Math.max(1, maxPos);
      if (signed) {
        ctx.fillStyle = C.ink3;
        ctx.fillRect(zero - 1, top, 2, rowH * n);
      }
      rows.forEach((r, i) => {
        const y = top + i * rowH;
        const cy = y + rowH / 2;
        if (!r) {
          setFont(ctx, 700, sizes.name, F.display);
          text(ctx, '⋯', x + rankW + nameW / 2, cy + sizes.name * 0.3, C.mute, 'center');
          return;
        }
        if (i % 2 === 0) {
          ctx.fillStyle = 'rgba(244, 247, 252, 0.9)';
          ctx.fillRect(x, y, w, rowH);
        }
        const th = valueTheme(board, r.value);
        setFont(ctx, 700, sizes.rank, F.display);
        ctx.fillStyle = r.rank === 1 ? th.text : C.mute;
        ctx.textBaseline = 'middle';
        drawTab(ctx, String(r.rank), x + rankW - sizes.rank * 0.6, cy + 1, 'right');
        setFont(ctx, 600, sizes.name, F.body);
        text(ctx, ellipsize(ctx, regionName(r.region) ?? r.region, nameW - sizes.name * 0.4), x + rankW, cy + 1, C.ink);
        const len = Math.max(2, Math.abs(r.value) * scale);
        const bh = Math.min(rowH * 0.56, sizes.name * 1.2);
        ctx.fillStyle = th.solid;
        const bxx = r.value >= 0 ? zero : zero - len;
        roundRect(ctx, bxx, cy - bh / 2, len, bh, 3);
        ctx.fill();
        setFont(ctx, 700, sizes.value, F.display);
        ctx.fillStyle = th.text;
        drawTab(ctx, formatValue(r.value, board.value), x + w, cy + 1, 'right');
        ctx.textBaseline = 'alphabetic';
      });
    },
  };
}

function regionsCount(rows: RegionRow[], shown: number): string {
  return shown < rows.length ? `Top ${shown} of ${rows.length} regions` : `${rows.length} regions`;
}

function drawRegionsVertical(ctx: Ctx, s: Spec, format: ShareFormat, input: ShareCardInput): void {
  const rows = regionRows(input.data, input.board);
  const t = heroText(input.board, null, regionsCount(rows, rows.length));
  const sz = format === 'story'
    ? { name: 30, value: 30, rank: 26, rowMin: 52, rowMax: 72 }
    : format === 'square'
      ? { name: 23, value: 23, rank: 22, rowMin: 30, rowMax: 46 }
      : { name: 25, value: 25, rank: 22, rowMin: 36, rowMax: 52 };
  layoutVertical(ctx, s, input, t, () => ({ extra: null, body: regionsBody(ctx, input.board, rows, s.pad, s.W - s.pad * 2, sz) }), false);
}

// ---------------------------------------------------------------------------
// Landscape (1200 × 630): title panel on the left, the board on the right
// ---------------------------------------------------------------------------

const L = {
  W: 1200, H: 630, panelW: 432, pad: 40, kicker: 22, titleMax: 50, titleMin: 34, sub: 22,
  rowName: 25, rowSub: 22, rowValue: 30, rowDetail: 22, rank: 24, avatar: 56, foot: 22, logo: 34,
};

/** Landscape with a full-width title band: the by-Congress board needs the width for three columns. */
const WIDE: Spec = {
  ...SPECS.square,
  W: 1200, H: 630, pad: 48, heroTop: 28, heroBottom: 20,
  kicker: 22, titleMax: 42, titleMin: 32, sub: 22, subLines: 2,
  foot: 22, logo: 34, footPad: 0.75, footMin: 20,
};

function drawCongressLandscape(ctx: Ctx, input: ShareCardInput): void {
  const { data, board } = input;
  const region = input.region ?? null;
  const images = input.images ?? new Map();
  const cols = rankByCongress(data, { region, limit: 3 });
  const t = heroText(board, region, null);
  if (!cols.some((c) => c.rows.length)) {
    layoutVertical(ctx, WIDE, input, t, () => ({ extra: null, body: emptyBody(ctx, WIDE, board, region) }), false);
    return;
  }
  layoutVertical(ctx, WIDE, input, t, () => ({
    extra: null,
    body: congressColumns(ctx, board, cols, images, WIDE.pad, WIDE.W - WIDE.pad * 2, { name: 23, sub: 22, value: 26, head: 26, avatar: 48 }),
  }), true);
}

function drawLandscape(ctx: Ctx, input: ShareCardInput): void {
  const { data, board } = input;
  if (board.kind === 'congress') {
    drawCongressLandscape(ctx, input);
    return;
  }
  const region = input.region ?? null;
  const images = input.images ?? new Map();
  const W = L.W;
  const H = L.H;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);

  // What the right panel shows
  let items: Item[] = [];
  let count: string | null = null;
  let regionRowsAll: RegionRow[] = [];
  if (board.kind === 'ranking' || board.kind === 'members') {
    const r = rankingItems(data, board, region, SHARE_FORMATS.landscape.rows);
    items = r.items;
    count = countLine(board, items.length, r.eligible);
  } else if (board.kind === 'regions') {
    regionRowsAll = regionRows(data, board);
    count = regionsCount(regionRowsAll, Math.min(regionRowsAll.length, 8));
  }

  // Left panel
  const pw = L.panelW;
  drawHeroBg(ctx, 0, 0, pw, H, { cx: pw * 0.92, cy: H * 0.04, R: pw * 0.78 });
  const lx = L.pad;
  const lw = pw - L.pad * 2;
  const logoH = L.logo;
  const logoY = H - L.pad - logoH;
  const avail = logoY - L.pad - 24;
  const s: Spec = { ...SPECS.square, W: pw, H, pad: L.pad, kicker: L.kicker, sub: L.sub, subLines: 6, titleMax: L.titleMax, titleMin: L.titleMin };
  const t = heroText(board, region, count);
  // Largest title whose kicker, title and subtitle fit whole above the logo.
  let hero: Block | null = null;
  for (let size = L.titleMax; size >= L.titleMin && !hero; size -= 2) {
    const h = heroBlock(ctx, s, t, size, lx, lw, 8, null, 3, 4);
    if (h.fits && h.h <= avail) hero = h;
  }
  if (!hero) {
    layoutFits = false;
    hero = heroBlock(ctx, s, t, L.titleMin, lx, lw, 8, null, 3, 5);
  }
  hero.draw(L.pad + 2);
  drawLogo(ctx, images, SHARE_LOGO_WHITE, lx, logoY, logoH, 'left', true);

  // Right panel
  const rx = pw + L.pad - 6;
  const rw = W - rx - L.pad + 6;
  const withPhotos = (board.kind === 'ranking' || board.kind === 'members') && items.length > 0;
  const bodyTop = 22;
  // Footer at 22px, down to 20px when the rows would get too short.
  const rowsH = (f: Block) => (H - f.h - bodyTop - 12) / Math.max(1, items.length);
  let footer = landscapeFooter(ctx, board, region, rx, rw, withPhotos);
  for (let fs = L.foot - 1; fs >= 20 && items.length && Math.min(96, rowsH(footer)) < 66; fs--) footer = landscapeFooter(ctx, board, region, rx, rw, withPhotos, fs);
  const bodyH = H - footer.h - bodyTop;
  if (board.kind === 'ranking' || board.kind === 'members') {
    if (!items.length) emptyLandscape(ctx, board, region, rx, rw, bodyTop, bodyH);
    else {
      const maxAbs = Math.max(...items.map((i) => Math.abs(i.value)));
      const maxPeople = Math.max(1, ...items.map((i) => i.people.length));
      const rowH = Math.min(96, (bodyH - 12) / items.length);
      if (rowH < 66) layoutFits = false;
      const d = Math.min(L.avatar, rowH - 18);
      const g: RowGeom = {
        x: rx - 8, w: rw + 8, rankW: Math.round(L.rank * 1.7), avatarD: d, avatarBoxW: avatarBoxWidth(maxPeople, d), valueW: 0,
        nameSize: L.rowName, subSize: L.rowSub, valueSize: L.rowValue, detailSize: L.rowDetail, rankSize: L.rank,
      };
      g.valueW = valueColumnWidth(ctx, board, items, g.valueSize, g.detailSize, rw * 0.36);
      // Names come first: drop the detail line when it would squeeze them.
      const nameRoom = g.w - g.rankW - L.rank * 0.3 - g.avatarBoxW - L.rowName * 1.3 - g.valueW - L.rank * 0.45;
      let shown = items;
      if (nameRoom < 360) {
        shown = items.map((it) => ({ ...it, detail: null }));
        g.valueW = valueColumnWidth(ctx, board, shown, g.valueSize, g.detailSize, rw * 0.36);
      }
      shown.forEach((it, i) => drawRow(ctx, board, it, g, bodyTop + 6 + i * rowH, rowH, maxAbs, images));
    }
  } else if (board.kind === 'shift') {
    shiftBody(ctx, data, { x: rx, w: rw, label: 22, barH: 40, gapH: 34, statName: 24, statValue: 32, statSub: 22, statGap: 8, shares: false }).draw(bodyTop - 6, bodyH + 6);
  } else if (board.kind === 'regions') {
    regionsBody(ctx, board, regionRowsAll, rx, rw, { name: 22, value: 22, rank: 22, rowMin: 30, rowMax: 50 }, 8).draw(bodyTop - 6, bodyH);
  }
  footer.draw(H - footer.h);
}

function landscapeFooter(ctx: Ctx, board: BoardDef, region: string | null, x: number, w: number, withPhotos: boolean, fs = L.foot): Block {
  const lh = fs * 1.3;
  setFont(ctx, 500, fs, F.body);
  const note = wrap(ctx, footerNotes(board, withPhotos).join(' '), w, 5);
  setFont(ctx, 400, fs, F.body);
  const src = wrap(ctx, sourceLines(board, withPhotos).join(' '), w, 3);
  const url = fitUrl(ctx, shareUrl(board, region), w, fs, fs);
  const h = fs * 0.8 + note.length * lh + 4 + src.length * lh + 4 + url.lines.length * url.size * 1.3 + fs * 0.9;
  return {
    h,
    draw(y0) {
      ctx.fillStyle = C.paper2;
      ctx.fillRect(x - L.pad + 6, y0, L.W - x + L.pad, L.H - y0);
      ctx.fillStyle = C.rule;
      ctx.fillRect(x - L.pad + 6, y0, L.W - x + L.pad, 2);
      let y = y0 + fs * 0.8;
      setFont(ctx, 500, fs, F.body);
      for (const l of note) { text(ctx, l, x, y + fs * 0.95, C.ink2); y += lh; }
      y += 4;
      setFont(ctx, 400, fs, F.body);
      for (const l of src) { text(ctx, l, x, y + fs * 0.95, C.ink3); y += lh; }
      y += 4;
      drawUrl(ctx, url, x, y);
    },
  };
}

function emptyLandscape(ctx: Ctx, board: BoardDef, region: string | null, x: number, w: number, y: number, h: number): void {
  const size = 38;
  setFont(ctx, 700, size, F.display, -0.5);
  const lines = wrap(ctx, emptyMessage(board, region), w * 0.86, 3);
  const lh = size * 1.12;
  let yy = y + (h - lines.length * lh) / 2;
  ctx.fillStyle = C.accent;
  ctx.fillRect(x + w / 2 - size * 0.9, yy - size * 0.9, size * 1.8, 6);
  for (const l of lines) { text(ctx, l, x + w / 2, yy + size * 0.86, C.ink2, 'center'); yy += lh; }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export interface ShareCardReport {
  /** False when some layout had to fall back (a title cut, rows squeezed); worth a look. */
  fits: boolean;
}

/** Paint one share card at the format's native size. `ctx.canvas` must already be that size. */
export function drawShareCard(ctx: CanvasRenderingContext2D, input: ShareCardInput): ShareCardReport {
  layoutFits = true;
  const { board, format } = input;
  const region = board.regionFilter ? input.region ?? null : null;
  const inp: ShareCardInput = { ...input, region };
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (format === 'landscape') {
    drawLandscape(ctx, inp);
  } else {
    const s = SPECS[format];
    if (board.kind === 'shift') drawShiftVertical(ctx, s, format, inp);
    else if (board.kind === 'regions') drawRegionsVertical(ctx, s, format, inp);
    else if (board.kind === 'congress') drawCongressVertical(ctx, s, format, inp);
    else drawRankingVertical(ctx, s, format, inp);
  }
  ctx.restore();
  return { fits: layoutFits };
}

/** Every image a card draws: the portraits of the rows shown (up to three per shared office) and the logo. */
export function shareCardImageUrls(data: LeaderboardData, board: BoardDef, format: ShareFormat, region?: string | null): string[] {
  const r = board.regionFilter ? region ?? null : null;
  const urls = new Set<string>();
  urls.add(SHARE_LOGO_WHITE);
  const add = (people: LeaderPerson[]) => { for (const p of people.slice(0, 3)) if (p.portrait_url) urls.add(p.portrait_url); };
  if (board.kind === 'ranking' || board.kind === 'members') {
    for (const it of rankingItems(data, board, r, SHARE_FORMATS[format].rows).items) add(it.people);
  } else if (board.kind === 'congress') {
    for (const c of rankByCongress(data, { region: r, limit: format === 'landscape' ? 3 : 5 })) for (const row of c.rows) add(row.entry.people);
  }
  return [...urls];
}

/** "Ilocos Norte, 1st District (Ferdinand Alexander Marcos)" or, for a shared office, the office and every district it serves. */
function altItem(it: Item): string {
  if (!isGroup(it)) {
    const p = it.people[0];
    return p.name ? `${p.district} (${personName(p)})` : p.district;
  }
  return `${headline(it)}, shared by ${it.people.length} districts, not split (${it.people.map((p) => p.district).join('; ')})`;
}

/** Text alternative for the card: title, scope and the top three with their values. */
export function shareCardAlt(data: LeaderboardData, board: BoardDef, format: ShareFormat, region?: string | null): string {
  void format;
  const r = board.regionFilter ? region ?? null : null;
  const where = r ? ` ${regionName(r)}.` : '';
  const head = `${board.title}.${where} ${board.subtitle}`;
  let top: string[] = [];
  if (board.kind === 'ranking' || board.kind === 'members') {
    const { items, eligible } = rankingItems(data, board, r, 3);
    if (!items.length) return `${head} ${emptyMessage(board, r)}.`;
    top = items.map((it) => `${it.rank}. ${altItem(it)}: ${formatValue(it.value, board.value)}${it.detail ? ` ${it.detail}` : ''}`);
    top.unshift(countLine(board, Math.min(eligible, SHARE_FORMATS[format].rows), eligible) + '.');
  } else if (board.kind === 'congress') {
    for (const c of rankByCongress(data, { region: r, limit: 3 })) {
      if (!c.rows.length) continue;
      top.push(`${CONGRESS_LABEL[c.congress]} (${c.years}): ` + c.rows.map((row) => `${row.rank}. ${altItem(entryItem(row.rank, row.entry, row.value))}: ${formatValue(row.value, board.value)}`).join('; '));
    }
  } else if (board.kind === 'regions') {
    top = regionRows(data, board).slice(0, 3).map((row) => `${row.rank}. ${regionName(row.region)}: ${formatValue(row.value, board.value)}`);
  } else if (board.kind === 'shift') {
    const k = data.totals.by_office_kind;
    top = KINDS.map((kk) => `${kk.label}: NEP ${formatValue(k[kk.key].nep_php, 'php')}, House bill ${formatValue(k[kk.key].hgab3_php, 'php')}, change ${formatValue((k[kk.key].hgab3_php ?? 0) - (k[kk.key].nep_php ?? 0), 'signed_php')}`);
  }
  return `${head} ${top.join('. ')}.`.replace(/\.\./g, '.');
}

/** "bettergov-house-bill-2027-<board>-<region?>-<format>.png" */
export function shareCardFileName(board: BoardDef, format: ShareFormat, region?: string | null): string {
  const r = board.regionFilter && region ? `-${region.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
  return `bettergov-house-bill-2027-${board.id}${r}-${format}.png`;
}

// ---------------------------------------------------------------------------
// Browser plumbing: fonts, images, one-call render (component + build script)
// ---------------------------------------------------------------------------

const FONT_FACES = [
  '700 64px "Figtree"',
  '600 64px "Figtree"',
  '400 24px "Inter"',
  '500 24px "Inter"',
  '600 24px "Inter"',
  '700 24px "Inter"',
  '500 24px "JetBrains Mono"',
];
const FONT_SAMPLE = 'AaBbGg 0123456789 ₱−+→“”·…%';

let fontsReady: Promise<void> | null = null;

/** Wait (at most `timeoutMs`) for the site fonts the cards use. Safe to call often. */
export function ensureShareFonts(timeoutMs = 5000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  if (!fontsReady) {
    const loads = Promise.all(FONT_FACES.map((f) => document.fonts.load(f, FONT_SAMPLE).catch(() => [])))
      .then(() => document.fonts.ready)
      .then(() => undefined);
    fontsReady = Promise.race([loads, new Promise<void>((res) => setTimeout(res, timeoutMs))]);
  }
  return fontsReady;
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadOnce(src: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => { img.src = ''; resolve(null); }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      if (img.decode) img.decode().then(() => resolve(img), () => resolve(img));
      else resolve(img);
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

/**
 * The URL a canvas loads for `url`. Cross-origin images get a stable
 * `canvas=1` query: the page shows the same portraits in plain <img> tags
 * (no CORS), and the browser would otherwise answer the canvas's CORS request
 * from that cached copy and fail. The portrait host sends
 * `Access-Control-Allow-Origin: *` and ignores the query.
 */
function canvasUrl(url: string): string {
  try {
    if (new URL(url, location.href).origin === location.origin) return url;
  } catch {
    return url;
  }
  return url + (url.includes('?') ? '&' : '?') + 'canvas=1';
}

/**
 * Load one image for canvas use (CORS mode, cached by URL). If the canvas URL
 * fails, the plain URL is tried once. Failures resolve to null (the card
 * draws initials) and are not cached.
 */
export function loadShareImage(url: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  const hit = imageCache.get(url);
  if (hit) return hit;
  const first = canvasUrl(url);
  const p = loadOnce(first, timeoutMs)
    .then((img) => img ?? (first !== url ? loadOnce(url, timeoutMs) : null))
    .then((img) => {
      if (!img) imageCache.delete(url);
      return img;
    });
  imageCache.set(url, p);
  return p;
}

export async function loadShareImages(urls: string[]): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  const loaded = await Promise.all(urls.map((u) => loadShareImage(u)));
  urls.forEach((u, i) => { const img = loaded[i]; if (img) out.set(u, img); });
  return out;
}

export interface RenderShareCardOptions {
  data: LeaderboardData;
  board: BoardDef;
  format: ShareFormat;
  region?: string | null;
}

/**
 * Wait for fonts and images, size the canvas and draw. Resolves to null (and
 * draws nothing) when `isStale()` says a newer render has started.
 */
export async function renderShareCard(canvas: HTMLCanvasElement, opts: RenderShareCardOptions, isStale: () => boolean = () => false): Promise<ShareCardReport | null> {
  const f = SHARE_FORMATS[opts.format];
  await ensureShareFonts();
  if (isStale()) return null;
  const images = await loadShareImages(shareCardImageUrls(opts.data, opts.board, opts.format, opts.region));
  if (isStale()) return null;
  if (canvas.width !== f.width) canvas.width = f.width;
  if (canvas.height !== f.height) canvas.height = f.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, f.width, f.height);
  return drawShareCard(ctx, { ...opts, images });
}
