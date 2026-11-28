// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { floatBits } from '../src/kcs.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk67-plane-file-models.json', import.meta.url)),
);
for (const profile of [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
])
  test(
    profile + ' KX2 registration, independent owner metadata and current cold child notification',
    async () => {
      async function make(init = true) {
        const w = await dataWorld(
          profile,
          { 'shape.kx2': Uint8Array.from(golden.resources['shape.kx2']) },
          { initialize: false, startup: parseNativeXML(encodeCP932(golden.startupXML)) },
        );
        w.graphics.createLogicalDevice();
        if (init) {
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
      const w = await make();
      let fresh;
      try {
        const id = await w.objects.create({
            kind: 2,
            parent: w.main.id,
            name: 'original common KX2 gate',
          }),
          task = w.objects.objects.get(id).implementation;
        const load = async (task) => {
          const b = encodeCP932('shape.kx2\0'),
            p = new NativeGraphicsPacket(new Array(Math.ceil(b.length / 4)).fill(0));
          p.bytes(0, b.length).set(b);
          await task.message([0, 70, 0, 0], { payload: p });
        };
        const count = async (task) => {
          let n = 0;
          await task.drawGPU({ drawGeometry: () => n++ });
          return n;
        };
        await load(task);
        assert.equal(task.state.shown, true);
        assert.equal(task.graph.registrationEnabled, false);
        assert.equal(task.graph.registrationWord, 0);
        assert.equal(await count(task), 0);
        await task.message([0, 47, 0, 1]);
        assert.equal(task.graph.registrationEnabled, true);
        assert((await count(task)) > 0);
        const type = task.state.drawType,
          path = task.state.modelFilename;
        await task.message([0, 68, 0, 0]);
        assert.equal(task.graph, null);
        assert.deepEqual(task.state.rect, [-2, -1, 0, 0]);
        assert.equal(task.state.drawType, type);
        assert.equal(task.state.modelFilename, path);
        assert.equal(task.state.shown, true);
        await load(task);
        assert.equal(await count(task), 0);
        fresh = await make(false);
        await fresh.restore(await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())));
        const restored = fresh.objects.objects.get(id).implementation;
        assert.equal(restored.state.modelFilename, path);
        assert.equal(restored.state.shown, true);
        assert.equal(await count(restored), 0);
        await restored.message([0, 48, 0, 1]);
        assert.equal(restored.graph.registrationEnabled, true);
        assert((await count(restored)) > 0);
        await restored.message([0, 47, 0, 0]);
        await load(restored);
        await restored.message([0, 48, 0, 1]);
        assert.equal(restored.state.shown, false);
        assert.equal(await count(restored), 0);
        await restored.message([0, 47, 0, 1]);
        for (const [priority, visible] of [
          [-1, false],
          [0, true],
          [999999, true],
          [1000000, false],
          [NaN, false],
        ]) {
          new DataView(restored.graph.kx2.buffer).setFloat32(20, priority, true);
          assert.equal(
            (await count(restored)) > 0,
            visible,
            'native complete manager priority window',
          );
        }
        const previousGraph = restored.graph;
        const rectangle = async () =>
          restored.message([0, 42, 0, 0], {
            payload: new NativeGraphicsPacket([
              0,
              0,
              0,
              floatBits(8),
              floatBits(6),
              0,
              0,
              0xff4080c0,
            ]),
          });
        await rectangle();
        if (
          [
            'grisaia-jp-engine-2.6.1.23',
            'rebellions-jp-engine-2.6.1.63',
            'bokutomo-engine-2.6.1.67',
          ].includes(profile)
        ) {
          assert.equal(
            restored.graph,
            previousGraph,
            'occupied legacy primitive keeps its original model',
          );
          await restored.message([0, 68, 0, 0]);
          await rectangle();
        }
        assert.equal(restored.graph.registrationEnabled, false);
        assert.equal(
          await count(restored),
          0,
          'ordinary rectangle starts hidden independently of own shown',
        );
        await restored.message([0, 47, 0, 1]);
        assert((await count(restored)) > 0, 'normal show publishes ordinary rectangle');
      } finally {
        if (fresh) await close(fresh);
        await close(w);
      }
    },
  );
