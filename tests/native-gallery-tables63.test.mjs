// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { gallery63Tables, gallery63Resources } from './fixtures/gallery-tables63-inputs.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(
      new URL('./fixtures/native-gallery-tables63-golden.json', import.meta.url),
      'utf8',
    ),
  ),
  profile = golden.profile,
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  referenceNames = [
    ...new Set(golden.cases.flatMap((row) => row.args.filter((arg) => typeof arg === 'string'))),
  ],
  referenceAt = (name) => 2048 + referenceNames.indexOf(name) * 4,
  files = Object.fromEntries(gallery63Tables());
for (const [index, row] of golden.cases.entries()) {
  const args = row.args.map((arg) => (typeof arg === 'string' ? [0x13, referenceAt(arg)] : arg));
  files['table-' + index + '.kcs'] = kcsProgram(
    [
      ...args.map((arg) => [37, arg]),
      [43, row.id, args.length * 4],
      ...(row.control === 1 ? [[38, 2112]] : []),
      [59],
    ],
    row.text ? [[64, row.text]] : [],
  );
}
async function makeWorld(options) {
  const world = await dataWorld(profile, files, options);
  world.game.readCategory = (name, category) =>
    world.game.read(category === 'fes' && !name.endsWith('.tbl') ? name + '.tbl' : name);
  return world;
}
function tableState(world, refs, live) {
  return [...live].map((name) => {
    const table = world.runtime.handles.get(refs.get(name), 'gallery-table');
    return {
      name,
      kind: table.kind,
      dataPresent: !!table.bytes.length,
      count: table.count,
      bytes: table.bytes.length,
      sha256: sha(table.bytes),
    };
  });
}
const coldAfter = new Set([1, 13, 16, 23, 24, 28, 29, 36]);
test('63 twelve gallery entry points match forty own GCALLs and eight independent World cold restores', async (t) => {
  for (const [name, bytes] of gallery63Resources()) {
    const expected = golden.original.resources.find((row) => row.name === name);
    assert.equal(bytes.length, expected.bytes);
    assert.equal(sha(bytes), expected.sha256);
  }
  const world = await makeWorld(),
    id = await world.objects.create({ kind: 12, nativeID: 73, parent: world.root }),
    record = world.objects.objects.get(id),
    refs = new Map(),
    live = new Set();
  t.after(() => world.close({ flushFiles: false }));
  let coldCount = 0;
  for (const [index, row] of golden.cases.entries()) {
    await record.implementation.loadScript('table-' + index + '.kcs');
    const task = world.runtime.scheduler.tasks.get(id),
      m = task.machine;
    for (const [name, value] of refs) m.store(referenceAt(name), value);
    for (const output of row.outputs) m.bytes(output.at, output.bytes.length).fill(0xa5);
    const native = world.runtime.native;
    let trace;
    world.runtime.native = async function (table, entry, args, machine, owner, ...rest) {
      const before = machine.memory.slice(),
        reply = await Reflect.apply(native, this, [table, entry, args, machine, owner, ...rest]);
      assert.equal(entry, row.id);
      const extra = [];
      for (let at = 0; at < before.length; at++)
        if (
          before[at] !== machine.memory[at] &&
          !row.outputs.some((output) => at >= output.at && at < output.at + output.bytes.length)
        )
          extra.push(at);
      assert.deepEqual(extra, row.unexpectedMemoryWrites, row.label + ' extra VM writes');
      trace = reply;
      return reply;
    };
    const floor = m.sp;
    try {
      assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    } finally {
      world.runtime.native = native;
    }
    assert.equal(m.sp, floor, row.label + ' stack');
    assert.equal(trace.control, row.control, row.label + ' control');
    if (row.save) {
      assert(trace.value);
      assert.equal(m.load(2112), trace.value);
      refs.set(row.save, trace.value);
      live.add(row.save);
    } else if (row.control === 1)
      assert.equal(m.load(2112), row.result >>> 0, row.label + ' result');
    else {
      assert.equal(trace.value, undefined);
      live.delete(row.args[0]);
      assert.throws(
        () => world.runtime.handles.get(refs.get(row.args[0]), 'gallery-table'),
        /released/,
      );
    }
    for (const output of row.outputs)
      assert.deepEqual(
        [...m.bytes(output.at, output.bytes.length)],
        output.bytes,
        row.label + ' exact output/terminator/sentinel',
      );
    assert.deepEqual(tableState(world, refs, live), row.state, row.label + ' owned bytes');
    if (coldAfter.has(index)) {
      const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
        fresh = await makeWorld({ initialize: false });
      try {
        const readCategory = fresh.game.readCategory;
        fresh.game.readCategory = (name, category) => {
          if (category === 'fes') throw new Error('Cold Gallery must retain loaded table bytes');
          return readCategory(name, category);
        };
        await fresh.restore(state);
        for (const [name, handle] of refs)
          if (!live.has(name))
            assert.throws(() => fresh.runtime.handles.get(handle, 'gallery-table'), /released/);
        assert.deepEqual(tableState(fresh, refs, live), row.state, row.label + ' cold bytes');
        const task = fresh.runtime.scheduler.tasks.get(id),
          machine = task.machine;
        for (const name of live) {
          const handle = refs.get(name),
            table = fresh.runtime.handles.get(handle, 'gallery-table'),
            before = world.runtime.handles.get(handle, 'gallery-table');
          assert.notEqual(table, before);
          assert.notEqual(table.bytes, before.bytes);
          const reply = await fresh.runtime.native(
            'main',
            table.kind === 'variants' ? 407 : 414,
            [handle],
            machine,
            task,
          );
          assert.equal(reply.value, row.state.find((entry) => entry.name === name).count);
          machine.bytes(256, 160).fill(0xa5);
          const query =
              table.kind === 'variants'
                ? [411, [handle, 0, 0, 0, 0, 256]]
                : [416, [handle, 0, 0, 256]],
            text = await fresh.runtime.native('main', query[0], query[1], machine, task);
          const expected = golden.cases.find(
            (entry) =>
              entry.label ===
              (table.kind === 'variants' ? 'first reference' : 'first ordered name'),
          ).outputs[0].bytes;
          assert.deepEqual(
            [...machine.bytes(256, 160)],
            table.count ? expected : new Array(160).fill(0xa5),
          );
          assert.equal(text.value, table.count ? 1 : 0);
        }
        coldCount++;
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  assert.equal(coldCount, 8);
  assert.equal(live.size, 0);
  for (let id = 405; id <= 416; id++)
    assert.equal(nativeABI(profile).tables.main.entries[id].status, 'recovered');
  assert.equal(nativeABI(profile).tables.main.entries[391].status, 'unknown');
});
