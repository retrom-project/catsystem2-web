// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { notify } from './fixtures/fes-effekseer-world.mjs';

const source = `#DEFINE
PARTICLE p[2]
CPLANE color
PLANE planes[2]
#OBJECT SIZE
color 8,8
planes 8,8
#START
$20=0
next IDLE
#IDLE
break
next IDLE
#COLOR
p attach color
$40=++$40
break
#PLANE
p attach planes[$20++]
$41=++$41
break
#WRONG
p attach p[0]
$42=++$42
break
#DELETE
p[0] delete
$43=++$43
break
`;

async function open(profile) {
  const world = await defaultFESWorld(profile, {
    'screen.fes': new TextEncoder().encode(source),
  });
  world.ensureNativeEngine = () => {
    throw new Error('PARTICLE attach must stay in the default JavaScript path');
  };
  try {
    await world.objects.create({
      kind: 6,
      parent: world.main.id,
      nativeID: 0x70000000,
      name: 'identity spacer',
    });
    const h = await loadDefaultFES(world);
    await h.task.tick();
    return { ...h, world, runtime: h.instance.runtime };
  } catch (error) {
    await world.close();
    throw error;
  }
}

function observe(world, counter = () => null) {
  const messages = [],
    send = world.sendEngine.bind(world);
  world.sendEngine = (target, sender, code, w, l, context = {}) => {
    if (code >= 314 && code <= 321)
      messages.push({ target, sender, code, w, l, flags: context.flags ?? 0, counter: counter() });
    return send(target, sender, code, w, l, context);
  };
  return messages;
}

function particles(h) {
  return [0, 1].map((index) => h.instance.collection.lookup('p', index));
}

function child(h, object) {
  assert.equal(object.nativeType, 23);
  const resource = object.particleResource,
    record = h.world.objects.objects.get(resource.taskID);
  assert.equal(resource.owner, h.id);
  assert.equal(record.kind, 16);
  assert.equal(record.parent, h.id);
  assert.equal(record.creator, h.id);
  assert.equal(h.world.particles.get(record.id), record.implementation);
  assert.equal(Boolean(record.implementation.bank), false);
  return record;
}

async function fresh(h) {
  const snapshot = h.world.snapshot(),
    world = await defaultFESWorld(h.world.profile, {}, { initialize: false }),
    reads = [],
    allocations = [],
    read = world.game.read.bind(world.game),
    require = world.game.require.bind(world.game),
    create = world.objects.create.bind(world.objects),
    messages = observe(world);
  world.ensureNativeEngine = () => {
    throw new Error('PARTICLE attach restore must stay JavaScript');
  };
  for (const [method, original] of [
    ['read', read],
    ['require', require],
  ])
    world.game[method] = (name, ...args) => {
      reads.push([method, name]);
      if (name !== 'case.kcs') throw new Error('PARTICLE restore replayed ' + name);
      return original(name, ...args);
    };
  world.objects.create = (options) => {
    if (options.kind === 16) allocations.push(options);
    return create(options);
  };
  try {
    await world.restore(snapshot);
    const task = world.objects.objects.get(h.id).implementation;
    return {
      world,
      id: h.id,
      task,
      instance: task.player.root,
      runtime: task.player.root.runtime,
      messages,
      reads,
      allocations,
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}

for (const profile of profiles) {
  test(`${profile}: normal DEFINE PARTICLE attaches live CPLANE/PLANE through owned321, preserves class gates and fresh/deletion/owner lifetime`, async () => {
    const h = await open(profile);
    let restored;
    try {
      const objects = particles(h),
        children = objects.map((object) => child(h, object)),
        color = h.instance.collection.lookup('color', 0),
        plane = h.instance.collection.lookup('planes', 0);
      assert.equal(h.world.objects.objects.get(h.id).kind, 34);
      assert.equal(color.nativeType, 3);
      assert.equal(plane.nativeType, 4);
      assert.equal(h.world.objects.objects.get(color.nativeTaskID).kind, 2);
      assert.equal(h.world.objects.objects.get(plane.nativeTaskID).kind, 2);
      const colorID = h.world.nativeTaskID(color.nativeTaskID),
        planeID = h.world.nativeTaskID(plane.nativeTaskID);
      assert.notEqual(colorID, color.handle);
      assert.notEqual(planeID, plane.handle);
      assert.notEqual(children[0].id, children[1].id);
      let phase = 40;
      const messages = observe(h.world, () => h.instance.global(phase)),
        expected = (target) =>
          children.map((record) => ({
            target: record.id,
            sender: h.id,
            code: 321,
            w: 0,
            l: target,
            flags: 0,
            counter: 1,
          }));
      await notify(h, 'COLOR');
      assert.deepEqual(messages, expected(colorID));
      assert.equal(h.instance.nativeQueuePending, false);
      assert.deepEqual(h.runtime.pendingRecords, []);
      for (const object of objects) {
        assert.equal(object.attachment, colorID);
        assert.equal(object.attachmentDirty, false);
        assert.equal(child(h, object).implementation.state.attachment, colorID | 0);
      }

      messages.length = 0;
      phase = 41;
      await notify(h, 'PLANE');
      assert.equal(h.instance.global(20), 1); // One reference parse for both raw23 holders.
      assert.deepEqual(messages, expected(planeID));
      for (const object of objects) {
        assert.equal(object.attachment, planeID);
        assert.equal(object.attachmentDirty, false);
        assert.equal(child(h, object).implementation.state.attachment, planeID | 0);
      }

      messages.length = 0;
      phase = 42;
      await notify(h, 'WRONG');
      assert.equal(h.instance.global(42), 1);
      assert.deepEqual(messages, []);
      for (const object of objects) assert.equal(object.attachment, planeID);

      // Snapshot only after the attachment dirty flag was consumed. The normal
      // FES/resource owners restore the existing children without replaying it.
      restored = await fresh(h);
      assert.deepEqual(restored.messages, []);
      assert.deepEqual(restored.allocations, []);
      assert.equal(
        restored.reads.every(([, name]) => name === 'case.kcs'),
        true,
      );
      const restoredObjects = particles(restored);
      for (let index = 0; index < restoredObjects.length; index++) {
        const object = restoredObjects[index],
          record = child(restored, object);
        assert.equal(record.id, children[index].id);
        assert.equal(object.attachment, planeID);
        assert.equal(object.attachmentDirty, false);
        assert.equal(record.implementation.state.attachment, planeID | 0);
      }
      await restored.runtime.sync();
      assert.deepEqual(restored.messages, []);
      assert.deepEqual(restored.allocations, []);

      await notify(restored, 'DELETE');
      assert.equal(restored.instance.global(43), 1);
      assert.equal(restored.instance.collection.lookup('p', 0), null);
      assert.equal(restoredObjects[0].particleResource.detached, true);
      for (const record of children) {
        assert.equal(restored.world.objects.objects.get(record.id).kind, 16);
        assert.equal(restored.world.particles.tasks.has(record.id), true);
      }
      assert.deepEqual(restored.messages, []);
      await restored.world.objects.release(restored.id);
      for (const record of children) {
        assert.equal(restored.world.objects.objects.has(record.id), false);
        assert.equal(restored.world.particles.tasks.has(record.id), false);
      }
      assert.deepEqual(restored.messages, []); // No load/start/stop/end packet was added.
      assert.deepEqual(restored.allocations, []);
    } finally {
      await h.world.close();
      await restored?.world.close();
    }
  });
}
