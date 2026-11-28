// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif } from './helpers.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-authored-database-body-context.json', import.meta.url)),
);
const startup = Uint8Array.from(Buffer.from(fixture.startup, 'base64'));
const profiles = {
  63: 'rebellions-jp-engine-2.6.1.63',
  67: 'bokutomo-engine-2.6.1.67',
  74: 'sdk-4.01-engine-2.6.1.74',
  76: 'nekopara-vol3-engine-2.6.1.76',
};
async function open(profile, program, empty = false) {
  return modernParticleMessageWorld(
    profile,
    {
      'scripts.int': kif([['main.kcs', program]]),
      'config/startup.xml': startup,
      'database.int': kif(
        empty
          ? []
          : fixture.resources.map(([n, b]) => [n, Uint8Array.from(Buffer.from(b, 'base64'))]),
      ),
    },
    { initialize: false, startup: parseNativeXML(startup) },
  );
}
for (const row of fixture.builds)
  test(
    profiles[row.version] + ' consumes retained database field bodies in a loaded typed Script',
    async () => {
      const program = Uint8Array.from(Buffer.from(row.program, 'base64')),
        world = await open(profiles[row.version], program);
      let fresh;
      try {
        await world.initialize('main.kcs');
        assert.equal((await world.runtime.scheduler.execute(world.main)).status, 'halted');
        const m = world.main.machine;
        assert.equal(m.load(row.labels.membership), 1);
        assert.equal(m.load(row.labels.special), 30);
        assert.equal(m.load(row.labels.point), 0);
        assert.deepEqual(
          [1200, 1204, 1208, 1212, 1216, 1220].map((at) => m.load(at)),
          row.currentExpected.stats,
        );
        assert.equal(m.string(1536), 'alpha');
        assert.equal(m.load(1348), 35);
        if (row.version === '63') {
          fresh = await open(profiles[row.version], program, true);
          await fresh.restore(
            await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
          );
          assert.equal(fresh.main.machine.load(1348), 35);
          const owner = fresh.main.machine.load(64);
          await fresh.runtime.native(
            'main',
            814,
            [owner, 0, 1200, 1204, 1208, 1212, 1216, 1220],
            fresh.main.machine,
            fresh.main,
          );
          assert.deepEqual(
            [1200, 1204, 1208, 1212, 1216, 1220].map((at) => fresh.main.machine.load(at)),
            row.currentExpected.stats,
          );
        }
        for (const target of [fresh, world].filter(Boolean))
          for (const [id, at] of [
            [796, 64],
            [796, 68],
            [780, 80],
            [792, 84],
            [743, 88],
          ])
            await target.runtime.native(
              'main',
              id,
              [target.main.machine.load(at)],
              target.main.machine,
              target.main,
            );
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
