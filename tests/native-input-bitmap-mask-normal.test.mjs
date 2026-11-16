// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const sentinel = 0x1234abcd;
const program = (id, words) =>
  kcsProgram([
    [37, sentinel],
    ...Array.from({ length: words }, (_, i) => [37, [0x13, 128 + i * 4]]),
    [43, id, words * 4],
    [37, 73],
    [38, [0x13, 512]],
    [59],
  ]);
const files = {
  'case.kcs': kcsProgram([[59]]),
  'bind.kcs': program(104, 7),
  'mask.kcs': program(0x18a, 2),
};
const expectedBytes = [0, 0, 40, 12, 16, 1, 0, 0];

async function caller(world, file, args) {
  const id = await world.objects.create({ kind: 12, parent: world.main.id, name: 'mask caller' }),
    record = world.objects.objects.get(id);
  await record.implementation.loadScript(file);
  const task = record.implementation.task,
    machine = task.machine,
    initialSP = machine.sp;
  assert.strictEqual(world.runtime.scheduler.tasks.get(id), task);
  assert.equal(world.resolveTaskID(0, id), world.root, 'Use the actual Top0 namespace');
  args.forEach((word, i) => machine.store(128 + i * 4, word));
  machine.bytes(800, 16).fill(0xa5);
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.load(512), 73, 'The real guest continues after control2');
  assert.equal(machine.halted, true);
  assert.equal(machine.pop(), sentinel, 'The void native does not push a result');
  assert.equal(machine.sp, initialSP);
  assert.deepEqual(
    args.map((_, i) => machine.load(128 + i * 4)),
    args.map((x) => x >>> 0),
  );
  assert.deepEqual([...machine.bytes(800, 16)], Array(16).fill(0xa5));
  return { task, record, machine };
}

function observe(world, planeID) {
  const packets = [],
    calls = [],
    deliveries = [],
    native = world.runtime.native,
    send = world.sendNativeEngine;
  world.runtime.native = function (table, id, ...args) {
    const reply = native.call(this, table, id, ...args);
    if (table === 'main' && id === 0x18a) calls.push({ args: [...args[0]], reply });
    return reply;
  };
  world.sendNativeEngine = function (target, sender, message, w, l, context) {
    const reply = send.call(this, target, sender, message, w, l, context);
    if (message === 97)
      packets.push({
        target,
        sender,
        w,
        l,
        flags: context.flags,
        nativePointer: context.nativePointer,
        reply,
      });
    return reply;
  };
  for (const id of [world.root, planeID]) {
    const record = world.objects.objects.get(id),
      message = record.implementation.message;
    record.implementation.message = function (words, context, ...args) {
      if (words[1] === 97)
        deliveries.push({
          owner: id,
          sender: words[0],
          senderWorld: context.nativeSenderWorldID,
          w: words[2],
          l: words[3],
          flags: context.flags,
        });
      return message.call(this, words, context, ...args);
    };
  }
  return { packets, calls, deliveries };
}

for (const profile of profiles)
  test(`${profile} normal main18A copies a typed bitmap alias mask through real GCALL`, async () => {
    const world = await dataWorld(profile, files);
    let fresh, input, freshInput, planeID;
    try {
      assert.equal(world.objects.objects.get(world.root).nativeID, 0);
      planeID = await world.objects.create({
        kind: 6,
        parent: world.root,
        nativeID: 0x018a0001,
        name: 'typed mask Base',
      });
      const target = world.nativeTaskID(planeID);
      assert.notEqual(target, planeID);
      const binding = await caller(world, 'bind.kcs', [target, 0, 0, 13, 4, 7, 0]);
      input = world.inputFor(planeID);
      const region = input.get(planeID);
      assert.ok(region, 'The real main104 registered the Base region');
      assert.deepEqual(region.bounds, [0, 0, 13, 4]);
      assert.equal(region.receiver, binding.record.nativeID);
      assert.equal(region.alpha, null);
      const images = world.graphics.images,
        sourceHandle = images.create(9, 2, world.main.id),
        source = images.get(sourceHandle),
        pixels = await source.pixels();
      Object.assign(source.state, { canvasWidth: 13, canvasHeight: 4, offsetX: 3, offsetY: 1 });
      assert.equal(source.state.bpp, 4);
      for (const [x, y, alpha] of [
        [0, 0, 1],
        [2, 0, 127],
        [7, 0, 255],
        [8, 0, 19],
        [1, 1, 2],
        [5, 1, 255],
      ])
        pixels[(y * 9 + x) * 4 + 3] = alpha;
      await source.changed();
      const aliasHandle = images.alias(sourceHandle, world.main.id),
        alias = images.get(aliasHandle),
        dataHandle = source.dataHandle,
        observed = observe(world, planeID),
        frame = world.frame;
      assert.notEqual(aliasHandle, sourceHandle);
      assert.equal(alias.dataHandle, dataHandle);
      assert.strictEqual(alias.state, source.state);
      const masked = await caller(world, 'mask.kcs', [target, aliasHandle]);
      // Independent canvas bit positions: y1 x3/5/10/11, y2 x4/8.
      assert.deepEqual([...region.alpha.bytes], expectedBytes);
      assert.deepEqual([region.alpha.width, region.alpha.height], [13, 4]);
      assert.notStrictEqual(region.alpha.bytes.buffer, pixels.buffer);
      assert.deepEqual(
        observed.packets.map(({ target, sender, w, l, flags, nativePointer }) => [
          target,
          sender,
          w,
          l,
          flags,
          Boolean(nativePointer),
        ]),
        [[target, masked.task.id, 0, aliasHandle, 0, false]],
      );
      assert.deepEqual(observed.deliveries, [
        {
          owner: planeID,
          sender: masked.record.nativeID,
          senderWorld: masked.task.id,
          w: 0,
          l: aliasHandle,
          flags: 0,
        },
      ]);
      const zero = await caller(world, 'mask.kcs', [0, aliasHandle]);
      assert.deepEqual(
        observed.packets.map(({ target, w, l, flags }) => [target, w, l, flags]),
        [
          [target, 0, aliasHandle, 0],
          [0, 0, aliasHandle, 0],
        ],
      );
      assert.equal(
        observed.deliveries.at(-1).owner,
        world.root,
        'Task0 is dispatched, not skipped',
      );
      assert.equal(observed.deliveries.at(-1).senderWorld, zero.task.id);
      assert.deepEqual(
        observed.calls.map(({ args }) => args),
        [
          [target, aliasHandle],
          [0, aliasHandle],
        ],
      );
      assert.deepEqual(await Promise.all(observed.calls.map(({ reply }) => reply)), [
        { control: 2 },
        { control: 2 },
      ]);
      pixels.fill(0);
      await source.changed();
      assert.deepEqual(
        [...region.alpha.bytes],
        expectedBytes,
        'The Input owns an independent mask copy',
      );
      await images.release(sourceHandle);
      assert.equal(images.get(aliasHandle).dataHandle, dataHandle);
      await images.release(aliasHandle);
      assert.equal(
        world.runtime.handles.records.has(dataHandle),
        false,
        'The final alias release frees its backing',
      );
      assert.deepEqual([...region.alpha.bytes], expectedBytes);
      const checkpoint = structuredClone(world.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      let replay = 0,
        restoring = true;
      const execute = fresh.runtime.scheduler.execute;
      fresh.runtime.scheduler.execute = function (...args) {
        if (restoring) replay++;
        return execute.apply(this, args);
      };
      await fresh.restore(checkpoint);
      restoring = false;
      assert.equal(replay, 0, 'Restore executes no source or pending GCALL');
      freshInput = fresh.inputFor(planeID);
      const restored = freshInput.get(planeID);
      assert.deepEqual(restored, region);
      assert.notStrictEqual(restored.alpha.bytes, region.alpha.bytes);
      assert.equal(fresh.runtime.handles.records.has(dataHandle), false);
      const restoredCalls = observe(fresh, planeID),
        cleared = await caller(fresh, 'mask.kcs', [target, 0]);
      assert.equal(restored.alpha, null, 'Bitmap0 clears through the real GCALL');
      assert.deepEqual(
        restoredCalls.packets.map(({ target, sender, w, l, flags }) => [
          target,
          sender,
          w,
          l,
          flags,
        ]),
        [[target, cleared.task.id, 0, 0, 0]],
      );
      assert.deepEqual(await Promise.all(restoredCalls.calls.map(({ reply }) => reply)), [
        { control: 2 },
      ]);
      assert.deepEqual(
        [...region.alpha.bytes],
        expectedBytes,
        'Fresh clear does not mutate the prior World',
      );
      assert.equal(world.frame, frame);
      assert.equal(fresh.frame, frame);
      assert.ok(!world.nativeEngine && !world.nativeEngineLoading);
      assert.ok(!fresh.nativeEngine && !fresh.nativeEngineLoading);
    } finally {
      await fresh?.close();
      await world.close();
      if (input && planeID) assert.equal(input.get(planeID), null);
      if (freshInput && planeID) assert.equal(freshInput.get(planeID), null);
    }
  });
