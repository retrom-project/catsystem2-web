// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { replayModernTile } from './fixtures/modern-tile-replay.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-tile-output-pointers-golden.json', import.meta.url)),
);
for (const build of golden.builds)
  test(`${build.version} Tile resolved output addresses survive their own argument-word writes`, (t) =>
    replayModernTile(t, build));
