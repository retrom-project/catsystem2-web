// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { floatBits } from '../src/kcs.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

for (const version of ['74', '76']) {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-modern-plane-inheritance.json', import.meta.url)),
    ).profiles[version],
    names = ['caller', 'top', 'parent', 'child'],
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
      { 'plane-inheritance.kcs': code },
      {
        initialize: false,
        startup: parseNativeXML(encodeCP932(golden.startupXML)),
      },
    );
    w.graphics.createLogicalDevice();
    if (initialize) {
      await w.initialize('case.kcs');
      await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
      await w.objects.tick(0);
    }
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
    for (const name of ['top', 'parent', 'child']) {
      const obj = object(w, t, name);
      if (obj)
        assert.equal(
          obj.parent,
          name === 'top' ? t.id : object(w, t, name === 'parent' ? 'top' : 'parent').id,
        );
    }
    for (const e of row.state.planeWords) {
      const plane = object(w, t, e.name).implementation;
      assert.equal(Number(plane.state.inheritPosition), e.inherit, e.name + ' inheritance flag');
      assert.deepEqual(
        plane.state.parentOffset.map(floatBits),
        e.offset,
        e.name + ' copied offset',
      );
    }
  }
  async function step(w, t, row) {
    if (row.operation) {
      await w.objects.update(object(w, t, 'top').id, row.frame);
      await w.objects.drawTick(row.frame);
    } else {
      const native = w.runtime.native;
      w.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (id === 71) return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
        assert.equal(id, row.id);
        if (row.text)
          m.bytes(128, encodeCP932(row.text).length + 1).set([...encodeCP932(row.text), 0]);
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
      ' original Plane priority/inheritance GCALLs, actual child traversal and eight cold continuations',
    async () => {
      const w = await make();
      try {
        const t = await w.spawnScript('plane-inheritance.kcs', {
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
    'SDK' + version + ' keeps missing model outputs and foreign inheritance receivers guarded',
    async () => {
      const w = await make();
      try {
        const t = w.main,
          m = t.machine,
          call = (id, args) => w.runtime.native('main', id, args, m, t);
        m.bytes(128, 6).set(encodeCP932('Guard\0'));
        const planeID = (await call(66, [2, w.nativeTaskID(t.id), 128])).value,
          topID = (await call(66, [1, w.nativeTaskID(t.id), 128])).value,
          plane = w.graphics.get(w.resolveTaskID(planeID, t.id));
        for (const id of [89, 90, 91])
          await assert.rejects(
            () => call(id, id === 90 ? [topID, 0, 0, 0] : [topID]),
            /reviewed Plane receiver/,
          );
        await assert.rejects(() => call(89, [planeID]), /initialized 32-bit output word/);
        await assert.rejects(() => call(90, [planeID, 0x7fc01234, 0, 0]), /finite offsets/);
        assert.equal(plane.state.inheritPosition, false);
        assert.deepEqual(await call(89, [0]), { control: 1, value: 0 });
        assert.deepEqual(await call(90, [0, 0, 0, 0]), { control: 2 });
        assert.deepEqual(await call(91, [0]), { control: 2 });
      } finally {
        await close(w);
      }
    },
  );
}
