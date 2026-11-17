/**
 * npm run test:hgab-review — the short addresses (src/lib/short-links.ts): /review and friends redirect to the project
 * reviewer, keeping the query, and nothing else is caught.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { REVIEW_ROOT } from "../src/lib/hgab-review";
import { REVIEW_SHORT_PATH, shortLinkTarget } from "../src/lib/short-links";

test("short addresses go to the project reviewer, query kept", () => {
  assert.equal(REVIEW_SHORT_PATH, "/review");
  assert.equal(REVIEW_ROOT, "/hgab/2027/review");
  for (const p of ["/review", "/review/", "/Review", "/REVIEW//", "/reviewer"]) assert.equal(shortLinkTarget(p), REVIEW_ROOT, p);
  assert.equal(shortLinkTarget("/review", "?s=mine:yes&sort=status"), `${REVIEW_ROOT}?s=mine:yes&sort=status`);
});

test("a project in the short address opens on it", () => {
  assert.equal(shortLinkTarget("/review/HB10858-3-0294-003421"), `${REVIEW_ROOT}?p=HB10858-3-0294-003421`);
  assert.equal(shortLinkTarget("/review/house-reading:8501"), `${REVIEW_ROOT}?p=house-reading:8501`);
  assert.equal(shortLinkTarget("/review/house-reading%3A8501/"), `${REVIEW_ROOT}?p=house-reading:8501`);
  assert.equal(shortLinkTarget("/review/HB10858-3-0294-003421", "?p=other&sort=status"), `${REVIEW_ROOT}?p=HB10858-3-0294-003421&sort=status`);
  assert.equal(shortLinkTarget("/review/<script>"), null);
  assert.equal(shortLinkTarget("/review/%E0%A4%A"), null, "bad escapes are not an address");
  assert.equal(shortLinkTarget("/review/a/b"), null);
});

test("nothing else is a short address", () => {
  for (const p of ["/", "/hgab/2027/review", "/reviews", "/api/hgab/2027/reviews", "/review-house", "/hgab/2027/1T-redflags"]) assert.equal(shortLinkTarget(p), null, p);
});
