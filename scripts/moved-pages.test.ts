/**
 * npm run test:moved-pages — the pages that moved to the GAA (src/lib/moved-pages.ts): each old address goes to its new
 * one, query kept, and nothing else is caught.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MOVED_PAGES, movedTarget } from "../src/lib/moved-pages";
import { HISTORY_ROOT } from "../src/lib/hgab-history";
import { FLOOD_COMPARE_ROOT, MPB_COMPARE_ROOT } from "../src/lib/mpb-compare";

test("the multi-purpose buildings and flood control pages moved to the GAA", () => {
  assert.equal(HISTORY_ROOT, "/gaa/multi-purpose");
  assert.equal(FLOOD_COMPARE_ROOT, "/gaa/flood-control");
  assert.equal(movedTarget("/hgab/2027/multi-purpose"), "/gaa/multi-purpose");
  assert.equal(movedTarget("/hgab/2027/multi-purpose/"), "/gaa/multi-purpose");
  assert.equal(movedTarget("/hgab/2027/multi-purpose/map", "?years=2025&region=VI"), "/gaa/multi-purpose/map?years=2025&region=VI");
  assert.equal(movedTarget("/hgab/2027/multi-purpose/nep-vs-house-bill"), MPB_COMPARE_ROOT);
  assert.equal(movedTarget("/hgab/2027/flood-control", "?shot=1"), "/gaa/flood-control?shot=1");
  for (const [from, to] of Object.entries(MOVED_PAGES)) {
    assert.ok(from.startsWith("/hgab/2027/") && to.startsWith("/gaa/"), `${from} → ${to}`);
  }
});

test("nothing else moved", () => {
  for (const p of ["/", "/gaa/multi-purpose", "/hgab/2027/dpwh", "/hgab/2027/multi-purpose/other", "/hgab/2027/flood-controls"]) {
    assert.equal(movedTarget(p), null, p);
  }
});
