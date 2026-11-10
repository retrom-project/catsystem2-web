// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
for (const fixture of await engineFixtureSet())
  for (const family of ['save-slots', 'scene-checkpoint'])
    test(
      fixture.profile + ' independent JS ' + family + ' operation sequences',
      { skip: fixture.available ? false : fixture.reason },
      async () => {
        const directory = await mkdtemp(join(tmpdir(), 'cs2-data-'));
        try {
          const { stdout } = await promisify(execFile)(process.execPath, [
            `scripts/verify-native-${family}.mjs`,
            fixture.filename,
            join(directory, 'report.json'),
          ]);
          assert.match(stdout, /differential \d+\/\d+/);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
