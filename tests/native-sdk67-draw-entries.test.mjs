// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk67-draw-entries.json', import.meta.url)),
  ),
  names = ['caller', ...new Set(golden.cases.flatMap((r) => (r.save ? [r.save] : [])))],
  at = (name) => 2048 + names.indexOf(name) * 4,
  resultAt = 2304;
const code = (rows) =>
  kcsProgram(
    rows
      .flatMap((r) => [
        ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, at(a)] : a]),
        [43, r.id, r.args.length * 4],
        ...(r.control === 1 ? [[38, r.save ? at(r.save) : resultAt]] : []),
        [37, 3968],
        [43, 71, 4],
        [38, 2360],
      ])
      .concat([[59]]),
  );
const files = {
  'pixels.hg3': new Uint8Array(Buffer.from(golden.resource.base64, 'base64')),
  'draw67.kcs': code(golden.cases),
};
const make = (initialize = true) => dataWorld(golden.profile, files, { initialize });
async function close(w) {
  for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
  await w.close({ flushFiles: false });
}
function prepare(m, r) {
  if (r.text)
    m.bytes(r.textAt ?? 64, encodeCP932(r.text).length + 1).set([...encodeCP932(r.text), 0]);
  for (const o of r.outputs) m.bytes(o.at, o.bytes.length).fill(0xa5);
}
function drawFor(w, t) {
  return w.objects.objects.get(w.resolveTaskID(t.machine.load(at('draw')), t.id)).implementation;
}
async function compare(w, t, r, label) {
  const draw = drawFor(w, t),
    s = draw.state,
    expected = r.state,
    renderer = s.renderer;
  assert.equal(
    renderer?.items.length ?? null,
    expected.renderer?.itemCount ?? null,
    label + ' entry count',
  );
  assert.deepEqual(s.offset, expected.offset, label + ' offset');
  assert.equal(s.enabled, expected.enabled, label + ' enabled');
  assert.equal(s.pending, expected.pending, label + ' pending');
  if (expected.renderer) {
    const b = w.graphics.images.get(renderer.bitmap),
      e = expected.renderer.bitmap,
      pixels = await b.pixels(),
      physical = new Uint8Array(e.pitch * e.height);
    assert.deepEqual(
      [b.width, b.height, b.state.bpp],
      [e.width, e.height, e.bpp],
      label + ' output geometry',
    );
    for (let y = 0; y < e.height; y++)
      for (let x = 0; x < e.width; x++) {
        const i = ((e.height - 1 - y) * e.width + x) * 4,
          o = y * e.pitch + x * 4;
        physical.set([pixels[i + 2], pixels[i + 1], pixels[i], pixels[i + 3]], o);
      }
    assert.deepEqual([...physical], e.physicalPixels, label + ' output pixels');
  }
  assert.equal(
    [...w.runtime.handles.records.values()].filter(
      (v) => v.type === 'bitmap' && v.value.owner === t.id,
    ).length,
    expected.scriptBitmapCount,
    label + ' automatic bitmap list',
  );
  assert.equal(
    [...w.runtime.handles.records.values()].filter(
      (v) => v.type === 'image-owner' && v.value.owner === t.id,
    ).length,
    expected.scriptImageOwnerCount,
    label + ' automatic ImageOwner list',
  );
  for (const o of r.outputs)
    assert.deepEqual([...t.machine.bytes(o.at, o.bytes.length)], o.bytes, label + ' output');
  if (r.control === 1 && !r.save) {
    const value = t.machine.load(resultAt);
    if (r.result === 'borrowed:output')
      assert.equal(value, renderer.bitmap, label + ' borrowed output');
    else if (r.result === 'borrowed:entry') {
      const key = (w.nativeTaskID(t.id) | (r.args[1] << 16)) >>> 0;
      assert.equal(value, draw.entry(key).image, label + ' borrowed entry');
    } else assert.equal(value, r.result >>> 0, label + ' result');
  }
  if (r.countScratch !== null)
    assert.equal(
      renderer.items.length,
      r.countScratch,
      label + ' native scratch count (not a VM value)',
    );
}
const coldAfter = new Set([5, 15, 20, 23, 25, 28, 35, 37]);
test('SDK67 true Draw entry, pixel, resize and retained owner calls match own full GCALLs and eight cold continuations', async (t) => {
  const w = await make();
  t.after(() => close(w));
  const task = await w.spawnScript('draw67.kcs', { parent: w.main.id, initialExecute: false });
  task.machine.store(at('caller'), w.nativeTaskID(task.id));
  const floor = task.machine.sp,
    native = w.runtime.native;
  let next = 0,
    cold = 0,
    seen = [];
  const canonical = { 259: 282, 263: 287, 731: 280 },
    raw = { 259: 271, 263: 276, 731: 269 };
  w.runtime.native = async function (table, id, args, m, owner, ...rest) {
    if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
    const r = golden.cases[next];
    assert.equal(id, r.id);
    prepare(m, r);
    const before = m.memory.slice(),
      reply = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]),
      extra = [];
    for (let i = 0; i < before.length; i++)
      if (
        before[i] !== m.memory[i] &&
        !r.outputs.some((o) => i >= o.at && i < o.at + o.bytes.length)
      )
        extra.push(i);
    assert.deepEqual(extra, r.unexpectedMemoryWrites);
    assert.equal(reply.control, r.control);
    if (r.control === 2) assert.equal(reply.value, undefined);
    next++;
    return reply;
  };
  for (const [index, r] of golden.cases.entries()) {
    seen = [];
    if (index) await w.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
    else await w.runtime.scheduler.execute(task);
    assert.equal(next, index + 1);
    assert.equal(task.machine.sp, floor);
    assert.equal(task.machine.waiting?.kind, 'message');
    await compare(w, task, r, 'frame' + index + ' Main' + r.id);
    if (!index) {
      const draw = drawFor(w, task),
        message = draw.message;
      draw.message = async function (words, context) {
        seen.push({
          message: words[1],
          w: words[2],
          fields:
            context?.payload && [280, 282].includes(words[1])
              ? Array.from({ length: 15 }, (_, i) => context.payload.load(i * 4))
              : null,
        });
        return Reflect.apply(message, this, [words, context]);
      };
    }
    if (canonical[r.id]) {
      const captured = golden.messagePackets[index].packets.find((p) => p.message === raw[r.id]),
        actual = seen.find((p) => p.message === canonical[r.id]);
      assert(captured);
      assert(actual);
      assert.equal(actual.w, captured.w);
      if (captured.fields) {
        assert.deepEqual(actual.fields.slice(4), captured.fields.slice(4));
        assert.equal(
          actual.fields[r.id === 731 ? 3 : 0],
          task.machine.load(at(r.id === 731 ? 'owner' : 'bitmap')),
        );
        assert.deepEqual(
          actual.fields.slice(r.id === 731 ? 0 : 1, r.id === 731 ? 3 : 4),
          [0, 0, 0],
        );
      }
    }

    if (coldAfter.has(index)) {
      const fresh = await make(false);
      try {
        await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())));
        const restored = fresh.runtime.scheduler.tasks.get(task.id);
        await compare(fresh, restored, r, 'cold' + index);
        const following = golden.cases[index + 1],
          original = fresh.runtime.native;
        fresh.runtime.native = async function (table, id, args, m, owner, ...rest) {
          if (id !== 71) {
            assert.equal(id, following.id);
            prepare(m, following);
          }
          return Reflect.apply(original, this, [table, id, args, m, owner, ...rest]);
        };
        await fresh.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
        await compare(fresh, restored, following, 'cold continuation' + index);
        cold++;
      } finally {
        await close(fresh);
      }
    }
  }
  w.runtime.native = native;
  assert.equal(cold, 8);
  const drawID = w.resolveTaskID(task.machine.load(at('draw')), task.id);
  await w.objects.tick(40);
  assert.equal(
    w.objects.objects.has(drawID),
    false,
    'actual parent update deletes the retired Draw',
  );
});

test('SDK67 renderer-less count/layer shapes keep their original precondition diagnosed', async (t) => {
  const w = await make();
  t.after(() => close(w));
  const id = await w.objects.create({ kind: 15, parent: w.main.id }),
    task = w.main,
    nativeID = w.nativeTaskID(id);
  for (const [slot, args] of [
    [264, [nativeID]],
    [462, [nativeID, 7]],
    [463, [nativeID, 7, 3]],
  ])
    await assert.rejects(
      w.runtime.native('main', slot, args, task.machine, task),
      /require an initialized renderer/,
    );
  assert.deepEqual(await w.runtime.native('main', 657, [nativeID, 7], task.machine, task), {
    control: 1,
    value: 0,
  });
});
