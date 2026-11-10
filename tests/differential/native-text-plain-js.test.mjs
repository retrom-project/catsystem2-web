// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile +
      ' JS plain extraction equals complete frozen wrappers including escapes and all canaries',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      await mkdir('.local/phase5', { recursive: true });
      const { stdout } = await promisify(execFile)(process.execPath, [
        'scripts/verify-native-text-plain.mjs',
        fixture.filename,
        '.local/phase5/plain-' + fixture.profile + '.json',
      ]);
      assert.match(stdout, /differential \d+\/\d+/);
    },
  );
