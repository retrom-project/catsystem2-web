// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-plane-mesh.json', import.meta.url)),
).profiles;

for (const version of ['74', '76'])
  test(`SDK${version} mesh registration visibility stays separate from Plane own and MOT display`, async () => {
    const golden = fixture[version];
    async function make(initialize = true) {
      const w = await dataWorld(
        golden.profile,
        {},
        {
          initialize,
          startup: parseNativeXML(encodeCP932(golden.startupXML)),
        },
      );
      w.graphics.createLogicalDevice();
      return w;
    }
    async function check(w, id, ownShown, registration) {
      const plane = w.graphics.get(id),
        graph = plane.graph,
        draws = [];
      assert.equal(plane.state.shown, ownShown, 'persistent Plane own gate');
      assert.equal(graph.style.shown, ownShown);
      assert.equal(graph.registrationEnabled, registration, 'independent model record gate');
      assert.equal(w.graphics.stage.planes[plane.stageKey].visible, ownShown && registration);
      assert.equal(w.graphics.attachment(plane.record.nativeID).display, ownShown && registration);
      await plane.drawGPU({ drawGeometry: (geometry, frame) => draws.push({ geometry, frame }) });
      assert.equal(draws.length, Number(ownShown && registration), 'actual draw consumer');
    }
    for (const shown of [true, false]) {
      const w = await make();
      let cold;
      try {
        const t = w.main,
          m = t.machine,
          call = (id, args) => w.runtime.native('main', id, args, m, t);
        m.bytes(128, 5).set(encodeCP932('Mesh\0'));
        const parent = (await call(66, [2, w.nativeTaskID(t.id), 128])).value,
          child = (await call(66, [2, parent, 128])).value,
          id = w.resolveTaskID(child, t.id),
          parentID = w.resolveTaskID(parent, t.id),
          notify = (current, value) => current.sendEngine(id, parentID, 48, 0, value);
        await call(79, [parent, 0x41000000, 0x41000000, 0xff203040]);
        await call(92, [parent, 1]);
        await call(542, []);
        golden.cases
          .find((r) => r.id === 467)
          .input.slice(0, 16)
          .forEach((word, i) => m.store(1024 + 4 * i, word));
        await call(467, [child, 1024, 1]);
        await call(92, [child, Number(shown)]);
        await call(467, [child, 1024, 1]);
        await check(w, id, shown, false);
        if (shown) {
          cold = await make(false);
          await cold.restore(await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())));
          await check(cold, id, true, false);
          await notify(cold, 1);
          await check(cold, id, true, true);
          await notify(cold, 0);
          await check(cold, id, true, false);
        }
        await notify(w, 1);
        await check(w, id, shown, shown);
        await notify(w, 0);
        await check(w, id, shown, false);
        await call(83, [child]);
        assert.equal(w.graphics.get(id).state.shown, shown, 'unload preserves own gate');
        await call(467, [child, 1024, 1]);
        await check(w, id, shown, false);
        await notify(w, 1);
        await check(w, id, shown, shown);
        await call(67, [child]);
        await w.objects.tick(2);
        assert.equal(w.objects.objects.has(id), false);
        assert.equal(w.graphics.tasks.has(id), false);
      } finally {
        if (cold) await cold.close({ flushFiles: false });
        await w.close({ flushFiles: false });
      }
    }
  });
