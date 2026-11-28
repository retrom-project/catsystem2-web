// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif } from './helpers.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const fixture = JSON.parse(
  await readFile(
    new URL('./fixtures/native-authored-mission-selection-consumers.json', import.meta.url),
  ),
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
          : fixture.resources.map(([name, data]) => [
              name,
              Uint8Array.from(Buffer.from(data, 'base64')),
            ]),
      ),
    },
    { initialize: false, startup: parseNativeXML(startup) },
  );
}
const projection = (machine, shape) => ({
  words: shape.outputs.map((at) => machine.load(at)),
  text: shape.textOutputs.map(({ at, size }) =>
    Buffer.from(machine.bytes(at, size)).toString('base64'),
  ),
});

for (const [version, profile] of Object.entries(profiles))
  test(`${profile} Mission progress and Selection work reach real Script consumers and two independent colds`, async () => {
    const legacy = ['63', '67'].includes(version);
    const shape = fixture.builds.find((r) => r.version === version) ?? fixture.builds[0];
    const program = Uint8Array.from(Buffer.from(shape.program, 'base64'));
    const expectedWords = shape.words.slice();
    if (!legacy) expectedWords[shape.outputs.indexOf(shape.labels.hole)] = 0xffffffff;
    const world = await open(profile, program);
    let firstCold, secondCold;
    const initialRandom = world.random.snapshot();
    const native = world.runtime.native.bind(world.runtime);
    const observed = new Set(shape.controls.map(({ id }) => id)),
      calls = [];
    world.runtime.native = async (table, id, ...args) => {
      const reply = await native(table, id, ...args);
      if (table === 'main' && observed.has(id))
        calls.push({
          id,
          control: reply.control,
          result: [795, 779, 791, 833].includes(id) ? 'owned' : (reply.value ?? null),
        });
      return reply;
    };
    try {
      await world.initialize('main.kcs');
      assert.equal((await world.runtime.scheduler.execute(world.main)).status, 'halted');
      const machine = world.main.machine;
      assert.deepEqual(projection(machine, shape), { words: expectedWords, text: shape.text });
      const expectedControls = structuredClone(shape.controls);
      if (!legacy) expectedControls[shape.holeControlIndex].result = 0xffffffff;
      assert.deepEqual(calls, expectedControls);
      assert.equal(machine.load(1324), shape.scope.expectedConsumer);
      assert.equal(machine.load(1320), 21);
      if (legacy)
        assert.deepEqual(world.random.snapshot().integer, {
          index: shape.integerRandom.index,
          words: shape.integerRandom.words,
        });
      else assert.deepEqual(world.random.snapshot(), initialRandom);
      const handles = shape.scope.owners.map((at) => machine.load(at)),
        [first, second, selection, compiled] = handles;
      firstCold = await open(profile, program, true);
      await firstCold.restore(
        await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
      );
      assert.deepEqual(projection(firstCold.main.machine, shape), projection(machine, shape));
      const call = (owner, id, args) =>
        owner.runtime.native('main', id, args, owner.main.machine, owner.main);
      await call(firstCold, 796, [first]);
      assert.equal(firstCold.runtime.handles.records.has(first), false);
      await call(firstCold, 803, [second, 10, 1440, 1444]);
      assert.equal(firstCold.main.machine.load(1440), 1);
      await call(firstCold, 797, [second, 9]);
      await call(firstCold, 801, [second, 20]);
      await call(firstCold, 803, [second, 20, 1440, 1444]);
      assert.equal(firstCold.main.machine.load(1440), 1);
      await native('main', 803, [second, 20, 1440, 1444], machine, world.main);
      assert.equal(machine.load(1440), 0);
      secondCold = await open(profile, program, true);
      await secondCold.restore(
        await deserializeCheckpoint(await serializeCheckpoint(firstCold.snapshot())),
      );
      assert.equal(secondCold.runtime.handles.records.has(first), false);
      await call(secondCold, 803, [second, 20, 1440, 1444]);
      assert.equal(secondCold.main.machine.load(1440), 1);
      const value = await call(secondCold, 784, [selection, 2]);
      assert.equal(value.value, version === '67' ? 0xfffffff6 : 102);
      secondCold.main.machine.writeString('ID', 2048);
      assert.equal((await call(secondCold, 793, [compiled, 2048, 0])).value, 11);
      for (const owner of [secondCold, firstCold]) {
        await call(owner, 796, [second]);
        await call(owner, 780, [selection]);
        await call(owner, 792, [compiled]);
      }
      for (const [id, handle] of [
        [796, first],
        [796, second],
        [780, selection],
        [792, compiled],
      ])
        await native('main', id, [handle], machine, world.main);
    } finally {
      await secondCold?.close({ flushFiles: false });
      await firstCold?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
