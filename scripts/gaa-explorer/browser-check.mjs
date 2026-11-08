// Run against an already-started preview. No production writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { acceptTerms } from '../lib/accept-terms.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright-core'
);
const base = process.env.GAA_EXPLORER_URL;
if (!base) throw new Error('Set GAA_EXPLORER_URL to the preview origin');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await acceptTerms(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir('data/gaa-explorer-checks', { recursive: true });
const go = (path) => page.goto(new URL(path, base).href);
const ready = () =>
  page
    .getByRole('status')
    .filter({ hasText: /matching records/ })
    .waitFor({ timeout: 90000 });
try {
  await go('/gaa');
  await page.locator('.gaa-year-card').last().waitFor();
  assert.equal(await page.locator('.gaa-year-card').count(), 27);
  await page.screenshot({
    path: 'data/gaa-explorer-checks/overview-desktop.png',
  });
  const manifest = await (
    await page.request.get(
      new URL('/data/gaa-explorer/manifest.json', base).href,
    )
  ).json();
  for (const y of manifest.years) {
    await go(`/gaa/${y.year}/records`);
    await page.locator('.gaa-coverage').waitFor();
    assert.match(
      await page.locator('h1').innerText(),
      new RegExp(String(y.year)),
    );
    if (y.source_year) {
      assert.match(
        await page.locator('.gaa-coverage').innerText(),
        /does not mean zero/,
      );
      assert.equal(await page.locator('.kpi-strip').count(), 0);
    } else {
      const selected = await page
        .getByRole('combobox', { name: 'Appropriation scope' })
        .inputValue();
      const expected = y.scopes.find((s) => s.id === selected);
      assert.match(
        await page.locator('.kpi-strip').innerText(),
        new RegExp(expected.amount.toLocaleString('en-US')),
      );
    }
    const response = await page.request.get(
      new URL(`/data/gaa-explorer/${y.file}`, base).href,
      { headers: { Range: 'bytes=0-3' } },
    );
    assert.equal(response.status(), 206);
    assert.equal((await response.body()).toString(), 'PAR1');
  }
  console.log(
    'PASS: all 27 year pages, coverage states, scope totals and Parquet range downloads',
  );
  await go('/gaa/2003/records');
  await page
    .getByRole('combobox', { name: 'Appropriation scope' })
    .selectOption('current_new_appropriations_second_preference');
  await page.locator('.kpi-strip').filter({ hasText: '35,956,219,000' }).waitFor();
  await go('/gaa/2000?view=records');
  await ready();
  assert.match(await page.getByRole('status').innerText(), /1,412 matching/);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /page 2 of/ }).waitFor({ timeout: 90000 });
  assert.match(page.url(), /page=2/);
  await page.goBack();
  await ready();
  assert.match(await page.getByRole('status').innerText(), /page 1 of/);
  await page.getByRole('searchbox').fill("%' OR 1=1 --");
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /No matching/ }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await ready();
  await page.locator('summary').first().click();
  assert.equal(
    await page.getByRole('link', { name: 'Open DBM source ↗' }).count(),
    1,
  );
  await page
    .getByRole('combobox', { name: 'Appropriation scope' })
    .selectOption('unprogrammed_appropriations');
  await page.locator('.kpi-strip').filter({ hasText: '48,681,831,000' }).waitFor();
  await go('/gaa/2019?scope=current_new_appropriations&view=records');
  await ready();
  assert.match(
    await page.locator('.gaa-coverage').innerText(),
    /Published editions differ/,
  );
  await page.locator('summary').first().click();
  assert.match(
    await page.locator('details').first().innerText(),
    /source page/,
  );
  await go('/gaa/2026/records?view=records');
  await ready();
  assert.match(await page.getByRole('status').innerText(), /556,865 matching/);
  await page
    .getByRole('combobox', { name: 'Fiscal year', exact: true })
    .selectOption('2001');
  await page.waitForURL('**/gaa/2001/records');
  await page.locator('.gaa-coverage').waitFor();
  console.log(
    'PASS: scopes, source details, search, pagination, browser back and year reset',
  );
  await go('/gaa/2026/01');
  await page
    .getByText('Senate', { exact: true })
    .first()
    .waitFor({ timeout: 30000 });
  await page.getByText('Senate', { exact: true }).first().click();
  await page.waitForURL('**/gaa/2026/01/*');
  await page.locator('.hier-table tbody .name').first().waitFor();
  assert.match(page.url(), /\/gaa\/2026\/01\//);
  console.log('PASS: existing 2026 department and agency hierarchy');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/gaa', '/gaa/2000', '/gaa/2001']) {
    await go(path);
    await page
      .locator(path === '/gaa' ? '.gaa-year-card' : '.gaa-coverage')
      .first()
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      `Horizontal overflow: ${path}`,
    );
    await page.screenshot({
      path: `data/gaa-explorer-checks/${path.replaceAll('/', '-')}-mobile.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: mobile layouts and no uncaught browser errors');
} finally {
  await browser.close();
}
