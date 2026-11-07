// SPDX-License-Identifier: MPL-2.0
import { expect } from '@playwright/test';
export async function clickGame(page, x, y) {
  await page.locator('#screen').scrollIntoViewIfNeeded();
  const rect = await page.locator('#screen').boundingBox();
  await page.mouse.click(rect.x + (x * rect.width) / 1280, rect.y + (y * rect.height) / 720);
}
export async function button(page, name, extra = false) {
  await page.waitForFunction(
    ({ name, extra }) => {
      const e = window.catSystem2,
        p = extra ? e?.extraFES : e?.activeFES();
      const s = p?.instances.toReversed().find((s) => s.byKey.has(name));
      const o = s?.byKey.get(name);
      return o?.enable && s.placement(o).shown;
    },
    { name, extra },
  );
  const rect = await page.evaluate(
    ({ name, extra }) => {
      const e = globalThis.catSystem2,
        p = extra ? e.extraFES : e.activeFES();
      const s = p.instances.toReversed().find((s) => s.byKey.has(name));
      if (!s) throw new Error(`Missing test button ${name}`);
      return s.rect(s.byKey.get(name));
    },
    { name, extra },
  );
  await clickGame(page, rect.x + rect.w / 2, rect.y + rect.h / 2);
}
export async function noError(page) {
  await expect(page.locator('#error')).toBeHidden();
}
export async function launch(page) {
  await page.goto('/');
  await page.click('#start');
  await page.waitForFunction(() => window.catSystem2?.status().stack.includes('langselect#WAIT'));
  await noError(page);
  await button(page, 'decide');
  await page.waitForFunction(() => window.catSystem2?.status().stack.includes('title#WAIT'));
}
export async function pad(page, index) {
  await page.evaluate((i) => {
    window.testPad.buttons[i] = { pressed: true, value: 1 };
  }, index);
  await page.waitForTimeout(120);
  await page.evaluate((i) => {
    window.testPad.buttons[i] = { pressed: false, value: 0 };
  }, index);
  await page.waitForTimeout(80);
}
