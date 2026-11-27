// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
for (const version of ['63', '67']) {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-sdk' + version + '-bmp-shapes.json', import.meta.url),
      ),
    ),
    names = golden.cases.filter((r) => r.save).map((r) => r.save),
    at = (name) => 2048 + names.indexOf(name) * 4,
    resultAt = 2304;
  const code = kcsProgram(
    golden.cases
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
      ...Object.fromEntries(
        Object.entries(golden.resources).map(([name, b]) => [
          name,
          new Uint8Array(Buffer.from(b, 'base64')),
        ]),
      ),
      'bmp-shapes.kcs': code,
    },
    make = (initialize = true) => dataWorld(golden.profile, files, { initialize });
  async function close(w) {
    for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
    await w.close({ flushFiles: false });
  }
  function prepare(m, r) {
    if (r.text) m.bytes(64, encodeCP932(r.text).length + 1).set([...encodeCP932(r.text), 0]);
    for (const o of r.outputs) m.bytes(o.at, o.bytes.length).fill(0xa5);
  }
  async function bitmap(w, handle, e, label) {
    const b = w.graphics.images.get(handle);
    if (e.empty) {
      assert.equal(b.dataHandle, 0, label + ' null-storage owner');
      return;
    }
    assert(b.dataHandle, label + ' allocated bitmap');
    const s = b.state,
      rgba = await b.pixels(),
      physical = new Uint8Array(e.pitch * e.height);
    assert.deepEqual([b.width, b.height, s.bpp], [e.width, e.height, e.bpp], label + ' shape');
    for (let y = 0; y < e.height; y++)
      for (let x = 0; x < e.width; x++) {
        const i = ((e.height - 1 - y) * e.width + x) * 4,
          o = y * e.pitch + x * e.bpp;
        physical.set([rgba[i + 2], rgba[i + 1], rgba[i], ...(e.bpp === 4 ? [rgba[i + 3]] : [])], o);
      }
    assert.deepEqual([...physical], e.physicalPixels, label + ' physical pixels');
    assert.deepEqual(
      s.clip.map((v) => v >>> 0),
      e.clip,
      label + ' clip',
    );
    assert.deepEqual(
      Object.fromEntries(Object.keys(e.metadata).map((k) => [k, (s[k] ?? 0) >>> 0])),
      e.metadata,
      label + ' metadata',
    );
    const refs = [...w.runtime.handles.records.values()].filter(
      (r) => r.type === 'bitmap' && r.value.dataHandle === b.dataHandle,
    ).length;
    assert.equal(refs, e.bitmapReferences, label + ' data refs');
  }
  async function compare(w, t, r, label) {
    const m = t.machine;
    for (const e of r.state) {
      const handle = m.load(at(e.name));
      assert(handle, label + ' owned handle');
      if (e.kind === 'encoded') {
        const buffers = w.runtime.imageDataBuffers,
          p = buffers.pointer(handle);
        assert.deepEqual(
          buffers.words(p).slice(1),
          [e.byteLength, e.capacity, e.references, e.flags],
          label + ' encoded owner',
        );
        assert.equal(
          createHash('sha256').update(buffers.data(p)).digest('hex'),
          e.sha256,
          label + ' bytes',
        );
      } else await bitmap(w, handle, e, label + ' ' + e.name);
    }
    for (const o of r.outputs)
      assert.deepEqual([...m.bytes(o.at, o.bytes.length)], o.bytes, label + ' output');
    for (let i = 0; i < 36; i++) {
      const value = m.load(512 + i * 4),
        expected = r.records[i];
      if (i % 18 === 1 && expected && [1, 2].includes(r.records[i - 1]))
        assert.equal(
          w.runtime.handles.records.get(value)?.type,
          r.records[i - 1] === 1 ? 'bitmap' : 'render-source',
          label + ' typed record',
        );
      else assert.equal(value, expected, label + ' record' + i);
    }
    if (r.sourceBitmap) await bitmap(w, m.load(516), r.sourceBitmap, label + ' source');
    assert.equal(
      [...w.runtime.handles.records.values()].filter(
        (r) => r.type === 'bitmap' && r.value.owner === t.id,
      ).length,
      r.scriptBitmapCount,
      label + ' Script list',
    );
    if (r.control === 1 && !r.save)
      assert.equal(m.load(resultAt), r.result >>> 0, label + ' result');
    if (r.save && r.result === 0) assert.equal(m.load(at(r.save)), 0, label + ' defined zero');
    if (r.close) assert(!w.runtime.handles.records.has(m.load(at(r.close))), label + ' release');
  }
  test(
    'SDK' +
      version +
      ' BMP palette/depth/header rejection and accepted fixed-offset bitfields match own full VM and eight cold continuations',
    async (t) => {
      const w = await make();
      t.after(() => close(w));
      const task = await w.spawnScript('bmp-shapes.kcs', {
          parent: w.main.id,
          initialExecute: false,
        }),
        m = task.machine,
        floor = m.sp,
        native = w.runtime.native;
      let next = 0,
        cold = 0;
      m.bytes(512, 144).fill(0x34);
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
            !(i >= 512 && i < 656) &&
            !r.outputs.some((o) => i >= o.at && i < o.at + o.bytes.length)
          )
            extra.push(i);
        assert.deepEqual(extra, r.unexpectedMemoryWrites);
        assert.equal(reply.control, r.control);
        if (r.control === 2) assert.equal(reply.value, undefined);
        next++;
        return reply;
      };
      const coldAfter = new Set([5, 10, 19, 24, 33, 36, 38, 50]);
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
            await fresh.restore(
              await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
            );
            const restored = fresh.runtime.scheduler.tasks.get(task.id);
            await compare(fresh, restored, r, 'cold' + index);
            const following = golden.cases[index + 1],
              call = fresh.runtime.native;
            fresh.runtime.native = async function (table, id, args, m, owner, ...rest) {
              if (id !== 71) {
                assert.equal(id, following.id);
                prepare(m, following);
              }
              return Reflect.apply(call, this, [table, id, args, m, owner, ...rest]);
            };
            await fresh.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
            await compare(fresh, restored, following, 'cold next' + index);
            cold++;
          } finally {
            await close(fresh);
          }
        }
      }
      assert.equal(cold, 8);
      w.runtime.native = native;
    },
  );
}
