/**
 * The NEP vs House bill figure as one PNG ("Download image" on /hgab/2027/multi-purpose/nep-vs-house-bill).
 *
 * Jason (2026-11-05): "Give me a downloadable version!" The same figure as the page: the words come from
 * `compareCopy` and the maps from `drawCompareMap`, laid out on a 1200-unit-wide canvas drawn at `scale` (2 by
 * default, so 2400 pixels wide). Fonts are the site's (Figtree, Inter, JetBrains Mono), loaded before drawing.
 */
import type { HgabGeo } from './hgab';
import type { MpbData } from './hgab-mpb-years';
import {
  COMPARE_COLORS, compareFrame, dotRadius, drawCompareMap, placeDots, provincePaths, sideDots,
  type CompareCopy, type CompareSide,
} from './mpb-compare';

const W = 1200;
const PAD = 32;
const GAP = 20;
const C = {
  ground: COMPARE_COLORS.ground, ink: '#f3f6fb', ink2: '#c3cddd', ink3: '#8592a8', house: '#ff5a5a', nep: '#ffc24d',
  cell: '#121b2e', cellRule: '#24304a',
};

function fontVar(name: string, fallback: string): string {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return v || fallback;
}

/** Lines of `text` that fit `max` in the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = src;
  });
}

export async function renderCompareImage(input: {
  data: MpbData; geo: HgabGeo; copy: CompareCopy; logoUrl?: string; scale?: number;
}): Promise<HTMLCanvasElement> {
  const { data, geo, copy } = input;
  const scale = input.scale ?? 2;
  const hero = fontVar('--font-hero', 'Figtree, sans-serif');
  const body = fontVar('--font-body', 'Inter, sans-serif');
  const mono = fontVar('--font-mono', 'monospace');
  if (typeof document !== 'undefined' && document.fonts) {
    await Promise.all([`700 40px ${hero}`, `600 20px ${hero}`, `400 13px ${body}`, `500 13px ${body}`, `400 12px ${mono}`]
      .map((f) => document.fonts.load(f).catch(() => [])));
    await document.fonts.ready;
  }
  const logo = input.logoUrl ? await loadImage(input.logoUrl) : null;

  // Layout, top to bottom (units of the 1200-wide figure).
  const measure = document.createElement('canvas').getContext('2d')!;
  let titleSize = 40;
  const titleMax = W - PAD * 2 - (logo ? 190 : 0);
  const titleWidth = (s: number) => {
    measure.font = `700 ${s}px ${hero}`;
    return copy.title.reduce((a, r) => a + measure.measureText(r.text).width, 0);
  };
  while (titleSize > 26 && titleWidth(titleSize) > titleMax) titleSize -= 1;
  const kickerY = 28;
  const titleTop = kickerY + 19;
  const stripTop = titleTop + Math.round(titleSize * 1.1) + 18;
  const stripH = 66;
  const mapTop = stripTop + stripH + 16;
  const mw = (W - PAD * 2 - GAP) / 2;
  const frame = compareFrame(mw);
  const footTop = mapTop + frame.height + 16;
  measure.font = `400 12.5px ${body}`;
  const noteLines = wrap(measure, copy.notes, W - PAD * 2);
  measure.font = `400 11.5px ${mono}`;
  const sourceSplit = measure.measureText(copy.source[0]).width + measure.measureText(copy.source[1]).width > W - PAD * 2 - 24;
  const H = Math.ceil(footTop + 28 + noteLines.length * 18 + 26 + (sourceSplit ? 16 : 0) + 22);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, W, H);

  // Kicker, headline, logo.
  ctx.font = `500 13px ${mono}`;
  ctx.fillStyle = C.ink3;
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '1.8px';
  ctx.fillText(copy.kicker.toUpperCase(), PAD, kickerY + 12);
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
  ctx.font = `700 ${titleSize}px ${hero}`;
  let x = PAD;
  for (const r of copy.title) {
    ctx.fillStyle = r.house ? C.house : C.ink;
    ctx.fillText(r.text, x, titleTop + titleSize * 0.92);
    x += ctx.measureText(r.text).width;
  }
  if (logo) {
    const lh = 30;
    const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
    ctx.drawImage(logo, W - PAD - lw, kickerY + 4, lw, lh);
  }

  // The change strip: five cells.
  const cw = (W - PAD * 2 - 4) / 5;
  ctx.fillStyle = C.cellRule;
  ctx.fillRect(PAD, stripTop, W - PAD * 2, stripH);
  copy.cells.forEach((cell, i) => {
    const cx = PAD + 1 + i * (cw + 0.5);
    ctx.fillStyle = C.cell;
    ctx.fillRect(cx, stripTop + 1, cw - 0.5, stripH - 2);
    let size = 21;
    ctx.font = `700 ${size}px ${hero}`;
    while (size > 14 && ctx.measureText(cell.strong).width > cw - 24) ctx.font = `700 ${--size}px ${hero}`;
    ctx.fillStyle = cell.tone === 'house_only' ? C.house : cell.tone === 'nep_only' ? C.nep : C.ink;
    ctx.fillText(cell.strong, cx + 14, stripTop + 32);
    ctx.font = `400 12.5px ${body}`;
    ctx.fillStyle = C.ink2;
    ctx.fillText(cell.span, cx + 14, stripTop + 52);
  });

  // The two maps, each with its numbers on the open sea.
  (['nep', 'house'] as CompareSide[]).forEach((side, i) => {
    const mx = PAD + i * (mw + GAP);
    ctx.save();
    ctx.translate(mx, mapTop);
    ctx.beginPath();
    ctx.rect(0, 0, mw, frame.height);
    ctx.clip();
    drawCompareMap(ctx, frame, provincePaths(geo, frame), placeDots(sideDots(data, side), frame));
    ctx.restore();
    const s = copy.sides[side];
    const tone = side === 'house' ? C.house : C.ink;
    let y = mapTop + 14;
    ctx.textAlign = 'left';
    ctx.font = `700 26px ${hero}`; ctx.fillStyle = C.ink; ctx.fillText(s.name, mx + 14, y + 24); y += 32;
    ctx.font = `400 12.5px ${body}`; ctx.fillStyle = C.ink3; ctx.fillText(s.sub, mx + 14, y + 12); y += 24;
    ctx.font = `700 58px ${hero}`; ctx.fillStyle = tone; ctx.fillText(s.php, mx + 14, y + 52); y += 62;
    ctx.font = `700 22px ${hero}`; ctx.fillStyle = C.ink2; ctx.fillText(s.lines, mx + 14, y + 20);
    // Its own lines, top right.
    const own = side === 'house' ? C.house : C.nep;
    const right = mx + mw - 14;
    ctx.textAlign = 'right';
    ctx.font = `400 16px ${body}`; ctx.fillStyle = C.ink2;
    const restW = ctx.measureText(s.ownRest).width;
    ctx.fillText(s.ownRest, right, mapTop + 44);
    ctx.font = `700 32px ${hero}`; ctx.fillStyle = own;
    ctx.fillText(s.ownCount, right - restW, mapTop + 44);
    ctx.font = `400 12.5px ${body}`; ctx.fillStyle = C.ink3;
    ctx.fillText(s.ownLabel, right, mapTop + 66);
    ctx.textAlign = 'left';
  });

  // Legend, notes, source.
  let y = footTop + 14;
  ctx.font = `400 13px ${body}`;
  let lx = PAD;
  for (const l of copy.legend) {
    ctx.fillStyle = COMPARE_COLORS.swatch[l.cls];
    ctx.beginPath(); ctx.arc(lx + 5, y - 4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.ink2;
    ctx.fillText(l.label, lx + 16, y);
    lx += 16 + ctx.measureText(l.label).width + 22;
  }
  let sx = W - PAD;
  for (const sz of [...copy.sizes].reverse()) {
    const r = dotRadius(sz.php, 600);
    const tw = ctx.measureText(sz.label).width;
    ctx.fillStyle = C.ink2;
    ctx.fillText(sz.label, sx - tw, y);
    ctx.fillStyle = 'rgba(146, 172, 214, 0.55)';
    ctx.beginPath(); ctx.arc(sx - tw - 6 - r, y - 4, r, 0, Math.PI * 2); ctx.fill();
    sx -= tw + 6 + r * 2 + 14;
  }
  y += 14;
  ctx.font = `400 12.5px ${body}`;
  ctx.fillStyle = C.ink3;
  for (const line of noteLines) { y += 18; ctx.fillText(line, PAD, y); }
  y += 26;
  ctx.font = `400 11.5px ${mono}`;
  ctx.fillText(copy.source[0], PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText(copy.source[1], W - PAD, y + (sourceSplit ? 16 : 0));
  ctx.textAlign = 'left';
  return canvas;
}
