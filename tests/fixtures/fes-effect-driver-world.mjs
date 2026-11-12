// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './data-world.mjs';
import { ScreenVectorGPU } from './screen-effects-fixture.mjs';
import { FESImageCache } from '../../src/native/fes-image-cache.mjs';
import { FESObjectCollection } from '../../src/native/fes-object-collection.mjs';
import { createFESTypedObject } from '../../src/native/fes-object-factory.mjs';
import { FESMotionDriver, createFESMotionTarget } from '../../src/native/fes-motion-driver.mjs';
import { hg3, kcsProgram } from '../helpers.mjs';
import { FESWorldEffects } from '../../src/native/fes-effect-driver.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const shared = (at) => [0x13, (0x80000000 + at) >>> 0];
export async function effectWorld(profile, { initialize = true, width = 8, height = 6 } = {}) {
  const world = await dataWorld(
    profile,
    {
      'dummy.kcs': kcsProgram([
        [21, shared(28), shared(156)],
        [21, shared(140), shared(144)],
        [59],
      ]),
      'mask.hg3': hg3(
        8,
        6,
        Uint8Array.from({ length: 8 * 6 * 4 }, (_, i) => (i % 4 === 3 ? 31 : (i * 17) & 255)),
      ),
    },
    { initialize: false },
  );
  Object.assign(world.configuration.screen, {
    width,
    height,
    currentWidth: width,
    currentHeight: height,
    virtualWidth: width,
    virtualHeight: height,
  });
  Object.assign(world.graphics.view, {
    clientWidth: width,
    clientHeight: height,
    virtualWidth: width,
    virtualHeight: height,
    drawingRectangle: [0, 0, width, height],
  });
  world.stageRenderer.gpu = new ScreenVectorGPU(width, height);
  world.objects.register(1003, (record) => {
    const base = world.base(record),
      player = { surface: null, expand: (name) => name },
      instance = { runtimeID: record.id, objects: [], player },
      targets = new Map(),
      cache = new FESImageCache(world, record.id),
      collection = new FESObjectCollection({
        create: (identity) => createFESTypedObject(identity),
        close: (object) => effects.close(object),
      }),
      targetFor = (object, create) => {
        if (!targets.has(object.handle) && create)
          targets.set(object.handle, createFESMotionTarget(world.motionLibrary, instance, object));
        return targets.get(object.handle);
      },
      motion = new FESMotionDriver(collection.graph, targetFor),
      events = [],
      effects = new FESWorldEffects(world, instance, {
        cacheFor: () => cache,
        createObject: ({ type, name, parent }) =>
          collection.create(type, name, 1, {
            parent: collection.graph.get(parent),
            enqueue: false,
          })[0],
        addDummyMotion: (object, spec) =>
          motion.add(object, spec.name, { registers: spec.registers }),
        queueWipeRecord: (object, words) => events.push(['wipeRecord', object.handle, words]),
        clearMotion: (object) => targetFor(object, false)?.clear(),
        motionBusy: (object) => motion.busy(object),
        deleteObject: (object) => collection.remove(object),
        notify: (name) => events.push(['notify', name]),
        maskOutputs: (sleeping) => {
          instance.sleeping = sleeping;
          events.push(['mask', sleeping]);
        },
      }),
      api = {
        instance,
        effects,
        collection,
        motion,
        cache,
        events,
        targets,
        message: (words, context) => base.message(words, context),
        async tick() {},
        snapshot() {
          return {
            collection: collection.snapshot(),
            effects: effects.snapshot(),
            surface: player.surface,
            cache: cache.snapshot(),
            targets: [...targets].map(([id, target]) => [id, target.snapshot()]),
          };
        },
        async restore(state) {
          collection.restore(state.collection);
          instance.objects = collection.objects;
          player.surface = state.surface;
          cache.entries = new Map(state.cache);
          effects.restore(state.effects);
          for (const [handle, saved] of state.targets)
            await targetFor(collection.graph.get(handle), true).restore(saved);
        },
        async close() {
          await collection.close();
          await effects.collectDeleted();
          cache.close();
        },
      };
    instance.objects = collection.objects;
    return api;
  });
  if (initialize) await world.initialize('case.kcs');
  return world;
}
export async function setupEffects(world) {
  const ownerID = await world.objects.create({
      kind: 1003,
      parent: world.main.id,
      nativeID: 417,
      name: 'FES effect owner',
    }),
    api = world.objects.objects.get(ownerID).implementation,
    top = api.collection.create(0, '_TOP_', 1, { enqueue: false })[0],
    surface = await world.objects.create({ kind: 15, parent: ownerID, name: 'FES effect Draw' });
  await world.sendEngine(surface, ownerID, 279, 16, 12);
  await world.sendEngine(surface, ownerID, 283, 1, 1);
  await world.graphics.ensureVRAM(8, 6);
  api.instance.player.surface = surface;
  api.add = (type, name, fields = {}) =>
    Object.assign(api.collection.create(type, name, 1, { parent: top, enqueue: false })[0], fields);
  api.advance = async (frame) => {
    await world.objects.tick(frame);
    for (const object of api.collection.ordered().slice())
      if (api.effects.supports(object)) await api.effects.update(object);
    await api.effects.collectDeleted();
  };
  return { ownerID, api, top, surface };
}
export async function fill(world, handle, color) {
  const bitmap = world.graphics.images.get(handle),
    data = await bitmap.pixels();
  for (let at = 0; at < data.length; at += 4) data.set(color, at);
  await bitmap.changed();
}
export async function coloredGraph(world, parent, priority, color) {
  const id = await world.objects.create({ kind: 2, parent }),
    record = world.objects.objects.get(id),
    plane = world.graphics.get(id);
  plane.makeGraph({ type: 1, width: 8, height: 6, custom: true });
  plane.state.shown = true;
  const view = new DataView(
    plane.graph.kx2.buffer,
    plane.graph.kx2.byteOffset,
    plane.graph.kx2.byteLength,
  );
  view.setFloat32(20, priority, true);
  plane.sync();
  // Authored test graph uses the real graph registry/currentFrame ordering.
  // Its drawing operation is a clear, so target bytes are exact without WebGL.
  plane.drawGPU = async (gpu) => gpu.clear({ flags: 1, color });
  return { id, record, plane };
}
