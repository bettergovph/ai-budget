/**
 * Marks side by side, never stacked (the multi-purpose buildings map, MpbMap.tsx). Jason (2026-11-02) asked that the
 * numbers of places named in titles sit beside each other instead of stacked, so they can be read; then that nothing
 * stay stacked.
 *
 * layoutMarks() lays out every mark for a whole zoom level in world pixels (Web Mercator, 512-pixel tiles, as MapLibre
 * draws), so the layout holds for any view at that level and up to the next: zooming in only pulls marks apart, and
 * marks keep their size in pixels. The map lays out again at each whole level.
 *
 * Marks are set one at a time: from zoom SPREAD_FROM, GPS dots first (they are exact), then the rest by lines, most
 * first; below it, by lines. A mark that touches none set before it stays where it belongs. From DETAIL_FROM, one that
 * does moves to the nearest free spot, pushed away from the mark in its way: up to MAX_MOVE from SPREAD_FROM, up to
 * twice its radius below it. A thin line leads back to where it belongs. With no room that near, it joins the nearest
 * mark in a group (a dark disc with their lines), and the group takes in whatever its disc then touches. Below
 * DETAIL_FROM, at the country's scale, a mark within OVERVIEW_REACH of another joins it (about as many groups as
 * MapLibre's own clustering at 42 pixels), and a group sits at the middle of its marks. So no mark covers another at any zoom: every mark has its own spot from SPREAD_FROM (Metro
 * Manila needs that zoom), from DETAIL_FROM only places too close to show apart are grouped, and below it the map
 * shows groups.
 */
import type { MarkFeature, MarkKind } from './hgab-mpb-years';

/** From this zoom marks are grouped only where there is no room to show them apart. */
export const DETAIL_FROM = 10;
/** From this zoom every mark has its own spot; below it, marks with no room nearby are grouped. */
export const SPREAD_FROM = 12;

type Stops = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
/** Radii in pixels at stops on √lines: place rings, office-area discs, groups. The map's circle-radius uses the same. */
export const RING_RADIUS: Stops = [[1, 4.5], [3, 8], [10, 14], [30, 22]];
export const AREA_RADIUS: Stops = [[1, 6], [4, 9], [10, 14], [30, 22]];
export const GROUP_RADIUS: Stops = [[1, 8], [10, 11], [40, 16], [130, 24]];
/** GPS dots' radius in pixels at stops on the zoom. */
export const GPS_RADIUS = [[5, 3.2], [10, 4.5], [14, 6.5]] as const;
/** Edge widths in pixels; MapLibre draws a circle's edge outside its radius. */
export const RING_STROKE = 1.4;
export const AREA_STROKE = 1.5;
export const GROUP_STROKE = 1.5;
export const GPS_STROKE = 1.2;
/** Pixels kept clear between two marks' edges. */
const GAP = 1.5;
/** How far, in pixels, a mark may move from SPREAD_FROM to find room. */
const MAX_MOVE = 240;
/** Below DETAIL_FROM, the country's scale: a mark this near another's edge, in pixels, joins it in a group. */
const OVERVIEW_REACH = 24;

function atStops(s: ReadonlyArray<readonly [number, number]>, v: number): number {
  if (v <= s[0][0]) return s[0][1];
  for (let k = 1; k < s.length; k++) {
    if (v <= s[k][0]) return s[k - 1][1] + ((v - s[k - 1][0]) / (s[k][0] - s[k - 1][0])) * (s[k][1] - s[k - 1][1]);
  }
  return s[s.length - 1][1];
}

/** A GPS dot's radius as drawn at a zoom, edge included, in pixels. */
export function dotRadius(zoom: number): number {
  return atStops(GPS_RADIUS, zoom) + GPS_STROKE;
}

/** A place ring's or an office-area disc's radius as drawn, edge included, in pixels. */
export function markRadius(kind: Exclude<MarkKind, 'gps'>, lines: number): number {
  const v = Math.sqrt(Math.max(1, lines));
  return kind === 'area' ? atStops(AREA_RADIUS, v) + AREA_STROKE : atStops(RING_RADIUS, v) + RING_STROKE;
}

/** A group's radius as drawn, edge included, in pixels. */
export function groupRadius(lines: number): number {
  return atStops(GROUP_RADIUS, Math.sqrt(Math.max(1, lines))) + GROUP_STROKE;
}

/** The largest any mark is drawn. */
const MAX_R = Math.max(...[RING_RADIUS, AREA_RADIUS, GROUP_RADIUS].map((s) => s[s.length - 1][1]))
  + Math.max(RING_STROKE, AREA_STROKE, GROUP_STROKE);

const TILE = 512;

/** Longitude and latitude to world pixels at a zoom level (Web Mercator, as MapLibre draws). */
export function toWorld([lng, lat]: readonly [number, number], z: number): [number, number] {
  const s = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
}

export function fromWorld(x: number, y: number, z: number): [number, number] {
  const s = TILE * 2 ** z;
  const n = Math.PI * (1 - (2 * y) / s);
  return [(x / s) * 360 - 180, (Math.atan(Math.sinh(n)) * 180) / Math.PI];
}

/**
 * Marks with no room to be shown apart at a zoom: the lines they stand for (a GPS line once, however many of its
 * points are in the group), how many marks, and the box around where they belong.
 */
export interface GroupFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { kind: 'group'; lines: number; marks: number; west: number; south: number; east: number; north: number };
}

/** From a mark that was moved aside back to where it belongs. */
export interface LeaderFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { place: number; line: number };
}

export interface Layout {
  /** Every mark on its own (where it belongs, or moved aside), and the groups. */
  points: Array<MarkFeature | GroupFeature>;
  leaders: LeaderFeature[];
  /** For each mark given, by index: the point that draws it (itself, or its group). */
  drawnBy: Int32Array;
}

/** Every mark laid out for a zoom level (its whole part): none covers another. */
export function layoutMarks(marks: readonly MarkFeature[], zoom: number): Layout {
  const z = Math.floor(zoom);
  const spread = z >= SPREAD_FROM;
  const overview = z < DETAIL_FROM;
  const reach = overview ? OVERVIEW_REACH : 0;
  const n = marks.length;
  // A dot grows a little with the zoom: its size at the next whole level keeps it clear up to there.
  const dot = dotRadius(z + 1);
  const hx = new Float64Array(n);
  const hy = new Float64Array(n);
  const hr = new Float64Array(n);
  const dotAt = new Uint8Array(n);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = marks[i].properties;
    const [x, y] = toWorld(marks[i].geometry.coordinates, z);
    hx[i] = x;
    hy[i] = y;
    dotAt[i] = p.kind === 'gps' ? 1 : 0;
    hr[i] = dotAt[i] ? dot : markRadius(p.kind as Exclude<MarkKind, 'gps'>, p.lines);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) =>
    (spread ? dotAt[b] - dotAt[a] : 0)
    || marks[b].properties.lines - marks[a].properties.lines
    || dotAt[a] - dotAt[b]
    || a - b);

  // What is drawn so far: a mark on its own, or a group, in a grid of cells as wide as the closest two centres may
  // be, so a check looks at nine cells. Each cell holds a linked list of entries. Up to a few million cells (zoom 12
  // over the country) the cells are an array; past that, a map keyed by a small hash of column and row (cells that
  // share a key share a list, which the distance check sorts out).
  const ex: number[] = [];
  const ey: number[] = [];
  const er: number[] = [];
  // The lines an entry stands for: those of its places, and each GPS line once, however many of its points it holds
  // (a line with several points counts at its first; a group of only later points still holds that line).
  const placeLines: number[] = [];
  const gpsLines: Array<Set<number> | null> = [];
  const linesOf = (e: number) => placeLines[e] + (gpsLines[e]?.size ?? 0);
  const weight: number[] = []; // lines, a mark of none counting one: where a country-scale group sits
  const grouped: boolean[] = [];
  const moved: boolean[] = [];
  const into: number[] = []; // the group an entry was taken into, or −1
  const next: number[] = []; // the next entry in its cell, or −1
  const of = new Int32Array(n); // the entry a mark was set as, or joined
  const cell = 2 * MAX_R + GAP + reach;
  x0 -= MAX_MOVE + cell;
  y0 -= MAX_MOVE + cell;
  const col = (x: number) => Math.floor((x - x0) / cell);
  const row = (y: number) => Math.floor((y - y0) / cell);
  const cols = col(x1 + MAX_MOVE + cell) + 2;
  const rows = row(y1 + MAX_MOVE + cell) + 2;
  const heads = cols * rows <= 4_000_000 ? new Int32Array(cols * rows).fill(-1) : null;
  const hashed = new Map<number, number>();
  const key = (c: number, r: number) => (Math.imul(c, 73856093) ^ Math.imul(r, 19349663)) & 0x3fffffff;
  const head = (c: number, r: number): number =>
    heads ? (c >= 0 && r >= 0 && c < cols && r < rows ? heads[c * rows + r] : -1) : (hashed.get(key(c, r)) ?? -1);
  const setHead = (c: number, r: number, e: number) => {
    if (heads) heads[c * rows + r] = e;
    else hashed.set(key(c, r), e);
  };

  const link = (e: number) => {
    const c = col(ex[e]);
    const r = row(ey[e]);
    next[e] = head(c, r);
    setHead(c, r, e);
  };
  const unlink = (e: number) => {
    const c = col(ex[e]);
    const r = row(ey[e]);
    let k = head(c, r);
    if (k === e) setHead(c, r, next[e]);
    else {
      while (next[k] !== e) k = next[k];
      next[k] = next[e];
    }
  };
  const add = (x: number, y: number, i: number, aside: boolean) => {
    const e = ex.length;
    ex.push(x);
    ey.push(y);
    er.push(hr[i]);
    placeLines.push(dotAt[i] ? 0 : marks[i].properties.lines);
    gpsLines.push(dotAt[i] ? new Set([marks[i].properties.line]) : null);
    weight.push(Math.max(1, marks[i].properties.lines));
    grouped.push(false);
    moved.push(aside);
    into.push(-1);
    next.push(-1);
    of[i] = e;
    link(e);
  };
  const drop = (e: number, to: number) => {
    into[e] = to;
    unlink(e);
  };
  /** At the country's scale a group sits at the middle of its marks, weighted by lines. */
  const pull = (e: number, x: number, y: number, w: number) => {
    if (!overview) return;
    unlink(e);
    ex[e] = (ex[e] * weight[e] + x * w) / (weight[e] + w);
    ey[e] = (ey[e] * weight[e] + y * w) / (weight[e] + w);
    link(e);
  };
  const root = (e: number): number => {
    let r = e;
    while (into[r] >= 0) r = into[r];
    while (into[e] >= 0) {
      const up = into[e];
      into[e] = r;
      e = up;
    }
    return r;
  };
  /** The nearest entry a circle at (x, y) would touch, leaving out `skip`, or −1; its squared distance in `nearD2`. */
  let nearD2 = Infinity;
  const nearest = (x: number, y: number, r: number, skip: number): number => {
    let best = -1;
    nearD2 = Infinity;
    const c = col(x);
    const w = row(y);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dw = -1; dw <= 1; dw++) {
        for (let e = head(c + dc, w + dw); e >= 0; e = next[e]) {
          if (e === skip) continue;
          const min = r + er[e] + GAP;
          const dx = x - ex[e];
          const dy = y - ey[e];
          const d2 = dx * dx + dy * dy;
          if (d2 < min * min && d2 < nearD2) {
            nearD2 = d2;
            best = e;
          }
        }
      }
    }
    return best;
  };
  /** Whether a circle at (x, y) touches anything. */
  const blocked = (x: number, y: number, r: number): boolean => {
    const c = col(x);
    const w = row(y);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dw = -1; dw <= 1; dw++) {
        for (let e = head(c + dc, w + dw); e >= 0; e = next[e]) {
          const min = r + er[e] + GAP;
          const dx = x - ex[e];
          const dy = y - ey[e];
          if (dx * dx + dy * dy < min * min) return true;
        }
      }
    }
    return false;
  };
  /**
   * The nearest free spot within `cap`: away from the mark in the way (to the right when they share a centre), then
   * either side of that, ring by ring outward.
   */
  const spot = (x: number, y: number, r: number, away: number, cap: number): [number, number] | null => {
    const step = Math.max(1.5, r * 0.5);
    for (let d = step; d <= cap; d += step) {
      const k = Math.max(8, Math.ceil((2 * Math.PI * d) / Math.max(3, r * 0.75)));
      const da = (2 * Math.PI) / k;
      for (let j = 0; j < k; j++) {
        const a = away + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * da;
        const sx = x + d * Math.cos(a);
        const sy = y + d * Math.sin(a);
        if (!blocked(sx, sy, r)) return [sx, sy];
      }
    }
    return null;
  };
  /** Mark i joins entry e as a group; the group takes in whatever its disc then touches, until it touches nothing. */
  const join = (e: number, i: number) => {
    of[i] = e;
    const w = Math.max(1, marks[i].properties.lines);
    pull(e, hx[i], hy[i], w);
    weight[e] += w;
    if (dotAt[i]) (gpsLines[e] ??= new Set()).add(marks[i].properties.line);
    else placeLines[e] += marks[i].properties.lines;
    grouped[e] = true;
    moved[e] = false;
    for (;;) {
      er[e] = groupRadius(linesOf(e));
      const o = nearest(ex[e], ey[e], er[e], e);
      if (o < 0) return;
      drop(o, e);
      pull(e, ex[o], ey[o], weight[o]);
      weight[e] += weight[o];
      placeLines[e] += placeLines[o];
      const a = gpsLines[e];
      const b = gpsLines[o];
      if (b) {
        if (!a) gpsLines[e] = b;
        else {
          const [big, small] = a.size >= b.size ? [a, b] : [b, a];
          for (const l of small) big.add(l);
          gpsLines[e] = big;
        }
      }
    }
  };

  for (const i of order) {
    const x = hx[i];
    const y = hy[i];
    const r = hr[i];
    const near = nearest(x, y, r + reach, -1);
    if (near < 0) {
      add(x, y, i, false);
      continue;
    }
    if (overview) {
      join(near, i);
      continue;
    }
    const d = Math.sqrt(nearD2);
    // Below SPREAD_FROM a mark wholly inside the one in its way joins it without looking for room.
    const at = !spread && d + r <= er[near]
      ? null
      : spot(x, y, r, d > 1e-3 ? Math.atan2(y - ey[near], x - ex[near]) : 0, spread ? MAX_MOVE : Math.max(8, 2 * r));
    if (at) add(at[0], at[1], i, true);
    else join(near, i);
  }

  // Each entry left standing is a point: a mark (where it belongs, or moved aside with a line back) or a group.
  const points: Array<MarkFeature | GroupFeature> = [];
  const leaders: LeaderFeature[] = [];
  const drawnBy = new Int32Array(n).fill(-1);
  const pointOf = new Int32Array(ex.length).fill(-1);
  const box = new Map<number, [number, number, number, number, number]>(); // group → west, south, east, north, marks
  for (let i = 0; i < n; i++) {
    const e = root(of[i]);
    if (!grouped[e]) continue;
    const [lng, lat] = marks[i].geometry.coordinates;
    const b = box.get(e);
    if (!b) box.set(e, [lng, lat, lng, lat, 1]);
    else {
      b[0] = Math.min(b[0], lng);
      b[1] = Math.min(b[1], lat);
      b[2] = Math.max(b[2], lng);
      b[3] = Math.max(b[3], lat);
      b[4] += 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const e = root(of[i]);
    if (pointOf[e] < 0) {
      pointOf[e] = points.length;
      if (grouped[e]) {
        const [west, south, east, north, count] = box.get(e)!;
        points.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: fromWorld(ex[e], ey[e], z) },
          properties: { kind: 'group', lines: linesOf(e), marks: count, west, south, east, north },
        });
      } else if (!moved[e]) {
        points.push(marks[i]);
      } else {
        const m = marks[i];
        const at = fromWorld(ex[e], ey[e], z);
        points.push({ ...m, geometry: { type: 'Point', coordinates: at } });
        leaders.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [m.geometry.coordinates, at] },
          properties: { place: m.properties.place, line: m.properties.line },
        });
      }
    }
    drawnBy[i] = pointOf[e];
  }
  return { points, leaders, drawnBy };
}
