// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const [profile, variable, wide] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', false],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', true],
])
  test(
    `${profile} cold platform enumerates display and sound before creating a view device`,
    { skip: !process.env[variable] },
    async () => {
      const game = memoryGame({
          'engine.exe': new Uint8Array(await readFile(process.env[variable])),
          'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
        }),
        make = () => {
          const random = new ParticleRandom();
          return new NativeWorld({
            game,
            profile,
            random,
            images: {},
            audio: {},
            host: {},
            bootstrapOwner: {},
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
            motionLibrary: new MotionLibrary(game, { profile, random }),
            storage: { read: async () => null, write: async () => true },
          });
        },
        audioQuery = `dsound.dll!DirectSoundEnumerate${wide ? 'W' : 'A'}`,
        first = make(),
        fresh = make();
      try {
        const renderer = await first.getNativeFeature('renderer'),
          caps = await renderer.initializeCapabilities(),
          read = (device) => {
            const p = device.process,
              sounds = p.load(caps + 1732),
              head = p.load(sounds);
            assert.equal(device.initialized, false);
            assert.equal(device.d3d.deviceCreated, false);
            assert.equal(p.load(device.layout.capsGlobal), caps);
            assert.equal(p.load(caps + 1736), 1);
            assert.equal(p.load(caps + 88), 4096);
            assert.equal(p.load(sounds + 4), 1);
            return p.string(p.load(head) + 8, wide);
          };
        assert.equal(read(renderer), 'Browser audio output');
        assert.equal(first.nativeEngine.kernel.calls.get(audioQuery), 1);
        const restored = await fresh.getNativeFeature('renderer');
        fresh.nativeEngine.restore(structuredClone(first.nativeEngine.snapshot()));
        assert.equal(await restored.initializeCapabilities(), caps);
        assert.equal(read(restored), 'Browser audio output');
        assert.equal(fresh.nativeEngine.kernel.calls.has(audioQuery), false);
      } finally {
        await fresh.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );

test(
  'SDK full original display/view/core/manager/DIB initialization owns one device and restores all original pointers',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      profile = 'sdk-4.01-engine-2.6.1.74',
      create = () => {
        const game = memoryGame({
            'engine.exe': bytes,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
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
          images: {},
          host: {},
          profile,
          random,
          configuration,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = create();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const renderer = await world.getNativeFeature('renderer'),
        platform = await world.getNativeFeature('graphics-platform'),
        p = renderer.process;
      assert.equal(renderer.initialized, true);
      assert.equal(await platform.ensureRenderer(), renderer);
      assert.equal(renderer.d3d.device, p.load(renderer.core + 308));
      assert.equal(p.load(renderer.view + 4), renderer.view3D);
      assert.equal(p.load(renderer.view + 8), platform.refs.manager);
      assert.equal(p.load(renderer.view3D + 4), platform.refs.manager);
      assert.deepEqual(
        [
          p.allocations.get(renderer.view),
          p.allocations.get(renderer.view3D),
          p.allocations.get(renderer.core),
          p.allocations.get(platform.refs.manager),
        ],
        [0x118, 0xc8, 0x670, 0x220],
      );
      assert.equal(p.load(0xc93b94), renderer.refs.caps);
      assert.equal(p.load(renderer.refs.caps + 88), 4096);
      const dib = p.load(renderer.view + renderer.layout.bitmap),
        pixels = p.load(renderer.view + renderer.layout.bits),
        text = await world.getNativeFeature('text');
      assert.equal(text.windows.object(dib, 'bitmap').pixels, pixels);
      p.write(pixels, Uint8Array.of(1, 2, 3, 4));
      const saved = structuredClone(world.snapshot()),
        snapshot = renderer.snapshot();
      fresh = create();
      await fresh.restore(saved);
      const restored = await fresh.getNativeFeature('renderer'),
        restoredPlatform = await fresh.getNativeFeature('graphics-platform');
      assert.equal(restored.initialized, true);
      assert.deepEqual(restored.snapshot(), snapshot);
      assert.equal(restoredPlatform.refs.view, renderer.view);
      assert.deepEqual([...restored.process.read(pixels, 4)], [1, 2, 3, 4]);
      restored.process.write(pixels, Uint8Array.of(8, 7, 6, 5));
      assert.deepEqual([...p.read(pixels, 4)], [1, 2, 3, 4]);
      assert.equal(restored.d3d.device, restored.process.load(restored.core + 308));
      const taskMemory = await fresh.getNativeFeature('task-memory'),
        root = await taskMemory.pointer(fresh.root),
        script = await taskMemory.pointer(fresh.main.id);
      assert.equal(restored.process.load(root + 104), restored.view);
      assert.equal(restored.process.load(script + 116), restored.view);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
