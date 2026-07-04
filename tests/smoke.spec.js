import { test, expect } from '@playwright/test';

// The regressions that have bitten this project were all "page loads but
// something silently breaks" — so the smoke test boots the real game,
// presses START, and demands (a) the music scheduler comes up and
// (b) zero uncaught errors.
test('game boots, starts, and runs clean', async ({ page }) => {
  const errors = [];
  const logs = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    logs.push(m.text());
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto('/');
  await expect(page.locator('#startBtn')).toBeVisible();
  await expect(page.locator('#pauseOverlay')).toBeHidden();

  await page.click('#startBtn');
  await expect(page.locator('#startOverlay')).toBeHidden();
  await expect(page.locator('canvas')).toBeVisible();

  // the Strudel scheduler must start (samples fetch can take a while in CI)
  await expect
    .poll(() => logs.some(l => l.includes('[cyclist] start')), { timeout: 30_000 })
    .toBe(true);

  // startup races (samples still downloading) can log transient
  // "sound not found" errors that resolve themselves — the error watch
  // starts once the engine is up. Persistent missing sounds will still
  // fire during the gameplay window below.
  await page.waitForTimeout(2000);
  errors.length = 0;

  // let the game and music actually run
  await page.waitForTimeout(4000);

  // move + fire a drill order to exercise input paths
  await page.keyboard.down('d');
  await page.waitForTimeout(600);
  await page.keyboard.up('d');
  await page.keyboard.press('q');
  await page.keyboard.press('e');
  await page.waitForTimeout(1000);

  const fatal = errors.filter(e =>
    !/favicon|AudioContext was prevented|Autoplay/i.test(e));
  expect(fatal).toEqual([]);
});
