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
 * The review (`CaseReview`) is shaped for an API: stable codes, the registry version its flag ids mean, provenance
 * for every piece of evidence, and the workbook's own vocabularies (labels kept for display and CSV). Until there is
 * a backend it lives in the browser and exports as JSON (the API payload) or as rows of the workbook's CASE INTAKE &
 * TRACKER and CASE EVIDENCE TEMPLATE sheets.
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
  /** A random id kept in this browser; a name only if the volunteer gives one. */
  reviewer_id: string;
  display_name: string;
  /** Task id from the registry's role catalog (T01…T35), or "" */
  task_id: string;
}
export interface CaseReview {
  schema: typeof CASE_REVIEW_SCHEMA;
  case_id: string;
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
  /** Set by the API when it accepts the review. */
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
export const caseTouched = (r: CaseReview) =>
  r.flags.some(flagCheckTouched) || r.documents.some((d) => d.availability !== 'unknown' || d.matches_project !== 'unknown')
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

// --- Reviews saved by the first version of the reviewer ----------------------------------------------------------

/** localStorage keys: first-version reviews, these reviews, and the volunteer's profile. */
export const STORE_V1 = 'hgab-review:v1';
export const STORE_CASES = 'hgab-review:v2';
export const STORE_PROFILE = 'hgab-review:reviewer';

/** A review from the reviewer's first version: one verdict per document, an overall answer and notes. */
export interface ReviewV1 {
  hgabId: string;
  projectId: string;
  title: string;
  docs: Partial<Record<NamedType, '' | 'matches' | 'other-project' | 'unreadable' | 'absent'>>;
  overall: '' | 'yes' | 'partly' | 'no';
  notes: string;
  savedAt: string;
}
const V1_DOC: Record<string, Pick<CaseReview['documents'][number], 'availability' | 'matches_project'>> = {
  matches: { availability: 'available', matches_project: 'yes' },
  'other-project': { availability: 'available', matches_project: 'no' },
  unreadable: { availability: 'available', matches_project: 'unknown' },
  absent: { availability: 'not_available', matches_project: 'unknown' },
};
const V1_OVERALL = { yes: 'yes', partly: 'partly', no: 'no' } as const;

/** Carries a first-version review into a new case: document answers move over, the rest goes into the notes. */
export function fromV1(v1: ReviewV1, base: CaseReview): CaseReview {
  const unreadable = NAMED_TYPES.filter((t) => v1.docs[t] === 'unreadable');
  const notes = [
    v1.overall ? `Earlier review: the documents support the project: ${V1_OVERALL[v1.overall]}.` : '',
    unreadable.length ? `Unreadable: ${unreadable.join(', ')}.` : '',
    v1.notes.trim(),
  ].filter(Boolean).join('\n');
  return {
    ...base,
    documents: base.documents.map((d) => ({ ...d, ...(V1_DOC[v1.docs[d.named_type] ?? ''] ?? {}) })),
    notes,
    created_at: v1.savedAt || base.created_at,
    updated_at: v1.savedAt || base.updated_at,
  };
}
