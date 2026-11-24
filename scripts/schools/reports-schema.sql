-- Field reports on schools (/schools/:id), sent by members signed in with the project reviewer's account
-- (review_members, scripts/hgab-review/reviews-schema.sql). They hold volunteers' work: never drop, rebuild or reload
-- these tables. They are outside the `schools_*` names on purpose (build_d1.py drops and recreates those).
--
--   npx wrangler d1 execute budget --local  --file=scripts/schools/reports-schema.sql
--   npx wrangler d1 execute budget --remote --file=scripts/schools/reports-schema.sql   (go-ahead first)
--
-- One live report per member per school, kept editable; every save is an append-only revision; withdrawing sets
-- withdrawn_at and keeps the report. Nothing is deleted (triggers).

CREATE TABLE IF NOT EXISTS school_reports (
  report_id    TEXT NOT NULL PRIMARY KEY,
  school_id    TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  revision     INTEGER NOT NULL,
  shortage     TEXT,                -- 'confirmed' | 'none' | 'unsure': the headline answer, for the public tally
  classrooms_needed INTEGER,
  listing      TEXT,                -- 'open' | 'wrong_place' | 'closed' | 'not_found'
  payload      TEXT NOT NULL,       -- the whole SchoolReport, JSON
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  withdrawn_at TEXT,
  UNIQUE (school_id, member_id)
);
CREATE INDEX IF NOT EXISTS school_reports_school ON school_reports (school_id, withdrawn_at);

CREATE TABLE IF NOT EXISTS school_report_revisions (
  report_id  TEXT NOT NULL,
  revision   INTEGER NOT NULL,
  action     TEXT NOT NULL,         -- 'save' | 'withdraw'
  payload    TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (report_id, revision)
);

CREATE TRIGGER IF NOT EXISTS school_reports_no_delete BEFORE DELETE ON school_reports
BEGIN SELECT RAISE(ABORT, 'school reports are never deleted; set withdrawn_at'); END;
CREATE TRIGGER IF NOT EXISTS school_reports_keep_ids BEFORE UPDATE OF report_id, school_id, member_id, created_at ON school_reports
BEGIN SELECT RAISE(ABORT, 'a school report keeps its id, school, member and creation time'); END;
CREATE TRIGGER IF NOT EXISTS school_report_revisions_append_only BEFORE UPDATE ON school_report_revisions
BEGIN SELECT RAISE(ABORT, 'report revisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS school_report_revisions_no_delete BEFORE DELETE ON school_report_revisions
BEGIN SELECT RAISE(ABORT, 'report revisions are append-only'); END;
