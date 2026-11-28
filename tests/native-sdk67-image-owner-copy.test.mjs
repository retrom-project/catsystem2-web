// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
for (const version of ['67']) {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-sdk' + version + '-image-owner-copy.json', import.meta.url),
      ),
    ),
    names = ['caller', ...golden.cases.filter((r) => r.save).map((r) => r.save)],
    slot = (n) => 2048 + 4 * names.indexOf(n),
    code = kcsProgram(
      golden.cases
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
    for (const e of state.live) {
      const handle = t.machine.load(slot(e.name)),
        owner = w.imageOwners.get(handle);
      assert.deepEqual(
        owner.info.map((n) => n >>> 0),
        e.ownerInfo,
        'row' + r.ordinal + ' owner metadata',
      );
      assert.equal(owner.owner, t.id, 'actual Script owner');
      await bitmap(w, owner.bitmap, e.bitmap, 'row' + r.ordinal + ' ' + e.name);
    }
    for (const name of names.filter((n) => !['caller', 'draw'].includes(n))) {
      const handle = t.machine.load(slot(name));
      if (!handle) continue;
      assert.equal(
        w.runtime.handles.records.has(handle),
        state.live.some((e) => e.name === name) || state.selectedSource?.name === name,
        'row' + r.ordinal + ' precise retained owner ' + name,
      );
    }
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
          w.imageOwners.get(t.machine.load(slot(state.selectedSource.name))).bitmap,
          state.selectedSource,
          'row' + r.ordinal + ' retained source after creator lifetime',
        );
      }
    }
  }
  async function step(w, t, r) {
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
      const resourceCount = () =>
        [...w.runtime.handles.records.values()].filter((v) =>
          ['bitmap', 'image-owner'].includes(v.type),
        ).length;
      const resourcesBefore = resourceCount();
      const before = m.memory.slice(0, 2048),
        reply = await Reflect.apply(original, this, [table, id, args, m, owner, ...rest]),
        changed = [];
      for (let i = 0; i < 2048; i++) if (before[i] !== m.memory[i]) changed.push([i, m.memory[i]]);
      assert.equal(reply.control, r.control, 'own original control');
      if (id === 681)
        assert.equal(
          resourceCount(),
          resourcesBefore,
          'warm-load releases temporary owned wrappers',
        );
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
    'SDK' +
      version +
      ' own warm/copy ImageOwner GCALLs, real Draw source/output and eight cold lifetime continuations',
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
        assert.equal(cold, 8);
      } finally {
        await close(w);
      }
    },
  );
  test('SDK67 copy guards unproved source/receiver/arity and preserves the normal zero-destination return', async () => {
    const w = await make();
    try {
      const t = w.main,
        m = t.machine,
        call = (id, args) => w.runtime.native('main', id, args, m, t),
        owner = (await call(733, [2, 2])).value;
      await call(736, [owner, 0, 0, 2, 2, 0x80402010]);
      const before = w.graphics.images.get(w.imageOwners.get(owner).bitmap).snapshot();
      assert.equal((await call(735, [owner, 0, 0, 2, 2, 0, 0, 0, 2, 2])).control, 2);
      await assert.rejects(
        () => call(735, [0, 0, 0, 2, 2, owner, 0, 0, 2, 2]),
        /requires a source bitmap/,
      );
      await assert.rejects(
        () => call(735, [owner, 0, 0, 2, 2, owner, 0, 0, 2]),
        /ten argument words/,
      );
      const bitmap = (await call(112, [2, 2])).value;
      await assert.rejects(
        () => call(735, [bitmap, 0, 0, 2, 2, owner, 0, 0, 2, 2]),
        /image-owner|handle/,
      );
      assert.deepEqual(w.graphics.images.get(w.imageOwners.get(owner).bitmap).snapshot(), before);
      await call(114, [bitmap]);
      await call(711, [owner]);
      assert.throws(() => call(682, [1]), /unknown|not registered|Unsupported|outside/i);
    } finally {
      await close(w);
    }
  });
}
