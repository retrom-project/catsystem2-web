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
