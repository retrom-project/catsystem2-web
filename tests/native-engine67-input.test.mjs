// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67',
  marker = 0xe6f13918;
const programs = {
  'plane-source.kcs': script(109, [[0x13, 68]], 72),
  'cursor-position.kcs': script(149, [
    [0x13, 68],
    [0x13, 72],
  ]),
  'cursor-warp.kcs': script(150, [
    [0x13, 68],
    [0x13, 72],
    [0x13, 76],
  ]),
};

function script(number, words, out) {
  return kcsProgram([
    [37, marker],
    ...words.map((word) => [37, word]),
    [43, number, words.length * 4],
    ...(out === undefined ? [] : [[38, out]]),
    [59],
  ]);
}

async function execute(world, parent, name, args) {
  const task = await world.spawnScript(name, { parent, initialExecute: false }),
    { machine } = task,
    stack = machine.sp;
  args.forEach((word, index) => machine.store(68 + 4 * index, word));
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, stack + 4);
  assert.equal(machine.pop(), marker);
  return machine;
}

test('2.6.1.67 Plane source resolves the owning Input and preserves the original reply words', async (t) => {
  const world = await dataWorld(profile, programs);
  t.after(() => world.close({ flushFiles: false }));
  const outer = world.root,
    top = await world.objects.create({ kind: 1, nativeID: 0 }),
    plane = await world.objects.create({ kind: 6, parent: top }),
    graph = await world.objects.create({ kind: 2, parent: top }),
    input = world.inputFor(plane);
  world.inputFor(outer).source = 7;
  for (const [number, recipient, result] of [
    [0, plane, 0],
    [1, plane, 1],
    [2, graph, 2],
    [4, plane, 4],
    [8, graph, 8],
    [16, plane, 2],
    [16, graph, 2],
    [32, plane, 32],
    [0x80000000, graph, 0x80000000],
    [0xe0010203, plane, 0xe0010203],
  ]) {
    input.source = number;
    const m = await execute(world, top, 'plane-source.kcs', [world.nativeTaskID(recipient)]);
    assert.equal(m.load(72), result);
  }
  const absent = await execute(world, top, 'plane-source.kcs', [0x4ffff]);
  assert.equal(absent.load(72), 0);
  const unrelated = await world.objects.create({ kind: 15, parent: top });
  await assert.rejects(
    () => execute(world, top, 'plane-source.kcs', [world.nativeTaskID(unrelated)]),
    /Plane input source requires a verified receiver/,
  );
});

test('2.6.1.67 cursor position writes out-of-bounds, aliased, and shared signed coordinates', async (t) => {
  const world = await dataWorld(profile, programs);
  t.after(() => world.close({ flushFiles: false }));
  const { input, root } = world;
  input.services.screenToVirtual = (x, y) => [Math.trunc((x - 12) / 2), Math.trunc((y - 4) / 2)];
  for (const [x, y, destX, destY, resultX, resultY] of [
    [43, 66, 100, 104, 15, 31],
    [-9, 18, 100, 104, -10, 7],
    [0, 999, 100, 104, -6, 497],
    [43, 66, 104, 104, 31, 31],
    [43, 66, 0x80000044, 104, 15, 31],
    [83, 59, 100, 104, 35, 27],
  ]) {
    input.pointer(x, y);
    const m = await execute(world, root, 'cursor-position.kcs', [destX, destY]);
    assert.deepEqual([m.load(destX), m.load(destY)], [resultX >>> 0, resultY >>> 0]);
  }
});

test('2.6.1.67 cursor warp uses the setting, focus, packed coordinates and retained frames', async (t) => {
  const world = await dataWorld(profile, programs);
  t.after(() => world.close({ flushFiles: false }));
  const { input, root } = world,
    block = world.configuration.blocks[2],
    configuration = new DataView(block.buffer, block.byteOffset, block.byteLength),
    moves = [];
  Object.assign(world.graphics.view, { virtualWidth: 640, virtualHeight: 480 });
  world.host.nativePointerWarped = (x, y) => moves.push([x, y]);
  configuration.setUint32(12, 1, true);
  input.frame = 82;
  input.pointer(1, 1);

  await execute(world, root, 'cursor-warp.kcs', [0x10019, 0xbeef0007, 0xffffffff]);
  assert.deepEqual(input.warp, { x: 25, y: 7, remaining: 0xffffffff, started: 82 });
  await execute(world, root, 'cursor-warp.kcs', [639, 479, 0]);
  assert.deepEqual(input.warp, { x: 639, y: 479, remaining: 0, started: 82 });
  const prior = input.warp;
  for (const point of [
    [640, 7],
    [20, 480],
    [0xffffffff, 7],
  ]) {
    await execute(world, root, 'cursor-warp.kcs', [...point, 13]);
    assert.strictEqual(input.warp, prior);
  }
  input.foreground = false;
  await execute(world, root, 'cursor-warp.kcs', [25, 7, 13]);
  assert.strictEqual(input.warp, prior);
  input.foreground = true;
  configuration.setUint32(12, 0, true);
  await execute(world, root, 'cursor-warp.kcs', [25, 7, 13]);
  assert.strictEqual(input.warp, prior);

  configuration.setUint32(12, 1, true);
  await execute(world, root, 'cursor-warp.kcs', [25, 7, 3]);
  for (const frame of [83, 84, 85]) await input.tick(frame);
  assert.deepEqual(moves, [
    [9, 3],
    [17, 5],
    [25, 7],
  ]);
  assert.equal(input.warp, null);
});
