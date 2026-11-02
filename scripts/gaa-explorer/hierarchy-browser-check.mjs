import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.GAA_EXPLORER_URL;
if (!base) throw new Error('Set GAA_EXPLORER_URL');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const go = path => page.goto(new URL(path, base).href);
const ready = () => page.locator('.drill-table .gaa-row-link').first().waitFor({ timeout: 90000 });
const settled = () => page.waitForFunction(() => {
  const path = JSON.parse(new URLSearchParams(location.search).get('branch') || '[]');
  return document.querySelectorAll('.crumbs a').length === path.length + 1 &&
    !document.querySelector('.crumbs .current')?.textContent.includes('Loading') &&
    (document.querySelector('.drill-table .gaa-row-link') || document.querySelector('.gaa-record-table'));
}, undefined, { timeout: 90000 });
await mkdir('data/gaa-explorer-checks', { recursive: true });
try {
  await go('/gaa');
  await page.locator('.gaa-year-card').last().waitFor();
  assert.deepEqual(await page.locator('.gaa-year-card strong').allTextContents(), Array.from({ length: 27 }, (_, i) => String(2026-i)));
  for (const year of [2026, 2019, 2014, 2000]) {
    await go(`/gaa/${year}`); await ready();
    assert.match(await page.locator('h1').innerText(), new RegExp(`FY ${year} General Appropriations`));
    const options = await page.getByRole('combobox', { name: 'Fiscal year', exact: true }).locator('option').evaluateAll(es => es.map(e => e.value));
    assert.deepEqual(options, Array.from({ length: 27 }, (_, i) => String(2026-i)));
    const years = await page.locator('[aria-label="Nearby fiscal years"] .year-cell-num').allTextContents();
    assert.deepEqual(years, years.toSorted((a,b) => b.localeCompare(a)));
    assert.equal(await page.locator('.kpi-cell').count(), 4);
    assert.equal(await page.locator('.crumbs').count(), 1);
    await page.screenshot({ path: `data/gaa-explorer-checks/hierarchy-${year}.png`, fullPage: false });
  }
  console.log('PASS: shared Explorer chrome and newest-first year controls');
  for (const year of [2000, 2014, 2019]) {
    await go(`/gaa/${year}`); await ready();
    // Use an actual published group, then follow a complete branch to its source records.
    await page.getByRole('button', { name: /CONGRESS OF THE PHILIPPINES/i }).click();
    await page.waitForURL(url => url.searchParams.has('branch'));
    await settled(); await ready();
    assert.match(await page.locator('.crumbs .current').innerText(), /Bureaus/i);
    const bureauUrl = page.url();
    let depth = 0;
    while (await page.locator('.drill-table .gaa-row-link').count()) {
      const before = page.url();
      await page.locator('.drill-table .gaa-row-link').first().click();
      await page.waitForURL(url => url.href !== before);
      await settled();
      assert.ok(++depth <= 7);
      if (await page.locator('.gaa-record-table').count()) break;
    }
    await page.getByRole('status').filter({ hasText: /matching records/ }).waitFor({ timeout: 90000 });
    await page.locator('summary').last().waitFor();
    const leafUrl = page.url();
    await page.reload();
    await page.getByRole('status').filter({ hasText: /matching records/ }).waitFor({ timeout: 90000 });
    assert.equal(page.url(), leafUrl);
    await page.locator('.crumbs a').nth(1).click(); await settled(); await ready();
    assert.equal(page.url(), bureauUrl);
    await page.goBack();
    await page.getByRole('status').filter({ hasText: /matching records/ }).waitFor({ timeout: 90000 });
  }
  console.log('PASS: historical group → bureau → available levels → source records, cold links and back navigation');
  await go('/gaa/2003'); await ready();
  await page.getByRole('combobox', { name: 'Appropriation scope' }).selectOption('current_new_appropriations_second_preference');
  await page.waitForURL(/second_preference/); await ready();
  await page.locator('.kpi-strip').filter({ hasText: /second preference/ }).waitFor();
  for (const year of [2001, 2004, 2006]) {
    await go(`/gaa/${year}`); await page.locator('.gaa-coverage').waitFor();
    assert.match(await page.locator('.gaa-coverage').innerText(), /does not mean zero/);
    assert.equal(await page.locator('.kpi-strip').count(), 0);
  }
  await go('/gaa/2000?branch=invalid'); await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /invalid/);
  await go('/gaa/2026/01'); await ready();
  await page.getByRole('button', { name: 'Senate', exact: true }).click();
  await page.waitForURL('**/gaa/2026/01/*'); await ready();
  await page.getByRole('combobox', { name: 'Fiscal year', exact: true }).selectOption('2000');
  await page.waitForURL('**/gaa/2000'); await ready();
  console.log('PASS: scopes, reenacted years, invalid paths and preserved modern hierarchy');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const year of [2026, 2000, 2001]) {
    await go(`/gaa/${year}`);
    if (year === 2001) await page.locator('.gaa-coverage').waitFor(); else await ready();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow ${year}`);
    await page.screenshot({ path: `data/gaa-explorer-checks/hierarchy-${year}-mobile.png`, fullPage: true });
  }
  await go('/gaa/2000'); await ready();
  await page.getByRole('button', { name: /CONGRESS OF THE PHILIPPINES/i }).click();
  await settled();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Drilled mobile overflow');
  assert.deepEqual(errors, []);
  console.log('PASS: mobile layout and no uncaught browser errors');
} finally { await browser.close(); }
