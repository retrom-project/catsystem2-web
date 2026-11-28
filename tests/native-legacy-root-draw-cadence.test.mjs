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
        new URL('./fixtures/native-sdk' + version + '-root-draw-cadence.json', import.meta.url),
      ),
    ),
    names = [
      'caller',
      ...new Set(golden.cases.filter((r) => r.id).flatMap((r) => (r.save ? [r.save] : []))),
    ],
    at = (name) => 2048 + names.indexOf(name) * 4,
    resultAt = 2304,
    code = kcsProgram(
      golden.cases
        .filter((r) => r.id)
        .flatMap((r) => [
          ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, at(a)] : a]),
          [43, r.id, r.args.length * 4],
          ...(r.control === 1 ? [[38, r.save ? at(r.save) : resultAt]] : []),
          [37, 3968],
          [43, 71, 4],
          [38, 2360],
        ])
        .concat([[59]]),
    ),
    files = {
      ...Object.fromEntries(
        Object.entries(golden.resources).map(([name, b]) => [name, Buffer.from(b, 'base64')]),
      ),
      'root-draw-cadence.kcs': code,
    },
    make = (initialize = true) => dataWorld(golden.profile, files, { initialize });
  async function close(w) {
    for (const task of w.runtime.scheduler.tasks.values())
      w.runtime.scheduler.cancel(task.id, false);
    await w.close({ flushFiles: false });
  }
  async function bitmap(w, handle, e, label) {
    const b = w.graphics.images.get(handle);
    if (e.empty) {
      assert.equal(b.dataHandle, 0, label + ' null-storage');
      return;
    }
    const s = b.state;
    assert.deepEqual([b.width, b.height, s.bpp], [e.width, e.height, e.bpp], label + ' geometry');
    assert.deepEqual(
      s.clip.map((v) => v >>> 0),
      e.clip,
      label + ' initialized clip',
    );
    assert.deepEqual(
      Object.fromEntries(Object.keys(e.metadata).map((k) => [k, (s[k] ?? 0) >>> 0])),
      e.metadata,
      label + ' metadata',
    );
    if (e.pixelsQualified) {
      const rgba = await b.pixels(),
        physical = new Uint8Array(e.pitch * e.height);
      for (let y = 0; y < e.height; y++)
        for (let x = 0; x < e.width; x++) {
          const i = ((e.height - 1 - y) * e.width + x) * 4,
            o = y * e.pitch + x * e.bpp;
          physical.set(
            [rgba[i + 2], rgba[i + 1], rgba[i], ...(e.bpp === 4 ? [rgba[i + 3]] : [])],
            o,
          );
        }
      assert.deepEqual([...physical], e.physicalPixels, label + ' qualified physical pixels');
    }
    const refs = [...w.runtime.handles.records.values()].filter(
      (r) => r.type === 'bitmap' && r.value.dataHandle === b.dataHandle,
    ).length;
    assert.equal(refs, e.bitmapReferences, label + ' bitmap data refs');
  }
  async function compare(w, t, r, label) {
    const m = t.machine,
      e = r.state;
    for (const v of e.live) {
      const handle = m.load(at(v.name));
      if (v.kind === 'image-owner')
        await bitmap(w, w.imageOwners.get(handle).bitmap, v.bitmap, label + ' ' + v.name);
      else if (v.kind === 'bitmap') await bitmap(w, handle, v.bitmap, label + ' ' + v.name);
      else {
        const buffers = w.runtime.imageDataBuffers,
          p = buffers.pointer(handle);
        assert.deepEqual(
          buffers.words(p).slice(1),
          [v.byteLength, v.capacity, v.references, v.flags],
          label + ' encoded owner',
        );
        assert.equal(
          createHash('sha256').update(buffers.data(p)).digest('hex'),
          v.sha256,
          label + ' source bytes',
        );
      }
    }
    const drawID = m.load(at('draw')),
      draw = drawID ? w.objects.objects.get(w.resolveTaskID(drawID, t.id))?.implementation : null;
    if (draw) {
      const s = draw.state;
      assert.equal(
        s.renderer?.items.length ?? null,
        e.renderer?.itemCount ?? null,
        label + ' item count',
      );
      assert.deepEqual(s.offset, e.offset, label + ' initialized offset');
      assert.equal(s.enabled, e.enabled, label + ' enabled');
      assert.equal(s.pending, e.pending, label + ' pending');
      if (e.renderer)
        await bitmap(w, s.renderer.bitmap, e.renderer.bitmap, label + ' software output');
      if (e.retainedOwner) {
        const retained = w.imageOwners.get(m.load(at(e.retainedOwner.name)));
        await bitmap(w, retained.bitmap, e.retainedOwner.bitmap, label + ' retained owner');
        const group = w.retainedDraw.record(draw, (w.nativeTaskID(t.id) | (7 << 16)) >>> 0);
        assert(group, label + ' retained group');
        assert.equal(
          w.renderSources.get(group.source).ownerHandle,
          m.load(at(e.retainedOwner.name)),
          label + ' exact original owner retained',
        );
      }
    } else assert.equal(e.renderer, null);
    assert.equal(
      [...w.runtime.handles.records.values()].filter(
        (v) => v.type === 'bitmap' && v.value.owner === t.id,
      ).length,
      e.scriptBitmapCount,
      label + ' Script bitmap list',
    );
    assert.equal(
      [...w.runtime.handles.records.values()].filter(
        (v) => v.type === 'image-owner' && v.value.owner === t.id,
      ).length,
      e.scriptImageOwnerCount,
      label + ' Script image-owner list',
    );
    if (r.control === 1 && !r.save) {
      const result = m.load(resultAt);
      if (r.borrowed) {
        await bitmap(w, result, r.borrowed, label + ' borrowed');
        const owner = w.imageOwners.get(m.load(at(e.retainedOwner.name)));
        assert.equal(
          result === owner.bitmap,
          r.borrowedAliasesRetainedOwner,
          label + ' borrowed identity',
        );
      } else assert.equal(result, r.result >>> 0, label + ' defined result');
    }
  }
  test(
    'SDK' +
      version +
      ' actual Root/Draw disabled update and release cadence match own tree with eight cold continuations',
    async (t) => {
      const w = await make();
      t.after(() => close(w));
      const task = await w.spawnScript('root-draw-cadence.kcs', {
          parent: w.main.id,
          initialExecute: false,
        }),
        m = task.machine,
        native = w.runtime.native,
        floor = m.sp;
      m.store(at('caller'), w.nativeTaskID(task.id));
      let next = 0,
        cold = 0;
      const coldAfter = new Set(golden.coldAfter);
      w.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
        const r = golden.cases.filter((r) => r.id)[next];
        assert.equal(id, r.id);
        if (r.text)
          m.bytes(r.textAt ?? 64, encodeCP932(r.text).length + 1).set([...encodeCP932(r.text), 0]);
        const before = m.memory.slice(),
          reply = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]),
          changed = [];
        for (let i = 0; i < 4096; i++) if (before[i] !== m.memory[i]) changed.push(i);
        assert.deepEqual(changed, r.unexpectedMemoryWrites, 'ordinary wrapper memory writes');
        assert.equal(reply.control, r.control);
        next++;
        return reply;
      };
      async function step(w, task, r) {
        if (r.operation === 'stop-caller') {
          await w.sendEngine(task.id, task.id, 162, 0, 0);
          return;
        }
        if (r.operation === 'frame') {
          const order = [],
            updates = [],
            outputs = [],
            retained = w.retainedDraw,
            update = retained.update,
            output = w.graphics.output,
            wrappers = [];
          for (const q of r.state.draws) {
            const id = task.machine.load(at(q.name)),
              record = w.objects.objects.get(w.resolveTaskID(id, task.id));
            if (!record) continue;
            const original = record.implementation.drawTick;
            record.implementation.drawTick = async function (...args) {
              order.push(q.name);
              return Reflect.apply(original, this, args);
            };
            wrappers.push([record.implementation, original]);
          }
          retained.update = async function (draw, ...args) {
            updates.push(draw.record.id);
            return Reflect.apply(update, this, [draw, ...args]);
          };
          w.graphics.output = async function (...args) {
            outputs.push(args);
            return Reflect.apply(output, this, args);
          };
          try {
            await w.objects.tick(r.frame);
            await w.objects.drawTick(r.frame);
          } finally {
            retained.update = update;
            w.graphics.output = output;
            for (const [object, fn] of wrappers) object.drawTick = fn;
          }
          assert.deepEqual(order, r.derivedOrder, 'actual child draw traversal order');
          assert.equal(
            updates.length,
            r.sourceUpdateCount,
            'source update happens despite disabled output',
          );
          return;
        }
        const machine = task.machine;
        if (machine.waiting?.kind === 'message')
          await w.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
        else await w.runtime.scheduler.execute(task);
      }
      for (const [index, r] of golden.cases.entries()) {
        await step(w, task, r);
        assert.equal(m.sp, floor);
        assert.equal(m.waiting?.kind, 'message');
        await compare(w, task, r, 'frame' + index + (r.id ? ' Main' + r.id : ' ' + r.operation));
        for (const q of r.state.draws) {
          const id = m.load(at(q.name)),
            record = w.objects.objects.get(w.resolveTaskID(id, task.id));
          assert.equal(!!record, q.alive, 'typed Draw lifetime ' + q.name);
          if (record) {
            assert.equal(
              record.implementation.state.nativeRasterGate,
              q.gate,
              'owned native raster gate ' + q.name,
            );
            if (r.operation === 'frame')
              assert.equal(record.effectiveFrame, q.frame, 'Base frame propagated ' + q.name);
          }
        }
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
              if (id !== 71 && following.text)
                m.bytes(following.textAt ?? 64, encodeCP932(following.text).length + 1).set([
                  ...encodeCP932(following.text),
                  0,
                ]);
              return Reflect.apply(call, this, [table, id, args, m, owner, ...rest]);
            };
            await step(fresh, restored, following);
            await compare(fresh, restored, following, 'cold next' + index);
            cold++;
          } finally {
            await close(fresh);
          }
        }
      }
      assert.equal(next, golden.cases.filter((r) => r.id).length);
      assert.equal(cold, golden.coldAfter.length);
      w.runtime.native = native;
    },
  );
}
