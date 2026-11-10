// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageCompositeFixture, imageCompositeFiles } from './fixtures/image-composite-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} selector image factory preserves original pixels, metadata and explicit wrapper references`,
    { skip: !process.env[variable] },
    async () => {
      const f = await imageCompositeFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        m = f.machine,
        p = f.process,
        query = async (source, at = 0, clearStack = true) => {
          m.writeString(source, at);
          const before = [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
          if (clearStack) p.zero(p.stackTop - 0x6000, 0x6000);
          f.requests.length = 0;
          const reply = await f.composites.apply(0x1cc, [at], m, { id: 1 });
          assert.deepEqual(
            [m.memory, m.shared, ...m.blocks],
            before,
            'factory preserves VM input bytes',
          );
          return reply;
        };
      try {
        assert.deepEqual(await query(''), { control: 1, value: 0 });
        assert.deepEqual(await query('missing.hg3'), { control: 1, value: 0 });
        assert.deepEqual(await query('broken.hg3'), { control: 1, value: 0 });
        const h = (await query('x,1.hg3')).value,
          wrapper = await f.memory.wrapper(h),
          bitmap = await f.memory.pointer(h);
        assert.ok(h);
        assert.equal(p.allocations.get(wrapper), f.layout.wrapperBytes);
        assert.equal(p.load(wrapper + f.layout.wrapperReferences), 1);
        assert.equal(f.images.get(h).owner, null);
        assert.equal(
          f.factories.refs.contexts.size,
          0,
          '1CC does not register an automatic Script list',
        );
        assert.deepEqual(await f.images.get(h).pixels(), new Uint8ClampedArray(f.frames[0].rgba));
        await f.images.releaseOwner(1);
        assert.equal(
          p.allocations.has(wrapper),
          true,
          'Script cleanup cannot release an unregistered result',
        );
        const alias = f.images.alias(h);
        assert.equal(p.load(bitmap + 80), 2);
        await f.factories.apply(0x72, [h], m, { id: 1 });
        assert.equal(
          p.allocations.has(wrapper),
          false,
          'existing main72 frees the original wrapper',
        );
        assert.equal(
          p.load(bitmap + 80),
          1,
          'an explicit bitmap alias retains its original backing',
        );
        assert.deepEqual(
          await f.images.get(alias).pixels(),
          new Uint8ClampedArray(f.frames[0].rgba),
        );
        await f.images.release(alias);
        assert.equal(p.allocations.has(bitmap), false);
        const composite = (await query('x,1,2.hg3')).value,
          image = f.images.get(composite),
          rgba = await image.pixels();
        assert.deepEqual(
          [
            image.width,
            image.height,
            image.state.offsetX,
            image.state.offsetY,
            image.state.canvasWidth,
            image.state.canvasHeight,
            image.state.baseX,
            image.state.baseY,
          ],
          [3, 4, 0, 0, 9, 8, 2, 1],
        );
        assert.deepEqual(
          [...rgba.slice(9 * 4, 12 * 4)],
          [...f.frames[0].rgba.slice(3 * 4, 6 * 4)],
          'opaque bottom row',
        );
        assert.deepEqual(
          [...rgba.slice(6 * 4, 9 * 4)],
          [19, 56, 93, 255, 152, 189, 226, 255, 44, 81, 118, 255],
          'original alpha composition',
        );
        assert.deepEqual([...rgba.slice(4, 12)], [57, 94, 131, 128, 205, 242, 23, 128]);
        await f.images.release(composite);
        const block = m.allocate(128);
        for (const at of [0, 512, 4608, 0x80000020, block + 32]) {
          const selected = (await query('x,0,2.hg3', at)).value;
          assert.deepEqual(
            await f.images.get(selected).pixels(),
            new Uint8ClampedArray(f.frames[1].rgba),
          );
          assert.deepEqual(
            f.requests,
            new Array(4).fill('x_02.hg3'),
            'selector position determines zero padding',
          );
          await f.images.release(selected);
        }
        assert.deepEqual(await query('x,0,0.hg3'), { control: 1, value: 0 });
        const rgb = (await query('rgb.hg3')).value;
        assert.equal(
          f.images.get(rgb).state.bpp,
          profile.startsWith('sdk-') ? 3 : 4,
          'the original profile decoder selects its BPP',
        );
        await f.images.release(rgb);
        const named = (await query('abc,1,2.hg3')).value;
        assert.ok(named);
        assert.equal(f.requests[0], profile.startsWith('sdk-') ? 'abc_1.hg3' : '\u6261c_1.hg3');
        await f.images.release(named);
        if (!profile.startsWith('sdk-')) {
          const primed = (await query('single.hg3')).value;
          await f.images.release(primed);
          const uninitialized = await query('x,1,2.hg3', 0, false);
          assert.equal(uninitialized.value, 0);
          assert.notEqual(
            f.requests[0],
            'x_1.hg3',
            'the original wide read preserves leftover narrow-buffer bytes',
          );
        }
      } finally {
        await f.engine.close();
      }
    },
  );

test(
  'SDK World composite factory uses its original cache, explicit lifetime and fresh independent bitmap backing',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      make = () => {
        const authored = imageCompositeFiles(),
          files = Object.fromEntries([
            ...authored.files,
            ['engine.exe', executable],
            ['main.kcs', kcsProgram([[37, 1024], [43, 0x47, 4], [59]])],
          ]),
          game = memoryGame(files),
          random = new ParticleRandom(),
          requests = [],
          originalRead = game.read;
        game.nativeResources = { resolve: (name) => name };
        game.read = async (name) => {
          requests.push(name);
          return originalRead(name);
        };
        const world = new NativeWorld({
          game,
          profile,
          random,
          images: {},
          host: {},
          configuration: new NativeConfiguration({ profile }),
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
        return { world, requests, files };
      },
      original = make(),
      world = original.world,
      query = async (world) => {
        world.main.machine.writeString('x,1,2.hg3', 512);
        return world.runtime.native('main', 0x1cc, [512], world.main.machine, world.main);
      };
    let fresh;
    try {
      await world.initialize('main.kcs');

      const h = (await query(world)).value;
      const memory = await world.getNativeFeature('bitmap-memory'),
        wrapper = await memory.wrapper(h),
        p = world.nativeEngine.process,
        bitmap = await memory.pointer(h),
        expected = (await world.graphics.images.get(h).pixels()).slice();
      assert.ok(h);
      assert(original.requests.some((name) => name.endsWith('x_1.hg3')));
      original.requests.length = 0;
      const second = (await query(world)).value;
      assert.equal(
        original.requests.length,
        0,
        'the original initialized-view cache avoids all file opens',
      );
      assert.deepEqual(await world.graphics.images.get(second).pixels(), expected);
      const factories = await world.getNativeFeature('bitmap-factories');
      assert.equal(factories, world.bitmapFactories);
      const restored = make();
      fresh = restored.world;
      await fresh.restore(structuredClone(world.snapshot()));
      const restoredMemory = await fresh.getNativeFeature('bitmap-memory');
      assert.equal(await restoredMemory.wrapper(h), wrapper);
      assert.equal(await restoredMemory.pointer(h), bitmap);
      assert.deepEqual(await fresh.graphics.images.get(h).pixels(), expected);
      delete restored.files['x_1.hg3'];
      delete restored.files['x_02.hg3'];
      restored.requests.length = 0;
      const cached = (await query(fresh)).value;
      assert.ok(cached);
      assert.deepEqual(await fresh.graphics.images.get(cached).pixels(), expected);
      assert.equal(
        restored.requests.length,
        0,
        'the restored cache retains its original image references',
      );
      const fm = fresh.main.machine;
      await fresh.runtime.native('main', 0x72, [h], fm, fresh.main);
      assert.equal(fresh.nativeEngine.process.allocations.has(wrapper), false);
      assert.equal(p.allocations.has(wrapper), true, 'source process remains independent');
      await fresh.objects.objects
        .get(fresh.main.id)
        .implementation.loadScript('missing.kcs', { nativeLoad: true });
      assert.deepEqual(
        await fresh.graphics.images.get(cached).pixels(),
        expected,
        'Script reload leaves explicitly owned results alive',
      );
      await fresh.graphics.images.release(cached);
      await fresh.graphics.images.release(second);
      assert.equal(fresh.nativeEngine.process.allocations.has(await memory.wrapper(second)), false);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
