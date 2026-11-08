// SPDX-License-Identifier: MPL-2.0
// Original sound-task epoch message and PLV queries. The real WINMM import
// reads the same injected system clock as the web sound task, not AudioContext.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { NATIVE_SOUND_CONTROL as C } from '../src/native/sound.mjs';
import { soundClockFixture } from '../tests/fixtures/sound-clock-fixture.mjs';

export const NATIVE_SOUND_CLOCK_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    message: 0x5eb670,
    scalar: 0x5eb070,
    array: 0x5eb0d0,
    stride: 140,
    banks: 64,
    epochMessage: 217,
    timerIAT: 0x8c6684,
    deviceGate: 9064,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    message: 0x4c7130,
    scalar: 0x4c6c50,
    array: 0x4c6cb0,
    stride: 120,
    banks: 32,
    epochMessage: 215,
    timerIAT: 0x98e608,
    deviceGate: 3944,
  }),
});

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-sound-clock.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('PLV clock oracle requires a frozen engine');
let wall = 1000;
const clock = new NativeSystemClock({ now: () => wall, utcNow: () => 1700000000000 }),
  engine = await NativeEngineProcess.open({ bytes, profile, clock }),
  p = engine.process,
  layout = NATIVE_SOUND_CLOCK_LAYOUTS[profile],
  fixture = soundClockFixture(profile, clock),
  owner = p.allocate(32768, true),
  data = p.allocate(64, true),
  out = p.allocate(12),
  array = p.allocate(144),
  values = Array.from({ length: 32 }, (_, i) => (i * 7187 + 123) & 65535),
  check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  };
let comparisons = 0,
  calls = 0,
  epochs = 0,
  scalarQueries = 0,
  arrayQueries = 0;
values.forEach((value, i) => p.write(data + i * 2, [value & 255, value >>> 8]));
p.store(owner + layout.deviceGate, 1); // Explicit platform input: a sound device is attached.
assert.equal(
  p.load(layout.timerIAT),
  engine.kernel.resolve({ dll: 'WINMM.dll', name: 'timeGetTime' }),
);
const record = (bank) => owner + 104 + bank * layout.stride;
async function epoch(bank) {
  p.write(out, new Uint8Array(12).fill(0xcc));
  check(
    await engine.call(layout.message, [100, layout.epochMessage, bank, 0, 0, out + 4], owner),
    0,
    'original epoch handler return',
  );
  await fixture.send(217, bank);
  check(
    p.read(out, 12),
    new Uint8Array(12).fill(0xcc),
    'active-device epoch message leaves its output untouched',
  );
  check(
    p.read(record(bank), layout.stride),
    fixture.task.controls[bank].data.subarray(0, layout.stride),
    'complete PLV control after epoch message',
  );
  calls++;
  epochs++;
}
async function query(bank, count) {
  const before = p.read(record(bank), layout.stride);
  check(
    await engine.call(layout.scalar, [bank], owner),
    await fixture.send(212, bank),
    'original scalar PLV query',
  );
  const packet = fixture.queryPacket(count);
  p.write(array, packet.data);
  const copied = await engine.call(layout.array, [bank, array + 16, count], owner),
    expected = await fixture.send(213, bank, 0, packet);
  check(copied, expected, 'original array PLV count');
  check(p.read(array, 144), packet.data, 'complete array and surrounding canaries');
  check(p.read(record(bank), layout.stride), before, 'PLV reads do not alter their native control');
  calls += 2;
  scalarQueries++;
  arrayQueries++;
}
try {
  for (const bank of [0, layout.banks - 1])
    for (const start of [0, 1234.75, 0xfffffff0, 0xffffffff])
      for (const step of [1, 7, 16, 100, 0x80000000, 0xffffffff]) {
        // Replacing the external clock's epoch is an explicit new process-time
        // input, rather than moving an existing monotonic provider backwards.
        wall = start;
        clock.restore(new NativeSystemClock({ now: () => start }).snapshot());
        const control = fixture.setPLV(bank, values, step);
        control.word(C.plvData, data);
        p.write(record(bank), control.data.subarray(0, layout.stride));
        await epoch(bank);
        for (const elapsed of [0, 0.9, 1, 6, 7, 16, 99, 100, 511, 2000]) {
          wall = (start + elapsed) % 2 ** 32;
          fixture.world.frame = elapsed * 19;
          fixture.world.audio.context.currentTime = 9000 - elapsed / 10;
          await query(bank, 8);
        }
        // A non-sentinel epoch is retained, even after later play/enable calls.
        await epoch(bank);
      }
  for (const fps of [24, 75, 144]) {
    const virtual = new NativeSystemClock(),
      savedClock = clock.snapshot();
    fixture.world.clock = virtual;
    // The original import reads this clock too; no WINMM or PLV instruction is patched.
    engine.kernel.clock = virtual;
    const control = fixture.setPLV(0, values, 100);
    control.word(C.plvData, data);
    p.write(record(0), control.data.subarray(0, layout.stride));
    await epoch(0);
    for (let frame = 1; frame <= fps * 2; frame++) {
      virtual.advance(fps);
      fixture.world.frame = frame;
      fixture.world.audio.context.currentTime += 13;
      if ([1, fps - 1, fps, fps + 1, fps * 2].includes(frame)) await query(0, 4);
    }
    fixture.world.clock = clock;
    engine.kernel.clock = clock;
    clock.restore(savedClock);
  }
  const report = {
    profile,
    sha256,
    calls,
    comparisons,
    epochs,
    scalarQueries,
    arrayQueries,
    original: layout,
    boundaries: [
      'Injected system clock via original WINMM import',
      'Authored PLV values and sound control records; no audio device playback',
    ],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Sound PLV clock passed ${calls} original calls/${comparisons} comparisons`);
} finally {
  await engine.close();
}
