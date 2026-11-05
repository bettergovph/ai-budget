/**
 * A comparison figure as one PNG ("Download image" on /hgab/2027/multi-purpose/nep-vs-house-bill and
 * /hgab/2027/flood-control).
 *
 * Jason (2026-11-05): "Give me a downloadable version!" The same figure as the page: the words come from
 * `compareCopy` and the maps from `drawCompareMap`, laid out on a 1200-unit-wide canvas drawn at `scale` (2 by
 * default, so 2400 pixels wide). Two maps carry their labels on the open sea west of Luzon; three, above each map.
 * Fonts are the site's (Figtree, Inter, JetBrains Mono), loaded before drawing.
 */
import type { HgabGeo } from './hgab';
import type { MpbData } from './hgab-mpb-years';
import {
  COMPARE_COLORS, compareFrame, dotRadius, drawCompareMap, legendWidth, panelDots, placeDots, provincePaths,
  type CompareCopy, type ComparePanelCopy,
} from './mpb-compare';

const W = 1200;
const PAD = 32;
const GAP = 20;
const C = {
  ground: COMPARE_COLORS.ground, ink: '#f3f6fb', ink2: '#c3cddd', ink3: '#8592a8', red: '#ff5a5a',
  cell: '#121b2e', cellRule: '#24304a',
};

function fontVar(name: string, fallback: string): string {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return v || fallback;
}

/** Lines of `text` that fit `max` in the current font; the first line starts `indent` in (after a label). */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, indent = 0): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width + (out.length ? 0 : indent) > max && line) { out.push(line); line = w; } else line = next;
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
    return Math.max(...copy.title.map((line) => line.reduce((a, r) => a + measure.measureText(r.text).width, 0)));
  };
  while (titleSize > 26 && titleWidth(titleSize) > titleMax) titleSize -= 1;
  const kickerY = 28;
  const titleTop = kickerY + 19;
  const stripTop = titleTop + Math.round(titleSize * 1.1 * copy.title.length) + 18;
  const stripH = 66;
  const np = copy.panels.length;
  const stacked = np > 2;
  // A stacked label: name, sub, amounts (with their names when two), lines.
  const labelH = stacked ? 26 + 18 + 46 + (copy.panels.some((p) => p.amounts.some((a) => a.label)) ? 16 : 0) + 24 : 0;
  const mapTop = stripTop + stripH + 16 + labelH;
  const mw = (W - PAD * 2 - GAP * (np - 1)) / np;
  const frame = compareFrame(mw);
  const footTop = mapTop + frame.height + 16;
  measure.font = `400 12.5px ${body}`;
  const noteLines = wrap(measure, copy.notes, W - PAD * 2);
  // The disclaimer, after a bold "Disclaimer." (the figure travels without the page).
  const discLabel = 'Disclaimer.';
  measure.font = `600 12.5px ${body}`;
  const discIndent = measure.measureText(`${discLabel} `).width;
  measure.font = `400 12.5px ${body}`;
  const discLines = wrap(measure, copy.disclaimer, W - PAD * 2, discIndent);
  measure.font = `400 11.5px ${mono}`;
  const sourceSplit = measure.measureText(copy.source[0]).width + measure.measureText(copy.source[1]).width > W - PAD * 2 - 24;
  const legendRows = copy.legend.length;
  const H = Math.ceil(footTop + 28 + (legendRows - 1) * 22 + noteLines.length * 18 + 6 + discLines.length * 18 + 26 + (sourceSplit ? 16 : 0) + 22);

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
  copy.title.forEach((line, i) => {
    let x = PAD;
    for (const r of line) {
      ctx.fillStyle = r.red ? C.red : C.ink;
      ctx.fillText(r.text, x, titleTop + titleSize * (0.92 + 1.1 * i));
      x += ctx.measureText(r.text).width;
    }
  });
  if (logo) {
    const lh = 30;
    const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
    ctx.drawImage(logo, W - PAD - lw, kickerY + 4, lw, lh);
  }

  // The change strip: one cell per figure.
  const cells = copy.cells.length;
  const cw = (W - PAD * 2 - (cells - 1)) / cells;
  ctx.fillStyle = C.cellRule;
  ctx.fillRect(PAD, stripTop, W - PAD * 2, stripH);
  copy.cells.forEach((cell, i) => {
    const cx = PAD + 1 + i * (cw + 0.5);
    ctx.fillStyle = C.cell;
    ctx.fillRect(cx, stripTop + 1, cw - 0.5, stripH - 2);
    let size = 22;
    ctx.font = `700 ${size}px ${hero}`;
    while (size > 14 && ctx.measureText(cell.strong).width > cw - 24) ctx.font = `700 ${--size}px ${hero}`;
    ctx.fillStyle = cell.tone === 'red' ? C.red : C.ink;
    ctx.fillText(cell.strong, cx + 14, stripTop + 32);
    ctx.font = `400 12.5px ${body}`;
    ctx.fillStyle = C.ink2;
    ctx.fillText(cell.span, cx + 14, stripTop + 52);
  });

  // The maps: two with their labels on the open sea, three with their labels above.
  const provinces = provincePaths(geo, frame);
  copy.panels.forEach((p, i) => {
    const mx = PAD + i * (mw + GAP);
    ctx.save();
    ctx.translate(mx, mapTop);
    ctx.beginPath();
    ctx.rect(0, 0, mw, frame.height);
    ctx.clip();
    drawCompareMap(ctx, frame, provinces, placeDots(panelDots(data, p.key), frame));
    ctx.restore();
    ctx.textAlign = 'left';
    if (stacked) drawLabel(p, mx, mapTop - labelH, { name: 22, php: 40, lines: 16 });
    else drawLabel(p, mx + 14, mapTop + 14, { name: 26, php: 58, lines: 22 });
  });

  function drawLabel(p: ComparePanelCopy, x: number, top: number, size: { name: number; php: number; lines: number }) {
    let y = top;
    ctx.font = `700 ${size.name}px ${hero}`; ctx.fillStyle = C.ink; ctx.fillText(p.name, x, y + size.name * 0.92); y += size.name + 6;
    ctx.font = `400 12.5px ${body}`; ctx.fillStyle = C.ink3; ctx.fillText(p.sub, x, y + 12); y += 24;
    let ax = x;
    const labelled = p.amounts.some((a) => a.label);
    for (const a of p.amounts) {
      ctx.font = `700 ${size.php}px ${hero}`; ctx.fillStyle = a.tone === 'red' ? C.red : C.ink;
      ctx.fillText(a.php, ax, y + size.php * 0.9);
      const w = ctx.measureText(a.php).width;
      if (a.label) {
        ctx.font = `600 12.5px ${body}`; ctx.fillStyle = C.ink2;
        ctx.fillText(a.label, ax, y + size.php + 12);
      }
      ax += w + 18;
    }
    y += size.php + 4 + (labelled ? 16 : 0);
    ctx.font = `700 ${size.lines}px ${hero}`; ctx.fillStyle = C.ink2; ctx.fillText(p.lines, x, y + size.lines * 0.91);
  }

  // Legend, notes, source.
  let y = footTop + 14;
  ctx.font = `400 13px ${body}`;
  // One row per legend group; the dot sizes sit at the right of the last row.
  copy.legend.forEach((g, gi) => {
    if (gi > 0) y += 22;
    let lx = PAD;
    if (g.title) {
      ctx.font = `600 13px ${body}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(g.title, lx, y);
      lx += ctx.measureText(g.title).width + 12;
      ctx.font = `400 13px ${body}`;
    }
    for (const l of g.items) {
      ctx.fillStyle = COMPARE_COLORS.swatch[l.color];
      ctx.beginPath(); ctx.arc(lx + 5, y - 4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.ink2;
      ctx.fillText(l.label, lx + 16, y);
      lx += 16 + ctx.measureText(l.label).width + 22;
    }
  });
  let sx = W - PAD;
  for (const sz of [...copy.sizes].reverse()) {
    const r = dotRadius(sz.php, legendWidth(np));
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
  y += 6;
  discLines.forEach((line, i) => {
    y += 18;
    if (i === 0) {
      ctx.font = `600 12.5px ${body}`; ctx.fillStyle = C.ink; ctx.fillText(discLabel, PAD, y);
      ctx.font = `400 12.5px ${body}`;
    }
    ctx.fillStyle = C.ink2;
    ctx.fillText(line, PAD + (i === 0 ? discIndent : 0), y);
  });
  ctx.fillStyle = C.ink3;
  y += 26;
  ctx.font = `400 11.5px ${mono}`;
  ctx.fillText(copy.source[0], PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText(copy.source[1], W - PAD, y + (sourceSplit ? 16 : 0));
  ctx.textAlign = 'left';
  return canvas;
}
