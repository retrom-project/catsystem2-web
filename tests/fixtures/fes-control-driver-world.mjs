// SPDX-License-Identifier: MPL-2.0
import { controlWorld } from './control-world.mjs';
import { createFESTypedObject } from '../../src/native/fes-object-factory.mjs';
import { FESObjectCollection } from '../../src/native/fes-object-collection.mjs';
import { FESDefinitionModel } from '../../src/native/fes-definitions.mjs';
import { FESImageCache } from '../../src/native/fes-image-cache.mjs';
import { FESInput } from '../../src/native/fes-input.mjs';
import { MOTION_ABI, motionVector } from '../../src/motion/abi.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../../src/native/engine-message.mjs';
import { FESControlDriver } from '../../src/native/fes-control-driver.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
export async function driverWorld(profile, { initialize = true, resources = true } = {}) {
  const world = await controlWorld(profile, { initialize: false, resources });
  world.objects.register(1006, (record) => {
    const base = world.base(record),
      input = new FESInput(record, world),
      cache = new FESImageCache(world, record.id),
      instance = {
        runtimeID: record.id,
        value: (value) => Number(value),
        objects: [],
        byKey: new Map(),
        scrollPosition: 0,
      },
      player = {
        root: instance,
        nativeInput: input,
        surface: null,
        mouse: null,
        async nativeEvent(key, event) {
          const object = instance.byKey.get(key);
          if (!object) throw new Error('Fixture event refers to missing semantic control');
          if (event === 'SCRL_P') instance.scrollPosition = object.handle;
          api.events.push({
            key,
            event,
            value: object.value,
            scrollPosition: instance.scrollPosition,
            mouse: structuredClone(player.mouse),
          });
          await api.onEvent?.(object, event);
        },
      },
      controls = new FESControlDriver(world, {
        cacheFor: () => cache,
        lookup: (s, ref) => s.collection.lookup(ref.nameBytes ?? ref.name, ref.index),
      }),
      collection = new FESObjectCollection({
        create: (identity) => createFESTypedObject(identity),
        close: (object) => (controls.supports(object) ? controls.close(object) : undefined),
      }),
      definitions = new FESDefinitionModel(instance, { collection }),
      api = {
        instance,
        collection,
        controls,
        cache,
        player,
        definitions,
        events: [],
        async message(words, context) {
          if (words[1] === 27 || words[1] === 28) {
            await controls.message(record, player, words, context);
            return NATIVE_UNWRITTEN_WORD;
          }
          return base.message(words, context);
        },
        async tick() {},
        add: (type, name, count = 1) => collection.create(type, name, count, { enqueue: false }),
        async sync(options) {
          for (const object of instance.objects)
            if (controls.supports(object)) await controls.update(instance, object, options);
        },
        snapshot: () => ({
          collection: collection.snapshot(),
          cache: cache.snapshot(),
          input: input.snapshot(),
          surface: player.surface,
          events: structuredClone(api.events),
          mouse: structuredClone(player.mouse),
          scrollPosition: instance.scrollPosition,
        }),
        restore(state) {
          collection.restore(state.collection);
          instance.objects = collection.objects;
          instance.byKey = collection.byKey;
          cache.entries = new Map(state.cache);
          input.restore(state.input);
          player.surface = state.surface;
          api.events = structuredClone(state.events);
          player.mouse = structuredClone(state.mouse);
          instance.scrollPosition = state.scrollPosition;
        },
        async close() {
          await collection.close();
          cache.close();
        },
      };
    Object.assign(instance, {
      collection,
      objects: collection.objects,
      byKey: collection.byKey,
      player,
    });
    return api;
  });
  if (initialize) await world.initialize('case.kcs');
  return world;
}
export async function setup(world) {
  const id = await world.objects.create({
      kind: 1006,
      parent: world.main.id,
      name: 'typed FES controls',
    }),
    api = world.objects.objects.get(id).implementation,
    surface = await world.objects.create({ kind: 15, parent: world.main.id, name: 'control Draw' });
  await world.sendEngine(surface, world.main.id, 279, 128, 96);
  await world.sendEngine(surface, world.main.id, 283);
  api.player.surface = surface;
  return { id, api, surface, draw: world.graphics.drawTasks.get(surface) };
}
export async function defineControl(api, type, name = 'control') {
  const object = api.add(type, name)[0];
  if (type === 13)
    await api.definitions.row(
      ['FILE', 'POS', 'VRAM', 'PRI', 'PRI_P', 'TYPE', 'DISP', 'ENABLE'],
      name,
      ['scroll', '4,4', '0,0', '82', '1003', '0', '1', '1'],
    );
  else {
    const plane = api.add(4, name + 'Plane')[0];
    plane.vramX = type === 15 ? 2 : 0;
    plane.vramY = type === 15 ? 3 : 0;
    await api.definitions.row(['FILE', 'PL', 'POS2', 'PRI', 'DISP', 'ENABLE'], name, [
      'controls',
      name + 'Plane',
      type === 14 ? 'area:8' : 'area:7',
      type === 14 ? '81' : '80',
      '1',
      '1',
    ]);
  }
  return object;
}
export async function capture(world, task, draw) {
  const items = [];
  for (const item of draw.state.renderer.items.filter(
    (entry) => (entry.key & 65535) === world.nativeTaskID(task.record.id),
  )) {
    const bitmap = world.graphics.images.get(item.image);
    items.push({
      priority: item.key >>> 16,
      position: [...item.position],
      base: [...item.base],
      scale: [...item.scale],
      alpha: item.alpha,
      visible: item.visible,
      bitmap: {
        width: bitmap.width,
        height: bitmap.height,
        offsetX: bitmap.state.offsetX,
        offsetY: bitmap.state.offsetY,
        canvasWidth: bitmap.state.canvasWidth,
        canvasHeight: bitmap.state.canvasHeight,
        pixels: [...(await bitmap.pixels())],
      },
    });
  }
  const areas = Object.values(task.resource.areas).map((id) => {
    const area = world.inputFor(task.record.id).get(id);
    return { bounds: [...area.bounds], priority: area.priority };
  });
  const planes = task.resource.planes.map((id) => {
    const { state, graph } = world.objects.objects.get(id).implementation;
    return {
      shape: [graph.width, graph.height],
      shown: state.shown,
      renderPaused: state.renderPaused,
      pos: motionVector(graph.kx2, MOTION_ABI.pos),
      base: motionVector(graph.kx2, MOTION_ABI.base),
      scale: motionVector(graph.kx2, MOTION_ABI.scale),
      texturePos: motionVector(graph.textureTransform, MOTION_ABI.pos),
      alpha: new DataView(graph.kx2.buffer).getUint32(MOTION_ABI.color, true) >>> 24,
    };
  });
  return { items, areas, planes };
}
