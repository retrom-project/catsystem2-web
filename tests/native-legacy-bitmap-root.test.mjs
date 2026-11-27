// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
for (const version of ['63', '67']) {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-sdk' + version + '-bitmap-composite-root.json', import.meta.url),
      ),
    ),
    names = ['caller', ...golden.cases.filter((r) => r.save).map((r) => r.save)],
    slot = (n) => 2048 + 4 * names.indexOf(n),
    code = kcsProgram(
      golden.cases
        .filter((r) => r.id)
        .flatMap((r) => [
          ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, slot(a)] : a]),
          [43, r.id, r.args.length * 4],
          ...(r.control === 1 ? [[38, r.save ? slot(r.save) : 2304]] : []),
          [37, 3968],
          [43, 71, 4],
          [38, 2360],
        ])
        .concat([[59]]),
    ),
    files = {
      ...Object.fromEntries(
        Object.entries(golden.resources).map(([n, b]) => [n, Buffer.from(b, 'base64')]),
      ),
      'bitmap-transform.kcs': code,
    },
    make = (initialize = true) => dataWorld(golden.profile, files, { initialize });
  async function close(w) {
    for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
    await w.close({ flushFiles: false });
  }
  const draw = (w, t) =>
    w.objects.objects.get(w.resolveTaskID(t.machine.load(slot('draw')), t.id)).implementation;
  async function bitmap(w, handle, e, label) {
    const b = w.graphics.images.get(handle),
      s = b.state;
    assert.deepEqual([b.width, b.height, s.bpp], [e.width, e.height, e.bpp], label + ' shape');
    assert.deepEqual(
      s.clip.map((n) => n >>> 0),
      e.clip,
      label + ' clip',
    );
    assert.deepEqual(
      Object.fromEntries(Object.keys(e.metadata).map((k) => [k, (s[k] ?? 0) >>> 0])),
      e.metadata,
      label + ' initialized metadata',
    );
    if (e.physicalPixels) {
      const rgba = await b.pixels(),
        out = new Uint8Array(e.pitch * e.height);
      for (let y = 0; y < e.height; y++)
        for (let x = 0; x < e.width; x++) {
          const at = ((e.height - 1 - y) * e.width + x) * 4,
            to = y * e.pitch + x * e.bpp;
          out.set(
            [rgba[at + 2], rgba[at + 1], rgba[at], ...(e.bpp === 4 ? [rgba[at + 3]] : [])],
            to,
          );
        }
      assert.deepEqual([...out], e.physicalPixels, label + ' every original initialized byte');
    }
    const refs = [...w.runtime.handles.records.values()].filter(
      (r) => r.type === 'bitmap' && r.value.dataHandle === b.dataHandle,
    ).length;
    assert.equal(refs, e.bitmapReferences, label + ' shared data reference count');
  }
  async function compare(w, t, r) {
    const state = r.state;
    for (const e of state.live)
      await bitmap(w, t.machine.load(slot(e.name)), e.bitmap, 'row' + r.ordinal + ' ' + e.name);
    if (state.draw) {
      const d = draw(w, t),
        s = d.state;
      assert.deepEqual(s.offset, state.draw.offset);
      assert.equal(s.enabled, state.draw.enabled);
      assert.equal(s.pending, state.draw.pending);
      assert.equal(s.nativeRasterGate, state.draw.gate);
      assert.equal(s.renderer?.items.length ?? null, state.draw.renderer?.itemCount ?? null);
      if (state.draw.renderer)
        await bitmap(
          w,
          s.renderer.bitmap,
          state.draw.renderer.bitmap,
          'row' + r.ordinal + ' actual Draw output',
        );
      if (state.selectedSource) {
        assert.equal(s.renderer.items.length, 1);
        await bitmap(
          w,
          s.renderer.items[0].image,
          state.selectedSource,
          'row' + r.ordinal + ' retained source after creator lifetime',
        );
      }
    }
  }
  async function step(w, t, r) {
    if (r.operation) {
      if (r.operation === 'stopDriver') await w.sendEngine(t.id, t.id, 162, 0, 0);
      else {
        await w.objects.tick(r.frame);
        await w.objects.drawTick(r.frame);
      }
      await compare(w, t, r);
      return;
    }
    const original = w.runtime.native;
    w.runtime.native = async function (table, id, args, m, owner, ...rest) {
      if (id === 71 || owner.id !== t.id)
        return Reflect.apply(original, this, [table, id, args, m, owner, ...rest]);
      assert.equal(id, r.id);
      if (r.text)
        m.bytes(r.textAt ?? 64, encodeCP932(r.text).length + 1).set([...encodeCP932(r.text), 0]);
      if (r.records) {
        r.records.forEach((record, i) =>
          record.forEach((n, j) =>
            m.store(1024 + i * 12 + j * 4, typeof n === 'string' ? m.load(slot(n)) : n),
          ),
        );
        r.rectangle.forEach((n, i) => m.store(1280 + i * 4, n));
      }
      const before = m.memory.slice(0, 2048),
        reply = await Reflect.apply(original, this, [table, id, args, m, owner, ...rest]),
        changed = [];
      for (let i = 0; i < 2048; i++) if (before[i] !== m.memory[i]) changed.push([i, m.memory[i]]);
      assert.equal(reply.control, r.control, 'own original control');
      if (!r.save) {
        if (r.borrow)
          assert.equal(reply.value, draw(w, t).state.renderer.bitmap, 'borrowed output owner');
        else assert.equal(reply.value ?? null, r.result);
      }
      assert.deepEqual(changed, r.changed, 'unchanged caller input/output region');
      return reply;
    };
    try {
      if (t.machine.waiting?.kind === 'message') await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
      else await w.runtime.scheduler.execute(t);
    } finally {
      w.runtime.native = original;
    }
    await compare(w, t, r);
  }
  test(
    'SDK' + version + ' enabled Root/Base/Draw bitmap write cadence and independent cold',
    async () => {
      const w = await make();
      try {
        const t = await w.spawnScript('bitmap-transform.kcs', {
            parent: w.main.id,
            initialExecute: false,
          }),
          floor = t.machine.sp;
        t.machine.store(slot('caller'), w.nativeTaskID(t.id));
        await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
        let cold = 0;
        for (const [index, r] of golden.cases.entries()) {
          await step(w, t, r);
          assert.equal(t.machine.sp, floor);
          if (golden.coldAfter.includes(index)) {
            const fresh = await make(false);
            try {
              await fresh.restore(
                await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
              );
              const restored = fresh.runtime.scheduler.tasks.get(t.id);
              await compare(fresh, restored, r);
              await step(fresh, restored, golden.cases[index + 1]);
              cold++;
            } finally {
              await close(fresh);
            }
          }
        }
        assert.equal(cold, 2);
      } finally {
        await close(w);
      }
    },
  );
}
