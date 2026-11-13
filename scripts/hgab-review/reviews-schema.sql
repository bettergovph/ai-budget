-- Reviews sent from the project reviewer (/hgab/2027/review) by signed-in members, and the automatic reviews (review_auto,
-- at the end). Read and written by src/worker/hgab-reviews.ts and scripts/hgab-review/sync-auto-reviews.ts;
-- docs/hgab-review-form.md ("Sending reviews", "Automatic review").
--
-- These tables hold volunteers' work: never drop, rebuild or reload them. They are named review_*, outside the hgab_*
-- tables that build:hgab-d1 drops and reloads (verify:hgab expects exactly its 12 hgab_* tables).
--
-- Ids are preserved: never rewritten, reused or deleted.
--   - A case keeps its case_id for life. A withdrawn case is kept, and comes back under the same id when its member
--     sends it again. Its project, member and kind never change.
--   - Every accepted save and withdrawal is a numbered revision, append-only.
--   - A member keeps their member_id (ours) across sign-in accounts: a new account with the same verified email (a
--     new Clerk instance, say) is linked to the same member.
-- Triggers enforce this. Erasing data (a member's request under the Data Privacy Act, or spam) means dropping a
-- trigger on purpose, deleting, and recreating the trigger from this file.
--
-- Additive and safe to run again (IF NOT EXISTS).
--   local:      npm run db:hgab-reviews
--   production: npx wrangler d1 execute budget --remote --file=scripts/hgab-review/reviews-schema.sql   (ask first)

-- A member, under our own id: the reviews' reviewer_id.
CREATE TABLE IF NOT EXISTS review_members (
  member_id     TEXT PRIMARY KEY,           -- UUID
  email         TEXT NOT NULL UNIQUE,       -- verified primary email, lower case (private: no route returns it)
  display_name  TEXT NOT NULL DEFAULT '',   -- the name or handle they last gave on a review
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

-- Every sign-in account a member has used: the session token's issuer (the Clerk instance) and subject (its user id).
CREATE TABLE IF NOT EXISTS review_member_logins (
  issuer        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  member_id     TEXT NOT NULL REFERENCES review_members (member_id),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  PRIMARY KEY (issuer, subject)
);

-- A case: a member's review of a project (kind 'review'), or, later, a check of another member's case (kind
-- 'verification', linked by verifies_case_id; not open yet). One per member, project and kind, which the member keeps
-- editing; any number of members per project. `payload` is the CaseReview (src/lib/hgab-redflags-team.ts) as last
-- accepted, and `rev` the number of its last revision. Its checks are json_each(payload, '$.flags').
CREATE TABLE IF NOT EXISTS review_cases (
  case_id           TEXT PRIMARY KEY,
  hgab_id           TEXT NOT NULL,
  member_id         TEXT NOT NULL REFERENCES review_members (member_id),
  kind              TEXT NOT NULL CHECK (kind IN ('review', 'verification')),
  verifies_case_id  TEXT REFERENCES review_cases (case_id),
  status            TEXT NOT NULL,          -- REVIEW_STATUSES (src/lib/hgab-review.ts), from case_stage
  case_stage        TEXT NOT NULL,
  risk_priority     TEXT NOT NULL,
  outcomes          INTEGER NOT NULL,       -- checks with an outcome
  registry_sha256   TEXT NOT NULL,
  rev               INTEGER NOT NULL,
  payload           TEXT NOT NULL,
  created_at        TEXT NOT NULL,          -- first accepted
  updated_at        TEXT NOT NULL,          -- last revision
  withdrawn_at      TEXT,                   -- set when its member withdraws it; cleared when they send it again
  UNIQUE (hgab_id, member_id, kind),
  CHECK ((kind = 'verification') = (verifies_case_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS review_cases_by_member ON review_cases (member_id, updated_at);
CREATE INDEX IF NOT EXISTS review_cases_verifying ON review_cases (verifies_case_id) WHERE verifies_case_id IS NOT NULL;

-- Every accepted save and withdrawal: the case as it stood after it.
CREATE TABLE IF NOT EXISTS review_case_revisions (
  case_id     TEXT NOT NULL REFERENCES review_cases (case_id),
  rev         INTEGER NOT NULL,
  member_id   TEXT NOT NULL REFERENCES review_members (member_id),
  action      TEXT NOT NULL CHECK (action IN ('create', 'update', 'withdraw', 'restore')),
  status      TEXT NOT NULL,
  case_stage  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  saved_at    TEXT NOT NULL,
  PRIMARY KEY (case_id, rev)
);

CREATE TRIGGER IF NOT EXISTS review_cases_keep_ids BEFORE UPDATE OF case_id, hgab_id, member_id, kind, verifies_case_id, created_at ON review_cases
BEGIN
  SELECT RAISE(ABORT, 'review_cases: a case keeps its id, project, member and kind');
END;
CREATE TRIGGER IF NOT EXISTS review_cases_no_delete BEFORE DELETE ON review_cases
BEGIN
  SELECT RAISE(ABORT, 'review_cases: cases are withdrawn, not deleted');
END;
CREATE TRIGGER IF NOT EXISTS review_case_revisions_no_update BEFORE UPDATE ON review_case_revisions
BEGIN
  SELECT RAISE(ABORT, 'review_case_revisions: append-only');
END;
CREATE TRIGGER IF NOT EXISTS review_case_revisions_no_delete BEFORE DELETE ON review_case_revisions
BEGIN
  SELECT RAISE(ABORT, 'review_case_revisions: append-only');
END;
CREATE TRIGGER IF NOT EXISTS review_members_keep_id BEFORE UPDATE OF member_id ON review_members
BEGIN
  SELECT RAISE(ABORT, 'review_members: a member keeps their id');
END;
CREATE TRIGGER IF NOT EXISTS review_member_logins_keep BEFORE UPDATE OF issuer, subject, member_id ON review_member_logins
BEGIN
  SELECT RAISE(ABORT, 'review_member_logins: a login stays with its member');
END;

-- Automatic reviews: projects the data marks as red flags without a person (AUTO_REVIEW in src/lib/hgab-documents.ts;
-- today, none of the 5 key documents and no file). One row per project, kept in step with review.json `auto` by
-- scripts/hgab-review/sync-auto-reviews.ts (npm run sync:hgab-auto-reviews). Not a member's review: no member, no
-- revisions; members' reviews take over a project's status. A project that stops meeting the rules is withdrawn, not
-- deleted, and comes back under the same row if it meets them again.
CREATE TABLE IF NOT EXISTS review_auto (
  hgab_id        TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('red_flag')),
  score          INTEGER NOT NULL,
  rules          TEXT NOT NULL,             -- JSON array of AUTO_REVIEW rule codes
  method         TEXT NOT NULL,             -- AUTO_REVIEW.method, e.g. auto-1
  first_run_id   TEXT NOT NULL REFERENCES review_auto_runs (run_id),
  last_run_id    TEXT NOT NULL REFERENCES review_auto_runs (run_id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,             -- last change of status, score, rules or method
  withdrawn_at   TEXT                       -- set when the project no longer meets a rule; cleared if it does again
);
CREATE INDEX IF NOT EXISTS review_auto_live ON review_auto (hgab_id) WHERE withdrawn_at IS NULL;

-- Every sync: which review.json it read and what it changed. Append-only.
CREATE TABLE IF NOT EXISTS review_auto_runs (
  run_id          TEXT PRIMARY KEY,         -- UUID
  method          TEXT NOT NULL,
  data_built_at   TEXT NOT NULL,            -- review.json built_at
  data_md5        TEXT NOT NULL,            -- review.json MD5 (the R2 ETag)
  projects        INTEGER NOT NULL,         -- auto-reviewed after the run
  added           INTEGER NOT NULL,
  changed         INTEGER NOT NULL,
  withdrawn       INTEGER NOT NULL,
  restored        INTEGER NOT NULL,
  ran_at          TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS review_auto_no_delete BEFORE DELETE ON review_auto
BEGIN
  SELECT RAISE(ABORT, 'review_auto: rows are withdrawn, not deleted');
END;
CREATE TRIGGER IF NOT EXISTS review_auto_keep_id BEFORE UPDATE OF hgab_id, first_run_id, created_at ON review_auto
BEGIN
  SELECT RAISE(ABORT, 'review_auto: a row keeps its project and first run');
END;
CREATE TRIGGER IF NOT EXISTS review_auto_runs_no_update BEFORE UPDATE ON review_auto_runs
BEGIN
  SELECT RAISE(ABORT, 'review_auto_runs: append-only');
END;
CREATE TRIGGER IF NOT EXISTS review_auto_runs_no_delete BEFORE DELETE ON review_auto_runs
BEGIN
  SELECT RAISE(ABORT, 'review_auto_runs: append-only');
END;
