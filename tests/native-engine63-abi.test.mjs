// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { deserializeCheckpoint, serializeCheckpoint } from '../src/checkpoint.mjs';
import { openImage } from '../src/formats/hg3.mjs';
import { encodeCP932, KCSMachine, readKCS } from '../src/kcs.mjs';
import { floatBits, NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { NativeResources } from '../src/native/resources.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { breakShards } from '../src/native/screen-effect-geometry.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { areaPixelParameters } from './fixtures/area-effect-cases.mjs';
import { controlFiles } from './fixtures/control-files.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { defaultFESWorld, drawPixels, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { glyphs } from './fixtures/fes-text-log-world.mjs';
import { imageOwnerFiles } from './fixtures/image-files.mjs';
import { ScreenVectorGPU } from './fixtures/screen-effects-fixture.mjs';
import { hg3, kcsProgram } from './helpers.mjs';

const profile = 'rebellions-jp-engine-2.6.1.63';

const mainProgram = (id, width) =>
  kcsProgram([
    [37, 0x82345678],
    ...Array.from({ length: width }, (_, index) => [37, [0x13, 80 + index * 4]]),
    [43, id, width * 4],
    [59],
  ]);

async function executeMain(world, id, argv, setup = () => {}, result) {
  const task = await world.spawnScript(`main-${id}.kcs`, {
    parent: world.main.id,
    initialExecute: false,
  });
  try {
    const machine = task.machine;
    argv.forEach((word, index) => machine.store(80 + index * 4, word));
    setup(machine, task);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, machine.floor + (result === undefined ? 4 : 8));
    if (typeof result === 'function') result(machine.pop());
    else if (result !== undefined) assert.equal(machine.pop(), result);
    assert.equal(machine.pop(), 0x82345678);
    return machine;
  } finally {
    await world.objects.release(task.id);
  }
}

test('2.6.1.63 task queries preserve route keys, receiver flags and cold restoration', async () => {
  let world = await dataWorld(profile);
  const parent = world.main.id,
    firstKey = 0xf0000173,
    nestedKey = 0xf10000b1,
    lastKey = 83,
    marker = 0xcd34e26a;
  const call = async (id, args, ownerID = parent) => {
    const code = await readKCS(
        kcsProgram([
          [37, marker],
          ...args.map((arg) => [37, arg]),
          [43, id, 4 * args.length],
          [59],
        ]),
      ),
      owner = {
        ...world.runtime.scheduler.tasks.get(ownerID),
        id: ownerID,
        abi: 'main',
        context: {},
        io: null,
      },
      machine = (owner.machine = new KCSMachine(code, {
        native: (number, words, caller) =>
          world.runtime.scheduler.native(owner, number, words, caller),
      }));
    await world.runtime.scheduler.execute(owner);
    assert.equal(machine.sp, machine.floor + (id === 67 ? 4 : 8));
    const answer = id === 67 ? undefined : machine.pop();
    assert.equal(machine.pop(), marker);
    return answer;
  };
  try {
    const first = await world.objects.create({ kind: 12, parent, nativeID: firstKey }),
      nested = await world.objects.create({ kind: 12, parent: first, nativeID: nestedKey }),
      last = await world.objects.create({ kind: 12, parent, nativeID: lastKey });

    world.objects.objects.get(first).flags = 0x81300000;
    assert.equal(await call(74, [firstKey]), 0x81300000);
    assert.equal(await call(74, [0x7364cafa]), 0xffffffff);
    for (const [index, key] of [firstKey, nestedKey, lastKey, 0xffffffff].entries())
      assert.equal(await call(75, [index]), key);
    assert.equal(await call(75, [0xffffffff]), 0xffffffff);
    assert.equal(await call(76, [], nested), firstKey);
    assert.equal(await call(77, [0]), 0);
    assert.equal(await call(77, [nestedKey]), 1);
    const callerAddress = await call(74, [0]);
    assert.notEqual(callerAddress, world.nativeTaskID(parent));
    await call(67, [lastKey]);
    assert.equal(await call(74, [lastKey]), callerAddress);
    assert.equal(await call(77, [lastKey]), 1);

    const checkpoint = structuredClone(world.snapshot());
    await world.close({ flushFiles: false });
    world = await dataWorld(profile, {}, { initialize: false });
    await world.restore(checkpoint);
    assert.equal(await call(75, [1]), nestedKey);
    assert.equal(await call(77, [lastKey]), 1);
    await world.objects.release(last);
    assert.equal(await call(75, [2]), 0xffffffff);
    assert.equal(await call(77, [lastKey]), 1);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('2.6.1.63 Main74 borrows the calling Script header for independent CSS byte copies', async () => {
  const files = new Map();
  const storage = {
    read: async (name) => files.get(name)?.slice() ?? null,
    write: async (name, bytes) => (files.set(name, bytes.slice()), true),
  };
  const freshWorld = (initialize) => dataWorld(profile, {}, { initialize, storage });
  const world = await freshWorld(true);
  const checkpointWorld = await freshWorld(false);
  const fileWorld = await freshWorld(false);
  const code = async (id, words) => readKCS(kcsProgram([[43, id, words * 4], [59]]));
  async function call(w, owner, id, args, setup = () => {}) {
    const task = { ...w.runtime.scheduler.tasks.get(owner), id: owner, abi: 'main', io: null },
      machine = (task.machine = new KCSMachine(await code(id, args.length), {
        native: (slot, values, caller) => w.runtime.scheduler.native(task, slot, values, caller),
      })),
      marker = 0x11ca120e;
    machine.push(marker);
    args.forEach((value) => machine.push(value));
    setup(machine);
    await w.runtime.scheduler.execute(task);
    assert.ok(machine.halted);
    const control = [67, 246, 834].includes(id) ? 2 : 1;
    assert.equal(machine.sp, machine.floor + (control === 1 ? 8 : 4));
    const value = control === 1 ? machine.pop() : null;
    assert.equal(machine.pop(), marker);
    return { control, value, machine };
  }
  const pointerWords = (memory, at, n) =>
    Array.from({ length: n }, (_, index) => memory.load(at + 4 * index));
  const name = (machine) => machine.writeString('caller-header.css', 512);
  try {
    const a = world.main.id,
      b = (await world.spawnScript('case.kcs', { parent: world.root, initialExecute: false })).id,
      c = await world.objects.create({ kind: 12, parent: a, nativeID: 400 }),
      cID = world.nativeTaskID(c),
      heap = world.runtime.imageDataBuffers.process,
      vtable = nativeABI(profile).task.kindQueryCallerView.vtableWord,
      file = (await call(world, a, 238, [17])).value,
      css = world.runtime.handles.get(file, 'global-file');
    const addrA = (await call(world, a, 74, [0])).value,
      addrB = (await call(world, b, 74, [0])).value;
    assert.notEqual(addrA, addrB);
    assert.notEqual(addrA, world.nativeTaskID(a));
    assert.notEqual(addrB, world.nativeTaskID(b));
    assert.equal(heap.allocations.has(addrA), false);
    assert.equal((await call(world, a, 74, [cID])).value, 12);
    await call(world, a, 67, [cID]);
    assert.equal((await call(world, a, 74, [cID])).value, addrA);
    assert.equal((await call(world, b, 74, [cID])).value, addrB);
    const vmAddress = world.runtime.vmDataAddress(a, world.main.machine);
    world.runtime.releaseVMData(a);
    assert.equal(heap.contains(vmAddress), false);
    assert.equal((await call(world, a, 74, [0])).value, addrA);

    assert.equal((await call(world, a, 835, [file, 11, 8, addrA])).value, 1);
    assert.equal((await call(world, b, 835, [file, 12, 4, addrB + 4])).value, 1);
    assert.equal((await call(world, b, 835, [file, 13, 3, addrA + 1])).value, 1);
    const { value: copy, machine } = await call(world, b, 836, [file, 11, 512]);
    assert.equal(machine.load(512), 8);
    assert.notEqual(copy, addrA);
    assert.deepEqual(pointerWords(heap, copy, 2), [vtable, world.nativeTaskID(a)]);
    assert.deepEqual([...css.read(13)], [...css.read(11).subarray(1, 4)]);
    await call(world, b, 834, [copy]);

    const savedNativeID = world.nativeTaskID(a),
      record = world.objects.objects.get(a);
    record.nativeID = 901;
    assert.equal((await call(world, b, 835, [file, 14, 8, addrA])).value, 1);
    assert.equal(new DataView(css.read(14).buffer).getUint32(4, true), 901);
    assert.equal(new DataView(css.read(11).buffer).getUint32(4, true), savedNativeID);
    record.nativeID = savedNativeID;
    const before = css.snapshot();
    await assert.rejects(call(world, a, 835, [file, 15, 9, addrA]), /Unmapped native buffer/);
    await assert.rejects(call(world, a, 835, [file, 15, 2, addrA + 7]), /Unmapped native buffer/);
    await assert.rejects(call(world, a, 834, [addrA]), /requires an owned raw allocation/);
    assert.throws(() => heap.store(addrA, 7), /reviewed read-only consumer/);
    assert.throws(() => heap.readHostData(addrA, 8, 767), /no reviewed read contract/);
    assert.deepEqual(css.snapshot(), before);

    assert.equal((await call(world, a, 245, [file, 512], name)).value, 1);
    assert.equal(new DataView(files.get('caller-header.css').buffer).getUint32(0, true), 0x535343);
    const reboundVMAddress = world.runtime.vmDataAddress(a, world.main.machine);
    const checkpoint = await serializeCheckpoint(world.snapshot());
    const state = await deserializeCheckpoint(checkpoint);
    await checkpointWorld.restore(state);
    assert.equal((await call(checkpointWorld, a, 74, [0])).value, addrA);
    assert.equal((await call(checkpointWorld, b, 74, [cID])).value, addrB);
    assert.equal(
      checkpointWorld.runtime.vmDataAddress(a, checkpointWorld.main.machine),
      reboundVMAddress,
    );
    for (const corrupt of [
      (reference) => {
        reference.length = 9;
      },
      (reference) => {
        reference.taskID = b;
      },
      (reference) => {
        reference.taskID = 99999;
      },
    ]) {
      const invalid = structuredClone(state.runtime);
      corrupt(invalid.imageDataBuffers.memory.regions.find(([at]) => at === addrA)[1]);
      await assert.rejects(checkpointWorld.runtime.restore(invalid), /Native caller task/);
      assert.deepEqual(checkpointWorld.snapshot(), state);
    }

    await checkpointWorld.objects.release(b);
    await assert.rejects(
      call(checkpointWorld, a, 835, [file, 15, 4, addrB]),
      /Unmapped native buffer/,
    );
    const replacement = await checkpointWorld.spawnScript('case.kcs', {
      parent: checkpointWorld.root,
      initialExecute: false,
    });
    assert.equal(replacement.id, b);
    assert.notEqual((await call(checkpointWorld, b, 74, [0])).value, addrB);
    assert.deepEqual(checkpointWorld.runtime.handles.get(file, 'global-file').snapshot(), before);

    await fileWorld.initialize('case.kcs');
    const fileOwner = fileWorld.main.id;
    const restoredFile = (await call(fileWorld, fileOwner, 247, [512], name)).value;
    assert.ok(restoredFile);
    const { value: coldCopy } = await call(fileWorld, fileOwner, 836, [restoredFile, 11, 512]);
    assert.deepEqual(pointerWords(fileWorld.runtime.imageDataBuffers.process, coldCopy, 2), [
      vtable,
      savedNativeID,
    ]);
    await call(fileWorld, fileOwner, 834, [coldCopy]);
  } finally {
    for (const w of [fileWorld, checkpointWorld, world]) await w.close({ flushFiles: false });
  }
});

test('2.6.1.63 Main655 routes a bounded CP932 Plane notification through its caller Top', async (t) => {
  const world = await dataWorld(profile, { 'main-655.kcs': mainProgram(655, 2) });
  t.after(() => world.close({ flushFiles: false }));
  const plane = await world.objects.create({ kind: 2, parent: world.root });
  const target = world.nativeTaskID(plane);
  const receiver = world.objects.objects.get(plane).implementation;
  const state = structuredClone(receiver.snapshot());
  const send = world.sendNativeEngine.bind(world);
  const sent = [];
  world.sendNativeEngine = (nativeID, sender, message, w, l, context) => {
    if (message === 86) {
      const packet = context.payload.bytes(l, 256);
      const length = packet.indexOf(0);
      assert.ok(length >= 0);
      sent.push([nativeID, w, l, context.flags, ...packet.subarray(0, length)]);
    }
    return send(nativeID, sender, message, w, l, context);
  };
  const call = (nativeID, address, value) =>
    executeMain(world, 655, [nativeID, address], (machine) => {
      if (value !== undefined) {
        const bytes = encodeCP932(value);
        machine.bytes(address, bytes.length + 1).set([...bytes, 0]);
        machine.store(352, -17);
      }
    });
  await call(target, 256, '画像%d[G352]');
  await call(target, 0x80000100, '前景%%');
  await call(0, 256, '');
  await assert.rejects(call(target, 0xffffffff), /KCS memory ffffffff\+1/);
  assert.deepEqual(sent, [
    [target, 0, 0, 0, ...encodeCP932('画像-17')],
    [target, 0, 0, 0, ...encodeCP932('前景%')],
    [0, 0, 0, 0],
  ]);
  assert.deepEqual(receiver.snapshot(), state);
});

test('2.6.1.63 Wipe keeps a private mask and preserves cleared alpha on a threshold restart', async (t) => {
  const world = await dataWorld(profile, {
    'main-905.kcs': mainProgram(905, 5),
    'main-531.kcs': mainProgram(531, 2),
  });
  t.after(() => world.close({ flushFiles: false }));
  const { stageRenderer: stage, screenEffects, graphics } = world;
  graphics.view.configure({
    clientWidth: 4,
    clientHeight: 2,
    drawingRectangle: [1, 0, 3, 2],
  });
  stage.gpu = new ScreenVectorGPU(4, 2);
  graphics.createLogicalDevice();
  const rendering = screenEffects.rendering;
  assert.equal(rendering.prepare(1), true);
  const capture = Uint8Array.from({ length: 32 }, (_, i) => (i % 4 === 3 ? 79 : 31));
  stage.writeSurface(rendering.captures[0], capture);

  const id = await world.objects.create({ kind: 39, parent: world.main.id });
  const target = world.nativeTaskID(id);
  const wipe = screenEffects.tasks.get(id);
  const bitmap = graphics.images.create(4, 2, world.main.id);
  const handle = graphics.images.get(bitmap).dataHandle;
  await graphics.images.get(bitmap).fill(0, 0, 4, 2, 0xff0000ff);
  const initialize = (duration) =>
    executeMain(world, 905, [target, duration, floatBits(0), floatBits(100), bitmap]);
  const clock = (at) => (wipe.record.effectiveFrame = at);
  const alpha = (column = 1) => stage.surfacePixels(wipe.state.work[0])[column * 4 + 3];
  const render = () => rendering.render([], async () => {}, null);

  assert.equal(alpha(), 79);
  await initialize(4);
  assert.equal(alpha(), 255);
  assert.equal(wipe.state.maskSource, 0);
  const before = structuredClone(wipe.snapshot());
  await assert.rejects(initialize(0), /duration divides by zero/);
  graphics.view.configure({ drawingRectangle: [-1, 0, 3, 2] });
  await assert.rejects(initialize(4), /exceeds its mask allocation/);
  graphics.view.configure({ drawingRectangle: [1, 0, 3, 2] });
  assert.deepEqual(wipe.snapshot(), before);
  await graphics.images.release(bitmap);
  assert.ok(!graphics.images.handles.records.has(handle));

  clock(7);
  await executeMain(world, 531, [target, 1]);
  clock(8);
  await render();
  assert.equal(alpha(), 0);
  assert.equal(alpha(0), 255);
  clock(9);
  await executeMain(world, 531, [target, 0]);
  assert.deepEqual([wipe.state.active, wipe.state.start, wipe.state.end], [0, 7, 11]);
  clock(18);
  await executeMain(world, 531, [target, 1]);
  await render();
  assert.equal(alpha(), 0);
});

test('2.6.1.63 Main541 releases existing intersecting texture pages only with an active owner', async (t) => {
  const world = await dataWorld(
    profile,
    { 'main-541.kcs': mainProgram(541, 4), 'main-542.kcs': mainProgram(542, 0) },
    { initialize: false },
  );
  t.after(() => world.close({ flushFiles: false }));
  const texture = world.configuration.fields.texture;
  texture.size.set([8, 8]);
  texture.grid.set([2, 2]);
  texture.bppY.set([0, 1]);
  for (const area of texture.areas) area.fill(0xffffffff);
  texture.areas[0].set([0, 0, 2, 2]);
  await world.initialize('case.kcs');
  const { graphics } = world,
    pages = graphics.texturePages;
  const prior = [0, 1, 2, 3].map((i) => pages.frame(i));
  const release = () => executeMain(world, 541, [7, 0, 2, 1]);

  await release();
  assert.equal(pages.pages.size, 4);
  const device = graphics.createLogicalDevice();
  try {
    graphics.view.configure({ active: false });
    await release();
    assert.equal(pages.pages.size, 4);
    graphics.view.configure({ active: true });
    await release();
    assert.equal(pages.pages.has(0), false);
    assert.equal(pages.pages.has(1), false);
    assert.equal(pages.frame(2), prior[2]);
    assert.equal(pages.frame(3), prior[3]);
    await release();
    await executeMain(world, 542, []);
    assert.notEqual(pages.frame(0), prior[0]);
    assert.notEqual(pages.frame(1), prior[1]);
    assert.equal(pages.frame(2), prior[2]);
  } finally {
    device.retire();
  }
});

test('2.6.1.63 Main740 converts overlapping viewport words using the original integer input', async (t) => {
  const world = await dataWorld(profile, { 'main-740.kcs': mainProgram(740, 2) });
  t.after(() => world.close({ flushFiles: false }));
  const { screen } = world.configuration;
  Object.assign(screen, {
    fullPosition: 0,
    currentHeight: 677,
    fullHeight: 467,
    virtualHeight: 433,
  });
  world.graphics.view.configure({
    active: false,
    deviceOffset: [0, 0],
    deviceScale: 1,
    ratios: [0.51123, 2.1112],
    windowShift: [3, -19],
    drawingRectangle: [0, 0, 1080, 1820],
  });
  const seed = (machine) =>
    [0x95ec52a1, 0x7acd62a1, 0xab144a9c, 0x6425bab3].forEach((word, i) =>
      machine.store(60 + i * 4, word),
    );
  const read = (machine) => [60, 64, 68, 72].map((at) => machine.load(at));
  const overlap = await executeMain(world, 740, [64, 66], seed);
  assert.deepEqual(read(overlap), [0x95ec52a1, 0x03021a4a, 0xab140000, 0x6425bab3]);

  screen.fullPosition = 2;
  const virtual = await executeMain(world, 740, [64, 68], seed);
  assert.deepEqual(read(virtual), [0x95ec52a1, 0, 433, 0x6425bab3]);
  screen.fullPosition = 3;
  const other = await executeMain(world, 740, [64, 68], seed);
  assert.deepEqual(read(other), [0x95ec52a1, 0, 0xab144a9c, 0x6425bab3]);
});

test('2.6.1.63 bitmap multiply preserves native BGRA factors and lower depths', async (t) => {
  const world = await dataWorld(profile, { 'main-369.kcs': mainProgram(369, 2) });
  t.after(() => world.close({ flushFiles: false }));
  const { images } = world.graphics,
    handle = images.create(1, 1, world.main.id),
    bitmap = images.get(handle),
    color = 0x7f69ebac;

  await executeMain(world, 369, [0, color]);
  for (const [bpp, expected] of [
    [2, [153, 127, 99, 173]],
    [3, [153, 127, 99, 173]],
    [4, [63, 117, 66, 86]],
  ]) {
    Object.assign(bitmap.state, { bpp, rgba: Uint8ClampedArray.of(153, 127, 99, 173) });
    await executeMain(world, 369, [handle, color]);
    assert.deepEqual([...(await bitmap.pixels())], expected);
  }
});

test('2.6.1.63 bitmap and image-owner geometry preserve raw coordinates and null results', async (t) => {
  const ids = [363, 371, 372, 373, 374, 718, 719, 720];
  const world = await dataWorld(
    profile,
    Object.fromEntries(ids.map((id) => [`main-${id}.kcs`, mainProgram(id, 3)])),
  );
  t.after(() => world.close({ flushFiles: false }));
  const images = world.graphics.images,
    bitmap = images.create(2, 1),
    source = images.get(bitmap),
    owner = world.imageOwners.add(bitmap, world.main.id),
    empty = world.imageOwners.add(0, world.main.id);
  const call = (id, args, result) => executeMain(world, id, args, undefined, result);
  await source.fill(0, 0, 2, 1, 0x7fe42b96);
  const pixels = await source.pixels();
  for (const [direct, owned, fields] of [
    [372, 718, ['canvasWidth', 'canvasHeight']],
    [373, 719, ['offsetX', 'offsetY']],
    [374, 720, ['baseX', 'baseY']],
  ]) {
    await call(direct, [0, 1, 2], 0);
    await call(direct, [bitmap, 0x80000000, 0xffffffff], 1);
    assert.deepEqual(
      fields.map((field) => source.state[field]),
      [-2147483648, -1],
    );
    await call(owned, [0, 3, 4], 1);
    await call(owned, [empty, 5, 6], 0);
    assert.deepEqual(
      fields.map((field) => source.state[field]),
      [-2147483648, -1],
    );
    await call(owned, [owner, 0xff410700, 0x807611ff], 1);
    assert.deepEqual(
      fields.map((field) => source.state[field] >>> 0),
      [0xff410700, 0x807611ff],
    );
  }
  const canary = 0xa5f06e2d;
  for (const [id, emptyWord, status] of [
    [363, 0, undefined],
    [371, canary, 0],
  ]) {
    let machine = await executeMain(
      world,
      id,
      [0, 156, 160],
      (m) => {
        m.store(156, canary);
        m.store(160, canary);
      },
      status,
    );
    assert.deepEqual([machine.load(156), machine.load(160)], [emptyWord, emptyWord]);
    machine = await call(id, [bitmap, 157, 157], id === 363 ? undefined : 1);
    assert.equal(machine.load(157), 0x807611ff);
  }
  assert.deepEqual(await source.pixels(), pixels);
});

test('2.6.1.63 image-owner copy preserves physical row order for overlapping copies', async (t) => {
  const world = await dataWorld(profile, { 'main-735.kcs': mainProgram(735, 10) });
  t.after(() => world.close({ flushFiles: false }));
  const images = world.graphics.images,
    bitmap = images.create(4, 4),
    owner = world.imageOwners.add(bitmap, world.main.id),
    empty = world.imageOwners.add(0, world.main.id),
    rows = [149, 197, 245, 37];
  images.get(bitmap).state.rgba = Uint8ClampedArray.from({ length: 64 }, (_, i) =>
    i % 4 === 0 ? (rows[i >> 4] + ((i >> 2) & 3) * 52) & 255 : 255,
  );
  const call = (source, destination) =>
    executeMain(world, 735, [source, 0, 1, 4, 3, destination, 0, 0, 4, 3]);
  await call(owner, owner);
  assert.deepEqual(
    [...(await images.get(bitmap).pixels()).filter((_, index) => index % 4 === 0)],
    [37, 89, 141, 193, 37, 89, 141, 193, 37, 89, 141, 193, 37, 89, 141, 193],
  );
  await call(0, 0);
  await assert.rejects(() => call(0, owner), /requires a source bitmap/);
  await assert.rejects(() => call(empty, owner), /requires a source bitmap/);
});

async function run(instructions, diagnostic) {
  const runtime = new NativeRuntime({
    profile,
    read: async () => kcsProgram(instructions),
    services: { diagnostic },
  });
  const task = await runtime.spawn('abi-probe.kcs');
  return { runtime, task, machine: task.machine };
}

test('2.6.1.63 KX2 keeps occupied Plane registrations and selects the original model type', async (t) => {
  const model = new Uint8Array(72),
    words = new DataView(model.buffer);
  words.setUint32(0, 0x0032584b, true);
  [1.25, -2.5, 5, 3].forEach((value, i) => words.setFloat32(4 + i * 4, value, true));
  words.setUint32(20, 1, true);
  const world = await dataWorld(profile, {
    'main-81.kcs': mainProgram(81, 2),
    'main-82.kcs': mainProgram(82, 2),
    'kx2/sample.kx2': model,
  });
  t.after(() => world.close({ flushFiles: false }));
  const startup = new TextEncoder().encode(
    `<?xml version="1.0" encoding="Shift_JIS"?>
      <document><INT><int00><name>kx2</name><int>kx2.int</int><dir>kx2</dir><ext>kx2</ext></int00></INT></document>`,
  );
  world.game.nativeResources = new NativeResources(parseNativeXML(startup, 'Shift_JIS'));
  const call = (id, target, filename) =>
    executeMain(world, id, [target, 192], (machine) => machine.writeString(filename, 192));

  for (const [slot, drawType, vram] of [
    [81, 5, true],
    [82, 6, false],
  ]) {
    const id = await world.objects.create({ kind: 2, parent: world.main.id }),
      owner = world.graphics.get(id),
      target = owner.record.nativeID;
    owner.state.vramType = 1;
    await call(slot, target, 'sample');
    assert.equal(owner.graph, null);
    const device = world.graphics.createLogicalDevice();
    await call(slot, target, 'sample');
    const graph = owner.graph;
    assert.ok(graph);
    assert.equal(graph.vram, vram);
    assert.equal(graph.registrationEnabled, true);
    assert.equal(owner.state.drawType, drawType);
    assert.deepEqual(owner.state.rect, [1.25, -2.5, 3.75, 5.5]);
    await call(slot, target, 'missing');
    await call(slot, target, 'sample');
    assert.equal(owner.graph, graph);
    device.retire();
  }
});

test('2.6.1.63 Plane trail uses retained rectangle dimensions and native matrix rounding', async (t) => {
  const world = await dataWorld(profile, {
    'main-398.kcs': mainProgram(398, 12),
    'main-399.kcs': mainProgram(399, 7),
  });
  t.after(() => world.close({ flushFiles: false }));
  const graphics = world.graphics,
    id = await world.objects.create({ kind: 2, parent: world.main.id }),
    owner = graphics.get(id),
    target = owner.record.nativeID;
  graphics.createLogicalDevice();
  owner.state.vramType = 1;
  owner.state.shapeWords = [0, 0, 0, floatBits(131), floatBits(18)];
  owner.makeGraph({ type: 6, width: 792, height: 587, vram: true, registrationEnabled: true });
  const display = (graph, word) =>
    new DataView(graph.kx2.buffer).setUint32(MOTION_ABI.display, word, true);
  display(owner.graph, 0);
  const configure = (data) => executeMain(world, 398, [target, ...data]);
  await configure([
    2,
    4,
    ...[0.825, 0.375, 0.625].map(floatBits),
    0x7fbf3aa5,
    ...[3.5, -0.25, 5.75].map(floatBits),
    4,
    -2,
  ]);
  assert.equal(owner.state.trail.strip, 2);
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2.25, -7, 0, 1];
  const addresses = [256, 280, 304, 360];
  for (const [data, color, shown] of [
    [
      [
        [39.1, 15, -0],
        [-13, 7.25, 1e-35],
        [0.35, 1.15, 6.5],
      ],
      0xaba521ff,
      0x102a,
    ],
    [
      [
        [104.25, 3, -2],
        [26, 19.75, -0],
        [0.25, 0.75, 1.125],
      ],
      0xa3b82ee1,
      0x10b,
    ],
  ])
    await executeMain(world, 399, [target, ...addresses, color, shown], (machine) => {
      [...data, matrix].forEach((words, i) =>
        words.forEach((word, j) => machine.store(addresses[i] + j * 4, floatBits(word))),
      );
    });
  owner.state.renderPaused = false;
  display(owner.graph, 1);
  owner.trail.tick();
  const [leading, trailing] = owner.state.trail.graphs.map(
    (graph) => new DataView(graph.kx2.buffer),
  );
  assert.equal(leading.getUint32(MOTION_ABI.base + 4, true), 0x3f800000);
  assert.equal(leading.getUint32(MOTION_ABI.scale + 4, true), 0x40ff1343);
  assert.deepEqual(
    [48, 52].map((at) => trailing.getUint32(MOTION_ABI.matrix + at, true)),
    [0x40bfb1e0, 0x40886e08],
  );
  await configure(new Array(11).fill(0));
  assert.equal(owner.state.trail, null);
});

test('2.6.1.63 Plane lifecycle and poses use an attached graph and the original selector', async (t) => {
  const widths = new Map([
    [80, 1],
    [83, 1],
    [86, 4],
    [87, 5],
  ]);
  const world = await dataWorld(
    profile,
    Object.fromEntries(
      [...widths].map(([id, words]) => [`main-${id}.kcs`, mainProgram(id, words)]),
    ),
  );
  t.after(() => world.close({ flushFiles: false }));
  const id = await world.objects.create({ kind: 2, parent: world.main.id }),
    owner = world.graphics.get(id),
    target = world.nativeTaskID(id),
    call = (number, args = [], initialize) =>
      executeMain(world, number, [target, ...args], initialize);

  owner.makeGraph({ type: 1, width: 26, height: 48 });
  const first = owner.graph;
  await call(80);
  assert.equal(owner.graph, first);
  await assert.rejects(() => call(87, [156, 160, 164, 0]), /initialized 32-bit output word/);
  world.graphics.createLogicalDevice();
  owner.state.vramType = 1;
  const store = (bytes, offset, words) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    words.forEach((word, i) => view.setUint32(offset + i * 4, word, true));
  };
  store(owner.graph.kx2, MOTION_ABI.base, [0x7fa41234, 0x80000000, floatBits(7)]);
  store(owner.graph.kx2, MOTION_ABI.pos, [floatBits(-42.25), 0x7f801234, floatBits(15)]);
  store(owner.graph.textureTransform, MOTION_ABI.base, [-3, 8, 7].map(floatBits));
  store(owner.graph.textureTransform, MOTION_ABI.pos, [9, 8, 7].map(floatBits));
  const base = await call(86, [156, 160, 0]);
  assert.deepEqual([base.load(156), base.load(160)], [0x7fe41234, 0x80000000]);
  const pos = await call(87, [156, 160, 164, 0]);
  assert.deepEqual(
    [pos.load(156), pos.load(160), pos.load(164)],
    [floatBits(-42.25), 0x7fc01234, floatBits(15)],
  );
  const aliased = await call(87, [157, 157, 157, 0x80000007]);
  assert.equal(aliased.load(157), floatBits(7));

  await world.sendNativeEngine(target, world.main.id, 89, 0, 157);
  assert.equal(owner.state.inputTracksGraph, true);
  assert.ok(owner.input.get(id));
  await call(80);
  assert.equal(owner.graph.type, 5);
  assert.deepEqual(
    [owner.graph.width, owner.graph.height, owner.graph.triangles.length],
    [0, 0, 0],
  );
  assert.ok(owner.input.get(id));
  await call(83);
  assert.equal(owner.graph, null);
  assert.equal(owner.input.get(id), null);
  assert.equal(owner.state.inputTracksGraph, false);
  assert.deepEqual(owner.state.rect, [0, 0, 0, 0]);
  await assert.rejects(() => call(86, [156, 160, 0]), /initialized 32-bit output word/);
});

test('2.6.1.63 tile creation owns its row-major child planes and preserves an existing graph', async (t) => {
  const world = await dataWorld(profile, { 'main-433.kcs': mainProgram(433, 5) });
  t.after(() => world.close({ flushFiles: false }));
  const id = await world.objects.create({ kind: 2, parent: world.main.id }),
    plane = world.graphics.get(id),
    command = [world.nativeTaskID(id), floatBits(7.625), floatBits(3.8125), 2, 3],
    call = () => executeMain(world, 433, command);
  await call();
  assert.equal(plane.graph, null);
  world.graphics.createLogicalDevice();
  await call();
  const parent = world.objects.objects.get(id),
    children = world.objects.children(parent);
  assert.equal(plane.state.drawType, 8);
  assert.equal(children.length, 6);
  assert.deepEqual(
    children.map((child) => world.graphics.get(child.id).state.parentOffset.slice(0, 2)),
    [
      [0, 0],
      [7.625, 0],
      [0, 3.8125],
      [7.625, 3.8125],
      [0, 7.625],
      [7.625, 7.625],
    ],
  );
  const graph = plane.graph;
  await call();
  assert.equal(plane.graph, graph);
  assert.deepEqual(world.objects.children(parent), children);
});

test('2.6.1.63 Plane Input registers its own graph and preserves the full active word', async (t) => {
  const widths = new Map([
    [95, 2],
    [106, 2],
    [107, 1],
    [109, 1],
  ]);
  const world = await dataWorld(
    profile,
    Object.fromEntries(
      [...widths].map(([id, words]) => [`main-${id}.kcs`, mainProgram(id, words)]),
    ),
  );
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    id = await world.objects.create({ kind: 2, parent }),
    other = await world.objects.create({ kind: 2, parent }),
    owner = world.graphics.get(id),
    target = world.nativeTaskID(id),
    invoke = (number, args, result) => executeMain(world, number, args, undefined, result);
  await invoke(95, [0, 1]);
  await assert.rejects(() => invoke(95, [target, 1]), /requires a live graphics device/);
  world.graphics.createLogicalDevice();
  await assert.rejects(() => invoke(95, [target, 1]), /input geometry is unreviewed/);
  owner.makeGraph({ type: 1, width: 28.5, height: 19.75 });
  const model = new Float32Array(owner.graph.kx2.buffer);
  model.set([5.5, 8.25, 12.875], MOTION_ABI.base / 4);
  model.set([3.125, 11.75, 7], MOTION_ABI.pos / 4);
  await invoke(95, [target, 0x92345678]);
  const input = owner.input,
    registered = input.get(id);
  assert.deepEqual(registered.bounds, [-2, 3, 26, 23]);
  assert.equal(registered.priority, 12);
  assert.equal(registered.flags, 0x92345678);
  await invoke(95, [target, 0x80000007]);
  assert.equal(input.get(id), registered);
  assert.equal(registered.flags, 0x92345678);
  assert.equal(owner.state.bindExtra, 0x80000007);
  const peer = world.graphics.get(other);
  peer.makeGraph({ type: 1, width: 30, height: 24 });
  await world.sendNativeEngine(world.nativeTaskID(other), parent, 89, 0, 157);
  input.get(other).active = 1;
  await invoke(106, [target, 0x801fa4cc]);
  assert.equal(registered.active, 0x801fa4cc);
  assert.equal(input.get(other).active, 0);
  await invoke(107, [target], 0x801fa4cc);
  input.get(other).active = 1;
  await invoke(106, [target, 0]);
  await invoke(107, [target], 0);
  assert.equal(input.get(other).active, 1);
  await assert.rejects(() => invoke(107, [0xaef34975]), /Input active word query/);
  for (const [source, result] of [
    [16, 2],
    [0x92345678, 0x92345678],
  ]) {
    input.source = source;
    await invoke(109, [target], result);
  }
  await invoke(109, [0xaef34975], 0);
});

test('2.6.1.63 Draw borrows its bitmap and redraws a signed region or the full surface', async (t) => {
  const widths = new Map([
    [256, 3],
    [259, 13],
    [260, 3],
    [261, 1],
    [262, 2],
    [340, 1],
    [862, 5],
  ]);
  const world = await dataWorld(
    profile,
    Object.fromEntries(
      [...widths].map(([id, words]) => [`main-${id}.kcs`, mainProgram(id, words)]),
    ),
  );
  t.after(() => world.close({ flushFiles: false }));
  world.graphics.createLogicalDevice();
  const id = await world.objects.create({ kind: 15, parent: world.main.id }),
    draw = world.graphics.drawTasks.get(id),
    target = world.nativeTaskID(id),
    call = (slot, args = [], result) =>
      executeMain(world, slot, [target, ...args], undefined, result);
  await assert.rejects(() => call(261), /Draw bitmap query requires an initialized renderer/);
  draw.state.dirty = false;
  await call(340);
  assert.equal(draw.state.dirty, true);
  draw.state.dirty = false;
  await call(862, [-1, 0, 4, 3]);
  assert.equal(draw.state.dirty, true);
  assert.equal(draw.state.renderer, null);

  await call(256, [8, 6]);
  await call(260, [0, 0]);
  await call(262, [0]);
  const images = world.graphics.images,
    bitmap = draw.state.renderer.bitmap,
    source = images.create(3, 2);
  await images.get(source).fill(0, 0, 3, 2, 0xffe2bb11);
  const position = [floatBits(2), floatBits(1)],
    scale = [floatBits(1), floatBits(1)];
  await call(259, [1, source, ...position, 0, 0, 0, ...scale, 255, 1, 0]);
  await images.release(source);
  await call(261, [], bitmap);
  await call(261, [], bitmap);

  const pixels = () => images.get(bitmap).pixels();
  const expected = new Uint8ClampedArray(8 * 6 * 4);
  const paint = (x, y) => expected.set([0xe2, 0xbb, 0x11, 255], ((5 - y) * 8 + x) * 4);
  assert.deepEqual(await pixels(), expected);
  await call(862, [-3, 0, 3, 3]);
  paint(2, 1);
  paint(2, 2);
  assert.deepEqual(await pixels(), expected);
  await call(340);
  for (const [x, y] of [
    [3, 1],
    [3, 2],
    [4, 1],
    [4, 2],
  ])
    paint(x, y);
  assert.deepEqual(await pixels(), expected);
  assert.equal(draw.state.renderer.bitmap, bitmap);
});

test('2.6.1.63 Draw binds Sound activity to retained ANM registers', async (t) => {
  const program = (await imageOwnerFiles()).get('@cat/image/anim.anm');
  const world = await dataWorld(profile, { 'probe.anm': program });
  t.after(() => world.close({ flushFiles: false }));
  const caller = world.main.id,
    id = await world.objects.create({ kind: 15, parent: caller }),
    target = world.nativeTaskID(id),
    draw = world.graphics.drawTasks.get(id),
    key = (world.nativeTaskID(caller) | (3 << 16)) >>> 0,
    marker = 0x82345678,
    deviceEvents = [];
  let level = 0;
  world.sound.audio = {
    channels: new Map(['native:4', 'native:9'].map((name) => [name, {}])),
    setNativeLevelProperty: (name, property) => deviceEvents.push([name, property]),
    nativeLevel: (name) => {
      deviceEvents.push([name]);
      return level;
    },
    stop: () => {},
  };
  const call = async (id, ...args) => {
    const body = await readKCS(
        kcsProgram([
          [37, marker],
          ...args.map((word) => [37, word]),
          [43, id, args.length * 4],
          [59],
        ]),
      ),
      task = { ...world.main, io: null },
      machine = (task.machine = new KCSMachine(
        body,
        {
          native: (id, words, vm) => world.runtime.scheduler.native(task, id, words, vm),
        },
        world.runtime.scheduler.shared,
      ));
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, machine.floor + 4);
    assert.equal(machine.pop(), marker);
  };
  await assert.rejects(() => call(880, target, 3, 0, 1), /initialized renderer/);
  await world.sendEngine(id, caller, 279, 8, 6);
  const bitmap = world.graphics.images.create(2, 2, caller),
    one = floatBits(1),
    fields = [bitmap, 0, 0, 0, 0, 0, 0, 0, 0, one, one, 255, 1, 0, 0];
  await world.sendEngine(id, caller, 282, 3, 0, { payload: new NativeGraphicsPacket(fields) });
  await world.graphics.images.release(bitmap);
  assert.equal(await world.retainedDraw.load(draw, key, 'probe.anm'), true);
  const source = world.renderSources.get(world.retainedDraw.record(draw, key).source),
    registers = source.animation.registers;
  await call(881, target, 3, 7);
  assert.deepEqual(draw.state.registrations, []);
  await call(879, target, 3, 4);
  await call(881, target, 3, 501);
  await call(879, target, 3, 9);
  assert.deepEqual(draw.state.registrations, [{ key, bank: 9, threshold: 501 }]);
  assert.deepEqual(deviceEvents, [
    ['native:4', 1],
    ['native:9', 1],
  ]);
  await call(880, target, 3, 63, 0xf214a7c8);
  await call(880, target, 3, 64, 0xffffffff);
  await call(880, target, 19, 63, 0xffffffff);
  assert.equal(registers[63], 0xf214a7c8);
  for (level of [500, 501, 1000]) {
    await draw.tick();
    assert.equal(registers[0], Number(level >= 501));
    assert.deepEqual(deviceEvents.at(-1), ['native:9']);
  }
  await call(879, target, 3, 0xffffffff);
  assert.deepEqual(draw.state.registrations, []);
  assert.equal(registers[0], 0);
  assert.deepEqual(deviceEvents.at(-1), ['native:9', 0]);
});

test('2.6.1.63 Main stubs preserve their original three result behaviors', async () => {
  const table = nativeABI(profile).tables.main.entries;
  const noops = table.filter((entry) => entry.status === 'reserved');
  const zeros = table.filter((entry) => entry.status === 'constant-zero');
  const unwritten = [140, 142, 549].map((id) => table[id]);
  assert.equal(noops.length, 80);
  assert.equal(zeros.length, 19);
  const cases = [...noops, ...zeros, ...unwritten];
  const markerAddress = (index) => 512 + index * 4;
  const resultAddress = (index) => 1024 + index * 4;
  const marker = 0x82345678;

  // The fixed scripts exercise ignored calls with zero to seven argument words.
  for (let words = 0; words <= 7; words++) {
    const instructions = cases.flatMap((entry, index) => [
      [37, marker],
      ...Array.from({ length: words }, (_, word) => [37, 0xffa0b000 + word]),
      [43, entry.id, words * 4],
      ...(entry.status === 'reserved' ? [] : [[38, resultAddress(index)]]),
      [38, markerAddress(index)],
    ]);
    const diagnostics = [];
    const { runtime, task, machine } = await run([...instructions, [59]], (event) =>
      diagnostics.push(event),
    );
    machine.bytes(1024, cases.length * 4).fill(0xa5);
    machine.store(508, 0x3b46d32d);
    const stack = machine.sp;
    await runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, stack);
    assert.equal(machine.load(508), 0x3b46d32d);
    for (const [index, entry] of cases.entries()) {
      const noResult = entry.status === 'reserved';
      const zero = entry.status === 'constant-zero';
      assert.equal(runtime.calls.get(`main:${entry.id}`), 1);
      assert.equal(entry.signature.argumentWords, null);
      assert.equal(entry.signature.parameters.kind, 'ignored');
      assert.equal(entry.signature.resultWritten, zero);
      assert.deepEqual(entry.controlCodes, noResult ? [2] : [1]);
      assert.equal(machine.load(markerAddress(index)), marker);
      assert.equal(
        machine.load(resultAddress(index)),
        noResult ? 0xa5a5a5a5 : zero ? 0 : NATIVE_RESULT_SENTINEL,
      );
    }
    assert.equal(diagnostics.length, 3);
    assert.ok(diagnostics.every((event) => event.type === 'native-result-sentinel'));
  }
});

test('2.6.1.63 GCALL still rejects the adjacent unreviewed native slot', async () => {
  const args = [17, 18, 19, 20, 21, 22],
    { runtime, task } = await run([...args.map((arg) => [37, arg]), [43, 599, 24], [59]]);
  await assert.rejects(
    () => runtime.scheduler.execute(task),
    (error) => {
      assert.ok(error instanceof UnsupportedKCSNative);
      assert.equal(error.details.profile, profile);
      assert.equal(error.details.table, 'main');
      assert.equal(error.details.id, 599);
      assert.deepEqual(error.details.args, args);
      return true;
    },
  );
});

test('2.6.1.63 Main 6 returns the original DWORD through GCALL', async () => {
  const words = [0, 0x80000000, 0xffffffff, NATIVE_RESULT_SENTINEL, 0x7fc00001];
  const instructions = words.flatMap((word, index) => [
    [37, word],
    [43, 6, 4],
    [38, 256 + index * 4],
  ]);
  const { runtime, task, machine } = await run([...instructions, [59]]);
  await runtime.scheduler.execute(task);
  assert.deepEqual(
    words.map((_, index) => machine.load(256 + index * 4)),
    words,
  );
  assert.equal(machine.sp, machine.floor);
});

test('2.6.1.63 KCS shortens live CP932 bytes at its original write boundary', async () => {
  const cases = [
    [23, 3, 2, [0xfa, 0x40, 0, 0, 0x43, 0]],
    [23, 2, 0, [0, 0, 0x41, 0x42, 0x43, 0]],
    [23, 4, 3, [0xfa, 0x40, 0x41, 0, 0, 0]],
    [24, 1, 2, [0xfa, 0x40, 0, 0, 0x43, 0]],
    [24, 2, 3, [0xfa, 0x40, 0x41, 0, 0, 0]],
    [24, 0xffffffff, 5, [0xfa, 0x40, 0x41, 0x42, 0x43, 0]],
  ];
  const instructions = cases.flatMap(([id, limit], index) => [
    [37, 256 + index * 8],
    [37, limit],
    [43, id, 8],
    [38, 512 + index * 4],
  ]);
  const { runtime, task, machine } = await run([...instructions, [59]]);
  cases.forEach((_, index) =>
    machine.bytes(256 + index * 8, 8).set([0xfa, 0x40, 0x41, 0x42, 0x43, 0, 0xa7, 0xa7]),
  );
  await runtime.scheduler.execute(task);
  for (const [index, [, , kept, bytes]] of cases.entries()) {
    assert.equal(machine.load(512 + index * 4), kept);
    assert.deepEqual([...machine.bytes(256 + index * 8, 6)], bytes);
    assert.equal(machine.load(256 + index * 8 + 6, 1), kept === 5 ? 0 : 0xa7);
    assert.equal(machine.load(256 + index * 8 + 7, 1), 0xa7);
  }
});

test('2.6.1.63 KCS transfers only the selected live Script memory span', async () => {
  const world = await dataWorld(profile, {
    'target.kcs': kcsProgram([[59]]),
    'main-72.kcs': mainProgram(72, 4),
    'main-73.kcs': mainProgram(73, 4),
    'main-76.kcs': mainProgram(76, 0),
  });
  try {
    const peer = await world.spawnScript('target.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      id = world.nativeTaskID(peer.id),
      source = Uint8Array.of(0x41, 0xf2, 0x29, 0x80);
    peer.machine.bytes(254, 8).fill(0x95);
    await executeMain(world, 73, [id, 256, 4, 384], (machine) => machine.bytes(384, 4).set(source));
    assert.deepEqual([...peer.machine.bytes(254, 8)], [0x95, 0x95, ...source, 0x95, 0x95]);
    const copied = await executeMain(world, 72, [id, 256, 4, 512]);
    assert.deepEqual(copied.bytes(512, 4), source);
    await executeMain(world, 76, [], undefined, world.nativeTaskID(world.main.id));
  } finally {
    await world.close();
  }
});

test('2.6.1.63 FES declares only its original type names and indexes', async () => {
  const source = new TextEncoder().encode(
    '#DEFINE\nview validView\nSTRING validString\nPARTICLE validParticle\n' +
      'CHTABLE3 excess1\nSTRTABLE excess2\nFILELIST excess3\nEFKPLANE excess4\n' +
      'STRING8 excess5\nLOGSTRING8 excess6\n#START\nnext WAIT\n#WAIT\n',
  );
  const world = await dataWorld(profile, { 'types.fes': source });
  try {
    const id = await world.objects.create({ kind: 34, parent: world.main.id });
    const task = world.objects.objects.get(id).implementation;
    await world.sendEngine(id, world.main.id, 331, 0, world.main.context.variableBank);
    await task.loadSource('types');
    const root = task.player.root;
    assert.deepEqual(
      [...root.byKey.values()].map(({ baseName, type }) => [baseName, type]),
      [
        ['validView', 'VIEW'],
        ['validString', 'STRING'],
        ['validParticle', 'PARTICLE'],
      ],
    );
    const memory = world.main.machine;
    memory.writeString('dynamicString', 128);
    memory.store(160, 2);
    await world.sendEngine(id, world.main.id, 338, 128, 20);
    assert.equal(root.byKey.get('dynamicString[0]').nativeType, 21);
    assert.equal(root.byKey.get('dynamicString[1]').nativeType, 21);

    memory.writeString('dynamicM2', 128);
    memory.store(160, 1);
    await world.sendEngine(id, world.main.id, 338, 128, 32);
    assert.equal(root.byKey.get('dynamicM2[0]').nativeType, 33);
    await assert.rejects(
      () => world.sendEngine(id, world.main.id, 338, 128, 33),
      /Unknown FES object factory index 33/,
    );
    assert.equal(root.byKey.size, 6);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS resolves authored FES labels and binds the full save-object word', async () => {
  const world = await dataWorld(profile, {
    'labels.fes': new TextEncoder().encode('#START\nnext WAIT\n#WAIT\n#FOUND\n'),
    'main-450.kcs': mainProgram(450, 2),
    'main-451.kcs': mainProgram(451, 2),
  });
  try {
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      task = world.objects.objects.get(id).implementation,
      target = world.nativeTaskID(id),
      jump = (text, found) =>
        executeMain(world, 450, [target, 128], (machine) => machine.writeString(text, 128), found);
    await world.sendEngine(id, world.main.id, 331, 0, world.main.context.variableBank);
    await task.loadSource('labels');
    const before = task.player.root.label;
    await jump('ABSENT', 0);
    assert.equal(task.player.root.label, before);
    await jump('FOUND', 1);
    assert.equal(task.player.root.label, 'FOUND');
    await executeMain(world, 451, [target, 0xf1310050]);
    assert.equal(task.player.saveObject, 0xf1310050);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 control calls retain sender-keyed Draw entries and a full task user DWORD', async () => {
  const world = await defaultFESWorld(profile, { 'main-694.kcs': mainProgram(694, 2) });
  try {
    const owner = world.main.id,
      id = await world.objects.create({ kind: 15, parent: owner }),
      target = world.nativeTaskID(id),
      draw = world.graphics.drawTasks.get(id),
      call = (id, argv) => world.runtime.native('main', id, argv, world.main.machine, world.main);
    await executeMain(world, 694, [target, 0xff76013d]);
    assert.equal(world.objects.objects.get(id).userValue, 0xff76013d);

    await world.sendEngine(id, owner, 279, 16, 12);
    await world.sendEngine(id, owner, 283);
    const image = world.graphics.images.create(2, 2, owner),
      one = floatBits(1),
      key = (world.nativeTaskID(owner) | (6 << 16)) >>> 0;
    await call(257, [target, 6, image, one, one, 0, 0, 0, one, one, 255, 1, 0]);
    assert.equal(draw.entry(key).visible, true);
    assert.deepEqual(await call(263, [target, 6, 0]), { control: 2 });
    assert.equal(draw.entry(key).visible, false);
    assert.deepEqual(await call(263, [target, 6, 2]), { control: 2 });
    assert.equal(draw.entry(key).visible, true);
    draw.state.renderer.dirtyRects.length = 0;
    assert.deepEqual(await call(464, [target, 7]), { control: 2 });
    assert.equal(draw.state.renderer.dirtyRects.length, 0);
    assert.deepEqual(await call(464, [target, 6]), { control: 2 });
    assert.ok(draw.state.renderer.dirtyRects.length > 0);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS configures, appends and clears the original narrow Text owner', async () => {
  const world = await defaultFESWorld(profile, {
    'main-123.kcs': mainProgram(123, 3),
    'main-124.kcs': mainProgram(124, 2),
    'main-125.kcs': mainProgram(125, 1),
    'main-418.kcs': mainProgram(418, 4),
    'main-557.kcs': mainProgram(557, 2),
  });
  try {
    const id = await world.objects.create({ kind: 8, parent: world.root });
    const target = world.nativeTaskID(id),
      owner = world.legacyText.tasks.get(id),
      text = owner.text,
      append = (bytes) =>
        executeMain(world, 124, [target, 512], (machine) =>
          machine.writeStringBytes(Uint8Array.from(bytes), 512),
        ),
      configureText = (enabled) => (machine) => {
        for (const [index, word] of [
          [2, 96],
          [3, 48],
          [5, 1],
          [6, 12],
          [15, enabled ? 32 : 0],
          [16, 0xffffffff],
        ]) {
          machine.store(256 + index * 4, word);
        }
        machine.writeStringBytes(Uint8Array.of(0xb1, 0x21, 0xfa, 0x40), 512);
        machine.writeString('a'.repeat(254) + 'あ', 768);
      };
    const source = [0x96, 0x7b, 0x95, 0xb6, 0x25, 0x25, 0xfa, 0x40];
    await append(source);
    assert.equal(owner.bitmap, 0);
    assert.equal(text.rows.length, 0);

    await executeMain(world, 418, [target, 256, 512, 768], configureText(false));
    assert.equal(owner.bitmap, 0);
    await executeMain(world, 418, [target, 256, 512, 768], configureText(true));
    assert.equal(owner.owner.configurationBytes, 1128);
    assert.deepEqual([...text.profile(201, 202)], [0xffb1, 0x21, 0xfa40]);
    assert.deepEqual([...text.profile(330, 331)], [0x61, 0x82a0]);
    assert.equal(text.w(330), 255);
    assert.equal(text.w(458) & 0xffff, 0x82a0);
    await executeMain(world, 557, [target, 0xff123456]);
    assert.equal(text.w(470) >>> 0, 0xff123456);

    await append(source);
    assert.deepEqual(
      text.rows.map((row) => row[0]),
      [0x967b, 0x95b6, 0x25, 0xfa40],
    );
    const vram = world.graphics.images.get(world.graphics.vramHandle);
    assert.ok((await vram.pixels()).some((byte) => byte !== 0));
    await executeMain(world, 125, [target]);
    assert.deepEqual(text.rows, []);
    assert.ok((await vram.pixels()).every((byte) => byte === 0));

    await executeMain(world, 123, [target, 256, 512], configureText(true));
    assert.deepEqual([...text.profile(201, 202)], [0xffb1, 0x21, 0xfa40]);
    assert.equal(text.w(330), 0);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS sleep masks active FES outputs on each change of the raw word', async () => {
  const source = new TextEncoder().encode(
    '#DEFINE\nBUTTON button\nCIMAGE red\nPLANE panel\n' +
      '#OBJECT POS SIZE ENABLE DISP PRI\nbutton 0,0 2,2 1 1 100\n' +
      '#OBJECT SIZE COLOR DISP PRI\nred 2,2 4294901760 1 60000\n' +
      '#OBJECT SIZE DISP\npanel 2,2 1\n' +
      '#START\nnext WAIT\n#WAIT\n' +
      '#_FES_SLEEP_\n$1=7\nbreak\n#_FES_WAKE_\n$1=9\nbreak\n',
  );
  const files = { 'screen.fes': source, 'main-647.kcs': mainProgram(647, 2) };
  const world = await defaultFESWorld(profile, files);
  let second;
  try {
    const { id, task, surface, instance } = await loadDefaultFES(world);
    await task.tick();
    const target = world.nativeTaskID(id),
      panel = instance.byKey.get('panel'),
      buttonID = task.input.state.buttons[0][1],
      sleep = (word) => executeMain(world, 647, [target, word]),
      pixel = async (current) => [...(await drawPixels(current, surface)).subarray(0, 4)];
    assert.deepEqual(await pixel(world), [255, 0, 0, 255]);

    await sleep(1);
    assert.equal(task.sleepValue, 1);
    assert.equal(world.inputFor(id).get(buttonID).enabled, 0);
    assert.equal(world.graphics.get(panel.nativeTaskID).state.shown, false);
    assert.deepEqual(await pixel(world), [0, 0, 0, 0]);

    await world.sendEngine(panel.nativeTaskID, id, 47, 0, 1);
    await sleep(1);
    assert.equal(world.graphics.get(panel.nativeTaskID).state.shown, true);
    await sleep(0xffffffff);
    assert.equal(task.sleepValue, 0xffffffff);
    assert.equal(world.graphics.get(panel.nativeTaskID).state.shown, false);
    assert.equal(task.player.globals[1], 0);

    second = await defaultFESWorld(profile, files, { initialize: false });
    await second.restore(structuredClone(world.snapshot()));
    const restored = second.objects.objects.get(id).implementation;
    assert.equal(restored.sleepValue, 0xffffffff);
    assert.equal(restored.input.state.sleeping, true);
    await executeMain(second, 647, [target, 0]);
    assert.equal(restored.sleepValue, 0);
    assert.equal(restored.input.state.sleeping, false);
    assert.equal(restored.player.globals[1], 0);
    assert.equal(second.inputFor(id).get(buttonID).enabled, 1);
    assert.equal(second.graphics.get(panel.nativeTaskID).state.shown, true);
    assert.deepEqual(await pixel(second), [255, 0, 0, 255]);
  } finally {
    await second?.close();
    await world.close();
  }
});

test('2.6.1.63 KCS stores its FES private bank as one original CSS record', async () => {
  const world = await dataWorld(profile, {
    'bank.fes': new TextEncoder().encode('#START\nnext WAIT\n#WAIT\n'),
    'main-649.kcs': kcsProgram([
      [37, 0x82345678],
      [37, [0x13, 88]],
      [37, 0],
      [37, 0xfedcba98],
      [43, 645, 12],
      [37, [0x13, 88]],
      [37, 511],
      [37, 0x01234567],
      [43, 645, 12],
      [37, [0x13, 80]],
      [37, [0x13, 84]],
      [37, [0x13, 88]],
      [43, 649, 12],
      [59],
    ]),
  });
  try {
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      task = world.objects.objects.get(id).implementation,
      target = world.nativeTaskID(id),
      file = new NativeGlobalFile(),
      handle = world.runtime.handles.add('global-file', file);
    world.runtime.variableBank(world.main).initialize(64);
    await world.sendEngine(id, world.main.id, 331, 0, world.main.context.variableBank);
    await task.loadSource('bank');
    await executeMain(world, 649, [0, 0x63, target], undefined, 0);
    assert.equal(file.read(0x63), null);
    await executeMain(world, 649, [handle, 0x63, target], undefined, 1);
    const persisted = await NativeGlobalFile.fromFile(await file.file());
    const bytes = persisted.read(0x63);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(bytes.length, 2048);
    assert.equal(view.getUint32(0, true), 0xfedcba98);
    assert.equal(view.getUint32(2044, true), 0x01234567);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 FES pos reads a trailing integer after the original current word', async () => {
  const source = new TextEncoder().encode(
    '#DEFINE\nBUTTON sample\n#OBJECT POS SIZE\nsample 0,0 2,2\n' +
      '#START\nsample pos @+90 @1\nnext WAIT\n#WAIT\nbreak\n',
  );
  const world = await defaultFESWorld(profile, { 'screen.fes': source });
  try {
    const { task, instance } = await loadDefaultFES(world);
    await task.tick();
    const sample = instance.byKey.get('sample');
    assert.deepEqual([sample.x, sample.y], [90, 1]);
    instance.nativeContext.current = 53;
    for (const [operand, value] of [
      ['@', 53],
      ['@+90', 143],
      ['@12', 12],
      ['@ 1', 1],
      ['@0x12', 18],
    ])
      assert.equal(instance.operandValue(new TextEncoder().encode(operand)), value);
    assert.throws(() => instance.operandValue(new TextEncoder().encode('1 2')), /Unexpected/);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 FES SCROLL sends its original packet and owns its actual children', async () => {
  const { 'scroll.hg2': skin } = await controlFiles(new Uint8Array());
  const source = new TextEncoder().encode(
    '#DEFINE\nSCROLL sample\n#OBJECT FILE POS VRAM PRI PRI_P TYPE DISP ENABLE\n' +
      'sample scroll 4,4 0,0 102 1003 0 1 1\n' +
      '#START\nsample page 0 100 20\nsample pos 10 1\nnext WAIT\n#WAIT\nbreak\n' +
      '#sample.SCRL_P\n$7=@\nbreak\n',
  );
  const world = await defaultFESWorld(profile, { 'scroll.hg2': skin, 'screen.fes': source });
  const outgoing = [];
  const dispatch = world.sendNativeEngine.bind(world);
  world.sendNativeEngine = (target, sender, message, w, l, context) => {
    if (message >= 341 && message <= 346)
      outgoing.push({
        target,
        sender,
        message,
        w,
        l,
        flags: context.flags,
        bytes: context.payload?.data.slice(),
      });
    return dispatch(target, sender, message, w, l, context);
  };
  try {
    const { id, task, instance, surface } = await loadDefaultFES(world);
    await task.tick();
    const object = instance.byKey.get('sample'),
      control = world.objects.objects.get(object.nativeTaskID).implementation,
      target = world.nativeTaskID(control.record.id),
      state = control.model.state;
    assert.ok(
      outgoing.every(
        ({ target: actual, sender, flags }) => actual === target && sender === id && flags === 1,
      ),
    );
    const packet = outgoing.find(({ message }) => message === 341).bytes,
      packetView = new DataView(packet.buffer),
      words = (view, offsets) => offsets.map((offset) => view.getInt32(offset, true));
    assert.equal(packet.length, 292);
    assert.deepEqual(words(packetView, [0, 4, 268, 272, 276, 280, 284, 288]), [
      0,
      world.nativeTaskID(surface),
      0,
      0,
      4,
      4,
      122,
      1003,
    ]);
    assert.equal(
      new TextDecoder().decode(packet.subarray(8, packet.indexOf(0, 8))),
      '@cat/image/scroll',
    );
    const pending = outgoing.slice(outgoing.findIndex(({ message }) => message === 344));
    assert.deepEqual(
      pending.slice(0, 5).map(({ message }) => message),
      [344, 345, 342, 343, 346],
    );
    assert.deepEqual(words(new DataView(pending[0].bytes.buffer), [0, 4, 8]), [0, 100, 20]);
    assert.deepEqual([pending[1].w, pending[1].l], [0, 10]);
    assert.deepEqual(
      [state.direction, state.minimum, state.maximum, state.pageSize, state.value],
      [0, 0, 100, 20, 10],
    );
    assert.equal(control.record.parent, id);
    assert.equal(control.resource.planes.length, 5);
    assert.equal(Object.keys(control.resource.areas).length, 5);
    assert.ok((await drawPixels(world, surface)).some((byte) => byte !== 0));

    const send = (message, w, l, context = {}) => dispatch(target, id, message, w, l, context);
    assert.equal(await send(342, 0, 0), NATIVE_UNWRITTEN_WORD);
    assert.equal(state.shown, false);
    assert.ok(
      Object.values(control.resource.areas).every((area) => !world.inputFor(id).get(area).enabled),
    );
    assert.equal(await send(343, 0, 0x80002000), NATIVE_UNWRITTEN_WORD);
    assert.ok(
      Object.values(control.resource.areas).every(
        (area) => world.inputFor(id).get(area).enabled === 0x80002000,
      ),
    );
    const unreviewed = {};
    assert.equal(await send(355, 0, 0, unreviewed), NATIVE_UNWRITTEN_WORD);
    assert.equal(unreviewed.nativeUnhandled, true);
    assert.equal(state.enabled, true);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 FES SLIDER drives its raw packet, Input flags and Draw skin', async (t) => {
  const { 'area.hg2': area, 'controls.hg2': skin } = await controlFiles(new Uint8Array());
  const source = new TextEncoder().encode(
    '#DEFINE\nPLANE panel\nSLIDER sample\n#OBJECT SIZE VRAM DISP\n' +
      'panel 128,96 2,3 1\n#OBJECT FILE PL POS2 PRI DISP ENABLE\n' +
      'sample controls panel[0] area:7 82 1 1\n' +
      '#START\nsample page 0 100\nsample pos 25\nsample blend 129\nnext WAIT\n#WAIT\nbreak\n',
  );
  const world = await defaultFESWorld(profile, {
    'area.hg2': area,
    'controls.hg2': skin,
    'screen.fes': source,
  });
  t.after(() => world.close());
  const outgoing = [],
    dispatch = world.sendNativeEngine.bind(world);
  world.sendNativeEngine = (target, sender, message, w, l, context) => {
    if (message >= 347 && message <= 355)
      outgoing.push({
        target,
        sender,
        message,
        w,
        l,
        flags: context.flags,
        bytes: context.payload?.data.slice(),
      });
    return dispatch(target, sender, message, w, l, context);
  };
  const { id, task, instance, surface } = await loadDefaultFES(world);
  await task.tick();
  const object = instance.byKey.get('sample'),
    control = world.objects.objects.get(object.nativeTaskID).implementation,
    target = world.nativeTaskID(object.nativeTaskID),
    state = control.model.state,
    input = world.inputFor(id);
  assert.ok(
    outgoing.every(
      (message) => message.target === target && message.sender === id && message.flags === 1,
    ),
  );
  const [load] = outgoing,
    loadView = new DataView(load.bytes.buffer),
    range = new DataView(outgoing.find(({ message }) => message === 350).bytes.buffer);
  assert.equal(load.message, 347);
  assert.equal(load.bytes.length, 292);
  assert.equal(loadView.getUint32(0, true), world.nativeTaskID(surface));
  const filename = new TextEncoder().encode('@cat/image/controls\0');
  assert.deepEqual(load.bytes.slice(4, 4 + filename.length), filename);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => loadView.getInt32(264 + i * 4, true)),
    [102, 16, 12, 88, 24, 2, 3],
  );
  assert.deepEqual(
    outgoing.slice(0, 7).map(({ message }) => message),
    [347, 352, 350, 351, 353, 349, 348],
  );
  assert.deepEqual([range.getInt32(0, true), range.getInt32(4, true)], [0, 100]);
  assert.deepEqual([state.direction, state.value, state.alpha], [0, 25, 129]);
  assert.equal(control.record.parent, id);
  const { thumb, track } = control.resource.areas;
  assert.ok(input.get(thumb) && input.get(track));
  assert.ok((await drawPixels(world, surface)).some((byte) => byte !== 0));

  const send = (message, w = 0, l = 0, context = {}) =>
    dispatch(target, id, message, w, l, context);
  assert.equal(await send(349), NATIVE_UNWRITTEN_WORD);
  assert.equal(state.state, 1);
  assert.equal(input.get(thumb).enabled, 0);
  assert.equal(input.get(track).enabled, 0);
  assert.equal(await send(349, 0, 0x80002000), NATIVE_UNWRITTEN_WORD);
  assert.equal(state.state, 0);
  assert.equal(input.get(thumb).enabled, 0x80002000);
  assert.equal(input.get(track).enabled, 0x80002000);
  assert.equal(await send(352), 0);
  assert.equal(await send(354, 0, 2), NATIVE_UNWRITTEN_WORD);
  assert.equal(await send(355), NATIVE_UNWRITTEN_WORD);
  assert.equal(state.skinTable[0], 2);
  assert.equal(control.resource.current, control.resource.frames.find(([frame]) => frame === 2)[1]);
  const touches = [],
    inputMessage = input.message.bind(input);
  input.message = (message, ...args) => {
    if (message === 155) touches.push(message);
    return inputMessage(message, ...args);
  };
  assert.equal(await send(62, world.nativeTaskID(thumb)), NATIVE_UNWRITTEN_WORD);
  assert.deepEqual(touches, [155]);
  const [, top, right, bottom] = input.get(track).bounds,
    y = (top + bottom) >> 1;
  input.pointer(right - 4, y, 1);
  await world.tick();
  input.key(0, true, 2, 1);
  await world.tick();
  assert.equal(state.dragging, true);
  const draggedValue = state.value;
  assert.ok(draggedValue > 25);
  input.pointer(right - 23, y, 1);
  await world.tick();
  assert.ok(state.value < draggedValue);
  input.key(0, false, 2, 1);
  await world.tick();
  assert.equal(state.dragging, false);
  const unreviewed = {};
  assert.equal(await send(359, 0, 0, unreviewed), NATIVE_UNWRITTEN_WORD);
  assert.equal(unreviewed.nativeUnhandled, true);
});

test('2.6.1.63 FES SCROLL2 updates its vertical Draw skin and shares its range with Input', async (t) => {
  const { 'area.hg2': area, 'controls.hg2': skin } = await controlFiles(new Uint8Array());
  const source = new TextEncoder().encode(
    '#DEFINE\nPLANE panel\nSCROLL2 sample\n#OBJECT SIZE VRAM DISP\n' +
      'panel 128,96 2,3 1\n#OBJECT FILE PL POS2 PRI DISP ENABLE\n' +
      'sample controls panel[0] area:8 81 1 1\n' +
      '#START\nsample page 0 100 20\nsample pos 30\nsample blend 129\nnext WAIT\n#WAIT\nbreak\n' +
      '#sample.SCRL_P\n\\7=\\7+1\nbreak\n',
  );
  const world = await defaultFESWorld(profile, {
    'area.hg2': area,
    'controls.hg2': skin,
    'screen.fes': source,
  });
  t.after(() => world.close());
  const outgoing = [],
    dispatch = world.sendNativeEngine.bind(world);
  world.sendNativeEngine = (target, sender, message, w, l, context) => {
    if (message >= 356 && message <= 364)
      outgoing.push({
        target,
        sender,
        message,
        w,
        l,
        flags: context.flags,
        bytes: context.payload?.data.slice(),
      });
    return dispatch(target, sender, message, w, l, context);
  };
  const { id, task, instance, surface } = await loadDefaultFES(world);
  await task.tick();
  const object = instance.byKey.get('sample'),
    control = world.objects.objects.get(object.nativeTaskID).implementation,
    target = world.nativeTaskID(object.nativeTaskID),
    state = control.model.state,
    input = world.inputFor(id),
    { thumb, track } = control.resource.areas;
  assert.ok(
    outgoing.every(
      (message) => message.target === target && message.sender === id && message.flags === 1,
    ),
  );
  const [load] = outgoing,
    packet = new DataView(load.bytes.buffer),
    range = new DataView(outgoing.find(({ message }) => message === 358).bytes.buffer);
  assert.equal(load.message, 356);
  assert.equal(load.bytes.length, 292);
  assert.equal(packet.getUint32(0, true), world.nativeTaskID(surface));
  assert.equal(
    new TextDecoder().decode(load.bytes.subarray(4, load.bytes.indexOf(0, 4))),
    '@cat/image/controls',
  );
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => packet.getInt32(264 + i * 4, true)),
    [101, 104, 12, 116, 76, 2, 3],
  );
  assert.deepEqual(
    outgoing.slice(0, 7).map(({ message }) => message),
    [356, 360, 358, 359, 362, 357, 361],
  );
  assert.deepEqual(
    [0, 4, 8].map((offset) => range.getInt32(offset, true)),
    [0, 100, 20],
  );
  assert.deepEqual([state.direction, state.value, state.alpha, state.pageSize], [1, 30, 129, 20]);
  assert.equal(control.record.parent, id);
  assert.ok(input.get(thumb) && input.get(track));
  assert.ok((await drawPixels(world, surface)).some((byte) => byte !== 0));
  const send = (message, w = 0, l = 0, context = {}) =>
    dispatch(target, id, message, w, l, context);
  assert.equal(await send(360), 1);
  assert.equal(await send(357, 0, 0x80002000), NATIVE_UNWRITTEN_WORD);
  assert.equal(input.get(thumb).enabled, 0x80002000);
  assert.equal(input.get(track).enabled, 0x80002000);
  assert.equal(await send(359, 1, 120), NATIVE_UNWRITTEN_WORD);
  assert.equal(state.value, 80);
  assert.equal(instance.scrollPosition, object.handle);
  assert.equal(object.value, 80);
  assert.equal(instance.local(7), 1);
  assert.equal(await send(363, 0, 2), NATIVE_UNWRITTEN_WORD);
  assert.equal(await send(364), NATIVE_UNWRITTEN_WORD);
  assert.equal(state.skinTable[0], 2);
  const unreviewed = {};
  assert.equal(await send(365, 0, 0, unreviewed), NATIVE_UNWRITTEN_WORD);
  assert.equal(unreviewed.nativeUnhandled, true);
});

test('2.6.1.63 KCS preserves nested CSS, narrow strings, HG-2 thumbnails and log records', async () => {
  const world = await defaultFESWorld(
    profile,
    Object.fromEntries(
      [
        [241, 3],
        [242, 3],
        [243, 2],
        [252, 2],
        [253, 2],
        [850, 3],
        [851, 3],
        [852, 0],
      ].map(([id, width]) => [`main-${id}.kcs`, mainProgram(id, width)]),
    ),
  );
  try {
    world.configuration.setField('scene.staticLog', 0x7fedcba9);
    await executeMain(world, 852, [], undefined, 0x7fedcba9);
    const handles = world.runtime.handles,
      file = new NativeGlobalFile(9),
      nested = new NativeGlobalFile(11),
      handle = handles.add('global-file', file),
      inner = handles.add('global-file', nested);
    nested.write(5, Uint8Array.of(0xf1, 0x60));
    await executeMain(world, 242, [handle, 12, 0], undefined, 0);
    await executeMain(world, 242, [handle, 12, inner], undefined, 1);
    assert.deepEqual(file.read(12), nested.raw());
    await executeMain(world, 252, [handle, 12], undefined, (result) => {
      const copy = handles.get(result, 'global-file');
      assert.notEqual(copy, nested);
      assert.deepEqual(copy.read(5), nested.read(5));
    });
    await executeMain(
      world,
      243,
      [handle, 13],
      (_machine, task) => {
        world.runtime.stringBank(task).set(4, '本文');
      },
      1,
    );
    let restored;
    await executeMain(
      world,
      253,
      [handle, 13],
      (_machine, task) => {
        restored = world.runtime.stringBank(task);
        restored.set(4, '別');
      },
      1,
    );
    assert.equal(restored.get(4), '本文');

    const image = world.graphics.images.create(2, 2, world.main.id);
    await world.graphics.images.get(image).fill(0, 0, 2, 2, 0xffa02030);
    await executeMain(world, 241, [handle, 14, image], undefined, 1);
    const hg = await openImage(file.read(14)),
      frame = hg.frame(0);
    await hg.decode(frame);
    assert.deepEqual([...frame.rgba.slice(0, 4)], [0xa0, 0x20, 0x30, 0xff]);

    const sourceLog = world.displayLogs.create(world.main.id),
      targetLog = world.displayLogs.create(world.main.id),
      model = world.displayLogs.get(sourceLog);
    model.blockBase = 9;
    model.rowBase = 13;
    model.blocks.push([0, 1, 2, 3, 4, 5, 0xbad0]);
    await executeMain(world, 850, [handle, 15, sourceLog], undefined, 1);
    const binary = file.read(15),
      view = new DataView(binary.buffer, binary.byteOffset);
    assert.equal(view.getUint32(8, true) - view.getUint32(4, true), 28);
    await executeMain(world, 851, [handle, 15, targetLog], undefined, 1);
    const target = world.displayLogs.get(targetLog);
    assert.deepEqual(target.blocks[0], [0, 1, 2, 3, 4, 5, 0xffffffff]);
    assert.equal(target.blockBase, 9);
    assert.equal(target.rowBase, 13);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 dictionary aliases and F32/word packing use the same live KCS owner', async () => {
  const entryWidths = [0, 1, 3, 2, 1, 1, 2, 2, 3];
  const entries = [
    [515, 0],
    [516, 1],
    [517, 3],
    [518, 2],
    [675, 0],
    [676, 1],
    [833, 1],
    [834, 1],
    ...[885, 894].flatMap((start) => entryWidths.map((width, index) => [start + index, width])),
  ];
  const world = await dataWorld(
    profile,
    Object.fromEntries(entries.map(([id, width]) => [`main-${id}.kcs`, mainProgram(id, width)])),
  );
  const key = (name) => (machine) => machine.writeString(name, 160);
  const call = (id, args, setup, result) => executeMain(world, id, args, setup, result);
  const create = async (id, args = []) => {
    let result;
    await call(id, args, undefined, (word) => (result = word));
    assert.notEqual(result, 0);
    return result;
  };
  try {
    const raw = 0xff812345,
      quiet = 0xffc12345,
      heap = world.runtime.imageDataBuffers.process;
    for (const start of [885, 894]) {
      const expected = start === 885 ? quiet : raw,
        first = await create(start),
        restored = await create(675),
        source = await create(515);
      await call(start + 5, [0], undefined, 0);
      await call(start + 5, [first], undefined, 4);
      await call(start + 2, [first, 160, 7], key('A'));
      await call(start + 2, [first, 160, raw], key('A'));
      await call(start + 3, [first, 160], key('A'), expected);
      await call(start + 3, [first, 160], key('Absent'), 0);
      await call(517, [source, 160, raw], key('A'));
      await call(517, [source, 160, 0x80000000], key('猫'));
      await call(518, [source, 160], key('A'), raw);
      await call(start + 5, [source], undefined, 20);

      const pointer = await create(833, [20]);
      heap.write(pointer, new Uint8Array(20).fill(0xa7));
      await call(start + 6, [source, pointer]);
      assert.deepEqual(
        [...heap.read(pointer, 20)],
        [
          2,
          0,
          0,
          0,
          65,
          0,
          0xa7,
          0xa7,
          0x45,
          0x23,
          (expected >>> 16) & 255,
          255,
          0x94,
          0x4c,
          0,
          0xa7,
          0,
          0,
          0,
          0x80,
        ],
      );
      // Force a signaling NaN in the caller's raw heap to test the importer independently.
      heap.store(pointer + 8, raw);
      await call(517, [restored, 160, 5], key('猫'));
      await call(start + 7, [restored, pointer]);
      await call(start + 3, [restored, 160], key('A'), expected);
      await call(start + 3, [restored, 160], key('猫'), 5);
      const machine = await call(
        start + 8,
        [restored, 1, 192],
        (m) => m.bytes(192, 6).fill(0xa7),
        1,
      );
      assert.deepEqual([...machine.bytes(192, 6)], [0x94, 0x4c, 0, 0xa7, 0xa7, 0xa7]);
      const miss = await call(start + 8, [restored, -1, 192], (m) => m.bytes(192, 6).fill(0xa7), 0);
      assert.deepEqual([...miss.bytes(192, 6)], new Array(6).fill(0xa7));

      await call(start + 4, [first]);
      await call(start + 5, [first], undefined, 4);
      await call(676, [first]);
      await call(start + 1, [restored]);
      await call(516, [source]);
      await call(834, [pointer]);
      for (const handle of [first, source, restored])
        assert.throws(() => world.runtime.handles.get(handle, 'dictionary'), /released/);
    }
    assert.equal(heap.allocations.size, 0);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 Main and Motion return the initialized CRT power words', async (t) => {
  const world = await dataWorld(profile, {
    'main-61.kcs': mainProgram(61, 2),
    'main-461.kcs': mainProgram(461, 1),
  });
  t.after(() => world.close({ flushFiles: false }));
  for (const [argv, expected] of [
    [[0x43feac31, 0xc0507131], 0x30d1b5a5],
    [[0x7f801234, 0x80000000], 0x7fc01234],
    [[0xbf800000, 0x7f800000], 0x3f800000],
  ]) {
    await executeMain(world, 61, argv, undefined, expected);
    const motion = new MotionInstance(
      await readKCS(
        kcsProgram([[37, 0x82345678], [37, argv[0]], [37, argv[1]], [43, 13, 8], [59]]),
      ),
      { profile, calculations: world.calculations },
    );
    motion.machine.run(80);
    assert.equal(motion.machine.pop(), expected);
    assert.equal(motion.machine.pop(), 0x82345678);
  }
  await executeMain(world, 461, [floatBits(1000)], undefined, floatBits(3));
});

test('2.6.1.63 Main and MOT use the initialized scalar precision and range reduction', async (t) => {
  const cases = [
    [52, 3, [0xe258d727], 0xbf38a998],
    [53, 4, [0x3f000000], 0x3f060a92],
    [59, 11, [0xbf800000, 1], 0x80000000],
    [321, 42, [0x3f800000, 0x40400000], 0x3f2aaaaa],
  ];
  const world = await dataWorld(
    profile,
    Object.fromEntries(
      cases.map(([id, , args]) => [`main-${id}.kcs`, mainProgram(id, args.length)]),
    ),
  );
  t.after(() => world.close({ flushFiles: false }));
  const marker = 0x82345678;
  for (const [mainId, motionId, args, expected] of cases) {
    await executeMain(world, mainId, args, undefined, expected);
    const program = kcsProgram([
      [37, marker],
      ...args.map((word) => [37, word]),
      [43, motionId, args.length * 4],
      [59],
    ]);
    const { machine } = new MotionInstance(await readKCS(program), { profile });
    machine.run({ budget: 80 });
    assert.equal(machine.sp, machine.floor + 8);
    assert.equal(machine.pop(), expected);
    assert.equal(machine.pop(), marker);
  }
});

test('2.6.1.63 Main and MOT use the initialized D3DX yaw, pitch and roll', async (t) => {
  const world = await dataWorld(profile, { 'main-662.kcs': mainProgram(662, 4) });
  t.after(() => world.close({ flushFiles: false }));
  const address = 256,
    angles = [0x3f99999a, 0xbf266666, 0x3f66a7f0],
    expected = [
      0xbe5e71b0, 0x3f1fc443, 0xbf402404, 0, 0xbf225e4d, 0x3efd0bae, 0x3f1832ea, 0, 0x3f3df27c,
      0x3f1aed80, 0x3e93b1f6, 0, 0, 0, 0, 0x3f800000,
    ];
  const args = [address, ...angles];
  const value = await executeMain(world, 662, args);
  const read = (machine) => Array.from({ length: 16 }, (_, i) => machine.load(address + i * 4));
  assert.deepEqual(read(value), expected);

  const program = kcsProgram([
    [37, 0x82345678],
    [37, address],
    [43, 26, 4],
    ...args.map((arg) => [37, arg]),
    [43, 43, 16],
    [59],
  ]);
  const motion = new MotionInstance(await readKCS(program), { profile });
  motion.run();
  assert.deepEqual(read(motion.machine), expected);
  assert.equal(motion.machine.pop(), 0x82345678);
});

test('2.6.1.63 MOT translates the selected matrix and normalizes a guest vector', async (t) => {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  const address = 256,
    marker = 0x71ca822e,
    translation = [0x3f99999a, 0xbf266666, 0x3f66a7f0],
    instructions = [
      [37, 0xffffffff],
      [43, 26, 4],
      ...[0xffffffff, ...translation].map((word) => [37, word]),
      [43, 24, 16],
      [37, address],
      [43, 31, 4],
      [59],
    ];
  const motion = new MotionInstance(await readKCS(kcsProgram(instructions)), {
    profile,
    calculations: world.calculations,
  });
  const { machine } = motion;
  machine.store(address - 4, marker);
  [0x404ccccd, 0x40066666, 0xbf95c28f, 0x3f800000].forEach((word, i) =>
    machine.store(address + 4 * i, word),
  );
  machine.store(address + 16, marker);
  motion.run();
  const calculation = new DataView(world.calculations.matrix.buffer);
  assert.deepEqual(
    [48, 52, 56].map((at) => calculation.getUint32(at, true)),
    translation,
  );
  assert.deepEqual(
    [-4, 0, 4, 8, 12, 16].map((offset) => machine.load(address + offset)),
    [marker, 0x3f469328, 0x3f025092, 0xbe913535, 0x3e7837f2, marker],
  );
  assert.equal(machine.sp, machine.floor);
});

test('2.6.1.63 Main and MOT matrix copies honor forward DWORD overlap', async (t) => {
  const world = await dataWorld(profile, { 'main-351.kcs': mainProgram(351, 2) });
  t.after(() => world.close({ flushFiles: false }));
  const address = 256,
    fields = Array.from({ length: 18 }, (_, i) => 0x71ac9300 + i),
    args = [address + 4, address];
  const seed = (machine) => fields.forEach((word, i) => machine.store(address + i * 4, word));
  const read = (machine) => fields.map((_, i) => machine.load(address + i * 4));
  const expected = Array(17).fill(fields[0]).concat(fields.at(-1));
  assert.deepEqual(read(await executeMain(world, 351, args, seed)), expected);
  const generic = new MotionInstance(
    await readKCS(kcsProgram([[37, args[0]], [37, args[1]], [43, 28, 8], [59]])),
    { profile },
  );
  seed(generic.machine);
  generic.run();
  assert.deepEqual(read(generic.machine), expected);
});

test('2.6.1.63 MOT rotates relative to live reference axes using the original angle words', async () => {
  const target = 256,
    reference = 320,
    angles = 384;
  const program = await readKCS(
    kcsProgram([
      [37, target],
      [43, 26, 4],
      [37, reference],
      [43, 26, 4],
      [37, target],
      [37, reference],
      [37, angles],
      [43, 44, 12],
      [59],
    ]),
  );
  const cases = [
    [
      [0x3f99999a, 0xbf266666, 0x3f66a7f0],
      [
        0x3efd0bad, 0xbf1fc440, 0xbf1aed7c, 0, 0xbd8765b8, 0x3f2aca87, 0xbf3df279, 0, 0x3f5de780,
        0x3ed03d82, 0x3e93b1f5, 0, 0, 0, 0, 0x3f800000,
      ],
    ],
    [[0x5f000000, 0, 0], Array(16).fill(0xffc00000)],
  ];
  for (const [words, expected] of cases) {
    const motion = new MotionInstance(program, { profile });
    words.forEach((word, i) => motion.machine.store(angles + i * 4, word));
    motion.run();
    assert.deepEqual(
      expected.map((_, i) => motion.machine.load(target + i * 4)),
      expected,
    );
    assert.equal(motion.machine.sp, motion.machine.floor);
  }
});

test('2.6.1.63 explicit MOT rotation observes overwritten angle words on the stack', async () => {
  const target = 256,
    marker = 0x8325ef6d;
  const args = [target, 0x3f99999a, 0xbf266666, 0x3f66a7f0];
  const program = kcsProgram([
    [49, target - 4],
    [37, marker],
    ...args.map((word) => [37, word]),
    [43, 23, 16],
    [59],
  ]);
  new DataView(program.buffer).setUint32(32, 0, true);
  const motion = new MotionInstance(await readKCS(program), { profile });
  const input = [
    1.2, 2.1, -0.4, 1.11, -1.91, 0.85, 0.5, 3.2, 1.9, 2.84, 0.23, -0.45, 0.9, 3.17, -0.55, 1,
  ];
  input.forEach((value, i) => motion.machine.store(target + i * 4, floatBits(value)));
  motion.run();
  assert.deepEqual(
    [0, 4, 8, 12].map((offset) => motion.machine.load(target + offset)),
    [0xbec8dfe3, 0x3f972533, 0x3f0f8124, 0x3f66a7f0],
  );
  assert.equal(motion.machine.pop(), marker);
});

test('2.6.1.63 zero-width MOT rotation reads each angle from the live aliasing stack', async () => {
  const values = [128, ...[0.8, -0.5, 0.6].map(floatBits)],
    program = kcsProgram([[49, 128], ...values.map((word) => [37, word]), [60], [43, 23, 0], [59]]);
  new DataView(program.buffer).setUint32(32, 0, true);
  const motion = new MotionInstance(await readKCS(program), { profile });
  motion.run();
  assert.equal(motion.machine.sp, 128);
  assert.equal(motion.calls.get(23), 1);
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => motion.machine.load(128 + 4 * index)),
    [3203629921, 1061738072, 1046550657, 1058642330],
  );
});

test('2.6.1.63 scalar calls use the original integer RNG, weekday and signed words', async () => {
  const world = await dataWorld(profile, {
    'main-33.kcs': mainProgram(33, 0),
    'main-786.kcs': mainProgram(786, 3),
    'main-874.kcs': mainProgram(874, 2),
    'main-875.kcs': mainProgram(875, 3),
  });
  try {
    world.random.integer.seed(0x1234abcd);
    const realStream = world.random.real.snapshot();
    const initial = [3804888993, 3299738303, 2206553905, 1412884278, 3143776126, 1571473921];
    for (const expected of initial) await executeMain(world, 33, [], undefined, expected);
    assert.deepEqual(world.random.real.snapshot(), realStream);
    for (const [args, expected] of [
      [[2024, 2, 29], 4],
      [[2024, -3, 40], 2],
      [[-2147483648, 1, 1], 0xfffffffc],
      [[2147483647, 2147483647, 0], 0xfffffffd],
    ])
      await executeMain(world, 786, args, undefined, expected);
    await executeMain(world, 874, [0xabcd8000, 0xcdefffff], undefined, 0xffff8000);
    const memory = await executeMain(world, 875, [0xffff8000, 160, 168], (machine) => {
      machine.store(164, 0xa7a7a7a7);
    });
    assert.deepEqual(
      [memory.load(160), memory.load(164), memory.load(168)],
      [0xffff8000, 0xa7a7a7a7, 0xffffffff],
    );
    const alias = await executeMain(world, 875, [0x00018000, 160, 160]);
    assert.equal(alias.load(160), 1);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS narrow desktop calls use the clipboard boundary and blocking message box', async () => {
  const world = await dataWorld(profile, {
    'main-10.kcs': mainProgram(10, 1),
    'main-445.kcs': mainProgram(445, 1),
  });
  const calls = [];
  let opens = true;
  world.runtime.services.nativeClipboard = {
    open(owner) {
      calls.push(['open', owner]);
      return opens;
    },
    empty() {
      calls.push(['empty']);
      return true;
    },
    write(text) {
      calls.push(['write', text]);
      return true;
    },
    close() {
      calls.push(['close']);
      return true;
    },
  };
  const shown = Promise.withResolvers();
  const acknowledge = Promise.withResolvers();
  world.host.nativeWindowAction = (action) => {
    shown.resolve(action);
    return acknowledge.promise;
  };
  const messageAt = (text) => (machine) => machine.writeString(text, 160);
  try {
    await executeMain(world, 10, [160], messageAt('猫\\n犬'));
    assert.deepEqual(calls.splice(0), [['open', 1], ['empty'], ['write', '猫\r\n犬'], ['close']]);
    opens = false;
    await executeMain(world, 10, [160], messageAt('本文'));
    assert.deepEqual(calls.splice(0), [['open', 1]]);
    const pending = executeMain(world, 445, [160], messageAt('原版の本文'));
    const request = await Promise.race([
      shown.promise,
      pending.then(() => {
        throw new Error('KCS returned before showing its message box');
      }),
    ]);
    assert.deepEqual(request, {
      type: 'script-message-box',
      caption: 'system error',
      message: '原版の本文',
    });
    acknowledge.resolve(1);
    await pending;
  } finally {
    acknowledge.resolve(0);
    await world.close();
  }
});

test('2.6.1.63 KCS queries retained MOT filenames and copies its live working bank', async (t) => {
  const motion = kcsProgram([[59]]),
    world = await dataWorld(profile, {
      'main-514.kcs': mainProgram(514, 2),
      'pbase.kcs': motion,
      'ヂ.kcs': motion,
    });
  t.after(() => world.close({ flushFiles: false }));
  const category = { name: 'mot', directory: '', extension: 'kcs' },
    registry = world.runtime.services.motion,
    handle = registry.create(world.main.id),
    manager = registry.get(handle),
    guest = 256;
  world.motionLibrary.game.nativeResources = { entries: [category] };
  const query = (name, value) =>
    executeMain(world, 514, [handle, guest], (m) => m.writeString(name, guest), value);
  await query('pBase', 0);
  for (const name of ['pBase', 'ヂ']) manager.add(await world.motionLibrary.load(name));
  manager.base.forEach((_, i) => (manager.base[i] = (19 + i * 17) & 255));
  manager.working.fill(0xa1);
  await query('PBASE.KCS', 1);
  assert.deepEqual(manager.working, manager.base);
  await query('ア', 1);
  await query('folder/pBase.kcs', 0);
  await query('pBase.mot', 0);
  category.directory = 'mot';
  await query('pBase', 0);
  await executeMain(world, 514, [0, 0xffffffff], undefined, 0);
  assert.equal(manager.records.size, 2);
});

test('2.6.1.63 KCS drives the original Raster and positioned wipe lifecycle', async (t) => {
  const commands = [
      [196, 2],
      [197, 1],
      [198, 1],
      [200, 1],
      [203, 1],
    ],
    world = await dataWorld(
      profile,
      Object.fromEntries(commands.map(([id, words]) => [`main-${id}.kcs`, mainProgram(id, words)])),
    );
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    plane = await world.objects.create({ kind: 2, parent }),
    raster = await world.objects.create({ kind: 18, parent }),
    rain = await world.objects.create({ kind: 19, parent }),
    model = world.graphics.get(plane),
    native = (id) => world.nativeTaskID(id),
    guest = 160,
    initialize = (id, params) =>
      executeMain(world, 196, [native(id), guest], (machine) => {
        params.forEach((word, i) => machine.store(guest + i * 4, word));
      }),
    action = (operation, id, result) =>
      executeMain(world, operation, [native(id)], undefined, result);
  for (const [canonical, raw] of [
    [257, 245],
    [258, 246],
    [259, 247],
    [261, 249],
    [263, 251],
    [274, 262],
  ]) {
    assert.equal(mapABIMessage(profile, 'area', 'raw', canonical), raw);
    assert.equal(mapABIMessage(profile, 'area', 'canonical', raw), canonical);
  }
  await assert.rejects(initialize(rain, []), /Unreviewed Area effect recipient kind 19/);
  await assert.rejects(executeMain(world, 200, [0xf82a93a1]), /did not write/);
  await assert.rejects(
    executeMain(world, 196, [native(raster), 0xffffffff]),
    /no translated packet/,
  );
  await executeMain(world, 196, [native(world.root), 0xffffffff]);

  await world.sendEngine(plane, parent, 41, 0, 0, {
    payload: new NativeGraphicsPacket([...[0, 0, 0, 24, 18, 0, 0].map(floatBits), 0xffffffff]),
  });
  await initialize(raster, [native(plane), 0x80000002, ...[3.25, 8.5, 14].map(floatBits)]);
  await action(200, raster, 0);
  await action(197, raster);
  await action(200, raster, 1);
  assert.equal(model.graph.vertexEffectID, raster);
  await action(203, raster);
  await action(200, raster, 1);
  await action(198, raster);
  await action(200, raster, 0);
  assert.equal(model.graph.vertexEffectID, undefined);

  const uploads = [];
  world.graphics.output = async (bitmap, offset, region) => {
    uploads.push({ size: [bitmap.width, bitmap.height], offset, region });
  };
  const bitmaps = [
    [8, 6],
    [6, 5],
    [3, 3],
  ].map(([w, h]) => world.graphics.images.create(w, h, parent));
  const source = world.graphics.images.get(bitmaps[0]),
    target = world.graphics.images.get(bitmaps[1]),
    sourcePixels = await source.pixels(),
    targetPixels = await target.pixels(),
    lastColumn = (5 * source.width + 7) * 4,
    nextPhysicalRow = (3 * target.width + 1) * 4;
  sourcePixels.fill(255);
  targetPixels.set([131, 149, 173, 211], nextPhysicalRow);
  await target.changed();
  const speed = world.configuration.blocks[2];
  new DataView(speed.buffer, speed.byteOffset, 4).setUint32(0, 9, true);
  for (const kind of [26, 29, 30]) {
    const id = await world.objects.create({ kind, parent }),
      receiver = world.areaEffects.tasks.get(id);
    sourcePixels.set([7, 11, 13, 0], lastColumn);
    await source.changed();
    await initialize(id, areaPixelParameters({ kind, maskOrigin: [1, 1] }, bitmaps));
    assert.deepEqual(
      [...sourcePixels.subarray(lastColumn, lastColumn + 4)],
      kind === 29 ? [7, 11, 13, 0] : [131, 149, 173, 0],
    );
    const work = receiver.state.work;
    assert.deepEqual([receiver.state.width, receiver.state.height], [6, 5]);
    assert.deepEqual([receiver.state.blendWidth, receiver.state.blendHeight], [3, 3]);
    await action(197, id);
    assert.equal(receiver.state.speed, 1);
    await world.tick();
    assert.deepEqual(uploads.splice(0), [
      {
        size: [6, 5],
        offset: [4, 3],
        region: kind === 26 ? [0, 0, 6, 5] : [1, 1, 4, 4],
      },
    ]);
    await action(203, id);
    await action(200, id, 0);
    assert.deepEqual(uploads.splice(0), [
      {
        size: [6, 5],
        offset: kind === 26 ? [4, 3] : [5, 4],
        region: [0, 0, 6, 5],
      },
    ]);
    await world.objects.release(id);
    assert.equal(world.runtime.handles.records.has(work), false);
    assert.ok(bitmaps.every((handle) => world.runtime.handles.records.has(handle)));
  }
  sourcePixels[3] = 0;
  await source.changed();
  const wipe = await world.objects.create({ kind: 26, parent });
  await assert.rejects(
    initialize(wipe, areaPixelParameters({ kind: 26 }, bitmaps)),
    /RGB preparation exceeds its borrowed bitmap/,
  );
});

test('2.6.1.63 KCS reads optional task records without changing the CSS or neutral recipients', async (t) => {
  const world = await dataWorld(profile, {
    'main-238.kcs': mainProgram(238, 1),
    'main-244.kcs': mainProgram(244, 4),
    'main-576.kcs': mainProgram(576, 3),
    'main-689.kcs': mainProgram(689, 3),
  });
  t.after(() => world.close({ flushFiles: false }));
  let css;
  await executeMain(world, 238, [37], undefined, (value) => (css = value));
  const record = world.runtime.handles.get(css, 'global-file'),
    top = world.nativeTaskID(world.root),
    script = world.nativeTaskID(world.main.id),
    absent = 0xcccccccc,
    plane = await world.objects.create({ kind: 2, parent: world.root }),
    unsupported = world.nativeTaskID(plane),
    guest = 256,
    plain = Uint8Array.of(0x82, 0xa0, 0x63, 0xff),
    tree = new Uint8Array(28),
    view = new DataView(tree.buffer);
  view.setUint32(4, 12, true);
  view.setUint32(20, 4, true);
  tree.set(plain, 24);
  const write = (id, bytes) =>
    executeMain(
      world,
      244,
      [css, id, bytes.length, guest],
      (m) => m.bytes(guest, bytes.length).set(bytes),
      1,
    );
  for (const [id, key] of [
    [576, 13],
    [689, 4096],
  ]) {
    await executeMain(world, id, [0, key, unsupported], undefined, 0);
    await executeMain(world, id, [css, key, unsupported], undefined, 0);
    await assert.rejects(executeMain(world, id, [css, 0, top]), /unwritten CSS record zero/);
  }
  await write(13, plain);
  await write(4096, tree);
  await write(0, tree);
  const before = record.snapshot();
  for (const [id, key] of [
    [576, 13],
    [689, 4096],
  ]) {
    for (const target of [top, script, absent]) {
      await executeMain(world, id, [css, key, target], undefined, 1);
      await executeMain(world, id, [css, 0, target], undefined, 1);
      await executeMain(world, id, [css, 0x729301aa, target], undefined, 0);
    }
    await assert.rejects(
      executeMain(world, id, [css, key, unsupported]),
      /unreviewed CSS task recipient/,
    );
  }
  assert.deepEqual(record.snapshot(), before);
  await write(4097, plain);
  await assert.rejects(executeMain(world, 689, [css, 4097, script]), /Malformed CSS task tree/);
  assert.equal(nativeABI(profile).tables.main.entries[688].status, 'unknown');
});

test('2.6.1.63 KCS loads an ordinary MPEG Plane and borrows its registered movie', async (t) => {
  const source = Uint8Array.of(0, 0, 1, 0xba, 0x21, 0, 1),
    world = await dataWorld(profile, {
      'main-701.kcs': mainProgram(701, 2),
      'main-702.kcs': mainProgram(702, 1),
      'movie/試験.mpg': source,
    });
  t.after(() => world.close({ flushFiles: false }));
  world.game.nativeResources = {
    entries: [{ name: 'movie', directory: 'movie', extension: 'mpg' }],
  };
  const plane = await world.objects.create({ kind: 2, parent: world.root, nativeID: 21 }),
    owner = world.graphics.get(plane),
    calls = [],
    rgba = Uint8Array.of(37, 51, 67, 83, 101, 159, 181, 193);
  let ready = false;
  world.host.nativeMovie = (name, id) => ({
    open(filename, input) {
      assert.equal(filename, name);
      assert.deepEqual(input.bytes, source);
      calls.push(['open', filename, id]);
      return ready;
    },
    close: () => calls.push(['close']),
    configure() {},
    metadata: () => ({ width: 2, height: 1, duration: 200n, alpha: false }),
    frameStamp: () => 11,
    decodedFrame: () => ({ width: 2, height: 1, rgba }),
  });
  assert.equal(mapABIMessage(profile, 'planeMovie', 'raw', 43), 41);
  assert.equal(mapABIMessage(profile, 'planeMovie', 'raw', 87), 84);
  assert.equal(mapABIMessage(profile, 'planeMovie', 'canonical', 41), 43);
  assert.equal(mapABIMessage(profile, 'planeMovie', 'canonical', 84), 87);
  assert.throws(
    () => mapABIMessage(profile, 'planeMovie', 'canonical', 82),
    /Unreviewed ABI message/,
  );
  const load = (name) => executeMain(world, 701, [21, 256], (m) => m.writeString(name, 256)),
    borrow = (id, result) => executeMain(world, 702, [id], undefined, result);
  await executeMain(world, 701, [0, 0xffffffff]);
  await load('試験');
  await borrow(21, 0);
  assert.deepEqual(calls, []);
  world.graphics.createLogicalDevice();
  owner.state.vramType = 2;
  await load('試験');
  await borrow(21, 0);
  assert.deepEqual(calls, []);
  owner.state.vramType = 1;
  await load('試験');
  await borrow(21, 0);
  assert.deepEqual(calls.splice(0), [['open', 'movie/試験.mpg', plane], ['close']]);
  await assert.rejects(load('unknown.avi'), /Unreviewed media type/);

  ready = true;
  await load('試験');
  const graph = owner.graph,
    { handle } = graph.movie,
    record = world.movies.get(handle),
    frame = await world.planeMovies.retainedFrame(graph.movie);
  assert.equal(record.owner, plane);
  assert.deepEqual(
    [graph.type, graph.x, graph.y, graph.z, graph.width, graph.height],
    [3, 0, 0, 0, 2, 1],
  );
  assert.deepEqual(frame.rgba, Uint8ClampedArray.of(37, 51, 67, 255, 101, 159, 181, 255));
  await borrow(21, handle);
  await borrow(0, 0);
  await borrow(0xf1234567, 0);
  owner.state.vramType = 2;
  await load('試験');
  await borrow(21, handle);
  assert.equal(owner.graph, graph);
  await world.objects.release(plane);
  await borrow(21, 0);
  assert.equal(world.runtime.handles.records.has(handle), false);
  assert.equal(world.runtime.handles.records.has(record.bitmap), false);
  assert.deepEqual(calls, [['open', 'movie/試験.mpg', plane], ['close']]);
});

test('2.6.1.63 KCS rotates, translates and scales the original SSE2 matrix words', async (t) => {
  const world = await dataWorld(profile, {
    'main-204.kcs': mainProgram(204, 4),
    'main-205.kcs': mainProgram(205, 4),
    'main-206.kcs': mainProgram(206, 4),
  });
  t.after(() => world.close({ flushFiles: false }));
  const matrix = [
    1.125, 0.25, 0.5, 0, -0.125, 0.5, -0.25, 0, 0.5, 0.625, 1.875, 0, 17.25, -8.125, -3, 1,
  ].map(floatBits);
  const angles = [0x3fa80000, 0xbeb6c8b4, 0x3db851de],
    marker = 0x713e8a2e,
    destination = 160,
    prepare = (m) => {
      m.store(destination - 4, marker);
      matrix.forEach((word, i) => m.store(destination + i * 4, word));
      m.store(destination + 64, marker + 2);
    },
    output = (m) => matrix.map((_, i) => m.load(destination + i * 4));
  const rotated = await executeMain(world, 204, [destination, ...angles], prepare);
  assert.deepEqual(
    output(rotated),
    [
      0x3f757ca0, 0xbeab60b3, 0x3f3d4167, 0, 0xbe977cd2, 0x3eb03e1f, 0x3eb2e6fd, 0, 0x3e73ddfc,
      0xbfd1b66f, 0x3f984625, 0, 0x4198305f, 0x4022e479, 0xc0033162, 0x3f800000,
    ],
  );
  assert.equal(rotated.load(destination - 4), marker);
  assert.equal(rotated.load(destination + 64), marker + 2);
  const current = new DataView(world.calculations.matrix.buffer);
  matrix.forEach((word, i) => current.setUint32(i * 4, word, true));
  await executeMain(world, 205, [0xffffffff, ...angles]);
  assert.deepEqual(
    matrix.map((_, i) => current.getUint32(i * 4, true)).slice(12),
    [0x41948000, 0xc107b646, 0xc03a3d71, 0x3f800000],
  );
  const scaled = await executeMain(world, 206, [destination, 1, 0x80000001, 3], prepare);
  assert.deepEqual(
    output(scaled),
    [1, 0, 2, 0, 0, 0, 0x80000001, 0, 0, 0x80000001, 6, 0, 0x11, 8, 0x80000009, 0x3f800000],
  );
  assert.equal(scaled.load(destination - 4), marker);
  assert.equal(scaled.load(destination + 64), marker + 2);
});

test('2.6.1.63 Main201 updates a running Raster without replacing its graph or phase', async (t) => {
  const world = await dataWorld(profile, { 'main-201.kcs': mainProgram(201, 3) });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    plane = await world.objects.create({ kind: 2, parent }),
    raster = await world.objects.create({ kind: 18, parent }),
    hydro = await world.objects.create({ kind: 25, parent }),
    foreign = await world.objects.create({ kind: 6, parent }),
    graph = world.nativeTaskID(plane),
    area = world.areaEffects.tasks.get(raster),
    initial = [graph, 0x80000002, floatBits(3.25), floatBits(8.5), floatBits(14)];
  await world.sendEngine(plane, parent, 41, 0, 0, {
    payload: new NativeGraphicsPacket([...[0, 0, 0, 24, 18, 0, 0].map(floatBits), 0xffffffff]),
  });
  await world.sendEngine(raster, parent, 263, 0, 0, {
    payload: new NativeGraphicsPacket(initial),
  });
  await world.sendEngine(raster, parent, 257);
  await world.tick();
  const renderGraph = world.graphics.tasks.get(plane).graph,
    before = area.snapshot(),
    pointer = 160,
    words = [0x1875abe2, 1, floatBits(7.125), floatBits(3.75), floatBits(35.625)],
    update = (owner, selector, address, packet) =>
      executeMain(world, 201, [world.nativeTaskID(owner), selector, address], (machine) => {
        packet?.forEach((word, i) => machine.store(address + i * 4, word));
      });
  assert.equal(renderGraph.vertexEffectID, raster);
  const caller = await update(raster, 0, pointer, words);
  assert.deepEqual(
    words.map((_, i) => caller.load(pointer + i * 4)),
    words,
  );
  assert.deepEqual(area.state.params, [...initial.slice(0, 2), ...words.slice(2)]);
  assert.deepEqual(
    [
      area.state.geometry.graph,
      area.state.geometry.mode,
      area.state.geometry.converted,
      area.state.geometry.amplitude,
    ],
    [graph, 2, true, 7.125],
  );
  for (const field of ['start', 'lastClock', 'rasterElapsed', 'active'])
    assert.equal(area.state[field], before.state[field]);
  assert.equal(renderGraph.vertexEffectID, raster);
  const updated = area.snapshot();
  await update(raster, 0x80002000, 0xffffffff);
  await update(hydro, 0, 0x7eeeeeb2);
  await update(foreign, 0, 0xffffffff);
  assert.deepEqual(area.snapshot(), updated);
  await assert.rejects(
    executeMain(world, 201, [0x6eeeabce, 0, 0xffffffff]),
    /Area effect query did not write/,
  );
  await assert.rejects(
    update(raster, 0, 0xffffffff),
    /Area geometry initializer has no translated packet/,
  );
  assert.deepEqual(area.snapshot(), updated);
});

test('2.6.1.63 KCS reads and merges the original owned bitmap fields', async () => {
  const world = await dataWorld(profile, {
    'main-119.kcs': mainProgram(119, 3),
    'main-536.kcs': mainProgram(536, 7),
    'main-537.kcs': mainProgram(537, 2),
  });
  try {
    const { images } = world.graphics,
      source = images.create(13, 7, world.main.id),
      target = images.create(2, 3, world.main.id),
      attribute = { id: 7, rect: [10, -20, 30, -40], color: 0xff800123 };
    images.get(source).state.attributes = [attribute];
    images.get(target).state.attributes = [
      { id: 7, rect: [1, 2, 3, 4], color: 0x70 },
      { id: 4, rect: [5, 6, 7, 8], color: 0x71 },
    ];
    const size = await executeMain(world, 119, [source, 176, 180]);
    assert.deepEqual([size.load(176), size.load(180)], [13, 7]);
    const alias = await executeMain(world, 119, [source, 176, 176]);
    assert.equal(alias.load(176), 7);
    const empty = await executeMain(world, 119, [0, 176, 180], (m) => m.bytes(176, 8).fill(0xa7));
    assert.deepEqual([empty.load(176), empty.load(180)], [0, 0]);

    await executeMain(world, 537, [target, source], undefined, 1);
    assert.deepEqual(
      images.get(target).state.attributes.map(({ id }) => id),
      [4, 7],
    );
    assert.notStrictEqual(images.get(target).state.attributes[1], attribute);
    const read = (id, expected) =>
      executeMain(
        world,
        536,
        [target, id, 160, 164, 168, 172, 176],
        (m) => m.bytes(160, 24).fill(0xa7),
        expected,
      );
    const found = await read(0x10007, 1);
    assert.deepEqual(
      [160, 164, 168, 172, 176, 180].map((at) => found.load(at)),
      [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123, 0xa7a7a7a7],
    );
    const absent = await read(8, 0);
    assert.deepEqual([...absent.bytes(160, 24)], new Array(24).fill(0xa7));
    await executeMain(world, 537, [target, 0], undefined, 0);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 KCS routes cursor, Top and exit words through the true local owners', async () => {
  const world = await dataWorld(profile, {
    'main-149.kcs': mainProgram(149, 2),
    'main-150.kcs': mainProgram(150, 3),
    'main-286.kcs': mainProgram(286, 0),
    'main-577.kcs': mainProgram(577, 1),
    'main-651.kcs': mainProgram(651, 1),
  });
  try {
    const { input } = world,
      main = world.objects.objects.get(world.main.id),
      top = world.objects.objects.get(world.root);
    input.pointer(-17, 35);
    const measured = await executeMain(world, 149, [168, 176], (m) => m.store(172, 0x73));
    assert.deepEqual(
      [measured.load(168) | 0, measured.load(172), measured.load(176)],
      [-17, 0x73, 35],
    );
    const region = input.register({ owner: world.main.id, bounds: [0, 0, 10, 20] });
    region.active = 0xa72;
    input.previousX = 4;
    input.previousY = 5;
    input.forceCursor = false;
    await executeMain(world, 286, []);
    assert.deepEqual(
      [region.active, input.previousX, input.previousY, input.forceCursor],
      [0, -1, -1, true],
    );

    const warpPolicy = world.configuration.blocks[2];
    new DataView(warpPolicy.buffer, warpPolicy.byteOffset, warpPolicy.byteLength).setUint32(
      12,
      1,
      true,
    );
    input.foreground = true;
    await executeMain(world, 150, [0x81230009, 0xfedc0007, 0x12345678]);
    assert.deepEqual([input.warp.x, input.warp.y, input.warp.remaining], [9, 7, 0x12345678]);
    const retained = { ...input.warp };
    await executeMain(world, 150, [0xffff, 0xffff, 1]);
    assert.deepEqual(input.warp, retained);
    input.foreground = false;
    await executeMain(world, 150, [8, 6, 2]);
    assert.deepEqual(input.warp, retained);

    await executeMain(world, 577, [0xfefe8100]);
    assert.equal(top.implementation.field, 0xfefe8100);
    main.exitCode = 47;
    await executeMain(world, 651, [main.nativeID]);
    assert.equal(main.exitCode, -1);
  } finally {
    await world.close();
  }
});

test('2.6.1.63 scene count and Script backup preserve native ownership and byte widths', async () => {
  const world = await dataWorld(profile, {
    'main-608.kcs': mainProgram(608, 1),
  });
  let cold;
  try {
    const { main } = world,
      call = (id, args) => world.runtime.native('main', id, args, main.machine, main),
      { value: scene } = await call(323, []);
    await executeMain(world, 608, [0], undefined, 0);
    await executeMain(world, 608, [scene], undefined, 0xffffffff);
    await call(324, [scene]);
    await assert.rejects(executeMain(world, 608, [scene], undefined, 0), /released/);
    assert.deepEqual(await call(610, []), { control: 2 });

    await call(209, [5]);
    const bank = world.runtime.variableBank(main, false);
    bank.set(0, 0x12345678);
    bank.set(1, 0xfedcbacc);
    assert.throws(() => call(610, []), /requires a completed backup/);
    assert.equal(bank.get(0), 0x12345678);
    assert.deepEqual(await call(609, []), { control: 2 });
    bank.set(0, 0x87654321);
    bank.set(1, 0xabcdef00);

    cold = await dataWorld(profile, {}, { initialize: false });
    await cold.restore(world.snapshot());
    const caller = cold.main;
    assert.deepEqual(await cold.runtime.native('main', 610, [], caller.machine, caller), {
      control: 2,
    });
    const restored = cold.runtime.variableBank(caller, false);
    assert.deepEqual([restored.get(0), restored.get(1)], [0x12345678, 0xabcdefcc]);
    assert.deepEqual([bank.get(0), bank.get(1)], [0x87654321, 0xabcdef00]);
  } finally {
    await cold?.close();
    await world.close();
  }
});

test('2.6.1.63 String owns the image-font source and registers independent glyphs', async () => {
  const color = Uint8Array.of(18, 53, 162, 224, 125, 93, 31, 255),
    files = { 'font.hg3': hg3(2, 1, color) },
    world = await dataWorld(profile, files, { glyphs });
  let cold;
  try {
    world.graphics.createLogicalDevice();
    const nativeID = 48,
      at = 608,
      code = 0x8740,
      taskID = await world.objects.create({ kind: 48, parent: world.main.id, nativeID }),
      task = world.objects.objects.get(taskID).implementation,
      { main, runtime } = world,
      { imageDataBuffers: images } = runtime,
      call = (id, ...inputs) =>
        runtime.native('main', id, [nativeID, ...inputs], main.machine, main),
      source = await images.load('font.hg3', main.id),
      pointer = images.pointer(source);

    main.machine.store(at, 200);
    await call(611, at);
    assert.deepEqual([main.machine.load(at), main.machine.load(at + 8)], [200, 800]);
    main.machine.store(at + 8, 64);
    main.machine.store(at + 12, 48);
    main.machine.store(at + 188, -12);
    main.machine.store(at + 192, -23);
    await call(612, at);
    assert.deepEqual(task.text.vram, [-12, -23]);

    await call(620, source);
    assert.equal(images.pointer(source), pointer);
    await assert.rejects(call(620, source), /requires a separate reference/);
    const another = images.alias(source);
    await call(620, another);
    assert.equal(images.words(pointer)[3], 1);

    await call(621, 0xa5c10000 + code, 0);
    const writer = await task.writer(),
      glyph = writer.fontImages.get(code);
    assert.deepEqual(Uint8Array.from(glyph.rgba), color);
    await call(621, code + 1, 99);
    assert.equal(writer.fontImages.get(code + 1), null);
    await call(620, 0);
    assert.equal(images.owns(pointer), true);

    cold = await dataWorld(profile, files, { initialize: false, glyphs });
    await cold.restore(world.snapshot());
    const restored = cold.objects.objects.get(taskID).implementation,
      restoredWriter = await restored.writer(),
      restoredImages = cold.runtime.imageDataBuffers;
    assert.equal(restoredImages.pointer(another), pointer);
    await cold.sendNativeEngine(nativeID, cold.main.id, 439, 0, 0);
    assert.equal(restoredImages.owns(pointer), false);
    assert.deepEqual(restoredWriter.fontImages.get(code), glyph);

    main.machine.store(at + 184, 1);
    await call(613, at);
    assert.equal(images.owns(pointer), false);
    assert.equal(writer.fontImages.size, 0);
  } finally {
    await cold?.close();
    await world.close();
  }
});

test('fixed 2.6.1.63 Blur and Mosaic preserve native feedback and rectangle passes', async () => {
  const widths = new Map([
    [520, 1],
    [521, 8],
    [522, 2],
    [523, 10],
    [524, 2],
  ]);
  const world = await dataWorld(
    profile,
    Object.fromEntries(
      [...widths].map(([id, words]) => [`main-${id}.kcs`, mainProgram(id, words)]),
    ),
  );
  try {
    const { view } = world.graphics,
      gpu = new ScreenVectorGPU(16, 16);
    Object.assign(view, { clientWidth: 16, clientHeight: 16 });
    Object.assign(world.configuration.screen, {
      width: 16,
      height: 16,
      currentWidth: 16,
      currentHeight: 16,
    });
    world.stageRenderer.gpu = gpu;
    world.graphics.createLogicalDevice();
    const create = async (kind) =>
      world.nativeTaskID(await world.objects.create({ kind, parent: world.main.id }));
    const draw = async () => {
      gpu.draws.length = 0;
      await world.screenEffects.rendering.render([], async () => {}, null);
      return gpu.draws;
    };

    const blur = await create(35);
    const matrix = [
      1.2, 2.1, -0.4, 1.11, -1.91, 0.85, 0.5, 3.2, 1.9, 2.84, 0.23, -0.45, 0.9, 3.17, -0.55, 1,
    ].map(floatBits);
    await executeMain(
      world,
      521,
      [
        blur,
        0x80000108,
        floatBits(1.59375),
        floatBits(0.7),
        floatBits(-3.125),
        0x814020fa,
        floatBits(8),
        floatBits(50000),
      ],
      (machine) => matrix.forEach((word, index) => machine.store(0x80000108 + index * 4, word)),
    );
    await executeMain(world, 522, [blur, 0x80000011]);
    await executeMain(world, 520, [blur], undefined, 0x80000011);
    assert.equal((await draw()).length, 1);
    const feedback = (await draw())[0][0];
    assert.deepEqual(
      [feedback.x, feedback.y, feedback.z, feedback.w].map(floatBits),
      [1099682939, 3241971546, 3230473912, 3255791780],
    );
    assert.equal(feedback.color, 0x814020fa);

    const mosaic = await create(36);
    await executeMain(world, 524, [mosaic, 17]);
    assert.deepEqual(await draw(), []);
    const rectangle = [1.125, 1.375, 5.25, 4.9375, 0, -0, 1, 1080].map(floatBits);
    await executeMain(world, 523, [mosaic, ...rectangle, 0xf0604020]);
    const [small, large] = await draw();
    assert.deepEqual(
      small.map(({ x, y }) => [x, y]),
      Array.from({ length: 6 }, () => [0, 0]),
    );
    assert.deepEqual(
      [large[0].x, large[0].y, large[0].u, large[0].v, large[0].color],
      [0.625, 0.875, 0, 0, 0xf0604020],
    );
    await executeMain(world, 524, [mosaic, 0]);
    await executeMain(world, 520, [mosaic], undefined, 0);
    assert.deepEqual(await draw(), []);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.63 screen transitions retain the fade extension and stopped clocks', async () => {
  const widths = new Map([
    [853, 6],
    [854, 1],
    [855, 2],
    [856, 7],
    [857, 2],
    [860, 8],
    [861, 2],
  ]);
  const world = await dataWorld(
    profile,
    Object.fromEntries(
      [...widths].map(([id, words]) => [`main-${id}.kcs`, mainProgram(id, words)]),
    ),
  );
  try {
    Object.assign(world.graphics.view, { clientWidth: 8, clientHeight: 6 });
    world.stageRenderer.gpu = new ScreenVectorGPU(8, 6);
    world.graphics.createLogicalDevice();
    for (let native = 475; native <= 482; native++) {
      assert.equal(mapABIMessage(profile, 'screen', 'canonical', native), native + 41);
      assert.equal(mapABIMessage(profile, 'screen', 'raw', native + 41), native);
    }
    for (const [kind, initializer, start, values] of [
      [50, 853, 855, [4, 0]],
      [51, 856, 857, [4, 1, 0x4000abcd]],
      [52, 860, 861, [4, 3, floatBits(2), floatBits(16)]],
    ]) {
      const id = await world.objects.create({ kind, parent: world.main.id });
      const target = world.nativeTaskID(id),
        task = world.screenEffects.tasks.get(id);
      const { record, state } = task;
      if (kind === 50) assert.equal(world.screenEffects.rendering.prepare(2), true);
      await executeMain(world, start, [target, 17]);
      record.effectiveFrame = 100;
      record.pausedFrames = 6;
      await executeMain(world, initializer, [target, 8, floatBits(0), floatBits(60000), ...values]);
      if (kind === 50) await executeMain(world, 854, [target]);
      if (kind === 51) assert.equal(state.params[5], 0x4000abcd);
      assert.deepEqual([state.active, state.start, state.end], [17, 94, 102]);
      record.effectiveFrame = 200;
      await executeMain(world, start, [target, 0]);
      assert.deepEqual([state.active, state.start, state.end], [0, 94, 102]);
      await world.objects.release(id);
    }
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('WBreak accepts a mesh above 262144 cells within native shard allocation size', () => {
  const firstShard = new Error('Reached the first shard');
  const random = {
    frand() {
      throw firstShard;
    },
  };
  assert.throws(
    () => breakShards(545, 481, 1, 1, 0, 0, random),
    (error) => error === firstShard,
  );
  assert.throws(
    () => breakShards(4096, 4096, 1, 1, 0, 0, random),
    /shard allocation exceeds its native size/,
  );
});
