// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './data-world.mjs';
import { files as scenes, append } from './fes-log-model.mjs';
import { hg3 } from '../helpers.mjs';
import { FESObjectCollection } from '../../src/native/fes-object-collection.mjs';
import { createFESTypedObject } from '../../src/native/fes-object-factory.mjs';
import { FESDefinitionModel } from '../../src/native/fes-definitions.mjs';
import { FESImageCache } from '../../src/native/fes-image-cache.mjs';
import { initializeFESImage } from '../../src/native/fes-image-driver.mjs';
import { FESStringDriver, initializeFESString } from '../../src/native/fes-string-driver.mjs';
import { FESLogDriver, initializeFESLogObject } from '../../src/native/fes-log-driver.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
export const glyphs = {
  measure: (_font, text) => ({
    width: text.length * 4,
    height: 8,
    ascent: 6,
    descent: 2,
    averageWidth: 4,
    maximumWidth: 8,
  }),
  glyph: () => ({
    width: 4,
    height: 6,
    originX: 0,
    originY: 6,
    advanceX: 4,
    advanceY: 0,
    alpha: new Uint8Array(24).fill(255),
  }),
};
function regions() {
  const frames = Array.from({ length: 4 }, (_, i) => {
      const bytes = hg3(24, 16, new Uint8Array(24 * 16 * 4)),
        view = new DataView(bytes.buffer);
      view.setUint32(16, i, true);
      view.setInt32(48, 2, true);
      view.setInt32(52, i * 18, true);
      return bytes;
    }),
    output = new Uint8Array(12 + frames.reduce((n, b) => n + b.length - 12, 0));
  output.set(frames[0].subarray(0, 12));
  let offset = 12;
  frames.forEach((bytes, i) => {
    output.set(bytes.subarray(12), offset);
    new DataView(output.buffer).setUint32(
      offset,
      i === frames.length - 1 ? 0 : bytes.length - 12,
      true,
    );
    offset += bytes.length - 12;
  });
  return output;
}
export async function textWorld(profile, { initialize = true } = {}) {
  const world = await dataWorld(
    profile,
    { ...scenes, 'area.hg3': regions() },
    { initialize: false, glyphs },
  );
  if (!world.text.core) throw new Error('Fixture requires the default World-owned JS text runtime');
  world.game.readCategory = (name, category) =>
    world.game.read(category === 'scene' && !name.includes('.') ? name + '.cst' : name);
  world.objects.register(1005, (record) => {
    const base = world.base(record),
      cache = new FESImageCache(world, record.id),
      instance = {
        runtimeID: record.id,
        objects: [],
        byKey: new Map(),
        player: {
          strings: [],
          expand: (name) => name,
          host: {},
          nativeInput: { state: { sleeping: false } },
        },
        locals: new Map(),
        globals: new Map(),
        value: (value) => Number(value),
        text: (value) => value,
        setLocal(key, value) {
          this.locals.set(key, value);
        },
        setGlobal(key, value) {
          this.globals.set(key, value);
        },
      },
      collection = new FESObjectCollection({
        create: (identity) => {
          const object = createFESTypedObject(identity, {
            initializeImage: initializeFESImage,
            initializeSpecial: (o) => {
              if ([21, 29, 37].includes(o.nativeType)) {
                initializeFESString(o, world);
                return true;
              }
              return false;
            },
          });
          if ([24, 38].includes(object.nativeType)) initializeFESLogObject(object, world);
          return object;
        },
        close: (object) =>
          strings.supports(object)
            ? strings.close(object)
            : logs.supports(object)
              ? logs.close(object)
              : undefined,
      }),
      strings = new FESStringDriver(world, {
        cacheFor: () => cache,
        lookup: (s, ref) => s.collection.lookup(ref.nameBytes ?? ref.name, ref.index),
        imageDataFor: (_s, image) => image.fixtureHeldData ?? null,
      }),
      logs = new FESLogDriver(world, {
        strings,
        createChild: async (_s, spec) => {
          const child = collection.create(spec.nativeType, spec.name, 1, {
            parent: null,
            enqueue: false,
          })[0];
          child.nativeControlledByLog = spec.logObjectHandle;
          await strings.initialize(instance, child);
          return child;
        },
        resolveChild: (_s, handle) => collection.graph.get(handle),
        findChild: (_s, name, index) => collection.lookup(name, index),
        writeString: (s, index, bytes) => {
          s.player.strings[index] = new TextDecoder('shift_jis').decode(bytes);
        },
      }),
      definitions = new FESDefinitionModel(instance, {
        collection,
        applySpecial: async (object, data) =>
          strings.supports(object)
            ? strings.applyDefinition(instance, object, data)
            : logs.applyDefinition(instance, object, data),
      }),
      api = {
        instance,
        collection,
        strings,
        logs,
        cache,
        definitions,
        message: (words, context) => base.message(words, context),
        async tick() {},
        snapshot() {
          return {
            collection: collection.snapshot(),
            cache: cache.snapshot(),
            strings: instance.player.strings,
            locals: [...instance.locals],
            globals: [...instance.globals],
            sleeping: instance.player.nativeInput.state.sleeping,
          };
        },
        restore(state) {
          collection.restore(state.collection);
          instance.objects = collection.objects;
          instance.byKey = collection.byKey;
          cache.entries = new Map(state.cache);
          instance.player.strings = structuredClone(state.strings);
          instance.locals = new Map(state.locals);
          instance.globals = new Map(state.globals);
          instance.player.nativeInput.state.sleeping = state.sleeping;
        },
        async close() {
          await collection.close();
          cache.close();
        },
      };
    Object.assign(instance, { collection, objects: collection.objects, byKey: collection.byKey });
    world.text.fes = strings;
    world.text.log = logs;
    return api;
  });
  if (initialize) await world.initialize('case.kcs');
  return world;
}
export async function setup(world) {
  const id = await world.objects.create({
      kind: 1005,
      parent: world.main.id,
      nativeID: 417,
      name: 'FES text owner',
    }),
    api = world.objects.objects.get(id).implementation;
  api.add = (type, name, count = 1) => api.collection.create(type, name, count, { enqueue: false });
  api.frame = async (frame) => {
    await world.objects.tick(frame);
    for (const object of api.instance.objects.slice())
      if (api.logs.supports(object)) await api.logs.update(api.instance, object);
    for (const object of api.instance.objects)
      if (api.strings.supports(object)) await api.strings.update(api.instance, object);
  };
  api.frames = async () => {
    const frames = [];
    for (const object of api.instance.objects)
      if (api.strings.supports(object)) {
        const task = world.graphics.get(object.nativeTaskID),
          writer = task && (await task.writer());
        if (writer)
          frames.push({
            handle: object.handle,
            id: object.nativeTaskID,
            frame: structuredClone(writer.frame()),
          });
      }
    return frames;
  };
  return { id, api };
}
export { append };
