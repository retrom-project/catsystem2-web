// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  source = `#DEFINE
BUTTON b
CIMAGE c
#OBJECT SIZE POS
b 16,16 30,40,0
#OBJECT SIZE POS PRI COLOR DISP
c 4,4 5,6,0 200 0xffffffff 1
#START
b setact
next IDLE
#IDLE
break
next IDLE
#b.PUSH_L
c pos 20 30 0 1
$10=17
break
#b.PUSH_R
c pos 40 50 0 1
$11=23
break
`,
  modalSource = source.replace('c pos 20 30 0 1', 'config_open\nc pos 20 30 0 1');
async function open(profile, text = source) {
  const world = await defaultFESWorld(profile, { 'screen.fes': ascii(text) });
  world.ensureNativeEngine = () => {
    throw new Error('FES PUSH must use its default JavaScript owner');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    h.task.input.input.pointer(31, 41, 1);
    return { ...h, world, input: h.task.input.input };
  } catch (error) {
    await world.close();
    throw error;
  }
}
function position(h) {
  const entry = h.instance.runtime.resources.entries.find((entry) => entry.savedType === 1);
  return h.draw.entry(entry.image.binding.key).position.slice();
}
function observePush(h) {
  const seen = [],
    receive = h.task.input.message.bind(h.task.input);
  h.task.input.message = async (words, context) => {
    const result = await receive(words, context);
    if (words[1] === 9 && h.world.objects.objects.has(h.id))
      seen.push({
        key: words[3],
        position: position(h),
        changed: h.instance.collection.lookup('c', 0).dirty,
      });
    return result;
  };
  return seen;
}
for (const profile of profiles) {
  test(`${profile}: actual World Input PUSH_L/R updates retained resources before the callback returns`, async () => {
    const h = await open(profile);
    try {
      const before = position(h),
        seen = observePush(h);
      h.input.key(0, true);
      await h.world.tick();
      assert.equal(h.instance.global(10), 17);
      const left = seen.filter((call) => call.key === 0);
      assert.ok(left.length > 0);
      assert.ok(
        left.every(
          (call) => call.position[0] === before[0] + 15 && call.position[1] === before[1] + 24,
        ),
      );
      assert.ok(left.every((call) => !call.changed));
      h.input.key(0, false);
      await h.world.tick();
      h.input.key(1, true);
      await h.world.tick();
      assert.equal(h.instance.global(11), 23);
      const right = seen.filter((call) => call.key === 1);
      assert.ok(right.length > 0);
      assert.ok(
        right.every(
          (call) => call.position[0] === before[0] + 35 && call.position[1] === before[1] + 44,
        ),
      );
      assert.ok(right.every((call) => !call.changed));
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: real PUSH config_open pending owner-close cancels resolve/reject before resource traversal or continuation`, async () => {
    for (const rejected of [false, true]) {
      const h = await open(profile, modalSource),
        gate = Promise.withResolvers(),
        entered = Promise.withResolvers(),
        runtime = h.instance.runtime,
        traverse = runtime.resources.traverse.bind(runtime.resources),
        visits = [];
      let pending,
        inPush = false;
      const receive = h.task.input.message.bind(h.task.input);
      h.task.input.message = async (words, context) => {
        if (words[1] !== 9) return receive(words, context);
        inPush = true;
        try {
          return await receive(words, context);
        } finally {
          inPush = false;
        }
      };
      h.world.host.nativeWindowAction = (action) => {
        if (action.type === 'fes-owner-close') {
          assert.equal(action.owner, h.id);
          return 1;
        }
        assert.equal(action.type, 'fes-configuration');
        entered.resolve();
        return gate.promise;
      };
      runtime.resources.traverse = (context) => {
        if (inPush) visits.push(context);
        return traverse(context);
      };
      try {
        h.input.key(0, true);
        pending = h.world.tick();
        await entered.promise;
        assert.equal(visits.length, 0);
        await h.world.objects.release(h.id);
        if (rejected) gate.reject(new Error('cancelled real PUSH host'));
        else gate.resolve(1);
        await pending;
        assert.equal(visits.length, 0);
        assert.equal(h.instance.global(10), 0);
        assert.equal(h.instance.finished, null);
        assert.equal(runtime.closed, true);
        assert.equal(h.world.objects.objects.has(h.id), false);
      } finally {
        gate.resolve(1);
        await pending?.catch(() => {});
        await h.world.close();
      }
    }
  });
  test(`${profile}: actual live PUSH Host and resource errors propagate without fake completion`, async () => {
    const h = await open(profile, modalSource);
    try {
      h.world.host.nativeWindowAction = (action) => {
        if (action.type === 'fes-owner-close') return 1;
        assert.equal(action.type, 'fes-configuration');
        throw new Error('live PUSH host failure');
      };
      h.input.key(0, true);
      await assert.rejects(h.world.tick(), /live PUSH host failure/);
      assert.equal(h.instance.global(10), 0);
      assert.equal(h.instance.runtime.closed, false);
      assert.equal(h.instance.finished, null);
    } finally {
      await h.world.close();
    }
    const resource = await open(profile);
    try {
      const receive = resource.task.input.message.bind(resource.task.input),
        traverse = resource.instance.runtime.resources.traverse.bind(
          resource.instance.runtime.resources,
        );
      let inPush = false;
      resource.task.input.message = async (words, context) => {
        if (words[1] !== 9) return receive(words, context);
        inPush = true;
        try {
          return await receive(words, context);
        } finally {
          inPush = false;
        }
      };
      resource.instance.runtime.resources.traverse = (context) => {
        if (inPush) throw new Error('live PUSH resource failure');
        return traverse(context);
      };
      resource.input.key(0, true);
      await assert.rejects(resource.world.tick(), /live PUSH resource failure/);
      assert.equal(resource.instance.runtime.closed, false);
    } finally {
      await resource.world.close();
    }
  });
  test(`${profile}: fresh World restores the same current resources and runs real PUSH post-processing without source replay`, async () => {
    const h = await open(profile);
    let fresh;
    try {
      const state = h.world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      fresh.ensureNativeEngine = () => {
        throw new Error('PUSH restore must stay JavaScript');
      };
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        reads.push(name);
        if (name !== 'case.kcs') throw new Error('PUSH restore replayed ' + name);
        return read(name);
      };
      await fresh.restore(state);
      const task = fresh.objects.objects.get(h.id).implementation,
        restored = {
          world: fresh,
          id: h.id,
          task,
          instance: task.player.root,
          draw: fresh.graphics.drawTasks.get(h.surface),
        },
        before = position(restored),
        seen = observePush(restored),
        input = task.input.input;
      assert.deepEqual(reads, ['case.kcs']);
      input.key(0, true);
      await fresh.tick();
      assert.equal(restored.instance.global(10), 17);
      assert.ok(seen.length > 0);
      assert.ok(
        seen.every(
          (call) => call.position[0] === before[0] + 15 && call.position[1] === before[1] + 24,
        ),
      );
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await h.world.close();
    }
  });
}

test('Game actual Input PUSH consumes EFK FILE/Play before returning on the same live frame executor', async () => {
  const { open: openEFK, task: effectTask } = await import('./fixtures/fes-effekseer-world.mjs'),
    text = `#DEFINE
BUTTON b
EFKPLANE fx
#OBJECT SIZE POS
b 16,16 30,40,0
#OBJECT FILE
fx scene.efk
#START
b setact
next IDLE
#IDLE
break
next IDLE
#b.PUSH_L
fx load other.efk
fx play
$10=17
break
`,
    h = await openEFK({ text }),
    world = h.world;
  try {
    await world.withExecutor(world.effekseer.frameExecutor, (executorEntry) =>
      world.sendEngine(h.id, world.main.id, 333, 0, 0, { executorEntry }),
    );
    const input = h.task.input.input,
      tick = input.tick.bind(input),
      receive = h.task.input.message.bind(h.task.input),
      t = effectTask(h),
      play = t.manager.play.bind(t.manager),
      sampling = [],
      returns = [];
    let frameEntry,
      inInput = false;
    Object.defineProperty(input, 'tick', {
      value: async (frame, context) => {
        frameEntry = context.executorEntry;
        inInput = true;
        try {
          return await tick(frame, context);
        } finally {
          inInput = false;
        }
      },
    });
    t.manager.play = (...args) => {
      sampling.push([inInput, args[2]]);
      return play(...args);
    };
    h.task.input.message = async (words, context) => {
      const result = await receive(words, context);
      if (words[1] === 9) {
        const effect = h.instance.collection.lookup('fx', 0);
        returns.push([
          context.executorEntry,
          effect.resourcePending,
          effect.playDirty,
          t.manager.sets.size,
        ]);
      }
      return result;
    };
    input.pointer(31, 41, 1);
    input.key(0, true);
    await world.tick();
    assert.equal(h.instance.global(10), 17);
    assert.ok(returns.length > 0);
    assert.ok(
      returns.every(
        ([entry, file, pending, size]) => entry === frameEntry && !file && !pending && size > 0,
      ),
    );
    assert.ok(sampling.length > 0);
    assert.ok(sampling.every(([inside, thread]) => inside && thread === 'frame'));
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close();
  }
});
