// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { kcsProgram } from './helpers.mjs';

const golden = JSON.parse(
  await readFile(
    new URL('./fixtures/native-sdk23-plane-geometry-input-chain.json', import.meta.url),
  ),
);
async function world(initialize = true, profile = golden.profile, extra = {}) {
  const files = Object.fromEntries(
    golden.files.map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]),
  );
  const w = await modernParticleMessageWorld(
    profile,
    { ...files, ...extra },
    {
      initialize,
      startup: parseXML(files['startup.xml'].toString()),
    },
  );
  w.graphics.createLogicalDevice();
  // The original qualified HWND has this observed client cursor position.
  // Host pointer coordinates are an input, separate from the SDK query contract.
  w.input.pointer(...golden.hostPoint);
  return w;
}
for (const coldAt of [null, ...golden.coldAt])
  test(
    'SDK23 Plane matrix and registered Input consume original geometry' +
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
          await w.objects.update(w.root, 1100 + row.index);
          const m = w.runtime.scheduler.tasks.get(id).machine,
            planeID = w.resolveTaskID(m.load(64), id);
          assert.equal(m.load(floor), golden.marker);
          assert.equal(m.sp, floor + 4);
          assert.equal(
            w.objects.objects.has(planeID),
            row.plane,
            'original task lifetime ' + row.index,
          );
          assert.deepEqual(
            Array.from({ length: 20 }, (_, i) => m.load(256 + i * 4)),
            row.words,
            'original defined geometry/cursor outputs phase ' + row.index,
          );
          assert.deepEqual(
            Array.from({ length: 4 }, (_, i) => m.load(576 + i * 4)),
            row.intersection,
          );
          assert.equal(m.load(68), row.source);
          assert.equal(m.load(72), row.flags);
          assert.deepEqual(
            w.input.regions.map((r) => ({
              owner: r.owner === planeID ? 'plane' : r.owner,
              priority: r.priority,
              bounds: r.bounds,
              active: r.active,
              enabled: r.enabled,
            })),
            row.inputRegions,
            'actual Input region geometry phase ' + row.index,
          );
          if (row.index === coldAt) {
            const checkpoint = structuredClone(w.snapshot()),
              fresh = await world(false);
            await fresh.restore(checkpoint);
            await w.close({ flushFiles: false });
            w = fresh;
          }
        }
        assert.equal(w.input.regions.length, 0);
      } finally {
        await w.close({ flushFiles: false });
      }
    },
  );

const profiles = [
  ['grisaia-jp-engine-2.6.1.23', true],
  ['rebellions-jp-engine-2.6.1.63', true],
  ['bokutomo-engine-2.6.1.67', true],
  ['sdk-4.01-engine-2.6.1.74', false],
  ['nekopara-vol3-engine-2.6.1.76', false],
];
for (const [profile, preserves] of profiles)
  for (const cold of [false, true])
    test(
      profile +
        ' primitive registration keeps its own occupied-key policy' +
        (cold ? ' after independent cold' : ''),
      async () => {
        const p = [19, 64],
          self = [19, 44],
          f = (n) => {
            const b = Buffer.alloc(4);
            b.writeFloatLE(n);
            return b.readUInt32LE();
          },
          phases = [
            [
              [68, [], 44],
              [66, [2, self, 1024], 64],
              [78, [p, f(6), f(4)]],
              [92, [p, 1]],
              [343, [p, 256, 260]],
            ],
            [
              [80, [p]],
              [343, [p, 256, 260]],
            ],
            [
              [79, [p, f(5), f(3), 0xff153a72]],
              [343, [p, 256, 260]],
            ],
            [
              [78, [p, f(7), f(2)]],
              [343, [p, 256, 260]],
            ],
          ],
          code = kcsProgram([
            [37, 0x504d4f44],
            [37, 0],
            [38, 1024],
            ...phases.flatMap((calls) => [
              ...calls.flatMap(([id, args, out]) => [
                ...args.map((a) => [37, a]),
                [43, id, args.length * 4],
                ...(out === undefined ? [] : [[38, out]]),
              ]),
              [37, 3968],
              [43, 71, 4],
              [38, 2360],
            ]),
            [59],
          ]),
          files = {
            'primitive.kcs': code,
            'scripts/primitive.kcs': code,
            'scripts-loose/primitive.kcs': code,
          };
        let w = await world(true, profile, files);
        try {
          const script = await w.spawnScript('primitive.kcs', {
              parent: w.main.id,
              initialExecute: false,
            }),
            id = script.id;
          for (const index of phases.keys()) {
            const task = w.runtime.scheduler.tasks.get(id);
            if (index) await w.runtime.scheduler.send(id, [1, 2, 3, 4]);
            else await w.runtime.scheduler.execute(task);
            const m = task.machine,
              graph = w.graphics.get(w.resolveTaskID(m.load(64), id)).graph;
            assert.deepEqual(
              [m.load(256), m.load(260)],
              (preserves || index === 0
                ? [6, 4]
                : index === 1
                  ? [0, 0]
                  : index === 2
                    ? [5, 3]
                    : [7, 2]
              ).map(f),
            );
            if (index > 0 && preserves)
              assert.equal(
                graph.registrationEnabled,
                true,
                'rejected candidate cannot hide the existing model',
              );
            if (index > 0 && !preserves)
              assert.equal(
                graph.registrationEnabled,
                false,
                'new model starts hidden while the Plane keeps its own shown state',
              );
            if (cold && index === 1) {
              const checkpoint = structuredClone(w.snapshot()),
                fresh = await world(false, profile, files);
              await fresh.restore(checkpoint);
              await w.close({ flushFiles: false });
              w = fresh;
            }
          }
        } finally {
          await w.close({ flushFiles: false });
        }
      },
    );
