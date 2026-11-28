// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floatBits } from '../src/kcs.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
const widths = new Map([
  [256, 3],
  [259, 13],
  [260, 3],
  [262, 2],
  [264, 1],
  [462, 2],
  [463, 3],
  [862, 5],
]);
const canary = 0xb5178731;

async function authorDraw(t) {
  const world = await dataWorld(profile, {
    'draw.kcs': kcsProgram([...Array.from(widths, ([id, words]) => [43, id, words * 4]), [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  world.graphics.createLogicalDevice();
  const task = await world.spawnScript('draw.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  const { machine } = task;
  const addresses = new Map();
  let next = 0;
  for (const id of widths.keys()) {
    addresses.set(id, next);
    next += machine.instruction(next).size;
  }
  const call = async (id, args, error) => {
    assert.equal(args.length, widths.get(id));
    const address = addresses.get(id);
    machine.pc = address;
    const before = machine.sp;
    machine.push(canary);
    args.forEach((word) => machine.push(word));
    machine.step();
    assert.equal(machine.waiting.kind, 'io');
    await task.io.promise;
    machine.resume();
    if (error) assert.throws(() => machine.step(), error);
    else assert.equal(machine.step(), undefined);
    assert.equal(machine.pc, address + (error ? 0 : machine.instruction(address).size));
    const result = id === 462 && !error ? machine.pop() : undefined;
    assert.equal(machine.sp, before + 4);
    assert.equal(machine.pop(), canary);
    return result;
  };
  const id = await world.objects.create({ kind: 15, parent: world.main.id, nativeID: 0x150010 });
  const draw = world.graphics.drawTasks.get(id);
  const target = world.nativeTaskID(id);
  const entryKey = (slot) => ((slot << 16) | world.nativeTaskID(task.id)) >>> 0;
  const bitmap = async (color) => {
    const handle = world.graphics.images.create(3, 2);
    await world.graphics.images.get(handle).fill(0, 0, 3, 2, color);
    return handle;
  };
  const pixels = () => world.graphics.images.get(draw.state.renderer.bitmap).pixels();
  const bitmapArgs = (slot, handle, x = 2, y = 1, alpha = 255) => [
    target,
    slot,
    handle,
    floatBits(x),
    floatBits(y),
    0,
    0,
    0,
    floatBits(1),
    floatBits(1),
    alpha,
    1,
    0,
  ];
  return { world, call, draw, target, bitmap, bitmapArgs, entryKey, pixels };
}

test('fixed SDK Draw updates its bitmap and returns the full sender-keyed layer', async (t) => {
  const { world, call, draw, target, bitmap, bitmapArgs, entryKey } = await authorDraw(t);
  const selected = 0x8001;
  const first = await bitmap(0xffa12456);
  const second = await bitmap(0xffe2bb11);
  const before = structuredClone(draw.state);
  await call(259, bitmapArgs(selected, first));
  assert.deepEqual(draw.state, before);
  for (const [id, args] of [
    [264, [target]],
    [462, [target, selected]],
    [463, [target, selected, 0]],
  ])
    await call(id, args, /require an initialized renderer/);
  assert.deepEqual(draw.state, before);

  await call(256, [target, 8, 6]);
  await call(260, [target, 0, 0]);
  await call(259, bitmapArgs(selected, first, 1, 1));
  const key = entryKey(selected);
  const imageData = (handle) => world.graphics.images.get(handle).dataHandle;
  assert.equal(imageData(draw.entry(key).image), imageData(first));
  assert.equal(await call(462, [target, selected]), selected);
  const old = draw.entry(key).image;
  for (const alpha of [0, 1, 254, 255, 256, 0x80000000, 0xffffffff]) {
    await call(259, bitmapArgs(selected, second, 2, 1, alpha));
    assert.equal(imageData(draw.entry(key).image), imageData(second));
    assert.equal(draw.entry(key).alpha, Math.min(255, alpha));
    assert.equal(draw.state.renderer.items.length, 1);
  }
  assert.equal(world.runtime.handles.records.has(old), false);
  const expected = structuredClone(draw.entry(key));
  await call(259, bitmapArgs(selected, 0, 0, 0, 0));
  assert.deepEqual(draw.entry(key), expected);

  for (const layer of [0xffffffff, 0, 237, 0x00800000, 0x80000000, 0x7fffffff]) {
    await call(463, [target, selected, layer]);
    assert.equal(draw.entry(key).layer, layer | 0);
    assert.equal(await call(462, [target, selected]), layer);
  }
  await call(463, [target, selected + 1, 0xa532f928]);
  assert.equal(await call(462, [target, selected + 1]), 0xffffffff);
  assert.equal(await call(462, [0x734f0000, selected]), 0xffffffff);
  const replies = [];
  const send = world.sendNativeEngine;
  world.sendNativeEngine = async function (target, sender, id, ...operands) {
    const result = await send.call(this, target, sender, id, ...operands);
    if (id === 288) replies.push(result);
    return result;
  };
  assert.equal(await call(264, [target]), undefined);
  assert.deepEqual(replies, [1]);
  assert.equal(draw.state.renderer.items.length, 1);
  const abi = nativeABI(profile);
  assert.equal(abi.tables.main.entries[264].signature.resultWritten, true);
  assert.deepEqual(abi.tables.main.entries[264].signature.controlCodes, [2]);
});

test('fixed SDK Draw redraws the supplied signed rectangle immediately', async (t) => {
  const { world, call, draw, target, bitmap, bitmapArgs, pixels } = await authorDraw(t);
  draw.state.dirty = false;
  await call(862, [target, 2, 1, 4, 3]);
  assert.equal(draw.state.dirty, true);
  assert.equal(draw.state.renderer, null);
  await call(256, [target, 8, 6]);
  await call(260, [target, 0, 0]);
  await call(262, [target, 0]);
  const source = await bitmap(0xffe2bb11);
  await call(259, bitmapArgs(1, source));
  await world.graphics.images.release(source);
  const painted = new Uint8ClampedArray(8 * 6 * 4);
  const set = (x, y) => painted.set([0xe2, 0xbb, 0x11, 0xff], ((5 - y) * 8 + x) * 4);
  assert.deepEqual(await pixels(), painted);
  await call(862, [target, 2, 1, 4, 3]);
  for (const [x, y] of [
    [2, 1],
    [3, 1],
    [2, 2],
    [3, 2],
  ])
    set(x, y);
  assert.deepEqual(await pixels(), painted);
  await call(862, [target, -5, -3, 3, 2]);
  assert.deepEqual(await pixels(), painted);
  await call(862, [target, 4, 1, 5, 3]);
  set(4, 1);
  set(4, 2);
  assert.deepEqual(await pixels(), painted);
  for (const rectangle of [
    [3, 3, 3, 5],
    [7, 5, 1, 1],
  ]) {
    await call(862, [target, ...rectangle]);
    assert.deepEqual(await pixels(), painted);
  }
});
