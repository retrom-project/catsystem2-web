// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeMT19937, ParticleRandom } from '../src/ppi/random.mjs';
import { NativeRandomMemory, NATIVE_RANDOM_LAYOUTS } from '../src/native/random-memory.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { floatBits } from '../src/kcs.mjs';

test('MT providers reacquire words after an index read grows RAM and preserve one shared state', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 }),
    initial = new NativeMT19937(7),
    expected = new NativeMT19937(7);
  let grew = false;
  new Uint32Array(memory.buffer, 16, 624).set(initial.words);
  new DataView(memory.buffer).setUint32(0, initial.index, true);
  const provider = {
    words: () => new Uint32Array(memory.buffer, 16, 624),
    getIndex: () => {
      if (!grew) {
        memory.grow(1);
        grew = true;
      }
      return new DataView(memory.buffer).getUint32(0, true);
    },
    setIndex: (index) => new DataView(memory.buffer).setUint32(0, index, true),
  };
  initial.bindState(provider);
  for (let i = 0; i < 1500; i++) assert.equal(initial.nextUint32(), expected.nextUint32());
  const state = initial.snapshot();
  initial.unbindState(provider);
  assert.deepEqual(initial.snapshot(), state);
  assert.equal(initial.nextUint32(), expected.nextUint32());
});

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    profile + ' cold start seeds both native streams from local time and restores their owner',
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        make = (wallNow) =>
          NativeEngineProcess.open({
            bytes,
            profile,
            wallNow: () => wallNow,
            localOffsetMinutes: () => 330,
          }),
        random = new ParticleRandom(17),
        other = new ParticleRandom(31, 43),
        engine = await make(Date.UTC(2030, 11, 31, 21, 56, 57, 789)),
        fresh = await make(Date.UTC(2040, 6, 8, 9, 10, 11, 12)),
        first = new NativeRandomMemory(engine, random),
        second = new NativeRandomMemory(fresh, other);
      try {
        first.initialize();
        // The local time is 2031-01-01 03:26:57.789. Weekday is not part of the sum.
        assert.deepEqual(random.snapshot(), new ParticleRandom(2908).snapshot());
        const owner = engine.refs.randomOwner;
        assert.equal(engine.process.load(first.layout.startup.global), owner);
        random.rand();
        random.frand();
        second.initialize({ fromClock: false });
        assert.deepEqual(other.snapshot(), new ParticleRandom(31, 43).snapshot());
        fresh.restore(engine.snapshot());
        assert.equal(fresh.refs.randomOwner, owner);
        assert.equal(other.rand(), random.rand());
        assert.equal(other.frand(), random.frand());
        second.close();
        assert.equal(fresh.process.load(second.layout.startup.global), 0);
        assert.equal(fresh.process.allocations.has(owner), false);
      } finally {
        await fresh.close();
        await engine.close();
      }
    },
  );

  test(
    profile +
      ' original and JS random callers share both streams, seed transitions and a fresh process',
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        random = new ParticleRandom(123, 987),
        expected = new ParticleRandom(123, 987),
        engine = await NativeEngineProcess.open({ bytes, profile }),
        bridge = new NativeRandomMemory(engine, random),
        p = engine.process,
        layout = NATIVE_RANDOM_LAYOUTS[profile],
        out = p.allocate(4);
      let fresh;
      const raw = async (id) => {
        p.store(out, 0xcccccccc);
        assert.equal(
          await engine.call(p.load(NATIVE_PROFILES[profile].tables.main.va + id * 4), [
            0,
            0,
            0,
            out,
          ]),
          1,
        );
        return p.load(out);
      };
      try {
        for (const [iteration, seed] of [0, 4357, 0xffffffff, 0x12345678].entries()) {
          if (iteration % 2) random.integer.seed(seed);
          else await engine.call(layout.integer.seed, [seed]);
          expected.integer.seed(seed);
          if (iteration % 2) await engine.call(layout.real.seed, [seed ^ 0x76543210]);
          else random.real.seed(seed ^ 0x76543210);
          expected.real.seed(seed ^ 0x76543210);
          for (let i = 0; i < 1300; i++) {
            assert.equal(i % 3 === 0 ? await raw(0x21) : random.rand(), expected.rand());
            assert.equal(
              i % 4 === 0 ? await raw(0x22) : floatBits(random.frand()),
              floatBits(expected.frand()),
            );
            if (i % 127 === 0) assert.deepEqual(random.snapshot(), expected.snapshot());
          }
        }
        // Native's unseeded sentinel is part of the shared state, too.
        p.store(layout.integer.index, 625);
        expected.integer.restore({ index: 625, words: Array(624).fill(0) });
        assert.equal(random.rand(), expected.rand());
        const snapshot = structuredClone(engine.snapshot()),
          state = random.snapshot(),
          other = new ParticleRandom();
        fresh = await NativeEngineProcess.open({ bytes, profile });
        new NativeRandomMemory(fresh, other);
        fresh.restore(snapshot);
        assert.deepEqual(other.snapshot(), state);
        for (let i = 0; i < 700; i++) {
          assert.equal(other.rand(), random.rand());
          assert.equal(other.frand(), random.frand());
        }
        const after = random.snapshot();
        bridge.close();
        assert.deepEqual(random.snapshot(), after);
        assert.equal(random.rand(), other.rand());
      } finally {
        p.free(out);
        await fresh?.close();
        await engine.close();
      }
    },
  );
}
