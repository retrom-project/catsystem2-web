// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

for (const version of ['63', '67']) {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-sdk' + version + '-plane-buttons.json', import.meta.url),
      ),
    ),
    names = ['caller', 'plane', 'hint'],
    at = (name) => 2048 + names.indexOf(name) * 4,
    calls = golden.cases.filter((r) => r.id),
    code = kcsProgram(
      calls
        .flatMap((r) => [
          ...r.args.map((a) => [37, typeof a === 'string' ? [0x13, at(a)] : a]),
          [43, r.id, r.args.length * 4],
          ...(r.control === 1 ? [[38, r.save ? at(r.save) : 2304]] : []),
          [37, 3968],
          [43, 71, 4],
          [38, 2360],
        ])
        .concat([[59]]),
    );
  async function make(initialize = true) {
    const w = await dataWorld(
      golden.profile,
      { 'plane-buttons.kcs': code },
      {
        initialize: false,
        startup: parseNativeXML(encodeCP932(golden.startupXML)),
      },
    );
    w.graphics.createLogicalDevice();
    if (initialize) await w.initialize('case.kcs');
    return w;
  }
  async function close(w) {
    for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
    await w.close({ flushFiles: false });
  }
  const object = (w, t, name) => {
    const id = t.machine.load(at(name));
    return id ? w.objects.objects.get(w.resolveTaskID(id, t.id)) : undefined;
  };
  function compare(w, t, row) {
    for (const e of row.state.liveTypes)
      assert.equal(!!object(w, t, e.name), e.alive, e.name + ' original lifetime');
    for (const e of row.state.planes) {
      const record = object(w, t, e.name),
        owner = record.implementation,
        s = owner.state;
      assert.equal(record.parent, t.id, 'actual factory child owner');
      assert.equal(s.phase, e.phase, 'retained button phase');
      assert.equal(Number(s.blocked), e.blocked, 'independent blocked high bit');
      assert.equal(Number(s.buttonEnabled), e.buttonEnabled, 'button enable survives clear');
      assert.deepEqual(s.button, e.button, 'twelve original copied/cleared words');
      assert.equal(s.frameStep >>> 0, e.attribute, 'complete hint attribute');
      assert.equal(
        s.imageIndex === -1 ? -1 : w.resolveTaskID(s.imageIndex, record.id),
        e.imageIndex === -1 ? -1 : object(w, t, e.imageIndex).id,
        'owned hint ID',
      );
      assert.equal(
        s.receiver === -1 ? -1 : w.resolveTaskID(s.receiver, record.id),
        e.receiver === -1 ? -1 : object(w, t, e.receiver).id,
        'callback receiver ID',
      );
      if (e.buttonFlags !== undefined) assert.equal(s.buttonFlags >>> 0, e.buttonFlags);
      if (e.bindFlags !== undefined) assert.equal(s.bindFlags >>> 0, e.bindFlags);
      if (e.shown !== undefined) assert.equal(s.shown, e.shown, 'actual hint display message');
    }
    const input = w.inputFor(t.id);
    assert.equal(input.regions.length, row.state.regions.length, 'actual registered Input records');
    for (const e of row.state.regions) {
      const r = input.get(object(w, t, e.owner).id);
      assert(r);
      assert.deepEqual(r.bounds, e.bounds, 'original registered geometry');
      assert.equal(r.priority | 0, e.priority);
      assert.equal(r.mask, e.mask);
      assert.equal(r.active, e.active);
      assert.equal(Number(r.enabled), e.enabled);
      assert.equal(Number(r.hoverEnabled), e.hover);
      assert.equal(Number(r.dragEnabled), e.dragEnabled);
      assert.equal(r.alpha, null, 'no bitmap mask owner');
      // Original record word10 was not initialized by this registration path.
      // It is deliberately absent from the functional state comparison.
    }
    assert.equal(
      ['plane', 'hint'].filter((n) => object(w, t, n)?.implementation.graph).length,
      row.state.modelCount,
    );
  }
  async function step(w, t, row) {
    if (row.operation) {
      await w.objects.tick(row.frame);
      await w.objects.drawTick(row.frame);
    } else {
      const native = w.runtime.native;
      w.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
        assert.equal(id, row.id);
        if (row.text)
          m.bytes(128, encodeCP932(row.text).length + 1).set([...encodeCP932(row.text), 0]);
        if (row.seed) row.seed.forEach((word, i) => m.store(row.seedAt + i * 4, word));
        for (const o of row.outputs) m.bytes(o.at, o.bytes.length).fill(0xa5);
        const before = m.memory.slice(0, 2048),
          reply = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]),
          changed = [];
        for (let i = 0; i < 2048; i++)
          if (before[i] !== m.memory[i]) changed.push([i, m.memory[i]]);
        assert.equal(reply.control, row.control, 'original control Main' + id);
        if (!row.save) assert.equal(reply.value ?? null, row.result, 'original result Main' + id);
        assert.deepEqual(changed, row.changed, 'all original caller data writes Main' + id);
        for (const o of row.outputs) assert.deepEqual([...m.bytes(o.at, o.bytes.length)], o.bytes);
        return reply;
      };
      try {
        if (t.machine.waiting?.kind === 'message')
          await w.runtime.scheduler.send(t.id, [1, 2, 3, 4]);
        else await w.runtime.scheduler.execute(t);
      } finally {
        w.runtime.native = native;
      }
    }
    compare(w, t, row);
  }
  test(
    'SDK' +
      version +
      ' real Plane tables, Input registration/clear/rebind, hint and eight independent cold continuations',
    async () => {
      const w = await make();
      try {
        const t = await w.spawnScript('plane-buttons.kcs', {
            parent: w.main.id,
            initialExecute: false,
          }),
          floor = t.machine.sp;
        t.machine.store(at('caller'), w.nativeTaskID(t.id));
        await w.sendEngine(t.id, t.id, 162, 0, 0);
        await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
        let cold = 0;
        for (const [index, row] of golden.cases.entries()) {
          await step(w, t, row);
          assert.equal(t.machine.sp, floor, 'driver stack canary boundary');
          if (golden.coldAfter.includes(index)) {
            const fresh = await make(false);
            try {
              await fresh.restore(
                await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
              );
              const restored = fresh.runtime.scheduler.tasks.get(t.id);
              compare(fresh, restored, row);
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
  test(
    'SDK' +
      version +
      ' protects unresolved Input ownership and validates current button cold state',
    async () => {
      const w = await make();
      try {
        const t = w.main,
          m = t.machine,
          call = (id, args) => w.runtime.native('main', id, args, m, t);
        m.bytes(128, 6).set(encodeCP932('Guard\0'));
        [1, 3, 4, 1, 5, 6, 0, 7, 8, 0, 9, 10].forEach((word, i) => m.store(512 + 4 * i, word));
        const topID = (await call(66, [1, w.nativeTaskID(t.id), 128])).value,
          nestedID = (await call(66, [2, topID, 128])).value,
          primaryID = (await call(66, [2, w.nativeTaskID(t.id), 128])).value,
          nested = w.graphics.get(w.resolveTaskID(nestedID, t.id)),
          primary = w.graphics.get(w.resolveTaskID(primaryID, t.id));
        for (const id of [96, 97, 98, 99, 102, 103, 110])
          await assert.rejects(
            () =>
              call(id, id === 96 ? [topID, 0, 512] : id === 98 || id === 99 ? [topID] : [topID, 0]),
            /reviewed Plane receiver/,
          );
        await assert.rejects(() => call(96, [primaryID, 0, 512]), /requires live model geometry/);
        await call(79, [nestedID, 0x40800000, 0x40800000, 0xff203040]);
        await assert.rejects(() => call(96, [nestedID, 0, 512]), /routable zero-ID Top reply/);
        assert.deepEqual(nested.state.button, new Array(12).fill(0));
        assert.equal(nested.input.regions.length, 0);
        assert.deepEqual(
          await call(99, [nestedID]),
          { control: 2 },
          'clear does not consume an absent registration',
        );
        const snapshot = primary.snapshot();
        for (const change of [
          (s) => s.button.pop(),
          (s) => (s.button[0] = -1),
          (s) => delete s.buttonEnabled,
        ]) {
          const corrupt = structuredClone(snapshot);
          change(corrupt.state);
          assert.throws(() => primary.restore(corrupt), /Invalid ordinary Plane button checkpoint/);
        }
        assert.deepEqual(primary.snapshot(), snapshot, 'validation precedes owner mutation');
        assert.deepEqual(await call(96, [0, 0, 512]), { control: 2 });
        assert.deepEqual(await call(98, [0]), { control: 1, value: 0 });
      } finally {
        await close(w);
      }
    },
  );
}
