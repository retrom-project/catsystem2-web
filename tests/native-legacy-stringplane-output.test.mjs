// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { legacyStringPlaneFonts } from './fixtures/legacy-stringplane-fonts.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

for (const version of ['63', '67']) {
  const golden = JSON.parse(
      await readFile(
        new URL(
          './fixtures/native-sdk' + version + '-stringplane-gdi-output.json',
          import.meta.url,
        ),
      ),
    ),
    names = ['caller', 'textA', 'textB', 'atlas', 'replacement'],
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
  const providers = new WeakMap();
  async function make(initialize = true) {
    const provider = await legacyStringPlaneFonts(golden.profile),
      w = await dataWorld(
        golden.profile,
        { 'stringplane-gdi-output.kcs': code },
        {
          initialize: false,
          startup: parseNativeXML(encodeCP932(golden.startupXML)),
          glyphs: provider.port,
        },
      );
    providers.set(w, provider);
    assert.equal(provider.fontSHA256, golden.source.fontHost.fontSHA256);
    w.graphics.createLogicalDevice();
    if (initialize) await w.initialize('case.kcs');
    return w;
  }
  async function close(w) {
    for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
    try {
      await w.close({ flushFiles: false });
    } finally {
      providers.get(w)?.close();
    }
  }
  const object = (w, t, n) => w.objects.objects.get(w.resolveTaskID(t.machine.load(slot(n)), t.id));
  async function compare(w, t, row) {
    const record = object(w, t, 'textA');
    assert.equal(record.kind, 8);
    const expected = row.state[0].bitmap;
    if (expected?.rgbaBase64)
      assert.equal(
        Buffer.from(await w.graphics.images.get(record.implementation.bitmap).pixels()).toString(
          'base64',
        ),
        expected.rgbaBase64,
        'original native bitmap ' + row.ordinal,
      );
    const actual = [...w.graphics.texturePages.pages.values()].map((p) => ({
      width: p.frame.width,
      height: p.frame.height,
      rgbaBase64: Buffer.from(p.frame.rgba).toString('base64'),
    }));
    assert.deepEqual(actual, row.pages, 'all configured COM-memory texture pixels ' + row.ordinal);
  }
  async function step(w, t, row) {
    if (row.operation) {
      if (row.operation === 'stopDriver') await w.sendEngine(t.id, t.id, 162, 0, 0);
      else if (row.operation === 'draw') await w.objects.drawTick(row.frame);
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
      ' own StringPlane mode0 GDI bitmap and configured View page output with the same fixed host font',
    async () => {
      const w = await make();
      try {
        const t = await w.spawnScript('stringplane-gdi-output.kcs', {
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
        assert.equal(cold, 0);
      } finally {
        await close(w);
      }
    },
  );
}
