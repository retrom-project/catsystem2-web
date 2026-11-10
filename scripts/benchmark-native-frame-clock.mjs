// SPDX-License-Identifier: MPL-2.0
// Empty-World measurement of the optional acceptance-clock instrumentation.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { frameClock } from '../tests/browser/native-game-input.mjs';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox'],
});
try {
  const pages = [];
  for (const metrics of [false, true]) {
    if (metrics) process.env.CATSYSTEM2_FRAME_METRICS = '1';
    else delete process.env.CATSYSTEM2_FRAME_METRICS;
    const page = await browser.newPage();
    await frameClock(page);
    await page.goto('data:text/html,clock');
    await page.evaluate(() => {
      window.catSystem2 = {
        world: {
          frame: 0,
          async tick() {
            this.frame++;
          },
        },
        async step(n) {
          for (let i = 0; i < n; i++) await this.world.tick();
        },
        async render() {},
      };
      const frame = async () => {
        await window.catSystem2.step(6);
        await window.catSystem2.render();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    pages.push(page);
  }
  const samples = [[], []],
    callbacks = 4000;
  const run = (page, n) =>
    page.evaluate(async (n) => {
      const before = performance.now();
      for (let i = 0; i < n; i++) await window.nativeGameFrame(6);
      return {
        ms: performance.now() - before,
        frame: window.catSystem2.world.frame,
        stats: window.nativeFrameMetrics,
      };
    }, n);
  for (const p of pages) await run(p, 500);
  for (let round = 0; round < 7; round++)
    for (const side of round % 2 ? [1, 0] : [0, 1]) {
      const r = await run(pages[side], callbacks);
      samples[side].push(r.ms);
      if (side) assert.equal(r.stats.tick.calls, r.frame);
    }
  const median = (a) => [...a].sort((a, b) => a - b)[a.length >> 1],
    delta = median(samples[1]) - median(samples[0]);
  console.log(
    JSON.stringify(
      {
        callbacks,
        framesPerCallback: 6,
        samples,
        medianMS: samples.map(median),
        additionalMicrosecondsPerTick: (Math.max(0, delta) * 1000) / (callbacks * 6),
        scope:
          'RAF/step/tick/render timing wrapper overhead on an empty async World; excludes production game work and IPC. Paired alternating runs, warmed engines.',
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
