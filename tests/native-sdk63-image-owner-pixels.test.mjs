// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk63-image-owner-pixels.json', import.meta.url)),
  ),
  names = [...new Set(golden.cases.flatMap((row) => (row.save ? [row.save] : [])))],
  referenceAt = (name) => 2048 + names.indexOf(name) * 4,
  resultAt = 2304,
  code = (rows) =>
    kcsProgram(
      rows
        .flatMap((row) => [
          ...row.args.map((arg) => [37, typeof arg === 'string' ? [0x13, referenceAt(arg)] : arg]),
          [43, row.id, row.args.length * 4],
          ...(row.control === 1 ? [[38, row.save ? referenceAt(row.save) : resultAt]] : []),
          [37, 3968],
          [43, 71, 4],
          [38, 2360],
        ])
        .concat([[59]]),
    ),
  files = Object.fromEntries(
    Object.entries(golden.resources).map(([name, base64]) => [name, Buffer.from(base64, 'base64')]),
  );
files['owner63.kcs'] = code(golden.cases);

files['empty63.kcs'] = kcsProgram([[59]]);
const make = (initialize = true) => dataWorld(golden.profile, files, { initialize });
async function closeWorld(world) {
  for (const task of world.runtime.scheduler.tasks.values())
    world.runtime.scheduler.cancel(task.id, false);
  await world.close({ flushFiles: false });
}
function prepare(machine, row) {
  if (row.text)
    machine.bytes(64, encodeCP932(row.text).length + 1).set([...encodeCP932(row.text), 0]);
  for (const output of row.outputs ?? []) machine.bytes(output.at, output.bytes.length).fill(0xa5);
}
async function compare(world, task, row, label) {
  for (const expected of row.state) {
    const handle = task.machine.load(referenceAt(expected.name)),
      record = world.imageOwners.get(handle),
      bitmap = world.graphics.images.get(record.bitmap),
      s = bitmap.state,
      rgba = await bitmap.pixels(),
      physical = new Uint8Array(expected.pitch * expected.height);
    for (let y = 0; y < expected.height; y++)
      for (let x = 0; x < expected.width; x++) {
        const at = ((expected.height - y - 1) * expected.width + x) * 4,
          out = y * expected.pitch + x * expected.bpp;
        physical.set(
          [rgba[at + 2], rgba[at + 1], rgba[at], ...(expected.bpp === 4 ? [rgba[at + 3]] : [])],
          out,
        );
      }
    assert.equal(record.owner, task.id, label + ' Script owner');
    assert.deepEqual(
      record.info.map((v) => v >>> 0),
      expected.info,
      label + ' owner info ' + expected.name,
    );
    assert.equal(record.layers?.length ?? null, expected.layers, label + ' layers');
    assert.deepEqual(
      [bitmap.width, bitmap.height, s.bpp],
      [expected.width, expected.height, expected.bpp],
      label + ' geometry',
    );
    assert.deepEqual([...physical], expected.physicalPixels, label + ' pixels ' + expected.name);
    assert.deepEqual(
      Object.fromEntries(Object.keys(expected.metadata).map((key) => [key, (s[key] ?? 0) >>> 0])),
      expected.metadata,
      label + ' metadata ' + expected.name,
    );
    assert.deepEqual(
      s.clip.map((v) => v >>> 0),
      expected.clip,
      label + ' clip',
    );
    const aliases = [...world.runtime.handles.records.values()].filter(
      (r) => r.type === 'bitmap' && r.value.dataHandle === bitmap.dataHandle,
    ).length;
    assert.equal(aliases, expected.bitmapReferences, label + ' data references');
    assert.equal(expected.wrapperReferences, 1, 'normal unretained original bitmap wrapper');
  }
  const actualOwners = [...world.runtime.handles.records].filter(
      ([, r]) => r.type === 'image-owner' && r.value.owner === task.id,
    ),
    actualNames = actualOwners.map(([handle]) =>
      names.find((name) => task.machine.load(referenceAt(name)) === handle),
    );
  assert.equal(actualOwners.length, row.automaticOwners.count, label + ' automatic count');
  // Logical handle records are inserted in the same actual Script-list order.
  assert.deepEqual(actualNames, row.automaticOwners.owners, label + ' automatic owner order');
  for (const output of row.outputs)
    assert.deepEqual(
      [...task.machine.bytes(output.at, output.bytes.length)],
      output.bytes,
      label + ' output',
    );
  if (row.control === 1 && !row.save)
    assert.equal(task.machine.load(resultAt), row.result >>> 0, label + ' result');
  if (row.close)
    assert.equal(
      world.runtime.handles.records.has(task.machine.load(referenceAt(row.close))),
      false,
      label + ' release',
    );
}
const coldAfter = new Set([0, 8, 10, 11, 19, 25, 26, 35]);
test('SDK63 loaded image-owner pixels match own full Script GCALLs, automatic owners and eight cold continuations', async (t) => {
  const world = await make();
  t.after(() => closeWorld(world));
  const task = await world.spawnScript('owner63.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    floor = task.machine.sp;
  let next = 0,
    cold = 0;
  const native = world.runtime.native;
  world.runtime.native = async function (table, id, args, machine, owner, ...rest) {
    if (id === 71) return Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]);
    const row = golden.cases[next];
    assert.equal(id, row.id);
    prepare(machine, row);
    const before = machine.memory.slice(),
      reply = await Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]);
    const extra = [];
    for (let at = 0; at < before.length; at++)
      if (
        before[at] !== machine.memory[at] &&
        !(row.outputs ?? []).some((o) => at >= o.at && at < o.at + o.bytes.length)
      )
        extra.push(at);
    assert.deepEqual(extra, row.unexpectedMemoryWrites, 'Main' + id + ' non-output bytes');
    assert.equal(reply.control, row.control, 'Main' + id + ' control');
    if (row.control === 2) assert.equal(reply.value, undefined);
    next++;
    return reply;
  };
  for (const [index, row] of golden.cases.entries()) {
    if (!index) assert.equal((await world.runtime.scheduler.execute(task)).status, 'waiting');
    else assert.equal((await world.runtime.scheduler.send(task.id, [1, 2, 3, 4])).accepted, true);
    assert.equal(task.machine.waiting?.kind, 'message');
    assert.equal(task.machine.sp, floor);
    assert.equal(next, index + 1);
    await compare(world, task, row, 'frame' + index + ' Main' + row.id);
    if (coldAfter.has(index)) {
      const fresh = await make(false);
      try {
        await fresh.restore(
          await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
        );
        const restored = fresh.runtime.scheduler.tasks.get(task.id);
        await compare(fresh, restored, row, 'cold' + index);
        const following = golden.cases[index + 1],
          original = fresh.runtime.native;
        fresh.runtime.native = async function (table, id, args, machine, owner, ...rest) {
          if (id !== 71) {
            assert.equal(id, following.id);
            prepare(machine, following);
          }
          return Reflect.apply(original, this, [table, id, args, machine, owner, ...rest]);
        };
        assert.equal((await fresh.runtime.scheduler.send(task.id, [1, 2, 3, 4])).accepted, true);
        await compare(fresh, restored, following, 'cold continuation' + index);
        cold++;
      } finally {
        await closeWorld(fresh);
      }
    }
  }
  world.runtime.native = native;
  assert.equal(cold, 8);
  assert.equal((await world.runtime.scheduler.send(task.id, [1, 2, 3, 4])).accepted, true);
  assert.equal(task.machine.halted, true);
});
test('SDK63 protects the original unwritten image-alpha result', async (t) => {
  const world = await make();
  t.after(() => closeWorld(world));
  const task = await world.spawnScript('empty63.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  await assert.rejects(
    world.runtime.native('main', 721, [0], task.machine, task),
    /requires an owner bitmap/,
  );
});

test('SDK63 mask1 RGBA-to-RGB keeps the target pixels through the real complete KCS wrapper', async (t) => {
  const world = await dataWorld(golden.profile, { ...files, 'mask63.kcs': code(golden.maskCases) });
  t.after(() => closeWorld(world));
  const task = await world.spawnScript('mask63.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    native = world.runtime.native;
  let next = 0;
  world.runtime.native = async function (table, id, args, machine, owner, ...rest) {
    if (id === 71) return Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]);
    const row = golden.maskCases[next++];
    assert.equal(id, row.id);
    prepare(machine, row);
    const before = machine.memory.slice(),
      reply = await Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]),
      extra = [];
    for (let at = 0; at < before.length; at++)
      if (
        before[at] !== machine.memory[at] &&
        !row.outputs.some((o) => at >= o.at && at < o.at + o.bytes.length)
      )
        extra.push(at);
    assert.deepEqual(extra, row.unexpectedMemoryWrites);
    assert.equal(reply.control, row.control);
    return reply;
  };
  for (const [index, row] of golden.maskCases.entries()) {
    if (index) await world.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
    else await world.runtime.scheduler.execute(task);
    await compare(world, task, row, 'mask frame' + index);
  }
  assert.equal(next, 6);
  world.runtime.native = native;
});
