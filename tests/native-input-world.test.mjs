// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  const create = () => {
    const game = memoryGame({
        'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]], [[64, 'authored text']]),
      }),
      random = new ParticleRandom(),
      configuration = new NativeConfiguration({ profile });
    return new NativeWorld({
      game,
      images: {},
      host: { inputText: () => null },
      profile,
      configuration,
      random,
      storage: { read: async () => null, write: async () => true },
      motionLibrary: new MotionLibrary(game, { profile, random }),
    });
  };
  test(`${profile} cursor wrappers preserve mapped-empty filenames, hotspots and visibility outputs`, async () => {
    const world = create(),
      images = [];
    world.host.nativeCursorImageChanged = async (...args) => {
      images.push(args);
      return 1;
    };
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        call = (id, args) => world.runtime.native('main', id, args, task.machine, task);
      task.machine.writeString('cursor_日本', 64);
      assert.deepEqual(await call(0x18b, [64, 0xffffffff, 0x8000]), { control: 2 });
      assert.deepEqual(images.pop(), ['cursor_日本', 65535, 32768, world]);
      task.machine.store(0, 0, 1);
      await call(0x18b, [0, 0, 0]);
      assert.deepEqual(images.pop(), ['', 0, 0, world]);
      world.input.cursorVisible = false;
      assert.equal((await call(0x18c, [])).value, 0);
      world.input.cursorVisible = true;
      assert.equal((await call(0x18c, [])).value, 1);
      if (profile.startsWith('sdk-')) {
        await call(0x18b, [0xffffffff, 0, 0]);
        assert.deepEqual(images.pop(), [null, 0, 0, world]);
      } else await assert.rejects(call(0x18b, [0xffffffff, 0, 0]), /uninitialized/);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
  test(`${profile} native input wrappers resolve the caller Top and retain independent captures after restore`, async () => {
    const world = create();
    let restored;
    try {
      await world.initialize('main.kcs');
      const top = await world.objects.create({ kind: 1, nativeID: 0 }),
        inner = await world.spawnScript('main.kcs', { parent: top }),
        outerInput = world.inputFor(world.main.id),
        innerInput = world.inputFor(inner.id),
        call = (task, id, args) => world.runtime.native('main', id, args, task.machine, task);
      assert.equal(outerInput, world.input);
      assert.notEqual(innerInput, outerInput);
      assert.equal(world.nativeTaskID(inner.id), world.nativeTaskID(world.main.id));
      for (const [task, priority] of [
        [world.main, 7],
        [inner, 11],
      ]) {
        [10, 20, 80, 90].forEach((n, i) => task.machine.store(128 + i * 4, n));
        await call(task, 0x90, [0x12345678, priority, 128, 5]);
      }
      assert.deepEqual(
        outerInput.regions.map((r) => [r.owner, r.priority, r.bounds]),
        [[world.main.id, 7, [10, 20, 80, 90]]],
      );
      assert.deepEqual(
        innerInput.regions.map((r) => [r.owner, r.priority, r.bounds]),
        [[inner.id, 11, [10, 20, 80, 90]]],
      );
      innerInput.key(12, true, 8, 2);
      assert.equal((await call(inner, 0x11d, [12])).value, 8);
      assert.equal((await call(world.main, 0x11d, [12])).value, 0);
      innerInput.pulses[12] = 5;
      assert.equal((await call(inner, 0x11d, [12])).value, 1);
      assert.equal(innerInput.pulses[12], 1);
      innerInput.regions[0].active = 1;
      assert.deepEqual(await call(inner, 0x11e, []), { control: 2 });
      assert.equal(innerInput.regions[0].active, 0);
      assert.deepEqual(
        [innerInput.previousX, innerInput.previousY, innerInput.forceCursor],
        [-1, -1, true],
      );
      await call(inner, 0x193, [2, 0]);
      assert.equal(innerInput.enabled[2], 0);
      assert.equal(outerInput.enabled[2], 1);
      innerInput.captures[4] = inner.id;
      innerInput.held[16] = 23;
      outerInput.pointer(31, 47);
      await call(world.main, 0x95, [192, 196]);
      assert.deepEqual([world.main.machine.load(192), world.main.machine.load(196)], [31, 47]);
      await call(inner, 0x97, [64]);
      assert.equal((await call(inner, 0x98, [])).value, 2);
      await call(inner, 0x99, [256]);
      assert.equal(inner.machine.string(256), 'authored text');
      assert.equal(outerInput.text, '');
      restored = create();
      await restored.restore(structuredClone(world.snapshot()));
      const savedInner = restored.inputFor(inner.id);
      assert.notEqual(savedInner, restored.input);
      assert.equal(savedInner.captures[4], inner.id);
      assert.equal(savedInner.held[16], 23);
      assert.equal(savedInner.enabled[2], 0);
      assert.equal(restored.input.enabled[2], 1);
      assert.equal(savedInner.text, 'authored text');
      await call(inner, 0x91, []);
      assert.equal(innerInput.regions.length, 0);
      assert.equal(outerInput.regions.length, 1);
    } finally {
      await world.close({ flushFiles: false });
      await restored?.close({ flushFiles: false });
    }
  });
  test(`${profile} the shared browser device and separate Top timers resume in a fresh world`, async () => {
    const world = create();
    let restored;
    try {
      world.inputBindings = new NativeInputBindings(world.input, world.configuration);
      await world.initialize('main.kcs');
      const top = await world.objects.create({ kind: 1, parent: world.root }),
        inner = await world.spawnScript('main.kcs', { parent: top }),
        row = world.configuration.keys.rows[2];
      row.enabled = 1;
      row.keyboard.set([13, 0, 0, 0]);
      world.inputBindings.key('keyboard', 13, true);
      world.inputBindings.sample();
      world.input.pointer(25, 35);
      await world.tick();
      assert.equal(world.input.held[8], 1);
      assert.equal(world.inputFor(inner.id).held[8], 1);
      assert.deepEqual([world.inputFor(inner.id).x, world.inputFor(inner.id).y], [25, 35]);
      world.inputBindings.key('keyboard', 13, false);
      restored = create();
      await restored.restore(structuredClone(world.snapshot()));
      assert.notEqual(restored.inputBindings, world.inputBindings);
      assert.deepEqual(restored.inputBindings.snapshot(), world.inputBindings.snapshot());
      for (const current of [world, restored]) {
        current.inputBindings.sample();
        await current.tick();
        // The original window device keeps sampled presses until the first
        // InputTask's frame-end copy. A later Top sees that copy this frame.
        assert.equal(current.input.held[8], 2);
        assert.equal(current.inputFor(inner.id).held[8], 0);
        current.inputBindings.sample();
        await current.tick();
        assert.equal(current.input.held[8], 0);
      }
      assert.deepEqual(restored.input.snapshot(), world.input.snapshot());
      assert.deepEqual(restored.inputFor(inner.id).snapshot(), world.inputFor(inner.id).snapshot());
    } finally {
      await world.close({ flushFiles: false });
      await restored?.close({ flushFiles: false });
    }
  });
}
