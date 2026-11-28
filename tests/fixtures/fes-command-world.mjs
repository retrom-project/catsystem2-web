// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { imageWorld, setupImages } from './fes-image-driver-world.mjs';
import { FESObjectCollection } from '../../src/native/fes-object-collection.mjs';
import { createFESTypedObject } from '../../src/native/fes-object-factory.mjs';
import { initializeFESImage } from '../../src/native/fes-image-driver.mjs';
import { hg3 } from '../helpers.mjs';
import { FESImageControlCommands } from '../../src/native/fes-image-control-commands.mjs';
import { FESInput } from '../../src/native/fes-input.mjs';

export const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const bytes = Uint8Array.from([
  10, 70, 160, 255, 20, 80, 170, 255, 30, 90, 180, 255, 40, 100, 190, 255,
]);
export async function worldFixture(profile, Images) {
  const world = await imageWorld(profile, { 'pixel.hg3': hg3(2, 2, bytes) }),
    h = await setupImages(world),
    { api } = h,
    collection = new FESObjectCollection({
      create: (identity) => createFESTypedObject(identity, { initializeImage: initializeFESImage }),
    });
  Object.assign(api.instance, {
    collection,
    objects: collection.objects,
    byKey: collection.byKey,
    value: Number,
  });
  api.images = new Images(world, {
    cacheFor: () => api.cache,
    lookup: (instance, ref) => instance.collection.lookup(ref.nameBytes ?? ref.name, ref.index),
  });
  api.player.nativeImages = api.images;
  const commands = new FESImageControlCommands(api.instance, {
      collection,
      reference: () => null,
      writeGlobal: () => {
        throw new Error('unexpected numeric output');
      },
    }),
    object = collection.create(2, 'image', 1, { enqueue: false })[0];
  Object.assign(object, {
    file: 'pixel.hg3',
    fileSingle: true,
    imageChanged: true,
    pri: 60000,
    renderID: 1,
    disp: true,
    displayValue: 1,
  });
  await api.images.update(api.instance, object);
  return { world, ...h, collection, commands, object };
}
export async function verifyPlainFilter(profile, Images) {
  const h = await worldFixture(profile, Images);
  try {
    const bitmap = () => h.world.graphics.images.get(h.object.imageResource.bitmap),
      before = (await bitmap().pixels()).slice();
    await h.commands.command('filter', { name: 'image', index: 0 }, ['MoNo']);
    await h.api.images.update(h.api.instance, h.object);
    assert.deepEqual(
      await bitmap().pixels(),
      before,
      'ordinary IMAGE does not consume its filter request on a clean pass',
    );
    h.object.imageChanged = true;
    await h.api.images.update(h.api.instance, h.object);
    assert.deepEqual(
      await bitmap().pixels(),
      before,
      'ordinary IMAGE reload has no original filter call',
    );
    assert.equal(h.object.filterMode, 1);
    assert.equal(h.object.filterPending, true);
    assert.equal(h.world.nativeEngine, undefined);
  } finally {
    await h.world.close();
  }
}
export async function verifyKeyPosition(profile, Images, InputClass = FESInput) {
  const h = await worldFixture(profile, Images);
  try {
    const object = h.collection.create(6, 'button', 1, { enqueue: false })[0];
    Object.assign(object, {
      file: 'pixel.hg3',
      fileSingle: true,
      imageChanged: true,
      pri: 60001,
      renderID: 2,
      disp: true,
      displayValue: 1,
    });
    await h.api.images.update(h.api.instance, object);
    const input = new InputClass(h.world.objects.objects.get(h.id), h.world);
    input.restore(h.api.input.snapshot());
    h.api.player.nativeInput = input;
    await h.commands.command('keypos', { name: 'button', index: 0 }, [1, 7, 9]);
    const bounds = input.bounds(object);
    await input.warp(object);
    assert.deepEqual(h.api.player.mouse, { x: bounds[0] + 7, y: bounds[1] + 9 });
    const low = h.world.inputFor(h.id);
    assert.deepEqual([low.x, low.y], [bounds[0] + 7, bounds[1] + 9]);
  } finally {
    await h.world.close();
  }
}

export async function verifyPanelQueries(profile) {
  const { imageWorld: panelWorld, setupImages: setupPanel } = await import('./fes-panel-world.mjs'),
    { initializeFESPanelTail, setFESPanelFile } = await import(
      '../../src/native/fes-panel-model.mjs'
    ),
    { NativeGlobalFile } = await import('../../src/native/persistence.mjs'),
    file = new NativeGlobalFile(),
    flags = new Uint32Array(1024);
  flags[5] = 617;
  file.write(0x400, new Uint8Array(flags.buffer));
  file.write(0x200, Uint8Array.of(55, 0));
  const thumbnail = Uint8Array.from(Array.from({ length: 4 }, () => [17, 33, 67, 255]).flat());
  file.write(0x100, hg3(2, 2, thumbnail));
  const stored = await file.file(),
    world = await panelWorld(profile, { 'pixel.hg3': hg3(2, 2, thumbnail) }, true, {
      storage: {
        read: async (name) => (name === 'save0007.dat' ? stored : null),
        stat: async (name) =>
          name === 'save0007.dat' ? { modifiedMs: Date.UTC(2025, 3, 18, 11, 23, 45) } : null,
      },
    });
  try {
    world.runtime.services.localOffsetMinutes = () => 0;
    const h = await setupPanel(world),
      { api } = h,
      collection = new FESObjectCollection({
        create: (identity) =>
          createFESTypedObject(identity, {
            initializeImage: initializeFESImage,
            initializeSpecial: (object) => {
              if (object.nativeType === 12) {
                initializeFESPanelTail(object);
                return true;
              }
              return false;
            },
          }),
      });
    Object.assign(api.instance, {
      collection,
      objects: collection.objects,
      byKey: collection.byKey,
      value: Number,
    });
    api.images.lookup = (instance, ref) =>
      instance.collection.lookup(ref.nameBytes ?? ref.name, ref.index);
    const numbers = new Map(),
      texts = new Map(),
      commands = new FESImageControlCommands(api.instance, {
        collection,
        reference: () => null,
        writeGlobal: (at, value) => numbers.set(at, value),
        writeString: (at, bytes) => texts.set(at, bytes.slice()),
        images: api.images,
      }),
      object = collection.create(12, 'saved', 1, { enqueue: false })[0],
      selection = { name: 'saved', index: 0 };
    Object.assign(object, { renderID: 1, pri: 60000, disp: true, displayValue: 1 });
    setFESPanelFile(object, 'pixel');
    await commands.command('ptype', selection, ['SIMAGE', 0, 0x100]);
    await commands.command('setsave', selection, [7, 0x400, 0]);
    await commands.command('dispid', selection, [1, 0]);
    await api.images.update(api.instance, object);
    assert.deepEqual(
      await world.graphics.images.get(object.imageResource.bitmap).pixels(),
      new Uint8ClampedArray(thumbnail),
    );
    await commands.command('getflag', selection, [5, 6]);
    assert.equal(numbers.get(6), 617);
    await commands.command('getsavestr', selection, [2, 0x200]);
    assert.deepEqual(texts.get(2), Uint8Array.of(55));
    await commands.command('getsavedate', selection, [10, 11, 12, 13, 14, 15]);
    assert.deepEqual(
      [10, 11, 12, 13, 14, 15].map((at) => numbers.get(at)),
      [2025, 4, 18, 11, 23, 45],
    );
    await h.draw.render();
    assert.ok(world.graphics.images.get(h.draw.state.renderer.bitmap));
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
}

export async function verifyDifFilter(profile) {
  const { imageWorld: difWorld, setupImages: setupDif } = await import('./fes-dif-image-world.mjs'),
    { initializeFESDifTail } = await import('../../src/native/fes-dif-image.mjs'),
    world = await difWorld(profile);
  try {
    const h = await setupDif(world),
      { api } = h,
      collection = new FESObjectCollection({
        create: (identity) =>
          createFESTypedObject(identity, {
            initializeImage: initializeFESImage,
            initializeSpecial: (object) => {
              if (object.nativeType === 25) {
                initializeFESDifTail(object);
                return true;
              }
              return false;
            },
          }),
      });
    Object.assign(api.instance, {
      collection,
      objects: collection.objects,
      byKey: collection.byKey,
      value: Number,
    });
    api.images.lookup = (instance, ref) =>
      instance.collection.lookup(ref.nameBytes ?? ref.name, ref.index);
    const object = collection.create(25, 'dif', 1, { enqueue: false })[0],
      bitmap = world.graphics.images.create(2, 2, h.id),
      b = world.graphics.images.get(bitmap);
    (await b.pixels()).set(bytes);
    await b.changed();
    const handle = world.imageOwners.add(bitmap, h.id, [2, 2, 2, 2, 0, 0, 0, 0, 4, 1, 1]),
      commands = new FESImageControlCommands(api.instance, {
        collection,
        reference: () => null,
        writeGlobal: () => {},
        images: api.images,
      }),
      selection = { name: 'dif', index: 0 };
    Object.assign(object, { renderID: 1, pri: 60000, disp: true, displayValue: 1 });
    await commands.command('refex', selection, [handle]);
    await api.images.update(api.instance, object);
    await commands.command('filter', selection, ['mono']);
    await api.images.update(api.instance, object);
    const source = world.renderSources.get(object.imageResource.source),
      pixels = await world.graphics.images.get(source.bitmap).pixels();
    for (let at = 0; at < pixels.length; at += 4) {
      assert.equal(pixels[at], pixels[at + 1]);
      assert.equal(pixels[at + 1], pixels[at + 2]);
      assert.equal(pixels[at + 3], 255);
    }
    assert.equal(object.difImage.filterPending, false);
    assert.equal(api.motionSnapshots, 1);
    assert.equal(world.nativeEngine, undefined);
    await world.imageOwners.release(handle);
    await h.draw.render();
    assert.ok(world.graphics.images.get(h.draw.state.renderer.bitmap));
  } finally {
    await world.close();
  }
}
