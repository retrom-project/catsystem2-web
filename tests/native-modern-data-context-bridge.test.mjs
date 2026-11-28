// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const scene = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-scene-css-owner.json', import.meta.url)),
);
const groups = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-data-lifecycle.json', import.meta.url)),
).builds.find((b) => b.key === 'G2-74');
for (const [key, b, steps] of [
  ['container', scene, { writer: 2, reader: 1 }],
  ['registry-log-stack', groups, groups.steps],
])
  test(`own76 finite ${key} body/context bridge uses actual parsed consumers with cold`, async () => {
    const saved = new Map(),
      inputs = Object.fromEntries(
        b.inputs.map((r) => [r.name, new Uint8Array(Buffer.from(r.data, 'base64'))]),
      );
    const open = (initialize) =>
      modernParticleMessageWorld('nekopara-vol3-engine-2.6.1.76', inputs, {
        startup: parseXML(b.startup),
        initialize,
        storage: {
          read: async (n) => saved.get(n)?.slice() ?? null,
          write: async (n, data) => {
            saved.set(n, data.slice());
            return true;
          },
        },
      });
    let w = await open(true);
    try {
      for (const kind of ['writer', 'reader']) {
        let t = await w.spawnScript(kind + '.kcs', { initialExecute: false });
        for (let frame = 0; frame < steps[kind]; frame++) {
          await w.objects.update(t.id, frame);
          if (kind === 'writer' && frame === 0) {
            const id = t.id,
              state = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
            await w.close({ flushFiles: false });
            w = await open(false);
            await w.restore(state);
            t = w.runtime.scheduler.tasks.get(id);
          }
        }
        const r = b.rows.filter((r) => r.kind === kind).at(-1),
          p = b.projections[kind];
        assert.deepEqual(
          p.outputs.map((at) => t.machine.load(at)),
          r.words,
        );
        assert.deepEqual(
          p.spans.map(({ at, size }) => Buffer.from(t.machine.bytes(at, size)).toString('base64')),
          r.spans,
        );
      }
      assert.equal(w.nativeEngine, undefined);
    } finally {
      await w.close({ flushFiles: false });
    }
  });
