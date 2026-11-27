// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { SaveSlotFiles } from './fixtures/save-slot-files.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-frame-counter.json', import.meta.url)),
  ),
  profile = golden.profile,
  marker = 0x23442443,
  program = kcsProgram([
    [37, marker],
    [43, 443, 0],
    [38, 64],
    [43, 442, 0],
    [43, 443, 0],
    [38, 68],
    [43, 65, 0],
    [43, 443, 0],
    [38, 72],
    [43, 65, 0],
    [43, 443, 0],
    [38, 76],
    [43, 65, 0],
    [43, 443, 0],
    [38, 80],
    [59],
  ]);
const loaded = (at) => [0x13, at];
const call = (id, ...args) => [...args.map((word) => [37, word]), [43, id, args.length * 4]];
async function dispatch(world) {
  assert.equal(await world.resumeHostFrameWait(world.beginHostFrameWait()), true);
  world.completeHostFrame();
}

test('real paced KCS reset/query, mode0, inactivity, completion and reload match original owned Script rows', async () => {
  assert.equal(createHash('sha256').update(program).digest('hex'), golden.programSHA256);
  let timer = 0;
  const world = await dataWorld(
    profile,
    {
      'case.kcs': program,
      'reload.kcs': kcsProgram([...call(143, loaded(32), 256, 0), [59]], [[256, 'case.kcs']]),
      'new.kcs': kcsProgram(
        [...call(66, 12, 3, 256), [38, 32], ...call(143, loaded(32), 320, 0), [59]],
        [
          [256, 'Independent Script'],
          [320, 'case.kcs'],
        ],
      ),
    },
    { frameSource: { now: () => timer } },
  );
  try {
    const main = world.main,
      record = world.objects.objects.get(main.id),
      compare = (index, task = world.main) => {
        const row = golden.rows[index],
          current = world.objects.objects.get(task.id);
        assert.equal(current.scriptUpdateAccumulator, row.counter, row.label);
        assert.equal(current.scriptEnabled, row.active, row.label);
        assert.equal(task.machine.load(task.machine.fp), marker, row.label + ' stack marker');
        return row;
      };
    timer = 17;
    await dispatch(world);
    compare(0);
    assert.deepEqual([main.machine.load(64), main.machine.load(68)], golden.rows[0].queries);
    timer = 100;
    await dispatch(world);
    compare(1);
    assert.equal(main.machine.load(72), golden.rows[1].queries[0]);
    await world.sendEngine(main.id, main.id, 161, world.nativeTaskID(main.id), 0);
    const pc = main.machine.pc;
    timer = 117;
    await dispatch(world);
    compare(2);
    assert.equal(main.machine.pc, pc);
    await world.sendEngine(main.id, main.id, 162, 0, 0);
    timer = 134;
    await dispatch(world);
    compare(3);
    assert.equal(main.machine.pc, pc);
    await world.sendEngine(main.id, main.id, 161, 0, 1);
    timer = 150;
    await dispatch(world);
    compare(4);
    assert.equal(main.machine.load(76), golden.rows[4].queries[0]);
    timer = 167;
    await dispatch(world);
    compare(5);
    assert.equal(main.machine.load(80), golden.rows[5].queries[0]);
    const loader = await world.spawnScript('reload.kcs');
    loader.machine.store(32, world.nativeTaskID(main.id));
    await world.runtime.scheduler.execute(loader);
    assert.equal(record.scriptUpdateAccumulator, 4);
    assert.strictEqual(world.main, world.runtime.scheduler.tasks.get(main.id));
    assert.notStrictEqual(world.main, main);
    timer = 184;
    await dispatch(world);
    compare(6);
    assert.deepEqual(
      [world.main.machine.load(64), world.main.machine.load(68)],
      golden.rows[6].queries,
    );
    const creator = await world.spawnScript('new.kcs');
    await world.runtime.scheduler.execute(creator);
    const other = world.runtime.scheduler.tasks.get(
      world.resolveTaskID(creator.machine.load(32), creator.id),
    );
    timer = 200;
    await dispatch(world);
    compare(7, other);
    assert.deepEqual([other.machine.load(64), other.machine.load(68)], golden.rows[7].queries);
    assert.notEqual(other.machine.memory.buffer, world.main.machine.memory.buffer);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('only SDK23 enables the two controls and unqualified updates never acquire a synthetic raw step', async () => {
  for (const other of [
    'rebellions-jp-engine-2.6.1.63',
    'bokutomo-engine-2.6.1.67',
    'sdk-4.01-engine-2.6.1.74',
    'nekopara-vol3-engine-2.6.1.76',
  ])
    for (const id of [442, 443])
      assert.equal(nativeABI(other).tables.main.entries[id].status, 'unknown');
  const world = await dataWorld(
    profile,
    { 'case.kcs': kcsProgram([[43, 443, 0], [59]]) },
    { initialize: false },
  );
  try {
    await assert.rejects(world.initialize('case.kcs'), /observed update source/);
    const record = world.objects.objects.get(world.main.id);
    assert.equal(record.scriptUpdateAccumulatorKnown, false);
    assert.equal(record.scriptUpdateAccumulator, 0);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('current independent cold preserves exact u32 arithmetic and private accumulator identity', async () => {
  let timer = 0,
    restoredTimer = 1000;
  const files = { 'case.kcs': kcsProgram([[43, 443, 0], [38, 64], [43, 65, 0], [59]]) },
    world = await dataWorld(profile, files, { frameSource: { now: () => timer } }),
    fresh = await dataWorld(profile, files, {
      initialize: false,
      frameSource: { now: () => restoredTimer },
    });
  try {
    const state = world.snapshot(),
      record = state.objects.objects.find((r) => r.id === world.main.id);
    record.scriptUpdateAccumulator = 0xfffffffc;
    state.framePacer.pendingStep = 0;
    await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(state)));
    restoredTimer = 1017;
    await dispatch(fresh);
    assert.equal(fresh.main.machine.load(64), 0x3ffffffb);
    assert.equal(world.objects.objects.get(world.main.id).scriptUpdateAccumulator, 0);
    const saved = fresh.snapshot(),
      coldRecord = saved.objects.objects.find((r) => r.id === fresh.main.id);
    coldRecord.scriptUpdateAccumulator = 3;
    saved.framePacer.pendingStep = 0xffffffff;
    await fresh.close({ flushFiles: false });
    const next = await dataWorld(profile, files, {
      initialize: false,
      frameSource: { now: () => restoredTimer },
    });
    try {
      await next.restore(saved);
      restoredTimer += 17;
      await dispatch(next);
      assert.equal(next.objects.objects.get(next.main.id).scriptUpdateAccumulator, 2);
    } finally {
      await next.close({ flushFiles: false });
    }
  } finally {
    await fresh.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
});

test('GAME_SAVE transports only explicit CSS records while a fresh Script keeps constructor clock state', async () => {
  const storage = new SaveSlotFiles(),
    files = {
      'case.kcs': kcsProgram(
        Array.from({ length: 8 }, () => [
          [43, 443, 0],
          [38, 64],
          [43, 65, 0],
        ]).flat(),
      ),
      'save.kcs': kcsProgram(
        [
          [37, 0x31415926],
          [38, 256],
          ...call(238, 17),
          [38, 32],
          ...call(244, loaded(32), 17, 4, 256),
          ...call(245, loaded(32), 512),
          [59],
        ],
        [[512, 'save1234.dat']],
      ),
      'load.kcs': kcsProgram(
        [...call(247, 512), [38, 32], ...call(254, loaded(32), 17, 256, 4), [59]],
        [[512, 'save1234.dat']],
      ),
    };
  let timer = 0,
    otherTimer = 1000;
  const first = await dataWorld(profile, files, { storage, frameSource: { now: () => timer } });
  let fresh;
  try {
    for (const value of [17, 34, 51]) {
      timer = value;
      await dispatch(first);
    }
    assert.equal(first.objects.objects.get(first.main.id).scriptUpdateAccumulator, 2);
    const writer = await first.spawnScript('save.kcs');
    await first.runtime.scheduler.execute(writer);
    const bytes = await storage.read('save1234.dat'),
      file = await NativeGlobalFile.fromFile(bytes);
    assert.equal(file.records.length, 1);
    assert.equal(file.records[0].id, 17);
    assert.deepEqual(file.records[0].bytes, Uint8Array.of(0x26, 0x59, 0x41, 0x31));
    await first.close({ flushFiles: false });
    fresh = await dataWorld(profile, files, { storage, frameSource: { now: () => otherTimer } });
    const reader = await fresh.spawnScript('load.kcs');
    await fresh.runtime.scheduler.execute(reader);
    assert.equal(reader.machine.load(256), 0x31415926);
    assert.deepEqual(await storage.read('save1234.dat'), bytes);
    assert.equal(fresh.objects.objects.get(fresh.main.id).scriptUpdateAccumulator, 0);
    otherTimer = 1017;
    await dispatch(fresh);
    assert.equal(fresh.main.machine.load(64), 0);
  } finally {
    await fresh?.close({ flushFiles: false });
    await first.close({ flushFiles: false });
  }
});

test('successful Main143 keeps the main alias on the live scheduler owner across all current SDKs', async () => {
  for (const current of [
    profile,
    'rebellions-jp-engine-2.6.1.63',
    'bokutomo-engine-2.6.1.67',
    'sdk-4.01-engine-2.6.1.74',
    'nekopara-vol3-engine-2.6.1.76',
  ]) {
    const world = await dataWorld(current, {
      'case.kcs': kcsProgram([[37, 240], [43, 71, 4], [59]]),
      'loader.kcs': kcsProgram([...call(143, loaded(32), 256, 0), [59]], [[256, 'case.kcs']]),
    });
    try {
      const previous = world.main,
        owner = world.objects.objects.get(previous.id),
        loader = await world.spawnScript('loader.kcs');
      loader.machine.store(32, world.nativeTaskID(previous.id));
      await world.runtime.scheduler.execute(loader);
      assert.strictEqual(world.main, world.runtime.scheduler.tasks.get(previous.id), current);
      assert.strictEqual(world.objects.objects.get(previous.id), owner, current);
      assert.notStrictEqual(world.main, previous, current);
      assert.notStrictEqual(
        world.main.machine.memory.buffer,
        previous.machine.memory.buffer,
        current,
      );
      await world.tick();
      assert.equal(world.main.machine.halted, false, current);
    } finally {
      await world.close({ flushFiles: false });
    }
  }
});
