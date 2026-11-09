// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
import { floatBits } from '../src/kcs.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

test(
  'SDK retained draw keeps the original 64-byte image owner alive across release and a fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      rgba = Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : ((i >>> 2) * 17 + (i % 4) * 53 + 11) & 255,
      ),
      image = await encodeHG2({ width: 4, height: 3, rgba }, { crop: false }),
      make = () => {
        const game = memoryGame({
            'engine.exe': executable,
            'main.kcs': kcsProgram([[37, 1024], [59]]),
            '@cat/image/panel.hg2': image,
          }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom();
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
        game.resolveCategory = (name, category) =>
          game.has(name) ? name : `@cat/${category}/${name}`;
        game.readCategory = (name, category) => game.read(game.resolveCategory(name, category));
        return new NativeWorld({
          game,
          profile,
          images: {},
          host: {},
          configuration,
          random,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        machine = task.machine,
        call = (id, args) => world.runtime.native('main', id, args, machine, task),
        surface = await world.objects.create({
          kind: 15,
          parent: task.id,
          name: 'Authored image-owner draw',
        }),
        nativeSurface = world.nativeTaskID(surface),
        draw = world.graphics.drawTasks.get(surface);
      await call(0x100, [nativeSurface, 8, 6]);
      await call(0x104, [nativeSurface, 2, 3]);
      machine.writeString('panel.hg2', 256);
      const handle = (await call(0x2c6, [256])).value,
        owners = await world.getNativeFeature('image-owners'),
        pointer = owners.pointer(handle),
        p = world.nativeEngine.process;
      assert.equal(p.load(pointer), 1);
      const reference = p.allocate(60, true),
        pose = p.allocate(24, true),
        expected = new Uint8ClampedArray(8 * 6 * 4);
      // Exercise the original manager's owner-source entry directly as an
      // independent reference for the KCS packet -> retained-record path.
      await world.nativeEngine.call(0x5e3720, [8, 6, 4, 0], reference);
      try {
        [1, 1, 0, 0, 1, 1].forEach((value, i) => p.store(pose + i * 4, floatBits(value)));
        await world.nativeEngine.call(
          0x5e3d70,
          [17, pointer, pose, pose + 8, 0, pose + 16, 255, 1, 0],
          reference,
        );
        await world.nativeEngine.call(0x5e45e0, [0, 0, 0], reference);
        const bitmap = p.load(p.load(reference + 8)),
          data = p.load(bitmap + 12),
          stride = p.load(bitmap + 20);
        for (let y = 0; y < 6; y++) {
          const row = p.read(data + (5 - y) * stride, 8 * 4);
          for (let x = 0; x < 8; x++) {
            const source = x * 4,
              at = (y * 8 + x) * 4;
            expected.set([row[source + 2], row[source + 1], row[source], row[source + 3]], at);
          }
        }
      } finally {
        await world.nativeEngine.call(0x5e39e0, [], reference);
        p.free(pose);
        p.free(reference);
      }
      assert.equal(p.load(pointer), 1);
      assert.equal(Array.from(expected).filter((_, i) => i % 4 === 3 && expected[i]).length, 12);
      await call(0x2db, [
        nativeSurface,
        7,
        handle,
        ...[1, 1, 0, 0, 0, 1, 1].map(floatBits),
        255,
        1,
        0,
      ]);
      assert.equal(p.load(pointer), 2, 'the original retained record owns a real reference');
      const retained = await world.getNativeFeature('retained-draw'),
        key = (world.nativeTaskID(task.id) | (7 << 16)) >>> 0,
        record = retained.record(draw, key);
      assert.equal(record.kind, 3);
      assert.equal(record.source, pointer);
      await call(0x154, [nativeSurface]);
      const bitmap = world.graphics.images.get(draw.state.renderer.bitmap),
        pixels = (await bitmap.pixels()).slice();
      assert.deepEqual(pixels, expected, 'all asymmetric source rows reach the CPU surface');
      await call(0x2c7, [handle]);
      assert.equal(p.load(pointer), 1);
      assert.throws(() => owners.pointer(handle), /released|Unknown/);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.graphics.drawTasks.get(surface),
        restoredRetained = await fresh.getNativeFeature('retained-draw'),
        fp = fresh.nativeEngine.process;
      assert.equal(restoredRetained.record(restored, key).source, pointer);
      assert.equal(fp.load(pointer), 1);
      restored.state.dirty = true;
      restored.state.renderer.dirtyRects = [[0, 0, 8, 6]];
      await restored.render();
      assert.deepEqual(
        await fresh.graphics.images.get(restored.state.renderer.bitmap).pixels(),
        expected,
      );
      await fresh.runtime.native('main', 0x102, [nativeSurface, 7], fresh.main.machine, fresh.main);
      assert.equal(
        fp.allocations.has(pointer),
        false,
        'removing the last record runs owner destruction',
      );
      assert.equal(
        p.allocations.has(pointer),
        true,
        'the original World owns its independent reference',
      );
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
