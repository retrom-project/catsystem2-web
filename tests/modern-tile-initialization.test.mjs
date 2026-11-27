// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { replayModernTile } from './fixtures/modern-tile-replay.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-tile-initialization-golden.json', import.meta.url)),
);
for (const build of golden.builds)
  test(`${build.version} registered Tile clock seed and typed-context GCALL frames survive cold`, (t) =>
    replayModernTile(t, build));
