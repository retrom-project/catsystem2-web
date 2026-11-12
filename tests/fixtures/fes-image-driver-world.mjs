// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './data-world.mjs';
import { FESImageCache } from '../../src/native/fes-image-cache.mjs';
import { FESInput } from '../../src/native/fes-input.mjs';
import { FESImages, initializeFESImage } from '../../src/native/fes-image-driver.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
export async function imageWorld(profile, files = {}, initialize = true) {
  const world = await dataWorld(profile, files, { initialize: false });
  world.game.width = 32;
  world.game.height = 24;
  world.game.resolveCategory = (name, category) => {
    const file = name.includes('.') ? name : name + '.' + (category === 'image' ? 'hg3' : category);
    return world.game.has(file) ? file : null;
  };
  world.game.readCategory = async (name, category) => {
    const file = world.game.resolveCategory(name, category);
    return file === null ? null : world.game.read(file);
  };
  world.objects.register(1001, (record) => {
    const base = world.base(record),
      api = { events: [], surface: null },
      player = {
        surface: null,
        expand: (name) => name,
        nativeImages: null,
        flush: async () => {},
        nativeEvent: async (key, event) => {
          api.events.push([key, event]);
          return true;
        },
      },
      instance = {
        runtimeID: record.id,
        objects: [],
        byKey: new Map(),
        player,
        rect(object) {
          const b = player.nativeInput.bounds(object);
          return b && { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] };
        },
      };
    player.root = instance;
    const input = new FESInput(record, world),
      cache = new FESImageCache(world, record.id),
      images = new FESImages(world, {
        cacheFor: () => cache,
        lookup: (instance, reference) => {
          if (reference.index === -1) return null;
          return (
            instance.byKey.get(`${reference.name}[${reference.index}]`) ??
            (reference.index === 0 ? instance.byKey.get(reference.name) : null) ??
            null
          );
        },
      });
    player.nativeInput = input;
    player.nativeImages = images;
    Object.assign(api, {
      player,
      instance,
      input,
      cache,
      images,
      async message(words, context) {
        if ([9, 10, 64, 65].includes(words[1])) return input.message(words, context);
        return base.message(words, context);
      },
      async tick() {},
      snapshot() {
        return {
          objects: structuredClone(instance.objects),
          surface: player.surface,
          input: input.snapshot(),
          cache: cache.snapshot(),
          events: structuredClone(api.events),
        };
      },
      restore(state) {
        instance.objects = state.objects.map((saved) =>
          Object.assign(
            initializeFESImage({ nativeType: saved.nativeType }),
            structuredClone(saved),
          ),
        );
        instance.byKey = new Map(instance.objects.map((o) => [o.key, o]));
        player.surface = api.surface = state.surface;
        input.restore(state.input);
        cache.entries = new Map(state.cache);
        api.events = structuredClone(state.events);
      },
      async close() {
        for (const o of instance.objects) await images.close(o);
        cache.close();
        await input.close();
      },
    });
    return api;
  });
  if (initialize) await world.initialize('case.kcs');
  return world;
}
export async function setupImages(world) {
  const id = await world.objects.create({
      kind: 1001,
      parent: world.main.id,
      nativeID: 417,
      name: 'image receiver',
    }),
    api = world.objects.objects.get(id).implementation,
    surface = await world.objects.create({
      kind: 15,
      parent: world.main.id,
      name: 'image surface',
    });
  await world.sendEngine(surface, world.main.id, 279, 32, 24);
  await world.sendEngine(surface, world.main.id, 283, 0, 0);
  api.surface = api.player.surface = surface;
  return { id, api, surface, draw: world.graphics.drawTasks.get(surface) };
}
export function imageObject(api, type, key, fields = {}) {
  const object = initializeFESImage({
    nativeType: type,
    key,
    type: type === 6 ? 'BUTTON' : type === 1 ? 'CIMAGE' : 'IMAGE',
    handle: 0x1001 + api.instance.objects.length,
    enable: true,
    motionDelay: 0,
    parentHandle: null,
    parent: null,
  });
  Object.assign(object, fields);
  api.instance.objects.push(object);
  api.instance.byKey.set(key, object);
  return object;
}
export async function syncImages(api, options) {
  for (const o of api.instance.objects) await api.images.update(api.instance, o, options);
}
