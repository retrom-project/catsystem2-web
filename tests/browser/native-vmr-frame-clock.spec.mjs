// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('a detached movie advances its texture sample clock after a seek in sparse H.264', async ({
  page,
}) => {
  const bytes = await readFile(new URL('../fixtures/native-plane-movie-ogv.mp4', import.meta.url));
  await page.goto('/');
  const result = await page.evaluate(
    async (encoded) => {
      const { BrowserNativeMovie } = await import('/src/native/movie-browser.mjs'),
        url = URL.createObjectURL(new Blob([Uint8Array.from(encoded)], { type: 'video/mp4' })),
        movie = new BrowserNativeMovie({
          game: { movieSource: async () => ({ url }) },
          timeout: 10000,
        }),
        center = async () => {
          const frame = await movie.decodedFrame();
          return [...frame.rgba.subarray((4 * frame.width + 4) * 4, (4 * frame.width + 5) * 4)];
        };
      try {
        if (!(await movie.open('authored.mp4'))) throw new Error('Authored movie did not decode');
        await movie.seek(2400000n);
        const savedPosition = movie.position(),
          firstStamp = movie.frameStamp(),
          first = await center();
        if (!(await movie.play())) throw new Error('Authored movie did not start');
        let stamp = firstStamp,
          green = null,
          samples = 0;
        const deadline = performance.now() + 8000;
        while (!movie.video.ended && performance.now() < deadline) {
          const next = movie.frameStamp();
          if (next !== stamp) {
            stamp = next;
            samples++;
            const color = await center();
            if (color[1] > 230 && color[0] < 20) {
              green = color;
              break;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await movie.stop();
        const paused = movie.frameStamp();
        await new Promise((resolve) => setTimeout(resolve, 60));
        return {
          first,
          green,
          samples,
          attached: movie.video.isConnected,
          seekClock: firstStamp === savedPosition,
          stablePause: paused === movie.frameStamp() && paused === movie.position(),
        };
      } finally {
        await movie.close();
        URL.revokeObjectURL(url);
      }
    },
    [...bytes],
  );
  expect(result.attached).toBe(false);
  expect(result.seekClock).toBe(true);
  expect(result.first[0]).toBeGreaterThan(230);
  expect(result.green?.[1]).toBeGreaterThan(230);
  expect(result.samples).toBeGreaterThan(1);
  expect(result.stablePause).toBe(true);
});
