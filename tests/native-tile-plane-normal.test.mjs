// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { floatBits } from '../src/kcs.mjs';
import { nativeEngineWord } from '../src/native/engine-message.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const sentinel = 0x13572468;
const tileCode = kcsProgram([
  [37, sentinel],
  [37, 0],
  [37, floatBits(111)],
  [37, floatBits(222)],
  [37, 3],
  [37, 2],
  [43, 0x1b1, 20],
  [37, 73],
  [38, [0x13, 512]],
  ...Array.from({ length: 5 }, (_, i) => [37, [0x13, 128 + i * 4]]),
  [43, 0x1b1, 20],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} normal tile GCALL retains unwritten words through real Draw children and cold owners`, async () => {
    const files = { 'case.kcs': kcsProgram([[59]]), 'tile.kcs': tileCode },
      scene = await dataWorld(profile, files);
    let fresh;
    try {
      scene.graphics.createLogicalDevice();
      const drawID = await scene.objects.create({
          kind: 15,
          parent: scene.main.id,
          nativeID: 0x1b100001,
          name: 'tile Draw',
        }),
        draw = scene.graphics.drawTasks.get(drawID),
        nativeDraw = scene.nativeTaskID(drawID);
      assert.deepEqual(
        await scene.runtime.native(
          'main',
          0x100,
          [nativeDraw, 24, 16],
          scene.main.machine,
          scene.main,
        ),
        { control: 2 },
      );
      const parentID = draw.state.basePlane,
        parent = scene.graphics.get(parentID),
        target = nativeEngineWord(scene.nativeTaskID(parentID), 'tile target');
      assert.equal(scene.objects.objects.get(parentID).kind, 2);
      assert.equal(scene.objects.objects.get(parentID).parent, drawID);
      assert.notEqual(parentID, target);
      assert.notEqual(target, 0);
      assert.equal(
        parent.graph.type,
        1,
        'The actual Draw initializer produced its hidden base plane',
      );
      const traces = [],
        replies = [],
        send = scene.sendNativeEngine,
        native = scene.runtime.native;
      scene.sendNativeEngine = function (destination, sender, id, w, l, context) {
        let trace;
        if (id === 46) {
          trace = {
            destination,
            sender,
            id,
            w,
            l,
            flags: context.flags,
            packet: context.payload,
            words: Array.from({ length: 10 }, (_, i) => context.payload.load(i * 4)),
          };
          traces.push(trace);
        }
        const reply = send.call(this, destination, sender, id, w, l, context);
        if (trace) trace.reply = reply;
        return reply;
      };
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 0x1b1) replies.push(reply);
        return reply;
      };
      const callerID = await scene.objects.create({
          kind: 12,
          parent: scene.main.id,
          nativeID: 0x1b10f001,
          name: 'tile caller',
        }),
        record = scene.objects.objects.get(callerID);
      await record.implementation.loadScript('tile.kcs');
      const task = record.implementation.task,
        machine = task.machine,
        sp = machine.sp,
        width = 7.5,
        height = 4.25,
        columns = 3,
        rows = 2;
      [target, floatBits(width), floatBits(height), columns, rows].forEach((word, i) =>
        machine.store(128 + i * 4, word),
      );
      machine.bytes(800, 8).fill(0xa5);
      assert.notEqual(callerID, scene.nativeTaskID(callerID));
      await scene.runtime.scheduler.execute(task);
      const children = scene.objects.children(parent.record);
      assert.equal(children.length, 6, 'Real canonical46 created the native row-major count');
      assert.equal(parent.graph.type, 5);
      assert.equal(parent.state.drawType, 9);
      const packetWords = [
          0,
          0,
          0,
          floatBits(width),
          floatBits(height),
          undefined,
          undefined,
          undefined,
          columns,
          rows,
        ],
        childWords = packetWords.slice(0, 8),
        parentBase = motionVector(parent.graph.kx2, MOTION_ABI.base);
      assert.deepEqual(parent.state.shapeWords, packetWords);
      for (const [i, child] of children.entries()) {
        const plane = scene.graphics.get(child.id),
          offset = [(i % columns) * width, Math.floor(i / columns) * height, 0];
        assert.equal(child.kind, 2);
        assert.equal(child.parent, parentID);
        assert.equal(plane.graph.type, 1);
        assert.deepEqual([plane.graph.width, plane.graph.height], [width, height]);
        assert.deepEqual(plane.state.shapeWords, childWords);
        for (const word of [5, 6, 7]) {
          assert.equal(Object.hasOwn(plane.state.shapeWords, word), true);
          assert.equal(plane.state.shapeWords[word], undefined);
        }
        assert.equal(plane.state.inheritPosition, true);
        assert.deepEqual(plane.state.parentOffset, offset);
        assert.deepEqual(
          motionVector(plane.graph.kx2, MOTION_ABI.base),
          offset.map((v, j) => Math.fround(parentBase[j] + (j === 2 ? v : -v))),
        );
      }
      assert.equal(machine.load(512), 73);
      assert.equal(machine.load(516), 89);
      assert.equal(machine.halted, true);
      assert.equal(machine.pop(), sentinel);
      assert.equal(machine.sp, sp);
      assert.deepEqual([...machine.bytes(800, 8)], Array(8).fill(0xa5));
      assert.equal(traces.length, 1, 'The zero target never reached transport');
      assert.deepEqual(
        [
          traces[0].destination,
          traces[0].sender,
          traces[0].id,
          traces[0].w,
          traces[0].l,
          traces[0].flags,
        ],
        [target, callerID, 46, 0, 0, 0],
      );
      assert.deepEqual(traces[0].words, packetWords);
      assert.equal(typeof traces[0].reply.then, 'function');
      assert.deepEqual(await Promise.all(replies), [{ control: 2 }, { control: 2 }]);
      const packet = traces[0].packet;
      assert.throws(() => packet.data, /unwritten/);
      assert.throws(() => packet.view, /unwritten/);
      assert.throws(() => packet.bytes(20, 12), /unwritten/);
      const known = packet.bytes(0, 20);
      assert.equal(known.buffer.byteLength, 20);
      known.fill(0);
      assert.equal(packet.load(12), floatBits(width));
      assert.throws(() => new NativeGraphicsPacket(childWords), /unwritten/);
      const beforeBad = structuredClone(scene.snapshot());
      for (const index of [0, 3, 8, 9]) {
        const words = packetWords.slice();
        words[index] = undefined;
        await assert.rejects(
          scene.sendNativeEngine(target, callerID, 46, 0, 0, {
            flags: 0,
            payload: new NativeGraphicsPacket(words, { unwritten: [5, 6, 7, index] }),
          }),
          /unwritten|initialized/,
        );
        assert.deepEqual(
          scene.snapshot(),
          beforeBad,
          'An unknown consumed field must not become numeric zero or mutate the tile tree',
        );
      }
      const dto = scene.snapshot(),
        decoded = await deserializeCheckpoint(await serializeCheckpoint(dto));
      fresh = await dataWorld(profile, files, { initialize: false });
      fresh.graphics.createLogicalDevice();
      fresh.runtime.native = () => {
        throw new Error('Tile restore replayed a native command');
      };
      for (const stream of [fresh.random.integer, fresh.random.real])
        stream.nextUint32 = () => {
          throw new Error('Tile restore replayed RNG');
        };
      await fresh.restore(decoded);
      assert.deepEqual(fresh.snapshot(), dto, 'The full DTO agrees before any warm tick');
      const restored = fresh.graphics.get(parentID);
      assert.deepEqual(restored.state.shapeWords, packetWords);
      assert.notStrictEqual(restored.state.shapeWords, parent.state.shapeWords);
      for (const child of children)
        assert.deepEqual(fresh.graphics.get(child.id).state.shapeWords, childWords);
      await scene.objects.release(drawID);
      for (const id of [parentID, ...children.map((child) => child.id)]) {
        assert.equal(scene.objects.objects.has(id), false);
        assert.equal(fresh.objects.objects.has(id), true);
      }
      assert.deepEqual(fresh.graphics.get(children[0].id).state.shapeWords, childWords);
      assert.equal(scene.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await scene.close();
    }
  });
