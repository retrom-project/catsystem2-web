// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profiles,
  particleWorld,
  setupParticle,
  attachPlane,
} from './fixtures/fes-particle-driver-world.mjs';
import {
  initializeFESParticle,
  configureFESParticle,
  setFESParticleRegisters,
} from '../src/native/fes-particle-driver.mjs';
import { applyFESMotionState, fesMotionState } from '../src/native/fes-motion-model.mjs';

for (const profile of profiles) {
  test(`${profile}: pure PARTICLE declaration allocates only its real owned kind16 task`, async () => {
    const world = await particleWorld(profile);
    try {
      const h = await setupParticle(world),
        before = world.objects.objects.size;
      assert.equal(h.object.particleResource, undefined);
      await h.sync();
      assert.equal(world.objects.objects.size, before + 1);
      assert.equal(h.task().record.kind, 16);
      assert.equal(h.task().record.parent, h.ownerID);
      assert.equal(h.task().bank, null);
      assert.equal(world.nativeEngine, undefined);
      const resource = h.object.particleResource;
      await h.sync();
      assert.equal(h.object.particleResource, resource);
      assert.equal(world.objects.objects.size, before + 1);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: init/param/MOT/start/stop ordering reaches the real JS plugin`, async () => {
    const world = await particleWorld(profile);
    try {
      const h = await setupParticle(world);
      await h.sync();
      const messages = [],
        original = h.task().message.bind(h.task());
      h.task().message = async (words, context) => {
        messages.push(words[1]);
        return original(words, context);
      };
      configureFESParticle(h.object, {
        family: 1,
        program: 'probe',
        texture: '',
        count: 1,
        priority: -123456789,
      });
      setFESParticleRegisters(h.object, [12.75, 0xffffffff, 2147483648, 16777217]);
      const motion = fesMotionState(h.object);
      motion[0x73] = 72;
      applyFESMotionState(h.api.instance, h.object, motion);
      h.api.driver.start(h.object);
      h.api.driver.start(h.object);
      await h.sync();
      assert.deepEqual(messages, [314, 319, 320, 315, 318]);
      assert.deepEqual(
        [...h.task().bank.registers].slice(0, 5),
        [12, -1, -2147483648, 16777216, 0],
      );
      assert.equal(h.task().bank.priority, Math.fround(-123456789));
      assert.equal(h.task().bank.alpha, 72);
      assert.equal(h.task().bank.instance.state.inits, 1);
      assert.equal(h.task().bank.instance.module.shared.constructs, 1);
      assert.equal(h.object.running, true);
      messages.length = 0;
      h.api.driver.start(h.object);
      h.api.driver.stop(h.object);
      h.api.driver.stop(h.object);
      await h.sync();
      assert.deepEqual(messages, [315, 316]);
      assert.equal(h.task().bank.instance.state.inits, 2);
      assert.equal(h.task().bank.instance.module.shared.stops, 1);
      assert.equal(h.object.running, false);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: reinit retains active without Init and zeroes registers until param is dirty`, async () => {
    const world = await particleWorld(profile);
    try {
      const h = await setupParticle(world),
        spec = {
          family: 1,
          program: 'probe',
          texture: '',
          count: 1,
          priority: 30,
        };
      configureFESParticle(h.object, spec);
      setFESParticleRegisters(h.object, [9, 8]);
      h.api.driver.start(h.object);
      await h.sync();
      const first = h.task().bank.instance;
      configureFESParticle(h.object, spec);
      await h.sync();
      const second = h.task().bank.instance;
      assert.notEqual(second, first);
      assert.equal(second.active, true);
      assert.equal(second.state.inits, undefined);
      assert.equal(first.module.shared.destructs, 1);
      assert.equal(first.module.shared.stops, undefined);
      assert.equal(second.module.shared.constructs, 1);
      assert.equal(second.module.shared.stops, undefined);
      assert.deepEqual([...h.task().bank.registers], Array(32).fill(0));
      setFESParticleRegisters(h.object, [4]);
      await h.sync();
      assert.equal(h.task().bank.registers[0], 4);
      h.object.alpha = 255;
      h.object.dirty = true;
      await h.sync();
      assert.equal(h.task().state.alpha, 256);
      assert.equal(h.task().bank.alpha, 256);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: family0 executes the real PTCL script; missing resources retain load dirty`, async () => {
    const world = await particleWorld(profile);
    try {
      const h = await setupParticle(world);
      configureFESParticle(h.object, {
        family: 0,
        program: 'probe',
        texture: '',
        count: 1,
        priority: 12,
      });
      h.api.driver.start(h.object);
      await h.sync();
      assert.equal(h.task().bank.family, 'script');
      assert.equal(h.task().bank.program, 'ptcl/probe.kcs');
      h.task().tick(1);
      h.task().tick(2);
      configureFESParticle(h.object, {
        family: 1,
        program: 'missing',
        texture: '',
        count: 1,
        priority: 0,
      });
      await assert.rejects(h.sync(), /Missing ptclpi resource/);
      assert.equal(h.object.allocationDirty, true);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: attachment stores actual native graph identity and sends after liveness`, async () => {
    const world = await particleWorld(profile);
    try {
      const h = await setupParticle(world),
        target = await attachPlane(world, h.ownerID);
      configureFESParticle(h.object, {
        family: 1,
        program: 'probe',
        texture: '',
        count: 1,
        priority: 0,
      });
      h.api.driver.start(h.object);
      h.api.driver.attach(h.api.instance, h.object, target);
      await h.sync();
      assert.equal(h.object.attachment, 991);
      assert.equal(h.task().state.attachment, 991);
      assert.equal(h.task().bank.attachment.id, 991);
      assert.equal(h.object.attachmentDirty, false);
      assert.throws(() => h.api.driver.attach(h.api.instance, h.object, null), /live CPLANE/);
      assert.throws(
        () => h.api.driver.attach(h.api.instance, h.object, { nativeType: 2 }),
        /live CPLANE/,
      );
      assert.throws(
        () => h.api.driver.attach(h.api.instance, h.object, { nativeType: 4 }),
        /no World task/,
      );
    } finally {
      await world.close();
    }
  });

  test(`${profile}: ordinary object deletion retains the child; owning teardown destructs without Stop`, async () => {
    const world = await particleWorld(profile);
    try {
      const h = await setupParticle(world);
      configureFESParticle(h.object, {
        family: 1,
        program: 'probe',
        texture: '',
        count: 1,
        priority: 0,
      });
      h.api.driver.start(h.object);
      await h.sync();
      const child = h.task(),
        module = child.bank.instance.module;
      h.object.deleted = true;
      await h.sync();
      assert.equal(h.object.particleResource.detached, true);
      assert.equal(world.particles.tasks.has(child.record.id), true);
      child.tick(1);
      assert.equal(module.shared.execs, 1);
      assert.equal(module.shared.destructs, undefined);
      await world.objects.release(h.ownerID);
      assert.equal(world.particles.tasks.has(child.record.id), false);
      assert.equal(module.shared.destructs, 1);
      assert.equal(module.shared.stops, undefined);
    } finally {
      await world.close();
    }
  });

  test(`${profile}: fresh World restore rebinds identity without resource I/O or callbacks`, async () => {
    const first = await particleWorld(profile);
    let second;
    try {
      const h = await setupParticle(first);
      configureFESParticle(h.object, {
        family: 1,
        program: 'probe',
        texture: '',
        count: 1,
        priority: 0,
      });
      h.api.driver.start(h.object);
      await h.sync();
      h.task().tick(5);
      const state = structuredClone(first.snapshot()),
        childID = h.object.particleResource.taskID;
      h.task().tick(8);
      const expected = h.task().bank.instance.records();
      second = await particleWorld(profile, { initialize: false });
      second.game.require = async () => {
        throw new Error('restore attempted particle file I/O');
      };
      await second.restore(state);
      const api = second.objects.objects.get(h.ownerID).implementation,
        object = api.instance.objects[0],
        task = second.particles.get(childID),
        module = task.bank.instance.module;
      const calls = structuredClone(module.shared),
        records = task.bank.instance.records(),
        size = second.objects.objects.size,
        random = second.random.snapshot();
      await api.driver.update(api.instance, object, { restoring: true });
      assert.equal(object.particleResource.taskID, childID);
      assert.equal(second.objects.objects.size, size);
      assert.deepEqual(module.shared, calls);
      assert.deepEqual(task.bank.instance.records(), records);
      assert.deepEqual(second.random.snapshot(), random);
      task.tick(8);
      assert.deepEqual(task.bank.instance.records(), expected);
      assert.equal(second.nativeEngine, undefined);
    } finally {
      await first.close();
      await second?.close();
    }
  });
}

test('particle initializer and missing dependencies fail explicitly', async () => {
  assert.throws(() => initializeFESParticle({ nativeType: 2 }), /Expected FES PARTICLE/);
  const world = await particleWorld(profiles[0]);
  try {
    const h = await setupParticle(world);
    await h.sync();
    await world.objects.release(h.object.particleResource.taskID);
    await assert.rejects(h.sync(), /lost its owning World task/);
  } finally {
    await world.close();
  }
});
