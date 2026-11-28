// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-draw-root-resource-chain.json', import.meta.url)),
);
async function world(initialize = true) {
  const files = Object.fromEntries(
    golden.files.map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]),
  );
  return modernParticleMessageWorld(golden.profile, files, {
    initialize,
    startup: parseXML(files['startup.xml'].toString()),
  });
}
for (const coldAt of [null, ...golden.coldAt])
  test(
    'SDK23 Root consumes Draw clipping, retained replacement and base bitmap' +
      (coldAt === null ? '' : ' through cold after phase ' + coldAt),
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
          await w.objects.update(w.root, 900 + row.index);
          const m = w.runtime.scheduler.tasks.get(id).machine;
          assert.equal(m.load(floor), golden.marker);
          assert.equal(m.sp, floor + 4);
          const draw = w.graphics.drawTasks.get(w.resolveTaskID(m.load(64), id)),
            renderer = draw?.state.renderer;
          assert.equal(!!draw, row.draw, 'Draw lifecycle phase ' + row.index);
          assert.equal(!!renderer, row.renderer, 'renderer lifecycle phase ' + row.index);
          assert.equal(
            renderer?.items.length ?? null,
            row.items,
            'retained list phase ' + row.index,
          );
          if (row.bitmap) {
            const bitmap = w.graphics.images.get(renderer.bitmap);
            assert.equal(bitmap.width, row.bitmap.width);
            assert.equal(bitmap.height, row.bitmap.height);
            assert.equal(
              Buffer.from(await bitmap.pixels()).toString('base64'),
              row.bitmap.rgba,
              'actual original raster phase ' + row.index,
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
        assert.equal(w.graphics.drawTasks.size, 0);
        assert.equal(
          [...w.runtime.handles.records.values()].filter((r) => r.type === 'image-owner').length,
          0,
        );
      } finally {
        await w.close({ flushFiles: false });
      }
    },
  );
