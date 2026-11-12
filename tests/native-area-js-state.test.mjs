// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { authoredAreaBitmaps, areaPixelParameters } from './fixtures/area-effect-cases.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { floatBits } from '../src/kcs.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(
    profile + ' JS area resources, empty receivers and opaque query identity survive fresh restore',
    async () => {
      const world = await dataWorld(profile);
      let fresh;
      try {
        const call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main);
        const allocated = world.runtime.imageDataBuffers.process.allocations.size;
        for (const kind of [17, 21, 22, 23, 24, 25]) {
          const id = await world.objects.create({
              kind,
              parent: world.root,
              name: 'Empty receiver',
            }),
            native = world.nativeTaskID(id);
          const first = await call(world, 0xc8, [native]),
            second = await call(world, 0xc8, [native]);
          assert.equal(first.control, 1);
          assert.ok(first.value);
          assert.equal(first.value, second.value);
          await call(world, 0xc4, [native, 0xffffffff]);
          assert.equal(
            world.runtime.imageDataBuffers.process.allocations.size,
            allocated + 1,
            'one caller word, no scratch leak',
          );
          await world.objects.release(id);
        }
        const handles = await authoredAreaBitmaps(world),
          id = await world.objects.create({ kind: 27, parent: world.root, name: 'Owned CPU work' }),
          record = world.objects.objects.get(id),
          params = areaPixelParameters({ kind: 27 }, handles);
        await world.graphics.ensureVRAM(world.game.width, world.game.height);
        const baseline = world.runtime.handles.records.size;
        await world.sendEngine(id, world.root, 275, 0, 0, {
          payload: new NativeGraphicsPacket(params),
        });
        const work = record.implementation.state.work;
        assert.ok(work);
        await world.sendEngine(id, world.root, 257);
        await world.tick();
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(world.snapshot()));
        assert.equal((await call(fresh, 0xc8, [fresh.nativeTaskID(id)])).value, 1);
        await world.tick();
        await fresh.tick();
        assert.deepEqual(
          await fresh.graphics.images.get(work).frame(),
          await world.graphics.images.get(work).frame(),
        );
        await world.objects.release(id);
        assert.equal(
          world.runtime.handles.records.size,
          baseline,
          'work bitmap/data are both released',
        );
        for (const handle of handles)
          assert.ok(world.graphics.images.get(handle), 'borrowed images stay live');
        await world.objects.release(world.main.id);
        assert.equal(
          world.runtime.imageDataBuffers.process.allocations.size,
          allocated,
          'opaque query identity freed with caller',
        );
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
  test(
    profile + ' Rain custom graph checkpoint preserves order, RNG and vertex state',
    async () => {
      const world = await dataWorld(profile);
      let fresh;
      try {
        const id = await world.objects.create({ kind: 19, parent: world.root, name: 'Rain' }),
          params = [
            ...[64, 16, 48].map(floatBits),
            300,
            ...[14, 7, 42].map(floatBits),
            4,
            4,
            0xff60c4f4,
          ];
        await world.sendEngine(id, world.root, 266, 0, 0, {
          payload: new NativeGraphicsPacket(params),
        });
        await world.sendEngine(id, world.root, 257);
        await world.tick();
        const rain = world.objects.objects.get(id).implementation,
          state = structuredClone(rain.state),
          random = world.random.snapshot(),
          calls = [];
        assert.equal(rain.rainGraph.queryDraw, undefined);
        assert.equal(rain.rainGraph.graph.callback, undefined);
        assert.equal(rain.rainGraph.graph.registrationEnabled, 'unverified');
        await rain.rainGraph.drawGPU(
          { drawGeometry: (...args) => calls.push(args) },
          { minimum: 0, maximum: 0 },
        );
        assert.equal(calls.length, 1, 'legacy draw has no new D6 range gate');
        assert.equal(calls[0][0].length, 4);
        assert.ok(calls[0][0].every((drop) => drop.vertices.length === 2));
        assert.equal(calls[0][2].context, world.graphics.d3dContext);
        assert.deepEqual(calls[0][2].lineViewport, [0, 0, world.game.width, world.game.height]);
        assert.deepEqual(rain.state, state);
        assert.deepEqual(world.random.snapshot(), random);
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(world.snapshot()));
        assert.equal(fresh.graphics.renderSequence, world.graphics.renderSequence);
        const restoredRain = fresh.objects.objects.get(id).implementation;
        assert.equal(restoredRain.rainGraph.queryDraw, undefined);
        assert.equal(restoredRain.rainGraph.graph.registrationEnabled, 'unverified');
        await fresh.tick();
        await world.tick();
        assert.deepEqual(
          fresh.objects.objects.get(id).implementation.state,
          world.objects.objects.get(id).implementation.state,
        );
        assert.deepEqual(fresh.random.snapshot(), world.random.snapshot());
        if (nativeABI(profile).capabilities.effekseerTask) {
          const effectID = await world.objects.create({ kind: 61, parent: world.root });
          assert.equal(
            world.objects.objects.get(effectID).implementation.plane.graph.registrationEnabled,
            false,
            'the registered kind61 query opt-in retains its proven initial value',
          );
        }
        await fresh.objects.release(id);
        assert.equal(fresh.graphics.get(id), null);
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
}
