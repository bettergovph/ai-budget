/**
 * "Write to your representative" (`/hgab/2027/letter`): one formal letter per
 * legislative district, for constituents to download, edit, sign and send.
 *
 * A letter goes to the district's seat holder. When the DPWH office that
 * serves the district also serves other legislative districts (Tier B: the
 * connected office group of src/lib/hgab-leaderboard.ts), it goes to every
 * one of those districts' representatives, because the office's figures are
 * shared and never split. It asks them to explain their programs for the
 * district, to give the documents behind the projects the House bill lists
 * for the office but the NEP does not, and to account for the changes. The
 * annexes list those projects as published, with the page of each.
 *
 * Data contract for what `npm run build:hgab-letters`
 * (`scripts/build-hgab-letters.ts`) writes and `npm run verify:hgab` re-checks:
 *
 *   data/hgab/2027/letters/index.json    LetterIndex: one line per district (the picker)
 *   data/hgab/2027/letters/<slug>.json   LetterData: what composeLetter reads (the letter page)
 *   data/hgab/2027/letters/<slug>.txt    letterText(composeLetter(data)): UTF-8 with BOM, to edit
 *   data/hgab/2027/letters/<slug>.pdf    letterHtml(composeLetter(data)) on A4, to print and sign
 *
 * The section's rules hold: the amounts are the office's, never a person's;
 * "no match in the NEP" is a candidate, not a finding; the documents do not
 * say who asked for a project, so the letter asks. The letter is something
 * citizens send, so it states the disclaimers in plain words and links the
 * full text rather than quoting it (Jason, 2026-10-28). The address is the
 * House's. An email or phone number appears only when the representative's
 * bills.juris.ph author record carries one (none did when this was written).
 *
 * Pure (imports only other pure modules, no `import.meta.env`, no DOM): the
 * builder, the verifier and the page all use it, so the preview, the text
 * file and the PDF say the same thing.
 */
import { DISCLAIMERS_PATH } from './hgab-disclaimers';
import { asOfText, formatPesoFull } from './hgab-leaderboard';

export const LETTER_SCHEMA = 1 as const;
export const LETTER_ROOT = '/hgab/2027/letter';
/** Paths under the data host (`dataUrl`), the same keys on R2. */
export const LETTERS_DATA_DIR = 'hgab/2027/letters';
export const LETTER_INDEX_PATH = `${LETTERS_DATA_DIR}/index.json`;
/** Absolute links printed in the letter: this site, and the data host that serves the source PDFs. */
export const LETTER_SITE = 'https://budget.bettergov.ph';
export const LETTER_DATA_HOST = 'https://budget-assets.bettergov.ph';

/** The House's mailing address, printed under every representative. */
export const HOUSE_ADDRESS: readonly string[] = [
  'House of Representatives',
  'Batasang Pambansa Complex',
  'Constitution Hills, Quezon City 1126',
];

/** Who prepared the template: in the letterhead, on every page's footer and in the notes. */
export const LETTER_CREDIT = 'People’s Budget Coalition and BetterGov.ph';

/** Copied on every letter, after the enclosures: the House leadership and the committee that shape the budget bill. */
export const COPY_FURNISHED: readonly string[] = [
  'The Speaker of the House of Representatives',
  'The Majority Leader, House of Representatives',
  'The Chairperson, Committee on Appropriations, House of Representatives',
];

/** Blank rows on the signature sheet (one A4 page). */
export const SIGNATURE_ROWS = 20;

/** "leg:abra:lone" → "abra-lone"; the builder checks every slug is unique. */
export function letterSlug(districtId: string): string {
  return districtId.replace(/^leg:/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function letterPath(slug?: string): string {
  return slug ? `${LETTER_ROOT}/${slug}` : LETTER_ROOT;
}

/** `hgab/2027/letters/abra-lone.pdf` */
export function letterFile(slug: string, ext: 'json' | 'txt' | 'pdf'): string {
  return `${LETTERS_DATA_DIR}/${slug}.${ext}`;
}

/** The download's file name (R2 sends it as Content-Disposition). */
export function letterDownloadName(slug: string, ext: 'txt' | 'pdf'): string {
  return `letter-to-your-representative-${slug}-2027.${ext}`;
}

// ---------------------------------------------------------------------------
// Data contract
// ---------------------------------------------------------------------------

export interface LetterRecipient {
  district_id: string;
  /** "Abra, Lone District" */
  district: string;
  /** The district this letter is written from; it is listed first. */
  own: boolean;
  status: 'resolved' | 'ambiguous' | 'missing';
  /** As the House member list gives them ("Bernos, JB"); an ambiguous seat lists every member named for it. */
  names: string[];
  /** The member's congress.gov.ph profile, which lists the office's contact details. */
  profile_url: string | null;
  /** From the bills.juris.ph author record, when it carries one; null otherwise. */
  email: string | null;
  phone: string | null;
}

/** One project line, short keys as in changes-list.json. */
export interface LetterRow {
  /** Record id in dpwh/projects.parquet. */
  i: string;
  /** Title as published. */
  t: string;
  /** NEP amount, integer pesos; null = no NEP record. */
  n: number | null;
  /** House bill (third reading) amount, integer pesos; null = no House record. */
  h: number | null;
  /** House minus NEP for adjusted rows; null otherwise. */
  d: number | null;
  /** 1: unconfirmed match, counted with the insertions. */
  u?: 1;
  /** Lines the House bill lists for this row, when more than one. */
  m?: number;
  /** PDF page in the NEP volume / the House bill volume; null when that document has no record. */
  np: number | null;
  hp: number | null;
}

export interface LetterDocument {
  key: string;
  /** How the letter names it: "the 2027 NEP, Volume II-B (DPWH)". */
  title: string;
}

export interface LetterFigures {
  /** The office group's compared DPWH project lines (the leaderboard entry's figures). */
  nep_php: number | null;
  nep_rows: number;
  house_php: number | null;
  house_rows: number;
  /** Insertion candidates, the unconfirmed matches included. */
  inserted_rows: number;
  inserted_php: number;
  unconfirmed_rows: number;
  unconfirmed_php: number;
  /** Σ House minus NEP of the increased rows (positive) and of the decreased rows (negative). */
  increased_rows: number;
  increased_php: number;
  decreased_rows: number;
  decreased_php: number;
  /** Deletion candidates: in the NEP, not in the House bill. */
  dropped_rows: number;
  dropped_php: number;
  /** Paired lines touching these offices whose two sides name different office groups: held out, as everywhere. */
  office_change_rows: number;
}

export interface LetterData {
  schema: typeof LETTER_SCHEMA;
  fiscal_year: 2027;
  built_at: string;
  source_commit: string;
  slug: string;
  district: { id: string; label: string; jurisdiction: string; district_label: string; region: string | null };
  /** A: the office serves only this district; B: shared, not split; null: no DPWH district engineering office. */
  tier: 'A' | 'B' | null;
  /** The office group's DPWH offices ("Abra DEO"). */
  offices: string[];
  /** The district's own seat first, then every other district the office group serves. */
  recipients: LetterRecipient[];
  /** Null when no DPWH district engineering office serves the district. */
  figures: LetterFigures | null;
  /** House bill amount largest first. */
  inserted: LetterRow[];
  /** Largest change first. */
  adjusted: LetterRow[];
  /** NEP amount largest first. */
  dropped: LetterRow[];
  documents: { nep: LetterDocument; house: LetterDocument };
  /** What the House bill lists under the DPWH Central Office and regional offices, nationally: named in no district. */
  residual_php: number;
}

export interface LetterIndexEntry {
  slug: string;
  district_id: string;
  label: string;
  jurisdiction: string;
  region: string | null;
  tier: 'A' | 'B' | null;
  offices: string[];
  /** Seat holders' names as listed (ambiguous seats joined with " / "), own district first. */
  recipients: string[];
  inserted_rows: number;
  inserted_php: number;
  adjusted_rows: number;
  dropped_rows: number;
}

export interface LetterIndex {
  schema: typeof LETTER_SCHEMA;
  fiscal_year: 2027;
  built_at: string;
  source_commit: string;
  letters: LetterIndexEntry[];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * The name as a letter prints it, in full: "Abante, Bienvenido Jr. M." →
 * "Bienvenido M. Abante Jr."; "Agyao, Caroline B., M.D." → "Caroline B.
 * Agyao, M.D.". Unlike displayName it keeps middle initials and
 * post-nominals; it drops a leading honorific, since the letter adds "Hon.".
 */
export function formalName(name: string): { full: string; surname: string } {
  const clean = name.trim();
  const m = /^([^,]+),\s*(.+)$/.exec(clean);
  if (!m) return { full: clean, surname: clean.split(/\s+/).pop() ?? clean };
  const surname = m[1].trim();
  const [first = '', ...post] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  let given = first;
  let tail = '';
  const suffix = /\s+(Jr\.?|Sr\.?|II|III|IV|V)(?=\s|$)/.exec(given);
  if (suffix) {
    tail = ` ${suffix[1]}`;
    given = given.replace(suffix[0], '');
  }
  given = given.replace(/^(?:Atty|Dr|Engr|Hon)\.\s+/, '');
  const full = `${given} ${surname}${tail}${post.length ? `, ${post.join(', ')}` : ''}`
    .replace(/"([^"]+)"/g, '“$1”')
    .replace(/\s+/g, ' ')
    .trim();
  return { full, surname };
}

/** "A", "A and B", "A, B and C". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "DPWH Abra DEO"; two offices: "DPWH Ifugao 1st DEO and Ifugao 2nd DEO". */
export function letterOfficeText(offices: readonly string[]): string {
  return offices.length ? `DPWH ${joinAnd(offices)}` : '';
}

const peso = formatPesoFull;
const signedPeso = (v: number) => (v > 0 ? `+${peso(v)}` : peso(v));
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
/** The same, to start a sentence: "One project", "7 projects". */
const Count = (n: number, one: string, many = `${one}s`) => (n === 1 ? `One ${one}` : count(n, one, many));

// ---------------------------------------------------------------------------
// The letter, as blocks
// ---------------------------------------------------------------------------

/** One run of text in a table cell: a link, or a small flag ("match unconfirmed"). */
export interface LetterPart {
  text: string;
  href?: string;
  flag?: boolean;
}

export interface LetterColumn {
  label: string;
  /** Amounts: right-aligned, tabular. */
  num?: boolean;
  /** The page column: printed bare in the text file. */
  pages?: boolean;
}

export type LetterBlock =
  | { kind: 'letterhead'; title: string; lines: string[] }
  | { kind: 'recipients'; items: string[][] }
  | { kind: 'subject'; text: string }
  | { kind: 'salutation'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'requests'; items: Array<{ text: string; sub?: string[] }> }
  | { kind: 'closing'; lines: string[] }
  | { kind: 'enclosures'; items: string[] }
  | { kind: 'copies'; items: string[] }
  | { kind: 'signatures'; title: string; intro: string; columns: string[]; rows: number }
  | { kind: 'annex'; id: 'A' | 'B' | 'C'; title: string; intro: string; columns: LetterColumn[]; rows: LetterPart[][][]; total: string }
  | { kind: 'notes'; title: string; items: string[] };

export interface LetterDoc {
  /** "Letter to the representative of Abra, Lone District" */
  title: string;
  /** The running footer line. */
  footer: string;
  blocks: LetterBlock[];
}

/** Text in square brackets is for the sender to fill in; renderers mark it. */
export const PLACEHOLDER_RE = /\[[^\]]+\]/g;

function recipientLines(r: LetterRecipient): string[] {
  const lines: string[] = [];
  if (r.status === 'resolved' && r.names[0]) {
    lines.push(`HON. ${formalName(r.names[0]).full.toLocaleUpperCase('en-US')}`);
  } else if (r.status === 'ambiguous' && r.names.length) {
    lines.push('HON. [NAME OF THE REPRESENTATIVE]');
    lines.push(`[The House member list names ${joinAnd(r.names.map((n) => formalName(n).full))} for this seat. Keep the right name.]`);
  } else {
    lines.push('HON. [NAME OF THE REPRESENTATIVE]');
  }
  lines.push(`Representative, ${r.district}`, ...HOUSE_ADDRESS);
  if (r.email) lines.push(`Email: ${r.email}`);
  if (r.phone) lines.push(`Telephone: ${r.phone}`);
  return lines;
}

function salutation(recipients: readonly LetterRecipient[]): string {
  if (recipients.length > 1) return 'Dear Representatives:';
  const r = recipients[0];
  if (r?.status === 'resolved' && r.names[0]) return `Dear Representative ${formalName(r.names[0]).surname}:`;
  return 'Dear Representative:';
}

function pageLink(doc: LetterDocument, page: number, label: string): LetterPart {
  return { text: `${label} p. ${page}`, href: `${LETTER_DATA_HOST}/hgab/2027/pdf/${doc.key}.pdf#page=${page}` };
}

function titleCell(r: LetterRow): LetterPart[] {
  const parts: LetterPart[] = [{ text: r.t.replace(/\s+/g, ' ').trim(), href: `${LETTER_SITE}/hgab/2027/dpwh/p/${encodeURIComponent(r.i)}` }];
  if (r.u) parts.push({ text: 'match unconfirmed', flag: true });
  if (r.m && r.m > 1) parts.push({ text: `${r.m} lines`, flag: true });
  return parts;
}

function pagesCell(r: LetterRow, docs: LetterData['documents']): LetterPart[] {
  const out: LetterPart[] = [];
  if (r.n != null && r.np) out.push(pageLink(docs.nep, r.np, 'NEP'));
  if (r.h != null && r.hp) out.push(pageLink(docs.house, r.hp, 'HB'));
  return out;
}

/**
 * The letter for one district. Every figure comes from `data`; sections with
 * nothing to list are left out, and so are the requests that refer to them.
 */
export function composeLetter(data: LetterData): LetterDoc {
  const { district, recipients, figures: f, documents: docs } = data;
  const many = recipients.length > 1;
  const plural = data.offices.length > 1;
  const office = letterOfficeText(data.offices);
  const others = recipients.filter((r) => !r.own).map((r) => r.district);
  const ins = data.inserted.length, adj = data.adjusted.length, drop = data.dropped.length;
  const any = ins + adj + drop > 0;
  const blocks: LetterBlock[] = [];

  blocks.push({ kind: 'letterhead', title: `Constituents of ${district.label}`, lines: [`Prepared with the ${LETTER_CREDIT}`] });
  blocks.push({ kind: 'recipients', items: recipients.map(recipientLines) });
  blocks.push({
    kind: 'subject',
    text: `Subject: DPWH projects for ${district.label} in House Bill No. 10858, the 2027 budget: request for explanation, documents and accountability`,
  });
  blocks.push({ kind: 'salutation', text: salutation(recipients) });

  // Who is writing, and why to these representatives.
  let opening = `We are residents and voters of ${district.label}.`;
  opening += others.length
    ? ` Our district is served by the ${office}, which also ${plural ? 'serve' : 'serves'} ${joinAnd(others)}.` +
      ` We write to our representative, and to the representatives of those districts, about the 2027 budget for the projects ${plural ? 'these offices carry' : 'this office carries'} out.`
    : ' We write to you as our representative about the 2027 budget for our district.';
  opening += ' We ask for an explanation, for documents, and for accountability.';
  blocks.push({ kind: 'paragraph', text: opening });

  // What the documents show.
  blocks.push({ kind: 'heading', text: 'What the published documents show' });
  if (!f) {
    blocks.push({
      kind: 'paragraph',
      text:
        'The House of Representatives has approved House Bill No. 10858, the General Appropriations Bill for 2027, on third reading. ' +
        'Its list of DPWH projects names no DPWH district engineering office for our district, so the projects meant for our district cannot be told apart from the rest. ' +
        'No project list is attached for that reason. We ask you to tell us what they are.',
    });
  } else {
    blocks.push({
      kind: 'paragraph',
      text:
        'The House of Representatives has approved House Bill No. 10858, the General Appropriations Bill for 2027, on third reading. ' +
        'BetterGov.ph compared its list of DPWH projects with the NEP, the budget the President submitted to Congress. ' +
        `For the ${office}, which ${plural ? 'carry' : 'carries'} out DPWH projects in our district:`,
    });
    const bullets: string[] = [
      f.nep_rows ? `The NEP lists ${count(f.nep_rows, 'project')} worth ${peso(f.nep_php)}.` : 'The NEP lists no projects for this office.',
      f.house_rows ? `The House bill lists ${count(f.house_rows, 'project')} worth ${peso(f.house_php)}.` : 'The House bill lists no projects for this office.',
    ];
    if (ins) {
      bullets.push(
        `${Count(ins, 'project')} in the House bill, worth ${peso(f.inserted_php)}, ${ins === 1 ? 'has' : 'have'} no match in the NEP (Annex A).` +
        (f.unconfirmed_rows
          ? ` For ${f.unconfirmed_rows === 1 ? 'one' : f.unconfirmed_rows.toLocaleString('en-US')} of them, worth ${peso(f.unconfirmed_php)}, a possible match could not be confirmed.`
          : ''),
      );
    } else {
      bullets.push('Every project the House bill lists for this office has a match in the NEP.');
    }
    if (adj) {
      const parts: string[] = [];
      const moved = (n: number, how: string, php: number) =>
        `${count(n, 'project')} ${n === 1 ? 'was' : 'were'} ${how}, by ${peso(php)}${n === 1 ? '' : ' in all'}`;
      if (f.increased_rows) parts.push(moved(f.increased_rows, 'increased', f.increased_php));
      if (f.decreased_rows) parts.push(moved(f.decreased_rows, 'decreased', -f.decreased_php));
      bullets.push(`${joinAnd(parts)} (Annex B).`.replace(/^1 project/, 'One project'));
    }
    if (drop) {
      bullets.push(`${Count(drop, 'project')} in the NEP, worth ${peso(f.dropped_php)}, ${drop === 1 ? 'is' : 'are'} not in the House bill (Annex C).`);
    }
    blocks.push({ kind: 'bullets', items: bullets });
    blocks.push({
      kind: 'paragraph',
      text: any
        ? `The documents do not say who asked for these changes. The House of Representatives, of which you are ${many ? 'members' : 'a member'}, approved them. We therefore ask you to explain them.`
        : 'The documents do not say who asked for any of these projects. We ask you to explain the programs behind them.',
    });
  }

  // The requests.
  blocks.push({ kind: 'heading', text: 'Our requests' });
  blocks.push({ kind: 'paragraph', text: 'Within fifteen (15) working days of receiving this letter, please:' });
  const requests: Array<{ text: string; sub?: string[] }> = [
    { text: 'Explain the programs and projects you have proposed or supported for our district in the 2027 budget, and the needs each one is meant to meet.' },
  ];
  const documentsAsked = [
    'the written request, proposal or endorsement for the project;',
    'the program of work and the detailed cost estimate;',
    'the exact location, and the barangays and people it will serve;',
    'the feasibility study or detailed engineering design, or when it will be ready;',
    'the implementing office, the schedule, and how we can follow its progress.',
  ];
  if (ins) {
    requests.push({ text: 'For each project in Annex A, tell us who proposed adding it to the House bill, when, and why. Please give us:', sub: documentsAsked });
  } else if (!f) {
    requests.push({ text: 'List the 2027 projects for our district, with their amounts, and give us for each one:', sub: documentsAsked });
  }
  if (adj) requests.push({ text: 'For each project in Annex B, explain why its amount was changed.' });
  if (drop) {
    requests.push({
      text: `For each project in Annex C, explain why it is not in the House bill: was it dropped, renamed, or merged into another project${ins ? ' in Annex A' : ''}? Tell us whether it will still be carried out.`,
    });
  }
  const annexes = [ins && 'A', adj && 'B', drop && 'C'].filter(Boolean) as string[];
  if (any) requests.push({ text: `Tell us whether you requested, endorsed or sponsored any of the projects in ${annexes.length === 1 ? `Annex ${annexes[0]}` : `Annexes ${joinAnd(annexes)}`}.` });
  requests.push({ text: 'Make your answers and these documents public, and report to us regularly on how each project is carried out.' });
  requests.push({ text: 'Meet with us in a public forum in our district to discuss these projects.' });
  blocks.push({ kind: 'requests', items: requests });

  // The basis, and the spirit of the request.
  blocks.push({ kind: 'heading', text: 'Our basis' });
  blocks.push({
    kind: 'paragraph',
    text:
      'The Constitution recognizes the right of the people to information on matters of public concern (Article III, Section 7). ' +
      'It adopts a policy of full public disclosure of all transactions involving public interest (Article II, Section 28). ' +
      'Public office is a public trust, and public officers must at all times be accountable to the people (Article XI, Section 1). ' +
      'Republic Act No. 6713 requires public officials to respond to letters from the public within fifteen (15) working days (Section 5(a)).',
  });
  blocks.push({
    kind: 'paragraph',
    text:
      (any ? 'We ask in good faith. A project missing from the NEP is not, by itself, proof of wrongdoing, and we accuse no one. ' : 'We ask in good faith, and we accuse no one. ') +
      'But every peso for our district should be explained to the people it is meant to serve.',
  });
  blocks.push({ kind: 'paragraph', text: 'Please send your written reply to the address below. We will share it with our community.' });
  // The sender fills these in; they sit under the signature, not in the letterhead.
  blocks.push({
    kind: 'closing',
    lines: [
      'Respectfully yours,', '',
      '[Signature over printed name]',
      '[Name of your group or organization, if any]',
      '[Address]',
      '[Email] · [Mobile number]',
      '[Date]',
      `For the undersigned constituents of ${district.label} (signatures on the attached sheet)`,
    ],
  });
  const enclosures = ['Signature sheet'];
  if (ins) enclosures.push(`Annex A: ${count(ins, 'project')} in the House bill with no match in the NEP`);
  if (adj) enclosures.push(`Annex B: ${count(adj, 'project')} whose amount changed`);
  if (drop) enclosures.push(`Annex C: ${count(drop, 'project')} in the NEP that the House bill does not list`);
  enclosures.push('About these figures');
  blocks.push({ kind: 'enclosures', items: enclosures });
  blocks.push({ kind: 'copies', items: [...COPY_FURNISHED] });

  // Signature sheet.
  const names = recipients.map((r) => (r.status === 'resolved' && r.names[0] ? `Hon. ${formalName(r.names[0]).full}` : `the Representative of ${r.district}`));
  blocks.push({
    kind: 'signatures',
    title: 'Signature sheet',
    intro: `We, the undersigned constituents of ${district.label}, support this letter to ${joinAnd(names)} on the DPWH projects for our district in House Bill No. 10858, dated [date].`,
    columns: ['No.', 'Full name', 'Barangay, city or municipality', 'Mobile number or email (optional)', 'Signature'],
    rows: SIGNATURE_ROWS,
  });

  // Annexes.
  const where = `Listed under the ${office}.`;
  if (ins) {
    blocks.push({
      kind: 'annex', id: 'A',
      title: 'Annex A. Projects in the House bill with no match in the NEP',
      intro: `${where} House bill amount, largest first.${f?.unconfirmed_rows ? ' “Match unconfirmed”: a possible match in the NEP could not be confirmed.' : ''}`,
      columns: [{ label: 'No.' }, { label: 'Project, as published' }, { label: 'House bill', num: true }, { label: 'Pages', pages: true }],
      rows: data.inserted.map((r, k) => [[{ text: `${k + 1}` }], titleCell(r), [{ text: peso(r.h) }], pagesCell(r, docs)]),
      total: `${count(ins, 'project')}, ${peso(f?.inserted_php ?? 0)} in the House bill.`,
    });
  }
  if (adj) {
    blocks.push({
      kind: 'annex', id: 'B',
      title: 'Annex B. Projects whose amount changed',
      intro: `${where} Largest change first.`,
      columns: [{ label: 'No.' }, { label: 'Project, as published' }, { label: 'NEP', num: true }, { label: 'House bill', num: true }, { label: 'Change', num: true }, { label: 'Pages', pages: true }],
      rows: data.adjusted.map((r, k) => [[{ text: `${k + 1}` }], titleCell(r), [{ text: peso(r.n) }], [{ text: peso(r.h) }], [{ text: r.d == null ? '—' : signedPeso(r.d) }], pagesCell(r, docs)]),
      total: [
        f?.increased_rows ? `${count(f.increased_rows, 'increase')}, ${signedPeso(f.increased_php)}` : '',
        f?.decreased_rows ? `${count(f.decreased_rows, 'decrease')}, ${signedPeso(f.decreased_php)}` : '',
      ].filter(Boolean).join('; ') + '.',
    });
  }
  if (drop) {
    blocks.push({
      kind: 'annex', id: 'C',
      title: 'Annex C. Projects in the NEP that the House bill does not list',
      intro: `${where} NEP amount, largest first.`,
      columns: [{ label: 'No.' }, { label: 'Project, as published' }, { label: 'NEP', num: true }, { label: 'Pages', pages: true }],
      rows: data.dropped.map((r, k) => [[{ text: `${k + 1}` }], titleCell(r), [{ text: peso(r.n) }], pagesCell(r, docs)]),
      total: `${count(drop, 'project')}, ${peso(f?.dropped_php ?? 0)} in the NEP.`,
    });
  }

  // About these figures: the sources, and the section's disclaimers.
  const served = recipients.map((r) => r.district);
  const notes: string[] = [
    `Sources: ${docs.nep.title}, and ${docs.house.title}, as published. “NEP p.” and “HB p.” are page numbers in their PDF files.`,
  ];
  if (f) {
    notes.push(
      `The amounts are the allocations these documents list under the ${office}. They belong to the ${plural ? 'offices' : 'office'}, not to any representative. ` +
      (data.tier === 'B'
        ? `${plural ? 'These offices serve' : 'The office serves'} ${served.length} legislative districts (${joinAnd(served)}). ${plural ? 'Their' : 'Its'} totals are shared and not split among them, and a project listed under ${plural ? 'them' : 'it'} may be in any of these districts.`
        : `${plural ? 'These offices serve' : 'The office serves'} only ${district.label}.`),
    );
    notes.push(
      '“No match in the NEP” and “not in the House bill” describe a comparison of the two documents. Each is a candidate for review, not a finding of wrongdoing. ' +
      'The documents do not say who asked for any project.' +
      (ins && drop ? ' A project in Annex C may be one in Annex A under a new title or amount, where the comparison could not pair the two.' : ''),
    );
    let residual = `The House bill also lists ${peso(data.residual_php)} of DPWH projects under the Central Office and regional offices. They name no district and are not in this letter.`;
    if (f.office_change_rows) {
      residual += ` ${count(f.office_change_rows, 'more project')} touching ${plural ? 'these offices' : 'this office'} ${f.office_change_rows === 1 ? 'is' : 'are'} left out because the NEP and the House bill list ${f.office_change_rows === 1 ? 'it' : 'them'} under different DPWH offices.`;
    }
    notes.push(residual);
  } else {
    notes.push('The documents list DPWH projects by DPWH office. No district engineering office is listed for this district, so no project can be linked to it. The documents do not say who asked for any project.');
  }
  notes.push(`This letter online, with the record of every project in it: ${LETTER_SITE}${letterPath(data.slug)}. The full disclaimer: ${LETTER_SITE}${DISCLAIMERS_PATH}.`);
  notes.push(`Prepared with the ${LETTER_CREDIT}. Figures ${asOfText(data).replace(/^As of/, 'as of')}.`);
  blocks.push({ kind: 'notes', title: 'About these figures', items: notes });

  const to = many ? `the ${recipients.length} representatives` : 'the representative';
  return {
    title: `Letter to ${to} of ${many ? `the districts served by the ${office}` : district.label}`,
    footer: `Constituents of ${district.label} · Prepared with the ${LETTER_CREDIT}`,
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const partText = (parts: readonly LetterPart[]) =>
  parts.map((p, k) => (p.flag ? ` (${p.text})` : `${k ? ' · ' : ''}${p.text}`)).join('');

/**
 * Plain text, to edit in any word processor: paragraphs are single lines (the
 * editor wraps them), annex rows become numbered entries, the signature sheet
 * numbered blank lines. Placeholders keep their square brackets.
 */
export function letterText(doc: LetterDoc): string {
  const out: string[] = [];
  const rule = '—'.repeat(40);
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'letterhead':
        out.push(b.title.toLocaleUpperCase('en-US'), ...b.lines, '');
        break;
      case 'recipients':
        for (const r of b.items) out.push(...r, '');
        break;
      case 'subject':
      case 'salutation':
      case 'paragraph':
        out.push(b.text, '');
        break;
      case 'heading':
        out.push(b.text.toLocaleUpperCase('en-US'), '');
        break;
      case 'bullets':
        out.push(...b.items.map((t) => `  • ${t}`), '');
        break;
      case 'requests':
        b.items.forEach((r, k) => {
          out.push(`  ${k + 1}. ${r.text}`);
          r.sub?.forEach((s, j) => out.push(`     ${String.fromCharCode(97 + j)}. ${s}`));
        });
        out.push('');
        break;
      case 'closing':
        out.push(b.lines[0], '', '', ...b.lines.slice(2), '');
        break;
      case 'enclosures':
        out.push('Enclosures:', ...b.items.map((t) => `  ${t}`), '');
        break;
      case 'copies':
        out.push('Copy furnished:', ...b.items.map((t) => `  ${t}`), '');
        break;
      case 'signatures':
        out.push(rule, b.title.toLocaleUpperCase('en-US'), '', b.intro, '');
        for (let k = 1; k <= b.rows; k++) {
          out.push(`${String(k).padStart(2)}. ${b.columns[1]}: ______________________________   ${b.columns[2]}: ______________________________`);
          out.push(`    ${b.columns[3]}: ____________________   ${b.columns[4]}: ____________________`, '');
        }
        break;
      case 'annex': {
        out.push(rule, b.title.toLocaleUpperCase('en-US'), b.intro, '');
        for (const row of b.rows) {
          const [n, title, ...rest] = row;
          out.push(`${partText(n)}. ${partText(title)}`);
          const detail = rest
            .map((cell, k) => {
              const col = b.columns[k + 2];
              const text = partText(cell);
              if (!text) return '';
              return col?.pages ? text : `${col?.label}: ${text}`;
            })
            .filter(Boolean)
            .join(' · ');
          out.push(`   ${detail}`, '');
        }
        out.push(`Total: ${b.total}`, '');
        break;
      }
      case 'notes':
        out.push(rule, b.title.toLocaleUpperCase('en-US'), '', ...b.items.flatMap((t) => [`  • ${t}`, '']));
        break;
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Escaped text; each [placeholder] becomes a blank to fill in, its words a small hint on the line. */
function inline(s: string): string {
  let html = '';
  let at = 0;
  for (const m of s.matchAll(PLACEHOLDER_RE)) {
    html += esc(s.slice(at, m.index)) + `<span class="lt-fill">${esc(m[0].slice(1, -1))}</span>`;
    at = (m.index ?? 0) + m[0].length;
  }
  return html + esc(s.slice(at));
}

function cellHtml(parts: readonly LetterPart[], pages: boolean): string {
  return parts
    .map((p) => {
      if (p.flag) return ` <span class="lt-flag">${esc(p.text)}</span>`;
      const t = esc(p.text);
      return p.href ? `<a href="${esc(p.href)}">${t}</a>` : t;
    })
    .join(pages ? '<br>' : '');
}

/**
 * The letter as HTML, classes prefixed `lt-`: the page shows it as the
 * preview (src/hgab-letter.css) and the builder prints it to PDF with its own
 * print stylesheet. The signature sheet is a page of its own; the annexes and
 * the notes follow it from a new page, one after the other (`lt-page` marks
 * where a page starts).
 */
export function letterHtml(doc: LetterDoc): string {
  const h: string[] = [];
  let afterSheet = false;
  const page = () => {
    const starts = afterSheet;
    afterSheet = false;
    return starts ? ' lt-page' : '';
  };
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'letterhead':
        h.push(`<header class="lt-head"><p class="lt-head-title">${inline(b.title)}</p>${b.lines.map((l) => `<p class="lt-head-line">${inline(l)}</p>`).join('')}</header>`);
        break;
      case 'recipients':
        h.push(`<div class="lt-to${b.items.length > 1 ? ' is-many' : ''}">${b.items.map((r) => `<address class="lt-addr">${r.map((l, k) => (k === 0 ? `<strong>${inline(l)}</strong>` : inline(l))).join('<br>')}</address>`).join('')}</div>`);
        break;
      case 'subject':
        h.push(`<p class="lt-subject">${inline(b.text)}</p>`);
        break;
      case 'salutation':
        h.push(`<p class="lt-salutation">${inline(b.text)}</p>`);
        break;
      case 'heading':
        h.push(`<h3 class="lt-h">${inline(b.text)}</h3>`);
        break;
      case 'paragraph':
        h.push(`<p>${inline(b.text)}</p>`);
        break;
      case 'bullets':
        h.push(`<ul class="lt-bullets">${b.items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
        break;
      case 'requests':
        h.push(`<ol class="lt-requests">${b.items.map((r) => `<li>${inline(r.text)}${r.sub ? `<ol class="lt-sub">${r.sub.map((s) => `<li>${inline(s)}</li>`).join('')}</ol>` : ''}</li>`).join('')}</ol>`);
        break;
      case 'closing':
        h.push(`<div class="lt-closing"><p>${inline(b.lines[0])}</p><div class="lt-sign-space"></div>${b.lines.slice(2).map((l) => `<p>${inline(l)}</p>`).join('')}</div>`);
        break;
      case 'enclosures':
        h.push(`<div class="lt-enc"><p>Enclosures:</p><ul>${b.items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul></div>`);
        break;
      case 'copies':
        h.push(`<div class="lt-enc lt-cc"><p>Copy furnished:</p><ul>${b.items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul></div>`);
        break;
      case 'signatures':
        h.push(
          `<section class="lt-page lt-sheet"><h2 class="lt-annex-title">${inline(b.title)}</h2><p class="lt-annex-intro">${inline(b.intro)}</p>` +
          `<table class="lt-table lt-sig"><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
          Array.from({ length: b.rows }, (_, k) => `<tr><td class="lt-n">${k + 1}</td>${b.columns.slice(1).map(() => '<td></td>').join('')}</tr>`).join('') +
          '</tbody></table></section>',
        );
        afterSheet = true;
        break;
      case 'annex':
        h.push(
          `<section class="lt-annex${page()}" id="annex-${b.id.toLowerCase()}"><h2 class="lt-annex-title">${inline(b.title)}</h2><p class="lt-annex-intro">${inline(b.intro)}</p>` +
          `<table class="lt-table"><thead><tr>${b.columns.map((c) => `<th${c.num ? ' class="lt-num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>` +
          b.rows.map((row) => `<tr>${row.map((cell, k) => {
            const col = b.columns[k];
            const cls = k === 0 ? 'lt-n' : col?.num ? 'lt-num' : col?.pages ? 'lt-pages' : 'lt-title';
            return `<td class="${cls}">${cellHtml(cell, Boolean(col?.pages))}</td>`;
          }).join('')}</tr>`).join('') +
          `</tbody></table><p class="lt-total">Total: ${inline(b.total)}</p></section>`,
        );
        break;
      case 'notes':
        h.push(`<section class="lt-notes${page()}"><h2 class="lt-annex-title">${inline(b.title)}</h2><ul>${b.items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul></section>`);
        break;
    }
  }
  return h.join('\n');
}
