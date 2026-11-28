// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { parseXML } from '../src/xml.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-bitmap-area-root-chain.json', import.meta.url)),
);
async function world(initialize = true) {
  const files = Object.fromEntries(
    golden.files.map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]),
  );
  const w = await modernParticleMessageWorld(golden.profile, files, {
    initialize,
    startup: parseXML(files['startup.xml'].toString()),
  });
  w.graphics.createLogicalDevice();
  return w;
}
async function bitmap(w, handle) {
  if (!handle) return null;
  const b = w.graphics.images.get(handle);
  return {
    width: b.width,
    height: b.height,
    bpp: b.state.bpp,
    rgba: Buffer.from(await b.pixels()).toString('base64'),
  };
}
for (const coldAt of [null, ...golden.coldAt])
  test(
    'SDK23 bitmap -> BasePlane input -> Area Root draw/finish and release' +
      (coldAt === null ? '' : ' through independent cold after ' + coldAt),
    async () => {
      let w = await world();
      try {
        const script = await w.spawnScript(golden.script, {
            parent: w.main.id,
            initialExecute: false,
          }),
          id = script.id,
          floor = script.machine.sp;
        for (const row of golden.rows) {
          await w.objects.update(w.root, 1200 + row.index);
          if (golden.drawAt.includes(row.index)) await w.objects.drawTick(1200 + row.index);
          const m = w.runtime.scheduler.tasks.get(id).machine,
            baseID = m.load(76) ? w.resolveTaskID(m.load(76), id) : null,
            effectID = m.load(80) ? w.resolveTaskID(m.load(80), id) : null,
            effect = w.areaEffects.tasks.get(effectID);
          assert.equal(m.load(floor), golden.marker);
          assert.equal(m.sp, floor + 4);
          assert.deepEqual(
            [256, 260, 384, 388, 392, 396].map((at) => m.load(at)),
            row.words,
          );
          assert.deepEqual(
            Array.from({ length: 4 }, (_, i) => m.load(576 + i * 4)),
            row.intersection,
          );
          assert.equal(w.objects.objects.has(baseID), row.base);
          assert.equal(w.objects.objects.has(effectID), row.effect);
          assert.deepEqual(
            effect ? await bitmap(w, effect.state.work) : null,
            row.work,
            'original Area work pixels after actual Root draw ' + row.index,
          );
          for (const original of row.bitmaps)
            assert.deepEqual(
              await bitmap(w, m.load(original.slot)),
              original.bitmap,
              'original bitmap ' + original.slot + ' phase ' + row.index,
            );
          assert.deepEqual(
            w.input.regions.map((r) => ({
              owner: r.owner === baseID ? 'base' : r.owner,
              bounds: r.bounds,
              priority: r.priority,
              enabled: r.enabled,
              active: r.active,
            })),
            row.regions,
          );
          if (row.published) {
            const output = w.graphics.images.get(w.graphics.vramHandle),
              rgba = await output.pixels(),
              crop = [];
            for (let y = 0; y < row.published.height; y++)
              for (let x = 0; x < row.published.width; x++)
                crop.push(
                  ...rgba.subarray((y * output.width + x) * 4, (y * output.width + x) * 4 + 4),
                );
            assert.equal(
              Buffer.from(crop).toString('base64'),
              row.published.rgba,
              'original View upload source reaches VRAM crop ' + row.index,
            );
          }
          if (row.index === coldAt) {
            const checkpoint = structuredClone(w.snapshot()),
              fresh = await world(false);
            await fresh.restore(checkpoint);
            await w.close({ flushFiles: false });
            w = fresh;
          }
        }
        assert.equal(w.areaEffects.tasks.size, 0);
        assert.equal(w.input.regions.length, 0);
      } finally {
        await w.close({ flushFiles: false });
      }
    },
  );

for (const original of golden.copyCases)
  test(
    original.profile +
      ' ' +
      (original.title ?? 'scaled bitmap copy keeps untouched cells and native alias traversal'),
    async () => {
      const files = Object.fromEntries(
        original.files.map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]),
      );
      const w = await modernParticleMessageWorld(original.profile, files, {
        startup: parseXML(files['startup.xml'].toString()),
      });
      if (original.logicalDevice) w.graphics.createLogicalDevice();
      try {
        const script = await w.spawnScript(original.script, {
          parent: w.main.id,
          initialExecute: false,
        });
        const floor = script.machine.sp;
        for (const row of original.rows) {
          await w.runtime.scheduler.execute(script);
          assert.equal(script.machine.load(floor), original.marker);
          assert.equal(script.machine.sp, floor + 4);
          for (const expected of row.bitmaps)
            assert.deepEqual(
              await bitmap(w, script.machine.load(expected.slot)),
              expected.bitmap,
              'original resample/alias/clone phase ' + row.index + ' slot ' + expected.slot,
            );
        }
      } finally {
        await w.close({ flushFiles: false });
      }
    },
  );

test('SDK23 normal View output aliases, typed Plane, idle Input gates and empty Draw retire', async () => {
  const original = golden.viewCase;
  const files = Object.fromEntries(
    original.files.map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]),
  );
  const w = await modernParticleMessageWorld(original.profile, files, {
    startup: parseXML(files['startup.xml'].toString()),
  });
  w.graphics.createLogicalDevice();
  try {
    const script = await w.spawnScript(original.script, {
      parent: w.main.id,
      initialExecute: false,
    });
    const floor = script.machine.sp;
    for (const row of original.rows) {
      await w.objects.update(w.root, 900 + row.index);
      const m = script.machine;
      assert.equal(m.load(floor), original.marker);
      assert.equal(m.sp, floor + 4);
      assert.deepEqual(
        original.projections.map((at) => m.load(at)),
        row.words,
      );
      assert.equal(w.objects.objects.has(w.resolveTaskID(m.load(64), script.id)), row.plane);
      assert.equal(w.objects.objects.has(w.resolveTaskID(m.load(68), script.id)), row.draw);
    }
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('SDK23 normal LegacyText list/colour state, pending cells and CP932 output aliases retire', async () => {
  const original = golden.textCase;
  const files = Object.fromEntries(
    original.files.map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]),
  );
  const glyphs = {
    measure: () => ({
      width: 4,
      height: 6,
      ascent: 6,
      descent: 0,
      averageWidth: 4,
      maximumWidth: 4,
    }),
    glyph: () => ({
      width: 4,
      height: 6,
      originX: 0,
      originY: 6,
      advanceX: 4,
      advanceY: 0,
      alpha: new Uint8Array(24).fill(255),
    }),
  };
  const w = await dataWorld(original.profile, files, {
    glyphs,
    startup: parseXML(files['startup.xml'].toString()),
  });
  w.graphics.createLogicalDevice();
  try {
    const script = await w.spawnScript(original.script, {
      parent: w.main.id,
      initialExecute: false,
    });
    const floor = script.machine.sp;
    for (const row of original.rows) {
      await w.objects.update(w.root, 900 + row.index);
      const m = script.machine;
      assert.equal(m.load(floor), original.marker);
      assert.equal(m.sp, floor + 4);
      assert.deepEqual(
        original.projections.map((at) => m.load(at)),
        row.outputs,
      );
      for (const [i, at] of [256, 320].entries()) {
        const bytes = [];
        for (let n = 0; n < 128 && m.load(at + n, 1); n++) bytes.push(m.load(at + n, 1));
        assert.equal(Buffer.from(bytes).toString('base64'), row.plain[i]);
      }
      const text = w.objects.objects.get(w.resolveTaskID(m.load(64), script.id))?.implementation;
      assert.equal(!!text, row.text);
      if (text) {
        for (const [word, value] of Object.entries(row.words))
          assert.equal(
            word === '172' ? text.text.rows.length : text.text.w(Number(word)) >>> 0,
            value,
          );
        assert.deepEqual(
          text.text.rows.map((cell) => Array.from(cell, (value) => value >>> 0)),
          row.cells,
        );
        assert.deepEqual(
          await bitmap(w, text.bitmap),
          row.bitmap,
          'pending bitmap before later publication',
        );
      }
    }
  } finally {
    await w.close({ flushFiles: false });
  }
});
