// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk67-draw-sources.json', import.meta.url)),
);
const names = ['caller', 'draw', 'encoded', 'source'],
  at = (n) => 2048 + names.indexOf(n) * 4,
  resultAt = 2304;
const code = kcsProgram(
  golden.cases
    .flatMap((r) => [
      ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, at(a)] : a]),
      [43, r.id, r.args.length * 4],
      ...(r.control === 1 ? [[38, r.save ? at(r.save) : resultAt]] : []),
      ...(r.sourceRecord
        ? [
            [37, [0x13, 516]],
            [38, at('source')],
          ]
        : []),
      [37, 3968],
      [43, 71, 4],
      [38, 2360],
    ])
    .concat([[59]]),
);
const files = {
  ...Object.fromEntries(
    golden.resources.map((r) => [r.name, new Uint8Array(Buffer.from(r.base64, 'base64'))]),
  ),
  'draw-sources67.kcs': code,
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
async function bitmap(w, handle, e, label) {
  const b = w.graphics.images.get(handle),
    pixels = await b.pixels(),
    physical = new Uint8Array(e.pitch * e.height);
  assert.deepEqual(
    [b.width, b.height, b.state.bpp],
    [e.width, e.height, e.bpp],
    label + ' geometry',
  );
  for (let y = 0; y < e.height; y++)
    for (let x = 0; x < e.width; x++) {
      const i = ((e.height - 1 - y) * e.width + x) * 4,
        o = y * e.pitch + x * 4;
      physical.set([pixels[i + 2], pixels[i + 1], pixels[i], pixels[i + 3]], o);
    }
  assert.deepEqual([...physical], e.physicalPixels, label + ' pixels');
}
async function compare(w, t, r, label) {
  const m = t.machine,
    e = r.state,
    sourceID = m.load(at('source')),
    record = w.runtime.handles.records.get(sourceID),
    source = record?.type === 'render-source' ? record.value : null;
  for (let i = 0; i < 36; i++) {
    const value = m.load(512 + 4 * i),
      expected = e.records[i];
    if (i % 18 === 1 && expected) {
      assert(value, label + ' record handle');
      assert.equal(
        w.runtime.handles.records.get(value)?.type,
        e.records[i - 1] === 1 ? 'bitmap' : 'render-source',
        label + ' record type',
      );
    } else assert.equal(value, expected, label + ' record' + i);
  }
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => m.load(800 + i * 4)),
    e.metadata,
    label + ' metadata',
  );
  assert.equal(Boolean(source), Boolean(e.source), label + ' source lifetime');
  if (e.source) {
    assert.equal(source.refs, e.source.references, label + ' source refs');
    assert.equal(Boolean(source.animation), e.source.hasProgram, label + ' explicit ANM');
  }
  const drawID = m.load(at('draw')),
    draw = drawID ? w.objects.objects.get(w.resolveTaskID(drawID, t.id)).implementation : null;
  if (draw) {
    const s = draw.state;
    assert.equal(
      s.renderer?.items.length ?? null,
      e.renderer?.itemCount ?? null,
      label + ' entry count',
    );
    assert.deepEqual(s.offset, e.offset, label + ' offset');
    assert.equal(s.enabled, e.enabled, label + ' enabled');
    assert.equal(s.pending, e.pending, label + ' pending');
    if (e.renderer) await bitmap(w, s.renderer.bitmap, e.renderer.bitmap, label + ' output');
  } else assert.equal(e.renderer, null);
  assert.equal(
    [...w.runtime.handles.records.values()].filter(
      (v) => v.type === 'bitmap' && v.value.owner === t.id,
    ).length,
    e.scriptBitmapCount,
    label + ' automatic bitmap list',
  );
  assert.equal(
    [...w.runtime.handles.records.values()].filter(
      (v) => v.type === 'image-owner' && v.value.owner === t.id,
    ).length,
    e.scriptImageOwnerCount,
    label + ' automatic ImageOwner list',
  );
  for (const o of r.outputs)
    assert.deepEqual([...m.bytes(o.at, o.bytes.length)], o.bytes, label + ' output');
  if (r.control === 1 && !r.save) {
    if (r.borrow) {
      const value = m.load(resultAt);
      assert.equal(
        value,
        w.renderSources.bitmap(sourceID, { ordinal: r.args[1] }),
        label + ' borrowed ordinal',
      );
      await bitmap(w, value, r.borrowed, label + ' borrowed');
    } else assert.equal(m.load(resultAt), r.result >>> 0, label + ' result');
  }
}
test('SDK67 source arrays, ordinal metadata and actual Draw wrappers preserve own resource pixels and eight cold continuations', async (t) => {
  const w = await make();
  t.after(() => close(w));
  const task = await w.spawnScript('draw-sources67.kcs', {
      parent: w.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    native = w.runtime.native,
    floor = m.sp;
  let next = 0,
    cold = 0,
    packets = [];
  m.store(at('caller'), w.nativeTaskID(task.id));
  m.bytes(512, 144).fill(0x34);
  m.bytes(800, 40).fill(0x35);
  w.runtime.native = async function (table, id, args, m, owner, ...rest) {
    if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
    const r = golden.cases[next];
    assert.equal(id, r.id);
    prepare(m, r);
    packets = [];
    const before = m.memory.slice(),
      reply = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]),
      extra = [];
    for (let i = 0; i < before.length; i++)
      if (
        before[i] !== m.memory[i] &&
        !(i >= 512 && i < 656) &&
        !r.outputs.some((o) => i >= o.at && i < o.at + o.bytes.length)
      )
        extra.push(i);
    assert.deepEqual(extra, r.unexpectedMemoryWrites);
    assert.equal(reply.control, r.control);
    if (r.save === 'draw') {
      const draw = w.objects.objects.get(w.resolveTaskID(reply.value, owner.id)).implementation,
        message = draw.message;
      draw.message = async function (words, context) {
        packets.push({
          message: words[1],
          w: words[2],
          fields:
            [280, 282].includes(words[1]) && context?.payload
              ? Array.from({ length: 15 }, (_, i) => context.payload.load(i * 4))
              : null,
        });
        return Reflect.apply(message, this, [words, context]);
      };
    }
    if ([622, 623, 624, 707, 708].includes(id)) {
      const raw = r.packets.find((p) => [269, 271, 282].includes(p.rawMessage));
      assert(raw);
      const actual = packets.find((p) => p.message === raw.rawMessage + 11);
      assert(actual, 'Main' + id + ' forwards its own receiver packet');
      assert.equal(actual.w, raw.w);
      if (raw.fields) {
        assert.deepEqual(actual.fields.slice(4), raw.fields.slice(4));
        const slot = id < 700 ? 1 : 2;
        assert.equal(actual.fields[slot], m.load(at(id < 700 ? 'encoded' : 'source')));
        for (let i = 0; i < 4; i++) if (i !== slot) assert.equal(actual.fields[i], 0);
      }
    }
    if (r.control === 2) assert.equal(reply.value, undefined);
    next++;
    return reply;
  };
  const coldAfter = new Set([2, 5, 11, 13, 24, 27, 31, 35]);
  for (const [index, r] of golden.cases.entries()) {
    if (index) await w.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
    else await w.runtime.scheduler.execute(task);
    assert.equal(next, index + 1);
    assert.equal(m.sp, floor);
    assert.equal(m.waiting?.kind, 'message');
    await compare(w, task, r, 'frame' + index + ' Main' + r.id);
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
  const drawID = w.resolveTaskID(m.load(at('draw')), task.id);
  await w.objects.tick(40);
  assert.equal(w.objects.objects.has(drawID), false);
  assert.equal(w.runtime.handles.records.has(m.load(at('source'))), false);
});
