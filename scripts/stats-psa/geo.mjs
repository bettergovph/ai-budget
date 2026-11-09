// Place names → the areas PSA publishes poverty for (provinces with their HUCs, the four Metro Manila
// districts, Isabela City, Maguindanao as one). Shared by build.mjs and verify-indicators.ts.

/** A source label without its indent, footnote marks ("1/", "a/", "*", "r1") or "(Not a Province)". */
export function clean(label) {
  // Parentheticals are dropped ("(Excluding City of Baguio)", "(Compostela Valley)", "(NCR)"), except a
  // merged area ("(includes the province of Guimaras)"), which must stay unmatched.
  let s = String(label).replace(/^[.\s]+/, '').replace(/\((?![^)]*includ)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 8; i++) s = s.replace(/(?:[\s,]+(?:r\d+|[0-9a-z]{1,2}\/\**|\d*\*+)|\d+\/\**|\*+)$/i, '').trim();
  return s;
}

const ALIAS = {
  'mt. province': 'mountain province', 'mt province': 'mountain province', 'north cotabato': 'cotabato',
  'city of sta. rosa': 'city:santa rosa', 'compostela valley': 'davao de oro', 'city of mantinlupa': 'city:muntinlupa',
  'samar (western samar)': 'samar', 'western samar': 'samar', 'city of cagayan de oro': 'city:cagayan de oro',
  'isabela city': 'city:isabela', 'cotabato city': 'city:cotabato', saranggani: 'sarangani',
};

/** Lower-case key; cities become `city:<name>` so "Cebu" (province) and "City of Cebu" stay apart. */
export function key(label) {
  const s = clean(label).toLowerCase().replace(/ñ/g, 'n').replace(/\s+/g, ' ').trim();
  if (ALIAS[s]) return ALIAS[s];
  if (s.startsWith('city of ')) return 'city:' + s.slice(8);
  if (s.endsWith(' city')) return 'city:' + s.slice(0, -5);
  return s;
}

// Highly urbanized cities and the province they sit in (PSA poverty estimates include them in that province).
export const CITY_TO_PROVINCE = {
  'city:baguio': 'benguet', 'city:angeles': 'pampanga', 'city:olongapo': 'zambales', 'city:lucena': 'quezon',
  'city:puerto princesa': 'palawan', 'city:iloilo': 'iloilo', 'city:bacolod': 'negros occidental',
  'city:cebu': 'cebu', 'city:lapu-lapu': 'cebu', 'city:mandaue': 'cebu', 'city:tacloban': 'leyte',
  'city:zamboanga': 'zamboanga del sur', 'city:iligan': 'lanao del norte', 'city:cagayan de oro': 'misamis oriental',
  'city:davao': 'davao del sur', 'city:general santos': 'south cotabato', 'city:butuan': 'agusan del norte',
  // component cities that are their own legislative districts
  'city:antipolo': 'rizal', 'city:binan': 'laguna', 'city:calamba': 'laguna', 'city:santa rosa': 'laguna',
  'city:san jose del monte': 'bulacan',
  // Metro Manila, by the four districts PSA publishes poverty for
  'city:manila': 'ncr1',
  'city:mandaluyong': 'ncr2', 'city:marikina': 'ncr2', 'city:pasig': 'ncr2', 'city:quezon': 'ncr2', 'city:san juan': 'ncr2',
  'city:caloocan': 'ncr3', 'city:malabon': 'ncr3', 'city:navotas': 'ncr3', 'city:valenzuela': 'ncr3',
  'cities of malabon and navotas': 'ncr3',
  'city:las pinas': 'ncr4', 'city:makati': 'ncr4', 'city:muntinlupa': 'ncr4', 'city:paranaque': 'ncr4',
  'city:pasay': 'ncr4', 'city:taguig': 'ncr4', 'pateros': 'ncr4',
  'maguindanao del norte': 'maguindanao', 'maguindanao del sur': 'maguindanao',
};
export const unitOf = (k) => CITY_TO_PROVINCE[k] ?? k;

const NCR_DISTRICT = /^(?:ncr,?\s*)?(?:city of manila,?\s*)?(first|second|third|fourth|1st|2nd|3rd|4th) district$/i;
const DISTRICT_NO = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 };

/** Region, island-group and national rows: never an area. */
export function isAggregateLabel(label) {
  const s = clean(label).toLowerCase();
  return /^(philippines|total\b|others?$|tax refund|island group|luzon|visayas|mindanao|foreign country)/.test(s)
    || /^[ivx]+(-?[ab])?(\s*-\s*|\s+|-)[a-z]/.test(s)
    || /^(region\b|national capital|ncr$|cordillera|car$|autonomous region|bangsamoro|barmm$|armm$|negros island|nir$|mimaropa|calabarzon|caraga$|soccsksargen|[ivx]+(-[ab])?\s*-\s)/.test(s)
    || /^(ilocos region|cagayan valley|central luzon|bicol region|western visayas|central visayas|eastern visayas|zamboanga peninsula|northern mindanao|davao region)/.test(s)
    || /\bregion\)?$/.test(s);
}

/**
 * Map a table's geography codes to areas. Rows that are regions or the country are skipped; NCR district
 * rows map to ncr1–ncr4; any other label must resolve to a known area, or it is reported in `unmatched`.
 * Returns { byCode: Map(code → unit), unmatched: [label], skipped: [label] }.
 */
export function mapGeography(values, areaKeys, { only } = {}) {
  const byCode = new Map(), unmatched = [], skipped = [], whole = new Set(), partOf = new Map();
  for (const v of values) {
    if (only && !only(v)) continue;
    const c = clean(v.label);
    const d = c.match(NCR_DISTRICT);
    if (d) { const u = 'ncr' + DISTRICT_NO[d[1].toLowerCase()]; byCode.set(v.code, u); whole.add(u); continue; }
    if (isAggregateLabel(v.label)) { skipped.push(c); continue; }
    const k = key(v.label), u = unitOf(k);
    if (!areaKeys.has(u)) { unmatched.push(c); continue; }
    byCode.set(v.code, u);
    if (k === 'maguindanao') whole.add(u);
    if (/^ncr\d$/.test(u) || u === 'maguindanao') partOf.set(v.code, u);
  }
  // A table that prints a whole (an NCR district, or Maguindanao before its split) and also its parts
  // (the district's cities, del Norte and del Sur) must count the whole once, not whole + parts.
  for (const [code, u] of partOf) if (whole.has(u) && !(/^ncr\d$/.test(u) ? NCR_DISTRICT.test(clean(values.find((v) => v.code === code).label)) : key(values.find((v) => v.code === code).label) === 'maguindanao')) {
    byCode.delete(code);
    skipped.push(clean(values.find((v) => v.code === code).label));
  }
  return { byCode, unmatched, skipped };
}
