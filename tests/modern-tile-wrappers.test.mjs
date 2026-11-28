// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { replayModernTile } from './fixtures/modern-tile-replay.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-tile-wrappers-golden.json', import.meta.url)),
);
for (const build of golden.builds) {
  test(`${build.version} Tile declarations match own wrapper widths, controls and ownership`, () => {
    assert.equal(new Set(build.rows.map((row) => row.id)).size, 44);
    const entries = nativeABI(build.profile).tables.main.entries;
    for (const row of build.rows) {
      const { signature } = entries[row.id];
      assert.equal(signature.review, 'reviewed');
      assert.equal(signature.argumentWords, row.args.length);
      assert.deepEqual(signature.controlCodes, [row.control]);
      assert.equal(signature.resultWritten, row.control === 1);
      if (row.id === 470) {
        assert.equal(signature.result.handleKind, 'tile-game');
        assert.equal(signature.result.ownership, 'owned');
      } else {
        assert.equal(signature.parameters[0].type.handleKind, 'tile-game');
        assert.equal(signature.parameters[0].type.ownership, row.id === 471 ? 'owned' : 'borrowed');
      }
    }
  });
  test(`${build.version} all44 Tile wrappers retain native controls, VM bytes and context caches`, (t) =>
    replayModernTile(t, build));
}
