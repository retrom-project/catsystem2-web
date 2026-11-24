// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageCommandsFixture } from './fixtures/image-commands-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

test('2.6.1.23 bitmap composite clips physical rows and validates packed layers before writes', async (t) => {
  const guard = 0x735b40cd,
    list = 196,
    rectangle = 604,
    program = kcsProgram([
      [37, guard],
      ...[64, 68, 72, 76].map((address) => [37, [0x13, address]]),
      [43, 120, 16],
      [59],
    ]);
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23', { 'composite.kcs': program });
  t.after(() => world.close({ flushFiles: false }));
  const images = world.graphics.images;
  function make(width, height, bpp, rgba) {
    const handle = images.create(width, height, world.main.id);
    Object.assign(images.get(handle).state, { bpp, rgba: Uint8ClampedArray.from(rgba) });
    return handle;
  }
  async function composite(owner, records, error) {
    const task = await world.spawnScript('composite.kcs'),
      machine = task.machine,
      start = machine.sp;
    try {
      [owner, list, records.length / 3, rectangle].forEach((word, i) =>
        machine.store(64 + 4 * i, word),
      );
      records.forEach((word, i) => machine.store(list + 4 * i, word));
      [1, 0, 4, 2].forEach((word, i) => machine.store(rectangle + 4 * i, word));
      const before = machine.bytes(list, rectangle - list + 16).slice();
      const result = world.runtime.scheduler.execute(task);
      if (error) await assert.rejects(result, error);
      else {
        assert.equal((await result).status, 'halted');
        assert.equal(machine.sp, start + 4);
        assert.equal(machine.pop(), guard);
      }
      assert.deepEqual(machine.bytes(list, before.length), before);
    } finally {
      await world.objects.release(task.id);
    }
  }

  const outside = [17, 33, 77, 51],
    black = [0, 0, 0, 255],
    startingPixels = Array.from({ length: 8 }, () => outside).flat(),
    destination = make(4, 2, 4, startingPixels),
    rgb = make(2, 2, 3, [11, 22, 33, 255, 44, 55, 66, 255, 77, 88, 99, 255, 101, 111, 121, 255]),
    packed = make(1, 1, 2, [170, 85, 255, 136]),
    opaque = make(1, 1, 4, [1, 2, 3, 255]),
    records = [rgb, 0, 0, 0, 120, 200, packed, 2, 0, opaque, 3, 1],
    expected = [
      ...outside,
      44,
      55,
      66,
      255,
      ...black,
      ...black,
      ...outside,
      101,
      111,
      121,
      255,
      90,
      45,
      136,
      255,
      ...black,
    ];
  await composite(destination, records);
  assert.deepEqual([...(await images.get(destination).pixels())], expected);
  await composite(destination, [rgb, 1, 1, 0xedfa3568, 1, 0], /released native bitmap handle/);
  assert.deepEqual([...(await images.get(destination).pixels())], expected);

  const rgbDestination = make(4, 2, 3, startingPixels);
  await composite(rgbDestination, [opaque, 3, 1], /packed bitmap composite conversion/);
  assert.deepEqual([...(await images.get(rgbDestination).pixels())], startingPixels);
});

for (const profile of ['grisaia-jp-engine-2.6.1.23', 'rebellions-jp-engine-2.6.1.63'])
  test(`${profile} captures an opaque owned bitmap and round-trips a clipped CSS thumbnail`, async (t) => {
    const world = await dataWorld(profile);
    t.after(() => world.close());
    const { main, runtime, graphics } = world,
      call = (id, args = []) => runtime.native('main', id, args, main.machine, main),
      view = graphics.view,
      input = Uint8Array.of(10, 20, 30, 35, 11, 21, 31, 37, 12, 22, 32, 39),
      target = { width: 3, height: 1 };
    world.stageRenderer = {
      gpu: { primaryTarget: target, pixels: () => input },
      render: async () => {},
      dispose: () => {},
    };
    view.active = false;
    assert.deepEqual(await call(113), { control: 1, value: 0 });
    view.active = true;
    const capture = (await call(113)).value,
      bitmap = graphics.images.get(capture),
      expected = [10, 20, 30, 255, 11, 21, 31, 255, 12, 22, 32, 255];
    assert.deepEqual([...(await bitmap.pixels())], expected);
    assert.equal(input[3], 35);
    const thumbnail = graphics.images.create(4, 1, main.id);
    await graphics.images.get(thumbnail).fill(0, 0, 4, 1, 0xff020304);
    assert.deepEqual(await call(116, [thumbnail, 0, 0, 4, 1, capture, 0, 0, 4, 1]), { control: 2 });
    const clipped = [...expected, 2, 3, 4, 255];
    assert.deepEqual([...(await graphics.images.get(thumbnail).pixels())], clipped);

    const file = (await call(238, [7])).value;
    assert.deepEqual(await call(241, [file, 31, thumbnail]), { control: 1, value: 1 });
    assert.deepEqual(await call(251, [file, 32]), { control: 1, value: 0 });
    const restored = (await call(251, [file, 31])).value,
      css = runtime.handles.get(file, 'global-file');
    assert.equal(new TextDecoder().decode(css.read(31).subarray(0, 4)), 'HG-2');
    assert.notEqual(restored, thumbnail);
    assert.deepEqual([...(await graphics.images.get(restored).pixels())], clipped);
  });

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} clips equal requested bitmap rectangles before copying rows`, async (t) => {
    const guard = 0x9951a321,
      program = kcsProgram([
        [37, guard],
        ...Array.from({ length: 10 }, (_, i) => [37, [0x13, 128 + i * 4]]),
        [43, 116, 40],
        [59],
      ]),
      world = await dataWorld(profile, { 'copy.kcs': program });
    t.after(() => world.close({ flushFiles: false }));
    const images = world.graphics.images,
      dest = images.create(4, 3, world.main.id),
      src = images.create(4, 3, world.main.id),
      source = Uint8ClampedArray.from({ length: 48 }, (_, i) => (i * 73 + 31) & 255),
      initial = Uint8ClampedArray.from({ length: 48 }, (_, i) => (i * 127 + 67) & 255),
      task = await world.spawnScript('copy.kcs', { initialExecute: false }),
      { machine } = task,
      sp = machine.sp;
    images.get(src).state.rgba = source;
    images.get(dest).state.rgba = initial.slice();
    [dest, 0, 0, 4, 3, src, -2, -1, 4, 3].forEach((word, i) => machine.store(128 + i * 4, word));
    assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    assert.equal(machine.sp, sp + 4);
    assert.equal(machine.pop(), guard);
    const expected = initial.slice();
    expected.set(source.subarray(16, 24), 16);
    expected.set(source.subarray(32, 40), 32);
    assert.deepEqual(await images.get(dest).pixels(), expected);
    assert.deepEqual(await images.get(src).pixels(), source);
  });

test('23 choice setup reads the caller parent and the authored bitmap attribute', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23');
  t.after(() => world.close());
  const child = await world.spawnScript('case.kcs', { parent: world.main.id }),
    { machine } = child,
    call = (id, args) => world.runtime.native('main', id, args, machine, child);
  assert.deepEqual(await call(76, []), { control: 1, value: world.nativeTaskID(world.main.id) });

  const handle = world.graphics.images.create(2, 1, child.id),
    bitmap = world.graphics.images.get(handle),
    outputs = [512, 516, 520, 524, 528],
    words = () => [...outputs, 532].map((address) => machine.load(address));
  bitmap.state.attributes = [{ id: 7, rect: [10, -20, 30, -40], color: 0xff800123 }];
  machine.bytes(512, 24).fill(0xa5);
  assert.deepEqual(await call(536, [handle, 0x10007, ...outputs]), { control: 1, value: 1 });
  assert.deepEqual(words(), [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123, 0xa5a5a5a5]);

  for (const args of [
    [0, 7, ...outputs],
    [handle, 8, ...outputs],
  ]) {
    const prior = words();
    assert.deepEqual(await call(536, args), { control: 1, value: 0 });
    assert.deepEqual(words(), prior);
  }
});

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original image commands preserve native pixels, VM attributes and composite handles`,
    { skip: !process.env[variable] },
    async () => {
      const f = await imageCommandsFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        { images, memory, process: p, machine: m } = f,
        call = (id, args) => f.commands.apply(id, args, m, { id: 1 }),
        h = images.create(4, 3, 1),
        s = images.create(4, 3, 1),
        alias = images.alias(s, 2);
      try {
        await images.get(s).fill(0, 0, 4, 3, 0xff123456);
        await call(0x73, [h, 0, 0, 4, 3, s, 0, 0, 4, 3]);
        assert.deepEqual([...(await images.get(h).pixels()).slice(0, 4)], [0x12, 0x34, 0x56, 255]);
        await images.get(h).fill(0, 0, 4, 3, 0xff010203);
        await call(0x74, [h, 1, 1, 2, 1, alias, 0, 0, 4, 3]);
        const copied = await images.get(h).pixels();
        assert.equal(
          Array.from({ length: 12 }, (_, i) => copied[i * 4] === 0x12).filter(Boolean).length,
          2,
        );
        const source = await memory.pointer(s),
          attribute = p.allocate(20);
        try {
          [10, -20, 30, -40, 0xff800123].forEach((v, i) => p.store(attribute + i * 4, v));
          await memory.call(memory.layout.attribute, [7, 0, attribute], source);
        } finally {
          p.free(attribute);
        }
        m.bytes(512, 28).fill(0xa5);
        assert.deepEqual(await call(0x218, [alias, 0x10007, 512, 516, 520, 524, 528]), {
          control: 1,
          value: 1,
        });
        assert.deepEqual(
          Array.from({ length: 6 }, (_, i) => m.load(512 + i * 4)),
          [10, -20 >>> 0, 30, -40 >>> 0, 0xff800123, 0xa5a5a5a5],
        );
        assert.deepEqual(await call(0x219, [h, alias]), { control: 1, value: 1 });
        assert.deepEqual(images.get(h).state.attributes, images.get(alias).state.attributes);
        const beforeAlias = structuredClone(images.get(s).state.attributes),
          first = p.load(p.load(p.load(source + 72))),
          attributeData = p.load(first + 20),
          released = [],
          stop = p.observeFree((address) => {
            if (address === first || address === attributeData) released.push(address);
          });
        try {
          assert.deepEqual(await call(0x219, [s, alias]), { control: 1, value: 1 });
        } finally {
          stop();
        }
        assert.deepEqual(released, [], 'self-copy keeps the native attribute node and its payload');
        assert.deepEqual(images.get(s).state.attributes, beforeAlias);
        [h, 0, 0, s, 0, 0, alias, 0, 0].forEach((v, i) => m.store(768 + i * 4, v));
        [0, 0, 4, 3].forEach((v, i) => m.store(832 + i * 4, v));
        const before = m.bytes(768, 80).slice();
        await call(0x78, [h, 768, 3, 832]);
        assert.deepEqual(m.bytes(768, 80), before, 'compositing keeps logical handle words in KCS');
        const composite = await images.get(h).pixels();
        // Both original wrappers leave their blend packet's opacity multiplier
        // at zero. RGBA sources therefore retain the opaque black clear.
        assert.deepEqual([...composite.slice(0, 4)], [0, 0, 0, 255]);
        assert.deepEqual(
          [...(await images.get(alias).pixels()).slice(0, 4)],
          [0x12, 0x34, 0x56, 255],
        );
        const rectangle = m.bytes(832, 16).slice();
        assert.deepEqual(await call(0x1be, [h, 832]), { control: 1, value: 1 });
        assert.deepEqual(
          m.bytes(832, 16),
          rectangle,
          'opaque-bounds query only returns the native Boolean',
        );
        const beforeFilter = composite.slice();
        images.get(h).state.canvasWidth = 4;
        images.get(h).state.canvasHeight = 3;
        await call(0x21a, [h, 0, 0]);
        assert.deepEqual(await images.get(h).pixels(), beforeFilter);
        const noCanvas = images.create(2, 2, 1);
        assert.deepEqual(await call(0x219, [noCanvas, noCanvas]), { control: 1, value: 1 });
        await call(0x21a, [noCanvas, 0, 0]);
        assert.deepEqual(
          [images.get(noCanvas).width, images.get(noCanvas).height],
          [0, 0],
          'the original filter obeys explicit zero canvas bounds of a new blank bitmap',
        );
        await images.get(h).fill(0, 0, 4, 3, 0);
        assert.deepEqual(
          await call(0x1be, [h, 832]),
          { control: 1, value: 1 },
          'an empty opaque rectangle still reports a successful bounds computation',
        );
        assert.deepEqual(await call(0x1be, [0]), { control: 1, value: 0 });
        await images.release(s);
        assert.equal(p.allocations.has(source), true);
        await call(0x73, [h, 0, 0, 4, 3, alias, 0, 0, 4, 3]);
        await images.releaseOwner(2);
        assert.equal(p.allocations.has(source), false);
        assert.deepEqual(await call(0x73, [0x41414141, 0, 0, 0, 0, 0]), { control: 2 });
        assert.deepEqual(await call(0x74, [0, 0, 0, 0, 0, 0x41414141]), { control: 2 });
        assert.deepEqual(await call(0x78, [0]), { control: 2 });
        assert.deepEqual(await call(0x219, [0, 0x41414141]), { control: 1, value: 0 });
      } finally {
        await f.engine.close();
      }
    },
  );

test(
  'SDK World image commands restore one original bitmap and release failed child Script resources',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      make = () => {
        const game = memoryGame({
            'engine.exe': exe,
            'main.kcs': kcsProgram([[37, 1024], [43, 0xd1, 4], [59]]),
          }),
          random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
        game.width = 64;
        game.height = 48;
        Object.assign(configuration.screen, {
          width: 64,
          height: 48,
          currentWidth: 64,
          currentHeight: 48,
          virtualWidth: 64,
          virtualHeight: 48,
        });
        return new NativeWorld({
          game,
          profile,
          random,
          configuration,
          images: {},
          host: {},
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, task),
        h = world.graphics.images.create(4, 3, task.id),
        s = world.graphics.images.create(4, 3, task.id);
      await world.graphics.images.get(s).fill(0, 0, 4, 3, 0xffabcdef);
      await call(0x73, [h, 0, 0, 4, 3, s, 0, 0, 4, 3]);
      const pointer = await (await world.getNativeFeature('bitmap-memory')).pointer(h),
        oldPixels = (await world.graphics.images.get(h).pixels()).slice();
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      assert.equal(await (await fresh.getNativeFeature('bitmap-memory')).pointer(h), pointer);
      const ft = fresh.main,
        fm = ft.machine;
      await fresh.graphics.images.get(s).fill(0, 0, 4, 3, 0xff010203);
      await fresh.runtime.native('main', 0x74, [h, 0, 0, 4, 3, s, 0, 0, 4, 3], fm, ft);
      assert.deepEqual(
        [...(await fresh.graphics.images.get(h).pixels()).slice(0, 4)],
        [1, 2, 3, 255],
      );
      assert.deepEqual(await world.graphics.images.get(h).pixels(), oldPixels);
      const child = await fresh.spawnScript('main.kcs', { parent: fresh.root }),
        ci = fresh.objects.objects.get(child.id).implementation,
        owned = (await fresh.runtime.native('main', 0x70, [2, 2], child.machine, child)).value,
        childPointer = await (await fresh.getNativeFeature('bitmap-memory')).pointer(owned);
      await fresh.runtime.native(
        'main',
        0x73,
        [owned, 0, 0, 2, 2, s, 0, 0, 2, 2],
        child.machine,
        child,
      );
      assert.equal(fresh.nativeEngine.process.allocations.has(childPointer), true);
      await ci.loadScript('missing.kcs', { nativeLoad: true });
      assert.equal(fresh.nativeEngine.process.allocations.has(childPointer), false);
      assert.equal(fresh.nativeEngine.process.allocations.has(pointer), true);
      await fresh.graphics.images.releaseOwner(ft.id);
      assert.equal(fresh.nativeEngine.process.allocations.has(pointer), false);
      assert.equal(world.nativeEngine.process.allocations.has(pointer), true);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
