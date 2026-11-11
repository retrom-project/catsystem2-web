// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
test(
  'the reviewed private DLL regenerates the authored geometry and material evidence',
  {
    skip: !process.env.CATSYSTEM2_EMOTE_DLL && 'requires private CATSYSTEM2_EMOTE_DLL',
  },
  async () => {
    const expected = JSON.parse(
      await readFile(new URL('../fixtures/emote-geometry-golden.json', import.meta.url)),
    );
    await mkdir('.local/phase9', { recursive: true });
    const directory = await mkdtemp('.local/phase9/geometry-oracle-');
    try {
      const output = `${directory}/golden.json`;
      await promisify(execFile)(
        process.execPath,
        [
          'scripts/record-emote-geometry.mjs',
          '--driver',
          process.env.CATSYSTEM2_EMOTE_DLL,
          '--output',
          output,
        ],
        { timeout: 15000 },
      );
      assert.deepEqual(JSON.parse(await readFile(output)), expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
