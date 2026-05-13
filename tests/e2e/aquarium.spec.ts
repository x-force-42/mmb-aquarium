import { test, expect } from '@playwright/test';
import type { World } from '../../src/world';
import type { Renderer } from '../../src/renderer';
import type { SimulatorTransport } from '../../src/transport';

/**
 * E2E guardrails — exercises the wired-up app from the user's POV.
 *
 * The app exposes `window.__aquarium` for tests to peek at world / renderer
 * state without resorting to flaky DOM inspection. That hook is the
 * narrowest "test API" we have to maintain; treat it as part of the
 * contract going forward.
 *
 * The actual shape is declared once in `src/main.ts`. We import the concrete
 * types here so the declarations merge cleanly and the spec stays in lockstep
 * with the runtime contract.
 */

declare global {
  interface Window {
    __aquarium?: { world: World; renderer: Renderer; sim: SimulatorTransport };
  }
}

async function waitForBoot(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => !!window.__aquarium, undefined, { timeout: 10_000 });
}

test.describe('Mr. Meeseeks Aquarium', () => {
  test('boots without page errors and exposes the aquarium hook', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await waitForBoot(page);

    expect(errors).toEqual([]);
    await expect(page.locator('#pixi-container canvas')).toBeVisible();
  });

  test('Nasce Meeseeks button adds a sprite and bumps the counter', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    await page.locator('#btn-born').click();

    await expect.poll(() => page.evaluate(() => window.__aquarium!.world.size())).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__aquarium!.renderer.spriteCount())).toBe(1);
    await expect(page.locator('#counter')).toHaveText('1 vivo');

    await page.locator('#btn-born').click();
    await expect(page.locator('#counter')).toHaveText('2 vivos');
  });

  test('Mata feliz removes one Meeseeks from the world', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    // Seed three via direct sim calls — faster + deterministic than three clicks.
    await page.evaluate(() => {
      window.__aquarium!.sim.born();
      window.__aquarium!.sim.born();
      window.__aquarium!.sim.born();
    });
    await expect.poll(() => page.evaluate(() => window.__aquarium!.world.size())).toBe(3);

    await page.locator('#btn-died-happy').click();
    await expect.poll(() => page.evaluate(() => window.__aquarium!.world.size())).toBe(2);
  });

  test('Desiste (died_defeated) also removes a Meeseeks', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);
    await page.evaluate(() => window.__aquarium!.sim.born());
    await page.locator('#btn-died-defeated').click();
    await expect.poll(() => page.evaluate(() => window.__aquarium!.world.size())).toBe(0);
  });

  test('Surta then Recupera round-trips the isFreakingOut flag', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);
    await page.evaluate(() => window.__aquarium!.sim.born());

    await page.locator('#btn-freaking-out').click();
    await expect.poll(() => page.evaluate(() => window.__aquarium!.world.getFreakingOut().length)).toBe(1);

    await page.locator('#btn-recovered').click();
    await expect.poll(() => page.evaluate(() => window.__aquarium!.world.getFreakingOut().length)).toBe(0);
  });

  test('Decai saúde drops every Meeseeks health by ~0.1', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);
    await page.evaluate(() => {
      window.__aquarium!.sim.born();
      window.__aquarium!.sim.born();
    });

    await page.locator('#btn-decay').click();

    const healths = await page.evaluate(() => window.__aquarium!.world.getAll().map((m) => m.health));
    for (const h of healths) {
      expect(h).toBeGreaterThanOrEqual(0.89);
      expect(h).toBeLessThanOrEqual(0.91);
    }
  });

  test('Decai saúde repeatedly never goes below 0', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);
    await page.evaluate(() => window.__aquarium!.sim.born());

    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.__aquarium!.sim.decayAll());
    }
    const min = await page.evaluate(() => Math.min(...window.__aquarium!.world.getAll().map((m) => m.heal