/**
 * A year grid as one shareable PNG ("Download image" beside "By region and year" and "By party and year" on the flood
 * control and multi-purpose building pages). Jason (2026-11-06): "I like that flood control chart. Give me a shareable
 * version of that with our BetterGov logo, our disclaimer, that I can download as well".
 *
 * The same table as the page (`GridSpec`): its rows in order, the Congress over each run of years when it has groups,
 * the words from `matrixCopy` or `partyCopy`, the cells' colours from `heatColor` (plain rows unshaded). A white card on
 * a 1280-unit-wide canvas drawn at `scale` (2 by default, so 2560 pixels wide), in the site's fonts. Browser only;
 * loaded when the button is clicked.
 */
import { heatColor, matrixLabel, phpCell, type GridSpec, type MatrixCopy } from './mpb-compare';

const W = 1280;
const PAD = 40;
const C = {
  ground: '#ffffff', ink: '#121826', ink2: '#3d4657', ink3: '#6b7385', rule: '#e3e7ee', band: '#f3f5f9', accent: '#d62828',
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

export async function renderMatrixImage(input: {
  spec: GridSpec; copy: MatrixCopy; logoUrl?: string; scale?: number;
}): Promise<HTMLCanvasElement> {
  const { spec, copy } = input;
  const scale = input.scale ?? 2;
  const hero = fontVar('--font-hero', 'Figtree, sans-serif');
  const body = fontVar('--font-body', 'Inter, sans-serif');
  const mono = fontVar('--font-mono', 'monospace');
  if (typeof document !== 'undefined' && document.fonts) {
    await Promise.all([`700 34px ${hero}`, `400 14px ${body}`, `600 13px ${body}`, `700 13px ${body}`, `500 12px ${mono}`]
      .map((f) => document.fonts.load(f).catch(() => [])));
    await document.fonts.ready;
  }
  const logo = input.logoUrl ? await loadImage(input.logoUrl) : null;

  const rows = spec.rows;
  const max = Math.max(...rows.filter((r) => r.heat).flatMap((r) => r.cells.map((c) => c.php)));
  const n = spec.budgets.length;
  const measure = document.createElement('canvas').getContext('2d')!;
  // The label column fits its longest label ("Region IX · Zamboanga Peninsula"), up to 300; the budgets share the rest.
  measure.font = `500 13px ${body}`;
  const label = (r: GridSpec['rows'][number]) => (r.name ? `${r.short} · ${r.name}` : r.short);
  const REGION_W = Math.min(300, Math.max(200, 24 + Math.max(...rows.map((r) => measure.measureText(label(r)).width))));
  const colW = (W - PAD * 2 - REGION_W) / n;

  // Layout, top to bottom (units of the 1280-wide card).
  const kickerY = 44;
  const titleY = kickerY + 40;
  measure.font = `400 14px ${body}`;
  const dekLines = wrap(measure, copy.dek, W - PAD * 2 - (logo ? 220 : 0));
  const tableTop = titleY + 18 + dekLines.length * 20 + 16;
  const groupH = spec.groups ? 22 : 0;
  const headH = 44 + groupH;
  const rowH = 30;
  const totalH = 34;
  const tableBottom = tableTop + headH + rows.length * rowH + totalH;
  measure.font = `400 12.5px ${body}`;
  const noteLines = copy.notes.flatMap((t) => wrap(measure, t, W - PAD * 2));
  const discLabel = 'Disclaimer.';
  measure.font = `700 12.5px ${body}`;
  const discIndent = measure.measureText(`${discLabel} `).width;
  measure.font = `400 12.5px ${body}`;
  const discLines = wrap(measure, copy.disclaimer, W - PAD * 2, discIndent);
  const legendY = tableBottom + 30;
  const notesTop = legendY + 14;
  const H = Math.ceil(notesTop + noteLines.length * 18 + 10 + discLines.length * 18 + 16 + 40 + 28);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, W, 6);

  // Kicker, title, dek, logo.
  ctx.font = `500 12px ${mono}`;
  ctx.fillStyle = C.ink3;
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '1.6px';
  ctx.fillText(copy.kicker.toUpperCase(), PAD, kickerY);
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
  ctx.font = `700 34px ${hero}`;
  ctx.fillStyle = C.ink;
  ctx.fillText(copy.title, PAD, titleY);
  ctx.font = `400 14px ${body}`;
  ctx.fillStyle = C.ink2;
  dekLines.forEach((l, i) => ctx.fillText(l, PAD, titleY + 26 + i * 20));
  if (logo) {
    const lh = 34;
    const lw = (logo.naturalWidth / logo.naturalHeight) * lh;
    ctx.drawImage(logo, W - PAD - lw, kickerY - 22, lw, lh);
  }

  // The table: header, regions, all regions.
  const colX = (i: number) => PAD + REGION_W + i * colW;
  ctx.fillStyle = C.band;
  ctx.fillRect(PAD, tableTop, W - PAD * 2, headH);
  if (spec.groups) {
    // Each Congress over its years, with a rule between them.
    ctx.font = `600 11.5px ${body}`;
    ctx.textAlign = 'center';
    let gi = 0;
    for (const g of spec.groups) {
      const x0 = colX(gi);
      const x1 = colX(gi + g.span);
      ctx.fillStyle = C.ink2;
      ctx.fillText(g.label, (x0 + x1) / 2, tableTop + 15);
      ctx.fillStyle = C.rule;
      ctx.fillRect(x0, tableTop + 4, 1, headH - 8);
      gi += g.span;
    }
  }
  const headTop = tableTop + groupH;
  const headMid = headTop + (headH - groupH) / 2 + 4;
  ctx.font = `600 12px ${body}`;
  ctx.fillStyle = C.ink3;
  ctx.textAlign = 'left';
  ctx.fillText(spec.headLabel, PAD + 10, headMid);
  ctx.textAlign = 'right';
  spec.budgets.forEach((b, i) => {
    const x = colX(i + 1) - 8;
    const mark = b.note ? '*' : '';
    if (b.stage === 'gaa') ctx.fillText(`${b.fy}${mark}`, x, headMid);
    else {
      ctx.fillText(`${b.fy}`, x, headTop + 18);
      ctx.fillText(matrixLabel(b).replace(`${b.fy} `, '') + mark, x, headTop + 34);
    }
  });
  const cellText = (php: number, lines: number, x: number, y: number, light: boolean, quiet = false) => {
    ctx.fillStyle = light ? '#ffffff' : quiet ? C.ink2 : C.ink;
    ctx.fillText(lines ? phpCell(php) : '—', x, y);
  };
  rows.forEach((r, ri) => {
    const y = tableTop + headH + ri * rowH;
    ctx.textAlign = 'left';
    ctx.font = `500 13px ${body}`;
    ctx.fillStyle = r.heat ? C.ink : C.ink2;
    ctx.fillText(r.short, PAD + 10, y + rowH / 2 + 4.5);
    if (r.name) {
      const w = ctx.measureText(r.short).width;
      ctx.fillStyle = C.ink3;
      ctx.font = `400 13px ${body}`;
      // A long name is cut to fit its column.
      let name = ` · ${r.name}`;
      while (name.length > 4 && ctx.measureText(name).width > REGION_W - 18 - w) name = `${name.slice(0, -2)}…`;
      ctx.fillText(name, PAD + 10 + w, y + rowH / 2 + 4.5);
    }
    ctx.textAlign = 'right';
    ctx.font = `600 12.5px ${body}`;
    r.cells.forEach((c, i) => {
      const t = r.heat && c.php ? Math.sqrt(c.php / max) : 0;
      if (r.heat && c.php) {
        ctx.fillStyle = heatColor(t);
        ctx.fillRect(colX(i) + 0.5, y + 0.5, colW - 1, rowH - 1);
      }
      if (!r.heat) ctx.fillStyle = C.ink3;
      cellText(c.php, c.lines, colX(i + 1) - 8, y + rowH / 2 + 4.5, t > 0.72, !r.heat);
    });
    ctx.fillStyle = C.rule;
    ctx.fillRect(PAD, y + rowH - 0.5, W - PAD * 2, 1);
  });
  const ty = tableTop + headH + rows.length * rowH;
  ctx.fillStyle = C.band;
  ctx.fillRect(PAD, ty, W - PAD * 2, totalH);
  ctx.fillStyle = C.ink;
  ctx.fillRect(PAD, ty, W - PAD * 2, 1.5);
  ctx.textAlign = 'left';
  ctx.font = `700 13px ${body}`;
  ctx.fillText(spec.totalLabel, PAD + 10, ty + totalH / 2 + 4.5);
  ctx.textAlign = 'right';
  spec.totals.forEach((c, i) => cellText(c.php, c.lines, colX(i + 1) - 8, ty + totalH / 2 + 4.5, false));
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD + 0.5, tableTop + 0.5, W - PAD * 2 - 1, tableBottom - tableTop - 1);

  // The colour key, notes, disclaimer, source.
  ctx.textAlign = 'left';
  ctx.font = `600 12.5px ${body}`;
  ctx.fillStyle = C.ink2;
  ctx.fillText('Less', PAD, legendY);
  const gx = PAD + ctx.measureText('Less').width + 10;
  const gw = 180;
  for (let k = 0; k < gw; k++) {
    ctx.fillStyle = heatColor(k / (gw - 1));
    ctx.fillRect(gx + k, legendY - 10, 1, 12);
  }
  ctx.fillStyle = C.ink2;
  ctx.fillText('More', gx + gw + 10, legendY);
  let y = notesTop;
  ctx.font = `400 12.5px ${body}`;
  ctx.fillStyle = C.ink3;
  for (const line of noteLines) { y += 18; ctx.fillText(line, PAD, y); }
  y += 10;
  discLines.forEach((line, i) => {
    y += 18;
    if (i === 0) {
      ctx.font = `700 12.5px ${body}`; ctx.fillStyle = C.ink; ctx.fillText(discLabel, PAD, y);
      ctx.font = `400 12.5px ${body}`;
    }
    ctx.fillStyle = C.ink2;
    ctx.fillText(line, PAD + (i === 0 ? discIndent : 0), y);
  });
  y += 30;
  ctx.font = `400 11.5px ${mono}`;
  ctx.fillStyle = C.ink3;
  ctx.fillText(copy.source[0], PAD, y);
  ctx.fillText(copy.source[1], PAD, y + 17);
  return canvas;
}
