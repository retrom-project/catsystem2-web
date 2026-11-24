// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { KCSMachine, encodeCP932, readKCS } from '../src/kcs.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
const configurationAddress = 208;
const formatAddress = 512;
const canary = 0xbe923aca;
const glyphs = {
  measure: (_font, text) => ({
    width: text.length * 5,
    height: 10,
    ascent: 7,
    descent: 3,
    averageWidth: 5,
    maximumWidth: 8,
  }),
  glyph: () => ({
    width: 4,
    height: 6,
    originX: 0,
    originY: 6,
    advanceX: 5,
    advanceY: 0,
    alpha: new Uint8Array(24).fill(255),
  }),
};

async function mainCall(world, id, args, prepare = () => {}) {
  const program = kcsProgram([
    [37, canary],
    ...args.map((word) => [37, word]),
    [43, id, args.length * 4],
    [59],
  ]);
  const task = { ...world.main, io: null },
    machine = (task.machine = new KCSMachine(await readKCS(program), {
      native: (number, supplied, caller) =>
        world.runtime.scheduler.native(task, number, supplied, caller),
    }));
  prepare(machine);
  const floor = machine.sp;
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.pop(), canary);
  return machine;
}

async function stringTask(world) {
  const worldID = await world.objects.create({ kind: 48, parent: world.root });
  return { owner: world.graphics.get(worldID), nativeID: world.nativeTaskID(worldID) };
}

test('2.6.1.23 STRING GCALLs use the exact 188-byte configuration and finish all pages', async () => {
  const world = await dataWorld(profile, {}, { glyphs });
  try {
    world.graphics.createLogicalDevice();
    const { owner, nativeID } = await stringTask(world);
    const fontSettings = world.configuration.fields.font;
    Object.assign(fontSettings, {
      name: 'ＭＳ ゴシック',
      weight: 0,
      rightdown: 1,
      around: 0,
      prop: 1,
      fix: 0,
    });
    const prepare = (machine, size = 188) => {
      machine.bytes(configurationAddress - 4, 196).fill(0xab);
      machine.store(configurationAddress, size);
    };
    const defaultMachine = await mainCall(world, 611, [nativeID, configurationAddress], prepare),
      record = defaultMachine.bytes(configurationAddress, 188).slice(),
      observed = createHash('sha256').update(record).digest('hex');
    // The digest covers the original raw 407 output with these font settings.
    assert.equal(observed, 'eac005e278617460af5085ab3a049b33fbb179680b42db25ed4a08b001dde58e');
    assert.equal(defaultMachine.load(configurationAddress - 4), 0xabababab);
    assert.equal(defaultMachine.load(configurationAddress + 188), 0xabababab);
    const rejectedSize = await mainCall(world, 611, [nativeID, configurationAddress], (machine) =>
      prepare(machine, 187),
    );
    assert.equal(rejectedSize.load(configurationAddress), 187);
    assert.equal(rejectedSize.load(configurationAddress + 4), 0xabababab);
    await mainCall(world, 613, [nativeID, 0xffffffff]);
    assert.equal(await owner.writer(), null);
    await mainCall(world, 612, [nativeID, configurationAddress], (machine) =>
      prepare(machine, 187),
    );
    assert.ok(await owner.writer());
    assert.equal(owner.graph, null);
    const configure = (machine) => {
      machine.bytes(configurationAddress, 188).set(record);
      machine.store(configurationAddress + 4, 96);
      machine.store(configurationAddress + 8, 48);
      machine.store(configurationAddress + 176, 3);
      machine.store(configurationAddress + 180, 8);
    };
    await mainCall(world, 612, [nativeID, configurationAddress], configure);
    const writer = await owner.writer();
    assert.deepEqual(owner.text.vram, [3, 8]);
    assert.deepEqual([writer.pixels.width, writer.pixels.height], [96, 48]);
    const append = (value, number) =>
      mainCall(world, 614, [nativeID, formatAddress], (machine) => {
        machine.writeString(value, formatAddress);
        machine.store(800, number);
      });
    await append('文字 %03d[G800]', 7);
    assert.deepEqual([...(await owner.writer()).parser.source], [...encodeCP932('文字 007')]);
    await mainCall(world, 618, [nativeID]);
    await append('B', 0);
    await mainCall(world, 613, [nativeID, configurationAddress], (machine) => {
      configure(machine);
      machine.store(configurationAddress + 176, 19);
    });
    assert.equal(await owner.writer(), writer);
    assert.deepEqual(owner.text.vram, [19, 8]);
    await mainCall(world, 619, [nativeID, 0]);
    assert.equal(owner.text.pageLimit, 0);
    await mainCall(world, 617, [nativeID]);
    assert.equal(writer.parser.rows.findLast((row) => row[1] === 66)[15], 1);
    assert.ok(writer.frame().rgba.some((component) => component !== 0));
    writer.maximumTime = 13;
    writer.lastFrame = 87;
    await mainCall(world, 695, [nativeID, 21]);
    assert.deepEqual([writer.speedValue, writer.baseTime, writer.baseFrame], [21, 13, 87]);
    writer.maximumTime = 29;
    await mainCall(world, 695, [nativeID, 21]);
    assert.equal(writer.baseTime, 13);
    await mainCall(world, 615, [nativeID]);
    assert.equal(writer.parser.source.length, 0);
    assert.deepEqual([owner.text.elapsed, owner.text.active, owner.text.pageLimit], [0, false, 0]);
    assert.ok(writer.frame().rgba.every((component) => component === 0));
    await assert.rejects(mainCall(world, 611, [nativeID]), /expects 2 arguments/);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('2.6.1.23 STRING font and cursor packets preserve the routed output and resource owner', async () => {
  const world = await dataWorld(profile, {}, { glyphs });
  try {
    world.graphics.createLogicalDevice();
    const { owner, nativeID } = await stringTask(world),
      buffers = world.runtime.imageDataBuffers,
      bytes = await encodeHG2(
        { width: 2, height: 2, rgba: new Uint8ClampedArray(16).fill(255) },
        { id: 1 },
      ),
      pointer = buffers.createPointer(bytes),
      handle = buffers.handle(pointer),
      raw = (message, w = 0, l = 0, context) =>
        world.engineMessages.dispatchNative(world.main.id, nativeID, message, w, l, context),
      unwritten = { routed: true, handled: true, result: NATIVE_UNWRITTEN_WORD };
    await mainCall(world, 620, [nativeID, handle]);
    await mainCall(world, 620, [0x22334455, handle]);
    await mainCall(world, 620, [nativeID, 0x22334455]);
    assert.equal(buffers.owns(pointer), true);
    assert.deepEqual(await raw(418, 0xffffffff, 0xffffffff), unwritten);
    assert.deepEqual(await raw(407), unwritten);
    const machine = world.main.machine;
    machine.store(configurationAddress, 188);
    assert.deepEqual(await raw(407, 0, configurationAddress), unwritten);
    assert.equal(machine.load(configurationAddress + 4), 800);
    machine.store(configurationAddress + 4, 40);
    machine.store(configurationAddress + 8, 40);
    assert.deepEqual(await raw(408, 0, configurationAddress), unwritten);
    const writer = await owner.writer();
    const count = { routed: true, handled: true, result: 0 };
    assert.deepEqual(await raw(412), count);
    machine.writeString('A', formatAddress);
    assert.deepEqual(await raw(410, 0, formatAddress), unwritten);
    assert.deepEqual(await raw(412), { ...count, result: 0xffffffff });
    await mainCall(world, 621, [nativeID, 0x45670041, 1]);
    assert.equal(writer.fontImages.size, 0);
    await mainCall(world, 620, [nativeID, handle]);
    assert.equal(buffers.owns(pointer), false);
    assert.deepEqual(writer.imageFont, bytes);
    assert.equal(writer.decodedFonts[0].width, 2);
    await assert.rejects(mainCall(world, 620, [nativeID, handle]), /released native data-buffer/);
    await mainCall(world, 621, [nativeID, 0x45670041, 1]);
    assert.deepEqual([...writer.fontImages], [[65, 1]]);
    machine.bytes(formatAddress - 4, 16).fill(0x7a);
    writer.parser.cachedEnd = [-78, 199];
    assert.deepEqual(await raw(418, formatAddress, formatAddress + 4), unwritten);
    assert.deepEqual(
      [
        machine.load(formatAddress - 4),
        machine.load(formatAddress),
        machine.load(formatAddress + 4),
        machine.load(formatAddress + 8),
      ],
      [0x7a7a7a7a, -78 >>> 0, 199, 0x7a7a7a7a],
    );
    assert.deepEqual(await raw(449), {
      routed: true,
      handled: false,
      result: NATIVE_UNWRITTEN_WORD,
    });
  } finally {
    await world.close({ flushFiles: false });
  }
});
