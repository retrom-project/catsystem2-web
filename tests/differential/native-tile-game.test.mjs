// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
const execFile = promisify(execute);
for (const fixture of await engineFixtureSet()) {
  test(
    fixture.profile + ' independent tile rules, VM writes and operation sequences',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'catsystem2-tile-'));
      try {
        await execFile(
          process.execPath,
          ['scripts/verify-native-tile-game.mjs', fixture.filename, join(directory, 'report.json')],
          { maxBuffer: 1024 * 1024 },
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
