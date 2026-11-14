/**
 * npm run test:hgab-review — Senate copies held back until their signatures are redacted
 * (src/lib/senate-copies-held-back.ts): every held-back name is a real Senate region, so a typo can't let a region's
 * files through, and their documents get no link in the page.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { SENATE_REGIONS_HELD_BACK, heldBackRegion } from "../src/lib/senate-copies-held-back";
import { documentHref, senateHeldBack, senatePath } from "../src/lib/hgab-review-api";

const detailDir = resolve("data/hgab/2027/documents/detail");

test("a held-back region's Senate copies have no link; others and DPWH Transparency files do", () => {
  const held = "https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/Region%20XII/OO1/X/2027DPWH-HGAB-1_POW.pdf";
  const shown = "https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/Region%20XIII/OO1/X/2027DPWH-HGAB-2_POW.pdf";
  const dpwh = "https://s3.infrawatch.ph/nep/fy2027/2027DPWH-Proposal-1/2027DPWH-Proposal-1_POW.pdf";
  assert.equal(senateHeldBack(held), "Region XII");
  assert.equal(documentHref(held, "grant"), null, "even with a grant");
  assert.equal(senateHeldBack(shown), null);
  assert.match(documentHref(shown, "grant")!, /^\/api\/hgab\/2027\/senate-copies\/Region%20XIII\//);
  assert.equal(documentHref(dpwh, null), dpwh);
  // The Worker gets the decoded path; the page the encoded one.
  assert.equal(heldBackRegion("Region XII/OO1/x.pdf"), "Region XII");
  assert.equal(heldBackRegion(senatePath(held)!), "Region XII");
  // Exact names: "Region X" holds back Region X only.
  assert.equal(heldBackRegion("Region XI/OO1/x.pdf"), null);
  assert.equal(heldBackRegion("Region XIII/OO1/x.pdf"), null);
});

test("every held-back name is a real Senate region", { skip: !existsSync(detailDir) && "documents/detail not built" }, () => {
  const regions = new Map<string, number>();
  for (const f of readdirSync(detailDir).filter((x) => x.endsWith(".json"))) {
    const shard = JSON.parse(readFileSync(resolve(detailDir, f), "utf8")) as Record<string, { files: string[][] }>;
    for (const d of Object.values(shard)) for (const file of d.files) {
      const path = senatePath(file[5]);
      if (path) { const r = decodeURIComponent(path.split("/")[0]); regions.set(r, (regions.get(r) ?? 0) + 1); }
    }
  }
  for (const r of SENATE_REGIONS_HELD_BACK) assert.ok((regions.get(r) ?? 0) > 0, `"${r}" matches no Senate copy (regions: ${[...regions.keys()].sort().join(", ")})`);
});
