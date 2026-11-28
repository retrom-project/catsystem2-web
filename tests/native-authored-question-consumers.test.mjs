// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif } from './helpers.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-authored-question-consumers.json', import.meta.url)),
);
const program = Uint8Array.from(Buffer.from(fixture.program, 'base64'));
const startup = Uint8Array.from(Buffer.from(fixture.startup, 'base64'));
const profiles = {
  63: 'rebellions-jp-engine-2.6.1.63',
  67: 'bokutomo-engine-2.6.1.67',
  74: 'sdk-4.01-engine-2.6.1.74',
  76: 'nekopara-vol3-engine-2.6.1.76',
};
async function open(profile, { initialize = false, empty = false } = {}) {
  return modernParticleMessageWorld(
    profile,
    {
      'scripts.int': kif([['main.kcs', program]]),
      'config/startup.xml': startup,
      'database.int': kif(
        empty
          ? []
          : fixture.resources.map(([name, bytes]) => [
              name,
              Uint8Array.from(Buffer.from(bytes, 'base64')),
            ]),
      ),
    },
    { initialize, startup: parseNativeXML(startup) },
  );
}
function projection(machine) {
  return {
    words: fixture.outputs.map((at) => machine.load(at)),
    text: fixture.textOutputs.map(({ at, size }) =>
      Buffer.from(machine.bytes(at, size)).toString('base64'),
    ),
  };
}

for (const [version, profile] of Object.entries(profiles))
  test(`${profile} mounted Question resources reach an actual Script expression and distinct reader`, async () => {
    const world = await open(profile);
    let fresh;
    const expected = fixture.builds.find((row) => row.version === version) ?? fixture.builds[0];
    const calls = [];
    const observed = new Set(expected.controls.map(({ id }) => id));
    const native = world.runtime.native.bind(world.runtime);
    world.runtime.native = async (table, id, ...args) => {
      const reply = await native(table, id, ...args);
      if (table === 'main' && observed.has(id))
        calls.push({
          id,
          control: reply.control,
          result: [742, 833].includes(id) ? 'owned' : (reply.value ?? null),
        });
      return reply;
    };
    try {
      assert.equal(world.game.nativeResources.entries[1].name, 'database');
      await world.initialize('main.kcs');
      assert.equal((await world.runtime.scheduler.execute(world.main)).status, 'halted');
      const machine = world.main.machine;
      assert.deepEqual(projection(machine), { words: expected.words, text: expected.text });
      assert.deepEqual(calls, expected.controls);
      assert.equal(machine.load(176), fixture.consumer);
      assert.equal(machine.load(172), machine.load(144) + 7);
      const [first, second] = fixture.ownerWords.map((at) => machine.load(at));
      assert.notEqual(first, second);
      assert.equal(machine.load(168), 0);
      assert.equal(machine.load(184), 0);
      assert.equal(machine.load(200), 1);
      fresh = await open(profile, { empty: true });
      await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())));
      assert.deepEqual(projection(fresh.main.machine), projection(machine));
      const call = (id, args) =>
        fresh.runtime.native('main', id, args, fresh.main.machine, fresh.main);
      await call(743, [first]);
      assert.equal(fresh.runtime.handles.records.has(first), false);
      assert.equal((await call(771, [second, 0])).value, 1);
      await call(749, [second, 0]);
      assert.equal((await call(771, [second, 0])).value, 2);
      assert.equal((await native('main', 771, [second, 0], machine, world.main)).value, 1);
      await call(743, [second]);
      assert.equal(fresh.runtime.handles.records.has(second), false);
      await native('main', 743, [first], machine, world.main);
      await native('main', 743, [second], machine, world.main);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
