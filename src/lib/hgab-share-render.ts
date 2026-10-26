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
  SHARE_FORMATS,
  displayName,
  formatValue,
  leaderboardPath,
  officeLabel,
  rankByCongress,
  rankEntries,
  rankMembers,
  asOfText,
  rankRegions,
  residualLine,
  seatHolders,
  shortDistrict,
  tierText,
  type BoardDef,
  type LeaderEntry,
  type LeaderSlice,
  type LeaderPerson,
  type LeaderboardData,
  type ShareFormat,
} from './hgab-leaderboard';
import { REGION_LABELS, type RegionKey } from './hgab';
import { CARD_DISCLAIMER } from './hgab-disclaimers';

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
  if (!(w > 0 && h > 0)) return;
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

// ---------------------------------------------------------------------------
// Rows (what a card shows)
// ---------------------------------------------------------------------------

interface Item {
  rank: number;
  /** Shown in the rank column instead of the number ("18th"). */
  label?: string;
  /** The group's key (person district id on the members board). */
  key: string;
  /** Members board: the person is the headline. Everywhere else the place is (district or office). */
  personFirst?: boolean;
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
/**
 * What a row is called. The place, never a person: the district for a
 * one-district office, the office for a shared one (entryTitle in the
 * contract). Only the members board leads with the person.
 */
function headline(it: Item): string {
  if (it.personFirst) return it.people[0] ? personName(it.people[0]) : '—';
  if (isGroup(it)) return it.office ?? `${it.people.length} districts sharing one office`;
  return it.people[0]?.district ?? it.key;
}

/**
 * "Rep. JB Bernos" / "Reps. A · B +5": as many names as fit in `max` (the
 * font must be set). A single name too long for the line is ellipsized.
 */
function fitHolders(ctx: Ctx, it: Item, max: number): string {
  const all = seatHolders({ people: it.people });
  if (tw(ctx, all) <= max) return all;
  for (let k = it.people.length - 1; k >= 1; k--) {
    const s = seatHolders({ people: it.people }, k);
    if (tw(ctx, s) <= max) return s;
  }
  return ellipsize(ctx, seatHolders({ people: it.people }, 1), max);
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
      items: rows.map((r) => ({ rank: r.rank, key: r.person.district_id, personFirst: true, people: [r.person], tier: 'A' as const, office: null, value: r.value, detail: r.value === 1 ? 'bill' : 'bills' })),
    };
  }
  const { rows, eligible } = rankEntries(data, board, { region, limit });
  return {
    eligible,
    items: rows.map((r) => ({ rank: r.rank, key: r.entry.key, people: r.entry.people, tier: r.entry.tier, office: officeLabel(r.entry), value: r.value, detail: board.detail?.(r.entry) ?? null })),
  };
}

function entryItem(rank: number, e: LeaderEntry, value: number): Item {
  return { rank, key: e.key, people: e.people, tier: e.tier, office: officeLabel(e), value, detail: null };
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
  if (!(d > 8)) {
    // No room for faces: a layout fallback, already flagged as not fitting.
    layoutFits = false;
    return;
  }
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
/** Set during a draw when fewer rows than the board's usual minimum fitted (honest "Top K", but a thin card). */
let layoutSparse = false;

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
  /** Link previews: the link sits on the count line of the title band instead of the footer. */
  urlInHero?: boolean;
  /** Shared rows run the seat holders and the tier on as one paragraph (no forced line break). */
  rowFlow?: boolean;
  /** Tighter spacing in the title band (link previews). */
  heroTight?: boolean;
  /** A thin bar at the very bottom of each row (link previews), so rows can be shorter. */
  rowBarSlim?: boolean;
  /** Space above and below the rows (default rowSub × 0.9). */
  rowPadY?: number;
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

interface HeroText {
  kicker: string;
  title: string;
  subtitle: string;
  region: string | null;
  count: string | null;
  /** Drawn white, right-aligned on the count line (link previews). */
  url?: string | null;
  /** "As of October 26, 2026": on the count row ("Top 7 of 190 district offices · As of …"), or alone where the count would be. */
  asOf: string;
  /** "As of Oct 26, 2026", for a count row that is too narrow for the long date. */
  asOfShort: string;
  /** Width the count row may take (link previews keeping the link beside a shortened row). */
  rowMax?: number;
}

/** asOfText(data) for the card being drawn, and its short form (set by drawShareCard). */
let cardAsOf = '';
let cardAsOfShort = '';
/** Set during a draw when the date is missing or does not fit on the count row. */
let asOfMissing = false;
/** Set when the date has been drawn whole on the count row (or alone where the count would be). */
let asOfDrawn = false;

function heroText(board: BoardDef, region: string | null, count: string | null): HeroText {
  return { kicker: board.kicker, title: board.title, subtitle: board.subtitle, region: region ? regionPill(region) : null, count, asOf: cardAsOf, asOfShort: cardAsOfShort };
}

/** "Top 7 of 190 district offices" → "Top 7 of 190"; "Top 2 shown for each Congress" → "Top 2 per Congress". */
function shortCount(count: string): string {
  return count
    .replace(/ shown for each Congress$/, ' per Congress')
    .replace(/ (district offices|district office|representatives|representative|regions)$/, '');
}

interface CountRow {
  /** Runs in drawing order (count, separator, date). */
  parts: { text: string; color: string }[];
  width: number;
  tracking: number;
  /** The date is on the row (whole). */
  dated: boolean;
}

/**
 * The count row: "Top 7 of 190 district offices · As of October 26, 2026" on
 * ONE line. Narrower rows take the short date, then the short count, then no
 * letter-spacing, but never split the count and the date. Null when the card
 * has neither; `dated: false` when even the shortest form is too wide.
 */
function countRow(ctx: Ctx, s: Spec, t: HeroText, w: number): CountRow | null {
  const cc = 'rgba(255,255,255,0.68)';
  const dc = 'rgba(255,255,255,0.58)';
  const forms: { text: string; color: string }[][] = [];
  if (t.count && t.asOf) {
    const topN = /^Top \d+/.exec(t.count)?.[0];
    const pairs = [[t.count, t.asOf], [t.count, t.asOfShort], [shortCount(t.count), t.asOfShort], ...(topN ? [[topN, t.asOfShort]] : [])];
    for (const [c, d] of pairs) {
      forms.push([{ text: c, color: cc }, { text: ' · ', color: dc }, { text: d, color: dc }]);
    }
  } else if (t.asOf) {
    forms.push([{ text: t.asOf, color: dc }], [{ text: t.asOfShort, color: dc }]);
  } else if (t.count) {
    forms.push([{ text: t.count, color: cc }], [{ text: shortCount(t.count), color: cc }]);
  } else return null;
  const measure = (parts: { text: string }[], tracking: number) => {
    setFont(ctx, 500, s.kicker, F.mono, tracking);
    return tw(ctx, parts.map((p) => p.text).join(''));
  };
  // The least-shortened form that fits, letter-spaced if it can be.
  for (const parts of forms) {
    for (const tracking of [s.kicker * 0.08, 0]) {
      const width = measure(parts, tracking);
      if (width <= w) return { parts, width, tracking, dated: !!t.asOf };
    }
  }
  const parts = forms[forms.length - 1];
  return { parts, width: measure(parts, 0), tracking: 0, dated: false };
}

/** The link's width beside the count row (mono, else Inter); null when it does not fit there. */
function urlBeside(ctx: Ctx, s: Spec, row: CountRow | null, url: string, w: number): { weight: number; family: string; width: number } | null {
  for (const [weight, family] of [[500, F.mono], [600, F.body]] as const) {
    setFont(ctx, weight, s.kicker, family, 0);
    const width = tw(ctx, url);
    if ((row ? row.width + s.kicker * 1.5 : 0) + width <= w) return { weight, family, width };
  }
  return null;
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
  const kLH = s.kicker * (s.heroTight ? 1.35 : 1.45);
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
  // The count row (count · date, one line) and, on link previews, the link beside it.
  const row = countRow(ctx, s, t, Math.min(w, t.rowMax ?? w));
  const urlAt = t.url ? urlBeside(ctx, s, row, t.url, w) : null;
  const urlFits = !t.url || !!urlAt;
  const dateFits = !t.asOf || (!!row && row.dated);
  const cLH = s.kicker * (s.heroTight ? 1.32 : 1.45);
  const gap = s.kicker * (s.heroTight ? 0.55 : 0.7);
  const rowH = row ? gap * 0.6 + cLH : 0;
  const h = kLines.length * kLH + gap + (pillH ? pillH + gap : 0) + tLines.length * tLH + gap * 0.9 + sLines.length * sLH + rowH;
  return {
    h,
    fits: kFits && tFits && sFits && urlFits && dateFits,
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
      if (row) {
        y += gap * 0.6;
        const by = y + s.kicker * 1.05;
        setFont(ctx, 500, s.kicker, F.mono, row.tracking);
        let cx = x;
        for (const p of row.parts) {
          text(ctx, p.text, cx, by, p.color);
          cx += tw(ctx, p.text);
        }
        if (t.asOf) {
          if (row.dated) asOfDrawn = true;
          else asOfMissing = true;
        }
        if (t.url && urlAt) {
          setFont(ctx, urlAt.weight, s.kicker, urlAt.family, 0);
          text(ctx, t.url, x + w, by, '#ffffff', 'right');
        }
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

// ---------------------------------------------------------------------------
// Styled text: runs of words in different weights and colours, with inline
// numbered badges, wrapped greedily. Nothing is ever cut; `overflow` reports a
// word wider than its line so the fit check can fail.
// ---------------------------------------------------------------------------

interface Run { text?: string; badge?: number; weight?: number; color: string; /** Start a new line here. */ br?: boolean }
interface Tok { kind: 'word' | 'space' | 'badge' | 'br'; text: string; weight: number; color: string; w: number }
interface PlacedTok { tok: Tok; x: number }
interface RunLayout { lines: PlacedTok[][]; overflow: boolean }

function badgeW(size: number): number {
  return Math.round(size * 1.45);
}

function runTokens(ctx: Ctx, runs: Run[], size: number): Tok[] {
  const out: Tok[] = [];
  for (const r of runs) {
    if (r.br) {
      out.push({ kind: 'br', text: '', weight: 400, color: r.color, w: 0 });
      continue;
    }
    if (r.badge != null) {
      out.push({ kind: 'badge', text: String(r.badge), weight: 700, color: r.color, w: badgeW(size) });
      continue;
    }
    const weight = r.weight ?? 400;
    setFont(ctx, weight, size, F.body);
    for (const part of (r.text ?? '').split(/(\s+)/)) {
      if (!part) continue;
      const space = /^\s+$/.test(part);
      out.push({ kind: space ? 'space' : 'word', text: space ? ' ' : part, weight, color: r.color, w: tw(ctx, space ? ' ' : part) });
    }
  }
  return out;
}

/** Greedy wrap of styled runs; line i may be `widthOf(i)` wide. */
function wrapRuns(ctx: Ctx, runs: Run[], size: number, widthOf: (i: number) => number): RunLayout {
  const lines: PlacedTok[][] = [[]];
  let x = 0;
  let space = 0;
  let overflow = false;
  for (const t of runTokens(ctx, runs, size)) {
    if (t.kind === 'br') {
      if (lines[lines.length - 1].length) lines.push([]);
      x = 0;
      space = 0;
      continue;
    }
    if (t.kind === 'space') {
      if (lines[lines.length - 1].length) space = t.w;
      continue;
    }
    let line = lines[lines.length - 1];
    const gap = line.length ? space : 0;
    if (line.length && x + gap + t.w > widthOf(lines.length - 1)) {
      line = [];
      lines.push(line);
      x = 0;
    } else x += gap;
    if (!line.length && t.w > widthOf(lines.length - 1)) overflow = true;
    line.push({ tok: t, x });
    x += t.w;
    space = 0;
  }
  return { lines: lines.filter((l) => l.length), overflow };
}

function runLineWidth(line: PlacedTok[]): number {
  const last = line[line.length - 1];
  return last ? last.x + last.tok.w : 0;
}

function drawBadge(ctx: Ctx, label: string, x: number, baseline: number, size: number, color: string): void {
  const d = Math.round(size * 1.3);
  const cx = x + badgeW(size) / 2;
  const cy = baseline - size * 0.36;
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  setFont(ctx, 700, label.length > 1 ? Math.max(20, Math.round(size * 0.9)) : size, F.body);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Draw wrapped runs; `align` 'center' centres each line on x. */
function drawRuns(ctx: Ctx, layout: RunLayout, x: number, firstBaseline: number, lh: number, size: number, align: 'left' | 'center' = 'left'): void {
  layout.lines.forEach((line, i) => {
    const by = firstBaseline + i * lh;
    const x0 = align === 'center' ? x - runLineWidth(line) / 2 : x;
    for (const p of line) {
      if (p.tok.kind === 'badge') drawBadge(ctx, p.tok.text, x0 + p.x, by, size, p.tok.color);
      else {
        setFont(ctx, p.tok.weight, size, F.body);
        text(ctx, p.tok.text, x0 + p.x, by, p.tok.color);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Shared offices: numbered, with every district each one serves
// ---------------------------------------------------------------------------

/** A shared office on a card, numbered for the "Shared offices serve" block. */
interface SharedRef { n: number; office: string; people: LeaderPerson[] }

/** Shared offices in the order they first appear. */
function sharedRefsOf(items: Item[]): Map<string, SharedRef> {
  const out = new Map<string, SharedRef>();
  for (const it of items) {
    if (!isGroup(it) || out.has(it.key)) continue;
    out.set(it.key, { n: out.size + 1, office: headline(it), people: it.people });
  }
  return out;
}

/**
 * "Shared offices serve: ① Metro Manila 1st district office (Tier B · 7
 * districts): City of Mandaluyong Lone · …". Never cut.
 */
function sharedBlock(ctx: Ctx, refs: Map<string, SharedRef>, w: number, size: number): { h: number; fits: boolean; draw: (x: number, y: number) => void } {
  const runs: Run[] = [{ text: 'Shared offices serve:', weight: 700, color: C.ink }];
  for (const r of refs.values()) {
    runs.push(
      { text: ' ', color: C.ink3 }, { badge: r.n, color: C.tierB },
      { text: ` ${r.office}`, weight: 600, color: C.ink2 }, { text: ` (Tier B · ${r.people.length} districts):`, weight: 600, color: C.tierB },
      { text: ` ${districtsSummary(r.people)}`, weight: 400, color: C.ink3 },
    );
  }
  const lay = wrapRuns(ctx, runs, size, () => w);
  const lh = size * 1.32;
  const h = lay.lines.length * lh + size * 0.95;
  return {
    h,
    fits: !lay.overflow,
    draw(x, y) {
      ctx.fillStyle = C.ruleSoft;
      ctx.fillRect(x, y + size * 0.2, w, 2);
      drawRuns(ctx, lay, x, y + size * 0.55 + size * 0.95, lh, size);
    },
  };
}

// ---------------------------------------------------------------------------
// Footer: board note, card disclaimer, the unattributable residual (a strip of
// its own), source and link. Never cut; the layouts make room instead.
// ---------------------------------------------------------------------------

const PEOPLE_NOTE_MARK = 'do not say who asked for any project';
const SHARED_NOTE_MARK = 'Its amount is not split';

/** Set during a draw when a card needs the residual line but the data cannot give it. */
let residualMissing = false;

/** residualLine(), or null; a missing or broken figure marks the card as not fitting. */
function residualText(data: LeaderboardData, board: BoardDef): string | null {
  try {
    const r = residualLine(data, board);
    if (r && /NaN|undefined|—/.test(r)) {
      residualMissing = true;
      return null;
    }
    return r;
  } catch {
    residualMissing = true;
    return null;
  }
}

/** What a card shows: portraits (credit the photos) and amounts beside people (the disclaimer and tiers). */
interface CardPeople { photos: boolean; amounts: boolean }

interface FooterText { notes: string; residual: string | null; source: string }

function footerText(data: LeaderboardData, board: BoardDef, people: CardPeople): FooterText {
  // Cards with people beside amounts print CARD_DISCLAIMER; the board's own people
  // or shared-office note then gives way to its first other note.
  const boardNote = people.amounts
    ? board.notes.find((n) => !n.includes(PEOPLE_NOTE_MARK) && !n.includes(SHARED_NOTE_MARK)) ?? null
    : board.notes[0] ?? null;
  const notes = [boardNote, people.amounts ? CARD_DISCLAIMER : null].filter(Boolean).join(' ');
  return { notes, residual: residualText(data, board), source: sourceLines(board, people.photos).join(' ') };
}

function residualRuns(r: string): Run[] {
  const i = r.indexOf(': ');
  if (i < 0) return [{ text: r, weight: 500, color: C.ink2 }];
  return [{ text: r.slice(0, i + 1), weight: 700, color: C.ink }, { text: r.slice(i + 1), weight: 500, color: C.ink2 }];
}

interface FooterGeom {
  /** Text column. */
  x: number;
  w: number;
  /** Background span. */
  bgX: number;
  bgW: number;
  H: number;
  fs: number;
  lh: number;
  padT: number;
  padB: number;
  gap: number;
  urlMax: number;
  urlMin: number;
  /** Logo at the right end of the link line. */
  logo?: { images: ReadonlyMap<string, ShareImageSource>; h: number };
  /** The link is printed elsewhere (link previews: in the title band). */
  noUrl?: boolean;
}

function footerBlock(ctx: Ctx, g: FooterGeom, ft: FooterText, url: string): Block {
  setFont(ctx, 500, g.fs, F.body);
  const note = ft.notes ? wrap(ctx, ft.notes, g.w) : [];
  const res = ft.residual ? wrapRuns(ctx, residualRuns(ft.residual), g.fs, () => g.w - g.fs * 0.6) : null;
  setFont(ctx, 400, g.fs, F.body);
  const src = wrap(ctx, ft.source, g.w);
  const logoW = g.logo ? logoWidth(ctx, g.logo.images, SHARE_LOGO_PRIMARY, g.logo.h) + g.fs : 0;
  const u = fitUrl(ctx, url, g.w - logoW, g.urlMax, g.urlMin);
  const resPad = g.fs * 0.4;
  const resH = res ? res.lines.length * g.lh + resPad * 2 : 0;
  const urlH = g.noUrl ? 0 : g.fs * 0.6 + Math.max(u.lines.length * u.size * 1.3, g.logo ? g.logo.h : 0);
  const h = g.padT + note.length * g.lh + (note.length ? g.gap : 0) + (res ? resH + g.gap : 0) + src.length * g.lh + urlH + g.padB;
  return {
    h,
    fits: !res?.overflow,
    draw(y0) {
      ctx.fillStyle = C.paper2;
      ctx.fillRect(g.bgX, y0, g.bgW, g.H - y0);
      ctx.fillStyle = C.rule;
      ctx.fillRect(g.bgX, y0, g.bgW, 2);
      let y = y0 + g.padT;
      setFont(ctx, 500, g.fs, F.body);
      for (const l of note) { text(ctx, l, g.x, y + g.fs * 0.95, C.ink2); y += g.lh; }
      if (note.length) y += g.gap;
      if (res) {
        // The residual: its own strip, so district rows never read as the whole budget.
        ctx.fillStyle = C.accentSoft;
        ctx.fillRect(g.bgX, y, g.bgW, resH);
        ctx.fillStyle = C.accent;
        ctx.fillRect(g.bgX, y, 6, resH);
        drawRuns(ctx, res, g.x + g.fs * 0.3, y + resPad + g.fs * 0.95, g.lh, g.fs);
        y += resH + g.gap;
      }
      setFont(ctx, 400, g.fs, F.body);
      for (const l of src) { text(ctx, l, g.x, y + g.fs * 0.95, C.ink3); y += g.lh; }
      if (g.noUrl) return;
      y += g.fs * 0.6;
      drawUrl(ctx, u, g.x, y);
      if (g.logo) drawLogo(ctx, g.logo.images, SHARE_LOGO_PRIMARY, g.x + g.w, y + (u.size * 1.3 - g.logo.h) / 2 - 2, g.logo.h, 'right', false);
    },
  };
}

/** `urlInHero`: the link is on the count row of the title band, so the footer leaves it out. */
function verticalFooter(ctx: Ctx, s: Spec, input: ShareCardInput, people: CardPeople, fs: number, urlInHero = false): Block {
  const pad = s.footPad ?? 1;
  return footerBlock(ctx, {
    x: s.pad, w: s.W - s.pad * 2, bgX: 0, bgW: s.W, H: s.H,
    fs, lh: fs * (s.urlInHero ? 1.25 : 1.34), padT: fs * pad, padB: fs * (s.urlInHero ? 0.8 : 1.15) * pad + (s.footBottom ?? 0), gap: fs * 0.45,
    urlMax: fs + 2, urlMin: Math.min(fs, 22), noUrl: urlInHero,
  }, footerText(input.data, input.board, people), shareUrl(input.board, input.region ?? null));
}

// ---------------------------------------------------------------------------
// Ranked rows
// ---------------------------------------------------------------------------

interface RowGeom {
  x: number; // row left (rank column starts here)
  w: number;
  rankW: number;
  avatarD: number;
  avatarBoxW: number;
  valueW: number;
  nameSize: number;
  subSize: number;
  /** Line step for the district list lines under the first sub line. */
  subLH: number;
  valueSize: number;
  detailSize: number;
  rankSize: number;
  /** Ranking boards mark every row "Tier A" / "Tier B". */
  tierMarks: boolean;
  /** When set, shared rows show their number in the "Shared offices serve" block instead of the district list. */
  refs?: Map<string, SharedRef> | null;
  /** Draw the value bar (default true). */
  bars?: boolean;
  /** Shared rows: seat holders and tier run on as one paragraph. */
  flow?: boolean;
  /** Thin bar at the very bottom of the row. */
  barSlim?: boolean;
}

/**
 * The row headline at `size`, shrunk (to no less than 85% and never below
 * 22px) before it is ellipsized. Leaves the font set; returns the text.
 */
function fitHeadline(ctx: Ctx, it: Item, size: number, max: number, prefix = ''): string {
  const forms = [prefix + headline(it)];
  if (!it.personFirst && !isGroup(it) && it.people[0]) forms.push(prefix + shortDistrict(it.people[0]));
  const floor = Math.max(20, Math.min(size, Math.max(22, Math.round(size * 0.85))));
  for (const s0 of forms) {
    for (let z = size; z >= floor; z--) {
      setFont(ctx, 600, z, F.body, -z * 0.005);
      if (tw(ctx, s0) <= max) return s0;
    }
  }
  return ellipsize(ctx, forms[forms.length - 1], max);
}

/** "Tier B · Shared by 3 districts · not split", shortened only as far as `max` needs (the tier never goes). */
function fitTierShared(ctx: Ctx, n: number, max: number, tierMarks: boolean): string {
  const forms = tierMarks
    ? [`Tier B · ${sharedLabel(n)}`, `Tier B · Shared by ${n} districts`, `Tier B · ${n} districts`, 'Tier B']
    : [sharedLabel(n), `Shared by ${n} districts`, `Shared by ${n}`];
  for (const f of forms) if (tw(ctx, f) <= max) return f;
  return forms[forms.length - 1];
}

function rowX(g: RowGeom): { ax: number; right: number; tx: number; tmax: number; fullW: number } {
  const ax = g.x + g.rankW + g.rankSize * 0.3;
  const right = g.x + g.w - g.rankSize * 0.45;
  const tx = ax + g.avatarBoxW + g.nameSize * 0.6;
  return { ax, right, tx, tmax: right - g.valueW - g.nameSize * 0.7 - tx, fullW: right - tx };
}

/** The lines under a row's name: the district (and tier), or the tier, shared mark and every district served. */
interface RowPlan { sub: RunLayout; extra: number }

function planRow(ctx: Ctx, it: Item, g: RowGeom): RowPlan {
  const { tmax, fullW } = rowX(g);
  let runs: Run[] = [];
  const ref = g.refs?.get(it.key);
  const holderColor = C.ink3;
  if (it.personFirst) {
    // Members board: the district under the person.
    const p = it.people[0];
    setFont(ctx, 400, g.subSize, F.body);
    runs = [{ text: tw(ctx, p.district) <= tmax ? p.district : shortDistrict(p), weight: 400, color: C.ink3 }];
  } else if (isGroup(it)) {
    // Office headline; then the seat holders; then the tier, with every district served or the block number.
    setFont(ctx, 400, g.subSize, F.body);
    if (g.flow) {
      // Two names, or one where that saves a line of the district list.
      const lab = g.tierMarks ? `Tier B · ${sharedLabel(it.people.length)}` : sharedLabel(it.people.length);
      const tail: Run[] = [{ text: lab, weight: 600, color: C.tierB }, { text: ` · ${districtsSummary(it.people)}`, weight: 400, color: C.ink3 }];
      const withNames = (k: number): Run[] => [{ text: `${seatHolders({ people: it.people }, k)} · `, weight: 400, color: holderColor }, ...(ref ? [] : tail)];
      const lines = (k: number) => wrapRuns(ctx, withNames(k), g.subSize, (i) => (i === 0 ? tmax : fullW)).lines.length;
      runs = [{ text: `${seatHolders({ people: it.people }, lines(1) < lines(2) ? 1 : 2)} · `, weight: 400, color: holderColor }];
    } else runs = [{ text: fitHolders(ctx, it, tmax), weight: 400, color: holderColor }, { br: true, color: holderColor }];
    if (ref) {
      const head: Run[] = [{ text: 'Tier B', weight: 600, color: C.tierB }, { text: ' ', color: C.tierB }, { badge: ref.n, color: C.tierB }];
      const forms = [` · ${sharedLabel(it.people.length)}`, ` · Shared by ${it.people.length} districts`, ` · ${it.people.length} districts`];
      const width = (rs: Run[]) => runLineWidth(wrapRuns(ctx, rs, g.subSize, () => Infinity).lines[0] ?? []);
      let done = false;
      if (g.flow) {
        // One line if it can be: fewer names, then a shorter tier mark (the tier and the number always stay).
        search: for (const k of [2, 1]) {
          for (const extra of forms) {
            const cand: Run[] = [{ text: `${seatHolders({ people: it.people }, k)} · `, weight: 400, color: holderColor }, ...head, { text: extra, weight: 600, color: C.tierB }];
            if (width(cand) <= tmax) { runs = cand; done = true; break search; }
          }
        }
      }
      if (!done) {
        let tier = head;
        for (const extra of forms) {
          const cand = [...head, { text: extra, weight: 600, color: C.tierB }];
          if (width(cand) <= fullW) { tier = cand; break; }
        }
        runs.push(...tier);
      }
    } else {
      const lab = g.tierMarks ? `Tier B · ${sharedLabel(it.people.length)}` : sharedLabel(it.people.length);
      runs.push({ text: lab, weight: 600, color: C.tierB }, { text: ` · ${districtsSummary(it.people)}`, weight: 400, color: C.ink3 });
    }
  } else if (it.people[0]) {
    // District headline; then "Rep. … · Tier A".
    setFont(ctx, 400, g.subSize, F.body);
    runs = [{ text: seatHolders({ people: it.people }), weight: 400, color: holderColor }];
    if (g.tierMarks) runs.push({ text: ' · ', weight: 400, color: C.ink3 }, { text: 'Tier A', weight: 600, color: C.ink2 });
  }
  const sub = wrapRuns(ctx, runs, g.subSize, (i) => (i === 0 ? tmax : fullW));
  return { sub, extra: Math.max(0, sub.lines.length - 1) };
}

/**
 * One ranked row: rank, portraits, name, the district or shared-office lines,
 * value and detail, and under the text a bar on a light track, as long as
 * |value| / max |value| among the rows on the card. `h` includes the extra
 * district lines of the plan.
 */
function drawRow(ctx: Ctx, board: BoardDef, it: Item, g: RowGeom, plan: RowPlan, y: number, h: number, maxAbs: number, images: ReadonlyMap<string, ShareImageSource>): void {
  const th = valueTheme(board, it.value);
  const { ax, right, tx } = rowX(g);
  const exH = plan.extra * g.subLH;
  const baseH = h - exH;
  const barH = g.barSlim ? 4 : Math.max(5, Math.round(baseH * 0.07));
  const barGap = g.barSlim ? 1 : Math.max(4, Math.round(baseH * 0.07));
  const laneY = y + h - barH - barGap;
  // The name and first sub line are centred in the base row; extra district lines follow.
  const cy = (y + laneY - exH - (g.barSlim ? 2 : Math.max(4, baseH * 0.06))) / 2 + 1;
  // Bar on its track
  if (g.bars !== false) {
    const frac = maxAbs > 0 ? Math.max(0.006, Math.abs(it.value) / maxAbs) : 0;
    ctx.fillStyle = C.paper3;
    roundRect(ctx, tx, laneY, right - tx, barH, barH / 2);
    ctx.fill();
    ctx.fillStyle = th.solid;
    roundRect(ctx, tx, laneY, Math.max(barH, (right - tx) * frac), barH, barH / 2);
    ctx.fill();
  } else {
    ctx.fillStyle = C.ruleSoft;
    ctx.fillRect(g.x, y + h - 1, g.w, 2);
  }
  // Rank (or label) and portraits
  ctx.textBaseline = 'middle';
  if (it.label) {
    setFont(ctx, 700, Math.round(g.rankSize * 0.92), F.display);
    text(ctx, it.label, g.x, cy + 1, C.ink2);
  } else {
    setFont(ctx, 700, g.rankSize, F.display);
    ctx.fillStyle = it.rank === 1 ? th.text : C.ink3;
    drawTab(ctx, String(it.rank), g.x + g.rankW - g.rankSize * 0.55, cy + 1, 'right');
  }
  ctx.textBaseline = 'alphabetic';
  drawAvatars(ctx, images, it.people, ax, cy, g.avatarD, g.avatarBoxW, '#ffffff');
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
  // Name, then the sub lines
  const { tmax } = rowX(g);
  const lineGap = g.subSize * 0.3;
  const nh = g.nameSize + lineGap + g.subSize;
  const ny = cy - nh / 2 + g.nameSize * 0.8;
  text(ctx, fitHeadline(ctx, it, g.nameSize, tmax), tx, ny, C.ink);
  drawRuns(ctx, plan.sub, tx, ny + lineGap + g.subSize * 1.02, g.subLH, g.subSize);
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

function spotlightBlock(ctx: Ctx, s: Spec, board: BoardDef, it: Item, images: ReadonlyMap<string, ShareImageSource>, squeeze: number, tierMarks: boolean): Block {
  const k = [1, 0.84, 0.7][squeeze] ?? 0.7;
  const base = s.spot!;
  const group = isGroup(it);
  // A shared office's faces sit in a wider box: start them smaller.
  const sp = { ...base, avatar: Math.round(base.avatar * k * (group ? 0.74 : 1)), name: Math.round(base.name * (k < 1 ? 0.92 : 1)), value: Math.round(base.value * (0.7 + 0.3 * k)) };
  const x = s.pad;
  const w = s.W - s.pad * 2;
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
  const subLH = sp.sub * 1.36;
  const chipSize = Math.round(sp.sub * 0.92);
  setFont(ctx, 600, chipSize, F.body);
  const chip = group ? fitTierShared(ctx, it.people.length, tmax - chipSize * 1.2, tierMarks) : null;
  const soft = 'rgba(255,255,255,0.86)';
  // Under the place: the seat holders (and "Tier A"); a shared office then gets its tier chip and every district it serves.
  setFont(ctx, 400, sp.sub, F.body);
  const holdersRuns: Run[] = it.personFirst
    ? [{ text: it.people[0]?.district ?? '', weight: 400, color: soft }]
    : group
      ? [{ text: fitHolders(ctx, it, tmax), weight: 400, color: soft }]
      : [{ text: seatHolders({ people: it.people }), weight: 400, color: soft }, ...(tierMarks ? [{ text: ' · ', weight: 400, color: soft }, { text: 'Tier A', weight: 600, color: '#ffffff' }] : [])];
  const holders = wrapRuns(ctx, holdersRuns, sp.sub, () => tmax);
  const sub = wrapRuns(ctx, group ? [{ text: districtsSummary(it.people), weight: 400, color: soft }] : [], sp.sub, () => tmax);
  const chipH = chip ? subLH : 0;
  const detailBelow = sp.stacked && it.detail ? vw + sp.detail + dw > tmax : false;
  const valueH = sp.stacked ? sp.sub * 0.5 + sp.value * 1.0 + (detailBelow ? sp.detail * 1.35 : 0) : 0;
  const textH = nameLines.length * nLH + sp.sub * 0.4 + holders.lines.length * subLH + chipH + sub.lines.length * subLH + valueH;
  const h = Math.max(d + sp.name * 0.5, textH) + sp.name * 0.2;
  return {
    h,
    fits: !sub.overflow && !holders.overflow,
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
      // Name, tier and districts
      let y = cy - textH / 2;
      setFont(ctx, 700, sp.name, F.display, -sp.name * 0.01);
      for (const l of nameLines) { text(ctx, l, tx, y + sp.name * 0.86, '#ffffff'); y += nLH; }
      y += sp.sub * 0.4;
      drawRuns(ctx, holders, tx, y + sp.sub * 1.0, subLH, sp.sub);
      y += holders.lines.length * subLH;
      if (chip) {
        drawChip(ctx, chip, tx, y + (subLH - chipSize * 1.6) / 2, chipSize, '#ffffff', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.55)');
        y += subLH;
      }
      drawRuns(ctx, sub, tx, y + sp.sub * 1.0, subLH, sp.sub);
      y += sub.lines.length * subLH;
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
  /** False when a district list cannot be laid out whole. */
  fits?: boolean;
  draw: (y: number, h: number) => void;
}

/**
 * Hero on top, body in the middle, footer at the bottom. Tries the largest
 * title, a smaller spotlight, a footer a pixel or two smaller, a subtitle a
 * pixel or two smaller, until the body gets its minimum height. Returns whether
 * it fitted; `dry` only measures.
 */
function layoutVertical(ctx: Ctx, s: Spec, input: ShareCardInput, t: HeroText, body: (squeeze: number) => { extra: Block | null; body: Body }, people: CardPeople, dry = false): boolean {
  const images = input.images ?? new Map();
  const x = s.pad;
  const w = s.W - s.pad * 2;
  const footMin = s.footMin ?? 22;
  // Link previews: the link sits beside the full count row when it fits there; else in the footer's last
  // row; and only if the card cannot fit that way, beside a shortened count row (count and date stay together).
  type Mode = { t: HeroText; urlInHero: boolean };
  const modes: Mode[] = [{ t, urlInHero: false }];
  if (s.urlInHero) {
    const url = shareUrl(input.board, input.region ?? null);
    if (urlBeside(ctx, s, countRow(ctx, s, t, w), url, w)) modes.splice(0, 1, { t: { ...t, url }, urlInHero: true });
    else {
      // The link in Inter (its narrower face) leaves the count row the most room.
      setFont(ctx, 600, s.kicker, F.body, 0);
      const uw = tw(ctx, url);
      if (uw < w * 0.7) modes.push({ t: { ...t, url, rowMax: w - uw - s.kicker * 1.5 }, urlInHero: true });
    }
  }
  const heroHeight = (hero: Block, parts: { extra: Block | null }) => s.heroTop + hero.h + s.heroBottom + (parts.extra ? parts.extra.h + s.heroBottom * 1.6 : 0);
  type Choice = { hero: Block; parts: { extra: Block | null; body: Body }; heroH: number; footer: Block };
  let chosen: Choice | null = null;
  let fallback: Choice | null = null;
  let footers: Block[] = [];
  for (const mode of modes) {
    t = mode.t;
    footers = Array.from({ length: Math.max(1, s.foot - footMin + 1) }, (_, i) => verticalFooter(ctx, s, input, people, s.foot - i, mode.urlInHero));
    if (searchMode()) break;
  }
  function searchMode(): boolean {
    search: for (let squeeze = 0; squeeze <= 3; squeeze++) {
      const parts = body(squeeze);
      if (parts.body.fits === false || parts.extra?.fits === false) continue;
      for (const f of footers) {
        for (let size = s.titleMax; size >= s.titleMin; size -= 2) {
          // The subtitle may drop a pixel or two (never below the format's floor) where that saves a line.
          const subFloor = Math.min(s.sub, Math.max(s.footMin ?? 22, s.sub - 2));
          for (let sub = s.sub; sub >= subFloor; sub--) {
            const hero = heroBlock(ctx, sub === s.sub ? s : { ...s, sub }, t, size, x, w, s.subLines, { images, h: s.logo });
            const heroH = heroHeight(hero, parts);
            if (!hero.fits) continue;
            if (!fallback || heroH + f.h < fallback.heroH + fallback.footer.h) fallback = { hero, parts, heroH, footer: f };
            if (s.H - heroH - f.h >= parts.body.minH) { chosen = { hero, parts, heroH, footer: f }; break search; }
          }
        }
      }
    }
    return !!chosen;
  }
  if (dry) return !!chosen;
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
  if (footer.fits === false || parts.body.fits === false || parts.extra?.fits === false) layoutFits = false;
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
  return !!chosen;
}

/**
 * Rows under the hero. A shared office's row grows by the lines its district
 * list needs; bars are scaled to `maxAbs` (the largest |value| on the card,
 * spotlight included).
 */
function rowsBody(ctx: Ctx, s: Spec, board: BoardDef, items: Item[], images: ReadonlyMap<string, ShareImageSource>, maxAbs: number, tierMarks: boolean, refs: Map<string, SharedRef> | null = null): Body {
  const x = s.pad - s.rank * 0.2;
  const w = s.W - x * 2;
  const n = items.length;
  const padY = s.rowPadY ?? s.rowSub * 0.9;
  const maxPeople = Math.max(1, ...items.map((i) => i.people.length));
  const labelled = items.some((i) => i.label);
  // Labelled rows have no bar lane under the text, so they can be a little shorter.
  const rowMin = labelled ? s.rowMin - (s.rowBarSlim ? 10 : 6) : s.rowMin;
  const avatarD = Math.round(Math.min(s.avatar, rowMin - 10));
  const g: RowGeom = {
    x, w,
    flow: !!s.rowFlow,
    barSlim: !!s.rowBarSlim,
    refs: refs && refs.size ? refs : null,
    // Labelled rows ("18th") compare different spans: no bars.
    bars: !labelled,
    rankW: Math.round(s.rank * (labelled ? 2.5 : 1.9)),
    avatarD,
    avatarBoxW: avatarBoxWidth(maxPeople, avatarD),
    valueW: 0,
    nameSize: s.rowName,
    subSize: s.rowSub,
    subLH: s.rowSub * 1.28,
    valueSize: s.rowValue,
    detailSize: s.rowDetail,
    rankSize: s.rank,
    tierMarks,
  };
  g.valueW = valueColumnWidth(ctx, board, items, g.valueSize, g.detailSize, w * 0.4);
  const plans = items.map((it) => planRow(ctx, it, g));
  const exTotal = plans.reduce((a, p) => a + p.extra, 0) * g.subLH;
  return {
    minH: n * rowMin + exTotal + padY * 2,
    idealH: n * s.rowMax + exTotal + padY * 2,
    fits: plans.every((p) => !p.sub.overflow),
    draw(y0, hAvail) {
      const rowMax = n <= 4 ? s.rowMax * 1.25 : s.rowMax;
      const rowH = Math.max(rowMin, Math.min(rowMax, (hAvail - padY * 2 - exTotal) / Math.max(1, n)));
      // A short list sits a little above the middle of the space instead of leaving a gap at the bottom.
      const spare = Math.max(0, hAvail - padY * 2 - rowH * n - exTotal);
      let y = y0 + padY + spare * 0.4;
      items.forEach((it, i) => {
        const h = rowH + plans[i].extra * g.subLH;
        drawRow(ctx, board, it, g, plans[i], y, h, maxAbs, images);
        y += h;
      });
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

const NO_PEOPLE: CardPeople = { photos: false, amounts: false };

/**
 * Ranking and members boards. Rows are dropped from the bottom (and the count
 * line says "Top K of N") until every row, with every district it serves,
 * fits whole; fewer than three rows marks the card for review.
 */
function drawRankingVertical(ctx: Ctx, s: Spec, format: ShareFormat, input: ShareCardInput): void {
  const { data, board } = input;
  const region = input.region ?? null;
  const images = input.images ?? new Map();
  const { items: all, eligible } = rankingItems(data, board, region, SHARE_FORMATS[format].rows);
  if (!all.length) {
    layoutVertical(ctx, s, input, heroText(board, region, null), () => ({ extra: null, body: emptyBody(ctx, s, board, region) }), NO_PEOPLE);
    return;
  }
  const tierMarks = board.kind === 'ranking';
  const people: CardPeople = { photos: true, amounts: board.kind === 'ranking' };
  const attempt = (k: number, useBlock: boolean, dry: boolean) => {
    const items = all.slice(0, k);
    const maxAbs = Math.max(...items.map((i) => Math.abs(i.value)));
    const t = heroText(board, region, countLine(board, k, eligible));
    // Squeeze 0–2 shrink the #1 spotlight; 3 folds #1 back into the list.
    return layoutVertical(ctx, s, input, t, (squeeze) => {
      const spot = s.spot && items.length >= 2 && squeeze < 3 ? items[0] : null;
      const listed = spot ? items.slice(1) : items;
      const refs = useBlock ? sharedRefsOf(listed) : null;
      const rows = rowsBody(ctx, s, board, listed, images, maxAbs, tierMarks, refs);
      return {
        extra: spot ? spotlightBlock(ctx, s, board, spot, images, squeeze, tierMarks) : null,
        body: refs && refs.size ? withSharedBlock(ctx, rows, refs, s.pad, s.W - s.pad * 2, s.rowSub) : rows,
      };
    }, people, dry);
  };
  // Most rows first; each shared office lists its districts in its row, else in the block under the rows.
  const minRows = Math.min(format === 'landscape' ? 2 : 3, all.length);
  for (let k = all.length; k >= 1; k--) {
    for (const useBlock of [false, true]) {
      if (!attempt(k, useBlock, true)) continue;
      if (k < minRows) layoutSparse = true;
      attempt(k, useBlock, false);
      return;
    }
  }
  layoutFits = false;
  attempt(1, true, false);
}

// --- by Congress -------------------------------------------------------------

const CONGRESS_LABEL: Record<'18' | '19' | '20', string> = { '18': '18th Congress', '19': '19th Congress', '20': '20th Congress' };

type CongressCols = ReturnType<typeof rankByCongress>;

/** Shared offices in the order they first appear (Congress by Congress, rank by rank). */
function sharedRefs(cols: CongressCols): Map<string, SharedRef> {
  return sharedRefsOf(cols.flatMap((c) => c.rows.map((r) => entryItem(r.rank, r.entry, r.value))));
}

/** The tier line of a by-Congress cell: "Tier A", or "Tier B" and the shared office's number. */
/** The tier line of a by-Congress cell: "Tier A", or "Tier B", the shared office's number and "Shared by N" where it fits. */
function cellTierRuns(ctx: Ctx, it: Item, ref: SharedRef | undefined, size: number, max: number): Run[] {
  if (!isGroup(it)) return [{ text: 'Tier A', weight: 600, color: C.ink2 }];
  const base: Run[] = [{ text: 'Tier B', weight: 600, color: C.tierB }, ...(ref ? [{ text: ' ', color: C.tierB }, { badge: ref.n, color: C.tierB }] : [])];
  for (const extra of [` · Shared by ${it.people.length}`, ` · ${it.people.length} districts`]) {
    const runs = [...base, { text: extra, weight: 600, color: C.tierB }];
    if (runLineWidth(wrapRuns(ctx, runs, size, () => Infinity).lines[0] ?? []) <= max) return runs;
  }
  return base;
}

/** The by-Congress cells cannot hold a shared office's district list, so the lists sit in one block under the cells. */
function withSharedBlock(ctx: Ctx, main: Body, refs: Map<string, SharedRef>, x: number, w: number, size: number): Body {
  if (!refs.size) return main;
  const blk = sharedBlock(ctx, refs, w, size);
  return {
    minH: main.minH + blk.h,
    idealH: main.idealH + blk.h,
    fits: main.fits !== false && blk.fits,
    draw(y0, h) {
      main.draw(y0, h - blk.h);
      blk.draw(x, y0 + h - blk.h);
    },
  };
}

function congressCount(k: number, full: CongressCols): string | null {
  return full.some((c) => c.rows.length > k) ? `Top ${k} shown for each Congress` : null;
}

/** Portrait and story: one band per Congress, a card per office with its faces. */
function congressBands(ctx: Ctx, s: Spec, board: BoardDef, cols: CongressCols, images: ReadonlyMap<string, ShareImageSource>, refs: Map<string, SharedRef>): Body {
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
  const cells = cols.flatMap((c) => c.rows.map((r) => entryItem(r.rank, r.entry, r.value)));
  // Every cell gets the same slots so values line up: names up to three lines (four on stories), district up to two.
  setFont(ctx, 600, s.rowSub, F.body);
  const maxNameLines = s.H >= 1900 ? 4 : 3;
  const nameLinesN = Math.min(maxNameLines, Math.max(2, ...cells.map((it) => wrap(ctx, headline(it), textW).length)));
  setFont(ctx, 400, s.rowSub, F.body);
  const subLinesN = Math.min(2, Math.max(1, ...cells.map((it) => (isGroup(it) ? 1 : wrap(ctx, seatHolders({ people: it.people }), textW).length))));
  const lineH = s.rowSub * (nameLinesN > 2 ? 1.13 : 1.25);
  const slots = nameLinesN + subLinesN + 1;
  // The bar under each value is dropped only when keeping it would shrink the faces below faceMin.
  const textNoBar = lineH * slots + s.rowValue * 1.2 + 8;
  const cardMinH = faceMin + textNoBar + 10;
  let overflow = false;
  return {
    minH: cols.length * (headH + cardMinH) + s.rowSub * 2,
    idealH: cols.length * (headH + cardMinH + barLane) * 1.2,
    get fits() { return !overflow; },
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
          // Name (office for a shared group), district or shared mark, tier: centred in fixed slots
          const slotTop = ay + d / 2;
          setFont(ctx, 600, s.rowSub, F.body);
          const nl = wrap(ctx, headline(it), textW, nameLinesN);
          if (wrap(ctx, headline(it), textW).length > nameLinesN) overflow = true;
          setFont(ctx, 400, s.rowSub, F.body);
          const subL = group ? [fitHolders(ctx, it, textW)] : wrap(ctx, seatHolders({ people: it.people }), textW, subLinesN);
          const used = nl.length + subL.length + 1;
          let ty = slotTop + lineH + ((slots - used) * lineH) / 2;
          setFont(ctx, 600, s.rowSub, F.body);
          for (const l of nl) { text(ctx, l, cx, ty, C.ink, 'center'); ty += lineH; }
          setFont(ctx, 400, s.rowSub, F.body);
          for (const l of subL) { text(ctx, l, cx, ty, C.ink3, 'center'); ty += lineH; }
          drawRuns(ctx, wrapRuns(ctx, cellTierRuns(ctx, it, refs.get(r.entry.key), s.rowSub, textW), s.rowSub, () => textW), cx, ty, lineH, s.rowSub, 'center');
          ty = slotTop + lineH * slots + s.rowValue * 1.2;
          setFont(ctx, 700, s.rowValue, F.display, -s.rowValue * 0.01);
          ctx.fillStyle = th.text;
          drawTab(ctx, formatValue(r.value, board.value), cx, ty, 'center');
          if (!withBars) return;
          const bw = innerW - s.rowSub * 1.2;
          const bby = ty + s.rowSub * 0.45;
          ctx.fillStyle = C.paper3;
          roundRect(ctx, cx - bw / 2, bby, bw, barH, barH / 2);
          ctx.fill();
          ctx.fillStyle = th.solid;
          roundRect(ctx, cx - bw / 2, bby, Math.max(barH, bw * frac), barH, barH / 2);
          ctx.fill();
        });
      });
    },
  };
}

/**
 * The second line of a by-Congress row: the district and "Tier A" (the
 * district is shortened, never the tier), or "Tier B", the shared office's
 * number and "Shared by N" where it fits.
 */
function cellSubRuns(ctx: Ctx, it: Item, ref: SharedRef | undefined, size: number, max: number): Run[] {
  const sep = ' · ';
  if (!isGroup(it)) {
    // "Rep. Ferdinand Alexander Marcos · Tier A": the name is shortened, never the tier.
    setFont(ctx, 600, size, F.body);
    const tailW = tw(ctx, 'Tier A');
    setFont(ctx, 400, size, F.body);
    const room = max - tailW - tw(ctx, sep) - 2;
    return [{ text: fitHolders(ctx, it, room), weight: 400, color: C.ink3 }, { text: sep, weight: 400, color: C.ink3 }, { text: 'Tier A', weight: 600, color: C.ink2 }];
  }
  // "Tier B ① · Reps. A +6" (names as far as they fit).
  const base: Run[] = [{ text: 'Tier B', weight: 600, color: C.tierB }, ...(ref ? [{ text: ' ', color: C.tierB }, { badge: ref.n, color: C.tierB }] : [])];
  const baseW = runLineWidth(wrapRuns(ctx, base, size, () => Infinity).lines[0] ?? []);
  setFont(ctx, 400, size, F.body);
  const room = max - baseW - tw(ctx, sep) - 2;
  if (room < size * 4) return base;
  return [...base, { text: sep, weight: 400, color: C.ink3 }, { text: fitHolders(ctx, it, room), weight: 400, color: C.ink3 }];
}

/**
 * Three columns, one per Congress (portrait, square, landscape). Rows carry the
 * name, the tier with the district or the shared office's number, and the
 * value with a bar.
 */
function congressColumns(ctx: Ctx, board: BoardDef, cols: CongressCols, images: ReadonlyMap<string, ShareImageSource>, x: number, w: number, sizes: { name: number; sub: number; value: number; head: number; avatar: number }, refs: Map<string, SharedRef>): Body {
  const perCol = Math.max(1, ...cols.map((c) => c.rows.length));
  const gap = sizes.sub * 1.1;
  const colW = (w - gap * (cols.length - 1)) / cols.length;
  setFont(ctx, 700, sizes.head, F.display);
  const labelW = Math.max(...cols.map((c) => tw(ctx, CONGRESS_LABEL[c.congress])));
  setFont(ctx, 500, sizes.sub, F.mono, sizes.sub * 0.04);
  const yearsW = Math.max(...cols.map((c) => tw(ctx, c.years)));
  const oneLineHead = labelW + yearsW + sizes.sub <= colW;
  const headH = sizes.head * (oneLineHead ? 1.75 : 2.6);
  const d0 = sizes.avatar;
  const rowNeed = Math.max(sizes.name * 1.2 + sizes.sub * 1.3 + sizes.value * 1.1 + 14, d0 + 12);
  return {
    minH: headH + perCol * rowNeed + sizes.sub,
    idealH: headH + perCol * rowNeed * 1.2 + sizes.sub,
    draw(y0, hAvail) {
      const top = y0 + sizes.sub * 0.5;
      const rowH = Math.min((hAvail - headH - sizes.sub) / perCol, rowNeed * 1.3);
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
          ctx.fillStyle = C.paper2;
          roundRect(ctx, cx, ry + 3, colW, rowH - 6, 8);
          ctx.fill();
          const d = Math.min(d0, rowH - 12);
          const group = isGroup(it);
          const boxW = group ? Math.round(d * 1.6) : d;
          drawAvatars(ctx, images, it.people, cx + 6, cyy, d, boxW, '#ffffff');
          const tx = cx + 6 + boxW + sizes.sub * 0.5;
          const tmax = cx + colW - tx - 8;
          const blockH = rowNeed - 14;
          let ty = cyy - blockH / 2 + sizes.name * 0.85;
          // "1. Metro Manila 1st district office" / "1. Ilocos Norte, 1st District" (shrinks before it is cut)
          text(ctx, fitHeadline(ctx, it, sizes.name, tmax, `${r.rank}. `), tx, ty, C.ink);
          ty += sizes.sub * 1.3;
          drawRuns(ctx, wrapRuns(ctx, cellSubRuns(ctx, it, refs.get(r.entry.key), sizes.sub, tmax), sizes.sub, () => Infinity), tx, ty, sizes.sub * 1.3, sizes.sub);
          ty += sizes.value * 1.1;
          setFont(ctx, 700, sizes.value, F.display);
          ctx.fillStyle = th.text;
          const vw = drawTab(ctx, formatValue(r.value, board.value), tx, ty, 'left');
          // Bar beside the value, ∝ value within this Congress
          const bx0 = tx + vw + sizes.sub * 0.6;
          const bw = cx + colW - 12 - bx0;
          const bh = Math.max(5, Math.round(sizes.sub * 0.28));
          if (bw > sizes.sub * 2) {
            const frac = maxAbs > 0 ? Math.abs(r.value) / maxAbs : 0;
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

/**
 * The by-Congress board, vertical formats. Shows the top five under each
 * Congress where they fit with every tier and shared-office list, else fewer
 * (and the count line says so).
 */
function drawCongressVertical(ctx: Ctx, s: Spec, format: ShareFormat, input: ShareCardInput): void {
  const { data, board } = input;
  const region = input.region ?? null;
  const images = input.images ?? new Map();
  const full = rankByCongress(data, { region, limit: 5 });
  if (!full.some((c) => c.rows.length)) {
    layoutVertical(ctx, s, input, heroText(board, region, null), () => ({ extra: null, body: emptyBody(ctx, s, board, region) }), NO_PEOPLE);
    return;
  }
  const people: CardPeople = { photos: true, amounts: true };
  type Form = 'bands' | 'columns';
  const attempt = (k: number, form: Form, dry: boolean) => {
    const cols = rankByCongress(data, { region, limit: k });
    const refs = sharedRefs(cols);
    const main = form === 'columns'
      ? congressColumns(ctx, board, cols, images, s.pad, s.W - s.pad * 2, { name: 22, sub: 22, value: format === 'story' ? 30 : 26, head: 28, avatar: format === 'story' ? 60 : 48 }, refs)
      : congressBands(ctx, s, board, cols, images, refs);
    return layoutVertical(ctx, s, input, heroText(board, region, congressCount(k, full)), () => ({
      extra: null,
      body: withSharedBlock(ctx, main, refs, s.pad, s.W - s.pad * 2, s.rowSub),
    }), people, dry);
  };
  // Stories have the height for a card per office; portrait and square use the compact columns.
  const forms: Form[] = format === 'story' ? ['bands', 'columns'] : ['columns'];
  const most = Math.max(...full.map((c) => c.rows.length));
  for (let k = most; k >= 1; k--) {
    for (const form of forms) {
      if (!attempt(k, form, true)) continue;
      if (k < Math.min(2, most)) layoutSparse = true;
      attempt(k, form, false);
      return;
    }
  }
  layoutFits = false;
  attempt(1, 'columns', false);
}

// --- shift (NEP vs House bill by office kind) -----------------------------------

type SliceKey = 'deo' | 'central' | 'regional' | 'office_change' | 'no_office';

/** One part of the shift card: one or more slices of totals.by_office_kind, added up. */
interface ShiftKind { key: string; keys: SliceKey[]; label: string; color: string; note?: string; dark?: boolean }

const KINDS: readonly ShiftKind[] = [
  { key: 'deo', keys: ['deo'], label: 'District offices', color: C.accent },
  { key: 'central', keys: ['central'], label: 'Central Office', color: C.central },
  { key: 'regional', keys: ['regional'], label: 'Regional offices', color: C.regional, dark: true },
];

/**
 * Lines whose NEP and House bill sides name different office groups, and the
 * few lines that name no office: held out of every district. Shown so the
 * parts add up to the whole.
 */
const HELD_OUT_KIND: ShiftKind = {
  key: 'held_out', keys: ['office_change', 'no_office'], label: 'Lines that changed office or name no office', color: '#a3a9b5', note: 'held out of every district', dark: true,
};

function shiftKinds(data: LeaderboardData): readonly ShiftKind[] {
  const k = data.totals.by_office_kind as Partial<Record<SliceKey, LeaderSlice>>;
  const held = HELD_OUT_KIND.keys.filter((key) => k[key]);
  return held.length ? [...KINDS, { ...HELD_OUT_KIND, keys: held }] : KINDS;
}

function kindSum(data: LeaderboardData, kk: ShiftKind, f: 'nep_php' | 'hgab3_php'): number {
  const k = data.totals.by_office_kind as Partial<Record<SliceKey, LeaderSlice>>;
  return kk.keys.reduce((a, key) => a + (k[key]?.[f] ?? 0), 0);
}

interface ShiftGeom { x: number; w: number; label: number; barH: number; gapH: number; statName: number; statValue: number; statSub: number; statGap: number; shares: boolean }

/**
 * Two bars on one scale (NEP above, House bill below), each split by office
 * kind, with each kind's slice flowing from one bar to the other; then one
 * line per kind with the peso change.
 */
function shiftBody(ctx: Ctx, data: LeaderboardData, g: ShiftGeom): Body {
  const KINDS = shiftKinds(data);
  const nepTotal = KINDS.reduce((a, kk) => a + kindSum(data, kk, 'nep_php'), 0);
  const houseTotal = KINDS.reduce((a, kk) => a + kindSum(data, kk, 'hgab3_php'), 0);
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
        { label: 'NEP', total: nepTotal, get: (kk: ShiftKind) => kindSum(data, kk, 'nep_php') },
        { label: 'House bill', total: houseTotal, get: (kk: ShiftKind) => kindSum(data, kk, 'hgab3_php') },
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
            ctx.fillStyle = kk.dark ? C.ink : '#ffffff';
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
        const nep = kindSum(data, kk, 'nep_php');
        const house = kindSum(data, kk, 'hgab3_php');
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
        // Lines that changed office: say they are held out of every district instead of a share.
        const share = kk.note ?? `${pctText(sh0)} → ${pctText(sh1)} of the total`;
        if ((g.shares || kk.note) && nx + fw + g.statSub * 1.5 + tw(ctx, share) <= x + w) text(ctx, share, x + w, l2, C.ink3, 'right');
        else if (kk.note) {
          // No room beside the figures: the note goes on its own line.
          text(ctx, share, nx, l2 + g.statSub * 1.3, C.ink3);
        }
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
      barH: Math.round((format === 'square' ? 66 : 74) * big), gapH: Math.round((format === 'square' ? 48 : 104) * big),
      statName: Math.round(30 * big), statValue: Math.round(50 * big), statSub: Math.max(22, Math.round(23 * big)), statGap: Math.round((format === 'square' ? 16 : 30) * big), shares: true,
    }),
  }), NO_PEOPLE);
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
      ? { name: 22, value: 22, rank: 22, rowMin: 27, rowMax: 46 }
      : { name: 25, value: 25, rank: 22, rowMin: 36, rowMax: 52 };
  layoutVertical(ctx, s, input, t, () => ({ extra: null, body: regionsBody(ctx, input.board, rows, s.pad, s.W - s.pad * 2, sz) }), NO_PEOPLE);
}

// ---------------------------------------------------------------------------
// Landscape (1200 × 630): title panel on the left, the board on the right
// ---------------------------------------------------------------------------

const L = {
  W: 1200, H: 630, panelW: 432, pad: 36, kicker: 20, titleMax: 48, titleMin: 30, sub: 21,
  rowName: 25, rowSub: 22, rowValue: 30, rowDetail: 22, rank: 24, avatar: 46, rowMin: 62, rowMax: 96, foot: 22, logo: 34,
};

/** Ranking, members and by-Congress link previews: a title band across the top, rows, then the footer. */
const LAND: Spec = {
  W: 1200, H: 630, pad: 40, heroTop: 14, heroBottom: 11,
  kicker: 20, titleMax: 42, titleMin: 30, sub: 20, subLines: 2,
  rowName: 23, rowSub: 20, rowValue: 27, rowDetail: 20, rank: 23, avatar: 42, rowMin: 58, rowMax: 84,
  spot: null,
  foot: 20, footMin: 20, logo: 28, footPad: 0.7,
  urlInHero: true, rowFlow: true, rowPadY: 4, rowBarSlim: true, heroTight: true,
};

/** The by-Congress link preview: one row per Congress (its top office), labelled "18th", with the years beside the value. */
function drawCongressLandscape(ctx: Ctx, input: ShareCardInput): void {
  const { data, board } = input;
  const region = input.region ?? null;
  const images = input.images ?? new Map();
  const s = LAND;
  const items: Item[] = rankByCongress(data, { region, limit: 1 }).filter((c) => c.rows.length).map((c) => ({
    ...entryItem(c.rows[0].rank, c.rows[0].entry, c.rows[0].value), label: `${c.congress}th`, detail: c.years,
  }));
  if (!items.length) {
    layoutVertical(ctx, s, input, heroText(board, region, null), () => ({ extra: null, body: emptyBody(ctx, s, board, region) }), NO_PEOPLE);
    return;
  }
  const t = heroText(board, region, congressCount(1, rankByCongress(data, { region, limit: 5 })));
  const people: CardPeople = { photos: true, amounts: true };
  const maxAbs = Math.max(...items.map((i) => Math.abs(i.value)));
  const attempt = (useBlock: boolean, dry: boolean) => layoutVertical(ctx, s, input, t, () => {
    const refs = useBlock ? sharedRefsOf(items) : null;
    const rows = rowsBody(ctx, s, board, items, images, maxAbs, true, refs);
    return { extra: null, body: refs && refs.size ? withSharedBlock(ctx, rows, refs, s.pad, s.W - s.pad * 2, s.rowSub) : rows };
  }, people, dry);
  if (attempt(false, true)) attempt(false, false);
  else attempt(true, false);
}

/** The footer of a landscape card: full width under both panels, logo beside the link. */
function landscapeFooter(ctx: Ctx, input: ShareCardInput, people: CardPeople, fs: number): Block {
  return footerBlock(ctx, {
    x: L.pad, w: L.W - L.pad * 2, bgX: 0, bgW: L.W, H: L.H,
    fs, lh: fs * 1.3, padT: fs * 0.75, padB: fs * 0.75, gap: fs * 0.4, urlMax: fs, urlMin: fs,
    logo: { images: input.images ?? new Map(), h: 30 },
  }, footerText(input.data, input.board, people), shareUrl(input.board, input.region ?? null));
}

/** Shift and regions link previews: title panel on the left, the chart on the right, the footer across. */
function drawLandscape(ctx: Ctx, input: ShareCardInput): void {
  const { data, board } = input;
  const W = L.W;
  const H = L.H;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  const pw = L.panelW;
  const rx = pw + L.pad - 6;
  const rw = W - rx - L.pad + 6;
  const bodyTop = 20;
  let regionRowsAll: RegionRow[] = [];
  let count: string | null = null;
  if (board.kind === 'regions') {
    regionRowsAll = regionRows(data, board);
    count = regionsCount(regionRowsAll, Math.min(regionRowsAll.length, 8));
  }
  const s: Spec = { ...SPECS.square, W: pw, H, pad: L.pad, kicker: L.kicker, sub: L.sub, subLines: 6, titleMax: L.titleMax, titleMin: L.titleMin };
  const lx = L.pad;
  const lw = pw - L.pad * 2;
  const t = heroText(board, null, count);
  const heroFor = (panelH: number): Block | null => {
    for (let size = L.titleMax; size >= L.titleMin; size -= 2) {
      const h = heroBlock(ctx, s, t, size, lx, lw, 8, null, 3, 4);
      if (h.fits && h.h <= panelH - L.pad * 1.5) return h;
    }
    return null;
  };
  let footer = landscapeFooter(ctx, input, NO_PEOPLE, L.foot);
  let hero = heroFor(H - footer.h);
  for (let fs = L.foot - 1; fs >= 20 && !hero; fs--) {
    footer = landscapeFooter(ctx, input, NO_PEOPLE, fs);
    hero = heroFor(H - footer.h);
  }
  if (!hero) {
    layoutFits = false;
    hero = heroBlock(ctx, s, t, L.titleMin, lx, lw, 8, null, 3, 5);
  }
  if (footer.fits === false) layoutFits = false;
  const panelH = H - footer.h;
  const bodyH = panelH - bodyTop;
  drawHeroBg(ctx, 0, 0, pw, panelH, { cx: pw * 0.92, cy: H * 0.04, R: pw * 0.78 });
  hero.draw(L.pad * 0.8);
  if (board.kind === 'shift') {
    const body = shiftBody(ctx, data, { x: rx, w: rw, label: 21, barH: 34, gapH: 28, statName: 21, statValue: 28, statSub: 20, statGap: 4, shares: false });
    if (body.minH > bodyH + 8) layoutFits = false;
    body.draw(bodyTop - 8, bodyH + 8);
  } else if (board.kind === 'regions') {
    const body = regionsBody(ctx, board, regionRowsAll, rx, rw, { name: 21, value: 21, rank: 21, rowMin: 27, rowMax: 46 }, 8);
    if (body.minH > bodyH) layoutFits = false;
    body.draw(bodyTop - 8, bodyH + 4);
  }
  footer.draw(panelH);
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export interface ShareCardReport {
  /**
   * False when some layout had to fall back (a title cut, rows squeezed, fewer
   * than three rows), when a district list or the residual could not be laid
   * out whole, when the data has no residual figures yet, or when the as-of
   * row is missing or does not fit its line.
   */
  fits: boolean;
  /** Fewer rows than usual fitted (the count line says "Top K of N"); not a defect, worth a look. */
  sparse: boolean;
}

/** Paint one share card at the format's native size. `ctx.canvas` must already be that size. */
export function drawShareCard(ctx: CanvasRenderingContext2D, input: ShareCardInput): ShareCardReport {
  layoutFits = true;
  layoutSparse = false;
  residualMissing = false;
  cardAsOf = asOfText(input.data);
  const built = new Date(input.data.built_at);
  cardAsOfShort = cardAsOf && !Number.isNaN(built.getTime())
    ? `As of ${built.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}`
    : cardAsOf;
  asOfMissing = !cardAsOf;
  asOfDrawn = false;
  const { board, format } = input;
  const region = board.regionFilter ? input.region ?? null : null;
  const inp: ShareCardInput = { ...input, region };
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (format === 'landscape') {
    if (board.kind === 'congress') drawCongressLandscape(ctx, inp);
    else if (board.kind === 'ranking' || board.kind === 'members') drawRankingVertical(ctx, LAND, format, inp);
    else drawLandscape(ctx, inp);
  } else {
    const s = SPECS[format];
    if (board.kind === 'shift') drawShiftVertical(ctx, s, format, inp);
    else if (board.kind === 'regions') drawRegionsVertical(ctx, s, format, inp);
    else if (board.kind === 'congress') drawCongressVertical(ctx, s, format, inp);
    else drawRankingVertical(ctx, s, format, inp);
  }
  ctx.restore();
  return { fits: layoutFits && !residualMissing && !asOfMissing && asOfDrawn, sparse: layoutSparse };
}

/** Every image a card draws: the portraits of the rows shown (up to three per shared office) and the logo. */
export function shareCardImageUrls(data: LeaderboardData, board: BoardDef, format: ShareFormat, region?: string | null): string[] {
  const r = board.regionFilter ? region ?? null : null;
  const urls = new Set<string>();
  urls.add(SHARE_LOGO_WHITE);
  if (format === 'landscape') urls.add(SHARE_LOGO_PRIMARY);
  const add = (people: LeaderPerson[]) => { for (const p of people.slice(0, 3)) if (p.portrait_url) urls.add(p.portrait_url); };
  if (board.kind === 'ranking' || board.kind === 'members') {
    for (const it of rankingItems(data, board, r, SHARE_FORMATS[format].rows).items) add(it.people);
  } else if (board.kind === 'congress') {
    for (const c of rankByCongress(data, { region: r, limit: format === 'landscape' ? 1 : 5 })) for (const row of c.rows) add(row.entry.people);
  }
  return [...urls];
}

/** "Ilocos Norte, 1st District (Ferdinand Alexander Marcos), Tier A" or, for a shared office, the office, its tier and every district it serves. */
function altItem(it: Item, tiers: boolean): string {
  if (it.personFirst) {
    const p = it.people[0];
    return `${personName(p)} (${p.district})`;
  }
  const holders = seatHolders({ people: it.people });
  if (!isGroup(it)) return `${headline(it)}${holders ? ` (${holders})` : ''}${tiers ? `, ${tierText(it, true)}` : ''}`;
  const tier = tiers ? tierText(it) : `shared by ${it.people.length} districts, not split`;
  return `${headline(it)}, ${tier}: ${it.people.map((p) => p.district).join('; ')}${holders ? ` (${holders})` : ''}`;
}

/** Text alternative for the card: title, scope, the top three with their values and tiers, the residual and the disclaimer. */
export function shareCardAlt(data: LeaderboardData, board: BoardDef, format: ShareFormat, region?: string | null): string {
  void format; // Same text for every format: the field and the top three.
  const r = board.regionFilter ? region ?? null : null;
  const where = r ? ` ${regionName(r)}.` : '';
  const asOf = asOfText(data);
  const head = `${board.title}.${where}${asOf ? ` ${asOf}.` : ''} ${board.subtitle}`;
  const tiers = board.kind === 'ranking' || board.kind === 'congress';
  let top: string[] = [];
  let people = false;
  if (board.kind === 'ranking' || board.kind === 'members') {
    const { items, eligible } = rankingItems(data, board, r, 3);
    if (!items.length) top = [`${emptyMessage(board, r)}`];
    else {
      people = board.kind === 'ranking';
      top = items.map((it) => `${it.rank}. ${altItem(it, tiers)}: ${formatValue(it.value, board.value)}${it.detail ? ` ${it.detail}` : ''}`);
      // The card may fit fewer rows than the format holds; the alt text gives the field and the top three.
      top.unshift(`${countLine(board, eligible, eligible) ?? ''}; the top three`);
    }
  } else if (board.kind === 'congress') {
    for (const c of rankByCongress(data, { region: r, limit: 3 })) {
      if (!c.rows.length) continue;
      people = true;
      top.push(`${CONGRESS_LABEL[c.congress]} (${c.years}): ` + c.rows.map((row) => `${row.rank}. ${altItem(entryItem(row.rank, row.entry, row.value), tiers)}: ${formatValue(row.value, board.value)}`).join('; '));
    }
  } else if (board.kind === 'regions') {
    top = regionRows(data, board).slice(0, 3).map((row) => `${row.rank}. ${regionName(row.region)}: ${formatValue(row.value, board.value)}`);
  } else if (board.kind === 'shift') {
    const part = (label: string, nep: number, house: number) => `${label}: NEP ${formatValue(nep, 'php')}, House bill ${formatValue(house, 'php')}, change ${formatValue(house - nep, 'signed_php')}`;
    top = shiftKinds(data).flatMap((kk) => {
      // A combined part also lists each slice's own amounts.
      if (kk.keys.length < 2) return [part(kk.label, kindSum(data, kk, 'nep_php'), kindSum(data, kk, 'hgab3_php'))];
      const names: Record<string, string> = { office_change: 'lines that changed office', no_office: 'lines that name no office' };
      const k = data.totals.by_office_kind as Partial<Record<SliceKey, LeaderSlice>>;
      return [`${part(kk.label, kindSum(data, kk, 'nep_php'), kindSum(data, kk, 'hgab3_php'))} (${kk.note}; ` + kk.keys.map((key) => `${names[key] ?? key}: NEP ${formatValue(k[key]?.nep_php ?? 0, 'php')}, House bill ${formatValue(k[key]?.hgab3_php ?? 0, 'php')}`).join('; ') + ')'];
    });
  }
  const residual = residualText(data, board);
  const tail = [residual, people ? CARD_DISCLAIMER : null].filter(Boolean);
  return `${head} ${[...top.filter(Boolean), ...tail].join('. ')}.`.replace(/\.\./g, '.').replace(/\.\s*\./g, '.');
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
