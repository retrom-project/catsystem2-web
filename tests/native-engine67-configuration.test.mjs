// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeABI, validateABI } from '../src/native/abi/index.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const profile = 'bokutomo-engine-2.6.1.67';
const invoke = (world, id, args) =>
  world.runtime.native('main', id, args, world.main.machine, world.main);
const value = async (world, id, args) => (await invoke(world, id, args)).value;
const word = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
async function open(t) {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  return world;
}
async function cold(t, world) {
  const fresh = await dataWorld(profile, {}, { initialize: false });
  t.after(() => fresh.close({ flushFiles: false }));
  await fresh.restore(structuredClone(world.snapshot()));
  return fresh;
}

test('2.6.1.67 preference data uses its own reviewed word and pointer contracts', () => {
  const abi = nativeABI(profile);
  for (const id of [360, 582, 583, 584, 589]) {
    const entry = abi.tables.main.entries[id];
    assert.equal(entry.status, 'recovered');
    assert.equal(entry.signature.review, 'reviewed');
    assert.equal(entry.signature.resultWritten, [582, 583].includes(id));
  }
  assert.equal(abi.tables.main.entries[360].signature.parameters[0].type.direction, 'in');
  assert.equal(abi.tables.main.entries[589].signature.parameters[0].type.direction, 'out');
  assert.equal(abi.tables.main.entries[361].status, 'recovered');
  assert.equal(abi.tables.main.entries[533].status, 'recovered');
  assert.throws(
    () =>
      validateABI({
        ...abi,
        configuration: { ...abi.configuration, systemVoiceIncludesPreferenceBlocks: 1 },
      }),
    /system-voice preference bank policy/,
  );
});

test('2.6.1.67 replaces three preference blocks and retains their bytes cold', async (t) => {
  const world = await open(t),
    machine = world.main.machine,
    game = world.configuration.blocks[3].slice(),
    inputs = [512, 6400, 6500],
    expected = [5628, 60, 28].map((size, block) =>
      Uint8Array.from({ length: size }, (_, i) => (i * 37 + block * 31) ^ (i >>> 3)),
    );
  expected.forEach((bytes, index) => machine.bytes(inputs[index], bytes.length).set(bytes));
  assert.equal((await invoke(world, 360, inputs)).control, 2);
  for (let i = 0; i < 3; i++) assert.deepEqual(world.configuration.blocks[i], expected[i]);
  assert.deepEqual(world.configuration.blocks[3], game);
  assert.equal((await invoke(world, 360, [0x40000000, 0x40000000, 0x40000000])).control, 2);
  const fresh = await cold(t, world);
  await invoke(fresh, 359, [0, 6400, 6500, 6600]);
  assert.deepEqual(fresh.main.machine.bytes(0, 5628), expected[0]);
  assert.deepEqual(fresh.main.machine.bytes(6400, 60), expected[1]);
  assert.deepEqual(fresh.main.machine.bytes(6500, 28), expected[2]);
  assert.deepEqual(fresh.main.machine.bytes(6600, 12), game);
  assert.deepEqual(fresh.configuration.snapshot(), world.configuration.snapshot());
});

test('2.6.1.67 system-voice indices update live preceding preference words', async (t) => {
  const world = await open(t),
    config = world.configuration,
    aliases = [
      [-1816, config.blocks[0], 0],
      [-409, config.blocks[1], 0],
      [-394, config.blocks[2], 0],
      [-387, config.blocks[3], 0],
      [-385, config.blocks[3], 8],
      [-384, config.fields.systemVoice, 0],
      [-1, config.fields.systemVoice, 1532],
      [0, config.fields.systemVoice, 1536],
      [47, config.fields.systemVoice, 1724],
      [48, config.fields.systemVoice, 1728],
      [431, config.fields.systemVoice, 3260],
    ];
  for (const [i, [index, bytes, offset]] of aliases.entries()) {
    const bits = (0xfedc0000 + i) >>> 0;
    await invoke(world, 584, [index >>> 0, bits]);
    assert.equal(await value(world, 582, [index >>> 0]), bits);
    assert.equal(word(bytes, offset), bits);
  }
  const fresh = await cold(t, world);
  for (const [i, [index]] of aliases.entries())
    assert.equal(await value(fresh, 582, [index >>> 0]), (0xfedc0000 + i) >>> 0);
  assert.deepEqual(fresh.configuration.snapshot(), config.snapshot());
});

test('2.6.1.67 system-voice selection consumes exactly its shared integer stream', async (t) => {
  const world = await open(t);
  world.random.integer.seed(0x67c0ffee);
  for (let index = 0; index < 48; index++) await invoke(world, 584, [index, 0]);
  const empty = world.random.integer.snapshot();
  assert.equal(await value(world, 583, []), 0xffffffff);
  assert.deepEqual(world.random.integer.snapshot(), empty);
  assert.equal(await value(world, 33, []), 730078430);
  for (const [index, bits] of [
    [0, 1],
    [5, 0xffffffff],
    [47, 0x76543210],
  ])
    await invoke(world, 584, [index, bits]);
  const expected = [47, 0, 5, 47, 47, 5, 5, 5, 5, 0, 0, 0],
    interleaved = [317580163, 3954394615, 1714565439, 2590321298];
  for (const [i, selected] of expected.entries()) {
    assert.equal(await value(world, 583, []), selected);
    if (i % 3 === 0) assert.equal(await value(world, 33, []), interleaved[i / 3]);
  }
  const fresh = await cold(t, world);
  assert.equal(await value(fresh, 583, []), await value(world, 583, []));
  assert.deepEqual(fresh.random.snapshot(), world.random.snapshot());
});

test('2.6.1.67 indexed query words share live storage with ordered VM output aliases', async (t) => {
  const world = await open(t),
    config = world.configuration,
    machine = world.main.machine;
  config.queryWords.set([0x89abcdef, 0xdecafbad]);
  await invoke(world, 589, [0x80000000, 0x80000004]);
  assert.deepEqual([machine.load(0x80000000), machine.load(0x80000004)], [...config.queryWords]);
  await invoke(world, 589, [0, 0]);
  assert.equal(machine.load(0), 0xdecafbad);
  assert.equal(await value(world, 582, [-4426 >>> 0]), 0x89abcdef);
  assert.equal(await value(world, 582, [-4425 >>> 0]), 0xdecafbad);
  await invoke(world, 584, [-4426 >>> 0, 0x12345678]);
  assert.equal(config.queryWords[0], 0x12345678);
  const fresh = await cold(t, world);
  await invoke(fresh, 589, [0, 4]);
  assert.deepEqual(
    [fresh.main.machine.load(0), fresh.main.machine.load(4)],
    [0x12345678, 0xdecafbad],
  );
});
