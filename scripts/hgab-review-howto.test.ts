/**
 * npm run test:hgab-review — "How to review a project" (src/lib/hgab-review-howto.ts): every step has its screenshot,
 * and its text reads as narration (short sentences).
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { HOWTO_STEPS, howtoShot } from "../src/lib/hgab-review-howto";

test("every step has a unique key and its screenshot (npm run build:hgab-review-howto)", () => {
  assert.equal(new Set(HOWTO_STEPS.map((s) => s.key)).size, HOWTO_STEPS.length);
  for (const s of HOWTO_STEPS) assert.ok(existsSync(join(resolve("public"), howtoShot(s.key))), `missing ${howtoShot(s.key)}`);
});

test("each sentence is one short line of narration", () => {
  for (const s of HOWTO_STEPS) {
    assert.ok(s.text.length > 0 && s.alt.length > 0, s.key);
    for (const t of s.text) {
      assert.match(t, /[.!?]$/, `${s.key}: "${t}" ends a sentence`);
      assert.ok(t.split(/\s+/).length <= 22, `${s.key}: "${t}" is too long to say in one breath`);
      assert.doesNotMatch(t, /\bHGAB\b|\bmoney\b/i, `${s.key}: copy rules`);
    }
  }
});
