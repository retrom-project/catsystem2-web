// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test(
  'the reviewed DLL regenerates every authored controller observation and vertex byte',
  {
    skip: !process.env.CATSYSTEM2_EMOTE_DLL && 'requires private CATSYSTEM2_EMOTE_DLL',
  },
  async () => {
    const golden = JSON.parse(
        await readFile(new URL('../fixtures/emote-controller-golden.json', import.meta.url)),
      ),
      driver = await readFile(process.env.CATSYSTEM2_EMOTE_DLL);
    assert.equal(createHash('sha256').update(driver).digest('hex'), golden.driverSHA256);
    await mkdir('.local/phase9', { recursive: true });
    const directory = await mkdtemp('.local/phase9/verify-controllers-');
    try {
      const output = `${directory}/golden.json`;
      await promisify(execFile)(
        process.execPath,
        [
          'scripts/record-emote-controllers.mjs',
          '--driver',
          process.env.CATSYSTEM2_EMOTE_DLL,
          '--output',
          output,
        ],
        { timeout: 15000 },
      );
      const current = JSON.parse(await readFile(output));
      assert.deepEqual(current, golden);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
