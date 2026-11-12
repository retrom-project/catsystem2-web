// SPDX-License-Identifier: MPL-2.0
// Explicit D8 transport regression. Default FES never sends these PE inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from './fixtures/oracle-fixtures.mjs';
import { defaultFESWorld } from './fixtures/default-fes-world.mjs';
import { transitionalExe } from '../web/transitional-entry.mjs';
import { floatBits } from '../src/kcs.mjs';

for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} explicit raw bitmap Draw/Area inputs use the D8 consumer view and fresh restore`,
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const make = async () => {
          const world = await defaultFESWorld(
            fixture.profile,
            { 'engine.exe': fixture.bytes },
            { initialize: false },
          );
          delete world.ensureNativeEngine;
          world.transitionalExe = transitionalExe;
          return world;
        },
        world = await make();
      let fresh;
      try {
        await world.initialize('case.kcs');
        const owner = world.main.id,
          images = world.graphics.images,
          bitmap = images.create(2, 2, owner);
        await images.get(bitmap).fill(0, 0, 2, 2, 0xff112233);
        const memory = await world.getNativeFeature('bitmap-memory'),
          wrapper = await memory.wrapper(bitmap),
          p = world.nativeEngine.process,
          drawID = await world.objects.create({ kind: 15, parent: owner }),
          areaID = await world.objects.create({ kind: 27, parent: owner }),
          fields = [
            p.load(wrapper),
            0,
            0,
            0,
            ...[0, 0, 0, 0, 0, 1, 1].map(floatBits),
            255,
            1,
            0,
            0,
          ],
          input = p.allocate(60, true),
          areaInput = p.allocate(44, true),
          context = { nativePointer: true, payload: p };
        await world.sendEngine(drawID, owner, 279, 2, 2);
        await world.sendEngine(drawID, owner, 283);
        fields.forEach((value, i) => p.store(input + i * 4, value));
        await world.sendEngine(drawID, owner, 280, 7, input, context);
        [3, wrapper, 0, 0, wrapper, 0, 0, 0, 0, 2, 2].forEach((value, i) =>
          p.store(areaInput + i * 4, value),
        );
        await world.sendEngine(areaID, owner, 275, 0, areaInput, context);
        p.free(input);
        p.free(areaInput);
        const draw = world.graphics.drawTasks.get(drawID),
          area = world.objects.objects.get(areaID).implementation,
          expected = Uint8ClampedArray.from(
            Array.from({ length: 4 }, () => [17, 34, 51, 255]).flat(),
          );
        await draw.render();
        assert.deepEqual(await images.get(draw.state.renderer.bitmap).pixels(), expected);
        assert.deepEqual(await images.get(area.state.source).pixels(), expected);
        assert.deepEqual(await images.get(area.state.work).pixels(), expected);
        assert.equal(area.state.imports.length, 2);
        for (const name of [
          'fes-draw-projection',
          'image-owner-projection',
          'display-log-projection',
        ]) {
          assert.equal(world.nativeFeatureFactories.has(name), false);
          assert.equal(world.nativeEngine.features.has(name), false);
        }
        fresh = await make();
        await fresh.restore(structuredClone(world.snapshot()));
        const restoredDraw = fresh.graphics.drawTasks.get(drawID),
          restoredArea = fresh.objects.objects.get(areaID).implementation;
        await restoredDraw.render();
        assert.deepEqual(
          await fresh.graphics.images.get(restoredDraw.state.renderer.bitmap).pixels(),
          expected,
        );
        assert.deepEqual(
          await fresh.graphics.images.get(restoredArea.state.source).pixels(),
          expected,
        );
        const imports = restoredArea.state.imports.map(({ handle }) => handle),
          platform = fresh.nativeEngine.features.get('graphics-platform');
        await fresh.objects.release(areaID);
        for (const handle of imports)
          assert.equal(fresh.runtime.handles.records.has(handle), false);
        assert.equal(
          [...platform.bitmapHandles.keys()].some((key) => key.startsWith(`${areaID}:`)),
          false,
        );
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
