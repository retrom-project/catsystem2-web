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
        new URL('./fixtures/native-sdk' + version + '-raster-retained.json', import.meta.url),
      ),
    ),
    names = ['caller', ...new Set(golden.cases.flatMap((r) => (r.save ? [r.save] : [])))],
    at = (name) => 2048 + names.indexOf(name) * 4,
    resultAt = 2304,
    code = kcsProgram(
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
    ),
    files = {
      ...Object.fromEntries(
        Object.entries(golden.resources).map(([name, b]) => [name, Buffer.from(b, 'base64')]),
      ),
      'raster-retained.kcs': code,
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
      draw = drawID ? w.objects.objects.get(w.resolveTaskID(drawID, t.id)).implementation : null;
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
      ' raster owner, retained software output and empty encoded sources match own complete VM with eight cold continuations',
    async (t) => {
      const w = await make();
      t.after(() => close(w));
      const task = await w.spawnScript('raster-retained.kcs', {
          parent: w.main.id,
          initialExecute: false,
        }),
        m = task.machine,
        native = w.runtime.native,
        floor = m.sp;
      m.store(at('caller'), w.nativeTaskID(task.id));
      let next = 0,
        cold = 0;
      const coldAfter = new Set([6, 8, 14, 22, 30, 40, 56, 69]);
      w.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
        const r = golden.cases[next];
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
      for (const [index, r] of golden.cases.entries()) {
        if (index) await w.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
        else await w.runtime.scheduler.execute(task);
        assert.equal(next, index + 1);
        assert.equal(m.sp, floor);
        assert.equal(m.waiting?.kind, 'message');
        await compare(w, task, r, 'frame' + index + ' Main' + r.id);
        if (index === 6) {
          await w.graphics.prepareRender();
          await compare(w, task, r, 'graphics preparation keeps first raster alpha cache');
          const reply = await Reflect.apply(native, w.runtime, [
            'main',
            342,
            [m.load(at('draw'))],
            m,
            task,
          ]);
          assert.equal(reply.control, 2);
          await compare(w, task, r, 'Main342 keeps initialized raster source');
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
              if (id !== 71) {
                assert.equal(id, following.id);
                if (following.text)
                  m.bytes(following.textAt ?? 64, encodeCP932(following.text).length + 1).set([
                    ...encodeCP932(following.text),
                    0,
                  ]);
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
      assert.equal(next, golden.cases.length);
      assert.equal(cold, 8);
      w.runtime.native = native;
    },
  );
  test(
    'SDK' + version + ' unreviewed CORE and alpha-bitfield offsets remain capability guards',
    async (t) => {
      const core = Buffer.from(golden.resources['core-gap.bmp'], 'base64'),
        otherSelector = Buffer.from(core),
        shiftedCore = Buffer.alloc(core.length + 4),
        alpha = Buffer.from(golden.resources['alpha-bitfield.bmp'], 'base64'),
        shiftedAlpha = Buffer.alloc(alpha.length + 4);
      otherSelector.writeUInt16LE(32, 28);
      shiftedCore.set(core.subarray(0, 54));
      shiftedCore.set(core.subarray(54), 58);
      shiftedCore.writeUInt32LE(shiftedCore.length, 2);
      shiftedCore.writeUInt32LE(58, 10);
      shiftedAlpha.set(alpha.subarray(0, 70));
      shiftedAlpha.set(alpha.subarray(70), 74);
      shiftedAlpha.writeUInt32LE(shiftedAlpha.length, 2);
      shiftedAlpha.writeUInt32LE(74, 10);
      const w = await dataWorld(golden.profile, {
        'selector.bmp': otherSelector,
        'core-offset.bmp': shiftedCore,
        'alpha-offset.bmp': shiftedAlpha,
      });
      t.after(() => close(w));
      for (const name of ['selector.bmp', 'core-offset.bmp', 'alpha-offset.bmp'])
        await assert.rejects(w.graphics.images.load(name), /Native BMP layout is guarded/);
      const animation = JSON.parse(
        await readFile(new URL('./fixtures/native-sdk23-draw-sources.json', import.meta.url)),
      ).resources.find((r) => r.name === 'source.anm');
      const other = await dataWorld(golden.profile, {
        'animated.psd': Buffer.from(golden.resources['画像.psd'], 'base64'),
        'animated.anm': Buffer.from(animation.base64, 'base64'),
      });
      t.after(() => close(other));
      await assert.rejects(
        other.renderSources.load('animated.psd', other.main),
        /retained source format has no reviewed ABI binding/,
      );
      const guarded = await dataWorld(golden.profile, {
        ...Object.fromEntries(
          Object.entries(golden.resources).map(([name, b]) => [name, Buffer.from(b, 'base64')]),
        ),
        'guard.kcs': kcsProgram([[59]]),
      });
      t.after(() => close(guarded));
      const task = await guarded.spawnScript('guard.kcs', {
          parent: guarded.main.id,
          initialExecute: false,
        }),
        machine = task.machine,
        invoke = (id, args) => guarded.runtime.native('main', id, args, machine, task),
        string = (at, text) =>
          machine.bytes(at, encodeCP932(text).length + 1).set([...encodeCP932(text), 0]),
        F = (v) => new Uint32Array(new Float32Array([v]).buffer)[0];
      string(128, 'guard Draw');
      const draw = (await invoke(66, [15, guarded.nativeTaskID(task.id), 128])).value;
      await invoke(256, [draw, 8, 6]);
      await invoke(260, [draw, 0, 0]);
      await invoke(262, [draw, 0]);
      string(64, '画像.bmp');
      const owner = (await invoke(710, [64])).value;
      const fields = (handle) => [draw, 7, handle, F(1), F(1), 0, 0, 0, F(1), F(1), 200, 1, 0];
      await invoke(731, fields(owner));
      string(64, '画像.psd');
      const encoded = (await invoke(365, [64])).value,
        count = guarded.runtime.handles.records.size,
        bitmapHandle = guarded.imageOwners.get(owner).bitmap;
      await assert.rejects(invoke(623, fields(encoded)), /empty encoded Draw rebind source class/);
      assert.equal(
        guarded.runtime.handles.records.size,
        count,
        'unproved rebind releases only its temporary decoder',
      );
      assert.equal(
        (await invoke(657, [draw, 7])).value,
        bitmapHandle,
        'unproved rebind preserves the current owned bitmap',
      );
    },
  );
}
