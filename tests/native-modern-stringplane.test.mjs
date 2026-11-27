// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { LegacyTextState } from '../src/native/legacy-text-state.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

for (const version of ['74', '76']) {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-modern-stringplane-state.json', import.meta.url)),
    ).profiles[version],
    names = ['caller', 'textA', 'textB', 'atlas'],
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
      { 'modern-stringplane.kcs': code },
      {
        initialize: false,
        startup: parseNativeXML(
          encodeCP932(
            '<?xml version="1.0" encoding="' +
              (version === '74' ? 'Shift_JIS' : 'UTF-8') +
              '"?><document><SCREEN><width>64</width><height>64</height></SCREEN><TEXTURE><size><x>8</x><y>8</y></size><vt><x>2</x><y>2</y></vt><bpp>32</bpp></TEXTURE></document>',
          ),
        ),
        glyphs: {
          measure() {
            throw new Error('Atlas fixture cannot measure fallback GDI glyphs');
          },
          glyph() {
            throw new Error('Atlas fixture cannot draw fallback GDI glyphs');
          },
        },
      },
    );
    w.graphics.createLogicalDevice();
    if (initialize) {
      await w.initialize('case.kcs');
      await w.sendEngine(w.main.id, w.main.id, 162, 0, 0);
      // The original host creates its Top/Script at clock zero before any Frame.
      await w.objects.tick(0);
    }
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
      assert.equal(text.configured, !!expected.bitmap, 'configured row' + row.ordinal);
      for (const [i, word] of Object.entries(expected.words))
        assert.equal(text.words[i] >>> 0, word, 'StringPlane word' + i + ' row' + row.ordinal);
      assert.deepEqual(
        text.rows.map((r) => Array.from(r, (n) => n >>> 0)),
        expected.cells,
        'all40B original cells row' + row.ordinal,
      );
      assert.equal(!!owner.bitmap, !!expected.bitmap);
      if (expected.bitmap) {
        const b = w.graphics.images.get(owner.bitmap);
        assert.equal(b.state.bpp, expected.bitmap.bpp);
        assert.equal(b.width, expected.bitmap.width);
        assert.equal(b.height, expected.bitmap.height);
        if (expected.bitmap.rgbaBase64)
          assert.equal(
            Buffer.from(await b.pixels()).toString('base64'),
            expected.bitmap.rgbaBase64,
            'own native raster pixels row' + row.ordinal,
          );
        if (expected.atlas) {
          assert(owner.imageFont);
          assert.equal(
            Buffer.from(owner.imageFont.rgba).toString('base64'),
            expected.atlas.rgbaBase64,
            'private font atlas row' + row.ordinal,
          );
        }
      }
      // Native font DC/row-metadata allocations have their original lifetime
      // journal; the JS backend owns cells and a stateless glyph service.
    }
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
      ' own modern StringPlane typed state, colour/font consumers, pixels/retire and eight independent cold continuations',
    async () => {
      const w = await make();
      try {
        const t = await w.spawnScript('modern-stringplane.kcs', {
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
}

test('StringPlane escaped ASCII preserves later controls after clipping; DBC and literal text stop', () => {
  const make = (escape, height = 8) => {
    const text = new LegacyTextState(),
      words = new Int32Array(282);
    words[2] = 64;
    words[3] = height;
    words[6] = 10;
    words[15] = 16;
    words[20] = escape;
    text.configure(new Uint8Array(words.buffer), 282);
    text.clear();
    [8, 9, 10, 11, 12].forEach((n, i) => text.w(471 + i, n));
    return text;
  };
  const clipped = make(1);
  assert.equal(clipped.append(encodeCP932('\\fl;A\\fs;B\\c17;')), 0);
  assert.equal(clipped.w(183), 9);
  assert.equal(clipped.w(46), 17);
  assert.equal(clipped.rows.length, 0);
  const recovery = make(1);
  assert.equal(recovery.append(encodeCP932('A\\f6;B')), 1);
  assert.deepEqual(
    recovery.rows.map((r) => [r[0], r[5]]),
    [[66, 6]],
  );
  const dbc = make(1);
  dbc.append(encodeCP932('あ\\f6;B'));
  assert.equal(dbc.w(183), 10);
  assert.equal(dbc.rows.length, 0);
  const literal = make(0);
  literal.append(encodeCP932('A\\f6;B'));
  assert.equal(literal.w(183), 10);
  assert.equal(literal.rows.length, 0);
});

for (const version of ['74', '76']) {
  test(
    'SDK' + version + ' StringPlane keeps wrong receiver/arity and unproved entry guards',
    async () => {
      const profile =
          version === '74' ? 'sdk-4.01-engine-2.6.1.74' : 'nekopara-vol3-engine-2.6.1.76',
        code = kcsProgram([[37, 256], [43, 71, 4], [59]]),
        w = await dataWorld(profile, { 'guard.kcs': code });
      try {
        const task = await w.spawnScript('guard.kcs', { parent: w.main.id, initialExecute: false }),
          m = task.machine;
        await assert.rejects(
          w.runtime.native('main', 585, [w.nativeTaskID(w.main.id), 0], m, task),
          /kind 8/,
        );
        await assert.rejects(
          w.runtime.native('main', 599, [0, 1], m, task),
          /expects 6 argument words/,
        );
        await assert.rejects(
          w.runtime.native('main', 124, [0, 128, 0], m, task),
          /expects 2 argument words/,
        );
        assert.equal(nativeABI(profile).tables.main.entries[585].status, 'recovered');
        assert.equal(nativeABI(profile).tables.main.entries[599].status, 'recovered');
        for (const id of [600, 601, 688]) {
          assert.equal(nativeABI(profile).tables.main.entries[id].status, 'unknown');
          await assert.rejects(
            async () => w.runtime.native('main', id, [], m, task),
            /Unreviewed|Unsupported/,
          );
        }
      } finally {
        for (const t of w.runtime.scheduler.tasks.values()) w.runtime.scheduler.cancel(t.id, false);
        await w.close({ flushFiles: false });
      }
    },
  );
}
