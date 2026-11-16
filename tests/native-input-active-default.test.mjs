// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const sentinel = 0x13579bdf;
function fixture(profile) {
  const game = memoryGame({
      'main.kcs': kcsProgram([
        [37, 512],
        [43, 0x47, 4],
        [41, 0],
      ]),
      'active.kcs': kcsProgram([
        [37, sentinel],
        [43, 0x44, 0],
        [37, 0],
        [37, 0],
        [37, 0],
        [43, 0x90, 16],
        [43, 0x41, 0],
        [43, 0x44, 0],
        [43, 0x6b, 4],
        [43, 0x41, 0],
        [38, [0x13, 256]],
        [43, 0x44, 0],
        [43, 0x6b, 4],
        [43, 0x41, 0],
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
  let originalAttempts = 0;
  world.ensureNativeEngine = () => {
    originalAttempts++;
    throw new Error('normal active-word query attempted original CPU');
  };
  return { world, originalAttempts: () => originalAttempts };
}

function observe(world, task) {
  const query = nativeABI(world.profile).messages.movieInput.query,
    inputRecord = world.objects.objects.get(
      world.engineMessages.closestTop(task.id).implementation.input,
    ),
    packets = [],
    received = [],
    replies = [],
    send = world.sendNativeEngine,
    native = world.runtime.native,
    message = inputRecord.implementation.message;
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
      result = send.apply(this, args);
    if (sender === task.id && [query, 133].includes(id)) {
      const entry = { target, sender, id, w, l, flags: context?.flags };
      packets.push(entry);
      return settled(result, entry);
    }
    return result;
  };
  inputRecord.implementation.message = function (...args) {
    const [words, context] = args;
    if (words[1] === 133)
      received.push({ owner: inputRecord.id, words: [...words], flags: context.flags });
    return message.apply(this, args);
  };
  world.runtime.native = function (...args) {
    const result = native.apply(this, args);
    if (args[0] === 'main' && args[1] === 0x6b && args[4].id === task.id) {
      const entry = { args: [...args[2]] };
      replies.push(entry);
      return settled(result, entry);
    }
    return result;
  };
  return { query, inputRecord, packets, received, replies };
}

async function active(world, task, value) {
  const input = world.objects.objects.get(
    world.engineMessages.closestTop(task.id).implementation.input,
  );
  await world.sendNativeEngine(
    world.nativeTaskID(input.id),
    task.id,
    132,
    world.nativeTaskID(task.id),
    value,
    { flags: 0 },
  );
  assert.equal(world.inputFor(task.id).get(task.id).active, value);
}

function word(task, baseSP, value) {
  assert.equal(task.status, 'yielded');
  assert.equal(task.machine.sp, baseSP + 4, 'control1 pushes exactly one DWORD');
  assert.equal(task.machine.load(task.machine.sp - 4), value);
  assert.equal(task.machine.load(task.machine.sp - 8), sentinel);
}

for (const [name, profile] of [
  ['Game', 'nekopara-vol3-engine-2.6.1.76'],
  ['SDK', 'sdk-4.01-engine-2.6.1.74'],
]) {
  test(`${name} normal active-word GCALL returns zero and high bits from its owned Input region after a cold restore`, async () => {
    const first = fixture(profile),
      fresh = fixture(profile),
      world = first.world;
    try {
      await world.initialize('main.kcs');
      const top = await world.objects.create({ kind: 1, nativeID: 0, name: 'Active Top' }),
        script = await world.spawnScript('active.kcs', { parent: top });
      await world.runtime.scheduler.execute(script);
      assert.equal(script.status, 'yielded');
      assert.equal(world.nativeTaskID(top), 0);
      assert.equal(world.engineMessages.closestTop(script.id).id, top);
      assert.equal(world.nativeTaskID(script.id), world.nativeTaskID(world.main.id));
      assert.equal(
        world.runtime.calls.get('main:144'),
        1,
        'guest registered the actual input region',
      );
      assert.equal(world.inputFor(script.id).get(script.id).owner, script.id);
      assert.equal(world.inputFor(world.main.id).get(script.id), null);
      const baseSP = script.machine.sp;
      assert.equal(script.machine.load(baseSP - 4), sentinel);
      await active(world, script, 0);
      const checkpoint = structuredClone(world.snapshot());
      await fresh.world.restore(structuredClone(checkpoint));
      assert.deepEqual(fresh.world.snapshot(), checkpoint, 'cold restore needs no warm execution');
      assert.equal(fresh.world.runtime.calls.get('main:107') ?? 0, 0);
      assert.equal(
        fresh.world.runtime.calls.get('main:144') ?? 0,
        0,
        'restore does not replay registration',
      );
      const restored = fresh.world.runtime.scheduler.tasks.get(script.id),
        sourceTrace = observe(world, script),
        freshTrace = observe(fresh.world, restored);
      assert.notEqual(world.inputFor(script.id), fresh.world.inputFor(restored.id));
      await fresh.world.runtime.scheduler.execute(restored);
      word(restored, baseSP, 0);
      assert.deepEqual(world.snapshot(), checkpoint, 'fresh query does not mutate the source');
      await world.runtime.scheduler.execute(script);
      word(script, baseSP, 0);
      await active(world, script, 0x80000000);
      await active(fresh.world, restored, 0x80000000);
      const beforeHigh = structuredClone(world.snapshot());
      await fresh.world.runtime.scheduler.execute(restored);
      word(restored, baseSP, 0x80000000);
      assert.deepEqual(world.snapshot(), beforeHigh);
      await world.runtime.scheduler.execute(script);
      word(script, baseSP, 0x80000000);
      for (const [current, owner, trace] of [
        [world, script, sourceTrace],
        [fresh.world, restored, freshTrace],
      ]) {
        const inputID = current.nativeTaskID(trace.inputRecord.id),
          nativeOwner = current.nativeTaskID(owner.id);
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
            [inputID, owner.id, 133, nativeOwner, 0, 0],
            [0, owner.id, trace.query, 0, 0, 0],
            [inputID, owner.id, 133, nativeOwner, 0, 0],
          ],
        );
        assert.deepEqual(
          trace.packets.map((entry) => entry.value),
          [inputID, 0, inputID, 0x80000000],
        );
        assert.deepEqual(
          trace.received,
          Array.from({ length: 2 }, () => ({
            owner: trace.inputRecord.id,
            words: [nativeOwner, 133, nativeOwner, 0],
            flags: 0,
          })),
        );
        assert.deepEqual(trace.replies, [
          { args: [nativeOwner], value: { control: 1, value: 0 } },
          { args: [nativeOwner], value: { control: 1, value: 0x80000000 } },
        ]);
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
