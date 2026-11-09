// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeRectangles } from '../src/native/rectangles.mjs';
import { rectangleFixture } from './fixtures/rectangle-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

const put = (machine, at, values) => values.forEach((value, i) => machine.store(at + i * 4, value)),
  get = (machine, at) => Array.from({ length: 4 }, (_, i) => machine.load(at + i * 4) | 0);

test('shared rectangle platform services match 748 pinned Wine signed, empty and aliased cases', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-rectangles-golden.json', import.meta.url)),
    ),
    engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    p = engine.process,
    out = p.allocate(24),
    a = p.allocate(16),
    b = p.allocate(16);
  new NativeRectangles(engine, { objects: { machine: () => null } });
  try {
    assert.equal(golden.cases.length, 748);
    for (const [index, row] of golden.cases.entries()) {
      p.store(out, 0xa5a5a5a5);
      p.store(out + 20, 0x5a5a5a5a);
      row.a.forEach((word, i) => {
        p.store(a + i * 4, word);
        p.store(out + 4 + i * 4, word);
      });
      row.b.forEach((word, i) => p.store(b + i * 4, word));
      if (row.alias === 2) row.b.forEach((word, i) => p.store(out + 4 + i * 4, word));
      const first = row.alias === 1 ? out + 4 : a,
        second = row.alias === 2 ? out + 4 : b,
        args = row.operation.endsWith('RectEmpty') ? [out + 4] : [out + 4, first, second];
      assert.equal(
        await engine.call(engine.kernel.resolve({ dll: 'USER32.dll', name: row.operation }), args),
        row.result,
        'result/' + index,
      );
      assert.deepEqual(
        Array.from({ length: 6 }, (_, i) => p.load(out + i * 4)),
        row.output,
        'whole output/canaries/' + index,
      );
    }
  } finally {
    await engine.close();
  }
});

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original RECT wrappers preserve VM zero, partial aliases, raw bitmap dimensions and overflow`,
    { skip: !process.env[variable] },
    async () => {
      const f = await rectangleFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        m = f.machine,
        call = (id, args) => f.feature.apply(id, args, m, { id: 1 });
      try {
        m.memory.fill(0xa5);
        assert.deepEqual(await call(0xd6, [0]), { control: 2 });
        assert.deepEqual(get(m, 0), [0, 0, 0, 0]);
        assert.equal(m.load(16), 0xa5a5a5a5);
        assert.deepEqual(await call(0xd9, [0]), { control: 1, value: 1 });
        put(m, 0, [9, 7, 20, 30]);
        put(m, 32, [-5, -9, 4, 5]);
        assert.deepEqual(await call(0xd7, [0, 32]), { control: 2 });
        assert.deepEqual(get(m, 0), [-5, -9, 20, 30]);
        put(m, 128, [0, 0, 10, 10]);
        m.store(144, 20);
        await call(0xd7, [128, 132]);
        assert.deepEqual(
          get(m, 128),
          [0, 0, 10, 20],
          'both overlapping source rectangles are read before writing',
        );
        f.bitmap(17, 7, 9, { canvasWidth: 1000, canvasHeight: 2000, offset: -700 });
        await call(0xd6, [0]);
        assert.deepEqual(await call(0xd8, [0, 17, -10, -20]), { control: 2 });
        assert.deepEqual(get(m, 0), [-10, -20, -3, -11]);
        await call(0xda, [0, -8, -18, 10, 0]);
        assert.deepEqual(get(m, 0), [-8, -18, -3, -11]);
        assert.equal((await call(0xd9, [0])).value, 0);
        await call(0xd8, [0, 0, 100000, 100000]);
        assert.deepEqual(
          get(m, 0),
          [-8, -18, -3, -11],
          'null bitmap contributes an empty rectangle',
        );
        await call(0xd6, [0]);
        await call(0xd8, [0, 17, 0x7ffffffe, 0x7fffffff]);
        assert.deepEqual(get(m, 0), [0, 0, 0, 0], 'wrapped right/bottom make this rectangle empty');
        f.bitmap(17, 0x80000000, 9);
        await call(0xd8, [0, 17, -1, 0]);
        assert.deepEqual(get(m, 0), [-1, 0, 0x7fffffff, 9]);
      } finally {
        await f.engine.close();
      }
    },
  );

test(
  'SDK World RECT calls share the live VM and persistent bitmap wrapper through fresh World restore',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      make = () => {
        const game = memoryGame({
            'engine.exe': executable,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          random = new ParticleRandom();
        return new NativeWorld({
          game,
          profile,
          random,
          images: {},
          host: {},
          configuration: new NativeConfiguration({ profile }),
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make(),
      call = (world, id, args) =>
        world.runtime.native('main', id, args, world.main.machine, world.main);
    let fresh;
    try {
      await world.initialize('main.kcs');
      const bitmap = world.graphics.images.create(7, 9, world.main.id),
        image = world.graphics.images.get(bitmap);
      Object.assign(image.state, { canvasWidth: 1000, canvasHeight: 2000, offsetX: -700 });
      await call(world, 0xd6, [0]);
      await call(world, 0xd8, [0, bitmap, -10, -20]);
      assert.deepEqual(get(world.main.machine, 0), [-10, -20, -3, -11]);
      const memory = await world.getNativeFeature('bitmap-memory'),
        pointer = await memory.wrapper(bitmap);
      assert.equal(
        world.nativeEngine.process.load(world.nativeEngine.process.load(pointer) + 28),
        1000,
      );
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      assert.equal(await (await fresh.getNativeFeature('bitmap-memory')).wrapper(bitmap), pointer);
      await call(fresh, 0xda, [0, -8, -18, 10, 0]);
      assert.deepEqual(get(fresh.main.machine, 0), [-8, -18, -3, -11]);
      assert.deepEqual(get(world.main.machine, 0), [-10, -20, -3, -11]);
      await call(fresh, 0xd6, [0]);
      fresh.graphics.images.get(bitmap).state.canvasWidth = 555;
      await call(fresh, 0xd8, [0, bitmap, 4, 5]);
      assert.deepEqual(get(fresh.main.machine, 0), [4, 5, 11, 14]);
      assert.equal(world.graphics.images.get(bitmap).state.canvasWidth, 1000);
      assert.equal(fresh.graphics.images.get(bitmap).state.canvasWidth, 555);
      put(fresh.main.machine, 32, [-1, -2, 6, 7]);
      await call(fresh, 0xd7, [0, 32]);
      assert.deepEqual(get(fresh.main.machine, 0), [-1, -2, 11, 14]);
      assert.deepEqual(await call(fresh, 0xd9, [0]), { control: 1, value: 0 });
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
