// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { PPIWindowsServices } from '../src/ppi/native-services.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { nativeStandard } from '../src/native/standard.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

const epoch = Date.UTC(2026, 10, 9, 12, 34, 56),
  fileTime = (milliseconds) => (BigInt(milliseconds) + 11644473600000n) * 10000n;

test('the virtual system clock accumulates exact frame durations across FPS changes', () => {
  const clock = new NativeSystemClock({ utcNow: () => epoch });
  for (const fps of [60, 30, 144, 59, 1001]) {
    const before = clock.now();
    for (let i = 0; i < fps; i++) clock.advance(fps);
    assert.equal(clock.now(), before + 1000);
    assert.equal(clock.performanceCounter(), BigInt(before + 1000) * 1000n);
  }
  for (let i = 0; i < 60 * 60 * 60; i++) clock.advance(60);
  assert.equal(clock.now(), 3605000);
  assert.equal(clock.utcNow(), epoch + 3605000);
  assert.equal(clock.fileTime(), fileTime(epoch + 3605000));
  for (const fps of [0, -1, 0.5, NaN, Infinity])
    assert.throws(() => clock.advance(fps), /positive FPS/);
});

test('external clocks unwrap DWORD rollover and rebase independently after portable restore', async () => {
  let raw = 0xffffffff - 7;
  const first = new NativeSystemClock({ now: () => raw, utcNow: () => epoch });
  raw = 4;
  assert.equal(first.now(), 2 ** 32 + 4);
  assert.equal(first.tickCount(), 4);
  assert.equal(first.performanceCounter(), (2n ** 32n + 4n) * 1000n);
  assert.equal(first.utcNow(), epoch + 12);
  first.advance(0);
  const state = await deserializeCheckpoint(await serializeCheckpoint(first.snapshot()));
  let otherRaw = 123.125;
  const second = new NativeSystemClock({ now: () => otherRaw, utcNow: () => epoch + 999999 });
  second.restore(state);
  assert.equal(second.now(), first.now());
  assert.equal(second.fileTime(), first.fileTime());
  otherRaw += 0.5;
  assert.equal(second.performanceCounter(), first.performanceCounter() + 500n);
  assert.equal(second.fileTime(), first.fileTime() + 5000n);
  assert.equal(first.now(), 2 ** 32 + 4);
  otherRaw--;
  assert.throws(() => second.now(), /moved backwards/);
  assert.throws(() => new NativeSystemClock({ now: () => NaN }), /finite/);
});

test('PPI timers share one clock with precise QPC/UTC and retain explicit zero-epoch oracle behavior', async () => {
  const p = new PE32Process(await loadUnicorn()),
    clock = new NativeSystemClock({ utcNow: () => epoch }),
    kernel = new PPIWindowsServices(p, { clock }),
    zero = new PPIWindowsServices(p, { now: () => 0, epoch: 0 }),
    out = p.allocate(16, true),
    call = (name, args = [], dll = 'KERNEL32.dll') => p.call(kernel.resolve({ dll, name }), args),
    read64 = () => new DataView(p.read(out, 8).buffer).getBigUint64(0, true);
  try {
    clock.advance(60);
    assert.equal(call('GetTickCount'), 16);
    assert.equal(call('timeGetTime', [], 'WINMM.dll'), 16);
    assert.equal(call('QueryPerformanceFrequency', [out]), 1);
    assert.equal(read64(), 1000000n);
    assert.equal(call('QueryPerformanceCounter', [out]), 1);
    assert.equal(read64(), 16666n);
    call('GetSystemTimeAsFileTime', [out]);
    assert.equal(read64(), fileTime(epoch) + 166666n);
    p.call(zero.resolve({ dll: 'KERNEL32.dll', name: 'GetSystemTimeAsFileTime' }), [out]);
    assert.equal(read64(), fileTime(0));
    for (let i = 1; i < 60; i++) clock.advance(60);
    assert.equal(call('GetTickCount'), 1000);
    call('QueryPerformanceCounter', [out]);
    assert.equal(read64(), 1000000n);
  } finally {
    p.close();
  }
});

test('WinMM timer capabilities write only TIMECAPS and period requests survive a fresh restore', async () => {
  const unicorn = await loadUnicorn(),
    p = new PE32Process(unicorn),
    restored = new PE32Process(unicorn),
    kernel = new PPIWindowsServices(p),
    other = new PPIWindowsServices(restored),
    out = p.allocate(16, true),
    call = (k, name, ...args) => k.process.call(k.resolve({ dll: 'WINMM.dll', name }), args);
  try {
    p.write(out, new Uint8Array(16).fill(0xa5));
    kernel.lastError = 0x1234;
    for (const [pointer, size] of [
      [0, 8],
      [out, 7],
    ]) {
      assert.equal(call(kernel, 'timeGetDevCaps', pointer, size), 97);
      assert.deepEqual([...p.read(out, 16)], new Array(16).fill(0xa5));
    }
    assert.equal(call(kernel, 'timeGetDevCaps', out + 4, 12), 0);
    assert.deepEqual(
      [0, 4, 8, 12].map((offset) => p.load(out + offset)),
      [0xa5a5a5a5, 1, 65535, 0xa5a5a5a5],
    );
    for (const name of ['timeBeginPeriod', 'timeEndPeriod'])
      for (const period of [0, 65536, 0xffffffff]) assert.equal(call(kernel, name, period), 97);
    for (const period of [1, 1, 65535]) assert.equal(call(kernel, 'timeBeginPeriod', period), 0);
    assert.equal(kernel.lastError, 0x1234);
    other.restore(await deserializeCheckpoint(await serializeCheckpoint(kernel.snapshot())));
    assert.deepEqual(
      [...other.timerPeriods],
      [
        [1, 2],
        [65535, 1],
      ],
    );
    for (const period of [1, 2, 65535]) assert.equal(call(other, 'timeEndPeriod', period), 0);
    assert.deepEqual([...other.timerPeriods], [[1, 1]]);
    assert.equal(call(other, 'timeEndPeriod', 1), 0);
    assert.equal(other.timerPeriods.size, 0);
    assert.equal(other.lastError, 0x1234);
  } finally {
    restored.close();
    p.close();
  }
});

function world(host = {}) {
  const profile = 'nekopara-vol3-engine-2.6.1.76',
    game = memoryGame({ 'main.kcs': kcsProgram([[43, 0x41, 0], [59]]) }),
    configuration = new NativeConfiguration({ profile }),
    random = new ParticleRandom();
  return new NativeWorld({
    game,
    images: {},
    host,
    profile,
    configuration,
    random,
    storage: {
      read: (name) => game.read(name),
      write: async () => true,
      remove: async () => true,
      stat: async () => null,
    },
    motionLibrary: new MotionLibrary(game, { profile, random }),
  });
}

test('World, KCS and restored PPI processes use one UTC/monotonic authority while frame counters remain separate', async () => {
  const start = Date.now(),
    first = world(),
    second = world();
  try {
    await first.initialize('main.kcs');
    assert.equal(first.frame, 1);
    assert.equal(first.clock.tickCount(), 16);
    assert(first.clock.epoch >= start - 10 && first.clock.epoch <= Date.now());
    first.configuration.setField('screen.fps', 30);
    await first.tick();
    assert.equal(first.clock.now(), 50);
    assert.equal(first.frame, 2);
    const runtime = await first.particles.host.nativeRuntime();
    assert.equal(runtime.services.clock, first.clock);
    assert.equal(nativeStandard(4, [], null, first.runtime.services).value, 50);
    const state = structuredClone(first.snapshot());
    await second.restore(state);
    assert.equal(second.clock.fileTime(), first.clock.fileTime());
    assert.equal(second.particles.host.runtime.services.clock, second.clock);
    await second.tick();
    assert.equal(second.frame, 3);
    assert.equal(second.clock.performanceCounter(), 83333n);
    assert.equal(first.clock.now(), 50);
    second.configuration.setField('screen.fps', 0);
    await assert.rejects(second.tick(), /positive FPS/);
    assert.equal(second.frame, 3);
  } finally {
    await first.close();
    await second.close();
  }
});

test('an externally clocked World can advance and restore with no configured virtual FPS', async () => {
  let raw = 100,
    restoredRaw = 90000;
  const first = world({ nativeTimeGetTime: () => raw }),
    second = world({ nativeTimeGetTime: () => restoredRaw });
  try {
    await first.initialize('main.kcs');
    first.configuration.setField('screen.fps', 0);
    raw = 101.5;
    await first.tick();
    assert.equal(first.frame, 2);
    assert.equal(first.clock.now(), 101.5);
    const saved = structuredClone(first.snapshot());
    await second.restore(saved);
    assert.equal(second.clock.now(), 101.5);
    assert.equal(second.clock.fileTime(), first.clock.fileTime());
    restoredRaw += 25;
    await second.tick();
    assert.equal(second.frame, 3);
    assert.equal(second.clock.now(), 126.5);
    assert.equal(nativeStandard(4, [], null, second.runtime.services).value, 126);
    assert.equal(first.clock.now(), 101.5);
  } finally {
    await first.close();
    await second.close();
  }
});

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original main4 and Windows/PPI APIs observe the same restored system clock`,
    { skip: !process.env[variable] },
    async () => {
      const clock = new NativeSystemClock({ utcNow: () => epoch }),
        bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({ profile, bytes, clock }),
        p = engine.process,
        out = p.allocate(16, true),
        ppiProcess = new PE32Process(await loadUnicorn()),
        ppi = new PPIWindowsServices(ppiProcess, { clock });
      let fresh;
      try {
        for (let i = 0; i < 60; i++) clock.advance(60);
        const native = await engine.call(p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + 16), [
          0,
          0,
          0,
          out,
        ]);
        assert.equal(native, 1);
        assert.equal(p.load(out), 1000);
        assert.equal(
          ppiProcess.call(ppi.resolve({ dll: 'KERNEL32.dll', name: 'GetTickCount' })),
          1000,
        );
        const state = { clock: clock.snapshot(), engine: engine.snapshot() },
          restoredClock = new NativeSystemClock({ utcNow: () => epoch + 10000 });
        restoredClock.restore(state.clock);
        fresh = await NativeEngineProcess.open({ profile, bytes, clock: restoredClock });
        fresh.restore(state.engine);
        restoredClock.advance(30);
        await fresh.call(
          fresh.kernel.resolve({ dll: 'KERNEL32.dll', name: 'GetSystemTimeAsFileTime' }),
          [out],
        );
        assert.equal(
          new DataView(fresh.process.read(out, 8).buffer).getBigUint64(0, true),
          fileTime(epoch + 1000) + 333333n,
        );
        await fresh.call(fresh.process.load(NATIVE_EXE_PROFILES[profile].tables.main.va + 16), [
          0,
          0,
          0,
          out,
        ]);
        assert.equal(fresh.process.load(out), 1033);
        assert.equal(clock.now(), 1000);
      } finally {
        await fresh?.close();
        await engine.close();
        ppiProcess.close();
      }
    },
  );
