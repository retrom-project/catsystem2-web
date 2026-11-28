// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';

const golden = JSON.parse(
  await readFile(
    new URL('./fixtures/native-sdk23-image-owner-resource-chain.json', import.meta.url),
  ),
);
async function world(fixture, initialize = true) {
  const files = Object.fromEntries(fixture.files.map(([n, b]) => [n, Buffer.from(b, 'base64')]));
  return modernParticleMessageWorld(fixture.profile, files, {
    initialize,
    startup: parseXML(files['startup.xml'].toString()),
  });
}
async function bitmap(w, handle) {
  if (!handle) return null;
  const b = w.graphics.images.get(handle),
    s = b.state;
  return Object.fromEntries([
    ...[
      'width',
      'height',
      'bpp',
      'canvasWidth',
      'canvasHeight',
      'offsetX',
      'offsetY',
      'baseX',
      'baseY',
    ].map((k) => [k, s[k]]),
    ['clip', [...s.clip]],
    ['rgba', Buffer.from(await b.pixels()).toString('base64')],
  ]);
}
async function owner(w, handle) {
  if (!handle) return null;
  const o = w.imageOwners.get(handle);
  return {
    info: o.info.map((v) => v >>> 0),
    layers: o.layers?.length ?? null,
    bitmap: await bitmap(w, o.bitmap),
  };
}
function compareBitmap(actual, original) {
  for (const [key, value] of Object.entries(original))
    if (!['alphaHint', 'mask'].includes(key) && value !== null)
      assert.deepEqual(actual[key], value, 'bitmap ' + key);
}
for (const fixture of [golden, ...golden.followups])
  for (const coldAt of new Set([null, fixture.coldAt]))
    test(
      fixture.profile +
        ' real resource -> owner mutations -> pixel consumers and release' +
        fixture.rows.length +
        (coldAt === null ? '' : ' through independent current cold'),
      async () => {
        let w = await world(fixture);
        try {
          const t = await w.spawnScript('g1.kcs', { parent: w.main.id, initialExecute: false }),
            id = t.id,
            floor = t.machine.sp;
          for (const row of fixture.rows) {
            const task = w.runtime.scheduler.tasks.get(id);
            await w.runtime.scheduler.execute(task);
            const m = task.machine;
            assert.equal(m.load(floor), fixture.marker);
            assert.equal(m.sp, floor + 4);
            assert.deepEqual(
              fixture.projections.outputs.map((at) => m.load(at)),
              row.words,
              'defined results and mapped outputs phase ' + row.index,
            );
            assert.deepEqual(
              fixture.projections.metadata.map((at) => m.load(at)),
              row.metadata,
              'real HG2 descriptor metadata phase ' + row.index,
            );
            if (row.index < fixture.rows.length - 1) {
              compareBitmap(await bitmap(w, m.load(68)), row.decoded);
              for (const [k, at] of [
                ['source', 72],
                ['target', 76],
              ])
                if (row[k]) {
                  const actual = await owner(w, m.load(at));
                  assert.deepEqual(
                    actual.info,
                    row[k].info.map((v) => v >>> 0),
                    k + ' cached bounds',
                  );
                  if (row[k].layers !== null)
                    assert.equal(actual.layers, row[k].layers, k + ' loaded layers');
                  compareBitmap(actual.bitmap, row[k].bitmap);
                }
            }
            if (row.index === coldAt) {
              const checkpoint = structuredClone(w.snapshot()),
                fresh = await world(fixture, false);
              await fresh.restore(checkpoint);
              await w.close({ flushFiles: false });
              w = fresh;
            }
          }
          assert.equal(
            [...w.runtime.handles.records.values()].filter((r) => r.type === 'image-owner').length,
            0,
          );
        } finally {
          await w.close({ flushFiles: false });
        }
      },
    );
