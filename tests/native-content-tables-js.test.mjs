// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { contentFiles } from './fixtures/content-database-data.mjs';
import { SaveSlotFiles } from './fixtures/save-slot-files.mjs';
import { KCSMachine, readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint, checkpointBytes } from '../src/checkpoint.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS content table handles restore independently of their resource files',
    async () => {
      const first = await dataWorld(profile, Object.fromEntries(contentFiles()));
      let fresh;
      const call = (world, id, args = []) =>
        world.runtime.native('main', id, args, world.main.machine, world.main);
      try {
        const h = (await call(first, 0x30b)).value;
        first.main.machine.writeString('alpha', 64);
        await call(first, 0x30d, [h, 100, 64]);
        first.main.machine.writeString('selections', 64);
        await call(first, 0x30e, [h, 64]);
        await call(first, 0x33d, [h, 1]);
        first.main.machine.writeString('questions', 64);
        const table = (await call(first, 0x317, [64])).value;
        const question = (await call(first, 0x2e6)).value;
        first.main.machine.writeString('questions', 64);
        await call(first, 0x2e8, [question, 64]);
        await call(first, 0x2fc, [question]);
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(first.snapshot()));
        await call(fresh, 0x2ed, [question, 0]);
        assert.equal((await call(fresh, 0x303, [question, 0])).value, 1);
        assert.equal((await call(first, 0x303, [question, 0])).value, 0);
        assert.equal((await call(fresh, 0x2ea, [question, 0, 768])).value, 1);
        assert.equal(fresh.main.machine.string(768), 'Another question?');
        fresh.main.machine.writeString('ID', 64);
        assert.equal((await call(fresh, 0x319, [table, 64, 0])).value, 11);
        await call(fresh, 0x33f, [h, 0]);
        assert.equal((await call(fresh, 0x310, [h, 0])).value, -10 >>> 0);
        assert.equal((await call(first, 0x310, [h, 0])).value, 100);
        await call(fresh, 0x30c, [h]);
        await call(fresh, 0x318, [table]);
        await assert.rejects(() => call(fresh, 0x319, [table, 64, 0]), /released/);
        assert.equal((await call(first, 0x30f, [h])).value, 2);
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS question and mission data roundtrip through CSS in a fresh World',
    async () => {
      const storage = new SaveSlotFiles(),
        resources = Object.fromEntries(contentFiles()),
        first = await dataWorld(profile, resources, { storage });
      let fresh;
      const call = (world, id, args = []) =>
        world.runtime.native('main', id, args, world.main.machine, world.main);
      async function owners(world) {
        const question = (await call(world, 0x2e6)).value;
        world.main.machine.writeString('questions', 64);
        await call(world, 0x2e8, [question, 64]);
        await call(world, 0x2fc, [question]);
        world.main.machine.writeString('missions', 64);
        const mission = (await call(world, 0x31b, [64])).value;
        await call(world, 0x335, [mission]);
        return { question, mission };
      }
      try {
        const one = await owners(first);
        await call(first, 0x2ed, [one.question, 0]);
        await call(first, 0x321, [one.mission, 10]);
        const file = (await call(first, 0xee, [17])).value;
        for (const [id, handle, entry] of [
          [0x2ff, one.question, 1],
          [0x337, one.mission, 2],
        ]) {
          const size = (await call(first, id, [handle, 0])).value,
            pointer = (await call(first, 0x341, [size])).value;
          first.runtime.imageDataBuffers.process.write(pointer, new Uint8Array(size).fill(0xa5));
          await call(first, id, [handle, pointer]);
          await call(first, 0x343, [file, entry, size, pointer]);
          await call(first, 0x342, [pointer]);
        }
        first.main.machine.writeString('progress.dat', 64);
        assert.equal((await call(first, 0xf5, [file, 64])).value, 1);
        fresh = await dataWorld(profile, resources, { storage });
        const two = await owners(fresh);
        fresh.main.machine.writeString('progress.dat', 64);
        const loaded = (await call(fresh, 0xf7, [64])).value;
        for (const [id, handle, entry] of [
          [0x300, two.question, 1],
          [0x338, two.mission, 2],
        ]) {
          const pointer = (await call(fresh, 0x344, [loaded, entry, 1024])).value,
            size = fresh.main.machine.load(1024);
          assert.equal(
            (await call(fresh, id, [handle, pointer, ...(id === 0x338 ? [size] : [])])).value,
            1,
          );
          await call(fresh, 0x342, [pointer]);
        }
        assert.equal((await call(fresh, 0x303, [two.question, 0])).value, 1);
        await call(fresh, 0x323, [two.mission, 10, 1024, 1040]);
        assert.equal(fresh.main.machine.load(1024), 1);
        await call(fresh, 0x334, [two.mission, 10, 7, 1024]);
        assert.equal(fresh.main.machine.load(1024), 1);
        assert.equal((await call(fresh, 0x334, [two.mission, 10, 9, 1024])).value, 1);
        assert.equal(fresh.main.machine.load(1024), 0);
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );

test('fixed SDK .23 question GCALL keeps parsed state, owner identity and native exports through a cold checkpoint', async () => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    files = Object.fromEntries([...contentFiles()].map(([name, bytes]) => [name + '.db', bytes])),
    first = await dataWorld(profile, files);
  let fresh, latestProgram;
  async function call(world, id, args = [], strings = []) {
    const task = world.main,
      programBytes = kcsProgram([
        [37, 0x36eb67a5],
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        [59],
      ]),
      program = await readKCS(programBytes);
    latestProgram = programBytes;
    task.status = 'ready';
    task.io = null;
    const machine = (task.machine = new KCSMachine(
      program,
      { native: (number, words, vm) => world.runtime.scheduler.native(task, number, words, vm) },
      world.runtime.scheduler.shared,
    ));
    for (const [address, string] of strings) machine.writeString(string, address);
    assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    const signature = nativeABI(profile).tables.main.entries[id].signature,
      value = signature.resultWritten ? machine.pop() : undefined;
    assert.equal(machine.pop(), 0x36eb67a5);
    return value;
  }
  try {
    const question = await call(first, 742),
      second = await call(first, 742);
    assert.equal(await call(first, 744, [question, 64], [[64, 'questions.db']]), 1);
    assert.equal(await call(first, 750, [question, 64], [[64, 'configurations.db']]), 1);
    assert.equal(await call(first, 751, [question, 64], [[64, 'alpha']]), 1);
    await call(first, 764, [question]);
    await call(first, 749, [question, 0]);
    await call(first, 766, [question, 0]);
    assert.equal(await call(first, 771, [question, 0]), 1);
    assert.equal(await call(first, 745, [second]), 0);
    const pointer = first.runtime.imageDataBuffers.process.allocate(276);
    assert.equal(await call(first, 767, [question, pointer]), 276);
    const saved = first.runtime.imageDataBuffers.process.read(pointer, 276).slice(),
      view = new DataView(saved.buffer, saved.byteOffset, saved.byteLength);
    assert.deepEqual(
      [0, 4, 8].map((at) => view.getUint32(at, true)),
      [12, 88, 3],
    );
    fresh = await dataWorld(profile, { 'case.kcs': latestProgram }, { initialize: false });
    await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(first.snapshot())));
    assert.equal(await call(fresh, 746, [question, 0, 512]), 1);
    assert.equal(fresh.main.machine.string(512), 'Another question?');
    await call(fresh, 749, [question, 0]);
    assert.equal(await call(fresh, 771, [question, 0]), 2);
    assert.equal(await call(first, 771, [question, 0]), 1);
    assert.equal(await call(fresh, 768, [question, pointer]), 1);
    assert.equal(await call(fresh, 771, [question, 0]), 1);
    assert.deepEqual(fresh.runtime.imageDataBuffers.process.read(pointer, 276), saved);
    await assert.rejects(() => call(fresh, 776, [question, -1, 512]), /reads before its pool/);
    await call(fresh, 743, [question]);
    await assert.rejects(() => call(fresh, 745, [question]), /released/);
    assert.equal(await call(fresh, 745, [second]), 0);
    await call(fresh, 743, [second]);
  } finally {
    await fresh?.close({ flushFiles: false });
    await first.close({ flushFiles: false });
  }
});

test('fixed SDK .23 question duplicate loads skip I/O while failed parse can retry and missing configurations clear only lookup entries', async () => {
  const files = Object.fromEntries(contentFiles()),
    world = await dataWorld('grisaia-jp-engine-2.6.1.23', files),
    machine = world.main.machine,
    call = (id, args = []) => world.runtime.native('main', id, args, machine, world.main),
    originalRead = world.runtime.services.read,
    reads = [];
  world.runtime.services.read = async (name, category) => {
    reads.push([name, category]);
    return originalRead(name, category);
  };
  try {
    const owner = (await call(742)).value;
    machine.writeString('questions', 64);
    assert.equal((await call(744, [owner, 64])).value, 1);
    assert.equal(reads.length, 2);
    assert.equal((await call(744, [owner, 64])).value, 0);
    assert.equal(reads.length, 2);
    machine.writeString('configurations', 64);
    assert.equal((await call(750, [owner, 64])).value, 1);
    machine.writeString('alpha', 64);
    assert.equal((await call(751, [owner, 64])).value, 1);
    machine.writeString('missing', 64);
    assert.equal((await call(750, [owner, 64])).value, 0);
    machine.writeString('alpha', 64);
    assert.equal((await call(751, [owner, 64])).value, 0);
    assert.equal((await call(752, [owner])).value, 2);
    await call(743, [owner]);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed SDK .23 first genre placeholder continues through following literals and preserves overlapping range order', async () => {
  const files = Object.fromEntries(contentFiles());
  files.ranges = encodeCP932(
    '#range\n$GEN\nGENRE_A 1-2 2-2 1\nGENRE_B @\nGENRE_C @\n#extra\n$GEN\nGENRE_A @ 1\nGENRE_B @\nGENRE_C @\n#onlyextra\n$GEN\nGENRE_A @\nGENRE_B @\nGENRE_C @\n',
  );
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23', files),
    machine = world.main.machine,
    call = (id, args = []) => world.runtime.native('main', id, args, machine, world.main);
  try {
    const owner = (await call(742)).value;
    machine.writeString('questions', 64);
    await call(744, [owner, 64]);
    machine.writeString('ranges', 64);
    await call(750, [owner, 64]);
    for (const [name, expected] of [
      ['range', [12, 11, 22]],
      ['extra', [12, 11, 22]],
      ['onlyextra', [22]],
    ]) {
      machine.writeString(name, 64);
      await call(751, [owner, 64]);
      await call(777, [owner, 0, 2]);
      await call(764, [owner]);
      for (let i = 0; i < expected.length; i++)
        assert.equal((await call(776, [owner, i, 512])).value, expected[i]);
      assert.equal((await call(776, [owner, expected.length, 512])).value, 0xffffffff);
      await call(778, [owner]);
    }
    await call(743, [owner]);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed SDK .23 large legal genre ranges visit only occupied question keys and cold restore their current configuration', async () => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    owner = [0x13, 64],
    steps = [
      [744, [owner, 256], 80],
      [750, [owner, 512], 84],
      [751, [owner, 768], 88],
      [764, [owner]],
      [776, [owner, 0, 1024], 92],
      [776, [owner, 1, 1088], 96],
      [776, [owner, 2, 1152], 100],
      [765, [owner], 104],
    ],
    program = kcsProgram(
      [
        [43, 742, 0],
        [38, 64],
        ...steps.flatMap(([id, args, at]) => [
          ...args.map((argument) => [37, argument]),
          [43, id, args.length * 4],
          ...(at === undefined ? [] : [[38, at]]),
        ]),
        [59],
      ],
      [
        [256, 'questions'],
        [512, 'wide'],
        [768, 'wide'],
      ],
    ),
    files = Object.fromEntries(contentFiles());
  files.wide = encodeCP932('#wide\n$GEN\nGENRE_A 0-2147483647\nGENRE_B @\nGENRE_C @\n');
  const first = await dataWorld(profile, { ...files, 'case.kcs': program });
  let fresh;
  try {
    assert.equal((await first.runtime.scheduler.execute(first.main)).status, 'halted');
    const machine = first.main.machine,
      handle = machine.load(64),
      table = first.runtime.handles.get(handle, 'content-database').data;
    assert.deepEqual(
      [80, 84, 88, 92, 96, 100].map((at) => machine.load(at)),
      [1, 1, 1, 12, 11, 22],
    );
    assert.deepEqual(table.configuration.genres[0], [{ first: 0, last: 2147483647 }]);
    assert.equal(table.pool.length, 3);
    assert.ok(checkpointBytes(table.snapshot()) < 50000);
    fresh = await dataWorld(profile, { 'case.kcs': program }, { initialize: false });
    await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(first.snapshot())));
    const restored = fresh.runtime.handles.get(handle, 'content-database').data;
    assert.deepEqual(restored.snapshot(), table.snapshot());
    assert.notEqual(restored.pool[0], table.pool[0]);
    assert.equal(restored.pool[0], restored.files.get('QUESTIONS').get(restored.pool[0].id));
    const call = (id, args) =>
      fresh.runtime.native('main', id, args, fresh.main.machine, fresh.main);
    await call(764, [handle]);
    assert.equal((await call(776, [handle, 0, 1024])).value, 12);
    assert.equal((await call(745, [handle])).value, 3);
    await call(743, [handle]);
  } finally {
    await fresh?.close({ flushFiles: false });
    await first.close({ flushFiles: false });
  }
});
