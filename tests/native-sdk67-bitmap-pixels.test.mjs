// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk67-bitmap-pixels.json', import.meta.url), 'utf8'),
  ),
  sourceAt = 2048,
  targetAt = 2052,
  resultAt = 2112,
  waitAt = 3968,
  referenceAt = (name) => (name === 'source' ? sourceAt : targetAt),
  program = kcsProgram(
    golden.cases
      .flatMap((row) => [
        ...row.args.map((arg) => [37, typeof arg === 'string' ? [0x13, referenceAt(arg)] : arg]),
        [43, row.id, row.args.length * 4],
        ...(row.control === 1 ? [[38, row.save ? referenceAt(row.save) : resultAt]] : []),
        [37, waitAt],
        [43, 71, 4],
        [38, 2140],
      ])
      .concat([[59]]),
    [[64, golden.resource.name]],
  ),
  files = {
    [golden.resource.name]: Buffer.from(golden.resource.base64, 'base64'),
    'bitmap67.kcs': program,
  };
const make = (initialize = true) => dataWorld(golden.profile, files, { initialize });
async function closeWorld(world) {
  for (const task of world.runtime.scheduler.tasks.values())
    world.runtime.scheduler.cancel(task.id, false);
  await world.close({ flushFiles: false });
}
async function state(world, task, row) {
  const result = [];
  for (const expected of row.state) {
    const handle = task.machine.load(referenceAt(expected.name)),
      bitmap = world.graphics.images.get(handle),
      s = bitmap.state,
      pixels = expected.pixelsKnown ? await bitmap.pixels() : null,
      physical = expected.pixelsKnown ? new Uint8Array(expected.pitch * expected.height) : null;
    if (pixels)
      for (let y = 0; y < s.height; y++)
        for (let x = 0; x < s.width; x++) {
          const at = ((s.height - y - 1) * s.width + x) * 4,
            out = y * expected.pitch + x * 4;
          physical.set([pixels[at + 2], pixels[at + 1], pixels[at], pixels[at + 3]], out);
        }
    const metadata = Object.fromEntries(
        Object.keys(expected.metadata).map((key) => [key, (s[key] ?? 0) >>> 0]),
      ),
      aliases = [...world.runtime.handles.records.values()].filter(
        (record) => record.type === 'bitmap' && record.value.dataHandle === bitmap.dataHandle,
      ).length;
    result.push({
      name: expected.name,
      width: bitmap.width,
      height: bitmap.height,
      pitch: bitmap.width * s.bpp,
      bpp: s.bpp,
      metadata,
      clip: s.clip.map((word) => word >>> 0),
      bitmapReferences: aliases,
      physicalPixels: physical ? [...physical] : null,
      pixelsKnown: expected.pixelsKnown,
    });
    assert.equal(bitmap.owner, task.id, expected.name + ' automatic Script owner');
  }
  return result;
}
function prepare(machine, row) {
  for (const output of row.outputs) machine.bytes(output.at, output.bytes.length).fill(0xa5);
  row.seed?.forEach((word, index) => machine.store(288 + 4 * index, word));
}
async function compare(world, task, row, label) {
  assert.deepEqual(await state(world, task, row), row.state, label + ' pixels/metadata/references');
  for (const output of row.outputs)
    assert.deepEqual(
      [...task.machine.bytes(output.at, output.bytes.length)],
      output.bytes,
      label + ' VM outputs',
    );
  if (row.control === 1 && !row.save)
    assert.equal(task.machine.load(resultAt), row.result >>> 0, label + ' result');
  if (row.close)
    assert.throws(
      () => world.graphics.images.get(task.machine.load(referenceAt(row.close))),
      /released/,
    );
}
const coldAfter = new Set([0, 3, 15, 19, 22, 26, 36, 42]);
test('SDK67 real World KCS compares every own normal bitmap call, pixel and metadata field with eight cold continuations', async (t) => {
  const world = await make();
  t.after(() => closeWorld(world));
  const task = await world.spawnScript('bitmap67.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    floor = task.machine.sp;
  let next = 0,
    controls = [],
    coldCount = 0;
  const native = world.runtime.native;
  world.runtime.native = async function (table, id, args, machine, owner, ...rest) {
    if (id === 71) return Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]);
    const row = golden.cases[next];
    assert.equal(id, row.id, 'target entry order');
    prepare(machine, row);
    const before = machine.memory.slice(),
      reply = await Reflect.apply(native, this, [table, id, args, machine, owner, ...rest]),
      extra = [];
    for (let at = 0; at < before.length; at++)
      if (
        before[at] !== machine.memory[at] &&
        !row.outputs.some((output) => at >= output.at && at < output.at + output.bytes.length)
      )
        extra.push(at);
    assert.deepEqual(extra, row.unexpectedMemoryWrites, 'Main' + id + ' non-output bytes');
    assert.equal(reply.control, row.control, 'Main' + id + ' control');
    if (row.control === 2) assert.equal(reply.value, undefined);
    controls.push(id);
    next++;
    return reply;
  };
  for (const [index, row] of golden.cases.entries()) {
    const reply =
      index === 0
        ? await world.runtime.scheduler.execute(task)
        : await world.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
    if (index === 0) assert.equal(reply.status, 'waiting');
    else assert.equal(reply.accepted, true);
    assert.equal(task.machine.waiting?.kind, 'message');
    assert.equal(task.machine.sp, floor, 'Main' + row.id + ' balanced stack');
    assert.equal(next, index + 1);
    await compare(world, task, row, 'frame' + index + ' Main' + row.id);
    if (coldAfter.has(index)) {
      const snapshot = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
        fresh = await make(false);
      try {
        await fresh.restore(snapshot);
        const restored = fresh.runtime.scheduler.tasks.get(task.id);
        await compare(fresh, restored, row, 'cold' + index);
        assert.notEqual(restored.machine, task.machine);
        const following = golden.cases[index + 1];
        const original = fresh.runtime.native;
        fresh.runtime.native = async function (table, id, args, machine, owner, ...rest) {
          if (id !== 71) {
            assert.equal(id, following.id);
            prepare(machine, following);
          }
          return Reflect.apply(original, this, [table, id, args, machine, owner, ...rest]);
        };
        assert.equal((await fresh.runtime.scheduler.send(task.id, [1, 2, 3, 4])).accepted, true);
        assert.equal(restored.machine.waiting?.kind, 'message');
        await compare(fresh, restored, following, 'cold continuation' + index);
        coldCount++;
      } finally {
        await closeWorld(fresh);
      }
    }
  }
  world.runtime.native = native;
  assert.equal(coldCount, 8);
  assert.deepEqual(
    controls,
    golden.cases.map((row) => row.id),
  );
  assert.equal((await world.runtime.scheduler.send(task.id, [1, 2, 3, 4])).accepted, true);
  assert.equal(task.machine.halted, true);
  await assert.rejects(
    world.runtime.native('main', 377, [0], task.machine, task),
    /requires a live bitmap owner/,
  );
});
