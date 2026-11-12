// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { hg3 } from './helpers.mjs';
import {
  profiles,
  entryWorld,
  setupEntries,
  createEntryObject,
} from './fixtures/fes-resource-entry-world.mjs';
import { setFESImageFile } from '../src/native/fes-image-driver.mjs';
import { setFESImageID } from '../src/native/fes-image-model.mjs';
import { configureFESParticle } from '../src/native/fes-particle-driver.mjs';

const rgba = Uint8ClampedArray.of(
    14,
    40,
    90,
    255,
    81,
    63,
    21,
    255,
    7,
    99,
    44,
    255,
    100,
    24,
    55,
    255,
  ),
  fields = { renderID: 7, pri: 20, displayValue: 1, disp: true, fileSingle: true };
const key = (world, id, renderID = 7) => (world.nativeTaskID(id) | (renderID << 16)) >>> 0;

for (const profile of profiles) {
  test(`${profile} duplicate IMAGE entries retain independent wrappers, latest getter, visible output and fresh-World identity`, async () => {
    const world = await entryWorld(profile, { 'one.hg3': hg3(2, 2, rgba) });
    let fresh;
    try {
      const { api, id, draw } = await setupEntries(world),
        object = createEntryObject(api, 'IMAGE', 'same', fields);
      setFESImageFile(object, 'one');
      api.collection.create('IMAGE', 'same', 1, { scalar: true });
      await api.resources.appendPending(api.collection);
      const [first, last] = api.resources.entries;
      assert.notEqual(first.image, last.image);
      assert.equal(object.imageResource, last.image);
      await api.resources.traverse();
      assert.ok(first.image.bitmap);
      assert.equal(last.image.bitmap, 0);
      assert.equal(
        api.images.currentBitmap(object),
        0,
        'latest getter stays distinct from the first entry being driven',
      );
      assert.deepEqual(await world.graphics.images.get(first.image.bitmap).pixels(), rgba);
      const firstBitmap = first.image.bitmap,
        firstData = world.graphics.images.get(firstBitmap).dataHandle;
      assert.ok(draw.entry(key(world, id)));
      fresh = await entryWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation,
        restoredObject = restored.collection.lookup('same', 0),
        restoredEntries = restored.resources.entries;
      assert.equal(restoredObject.imageResource, restoredEntries[1].image);
      assert.deepEqual(
        restoredEntries.map((e) => e.image.bitmap),
        [first.image.bitmap, 0],
      );
      assert.deepEqual(
        await fresh.graphics.images.get(restoredEntries[0].image.bitmap).pixels(),
        rgba,
      );
      await draw.render();
      const beforeDelete = (
        await world.graphics.images.get(draw.state.renderer.bitmap).pixels()
      ).slice();
      assert.ok(beforeDelete.some(Boolean));
      await api.collection.remove(object);
      assert.ok(
        draw.entry(key(world, id)),
        'semantic deletion preserves actual Draw output before resource cleanup',
      );
      assert.equal(first.image.closed, false);
      assert.equal(last.image.closed, false);
      await draw.render();
      assert.deepEqual(
        await world.graphics.images.get(draw.state.renderer.bitmap).pixels(),
        beforeDelete,
      );
      assert.deepEqual(await api.resources.traverse(), { visited: 0, cleaned: 2 });
      assert.equal(draw.entry(key(world, id)), undefined);
      assert.equal(world.runtime.handles.records.has(firstBitmap), false);
      assert.equal(world.runtime.handles.records.has(firstData), false);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} cleaning a stale image entry preserves a different current source at the same Draw key`, async () => {
    const other = Uint8ClampedArray.of(88, 19, 140, 255),
      world = await entryWorld(profile, {
        'one.hg3': hg3(2, 2, rgba),
        'two.hg3': hg3(1, 1, other),
      });
    try {
      const { api, id, draw } = await setupEntries(world),
        old = createEntryObject(api, 'IMAGE', 'old', fields),
        current = createEntryObject(api, 'IMAGE', 'current', fields);
      setFESImageFile(old, 'one');
      setFESImageFile(current, 'two');
      await api.resources.appendPending(api.collection);
      await api.resources.traverse();
      const [first, last] = api.resources.entries,
        record = world.retainedDraw.record(draw, key(world, id)),
        source = record.source;
      assert.equal(record.input, last.image.bitmap);
      assert.notEqual(
        world.graphics.images.get(first.image.bitmap).dataHandle,
        world.graphics.images.get(last.image.bitmap).dataHandle,
      );
      await api.collection.remove(old);
      assert.deepEqual(await api.resources.traverse(), { visited: 1, cleaned: 1 });
      assert.ok(draw.entry(key(world, id)));
      assert.equal(world.retainedDraw.record(draw, key(world, id)).source, source);
      assert.deepEqual(await world.graphics.images.get(last.image.bitmap).pixels(), other);
    } finally {
      await world.close();
    }
  });
  test(`${profile} IMAGE key recreation reuses old entry visits while object encoded data releases immediately`, async () => {
    const encoded = hg3(2, 2, rgba),
      world = await entryWorld(profile, { 'one.hg3': encoded });
    try {
      const { api, id, draw } = await setupEntries(world),
        old = createEntryObject(api, 'IMAGE', 'again', fields);
      setFESImageFile(old, 'one');
      setFESImageID(old, -1);
      await api.resources.appendPending(api.collection);
      await api.resources.traverse();
      const oldEntry = api.resources.entries[0],
        pointer = old.imageEncodedPointer;
      assert.equal(world.runtime.imageDataBuffers.words(pointer)[3], 2);
      assert.equal('encodedPointer' in oldEntry.image, false);
      await api.collection.remove(old);
      assert.equal(old.imageEncodedPointer, 0);
      assert.equal(world.runtime.imageDataBuffers.words(pointer)[3], 1);
      assert.ok(draw.entry(key(world, id)));
      const replacement = createEntryObject(api, 'IMAGE', 'again', fields);
      assert.notEqual(replacement.handle, old.handle);
      setFESImageFile(replacement, 'one');
      await api.resources.appendPending(api.collection);
      assert.equal(api.resources.entries.length, 2);
      assert.deepEqual(await api.resources.traverse(), { visited: 2, cleaned: 0 });
      assert.equal(oldEntry.image.closed, false);
      assert.ok(oldEntry.image.bitmap);
      assert.equal(replacement.imageResource.bitmap, 0);
      assert.ok(draw.entry(key(world, id)));
      await api.collection.remove(replacement);
      await api.resources.traverse();
      assert.equal(oldEntry.image.closed, true);
      assert.equal(draw.entry(key(world, id)), undefined);
    } finally {
      await world.close();
    }
  });
  test(`${profile} image refex uses an independent auxiliary bitmap and the next entry allocation releases it`, async () => {
    const world = await entryWorld(profile, { 'one.hg3': hg3(2, 2, rgba) });
    try {
      const { api } = await setupEntries(world),
        source = createEntryObject(api, 'IMAGE', 'source', fields);
      setFESImageFile(source, 'one');
      await api.resources.appendPending(api.collection);
      await api.resources.traverse();
      const external = world.graphics.images.create(1, 1),
        bitmap = world.graphics.images.get(external);
      await bitmap.fill(0, 0, 1, 1, 0xff123456);
      await api.images.refBitmap(api.instance, source, external);
      const auxiliary = source.imageAuxiliaryBitmap;
      await world.graphics.images.release(external);
      assert.equal(api.images.currentBitmap(source), auxiliary);
      const copy = createEntryObject(api, 'IMAGE', 'copy', {
        ...fields,
        renderID: 8,
        referenceRequest: { name: 'source', index: 0 },
      });
      await api.resources.appendPending(api.collection);
      await api.resources.traverse();
      assert.deepEqual(
        await world.graphics.images.get(copy.imageResource.bitmap).pixels(),
        Uint8ClampedArray.of(0x12, 0x34, 0x56, 255),
      );
      api.collection.create('IMAGE', 'source', 1, { scalar: true });
      await api.resources.appendPending(api.collection);
      assert.equal(source.imageAuxiliaryBitmap, 0);
      assert.equal(world.runtime.handles.records.has(auxiliary), false);
      assert.equal(api.images.currentBitmap(source), 0);
    } finally {
      await world.close();
    }
  });
  test(`${profile} duplicate BUTTON requests create all real children but every entry drives only the latest child`, async () => {
    const world = await entryWorld(profile, { 'one.hg3': hg3(2, 2, rgba) });
    let fresh;
    try {
      const { api, draw, id } = await setupEntries(world),
        object = createEntryObject(api, 'BUTTON', 'button', fields);
      setFESImageFile(object, 'one');
      api.collection.create('BUTTON', 'button', 1, { scalar: true });
      await api.resources.appendPending(api.collection);
      const [first, last] = api.resources.entries,
        ids = [first.buttonTaskID, last.buttonTaskID];
      assert.notEqual(...ids);
      assert.equal(object.nativeInputTaskID, ids[1]);
      ids.forEach((taskID) => {
        const task = world.objects.objects.get(taskID);
        assert.equal(task.kind, 6);
        assert.equal(task.parent, id);
      });
      const sent = [],
        send = world.graphics.send.bind(world.graphics);
      world.graphics.send = async (taskID, sender, message, ...args) => {
        if (ids.includes(taskID)) sent.push([taskID, message]);
        return send(taskID, sender, message, ...args);
      };
      await api.resources.traverse();
      assert.ok(sent.some(([, message]) => message === 89));
      assert.ok(sent.every(([taskID]) => taskID === ids[1]));
      fresh = await entryWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation;
      assert.deepEqual(
        restored.resources.entries.map((entry) => entry.buttonTaskID),
        ids,
      );
      assert.equal(restored.collection.lookup('button', 0).nativeInputTaskID, ids[1]);
      assert.equal(fresh.objects.objects.size, world.objects.objects.size);
      await api.collection.remove(object);
      assert.ok(draw.entry(key(world, id)));
      ids.forEach((taskID) =>
        assert.equal(world.objects.objects.get(taskID).destroyRequested, undefined),
      );
      await api.resources.traverse();
      ids.forEach((taskID) =>
        assert.equal(world.objects.objects.get(taskID).destroyRequested, true),
      );
      assert.equal(api.input.state.buttons.length, 0);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} duplicate PARTICLE entries retain orphan tasks and execute current-child queries for each visit then restore without replay`, async () => {
    const world = await entryWorld(profile);
    let fresh;
    try {
      const { api, id } = await setupEntries(world),
        object = createEntryObject(api, 'PARTICLE', 'emitter');
      api.collection.create('PARTICLE', 'emitter', 1, { scalar: true });
      await api.resources.appendPending(api.collection);
      const [first, last] = api.resources.entries,
        ids = [first.particle.taskID, last.particle.taskID],
        messages = [];
      assert.notEqual(...ids);
      assert.equal(object.particleResource, last.particle);
      for (const taskID of ids) {
        const task = world.particles.get(taskID),
          message = task.message.bind(task);
        task.message = async (words, context) => {
          messages.push([taskID, words[1]]);
          return message(words, context);
        };
      }
      configureFESParticle(object, {
        family: 1,
        program: 'probe',
        texture: '',
        count: 1,
        priority: 30,
      });
      api.particles.start(object);
      await api.resources.traverse();
      assert.deepEqual(messages, [
        [ids[1], 314],
        [ids[1], 315],
        [ids[1], 318],
        [ids[1], 318],
      ]);
      assert.equal(world.particles.get(ids[0]).bank, null);
      assert.equal(world.particles.get(ids[1]).bank.instance.state.inits, 1);
      fresh = await entryWorld(profile, {}, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation,
        restoredObject = restored.collection.lookup('emitter', 0);
      assert.deepEqual(
        restored.resources.entries.map((e) => e.particle.taskID),
        ids,
      );
      assert.equal(restoredObject.particleResource, restored.resources.entries[1].particle);
      assert.equal(fresh.particles.get(ids[0]).bank, null);
      assert.equal(fresh.particles.get(ids[1]).bank.instance.state.inits, 1);
      await api.collection.remove(object);
      await api.resources.traverse();
      ids.forEach((taskID) => {
        assert.ok(world.objects.objects.has(taskID));
        assert.equal(world.objects.objects.get(taskID).destroyRequested, undefined);
      });
      assert.equal(api.resources.entries.length, 0);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
