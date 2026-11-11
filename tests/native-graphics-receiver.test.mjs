// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { conditionalNativeGraphicsBoundary } from '../src/native/exe-boundary.mjs';
import { installGraphicsOracle } from './fixtures/graphics-oracle-world.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { floatBits, bitsFloat } from '../src/kcs.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';

test('conditional graph boundaries retain original code and select host calls with stdcall cleanup', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    p = engine.process,
    code = p.allocate(16, true),
    protection = p.allocate(4, true),
    bytes = Uint8Array.of(0x8b, 0x44, 0x24, 4, 0x83, 0xc0, 3, 0xc2, 4, 0);
  let boundary;
  try {
    p.write(code, bytes);
    p.call(engine.kernel.resolve({ dll: 'KERNEL32.dll', name: 'VirtualProtect' }), [
      code,
      16,
      0x40,
      protection,
    ]);
    boundary = conditionalNativeGraphicsBoundary(
      engine,
      code,
      'authored graph selector',
      1,
      ([value]) => value === 8,
      async ([value]) => {
        await Promise.resolve();
        return value * 7;
      },
    );
    assert.deepEqual(p.read(code, bytes.length), bytes);
    assert.equal(await engine.call(code, [4]), 7);
    assert.equal(await engine.call(code, [8]), 56);
    assert.equal(await engine.call(code, [9]), 12);
    assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0, p.stackTop);
  } finally {
    boundary?.detach();
    await engine.close();
  }
});

const packet = (words) => {
  const bytes = new Uint8Array(128),
    view = new DataView(bytes.buffer);
  words.forEach((word, i) => view.setUint32(i * 4, word, true));
  return {
    bytes: (address, size) => bytes.subarray(address, address + size),
    load: (address) => view.getUint32(address, true),
    write: (address, source) => bytes.set(source, address),
  };
};
test(
  'the original SDK plane packet receiver mutates the real GraphManager and registers its base input child',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      game = memoryGame({
        'engine.exe': new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
        'main.kcs': kcsProgram([[37, 1024], [43, 0xd1, 4], [43, 0x41, 0], [59]]),
      }),
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
    const world = new NativeWorld({
      game,
      profile,
      configuration,
      images: {},
      host: {},
      motionLibrary: new MotionLibrary(game, { profile }),
      random: new ParticleRandom(),
      storage: { read: async () => null, write: async () => true },
    });
    let fresh;
    try {
      installGraphicsOracle(world);
      await world.initialize('main.kcs');
      const id = await world.objects.create({
          kind: 2,
          parent: world.main.id,
          name: 'Authored plane',
        }),
        task = world.graphics.get(id),
        platform = await world.getNativeFeature('graphics-platform');
      await platform.ensureRenderer();
      const source = packet([0, 0, 0, floatBits(12), floatBits(7), 0, 0, 0xff314159]),
        send = (message, w, l, context = {}) =>
          world.sendEngine(id, world.main.id, message, w, l, context);
      assert.equal(await send(42, 0, 0, { payload: source }), NATIVE_UNWRITTEN_WORD);
      // The host graph adapter was not called: the real model lives in the
      // original GraphManager, while no derived browser graph exists yet.
      assert.equal(task.graph, null);
      const size = packet([]);
      assert.equal(await send(75, 0, 4, { payload: size }), NATIVE_UNWRITTEN_WORD);
      assert.deepEqual([bitsFloat(size.load(0)), bitsFloat(size.load(4))], [12, 7]);
      await send(49, 0, 0, {
        payload: packet([floatBits(3), floatBits(5), floatBits(17)]),
      });
      const base = packet([]);
      await send(61, 0, 0, { payload: base });
      assert.deepEqual(
        [0, 4, 8].map((at) => bitsFloat(base.load(at))),
        [3, 5, 17],
      );
      const button = await world.objects.create({ kind: 6, parent: id, name: 'Authored input' });
      const binding = packet([1, 2, 9, 10, 7, 0]);
      assert.equal(
        await world.sendEngine(button, world.main.id, 89, 0, 0, { payload: binding }),
        1,
      );
      const input = world.inputFor(button),
        region = input.get(button);
      assert.ok(region);
      assert.deepEqual(region.bounds, [1, 2, 9, 10]);
      assert.equal(region.priority, 7);
      let valueBeforeChild;
      world.objects.register(0x7ffd, (record) => ({
        ...world.base(record),
        async tick() {
          valueBeforeChild = world.nativeEngine.process.load(
            world.graphics.get(button).pointer + 120,
          );
          await world.sendEngine(button, record.id, 94, 0, 7);
        },
      }));
      await world.objects.create({ kind: 0x7ffd, parent: button, name: 'Input word observer' });
      await world.sendEngine(button, world.main.id, 94, 0, 99);
      await world.tick();
      assert.equal(valueBeforeChild, 0);
      assert.equal(await world.sendEngine(button, world.main.id, 4), 7);
      assert.equal(await world.sendEngine(button, world.main.id, 4), 0);
      await world.objects.release(button);
      assert.equal(input.get(button), null);
      const unknown = {};
      assert.equal(await send(0x7ffe, 0, 0, unknown), NATIVE_UNWRITTEN_WORD);
      assert.equal(unknown.nativeUnhandled, true);
      const saved = structuredClone(world.snapshot());
      fresh = new NativeWorld({
        game,
        profile,
        configuration: new NativeConfiguration({ profile }),
        images: {},
        host: {},
        random: new ParticleRandom(),
        motionLibrary: new MotionLibrary(game, { profile }),
        storage: { read: async () => null, write: async () => true },
      });
      installGraphicsOracle(fresh);
      await fresh.ensureNativeEngine();
      fresh.nativeEngine.process.trap('authored earlier transient trap', 0, () => 0);
      await fresh.restore(saved);
      const result = packet([]);
      await fresh.sendEngine(id, fresh.main.id, 61, 0, 0, { payload: result });
      assert.deepEqual(
        [0, 4, 8].map((at) => bitsFloat(result.load(at))),
        [3, 5, 17],
      );
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
