// Accept the site's terms in a Playwright page or context before any page loads, so the first-visit agreement
// (src/components/TermsGate.tsx) stays out of browser checks and screenshots. Reads the version and storage key from
// src/lib/site-legal.ts as text, so a new TERMS_VERSION needs no change here.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/lib/site-legal.ts', import.meta.url), 'utf8');
const version = src.match(/TERMS_VERSION = '([^']+)'/)?.[1];
const key = src.match(/TERMS_STORAGE_KEY = '([^']+)'/)?.[1];
if (!version || !key) throw new Error('accept-terms: TERMS_VERSION or TERMS_STORAGE_KEY not found in src/lib/site-legal.ts');

export async function acceptTerms(target) {
  await target.addInitScript(
    ([k, v]) => localStorage.setItem(k, JSON.stringify({ version: v, acceptedAt: new Date().toISOString() })),
    [key, version],
  );
}
