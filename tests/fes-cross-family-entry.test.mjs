// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';

async function declareImage(world, id) {
  const bytes = new Uint8Array(36),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('text'));
  view.setUint32(32, 1, true);
  await world.sendEngine(id, world.main.id, 338, 0, FES_OBJECT_DEFINITION_ORDER.indexOf('CIMAGE'), {
    payload: {
      string: (at) => new TextDecoder().decode(bytes.subarray(at, bytes.indexOf(0, at))),
      load: (at) => view.getUint32(at, true),
    },
  });
}
async function defineSize(world, id) {
  const bytes = new TextEncoder().encode('#OBJECT SIZE\0text 24,16\0');
  await world.sendEngine(id, world.main.id, 339, 0, 13, {
    payload: {
      string: (at) => new TextDecoder().decode(bytes.subarray(at, bytes.indexOf(0, at))),
    },
  });
}
async function restoreWorld(profile, saved) {
  const world = await defaultFESWorld(profile, {}, { initialize: false }),
    read = world.game.read.bind(world.game);
  world.game.read = (name) => {
    if (name !== 'case.kcs') throw new Error(`cross-family restore read ${name}`);
    return read(name);
  };
  try {
    await world.restore(saved);
    return world;
  } catch (error) {
    await world.close();
    throw error;
  }
}

for (const profile of profiles)
  test(`${profile}: default CIMAGE null-entry visits keep the defined idle path and reject initialization through fresh restore`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': new TextEncoder().encode(`#DEFINE
STRING text
#OBJECT SIZE POS PRI DISP
text 48,16 4,4 60001 1
#START
text layout size 4
text layout color 255 255 255
text layout frame 10
text layout shadow 0 0
text str ABC
text draw
text skip
next IDLE
#IDLE
#DROP
text delete
break
`),
    });
    let fresh, unsafeFresh, oldTaskID;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      await h.task.tick();
      const old = h.instance.collection.lookup('text', 0);
      oldTaskID = old.nativeTaskID;
      const writer = await world.graphics.get(oldTaskID).writer(),
        pixels = writer.frame().rgba.slice(),
        oldEntry = h.instance.runtime.resources.entries[0];
      assert.ok(pixels.some((value, at) => at % 4 === 3 && value));
      await h.task.player.notify('DROP');
      assert.equal(h.instance.collection.lookup('text', 0), null);
      assert.ok(world.objects.objects.has(oldTaskID));
      await declareImage(world, h.id);
      const image = h.instance.collection.lookup('text', 0);
      assert.notEqual(image.handle, old.handle);
      assert.equal(image.nativeType, 1);
      assert.equal(image.sizeDirty, false);
      assert.equal(image.dirty, false);
      assert.equal(image.displayDelta, 0);
      await h.task.syncObjects();
      const entries = h.instance.runtime.resources.entries;
      assert.equal(entries.length, 2);
      assert.equal(entries[0], oldEntry);
      assert.equal(entries[0].savedType, 21);
      assert.equal(entries[0].image, undefined);
      assert.equal(entries[0].cleanupTaskID, oldTaskID);
      assert.equal(entries[1].savedType, 1);
      assert.equal(image.imageResource, entries[1].image);
      assert.equal(entries[1].image.bitmap, 0);
      assert.equal(entries[1].image.source, 0);
      assert.deepEqual(writer.frame().rgba, pixels);
      assert.ok(world.graphics.get(oldTaskID).graph);

      fresh = await restoreWorld(profile, world.snapshot());
      const freshTask = fresh.objects.objects.get(h.id).implementation,
        restored = freshTask.player.root.collection.lookup('text', 0);
      await freshTask.syncObjects();
      assert.equal(restored.nativeType, 1);
      assert.equal(restored.imageResource.bitmap, 0);
      assert.equal(freshTask.player.root.runtime.resources.entries[0].cleanupTaskID, oldTaskID);
      assert.deepEqual((await fresh.graphics.get(oldTaskID).writer()).frame().rgba, pixels);

      await defineSize(world, h.id);
      assert.equal(image.sizeDirty, true);
      await assert.rejects(h.task.syncObjects(), /FES image entry has no live wrapper/);
      assert.equal(entries[0], oldEntry);
      assert.equal(image.imageResource.bitmap, 0);
      assert.ok(world.objects.objects.has(oldTaskID));
      assert.deepEqual(writer.frame().rgba, pixels);
      unsafeFresh = await restoreWorld(profile, world.snapshot());
      const unsafeTask = unsafeFresh.objects.objects.get(h.id).implementation;
      await assert.rejects(unsafeTask.syncObjects(), /FES image entry has no live wrapper/);
      assert.ok(unsafeFresh.objects.objects.has(oldTaskID));
      assert.deepEqual((await unsafeFresh.graphics.get(oldTaskID).writer()).frame().rgba, pixels);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
      assert.equal(unsafeFresh.nativeEngine, undefined);
    } finally {
      await unsafeFresh?.close();
      await fresh?.close();
      await world.close();
      if (oldTaskID !== undefined) {
        assert.equal(world.objects.objects.has(oldTaskID), false);
        if (fresh) assert.equal(fresh.objects.objects.has(oldTaskID), false);
        if (unsafeFresh) assert.equal(unsafeFresh.objects.objects.has(oldTaskID), false);
      }
    }
  });
