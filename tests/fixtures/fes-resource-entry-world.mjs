// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './data-world.mjs';
import { authoredPPIRegistry } from './ppi-js-fixture.mjs';
import { nativeParticleFixture } from './ppi-native-fixture.mjs';
import { kcsProgram } from '../helpers.mjs';
import { FESImageCache } from '../../src/native/fes-image-cache.mjs';
import { FESInput } from '../../src/native/fes-input.mjs';
import { FESImages, initializeFESImage } from '../../src/native/fes-image-driver.mjs';
import { FESParticleDriver, initializeFESParticle } from '../../src/native/fes-particle-driver.mjs';
import { FESResourceEntries } from '../../src/native/fes-resource-entries.mjs';
import { FESObjectCollection } from '../../src/native/fes-object-collection.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
export async function entryWorld(profile, files = {}, initialize = true) {
  const world = await dataWorld(
    profile,
    {
      'ptclpi/probe.ppi': nativeParticleFixture(),
      'ptcl/probe.kcs': kcsProgram([[59]]),
      ...files,
    },
    { initialize: false },
  );
  world.game.width = 32;
  world.game.height = 24;
  world.game.resolveCategory = (name, category) => {
    const extension =
        { image: 'hg3', ptcl: 'kcs', ptclpi: 'ppi', script: 'kcs' }[category] ?? category,
      file = name.includes('.') ? name : name + '.' + extension;
    return [`${category}/${file}`, file].find((candidate) => world.game.has(candidate)) ?? null;
  };
  world.game.readCategory = (name, category) => {
    const path = world.game.resolveCategory(name, category);
    return path === null ? null : world.game.read(path);
  };
  world.particles.host.registry = authoredPPIRegistry(['probe']);
  world.objects.register(1003, (record) => {
    const base = world.base(record),
      api = { surface: null },
      player = {
        surface: null,
        expand: (name) => name,
        flush: async () => {},
        nativeEvent: async () => false,
      },
      instance = { runtimeID: record.id, player, objects: [], byKey: new Map() },
      input = new FESInput(record, world),
      cache = new FESImageCache(world, record.id),
      images = new FESImages(world, {
        cacheFor: () => cache,
        lookup: (_owner, reference) =>
          collection.lookup(reference.nameBytes ?? reference.name, reference.index),
      }),
      particles = new FESParticleDriver(world),
      collection = new FESObjectCollection({
        create(identity) {
          const object = {
            ...identity,
            enable: true,
            parentHandle: null,
            parent: null,
            motionDelay: 0,
          };
          return object.nativeType === 23
            ? initializeFESParticle(object)
            : initializeFESImage(object);
        },
        async close(object) {
          if (object.nativeType === 23) particles.close(object);
          else await images.closeObject(object);
        },
        serialize(object) {
          const state = { ...object };
          delete state.imageResource;
          delete state.particleResource;
          return structuredClone(state);
        },
      }),
      resources = new FESResourceEntries({
        resolve: (name, index) => collection.lookup(name, index),
        async allocate(entry, object) {
          if (object.nativeType === 23) return particles.allocateEntry(instance, object, entry);
          await images.allocateEntry(instance, object, entry);
          if (object.nativeType === 6) {
            entry.buttonTaskID = await world.objects.create({
              kind: 6,
              parent: record.id,
              creator: record.id,
              name: 'FE Button',
            });
            object.nativeInputTaskID = entry.buttonTaskID;
            input.state.buttons = input.state.buttons.filter(([key]) => key !== object.key);
            input.state.buttons.push([object.key, entry.buttonTaskID]);
          }
        },
        visit(entry, object) {
          return object.nativeType === 23
            ? particles.update(instance, object)
            : images.visitEntry(instance, object, entry);
        },
        cleanup(entry) {
          return entry.savedType === 23
            ? particles.cleanupEntry(entry)
            : images.cleanupEntry(instance, entry);
        },
        validate(entry, object) {
          return entry.savedType === 23
            ? particles.validateEntry(instance, object, entry)
            : images.validateEntry(instance, object, entry);
        },
      });
    instance.objects = collection.objects;
    instance.byKey = collection.byKey;
    player.root = instance;
    player.nativeInput = input;
    player.nativeImages = images;
    Object.assign(api, {
      instance,
      player,
      input,
      cache,
      images,
      particles,
      collection,
      resources,
      message: (words, context) => base.message(words, context),
      async tick() {},
      snapshot: () => ({
        collection: collection.snapshot(),
        resources: resources.snapshot(),
        surface: player.surface,
        input: input.snapshot(),
        cache: cache.snapshot(),
      }),
      async restore(state) {
        collection.restore(state.collection);
        instance.objects = collection.objects;
        instance.byKey = collection.byKey;
        player.surface = api.surface = state.surface;
        input.restore(state.input);
        cache.entries = new Map(state.cache);
        await resources.restore(state.resources);
      },
      async close() {
        await collection.close();
        await resources.close();
        cache.close();
        await input.close();
      },
    });
    return api;
  });
  if (initialize) await world.initialize('case.kcs');
  return world;
}
export async function setupEntries(world) {
  const id = await world.objects.create({
      kind: 1003,
      parent: world.main.id,
      nativeID: 417,
      name: 'FES resource receiver',
    }),
    api = world.objects.objects.get(id).implementation,
    surface = await world.objects.create({
      kind: 15,
      parent: world.main.id,
      name: 'entry surface',
    });
  await world.sendEngine(surface, world.main.id, 279, 32, 24);
  await world.sendEngine(surface, world.main.id, 283, 0, 0);
  api.surface = api.player.surface = surface;
  return { id, api, surface, draw: world.graphics.drawTasks.get(surface) };
}
export function createEntryObject(api, type, name, fields = {}) {
  const [object] = api.collection.create(type, name, 1, { scalar: true });
  Object.assign(object, fields);
  return object;
}
