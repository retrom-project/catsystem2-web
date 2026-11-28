// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif } from './helpers.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
const fixture = JSON.parse(
  await readFile(
    new URL('./fixtures/native-authored-question-configuration.json', import.meta.url),
  ),
);
const startup = Uint8Array.from(Buffer.from(fixture.startup, 'base64'));
for (const profile of [
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
])
  test(
    profile + ' reads authored config fields and consumes actual one-candidate draw in KCS',
    async () => {
      const world = await modernParticleMessageWorld(
        profile,
        {
          'scripts.int': kif([
            ['main.kcs', Uint8Array.from(Buffer.from(fixture.program, 'base64'))],
          ]),
          'config/startup.xml': startup,
          'database.int': kif(
            fixture.resources.map(([n, b]) => [n, Uint8Array.from(Buffer.from(b, 'base64'))]),
          ),
        },
        { initialize: false, startup: parseNativeXML(startup) },
      );
      const calls = [],
        native = world.runtime.native.bind(world.runtime),
        ids = new Set(fixture.controls.map((r) => r.id));
      world.runtime.native = async (table, id, ...args) => {
        const reply = await native(table, id, ...args);
        if (table === 'main' && ids.has(id))
          calls.push({
            id,
            control: reply.control,
            result: id === 742 ? 'owned' : (reply.value ?? null),
          });
        return reply;
      };
      try {
        await world.initialize('main.kcs');
        assert.equal((await world.runtime.scheduler.execute(world.main)).status, 'halted');
        const machine = world.main.machine;
        assert.deepEqual(
          fixture.outputs.map((at) => machine.load(at)),
          fixture.words,
        );
        assert.deepEqual(
          fixture.textOutputs.map(({ at, size }) =>
            Buffer.from(machine.bytes(at, size)).toString('base64'),
          ),
          fixture.text,
        );
        assert.deepEqual(calls, fixture.controls);
        assert.equal(machine.load(1324), fixture.consumer);
        assert.equal(machine.load(1320), 32);
        assert.deepEqual(world.random.snapshot().integer, {
          index: fixture.integerRandom.index,
          words: fixture.integerRandom.words,
        });
        const owner = machine.load(64);
        await native('main', 743, [owner], machine, world.main);
        assert.equal(world.runtime.handles.records.has(owner), false);
      } finally {
        await world.close({ flushFiles: false });
      }
    },
  );
