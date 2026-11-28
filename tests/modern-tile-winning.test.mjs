// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { replayModernTile } from './fixtures/modern-tile-replay.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-tile-winning-golden.json', import.meta.url)),
);
for (const build of golden.builds)
  test(`${build.version} public normal hand produces nonempty choices, score/payment caches and cold continuation`, (t) =>
    replayModernTile(t, build));
