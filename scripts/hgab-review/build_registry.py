"""Extract the volunteer red-flag registry from the team's crosswalk workbook into src/lib/hgab-redflag-registry.json.

The workbook (Red_Flag_Volunteer_Crosswalk_Ready_for_Team.xlsx, "Volunteer-ready draft v2 — 12 November 2026") holds
the team's 44 red flags (RF-001…RF-044) with their proposed volunteer routing, 24 unmerged draft indicators with a
crosswalk, 35 role tasks (T01…T35), the nine-step workflow, and the dropdown vocabularies of its case and evidence
templates. Text is carried verbatim (stripped); nothing is re-worded here. Encoder names are left out (the workbook asks that personal details stay with authorized reviewers). Fails unless the counts match the
workbook's own START HERE sheet and every vocabulary is found.

A second workbook, the team's "44-to-16 consolidation proposal" (BudgetWatch_Red_Flags_44_to_16_Consolidation_Proposal.xlsx,
"FOR REVIEW — NOT APPROVED"), groups the 44 flags into 16 questions (BW-01…BW-16): the questions the review form asks. It
must name every flag exactly once, with the same titles, categories and lead specialists as the crosswalk.

    npm run build:hgab-redflag-registry -- [path/to/crosswalk.xlsx] [path/to/consolidation.xlsx]
"""
import hashlib, json, re, sys
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data/hgab/2027/review-registry/red-flag-volunteer-crosswalk-v2.xlsx"
GROUPS = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "data/hgab/2027/review-registry/red-flag-44-to-16-consolidation-proposal.xlsx"
OUT = ROOT / "src/lib/hgab-redflag-registry.json"


def fail(msg):
    sys.exit(f"build_registry: {msg}")


def text(v):
    if v is None:
        return None
    s = str(v).replace("\r\n", "\n").strip()
    return s or None


def table(ws):
    rows = [r for r in ws.iter_rows(values_only=True) if any(c is not None for c in r)]
    head = [text(h) for h in rows[0]]
    return [{h: text(c) for h, c in zip(head, r) if h} for r in rows[1:]]


def ids(v):
    return [x.strip() for x in re.split(r"[;,]", v or "") if x.strip()]


def vocab(ws, col):
    for dv in ws.data_validations.dataValidation:
        if any(col in str(rng) for rng in str(dv.sqref).split()) and dv.type == "list":
            return [x.strip() for x in dv.formula1.strip('"').split(",")]
    fail(f"no dropdown list for {ws.title} column {col}")


def questions(flags):
    """The 16 questions of the consolidation proposal, each with the flags it groups, checked against the crosswalk."""
    if not GROUPS.exists():
        fail(f"{GROUPS} not found")
    wb = openpyxl.load_workbook(GROUPS, data_only=True)
    summary = {text(r[0]): r[1] for r in wb["Executive Summary"].iter_rows(values_only=True) if r[0]}
    out = [{
        "id": r["New ID"], "title": r["Consolidated screening question"], "family": r["Screening family"],
        "flag_ids": ids(r["Original codes"]), "checks": r["What volunteer/expert checks"], "lead": r["Lead specialist(s)"],
        "route": r["Form automation route"], "note": r["Non-loss / implementation note"],
    } for r in table(wb["Proposed 16 Groups"])]
    mapping = {r["Original ID"]: r for r in table(wb["44-to-16 Mapping"])}
    by_id = {f["id"]: f for f in flags}
    named = [x for q in out for x in q["flag_ids"]]
    if len(out) != int(summary["Proposed screening groups"]):
        fail(f"{len(out)} questions, the summary says {summary['Proposed screening groups']}")
    if [q["id"] for q in out] != [f"BW-{i:02d}" for i in range(1, len(out) + 1)]:
        fail("question ids are not BW-01… in order")
    if sorted(named) != sorted(by_id) or len(named) != len(set(named)):
        fail("the questions don't name every flag exactly once")
    for k, m in mapping.items():
        f, q = by_id.get(k), next((q for q in out if k in q["flag_ids"]), None)
        if not f or not q or m["Proposed group ID"] != q["id"]:
            fail(f"{k}: the mapping sheet and the groups sheet disagree")
        if (m["Original title (verbatim)"], m["Original category"], m["Original specialist"]) != (f["title"], f["category"], f["lead_skill"]):
            fail(f"{k}: title, category or specialist differs from the crosswalk")
    if len(mapping) != len(by_id):
        fail(f"the mapping sheet has {len(mapping)} flags, the crosswalk {len(by_id)}")
    source = {"file": GROUPS.name, "sha256": hashlib.sha256(GROUPS.read_bytes()).hexdigest(),
              "status": text(summary.get("Proposal status")), "note": "The team's proposal to ask 16 questions instead of 44 checks."}
    return out, source


def main():
    if not SRC.exists():
        fail(f"{SRC} not found")
    wb = openpyxl.load_workbook(SRC, data_only=True)
    start = {r[0]: r[1] for r in wb["START HERE"].iter_rows(values_only=True) if r[0]}
    version = {r[0]: r[1] for r in wb["TEAM DASHBOARD"].iter_rows(values_only=True) if r[0]}.get("Workbook version")

    original = {int(r["Original Excel row"]): r for r in table(wb["ORIGINAL REGISTRY"])}
    flags = []
    for r in table(wb["RED FLAG TO ROLE MAP"]):
        cont = r.get("Continuation row")
        continuation = text(original[int(float(cont))].get("What to Investigate / to look for?")) if cont else None
        # A few titles carry the team's working notes after the first line (RF-030): the first line is the title.
        title, _, more = r["Original red flag"].partition("\n")
        if more.strip():
            continuation = "\n".join(x for x in [more.strip(), continuation] if x)
        flags.append({
            "id": r["Flag ID"],
            "source_row": int(float(r["Source row"])),
            "category": r["Group category"],
            "title": title.strip(),
            "investigate": r["Original investigation text"],
            "continuation": continuation,
            "steps": [int(x) for x in ids(r["Workflow steps"])],
            "lead_task": r["Lead task ID"],
            "lead_skill": r["Proposed lead specialist"],
            "support_tasks": ids(r.get("Support task IDs")),
            "support_skills": ids(r.get("Proposed supporting specialists")),
            "instructions": r["Granular investigation instructions"],
            "minimum_evidence": ids(r["Minimum evidence"]),
            "automation": r.get("Automation opportunity"),
            "safeguard": r["Critical safeguard / applicability"],
            "related": r.get("Related entries / notes"),
            "status": r["Mapping status"],
        })
    crosswalk = {r["Draft code"]: r for r in table(wb["DRAFT CROSSWALK"])}
    drafts = [{
        "code": r["Code"], "category": r["Category"], "indicator": r["Red-flag indicator"], "verification": r["Required verification"],
        "linked_flags": re.findall(r"RF-\d{3}", crosswalk[r["Code"]]["Proposed main flag linkage"]),
        "linkage": crosswalk[r["Code"]]["Proposed main flag linkage"], "status": crosswalk[r["Code"]]["Status / caution"],
    } for r in table(wb["DRAFT - UNMERGED"])]
    tasks = [{
        "id": r["Task ID"], "step": int(float(r["Step"])), "role": r["Role / skill"], "checks": r["Exact checks / actions"],
        "sources": r["Required source materials"], "deliverable": r["Deliverable / output"], "qa": r["Acceptance / QA rule"],
        "handoff": r["Review / handoff"], "recruitment": r.get("Recruitment"),
    } for r in table(wb["ROLE TASK CATALOG"])]
    workflow = [{
        "step": int(float(r["Step"])), "stage": r["Stage"], "purpose": r["Purpose"], "roles": r["Recommended roles"],
        "handoff": r["Expected handoff"], "safeguard": r["Safeguard"],
    } for r in table(wb["9 STEP WORKFLOW"])]
    case_head = [text(h) for h in next(wb["CASE INTAKE & TRACKER"].iter_rows(values_only=True))]
    evidence_head = [text(h) for h in next(wb["CASE EVIDENCE TEMPLATE"].iter_rows(values_only=True))]
    vocabularies = {
        "case_stage": vocab(wb["CASE INTAKE & TRACKER"], "K"),
        "evidence_applicability": vocab(wb["CASE INTAKE & TRACKER"], "N"),
        "risk_priority": vocab(wb["CASE INTAKE & TRACKER"], "Q"),
        "human_outcome": vocab(wb["CASE INTAKE & TRACKER"], "T"),
        "evidence_applicable_at_stage": vocab(wb["CASE EVIDENCE TEMPLATE"], "I"),
        "document_availability": vocab(wb["CASE EVIDENCE TEMPLATE"], "J"),
        "verification_state": vocab(wb["CASE EVIDENCE TEMPLATE"], "M"),
        "routing_status": vocab(wb["LIVE FLAG ROUTING"], "N"),
        "group_approval": vocab(wb["LIVE FLAG ROUTING"], "T"),
    }
    integration = table(wb["AI INTEGRATION SPEC DRAFT"])

    if len(flags) != int(start["Main entries"]):
        fail(f"{len(flags)} flags, START HERE says {start['Main entries']}")
    if len(drafts) != int(start["Draft indicators"]):
        fail(f"{len(drafts)} drafts, START HERE says {start['Draft indicators']}")
    if len(tasks) != 35 or len(workflow) != 9:
        fail(f"{len(tasks)} tasks / {len(workflow)} workflow steps (want 35 / 9)")
    task_ids = {t["id"] for t in tasks}
    flag_ids = [f["id"] for f in flags]
    if flag_ids != [f"RF-{i:03d}" for i in range(1, len(flags) + 1)]:
        fail("flag ids are not RF-001… in order")
    for f in flags:
        bad = [t for t in [f["lead_task"], *f["support_tasks"]] if t not in task_ids]
        if bad:
            fail(f"{f['id']} names unknown tasks {bad}")
    for d in drafts:
        if any(x not in flag_ids for x in d["linked_flags"]):
            fail(f"draft {d['code']} links an unknown flag")

    qs, qs_source = questions(flags)
    data = SRC.read_bytes()
    out = {
        "schema": 1,
        "source": {"file": SRC.name, "sha256": hashlib.sha256(data).hexdigest(), "version": version,
                   "note": "The team's proposal; role assignments and the registry are pending group review."},
        "questions_source": qs_source, "questions": qs,
        "flags": flags, "drafts": drafts, "tasks": tasks, "workflow": workflow,
        "case_columns": case_head, "evidence_columns": evidence_head, "vocabularies": vocabularies, "integration_spec": integration,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(flags)} flags in {len(qs)} questions, {len(drafts)} drafts, {len(tasks)} tasks, {len(workflow)} steps; "
          f"sources {out['source']['sha256'][:12]}, {qs_source['sha256'][:12]}")


main()
