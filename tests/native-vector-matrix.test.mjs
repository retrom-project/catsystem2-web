// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGeometry } from '../src/native/geometry.mjs';
import { NativeMatrices } from '../src/native/matrix.mjs';
import { KCSMachine, floatBits, bitsFloat } from '../src/kcs/vm.mjs';
import { Binary } from '../src/binary.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  const machine = () =>
    new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(1024),
        stackSize: 1024,
      },
      {},
      new Uint8Array(256),
    );
  test(
    `${profile} matrix/vector wrappers preserve pointer operands, overlap and native global state`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({ bytes, profile }),
        geometry = new NativeGeometry(engine, { objects: { machine: () => null } }),
        matrices = new NativeMatrices(engine),
        m = machine(),
        call = (id, args) => geometry.apply(id, args, m, { id: 1 }),
        floats = (at, values) =>
          values.forEach((v, i) => m.store((at + i * 4) >>> 0, floatBits(v))),
        read = (at, count) =>
          Array.from({ length: count }, (_, i) => bitsFloat(m.load((at + i * 4) >>> 0)));
      try {
        floats(0, [3, 4, 0, 0]);
        assert.equal(bitsFloat((await call(0x163, [0])).value), 5);
        assert.equal(bitsFloat((await call(0x164, [0])).value), 25);
        floats(128, [2]);
        await call(0x165, [0, 128]);
        assert.deepEqual(read(0, 4), [6, 8, 0, 0]);
        await call(0x160, [0]);
        assert.deepEqual(read(0, 4), [Math.fround(0.6), Math.fround(0.8), 0, 0]);
        floats(256, [1, 2, 3, 4]);
        floats(272, [5, 6, 7, 8]);
        await call(0x161, [256, 272]);
        assert.deepEqual(read(256, 4), [6, 8, 10, 12]);
        await call(0x162, [256, 272]);
        assert.deepEqual(read(256, 4), [1, 2, 3, 4]);
        const matrix = [2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 8, 0, 5, -3, 7, 1];
        floats(512, matrix);
        await call(0x166, [256, 512]);
        assert.deepEqual(read(256, 4), [22, -4, 52, 4]);
        await call(0x15e, [512]);
        assert.deepEqual(
          read(512, 16),
          [0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.125, 0, -2.5, 0.75, -0.875, 1],
        );
        m.memory.fill(0xa5, 640, 720);
        Array.from({ length: 20 }, (_, i) => i + 1).forEach((v, i) => m.store(640 + i * 4, v));
        await call(0x15f, [656, 640]);
        assert.deepEqual(
          Array.from({ length: 16 }, (_, i) => m.load(656 + i * 4)),
          Array.from({ length: 16 }, (_, i) => (i % 4) + 1),
        );
        const block = m.allocate(128);
        floats(block, [1, 2, 3, 4]);
        floats(0x80000000, [10, 20, 30, 40]);
        await call(0x161, [block, 0x80000000]);
        assert.deepEqual(read(block, 4), [11, 22, 33, 44]);
        await matrices.apply(0xcf, [0xffffffff], m);
        await matrices.apply(0xce, [0xffffffff, floatBits(2), floatBits(4), floatBits(8)], m);
        const current = await engine.call(matrices.operations.identity, [0]);
        // Obtain the current matrix pointer from the original helper, then give
        // the inverse wrapper an unmapped VM address (translated NULL).
        engine.process.write(current, new Uint8Array(new Float32Array(matrix).buffer));
        await call(0x15e, [0xffffffff]);
        assert.deepEqual(
          Array.from(new Float32Array(engine.process.read(current, 64).buffer)),
          read(512, 16),
        );
        assert.equal(await geometry.apply(0x167, [], m, { id: 1 }), undefined);
      } finally {
        await engine.close();
      }
    },
  );
  test(
    `${profile} matrix/vector fresh-process continuation has independent original RAM`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({ bytes, profile }),
        fresh = await NativeEngineProcess.open({ bytes, profile }),
        world = { objects: { machine: () => null } },
        geometry = new NativeGeometry(engine, world),
        other = new NativeGeometry(fresh, world),
        m = machine(),
        fm = machine();
      try {
        for (let i = 0; i < 16; i++) m.store(i * 4, floatBits(i % 5 === 0 ? 2 : 0));
        m.store(128, floatBits(3));
        const state = structuredClone({ engine: engine.snapshot(), machine: m.snapshot() });
        fresh.restore(state.engine);
        fm.restore(state.machine);
        await other.apply(0x15e, [0], fm, { id: 1 });
        await other.apply(0x165, [0, 128], fm, { id: 1 });
        assert.equal(bitsFloat(fm.load(0)), 1.5);
        assert.equal(bitsFloat(m.load(0)), 2);
        await geometry.apply(0x15e, [0], m, { id: 1 });
        await geometry.apply(0x165, [0, 128], m, { id: 1 });
        assert.deepEqual(fm.memory, m.memory);
      } finally {
        await fresh.close();
        await engine.close();
      }
    },
  );
}

test(
  'SDK geometry World dispatch uses the live VM arena before and after restore',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const [
        { NativeWorld },
        { NativeConfiguration },
        { MotionLibrary },
        { ParticleRandom },
        { memoryGame, kcsProgram },
      ] = await Promise.all([
        import('../web/transitional-entry.mjs'),
        import('../src/native/config.mjs'),
        import('../src/motion/library.mjs'),
        import('../src/ppi/random.mjs'),
        import('./helpers.mjs'),
      ]),
      executable = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      profile = 'sdk-4.01-engine-2.6.1.74',
      make = () => {
        const game = memoryGame({
            'engine.exe': executable,
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
          configuration,
          profile,
          random,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const m = world.main.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, world.main);
      [3, 4, 0, 0].forEach((value, i) => m.store(i * 4, floatBits(value)));
      assert.equal(bitsFloat((await call(0x163, [0])).value), 5);
      const tm = await world.getNativeFeature('task-memory'),
        mapping = tm.mapMachine(world.main.id, m),
        p = world.nativeEngine.process;
      p.store(mapping.memory.pointer, floatBits(6));
      p.store(mapping.memory.pointer + 4, floatBits(8));
      assert.equal(bitsFloat((await call(0x164, [0])).value), 100);
      const snapshot = structuredClone(world.snapshot());
      fresh = make();
      await fresh.restore(snapshot);
      const fm = fresh.main.machine;
      [5, 12, 0, 0].forEach((value, i) => fm.store(i * 4, floatBits(value)));
      assert.equal(
        bitsFloat((await fresh.runtime.native('main', 0x163, [0], fm, fresh.main)).value),
        13,
      );
      assert.deepEqual([bitsFloat(m.load(0)), bitsFloat(m.load(4))], [6, 8]);
      fm.store(128, floatBits(2));
      await fresh.runtime.native('main', 0x165, [0, 128], fm, fresh.main);
      assert.deepEqual([bitsFloat(fm.load(0)), bitsFloat(fm.load(4))], [10, 24]);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
