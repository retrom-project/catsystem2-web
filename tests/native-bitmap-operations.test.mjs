// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bitmapMemoryFixture } from './fixtures/bitmap-memory-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

test('2.6.1.23 both resize slots preserve the original pixel cells and bitmap metadata', async (t) => {
  const profile = 'grisaia-jp-engine-2.6.1.23',
    guard = 0x17fce129,
    width = 15,
    height = 11,
    programs = Object.fromEntries(
      [122, 705].map((id) => [
        id + '.kcs',
        kcsProgram([
          [37, guard],
          ...[64, 68, 72].map((address) => [37, [0x13, address]]),
          [43, id, 12],
          [59],
        ]),
      ]),
    ),
    expected = [
      126, 118, 127, 133, 134, 135, 127, 122, 134, 126, 135, 129, 132, 122, 112, 118, 116, 125, 134,
      134, 121, 128, 115, 131,
    ];
  const world = await dataWorld(profile, programs);
  t.after(() => world.close({ flushFiles: false }));
  async function resize(id, handle, w, h) {
    const caller = await world.spawnScript(id + '.kcs'),
      machine = caller.machine,
      first = machine.sp;
    try {
      [handle, w, h].forEach((word, i) => machine.store(64 + i * 4, word));
      await world.runtime.scheduler.execute(caller);
      assert.equal(machine.sp, first + 4);
      assert.equal(machine.load(first), guard);
    } finally {
      await world.objects.release(caller.id);
    }
  }
  function make(bpp) {
    const handle = world.graphics.images.create(width, height, world.main.id),
      bitmap = world.graphics.images.get(handle),
      rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const native = ((height - 1 - y) * width + x) * 29 + 24;
        rgba.set(
          [(native * 3) & 255, (native * 2) & 255, native & 255, (native + 3 * x) & 255],
          (y * width + x) * 4,
        );
      }
    Object.assign(bitmap.state, {
      rgba,
      bpp,
      canvasWidth: width,
      canvasHeight: height,
      baseX: -2,
      baseY: 1,
    });
    return { handle, bitmap };
  }
  for (const id of [122, 705]) {
    const rgba = make(4);
    await resize(id, rgba.handle, 3, 2);
    assert.deepEqual([...(await rgba.bitmap.pixels())], expected);
    assert.deepEqual(rgba.bitmap.state.clip, [0, 0, 3, 2]);
    assert.deepEqual(
      [
        rgba.bitmap.state.canvasWidth,
        rgba.bitmap.state.canvasHeight,
        rgba.bitmap.state.baseX,
        rgba.bitmap.state.baseY,
      ],
      [3, 2, 0, 0],
    );

    const rgb = make(3),
      initial = rgb.bitmap.snapshot();
    await resize(id, rgb.handle, 7, 7);
    assert.deepEqual(rgb.bitmap.snapshot(), initial);
    await assert.rejects(resize(id, rgb.handle, 3, 2), /24-bit bitmap source boundary/);
    assert.deepEqual(rgb.bitmap.snapshot(), initial);

    await resize(id, rgb.handle, 0, 4);
    assert.deepEqual([rgb.bitmap.width, rgb.bitmap.height], [0, 4]);
    assert.equal((await rgb.bitmap.pixels()).length, 0);
    await resize(id, 0, 0xffffffff, 0xffffffff);
  }
});
for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} bitmap operations retain native base/canvas/offset, alpha and color contracts`,
    { skip: !process.env[variable] },
    async () => {
      const f = await bitmapMemoryFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        { machine: m } = f,
        h = f.images.create(2, 2, 1),
        call = (id, args) => f.operations.apply(id, args, m, { id: 1 });
      const fillOriginal = async (color) => {
        const bitmap = f.images.get(h);
        assert.equal(await bitmap.fill(0, 0, 2, 2, color), true);
        // The direct oracle fixture publishes its materialized bitmap explicitly.
        await f.memory.changed(bitmap.dataHandle);
      };
      try {
        await call(0x174, [h, 5, 4]);
        await call(0x175, [h, -1, 2]);
        await call(0x176, [h, -3, 7]);
        m.bytes(0, 12).fill(0xa5);
        assert.equal((await call(0x173, [h, 0, 4])).value, 1);
        assert.deepEqual([m.load(0) | 0, m.load(4) | 0, m.load(8)], [-3, 7, 0xa5a5a5a5]);
        assert.deepEqual(
          [f.images.get(h).state.canvasWidth, f.images.get(h).state.canvasHeight],
          [5, 4],
        );
        assert.deepEqual(await call(0x16a, [h, 0, 4]), { control: 2 });
        assert.deepEqual([m.load(0), m.load(4), m.load(8)], [5, 4, 0xa5a5a5a5]);
        assert.deepEqual(await call(0x16b, [h, 0, 4]), { control: 2 });
        assert.deepEqual([m.load(0) | 0, m.load(4) | 0, m.load(8)], [-1, 2, 0xa5a5a5a5]);
        await call(0x16a, [0, 0, 4]);
        assert.deepEqual([m.load(0), m.load(4), m.load(8)], [0, 0, 0xa5a5a5a5]);
        await call(0x16b, [0, 0, 4]);
        assert.deepEqual([m.load(0), m.load(4), m.load(8)], [0, 0, 0xa5a5a5a5]);
        await call(0x174, [h, 0, 0]);
        await call(0x16a, [h, 0, 4]);
        assert.deepEqual(
          [m.load(0), m.load(4)],
          [2, 2],
          'zero canvas dimensions fall back to native image dimensions',
        );
        await call(0x174, [h, 5, 4]);
        await fillOriginal(0x80224466);
        if (profile.startsWith('nekopara-')) {
          assert.equal((await call(0x402, [h, -1, 2])).value, 0x80224466);
          assert.equal((await call(0x402, [h, 100, 100])).value, 0);
          assert.equal((await call(0x402, [0])).value, 0);
        } else assert.equal(await call(0x402, [h, -1, 2]), undefined);
        await call(0x171, [h, 0xff808080]);
        assert.equal((await call(0x172, [h, -1, 2])).value, 128);
        assert.equal((await call(0x172, [h, 100, 100])).value, 0);
        assert.equal((await call(0x179, [h])).value, 1);
        assert.equal((await call(0x179, [0])).value, 0xcccccccc);
        await call(0x178, [h, 3]);
        assert.deepEqual([...(await f.images.get(h).pixels()).slice(0, 4)], [238, 221, 204, 128]);
        await call(0x17a, [h, 0]);
        assert.equal((await call(0x179, [h])).value, 0);
        assert.equal((await call(0x172, [h, -1, 2])).value, 128);
        await call(0x17a, [h, 1]);
        assert.equal((await call(0x179, [h])).value, 1);
        const target = f.images.create(2, 2, 1);
        await call(0x175, [h, 0, 0]);
        await fillOriginal(0xff123456);
        await call(0x171, [h, 0xffffffff]);
        await call(0x16f, [target, 0, 0, 2, 2, h, 0, 0, 2, 2]);
        assert.deepEqual(
          [...(await f.images.get(target).pixels())],
          Array.from({ length: 4 }, () => [0x12, 0x34, 0x56, 255]).flat(),
        );
      } finally {
        await f.engine.close();
      }
    },
  );

test(
  'SDK World bitmap operations restore live original aliases and release by Script owner',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      make = () => {
        const game = memoryGame({
            'engine.exe': executable,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom();
        Object.assign(configuration.screen, {
          width: 640,
          height: 480,
          currentWidth: 640,
          currentHeight: 480,
          virtualWidth: 640,
          virtualHeight: 480,
        });
        return new NativeWorld({
          game,
          configuration,
          random,
          profile,
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
      const m = world.main.machine,
        h = world.graphics.images.create(3, 2, world.main.id),
        alias = world.graphics.images.alias(h, 73);
      await world.graphics.images.get(h).fill(0, 0, 3, 2, 0x88224466);
      await world.runtime.native('main', 0x171, [h, 0xff808080], m, world.main);
      await world.runtime.native('main', 0x176, [h, -7, 13], m, world.main);
      const memory = await world.getNativeFeature('bitmap-memory'),
        pointer = await memory.pointer(h),
        wrapper = await memory.wrapper(alias),
        state = structuredClone(world.snapshot());
      fresh = make();
      await fresh.restore(state);
      const fm = fresh.main.machine,
        feature = await fresh.getNativeFeature('bitmap-memory');
      assert.equal(await feature.pointer(h), pointer);
      assert.equal(await feature.wrapper(alias), wrapper);
      await fresh.runtime.native('main', 0x16a, [alias, 0, 4], fm, fresh.main);
      assert.deepEqual([fm.load(0), fm.load(4)], [3, 2]);
      await fresh.runtime.native('main', 0x175, [alias, -11, 19], fm, fresh.main);
      await fresh.runtime.native('main', 0x16b, [h, 0, 4], fm, fresh.main);
      assert.deepEqual([fm.load(0) | 0, fm.load(4) | 0], [-11, 19]);
      assert.equal(world.graphics.images.get(h).state.offsetX, 0);
      await fresh.runtime.native('main', 0x175, [alias, 0, 0], fm, fresh.main);
      fm.bytes(0, 12).fill(0xa5);
      await fresh.runtime.native('main', 0x173, [alias, 0, 4], fm, fresh.main);
      assert.deepEqual([fm.load(0) | 0, fm.load(4) | 0, fm.load(8)], [-7, 13, 0xa5a5a5a5]);
      await fresh.graphics.images.get(alias).fill(0, 0, 3, 2, 0xffabcdef);
      await fresh.runtime.native('main', 0x171, [alias, 0xffffffff], fm, fresh.main);
      assert.deepEqual(
        [...(await fresh.graphics.images.get(h).pixels()).slice(0, 4)],
        [0xab, 0xcd, 0xef, 255],
      );
      assert.deepEqual(
        [...(await world.graphics.images.get(h).pixels()).slice(0, 4)],
        [0x11, 0x22, 0x33, 0x88],
      );
      await fresh.graphics.images.releaseOwner(fresh.main.id);
      assert.equal(feature.process.allocations.has(pointer), true);
      assert.equal(await feature.pointer(alias), pointer);
      await fresh.graphics.images.releaseOwner(73);
      assert.equal(feature.process.allocations.has(pointer), false);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
