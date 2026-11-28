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
        new URL('./fixtures/native-sdk' + version + '-stringplane-state.json', import.meta.url),
      ),
    ),
    names = ['caller', 'textA', 'textB'],
    slot = (n) => 2048 + 4 * names.indexOf(n),
    calls = golden.cases.filter((r) => r.id),
    code = kcsProgram(
      calls
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
      { 'stringplane-state.kcs': code },
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
  const object = (w, t, n) => w.objects.objects.get(w.resolveTaskID(t.machine.load(slot(n)), t.id));
  async function compare(w, t, row) {
    for (const expected of row.state) {
      const record = object(w, t, expected.name);
      assert.equal(
        !!record,
        expected.alive,
        'own original lifetime ' + expected.name + ' row' + row.ordinal,
      );
      if (!expected.alive) continue;
      assert.equal(record.kind, 8);
      assert.equal(record.parent, t.id);
      const owner = record.implementation,
        text = owner.text;
      assert.equal(text.configured, expected.configured, 'configured row' + row.ordinal);
      for (const [i, word] of Object.entries(expected.words))
        assert.equal(text.words[i] >>> 0, word, 'StringPlane word' + i + ' row' + row.ordinal);
      assert.deepEqual(
        text.rows.map((r) => Array.from(r, (n) => n >>> 0)),
        expected.cells,
        'all40B original cells row' + row.ordinal,
      );
      assert.equal(!!owner.bitmap, expected.configured);
      if (expected.bitmap) {
        const b = w.graphics.images.get(owner.bitmap);
        assert.equal(b.state.bpp, expected.bitmap.bpp);
        assert.equal(b.width, expected.bitmap.width);
        assert.equal(b.height, expected.bitmap.height);
        if (expected.bitmap.pixels)
          assert.deepEqual(
            [...(await b.pixels())],
            expected.bitmap.pixels,
            'only pixels produced by the actual native clear are compared',
          );
      }
      // Native font DC/row-metadata allocations have their original lifetime
      // journal; the JS backend owns cells and a stateless glyph service.
    }
  }
  async function step(w, t, row) {
    if (row.operation) {
      if (row.operation === 'stopDriver') await w.sendEngine(t.id, t.id, 162, 0, 0);
      else await w.objects.tick(row.frame);
    } else {
      const native = w.runtime.native;
      w.runtime.native = async function (table, id, args, m, owner, ...rest) {
        if (owner.id !== t.id || id === 71)
          return Reflect.apply(native, this, [table, id, args, m, owner, ...rest]);
        assert.equal(id, row.id);
        if (row.text !== undefined)
          m.bytes(128, encodeCP932(row.text).length + 1).set([...encodeCP932(row.text), 0]);
        if (row.header) {
          row.header.forEach((n, i) => m.store(640 + 4 * i, n));
          m.bytes(800, encodeCP932(row.forbidden).length + 1).set([
            ...encodeCP932(row.forbidden),
            0,
          ]);
        }
        const before = m.memory.slice(0, 2048),
          reply = await Reflect.apply(native, this, [table, id, args, m, owner, ...rest]),
          changed = [];
        for (let i = 0; i < 2048; i++)
          if (before[i] !== m.memory[i]) changed.push([i, m.memory[i]]);
        assert.equal(reply.control, row.control, 'original control Main' + id);
        if (!row.save) {
          if (typeof row.result === 'string' && row.result.startsWith('borrowed-bitmap:'))
            assert.equal(
              reply.value,
              object(w, t, row.args[0]).implementation.bitmap,
              'borrowed owner identity, not a physical-address integer',
            );
          else assert.equal(reply.value ?? null, row.result, 'original result Main' + id);
        }
        assert.deepEqual(changed, row.changed, 'original caller writes Main' + id);
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
    await compare(w, t, row);
  }
  test(
    'SDK' +
      version +
      ' own StringPlane state, CP932 cells, borrow/reconfigure/retire and eight current cold continuations',
    async () => {
      const w = await make();
      try {
        const t = await w.spawnScript('stringplane-state.kcs', {
            parent: w.main.id,
            initialExecute: false,
          }),
          floor = t.machine.sp;
        t.machine.store(slot('caller'), w.nativeTaskID(t.id));
        await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
        let cold = 0;
        for (const [index, row] of golden.cases.entries()) {
          await step(w, t, row);
          assert.equal(t.machine.sp, floor);
          if (golden.coldAfter.includes(index)) {
            const fresh = await make(false);
            try {
              await fresh.restore(
                await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
              );
              const restored = fresh.runtime.scheduler.tasks.get(t.id);
              await compare(fresh, restored, row);
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
      ' protects foreign Text receivers and preserves borrowed bitmap ownership through rebind',
    async () => {
      const w = await make();
      try {
        const t = w.main,
          m = t.machine,
          call = (id, args) => w.runtime.native('main', id, args, m, t);
        m.bytes(128, 6).set(encodeCP932('Owner\0'));
        const id = (await call(66, [8, w.nativeTaskID(t.id), 128])).value,
          plane = (await call(66, [2, w.nativeTaskID(t.id), 128])).value;
        for (const operation of [
          126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 138, 139, 391, 456,
        ]) {
          const row = golden.cases.find((r) => r.id === operation),
            args = row.args.map((a, i) => (i === 0 ? plane : typeof a === 'string' ? id : a));
          await assert.rejects(() => call(operation, args), /kind 8/);
        }
        await assert.rejects(() => call(129, [0]), /initialized 32-bit output/);
        const row = golden.cases.find((r) => r.id === 123);
        row.header.forEach((n, i) => m.store(640 + 4 * i, n));
        m.store(800, 0);
        await call(123, [id, 640, 800]);
        await call(125, [id]);
        const first = (await call(391, [id])).value;
        assert(w.graphics.images.get(first));
        await call(123, [id, 640, 800]);
        const next = (await call(391, [id])).value;
        assert.notEqual(next, first);
        assert.throws(() => w.graphics.images.get(first), /Unknown|Invalid|bitmap|image/i);
        assert(w.graphics.images.get(next));
        await call(67, [id]);
        await w.objects.tick(1);
        assert.throws(() => w.graphics.images.get(next), /Unknown|Invalid|bitmap|image/i);
      } finally {
        await close(w);
      }
    },
  );
}
