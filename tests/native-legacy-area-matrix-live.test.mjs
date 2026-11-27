// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
for (const version of ['63', '67']) {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-sdk' + version + '-area-matrix-live.json', import.meta.url),
      ),
    ),
    // The Top kind query preserves an opaque native caller address; it stays guarded.
    rows = golden.cases.filter((r) => !(r.id === 201 && r.args[0] === 'top')),
    names = ['caller', ...rows.filter((r) => r.save).map((r) => r.save)],
    slot = (n) => 2048 + 4 * names.indexOf(n),
    code = kcsProgram(
      rows
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
    );
  async function make(initialize = true) {
    const w = await dataWorld(
      golden.profile,
      { 'area-live.kcs': code },
      { initialize: false, startup: parseNativeXML(encodeCP932(golden.startupXML)) },
    );
    w.graphics.createLogicalDevice();
    if (initialize) await w.initialize('case.kcs');
    return w;
  }
  async function close(w) {
    for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
    await w.close({ flushFiles: false });
  }
  const object = (w, t, name) =>
    w.objects.objects.get(w.resolveTaskID(t.machine.load(slot(name)), t.id));
  function compare(w, t, r) {
    for (const e of r.state.actors) {
      const rec = object(w, t, e.name);
      assert.equal(Boolean(rec), e.alive, 'row' + r.ordinal + ' lifetime ' + e.name);
      if (!rec) continue;
      assert.equal(rec.kind, e.kind);
      assert.equal(rec.parent, e.parent === 'caller' ? t.id : object(w, t, e.parent).id);
      if (e.kind === 18) {
        const s = rec.implementation.state;
        assert.equal(s.capability, e.capability);
        assert.equal(s.active, e.active);
        if (e.params) {
          const params = e.params.map((n, i) =>
            !i && typeof n === 'string' ? t.machine.load(slot(n)) : n,
          );
          assert.deepEqual(s.params, params, 'row' + r.ordinal + ' live params');
          assert.equal(Number(s.geometry.converted), e.converted);
          if (e.elapsed !== undefined) {
            assert.equal(s.rasterElapsed, e.elapsed);
            assert.equal(s.lastClock, e.lastClock);
          }
        }
      }
    }
  }
  async function step(w, t, r) {
    if (r.operation) {
      if (r.operation === 'stopDriver') await w.sendEngine(t.id, t.id, 162, 0, 0);
      else await w.objects.tick(r.frame);
      compare(w, t, r);
      return;
    }
    const native = w.runtime.native,
      send = w.sendNativeEngine,
      events = [],
      copies = [],
      kindQueries = [];
    w.sendNativeEngine = async function (target, sender, message, wp, lp, context = {}) {
      const rec = this.objects.objects.get(this.resolveTaskID(target, sender));
      let e;
      if (r.id >= 196 && r.id <= 203 && message !== 13) {
        const channel = this.areaEffects.tasks.has(rec.id) ? 'area' : 'base';
        e = {
          name: r.args[0],
          kind: rec.kind,
          rawMessage: mapABIMessage(this.profile, channel, 'raw', message, rec.kind),
          payloadRole: null,
        };
        if ([196, 199, 201].includes(r.id) && context.payload) {
          const n = r.id === 199 ? 16 : r.packet.length,
            actual = Array.from({ length: n }, (_, i) => context.payload.load(lp + 4 * i)),
            expected = (r.id === 199 ? r.matrix : r.packet).map((a) =>
              typeof a === 'string' ? t.machine.load(slot(a)) : a,
            );
          assert.deepEqual(actual, expected, 'actual typed payload words');
          e.payloadWords = r.id === 199 ? actual : [...r.packet];
          e.payloadRole = r.id === 199 ? 'private64B-copy' : 'borrowed-VM';
          e.separateFromVM = context.payload !== t.machine;
          assert.equal(e.separateFromVM, r.id === 199);
          if (r.id === 199) copies.push({ payload: context.payload, words: actual });
        }
      }
      const result = await Reflect.apply(send, this, [target, sender, message, wp, lp, context]);
      if (message === 13 && r.id >= 196 && r.id <= 203) {
        assert.equal(result, rec.kind, 'complete Base dispatch writes real kind');
        kindQueries.push(result);
      }
      if (e) {
        e.receiverUnhandled = Boolean(context.nativeUnhandled);
        e.replyWritten = result !== NATIVE_UNWRITTEN_WORD;
        e.reply = e.replyWritten ? result : null;
        events.push(e);
      }
      return result;
    };
    w.runtime.native = async function (table, id, args, m, owner, ...rest) {
      if (id === 71 || owner.id !== t.id)
        return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
      assert.equal(id, r.id);
      if (r.text) m.bytes(128, encodeCP932(r.text).length + 1).set([...encodeCP932(r.text), 0]);
      if (r.packet)
        r.packet.forEach((n, i) =>
          m.store(640 + 4 * i, typeof n === 'string' ? m.load(slot(n)) : n),
        );
      if (r.matrix) r.matrix.forEach((n, i) => m.store(1024 + 4 * i, n));
      const before = m.memory.slice(0, 2048),
        reply = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
      assert.deepEqual(m.memory.slice(0, 2048), before);
      assert.equal(reply.control, r.control);
      if (!r.save) assert.equal(reply.value ?? null, r.result);
      return reply;
    };
    try {
      if (t.machine.waiting?.kind === 'message') await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
      else await w.runtime.scheduler.execute(t);
    } finally {
      w.runtime.native = native;
      w.sendNativeEngine = send;
    }
    assert.deepEqual(
      events,
      r.packets.filter((e) => e.rawMessage !== 13),
      'row' + r.ordinal + ' actual derived receiver handling/known reply',
    );
    assert.equal(
      kindQueries.length,
      r.packets.filter((e) => e.rawMessage === 13).length,
      'derived kind-query prefix reaches complete Base reply separately',
    );
    for (const c of copies) {
      const old = t.machine.load(1024);
      t.machine.store(1024, old ^ 1);
      assert.deepEqual(
        Array.from({ length: 16 }, (_, i) => c.payload.load(4 * i)),
        c.words,
        'owned packet remains isolated',
      );
      t.machine.store(1024, old);
    }
    compare(w, t, r);
  }
  test(
    'SDK' +
      version +
      ' actual Area matrix/live GCALLs, Root logic and eight independent cold continuations',
    async () => {
      const w = await make();
      try {
        const t = await w.spawnScript('area-live.kcs', {
            parent: w.main.id,
            initialExecute: false,
          }),
          floor = t.machine.sp;
        t.machine.store(slot('caller'), w.nativeTaskID(t.id));
        let cold = 0;
        for (const [index, r] of rows.entries()) {
          await step(w, t, r);
          assert.equal(t.machine.sp, floor);
          if (golden.coldAfter.includes(r.ordinal)) {
            const fresh = await make(false);
            try {
              await fresh.restore(
                await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
              );
              const restored = fresh.runtime.scheduler.tasks.get(t.id);
              compare(fresh, restored, r);
              await step(fresh, restored, rows[index + 1]);
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
  test('SDK' + version + ' protects the unwritten Top kind reply in live Area update', async () => {
    const w = await make();
    try {
      const t = w.main,
        m = t.machine;
      m.bytes(128, 10).set(encodeCP932('Area Top\0'));
      const top = (await w.runtime.native('main', 66, [1, w.nativeTaskID(t.id), 128], m, t)).value;
      await assert.rejects(
        () => w.runtime.native('main', 201, [top, 0, 640], m, t),
        /query did not write/,
      );
    } finally {
      await close(w);
    }
  });
}
