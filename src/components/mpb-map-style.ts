/**
 * Colours of the multi-purpose buildings map, shared by the map (MpbMap.tsx, loaded lazily with MapLibre) and the
 * page's key, so the key can render before the map's code arrives.
 *
 * The districts are shaded in red by amount: the campaign red of the "We are not ignorant" strip (#d62828), mixed
 * light to dark as the site mixes its blue ramp (hgab-map.css .is-s1…s4), with a deeper last step. The marks read
 * against every step (dataviz validator, worst colour-blind ΔE, target ≥ 8): GPS published in a title, a blue dot
 * (≥ 25); groups of lines, dark ink discs (9.3 on the darkest red, with a white edge); an office area or region, grey
 * discs (≥ 10); a place a title names, a white ring with an ink edge. What is picked is blue: the place picked from
 * the list (ring on a white halo) and the district clicked on the map (outline).
 */
export const SHADE_COLORS = ['#f5ddde', '#f3bcb8', '#ed9189', '#e25f56', '#9b2b2a'] as const;
export const PICKED = '#0b4fd9';
export const MARK_COLORS = { gps: '#0b4fd9', ring: '#ffffff', ringEdge: '#11151c', area: '#5b6373', cluster: '#2b3340' } as const;
