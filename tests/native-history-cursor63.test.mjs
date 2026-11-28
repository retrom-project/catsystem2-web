// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { cursor63Scenes, cursor63Resources } from './fixtures/history-cursor63-inputs.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
  await readFile(
    new URL('./fixtures/native-history-cursor63-golden.json', import.meta.url),
    'utf8',
  ),
);
const profile = 'rebellions-jp-engine-2.6.1.63';
async function makeWorld(options) {
  const world = await dataWorld(profile, files, options);
  // This resource-only provider supplies the original scene category suffix.
  // The original protocol independently uses real Settings/FileServer mounts.
  world.game.readCategory = (name, category) =>
    world.game.read(category === 'scene' && !name.endsWith('.cst') ? name + '.cst' : name);
  return world;
}
const referenceNames = [
  ...new Set(golden.cases.flatMap((row) => row.args.filter((arg) => typeof arg === 'string'))),
];
const referenceAt = (name) => 2048 + referenceNames.indexOf(name) * 4;
const files = Object.fromEntries(
  [...cursor63Scenes].map(([name, bytes]) => [name + '.cst', bytes]),
);
for (const [index, row] of golden.cases.entries()) {
  const args = row.args.map((arg) => (typeof arg === 'string' ? [0x13, referenceAt(arg)] : arg));
  files['cursor-' + index + '.kcs'] = kcsProgram(
    [
      ...args.map((arg) => [37, arg]),
      [43, row.id, args.length * 4],
      ...(row.control === 1 ? [[38, 2112]] : []),
      [59],
    ],
    row.text ? [[64, row.text]] : [],
  );
}

function cursorState(world, refs, live) {
  return [...live].map((name) => {
    const cursor = world.runtime.handles.get(refs.get(name), 'history-cursor');
    return {
      name,
      capacity: cursor.capacity,
      lastPath: cursor.lastPath,
      rows: Array.from({ length: cursor.capacity }, (_, index) => {
        // A sparse absent row is the initialized empty native reader slot. Do not
        // materialize a JS reader or change the cursor while observing it.
        const row = cursor.row(index, false);
        return row
          ? {
              path: row.path,
              block: row.block,
              lastBlock: row.lastBlock,
              readerPresent: !!row.reader,
              valid: Number(row.valid),
            }
          : { path: -1, block: -1, lastBlock: -1, readerPresent: true, valid: 0 };
      }),
    };
  });
}

const coldAfter = new Set([1, 3, 13, 17, 23, 28, 32, 34]);
test('63 actual World KCS callers match thirty own Cursor GCALLs, seven Scene dependencies and eight independent cold restores', async (t) => {
  assert.equal(profile, golden.profile);
  for (const [name, bytes] of cursor63Resources()) {
    const expected = golden.original.resources.find((row) => row.name === name);
    assert.equal(bytes.length, expected.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
  }
  const world = await makeWorld(),
    id = await world.objects.create({ kind: 12, nativeID: 73, parent: world.root }),
    record = world.objects.objects.get(id),
    refs = new Map(),
    live = new Set();
  t.after(() => world.close({ flushFiles: false }));
  let coldCount = 0;
  for (const [index, row] of golden.cases.entries()) {
    await record.implementation.loadScript('cursor-' + index + '.kcs');
    const task = world.runtime.scheduler.tasks.get(id),
      m = task.machine;
    for (const [name, value] of refs) m.store(referenceAt(name), value);
    for (const output of row.outputs) m.bytes(output.at, output.bytes.length).fill(0xa5);
    let trace;
    const original = world.runtime.native;
    world.runtime.native = async function (table, entry, args, machine, owner, ...rest) {
      const before = machine.memory.slice(),
        reply = await Reflect.apply(original, this, [table, entry, args, machine, owner, ...rest]);
      assert.equal(entry, row.id);
      const changed = [];
      for (let at = 0; at < before.length; at++)
        if (before[at] !== machine.memory[at]) changed.push(at);
      assert.deepEqual(
        changed.filter(
          (at) =>
            !row.outputs.some((output) => at >= output.at && at < output.at + output.bytes.length),
        ),
        row.unexpectedMemoryWrites,
        row.label + ' extra memory writes',
      );
      trace = reply;
      return reply;
    };
    const floor = m.sp;
    try {
      assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    } finally {
      world.runtime.native = original;
    }
    assert.equal(m.sp, floor, row.label + ' stack');
    assert.equal(trace.control, row.control, row.label + ' control');
    if (row.save) {
      assert.equal(m.load(2112), trace.value);
      assert(trace.value);
      refs.set(row.save, trace.value);
      if (row.id === 379) live.add(row.save);
    } else if (row.control === 1)
      assert.equal(m.load(2112), row.result >>> 0, row.label + ' result');
    else assert.equal(trace.value, undefined, row.label + ' no result write');
    if (row.id === 380) {
      live.delete(row.args[0]);
      assert.throws(
        () => world.runtime.handles.get(refs.get(row.args[0]), 'history-cursor'),
        /released/,
      );
      assert.doesNotThrow(() =>
        world.runtime.handles.get(
          refs.get(row.args[0] === 'emptyOne' || row.args[0] === 'zero' ? 'empty' : 'scene'),
          'scene-data',
        ),
      );
    }
    for (const output of row.outputs)
      assert.deepEqual(
        Array.from(m.bytes(output.at, output.bytes.length)),
        output.bytes,
        row.label + ' output',
      );
    assert.deepEqual(cursorState(world, refs, live), row.state, row.label + ' owner state');
    if (coldAfter.has(index)) {
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
        fresh = await makeWorld({ initialize: false });
      try {
        await fresh.restore(state);
        assert.deepEqual(cursorState(fresh, refs, live), row.state, row.label + ' fresh state');
        for (const name of live) {
          const handle = refs.get(name),
            cursor = fresh.runtime.handles.get(handle, 'history-cursor'),
            machine = fresh.runtime.scheduler.tasks.get(id).machine;
          assert.notEqual(cursor, world.runtime.handles.get(handle, 'history-cursor'));
          if (!cursor.capacity) continue;
          machine.bytes(768, 8).fill(0xa5);
          const reply = await fresh.runtime.native(
            'main',
            384,
            [handle, 0, 768, 772],
            machine,
            fresh.runtime.scheduler.tasks.get(id),
          );
          assert.equal(
            reply.value,
            Number(!!row.state.find((entry) => entry.name === name).rows[0].valid),
          );
          if (!reply.value) assert.deepEqual(machine.bytes(768, 8), new Uint8Array(8).fill(0xa5));
        }
        coldCount++;
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  assert.equal(coldCount, 8);
  assert.equal(live.size, 0);
  for (let id = 379; id <= 384; id++)
    assert.equal(nativeABI(profile).tables.main.entries[id].status, 'recovered');
  assert.equal(nativeABI(profile).tables.main.entries[688].status, 'unknown');
});

test('63 native CSS history reconstructs a fresh cursor through independent GAME_SAVE storage', async (t) => {
  const handle = (at) => [0x13, at],
    program = (rows, strings) =>
      kcsProgram(
        [
          ...rows.flatMap(([id, args, at]) => [
            ...args.map((arg) => [37, arg]),
            [43, id, args.length * 4],
            ...(at === undefined ? [] : [[38, at]]),
          ]),
          [59],
        ],
        strings,
      ),
    source = handle(2048),
    file = handle(2052),
    cursor = handle(2056);
  files['save-cursor.kcs'] = program(
    [
      [323, [], 2048],
      [329, [source, 64, 3], 2100],
      [329, [source, 96, 2], 2104],
      [329, [source, 128, 1], 2108],
      [238, [17], 2052],
      [385, [file, 101, source, 1, 1], 2112],
      [245, [file, 160], 2116],
    ],
    [
      [64, 'a'],
      [96, 'b'],
      [128, '日本'],
      [160, 'save0001.dat'],
    ],
  );
  files['load-cursor.kcs'] = program(
    [
      [247, [160], 2052],
      [323, [], 2048],
      [386, [file, 101, source, 1], 2112],
      [379, [source, 1], 2056],
      [382, [cursor, 0, 256, 384], 2116],
      [380, [cursor]],
      [324, [source]],
    ],
    [[160, 'save0001.dat']],
  );
  const storage = new NativeFileStorage(
      { lookup: () => null, read: async () => null },
      'cursor63-save',
    ),
    initial = new NativeGlobalFile(17);
  initial.write(999, Uint8Array.of(1));
  await storage.prepareGameSave([
    {
      path: 'save0001.dat',
      bytes: await initial.file(),
      createdMs: 1700000000000,
      accessedMs: 1700000001000,
      modifiedMs: 1700000002000,
      attributes: 0x80,
    },
  ]);
  const world = await makeWorld({ storage });
  t.after(() => world.close({ flushFiles: false }));
  const run = async (target, name) => {
      const id = await target.objects.create({ kind: 12, nativeID: 73, parent: target.root });
      await target.objects.objects.get(id).implementation.loadScript(name);
      const task = target.runtime.scheduler.tasks.get(id);
      assert.equal((await target.runtime.scheduler.execute(task)).status, 'halted');
      return task.machine;
    },
    m = await run(world, 'save-cursor.kcs'),
    exported = storage.exportGameSave();
  assert.deepEqual(
    [2100, 2104, 2108, 2112, 2116].map((at) => m.load(at)),
    [1, 1, 1, 1, 1],
  );
  assert.equal(exported.files.length, 1);
  assert.equal(exported.files[0].path, 'save0001.dat');
  const native = await NativeGlobalFile.fromFile(exported.files[0].bytes);
  assert.deepEqual(
    native.payload(),
    world.runtime.handles.get(m.load(2052), 'global-file').payload(),
  );
  const coldStorage = new NativeFileStorage(
    { lookup: () => null, read: async () => null },
    'cursor63-cold',
  );
  await coldStorage.prepareGameSave(exported.files);
  const fresh = await makeWorld({ storage: coldStorage });
  t.after(() => fresh.close({ flushFiles: false }));
  const cold = await run(fresh, 'load-cursor.kcs');
  assert.deepEqual([cold.load(2112), cold.load(2116)], [1, 1]);
  assert.equal(cold.string(256), '日本の文');
  assert.equal(cold.string(384), '名前');
  assert.throws(() => fresh.runtime.handles.get(cold.load(2056), 'history-cursor'), /released/);
});
