// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23',
  sentinel = 0xa713f9de;

async function call(world, owner, id, args) {
  const program = kcsProgram([
    [37, sentinel],
    ...args.map((word) => [37, word]),
    [43, id, args.length * 4],
    [59],
  ]);
  const task = { ...owner, io: null },
    guest = (task.machine = new KCSMachine(await readKCS(program), {
      native: (number, words, machine) =>
        world.runtime.scheduler.native(task, number, words, machine),
    }));
  const floor = guest.sp;
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(guest.sp, floor + 4);
  assert.equal(guest.pop(), sentinel);
}

test('fixed 2.6.1.23 Plane GCALLs select one region, retain its receiver word and unbind', async (t) => {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  const first = await world.objects.create({ kind: 6, parent: world.root }),
    second = await world.objects.create({ kind: 6, parent: world.root }),
    firstNative = world.nativeTaskID(first),
    secondNative = world.nativeTaskID(second),
    main = world.main,
    input = world.inputFor(main.id);
  await call(world, main, 106, [firstNative, 1]);
  assert.equal(input.get(first), null);
  await call(world, main, 104, [firstNative, 0, 0, 12, 16, 7, 0x89]);
  await call(world, main, 104, [secondNative, 12, 0, 12, 16, 4, 0]);
  const firstRegion = input.get(first),
    secondRegion = input.get(second);
  await call(world, main, 106, [firstNative, 0x80001234]);
  await call(world, main, 106, [0, 17]);
  await call(world, main, 106, [0xf012345, 41]);
  assert.deepEqual([firstRegion.active, secondRegion.active], [0x80001234, 0]);
  await call(world, main, 106, [secondNative, 0xffffffff]);
  await call(world, main, 106, [firstNative, 0]);
  assert.deepEqual([firstRegion.active, secondRegion.active], [0, 0xffffffff]);
  const owner = world.graphics.get(first);
  for (const word of [0, 0x80001234, world.nativeTaskID(world.main.id)]) {
    await call(world, main, 110, [firstNative, word]);
    assert.equal(owner.state.receiver >>> 0, word);
  }
  await call(world, main, 99, [0]);
  assert.strictEqual(input.get(first), firstRegion);
  await call(world, main, 99, [firstNative]);
  await call(world, main, 99, [firstNative]);
  assert.equal(input.get(first), null);
  assert.equal(owner.state.receiver, -1);
  assert.strictEqual(input.get(second), secondRegion);
});

test('fixed 2.6.1.23 cursor requests keep the current move when the setting or bounds decline', async (t) => {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  const innerTop = await world.objects.create({ kind: 1, nativeID: 0 }),
    inner = await world.spawnScript('case.kcs', { parent: innerTop }),
    input = world.inputFor(inner.id),
    config = world.configuration.blocks[2],
    setting = new DataView(config.buffer, config.byteOffset, config.byteLength),
    points = [];
  Object.assign(world.graphics.view, { virtualWidth: 64, virtualHeight: 48 });
  world.host.nativePointerWarped = (x, y) => points.push([x, y]);
  input.pointer(2, 6);
  world.input.pointer(2, 6);
  input.frame = 41;
  setting.setUint32(12, 1, true);
  input.foreground = false;
  await call(world, inner, 150, [0x1000b, 0x1000f, 3]);
  assert.deepEqual(input.warp, { x: 11, y: 15, remaining: 3, started: 41 });
  assert.equal(world.input.warp, null);
  const accepted = input.warp;
  for (const point of [
    [64, 2],
    [2, 48],
    [0xffffffff, 40],
  ]) {
    await call(world, inner, 150, [...point, 17]);
    assert.strictEqual(input.warp, accepted);
  }
  setting.setUint32(12, 0, true);
  await call(world, inner, 150, [17, 21, 8]);
  assert.strictEqual(input.warp, accepted);
  for (const frame of [42, 43, 44]) await input.tick(frame);
  assert.deepEqual(points, [
    [5, 9],
    [8, 12],
    [11, 15],
  ]);
  assert.equal(input.warp, null);
});

test('fixed 2.6.1.23 copies 16-bit mask alpha from native rows before live input sampling', async (t) => {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  const plane = await world.objects.create({ kind: 6, parent: world.root }),
    native = world.nativeTaskID(plane),
    task = world.main,
    input = world.inputFor(task.id),
    handle = world.graphics.images.create(4, 2, task.id),
    bitmap = world.graphics.images.get(handle),
    pixels = await bitmap.pixels();
  bitmap.state.bpp = 2;
  pixels[3] = 15;
  pixels[7] = 16;
  pixels[4 * 4 + 2 * 4 + 3] = 240;
  await bitmap.changed();
  await call(world, task, 104, [native, 20, 40, 4, 2, 7, 0]);
  input.changed = false;
  await call(world, task, 394, [native, handle]);
  const region = input.get(plane);
  assert.deepEqual(region.alpha.bytes, Uint8Array.of(4, 2));
  assert.equal(input.changed, false);
  assert.equal(input.hit(region, false, [22, 40]), true);
  assert.equal(input.hit(region, false, [21, 41]), true);
  assert.equal(input.hit(region, false, [20, 41]), false);
  await assert.rejects(call(world, task, 394, [0xf012345, 0xa7654321]), /native bitmap handle/);
  assert.deepEqual(region.alpha.bytes, Uint8Array.of(4, 2));
  await call(world, task, 394, [native, 0]);
  assert.equal(region.alpha, null);
});
