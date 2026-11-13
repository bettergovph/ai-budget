/**
 * The volunteer team's red-flag registry (RF-001…RF-044) in the project reviewer, and the review a volunteer files.
 * Pure: no fetches, no `import.meta`; tests and a future API can use it as is. Docs: docs/hgab-review-form.md.
 *
 * Two kinds of flag meet here and are kept apart, as the team's integration spec asks ("detector_rule_id … NOT
 * identical to volunteer Flag ID"):
 *   - detector flags: research.bettergov.ph's machine flags and our missing-document flags (review.json codes);
 *   - team flags: the registry's human checks, with a lead specialist, what to check, minimum evidence and a
 *     safeguard (src/lib/hgab-redflag-registry.json, from the team's workbook; npm run build:hgab-redflag-registry).
 * DETECTOR_TO_TEAM says which team checks a detector flag suggests. It is our proposal for the team to review: a
 * detector flag makes a team check an "AI candidate", never a finding.
 *
 * The review (`CaseReview`) is what the API stores (src/worker/hgab-reviews.ts): stable codes, the registry version
 * its flag ids mean, provenance for every piece of evidence, and the workbook's own vocabularies (labels kept for
 * display and CSV). It also exports as JSON or as rows of the workbook's CASE INTAKE & TRACKER and CASE EVIDENCE
 * TEMPLATE sheets.
 */
import registryJson from './hgab-redflag-registry.json';
import { NAMED_TYPES, OUR_NEP_FLAGS, type NamedType } from './hgab-documents';

// --- The registry ----------------------------------------------------------------------------------------------

export interface TeamFlag {
  id: string;
  source_row: number;
  category: string;
  title: string;
  investigate: string | null;
  continuation: string | null;
  steps: number[];
  lead_task: string;
  lead_skill: string;
  support_tasks: string[];
  support_skills: string[];
  instructions: string;
  minimum_evidence: string[];
  automation: string | null;
  safeguard: string;
  related: string | null;
  status: string;
}
export interface TeamTask { id: string; step: number; role: string; checks: string; sources: string; deliverable: string; qa: string; handoff: string; recruitment: string | null }
export interface TeamRegistry {
  schema: number;
  source: { file: string; sha256: string; version: string; note: string };
  flags: TeamFlag[];
  drafts: { code: string; category: string; indicator: string; verification: string; linked_flags: string[]; linkage: string; status: string }[];
  tasks: TeamTask[];
  workflow: { step: number; stage: string; purpose: string; roles: string; handoff: string; safeguard: string }[];
  case_columns: string[];
  evidence_columns: string[];
  vocabularies: Record<VocabKey, string[]>;
  integration_spec: Record<string, string | null>[];
}
export type VocabKey =
  | 'case_stage' | 'evidence_applicability' | 'risk_priority' | 'human_outcome' | 'evidence_applicable_at_stage'
  | 'document_availability' | 'verification_state' | 'routing_status' | 'group_approval';

export const REGISTRY = registryJson as TeamRegistry;
export const TEAM_FLAGS: ReadonlyMap<string, TeamFlag> = new Map(REGISTRY.flags.map((f) => [f.id, f]));

/** "Cleared / explained" → "cleared_explained": the stable code for a workbook label. */
export const vocabCode = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export interface VocabOption { code: string; label: string }
export function vocab(key: VocabKey): VocabOption[] {
  return REGISTRY.vocabularies[key].map((label) => ({ code: vocabCode(label), label }));
}
export const vocabLabel = (key: VocabKey, code: string) => vocab(key).find((o) => o.code === code)?.label ?? code;
const codes = (key: VocabKey) => new Set(vocab(key).map((o) => o.code));

/** Outcomes a volunteer may record. "Referred with approval" is the review committee's (workflow step 8). */
export const VOLUNTEER_OUTCOMES = vocab('human_outcome').filter((o) => o.code !== 'referred_with_approval');
/**
 * Case stages a volunteer may pick. "AI candidate" is the machine's. "In independent review" is set only by "Ready
 * for independent review" (it must validate); "Completed" comes after the independent verifier (workflow step 5).
 */
export const VOLUNTEER_STAGES = vocab('case_stage').filter((o) => !['ai_candidate', 'in_independent_review', 'completed'].includes(o.code));
export const READY_STAGE = 'in_independent_review';

// --- Project types ----------------------------------------------------------------------------------------------

/** The registry's project categories, beside "Applicable to all". */
export const CATEGORY = {
  roads: 'Roads Construction / Asphalt',
  bridge: 'Bridge',
  flood: 'Flood Control & Drainage',
  buildings: 'Buildings & Multi-Purpose Facilities',
  water: 'Water Supply System',
  rainwater: 'Rainwater Collector System',
} as const;
export const ALL_CATEGORY = 'Applicable to all';
export type CategoryKey = keyof typeof CATEGORY;

/**
 * Which kinds of project this is, from its DPWH PAP and title. A project can be several ("Road with Drainage" is roads
 * and flood control). BIP "Access Roads and/or Bridges" lines are told apart by their titles.
 */
export function classifyProject(p: { title: string; pap?: string | null; program?: string | null }): CategoryKey[] {
  const pap = p.pap ?? '', t = p.title;
  const out = new Set<CategoryKey>();
  if (/Multi-Purpose Buildings|Buildings And Other Structures|Facilities for (Persons|Elderl)|Gender-Responsive Facilities/i.test(pap)
    || /multi[\s-]*purpose|\bbuilding\b|covered court|\bgym(nasium)?\b|\bhall\b/i.test(t)) out.add('buildings');
  if (/Water Supply/i.test(pap) || /water (supply|system)|potable/i.test(t)) out.add('water');
  if (/Rainwater/i.test(pap) || /rain\s*water/i.test(t)) out.add('rainwater');
  if (/Bridge/i.test(pap) && !/Roads and\/or Bridges/i.test(pap)) out.add('bridge');
  if (/\bbridges?\b|\bflyover\b|\bviaduct\b/i.test(t)) out.add('bridge');
  if (/Flood|Drainage/i.test(pap) || /flood|drainage|revetment|\bdikes?\b|seawall|slope protection|riprap|pumping|culvert|\bcanal\b|river ?wall|embankment/i.test(t)) out.add('flood');
  if (/Roads?\b|Paving|Off-Carriageway|By-Pass|Missing Links/i.test(pap) && !(/Roads and\/or Bridges/i.test(pap) && out.has('bridge') && !/\broad\b/i.test(t)))
    out.add('roads');
  if (/\broads?\b|highway|\bk0\d|concreting|asphalt|pavement|\bstreet\b/i.test(t)) out.add('roads');
  return (Object.keys(CATEGORY) as CategoryKey[]).filter((k) => out.has(k));
}

// --- Detector flags → team flags (our proposal, for the team to review) -----------------------------------------

/**
 * Which team checks each detector flag suggests. Every detector code in review.json must be here (an empty list
 * means "no team check fits"); the tests fail otherwise. Proposed by BetterGov from the flag definitions on
 * 2026-11-12; the team's integration spec requires a formal mapping and validation before it is relied on.
 */
export const DETECTOR_TO_TEAM: Readonly<Record<string, readonly string[]>> = {
  // NEP comparison → RF-024 New or increased budget allocations requiring justification
  'potential-nep-insertion': ['RF-024'],
  'house-bill-only-our-comparison': ['RF-024'],
  'nep-match-sources-disagree': ['RF-024'],
  'no-selected-nep-counterpart': ['RF-024'],
  'nep-counterpart-pairing-is-ambiguous': ['RF-024'],
  'nep-counterpart-needs-scope-review': ['RF-024', 'RF-016'],
  'allocation-increase': ['RF-024'],
  'allocation-decrease': ['RF-024'],
  'implementing-office-changed-between-nep-and-hgab': ['RF-024', 'RF-023'],
  'within-nep-counterpart-repeat-candidate': ['RF-034'],
  // Amount and cost
  'repeated-allocation-amount': ['RF-022'],
  'uniform-rcs-allocation-amount': ['RF-022'],
  'high-allocation-vs-same-category-peers': ['RF-035', 'RF-010'],
  'high-allocation-per-stated-meter': ['RF-002', 'RF-035'],
  'high-cost-per-stated-meter-vs-peers': ['RF-002', 'RF-035'],
  'extreme-cost-per-stated-meter-vs-peers': ['RF-002', 'RF-035'],
  'cost-per-meter-unavailable-length-review': ['RF-002', 'RF-025'],
  'very-short-printed-project-range': ['RF-002', 'RF-025'],
  // Location and map → RF-001 Overlapping project locations (coordinates vs the stated place)
  'possible-project-doppelganger-coordinates-under-50-m-apart': ['RF-001', 'RF-034'],
  'historical-gaa-coordinate-doppelganger-under-50-m': ['RF-001', 'RF-034', 'RF-009'],
  'mpb-same-site-coordinate-candidate-under-50-m': ['RF-001', 'RF-034'],
  'mpb-same-barangay-coordinate-pair': ['RF-001'],
  'coordinate-falls-outside-its-named-locality-map-review': ['RF-001'],
  'out-of-place-map-review-printed-coordinate': ['RF-001'],
  'mpb-location-boundary-review': ['RF-001'],
  'mpb-location-boundary-review-point-at-boundary': ['RF-001'],
  'mpb-location-boundary-match-unresolved': ['RF-001'],
  'conflicting-deo-and-congressional-district-labels-irreconcilable': ['RF-001'],
  // Repeats and history
  'historical-project-repeat-candidate': ['RF-034', 'RF-009'],
  'historical-gaa-title-recurrence': ['RF-009', 'RF-034'],
  'mpb-historical-site-or-scope-repeat-candidate': ['RF-034', 'RF-009', 'RF-029'],
  'within-hgab-repeat-candidate': ['RF-034'],
  'explicit-historical-chainage-overlap': ['RF-016', 'RF-034'],
  'bridge-rated-good-fair-in-inventory-assessment-date-needed': ['RF-018', 'RF-003'],
  'rehabilitation-on-recorded-good-fair-segment': ['RF-017'],
  'road-rehabilitation-recorded-segment-rated-good-fair': ['RF-017'],
  // Documents → RF-033 Incomplete documents, and the document's own check
  'no-listed-dpwh-transparency-documents': ['RF-033', 'RF-021'],
  'dpwh-transparency-match-not-verified': ['RF-033'],
  'no-listed-rdc': ['RF-044', 'RF-033'],
  'no-listed-geotagged-photos': ['RF-040', 'RF-033'],
  'no-listed-pow': ['RF-039', 'RF-033'],
  'missing-pow': ['RF-039', 'RF-033'],
  'missing-bp-202': ['RF-038', 'RF-033'],
  'missing-development-council': ['RF-044', 'RF-033'],
  'missing-geotagged-photos': ['RF-040', 'RF-033'],
  'missing-certificate-of-implementability': ['RF-041', 'RF-033'],
};
export const MAPPING_STATUS = 'Proposed by BetterGov, 2026-11-12 · pending team review';

/** The team check for each kind of document on file (rows 46–52 of the registry: document-specific reviews). */
export const DOCUMENT_TEAM_FLAG: Readonly<Record<NamedType, string>> = {
  'BP 202': 'RF-038',
  POW: 'RF-039',
  'Geotagged photos': 'RF-040',
  'Certificate of Implementability': 'RF-041',
  'Development Council': 'RF-044',
};
/** Proposal file types (DPWH Transparency labels) that bring in RF-042 Master Plan and RF-043 Feasibility Study. */
const SOURCE_TYPE_TEAM_FLAG: readonly [RegExp, string][] = [[/master ?plan/i, 'RF-042'], [/feasibility/i, 'RF-043']];

/**
 * Checks that only apply at a later stage than a budget bill. The registry's own safeguards say so: "Applicable only
 * when contractor awarded work"; "Concentration alone is not evidence…". They show as "not yet due".
 */
export const STAGE_GATED: Readonly<Record<string, string>> = {
  'RF-011': 'Procurement: only once contracts are awarded.',
  'RF-012': 'Procurement: only once contracts are awarded.',
};

// --- A project's checklist ----------------------------------------------------------------------------------------

export type ChecklistGroup = 'suggested' | 'documents' | 'category' | 'later';
export const CHECKLIST_GROUP_LABEL: Record<ChecklistGroup, string> = {
  suggested: 'Suggested by this project’s red flags',
  documents: 'The documents on file',
  category: 'Other checks for this kind of project',
  later: 'Not yet due at the budget stage',
};
export interface ChecklistItem {
  flag: TeamFlag;
  group: ChecklistGroup;
  /** Detector flags on this project that suggest the check. */
  detectors: string[];
  /** Document types on file that bring the check in. */
  documents: string[];
}

/**
 * The team checks for one project, in review order: those its detector flags suggest, those its documents bring in,
 * the rest that apply to its kind of project, and last those not yet due at the budget stage.
 */
export function checklistFor(input: {
  categories: readonly CategoryKey[];
  detectorCodes: readonly string[];
  /** Named types and source types of the files on file. */
  documentTypes: readonly string[];
}): ChecklistItem[] {
  const cats = new Set<string>([ALL_CATEGORY, ...input.categories.map((k) => CATEGORY[k])]);
  const items = new Map<string, ChecklistItem>();
  const get = (id: string): ChecklistItem | null => {
    const flag = TEAM_FLAGS.get(id);
    if (!flag) return null;
    const x = items.get(id) ?? { flag, group: 'category' as ChecklistGroup, detectors: [], documents: [] };
    items.set(id, x);
    return x;
  };
  for (const code of input.detectorCodes) for (const id of DETECTOR_TO_TEAM[code] ?? []) get(id)?.detectors.push(code);
  for (const t of new Set(input.documentTypes)) {
    const id = (DOCUMENT_TEAM_FLAG as Record<string, string>)[t] ?? SOURCE_TYPE_TEAM_FLAG.find(([re]) => re.test(t))?.[1];
    if (id) get(id)?.documents.push(t);
  }
  for (const f of REGISTRY.flags) if (cats.has(f.category)) get(f.id);
  for (const x of items.values()) {
    x.group = STAGE_GATED[x.flag.id] ? 'later' : x.detectors.length ? 'suggested' : x.documents.length ? 'documents' : 'category';
  }
  const order: ChecklistGroup[] = ['suggested', 'documents', 'category', 'later'];
  return [...items.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.detectors.length - a.detectors.length || a.flag.id.localeCompare(b.flag.id));
}

/** Projects a team check would pick up through its detector flags: the detector codes behind it. */
export function detectorsFor(teamFlagId: string): string[] {
  return Object.entries(DETECTOR_TO_TEAM).filter(([, ids]) => ids.includes(teamFlagId)).map(([code]) => code);
}

// --- The review (the API payload) ------------------------------------------------------------------------------------

export const CASE_REVIEW_SCHEMA = 'bettergov.hgab-review/1';
export const BUDGET_SOURCE_VERSION = 'House bill HB 10858, 3rd reading (FY2027)';

/**
 * A new id for a case or a piece of evidence: a random UUID. Ids are kept for life, never rewritten (older ids made
 * another way stay as they are).
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // randomUUID needs a secure context (https); getRandomValues doesn't.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Case and evidence ids: what newId makes, and the older `<time>-<random>` ids. */
export const CASE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const EVIDENCE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Team check ids, in any registry version: a review keeps its checks when the registry changes. */
export const FLAG_ID_RE = /^RF-\d{3}$/;
/** A review of a project, or a check of another member's review of it (workflow step 5; not open yet). */
export const CASE_KINDS = ['review', 'verification'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export interface EvidenceItem {
  evidence_id: string;
  /** "Senate (DPWH submission)", "DPWH Transparency", "House of Representatives", … */
  source_institution: string;
  document_title: string;
  url: string;
  /** Our file index ids, when the evidence is one of the project's files. */
  file_link_id: number | null;
  file_sha256: string | null;
  /** Page, table, cell. */
  locator: string;
  /** Verbatim text or amount. */
  extracted_fact: string;
  reviewer_observation: string;
  applicable_at_stage: string;   // vocab evidence_applicable_at_stage
  availability: string;          // vocab document_availability
  verification_state: string;    // vocab verification_state
}
export interface FlagCheck {
  flag_id: string;                // RF-xxx, meaning fixed by `registry`
  detector_rule_ids: string[];    // detector flags that suggested it (review.json codes)
  applicability: string;          // vocab evidence_applicability
  observed_discrepancy: string;   // facts only
  human_outcome: string;          // vocab human_outcome (volunteers: not referred_with_approval)
  evidence: EvidenceItem[];
  updated_at: string;
}
export interface DocumentCheck {
  named_type: NamedType;
  availability: string;           // vocab document_availability
  /** Whether the files we matched are for this project: our matching can be wrong. */
  matches_project: 'unknown' | 'yes' | 'no';
}
export interface Reviewer {
  /** The member's id (ours; the API sets it). A name only if the volunteer gives one. */
  reviewer_id: string;
  display_name: string;
  /** Task id from the registry's role catalog (T01…T35), or "" */
  task_id: string;
}
export interface CaseReview {
  schema: typeof CASE_REVIEW_SCHEMA;
  /** Made once, by the page, and kept for life; the API keeps a member's first case id for a project. */
  case_id: string;
  kind: CaseKind;
  /** For a verification: the case it checks. */
  verifies_case_id: string | null;
  /** Set by the API: the number of the save that produced this copy (1, 2, …); null before the first save. */
  revision: number | null;
  registry: { version: string; sha256: string; mapping: string };
  project: {
    hgab_id: string;
    project_id: string;
    budget_source_version: string;
    title: string;
    office: string;
    region: string;
    amount_php: number;
    categories: CategoryKey[];
    detector_rule_ids: string[];
  };
  reviewer: Reviewer;
  case_stage: string;            // vocab case_stage
  risk_priority: string;         // vocab risk_priority (a suggestion; workflow step 7 decides)
  documents: DocumentCheck[];
  flags: FlagCheck[];
  notes: string;
  next_action: string;
  created_at: string;
  updated_at: string;
  /** Set by the API each time it accepts the review; null before the first save. */
  submitted_at: string | null;
  client: { app: string; data_built_at: string };
}

export function newCaseReview(input: {
  caseId: string;
  reviewer: Reviewer;
  project: CaseReview['project'];
  dataBuiltAt: string;
  now: string;
}): CaseReview {
  return {
    schema: CASE_REVIEW_SCHEMA,
    case_id: input.caseId,
    kind: 'review',
    verifies_case_id: null,
    revision: null,
    registry: { version: REGISTRY.source.version, sha256: REGISTRY.source.sha256, mapping: MAPPING_STATUS },
    project: input.project,
    reviewer: input.reviewer,
    case_stage: 'not_started',
    risk_priority: 'not_prioritized',
    documents: NAMED_TYPES.map((t) => ({ named_type: t, availability: 'unknown', matches_project: 'unknown' })),
    flags: [],
    notes: '',
    next_action: '',
    created_at: input.now,
    updated_at: input.now,
    submitted_at: null,
    client: { app: 'bettergov-budget/hgab-review', data_built_at: input.dataBuiltAt },
  };
}

export function emptyFlagCheck(flagId: string, detectors: string[], now: string): FlagCheck {
  return {
    flag_id: flagId, detector_rule_ids: detectors, applicability: 'not_assessed', observed_discrepancy: '',
    human_outcome: 'not_reviewed', evidence: [], updated_at: now,
  };
}
export function emptyEvidence(id: string): EvidenceItem {
  return {
    evidence_id: id, source_institution: '', document_title: '', url: '', file_link_id: null, file_sha256: null, locator: '',
    extracted_fact: '', reviewer_observation: '', applicable_at_stage: 'not_assessed', availability: 'unknown', verification_state: 'not_reviewed',
  };
}

/** Whether a check has anything a volunteer entered. */
export const flagCheckTouched = (f: FlagCheck) =>
  f.applicability !== 'not_assessed' || f.human_outcome !== 'not_reviewed' || !!f.observed_discrepancy.trim() || f.evidence.length > 0;
/** Document availability is filled in from what we detected, so it doesn't count as the volunteer's. */
export const caseTouched = (r: CaseReview) =>
  r.flags.some(flagCheckTouched) || r.documents.some((d) => d.matches_project !== 'unknown')
  || !!r.notes.trim() || !!r.next_action.trim() || r.risk_priority !== 'not_prioritized' || r.case_stage !== 'not_started';

/** The team's flag status: an AI candidate until a person looks, then under review, then an outcome. */
export function flagStatus(f: FlagCheck): 'ai_candidate' | 'under_human_review' | 'human_outcome' | 'not_started' {
  if (f.human_outcome !== 'not_reviewed' && f.human_outcome !== 'pending_technical_review') return 'human_outcome';
  if (flagCheckTouched(f)) return 'under_human_review';
  return f.detector_rule_ids.length ? 'ai_candidate' : 'not_started';
}

export interface ValidationIssue { path: string; message: string; level: 'error' | 'warning' }

/**
 * What the API will check, run in the browser first. Errors block "Ready for independent review"; a draft saves
 * anyway. The rules follow the workbook's own safeguards.
 */
export function validateCaseReview(r: CaseReview): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const err = (path: string, message: string) => out.push({ path, message, level: 'error' });
  const warn = (path: string, message: string) => out.push({ path, message, level: 'warning' });
  if (r.schema !== CASE_REVIEW_SCHEMA) err('schema', `Expected ${CASE_REVIEW_SCHEMA}.`);
  if (r.registry.sha256 !== REGISTRY.source.sha256) err('registry', 'Made with another version of the team registry.');
  if (!/^HB10858-3-\d{4}-\d{6}$/.test(r.project.hgab_id)) err('project.hgab_id', 'Not a House bill row id.');
  if (!r.case_id) err('case_id', 'Missing.');
  if (r.kind === 'verification' && !r.verifies_case_id) err('verifies_case_id', 'A verification names the case it checks.');
  if (r.kind !== 'verification' && r.verifies_case_id) err('verifies_case_id', 'Only a verification checks another case.');
  if (!r.reviewer.reviewer_id) err('reviewer.reviewer_id', 'Missing.');
  if (r.reviewer.task_id && !REGISTRY.tasks.some((t) => t.id === r.reviewer.task_id)) err('reviewer.task_id', 'Not in the role catalog.');
  if (!codes('case_stage').has(r.case_stage)) err('case_stage', 'Unknown case stage.');
  if (!codes('risk_priority').has(r.risk_priority)) err('risk_priority', 'Unknown priority.');
  r.documents.forEach((d, i) => {
    if (!(NAMED_TYPES as readonly string[]).includes(d.named_type)) err(`documents[${i}]`, 'Unknown document type.');
    if (!codes('document_availability').has(d.availability)) err(`documents[${i}].availability`, 'Unknown availability.');
  });
  const seen = new Set<string>();
  r.flags.forEach((f, i) => {
    const p = `flags[${i}] ${f.flag_id}`;
    const def = TEAM_FLAGS.get(f.flag_id);
    if (!def) { err(p, 'Not in the team registry.'); return; }
    if (seen.has(f.flag_id)) err(p, 'Listed twice.');
    seen.add(f.flag_id);
    if (!codes('evidence_applicability').has(f.applicability)) err(`${p}.applicability`, 'Unknown applicability.');
    if (!codes('human_outcome').has(f.human_outcome)) err(`${p}.human_outcome`, 'Unknown outcome.');
    if (f.human_outcome === 'referred_with_approval') err(`${p}.human_outcome`, 'Only the review committee refers a case (workflow step 8).');
    // "No red flag from missing not-yet-required approval"; "Do not penalize not-yet-due documents".
    if (['not_yet_due', 'not_applicable'].includes(f.applicability) && f.human_outcome === 'verified_concern')
      err(`${p}`, `A check marked "${vocabLabel('evidence_applicability', f.applicability)}" can’t be a verified concern.`);
    if (STAGE_GATED[f.flag_id] && f.human_outcome === 'verified_concern') err(p, STAGE_GATED[f.flag_id]);
    if (['verified_concern', 'cleared_explained'].includes(f.human_outcome) && !f.evidence.length)
      err(p, 'Add the evidence behind this outcome: document, page and what it says.');
    if (['verified_concern', 'unresolved_evidence_gap'].includes(f.human_outcome) && !f.observed_discrepancy.trim())
      err(`${p}.observed_discrepancy`, 'Say what you observed, as facts only.');
    if (f.human_outcome === 'not_reviewed' && flagCheckTouched(f)) warn(p, 'You started this check but gave no outcome.');
    f.evidence.forEach((e, j) => {
      const q = `${p}.evidence[${j}]`;
      if (!/^https?:\/\//.test(e.url) && !e.document_title.trim()) err(q, 'Name the document or give its link.');
      if (e.url && !/^https?:\/\//.test(e.url)) err(`${q}.url`, 'Links start with http:// or https://.');
      if (!codes('evidence_applicable_at_stage').has(e.applicable_at_stage)) err(`${q}.applicable_at_stage`, 'Unknown value.');
      if (!codes('document_availability').has(e.availability)) err(`${q}.availability`, 'Unknown value.');
      if (!codes('verification_state').has(e.verification_state)) err(`${q}.verification_state`, 'Unknown value.');
      if (!e.locator.trim() && e.availability === 'available') warn(`${q}.locator`, 'Give the page, table or cell.');
    });
  });
  if ((r.case_stage === READY_STAGE || r.case_stage === 'completed') && !r.flags.some((f) => f.human_outcome !== 'not_reviewed'))
    err('case_stage', 'Record an outcome for at least one check before sending the case for independent review.');
  return out;
}

/**
 * The API's intake (src/worker/hgab-reviews.ts): rebuilds a `CaseReview` from a request body, keeping only the fields
 * above, with their types, vocabularies, ids and lengths checked. Anything else is a problem and the review is
 * refused. `revision` and `submitted_at` are the API's to set. The workbook's rules (`validateCaseReview`) are
 * separate: a draft may break them, a case sent for independent review may not.
 */
export const INTAKE_LIMITS = { text: 20_000, line: 600, url: 2_000, evidence: 40, detectors: 200 } as const;
export function readCaseReview(raw: unknown): { review: CaseReview | null; problems: string[] } {
  const problems: string[] = [];
  const bad = (path: string, why: string) => { problems.push(`${path}: ${why}`); };
  const obj = (v: unknown, path: string): Record<string, unknown> => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    bad(path, 'expected an object'); return {};
  };
  const str = (v: unknown, path: string, max: number = INTAKE_LIMITS.line): string => {
    if (typeof v !== 'string') { bad(path, 'expected text'); return ''; }
    if (v.length > max) bad(path, `longer than ${max} characters`);
    return v;
  };
  const list = (v: unknown, path: string, max: number): unknown[] => {
    if (!Array.isArray(v)) { bad(path, 'expected a list'); return []; }
    if (v.length > max) bad(path, `more than ${max} items`);
    return v.slice(0, max);
  };
  const code = (v: unknown, path: string, key: VocabKey): string => {
    const c = str(v, path, 80);
    if (c && !codes(key).has(c)) bad(path, `not a ${key} code`);
    return c;
  };
  const link = (v: unknown, path: string): string => {
    const u = str(v, path, INTAKE_LIMITS.url).trim();
    if (u && !/^https?:\/\/[^\s]+$/i.test(u)) bad(path, 'links start with http:// or https://');
    return u;
  };
  const time = (v: unknown, path: string): string => {
    const t = str(v, path, 40);
    if (Number.isNaN(Date.parse(t))) bad(path, 'expected a date and time');
    return t;
  };
  const nullable = <T>(v: unknown, read: (x: unknown) => T): T | null => (v == null ? null : read(v));

  const r = obj(raw, 'review');
  if (r.schema !== CASE_REVIEW_SCHEMA) bad('schema', `expected ${CASE_REVIEW_SCHEMA}`);
  const caseId = str(r.case_id, 'case_id', 64);
  if (!CASE_ID_RE.test(caseId)) bad('case_id', 'expected 8 to 64 letters, digits, - or _');
  // Reviews saved before these fields existed are reviews of a project.
  const kind = r.kind ?? 'review';
  if (!(CASE_KINDS as readonly unknown[]).includes(kind)) bad('kind', 'expected review or verification');
  const verifies = nullable(r.verifies_case_id, (v) => str(v, 'verifies_case_id', 64));
  if (verifies != null && !CASE_ID_RE.test(verifies)) bad('verifies_case_id', 'not a case id');
  const reg = obj(r.registry, 'registry'), proj = obj(r.project, 'project'), who = obj(r.reviewer, 'reviewer'), client = obj(r.client, 'client');
  const hgabId = str(proj.hgab_id, 'project.hgab_id', 40);
  if (!/^HB10858-3-\d{4}-\d{6}$/.test(hgabId)) bad('project.hgab_id', 'not a House bill row id');
  const amount = proj.amount_php;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) bad('project.amount_php', 'expected pesos');
  const categories = list(proj.categories, 'project.categories', Object.keys(CATEGORY).length).map((c, i) => {
    if (typeof c !== 'string' || !(c in CATEGORY)) bad(`project.categories[${i}]`, 'not a project type');
    return c as CategoryKey;
  });
  const detectorIds = (v: unknown, path: string) => list(v, path, INTAKE_LIMITS.detectors).map((c, i) => str(c, `${path}[${i}]`, 200));
  const taskId = str(who.task_id, 'reviewer.task_id', 20);
  if (taskId && !REGISTRY.tasks.some((t) => t.id === taskId)) bad('reviewer.task_id', 'not in the role catalog');

  // Whether a check is in today's registry is one of the workbook's rules (validateCaseReview), not the intake's: a
  // draft keeps its checks when the registry changes.
  const seen = new Set<string>(), evidenceIds = new Set<string>();
  const flags = list(r.flags, 'flags', 100).map((x, i): FlagCheck => {
    const f = obj(x, `flags[${i}]`), p = `flags[${i}]`;
    const id = str(f.flag_id, `${p}.flag_id`, 20);
    if (!FLAG_ID_RE.test(id)) bad(`${p}.flag_id`, 'not a team check id (RF-000)');
    if (seen.has(id)) bad(`${p}.flag_id`, 'listed twice');
    seen.add(id);
    return {
      flag_id: id,
      detector_rule_ids: detectorIds(f.detector_rule_ids, `${p}.detector_rule_ids`),
      applicability: code(f.applicability, `${p}.applicability`, 'evidence_applicability'),
      observed_discrepancy: str(f.observed_discrepancy, `${p}.observed_discrepancy`, INTAKE_LIMITS.text),
      human_outcome: code(f.human_outcome, `${p}.human_outcome`, 'human_outcome'),
      evidence: list(f.evidence, `${p}.evidence`, INTAKE_LIMITS.evidence).map((y, j): EvidenceItem => {
        const e = obj(y, `${p}.evidence[${j}]`), q = `${p}.evidence[${j}]`;
        const fileId = e.file_link_id;
        if (fileId != null && !Number.isInteger(fileId)) bad(`${q}.file_link_id`, 'expected a whole number');
        const evidenceId = str(e.evidence_id, `${q}.evidence_id`, 64);
        if (!EVIDENCE_ID_RE.test(evidenceId)) bad(`${q}.evidence_id`, 'expected 1 to 64 letters, digits, - or _');
        if (evidenceIds.has(evidenceId)) bad(`${q}.evidence_id`, 'used twice in this case');
        evidenceIds.add(evidenceId);
        return {
          evidence_id: evidenceId,
          source_institution: str(e.source_institution, `${q}.source_institution`),
          document_title: str(e.document_title, `${q}.document_title`),
          url: link(e.url, `${q}.url`),
          file_link_id: fileId == null ? null : (fileId as number),
          file_sha256: nullable(e.file_sha256, (v) => str(v, `${q}.file_sha256`, 64)),
          locator: str(e.locator, `${q}.locator`),
          extracted_fact: str(e.extracted_fact, `${q}.extracted_fact`, INTAKE_LIMITS.text),
          reviewer_observation: str(e.reviewer_observation, `${q}.reviewer_observation`, INTAKE_LIMITS.text),
          applicable_at_stage: code(e.applicable_at_stage, `${q}.applicable_at_stage`, 'evidence_applicable_at_stage'),
          availability: code(e.availability, `${q}.availability`, 'document_availability'),
          verification_state: code(e.verification_state, `${q}.verification_state`, 'verification_state'),
        };
      }),
      updated_at: time(f.updated_at, `${p}.updated_at`),
    };
  });
  const documents = list(r.documents, 'documents', NAMED_TYPES.length).map((x, i): DocumentCheck => {
    const d = obj(x, `documents[${i}]`);
    const t = str(d.named_type, `documents[${i}].named_type`, 40);
    if (!(NAMED_TYPES as readonly string[]).includes(t)) bad(`documents[${i}].named_type`, 'not one of the 5 key documents');
    const m = d.matches_project;
    if (m !== 'unknown' && m !== 'yes' && m !== 'no') bad(`documents[${i}].matches_project`, 'expected unknown, yes or no');
    return { named_type: t as NamedType, availability: code(d.availability, `documents[${i}].availability`, 'document_availability'), matches_project: m as DocumentCheck['matches_project'] };
  });

  const review: CaseReview = {
    schema: CASE_REVIEW_SCHEMA,
    case_id: caseId,
    kind: kind as CaseKind,
    verifies_case_id: verifies,
    revision: null,
    registry: { version: str(reg.version, 'registry.version', 80), sha256: str(reg.sha256, 'registry.sha256', 64), mapping: str(reg.mapping, 'registry.mapping') },
    project: {
      hgab_id: hgabId,
      project_id: str(proj.project_id, 'project.project_id', 80),
      budget_source_version: str(proj.budget_source_version, 'project.budget_source_version'),
      title: str(proj.title, 'project.title', INTAKE_LIMITS.text),
      office: str(proj.office, 'project.office'),
      region: str(proj.region, 'project.region'),
      amount_php: typeof amount === 'number' ? amount : 0,
      categories,
      detector_rule_ids: detectorIds(proj.detector_rule_ids, 'project.detector_rule_ids'),
    },
    reviewer: { reviewer_id: str(who.reviewer_id, 'reviewer.reviewer_id', 80), display_name: str(who.display_name, 'reviewer.display_name', 120).trim(), task_id: taskId },
    case_stage: code(r.case_stage, 'case_stage', 'case_stage'),
    risk_priority: code(r.risk_priority, 'risk_priority', 'risk_priority'),
    documents,
    flags,
    notes: str(r.notes, 'notes', INTAKE_LIMITS.text),
    next_action: str(r.next_action, 'next_action', INTAKE_LIMITS.line),
    created_at: time(r.created_at, 'created_at'),
    updated_at: time(r.updated_at, 'updated_at'),
    submitted_at: null,
    client: { app: str(client.app, 'client.app', 80), data_built_at: str(client.data_built_at, 'client.data_built_at', 40) },
  };
  return problems.length ? { review: null, problems: problems.slice(0, 50) } : { review, problems };
}

// --- The team's workbook rows -------------------------------------------------------------------------------------

/** Our own flags: missing documents (with our matching) and our NEP comparison; the rest are research.bettergov.ph's. */
export const isOurDetector = (code: string) => code.startsWith('missing-') || code === OUR_NEP_FLAGS.houseOnly.code || code === OUR_NEP_FLAGS.disagree.code;
function screeningSource(codes: readonly string[]): string {
  const ours = codes.filter(isOurDetector), theirs = codes.filter((c) => !isOurDetector(c));
  return [
    theirs.length ? `research.bettergov.ph flags: ${theirs.join(', ')}` : '',
    ours.length ? `BetterGov (our matching and NEP comparison): ${ours.join(', ')}` : '',
  ].filter(Boolean).join('; ') || 'Volunteer review';
}

/** One CASE INTAKE & TRACKER row per check a volunteer worked on, in the workbook's column order. */
export function caseIntakeRows(r: CaseReview): string[][] {
  const head = REGISTRY.case_columns;
  return r.flags.filter(flagCheckTouched).map((f) => {
    const def = TEAM_FLAGS.get(f.flag_id);
    const v: Record<string, string> = {
      'Case ID': `${r.case_id}/${f.flag_id}`,
      'Project / proposal ID': `${r.project.hgab_id} (${r.project.project_id})`,
      'Budget source version': r.project.budget_source_version,
      'Flag ID': f.flag_id,
      'Flag description (lookup)': def?.title ?? '',
      'Lead skill (lookup)': def?.lead_skill ?? '',
      'Project name / location': `${r.project.title} · ${r.project.office} · ${r.project.region}`,
      'Initial screening source': screeningSource(f.detector_rule_ids),
      'Evidence page / cell / URL': f.evidence.map((e) => [e.url || e.document_title, e.locator].filter(Boolean).join(' · ')).join('\n'),
      'Observed discrepancy (facts only)': f.observed_discrepancy,
      'Case stage': vocabLabel('case_stage', r.case_stage),
      'Assigned volunteer': r.reviewer.display_name || r.reviewer.reviewer_id,
      'Independent verifier': '',
      'Evidence applicability': vocabLabel('evidence_applicability', f.applicability),
      'Budget-origin assessment': '',
      'Readiness/value assessment': '',
      'Risk priority': vocabLabel('risk_priority', r.risk_priority),
      'Due date': '',
      'Last update (date)': f.updated_at.slice(0, 10),
      'Human outcome': vocabLabel('human_outcome', f.human_outcome),
      'Disposition approval / authority': '',
      'Notes / next action': [r.next_action, r.notes].filter((x) => x.trim()).join('\n'),
    };
    return head.map((h) => v[h] ?? '');
  });
}

/** One CASE EVIDENCE TEMPLATE row per piece of evidence, in the workbook's column order. */
export function caseEvidenceRows(r: CaseReview): string[][] {
  const head = REGISTRY.evidence_columns;
  return r.flags.flatMap((f) => f.evidence.map((e) => {
    const v: Record<string, string> = {
      'Case ID': `${r.case_id}/${f.flag_id}`,
      'Flag ID': f.flag_id,
      'Source institution': e.source_institution,
      'Official document title + version': e.document_title,
      'Document URL or local path': e.url,
      'Page / table / cell': e.locator,
      'Extracted fact (verbatim / amount)': e.extracted_fact,
      'Reviewer observation': e.reviewer_observation,
      'Applicable at current project stage?': vocabLabel('evidence_applicable_at_stage', e.applicable_at_stage),
      'Document availability': vocabLabel('document_availability', e.availability),
      'Human verifier': '',
      'Check date': f.updated_at.slice(0, 10),
      'Verification state': vocabLabel('verification_state', e.verification_state),
      'Notes / explanation': e.file_sha256 ? `SHA-256 ${e.file_sha256}` : '',
    };
    return head.map((h) => v[h] ?? '');
  }));
}

/** CSV with a header row, UTF-8 with BOM, for spreadsheets. */
export function toCsv(head: readonly string[], rows: readonly string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `\uFEFF${[head, ...rows].map((r) => r.map(cell).join(',')).join('\n')}\n`;
}

// --- Browser storage, retired -------------------------------------------------------------------------------------

/**
 * Keys earlier versions of the reviewer kept reviews under in the browser: first-version reviews, cases and the
 * volunteer's profile. Reviewing now needs a sign-in and reviews live only on the server; the page removes these.
 */
export const RETIRED_STORES = ['hgab-review:v1', 'hgab-review:v2', 'hgab-review:reviewer'] as const;
