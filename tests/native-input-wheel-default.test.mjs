// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const sentinel = 0x13579bdf;
function fixture(profile) {
  const game = memoryGame({
      'main.kcs': kcsProgram([
        [37, 256],
        [43, 0x47, 4],
        [41, 0],
      ]),
      'wheel.kcs': kcsProgram([
        [37, sentinel],
        [37, 256],
        [43, 0x47, 4],
        [45],
        [43, 0x3a9, 0],
        [37, 256],
        [43, 0x47, 4],
        [59],
      ]),
    }),
    random = new ParticleRandom(19, 23),
    configuration = new NativeConfiguration({ profile }),
    world = new NativeWorld({
      game,
      profile,
      random,
      configuration,
      images: {},
      host: { nativeWindowFocused: () => true },
      storage: { read: async () => null, write: async () => true },
      motionLibrary: new MotionLibrary(game, { profile, random }),
    });
  for (const [index, code] of [
    [0, 6],
    [1, 7],
  ]) {
    const row = configuration.keys.rows[index];
    row.enabled = 1;
    row.mouse.fill(0);
    row.mouse[0] = code;
  }
  world.inputBindings = new NativeInputBindings(world.input, configuration);
  let originalAttempts = 0;
  world.ensureNativeEngine = () => {
    originalAttempts++;
    throw new Error('normal wheel reset attempted original CPU');
  };
  return { world, originalAttempts: () => originalAttempts };
}

function observe(world, task, query) {
  const packets = [],
    received = [],
    replies = [],
    top = world.engineMessages.closestTop(task.id),
    inputRecord = world.objects.objects.get(top.implementation.input),
    send = world.sendNativeEngine,
    message = inputRecord.implementation.message,
    native = world.runtime.native;
  const settled = (result, entry) => {
    if (result && typeof result.then === 'function')
      result.then(
        (value) => {
          entry.value = value;
        },
        (error) => {
          entry.error = error;
        },
      );
    else entry.value = result;
    return result;
  };
  world.sendNativeEngine = function (...args) {
    const [target, sender, id, w, l, context] = args,
      entry = { target, sender, id, w, l, flags: context?.flags };
    const result = send.apply(this, args);
    if (sender === task.id && [query, 157].includes(id)) {
      packets.push(entry);
      return settled(result, entry);
    }
    return result;
  };
  inputRecord.implementation.message = function (...args) {
    const [words, context] = args;
    if (words[1] === 157)
      received.push({ owner: inputRecord.id, words: [...words], flags: context.flags });
    return message.apply(this, args);
  };
  world.runtime.native = function (...args) {
    const result = native.apply(this, args);
    if (args[0] === 'main' && args[1] === 0x3a9 && args[4].id === task.id) {
      const entry = { args: [...args[2]] };
      replies.push(entry);
      return settled(result, entry);
    }
    return result;
  };
  return { packets, received, replies, inputRecord, query };
}

for (const [name, profile, query] of [
  ['2.6.1.63', 'rebellions-jp-engine-2.6.1.63', 32],
  ['2.6.1.67', 'bokutomo-engine-2.6.1.67', 32],
  ['Game', 'nekopara-vol3-engine-2.6.1.76', 34],
  ['SDK', 'sdk-4.01-engine-2.6.1.74', 32],
]) {
  test(`${name} normal wheel-reset GCALL routes through its Top Input owner and survives a fresh World`, async () => {
    const first = fixture(profile),
      fresh = fixture(profile),
      world = first.world;
    try {
      await world.initialize('main.kcs');
      const top = await world.objects.create({
          kind: 1,
          nativeID: 0,
          name: 'Wheel Top',
        }),
        script = await world.spawnScript('wheel.kcs', { parent: top });
      await world.runtime.scheduler.execute(script);
      assert.equal(world.nativeTaskID(top), 0);
      assert.equal(world.engineMessages.closestTop(script.id).id, top);
      assert.notEqual(
        world.nativeTaskID(world.objects.objects.get(top).implementation.input),
        world.nativeTaskID(top),
      );
      assert.equal(script.status, 'waiting');
      assert.equal(script.machine.pc, 23);
      assert.equal(script.machine.load(script.machine.sp - 4), sentinel);
      assert.equal(
        world.objects.objects.get(top).implementation.input !==
          world.objects.objects.get(world.root).implementation.input,
        true,
      );
      assert.notEqual(world.inputFor(script.id), world.input);
      world.inputBindings.wheel(true);
      world.inputBindings.wheel(false);
      assert.deepEqual(world.inputBindings.pulses, [6, 7]);
      const checkpoint = structuredClone(world.snapshot());
      await fresh.world.restore(structuredClone(checkpoint));
      assert.deepEqual(fresh.world.snapshot(), checkpoint, 'cold restore needs no warm frame');
      assert.equal(fresh.world.runtime.calls.get('main:937') ?? 0, 0);
      assert.equal(fresh.world.inputBindings.input, fresh.world.input);
      assert.notEqual(fresh.world.inputBindings.pulses, world.inputBindings.pulses);
      const restored = fresh.world.runtime.scheduler.tasks.get(script.id),
        sourceTrace = observe(world, script, query),
        freshTrace = observe(fresh.world, restored, query),
        originalSP = script.machine.sp;
      assert.equal(
        (await fresh.world.runtime.scheduler.send(restored.id, [1, 2, 3, 4])).accepted,
        true,
      );
      assert.deepEqual(
        fresh.world.inputBindings.pulses,
        [],
        'GCALL cancels both pending wheel directions',
      );
      assert.deepEqual(
        world.snapshot(),
        checkpoint,
        'fresh wheel reset leaves the source owner unchanged',
      );
      assert.equal((await world.runtime.scheduler.send(script.id, [1, 2, 3, 4])).accepted, true);
      for (const [current, owner, trace] of [
        [world, script, sourceTrace],
        [fresh.world, restored, freshTrace],
      ]) {
        const inputID = current.nativeTaskID(trace.inputRecord.id);
        assert.equal(trace.inputRecord.kind, 11);
        assert.equal(trace.inputRecord.parent, top);
        assert.equal(current.inputFor(owner.id), trace.inputRecord.implementation.inputState);
        assert.deepEqual(
          trace.packets.map(({ target, sender, id, w, l, flags }) => [
            target,
            sender,
            id,
            w,
            l,
            flags,
          ]),
          [
            [0, owner.id, trace.query, 0, 0, 0],
            [inputID, owner.id, 157, 0, 0, 0],
          ],
        );
        assert.equal(
          trace.packets[0].value,
          inputID,
          'use the real query output, not transport status',
        );
        assert.equal(trace.received.length, 1);
        assert.deepEqual(trace.received[0], {
          owner: trace.inputRecord.id,
          words: [current.nativeTaskID(owner.id), 157, 0, 0],
          flags: 0,
        });
        assert.deepEqual(trace.replies, [{ args: [], value: { control: 2 } }]);
        assert.equal(owner.machine.sp, originalSP, 'a void reply does not push a VM result');
        assert.equal(owner.machine.load(owner.machine.sp - 4), sentinel);
        assert.equal(owner.machine.pc, 52);
        current.inputBindings.sample();
        assert.equal(current.inputBindings.query(0, 0), 0);
        assert.equal(current.inputBindings.query(1, 0), 0);
        assert.deepEqual(current.inputBindings.pulses, []);
        assert.equal(!!current.nativeEngine, false);
        assert.equal(!!current.nativeEngineLoading, false);
      }
      assert.deepEqual(restored.machine.snapshot(), script.machine.snapshot());
      assert.equal(first.originalAttempts(), 0);
      assert.equal(fresh.originalAttempts(), 0);
    } finally {
      await fresh.world.close();
      await world.close();
    }
  });
}
