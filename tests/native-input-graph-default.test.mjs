// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { floatBits } from '../src/kcs.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';

const sentinel = 0x13579bdf,
  literal = 0xf2345678,
  zeroFlags = 0xf1234567,
  duplicateFlags = 0x24681357,
  files = {
    'case.kcs': kcsProgram([[59]]),
    'graph-input.kcs': kcsProgram([
      [37, sentinel],
      [43, 0x44, 0],
      [38, [0x13, 520]],
      [37, [0x13, 128]],
      [37, [0x13, 132]],
      [43, 0x5f, 8],
      [37, 73],
      [38, [0x13, 512]],
      [37, 0],
      [37, zeroFlags],
      [43, 0x5f, 8],
      [37, 89],
      [38, [0x13, 516]],
      [43, 0x41, 0],
      [59],
    ]),
  };

async function caller(world, top, target, flags) {
  const task = await world.spawnScript('graph-input.kcs', { parent: top }),
    record = world.objects.objects.get(task.id),
    initialSP = task.machine.sp;
  task.machine.store(128, target);
  task.machine.store(132, flags);
  task.machine.bytes(800, 16).fill(0xa5);
  return { task, record, initialSP, target, flags };
}
function continuation(owner) {
  const { task, record, initialSP, target, flags } = owner,
    m = task.machine;
  assert.equal(task.status, 'yielded');
  assert.equal(m.load(512), 73, 'The real nonzero GCALL continued');
  assert.equal(m.load(516), 89, 'The real zero-target GCALL continued');
  assert.equal(m.sp, initialSP + 4, 'Control2 leaves only the guest sentinel');
  assert.equal(m.load(m.sp - 4), sentinel);
  assert.equal(m.load(520), record.nativeID, 'The guest produced its actual native identity');
  assert.notEqual(record.nativeID, task.id);
  assert.deepEqual([m.load(128), m.load(132)], [target, flags]);
  assert.deepEqual([...m.bytes(800, 16)], Array(16).fill(0xa5));
}
async function loadPlane(world, owner, target) {
  await world.sendNativeEngine(target, owner.task.id, 42, 0, 0, {
    payload: new NativeGraphicsPacket([
      0,
      0,
      0,
      floatBits(20.5),
      floatBits(12.25),
      0,
      0,
      0xff445566,
    ]),
  });
  await world.sendNativeEngine(target, owner.task.id, 49, 0, 0, {
    payload: new NativeGraphicsPacket([10.75, -3.25, 123.75].map(floatBits)),
  });
  await world.sendNativeEngine(target, owner.task.id, 51, 0, 0, {
    payload: new NativeGraphicsPacket([17.5, 8.125, 0].map(floatBits)),
  });
}
function observe(world, planeID) {
  const packets = [],
    calls = [],
    deliveries = [],
    send = world.sendNativeEngine,
    native = world.runtime.native,
    record = world.objects.objects.get(planeID),
    message = record.implementation.message;
  const settled = (reply, entry) => {
    if (reply && typeof reply.then === 'function')
      reply.then(
        (value) => {
          entry.value = value;
        },
        (error) => {
          entry.error = error;
        },
      );
    else entry.value = reply;
    return reply;
  };
  world.sendNativeEngine = function (...args) {
    const [target, sender, id, w, l, context] = args,
      reply = send.apply(this, args);
    if (id === 89) {
      const entry = {
        target,
        sender,
        w,
        l,
        flags: context.flags,
        nativePointer: !!context.nativePointer,
        payload: Object.hasOwn(context, 'payload'),
      };
      packets.push(entry);
      return settled(reply, entry);
    }
    return reply;
  };
  record.implementation.message = function (words, context, ...rest) {
    if (words[1] === 89)
      deliveries.push({
        owner: record.id,
        words: [...words],
        senderWorld: context.nativeSenderWorldID,
        flags: context.flags,
      });
    return message.call(this, words, context, ...rest);
  };
  world.runtime.native = function (...args) {
    const reply = native.apply(this, args);
    if (args[0] === 'main' && args[1] === 0x5f) {
      const entry = { args: [...args[2]], sender: args[4].id };
      calls.push(entry);
      return settled(reply, entry);
    }
    return reply;
  };
  return { packets, calls, deliveries };
}
for (const [name, profile] of [
  ['Game', 'nekopara-vol3-engine-2.6.1.76'],
  ['SDK', 'sdk-4.01-engine-2.6.1.74'],
])
  test(`${name} normal graph-input GCALL retains literal flags and moves its restored owned SimplePlane`, async () => {
    const world = await dataWorld(profile, files);
    let fresh, input, freshInput, planeID;
    try {
      const top = await world.objects.create({ kind: 1, nativeID: 0, name: 'Graph Top' });
      planeID = await world.objects.create({
        kind: 2,
        parent: top,
        nativeID: 0x005f0001,
        name: 'owned graph input',
      });
      const target = world.nativeTaskID(planeID),
        first = await caller(world, top, target, literal),
        plane = world.objects.objects.get(planeID).implementation;
      assert.equal(world.engineMessages.closestTop(first.task.id).id, top);
      assert.equal(world.nativeTaskID(top), 0);
      await loadPlane(world, first, target);
      const graph = plane.graph,
        order = world.graphics.renderSequence,
        frame = world.frame,
        trace = observe(world, planeID);
      input = world.inputFor(planeID);
      assert.notEqual(input, world.input);
      await world.runtime.scheduler.execute(first.task);
      continuation(first);
      const region = input.get(planeID);
      assert.ok(region, 'Actual GCALL5F registered the real Graph region');
      // Independent own-SSE values, not the incoming literal used as a pointer.
      assert.deepEqual(region.bounds, [6, 11, 27, 23]);
      assert.equal(region.priority, 123);
      assert.equal(region.mask, 7);
      assert.equal(region.extra, 0);
      assert.equal(plane.state.bindFlags, literal);
      assert.equal(region.flags, literal, 'Retained opaque metadata is not transport flags');
      assert.equal(plane.state.receiver, first.record.nativeID);
      assert.equal(region.receiver, first.record.nativeID);
      assert.equal(plane.state.inputTracksGraph, true);
      const saved = structuredClone(region),
        duplicate = await caller(world, top, target, duplicateFlags);
      await world.runtime.scheduler.execute(duplicate.task);
      continuation(duplicate);
      assert.strictEqual(input.get(planeID), region);
      assert.deepEqual(region, saved, 'Duplicate input registration does not reorder or replace');
      assert.equal(input.regions.filter((r) => r.owner === planeID).length, 1);
      assert.equal(plane.state.receiver, first.record.nativeID);
      assert.equal(plane.state.bindFlags, literal);
      assert.deepEqual(
        trace.packets.map(({ target, sender, w, l, flags, nativePointer, payload }) => [
          target,
          sender,
          w,
          l,
          flags,
          nativePointer,
          payload,
        ]),
        [
          [target, first.task.id, first.task.machine.load(520), literal, 0, false, false],
          [
            target,
            duplicate.task.id,
            duplicate.task.machine.load(520),
            duplicateFlags,
            0,
            false,
            false,
          ],
        ],
        'Target0 skips sending; each real packet keeps w=self nativeID and literal l',
      );
      assert.deepEqual(
        trace.deliveries,
        [first, duplicate].map((owner) => ({
          owner: planeID,
          words: [owner.task.machine.load(520), 89, owner.task.machine.load(520), owner.flags],
          senderWorld: owner.task.id,
          flags: 0,
        })),
      );
      assert.deepEqual(
        trace.calls.map(({ args, sender, value }) => ({ args, sender, value })),
        [first, duplicate].flatMap((owner) => [
          { args: [target, owner.flags], sender: owner.task.id, value: { control: 2 } },
          { args: [0, zeroFlags], sender: owner.task.id, value: { control: 2 } },
        ]),
      );
      assert.strictEqual(plane.graph, graph);
      assert.equal(world.graphics.renderSequence, order);
      const checkpoint = structuredClone(world.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      let restoring = true,
        replay = 0;
      const execute = fresh.runtime.scheduler.execute;
      fresh.runtime.scheduler.execute = function (...args) {
        if (restoring) replay++;
        return execute.apply(this, args);
      };
      await fresh.restore(structuredClone(checkpoint));
      restoring = false;
      assert.equal(replay, 0);
      assert.deepEqual(fresh.snapshot(), checkpoint, 'A cold checkpoint needs no warm execution');
      assert.equal(
        fresh.runtime.calls.get('main:95') ?? 0,
        0,
        'Restore replays no Graph registration',
      );
      freshInput = fresh.inputFor(planeID);
      const restored = freshInput.get(planeID),
        restoredPlane = fresh.objects.objects.get(planeID).implementation;
      assert.deepEqual(restored, saved);
      assert.notStrictEqual(restored, region);
      await fresh.sendNativeEngine(target, first.task.id, 51, 0, 0, {
        payload: new NativeGraphicsPacket([30.75, 20.125, -99].map(floatBits)),
      });
      assert.deepEqual(restored.bounds, [20, 23, 40, 35]);
      assert.deepEqual(restoredPlane.state.bindArea, [20, 23, 40, 35]);
      assert.equal(restored.priority, 123, 'Movement does not re-register a new priority');
      assert.equal(restored.sequence, saved.sequence);
      assert.equal(restored.flags, literal);
      assert.equal(restored.receiver, first.record.nativeID);
      assert.deepEqual(
        world.snapshot(),
        checkpoint,
        'Fresh movement leaves source ownership intact',
      );
      assert.equal(world.frame, frame);
      assert.equal(fresh.frame, frame);
      const baseID = await world.objects.create({
          kind: 6,
          parent: top,
          name: 'unreviewed literal-to-packet Base',
        }),
        baseCall = await caller(world, top, world.nativeTaskID(baseID), literal);
      await assert.rejects(
        () => world.runtime.scheduler.execute(baseCall.task),
        /requires a reviewed Graph receiver/,
      );
      assert.equal(input.get(baseID), null);
      const emptyID = await world.objects.create({
          kind: 2,
          parent: top,
          name: 'unloaded graph input',
        }),
        emptyCall = await caller(world, top, world.nativeTaskID(emptyID), literal);
      await assert.rejects(
        () => world.runtime.scheduler.execute(emptyCall.task),
        /Native plane input geometry is unreviewed/,
      );
      assert.equal(input.get(emptyID), null);
      assert.equal(world.objects.objects.get(emptyID).implementation.state.receiver, -1);
      assert.ok(!world.nativeEngine && !world.nativeEngineLoading);
      assert.ok(!fresh.nativeEngine && !fresh.nativeEngineLoading);
    } finally {
      await fresh?.close();
      await world.close();
      if (input && planeID !== undefined) assert.equal(input.get(planeID), null);
      if (freshInput && planeID !== undefined) assert.equal(freshInput.get(planeID), null);
    }
  });
