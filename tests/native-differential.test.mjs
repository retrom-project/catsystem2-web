// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeABI, NATIVE_ABIS } from '../src/native/abi/index.mjs';
import { floatBits } from '../src/kcs.mjs';
import { nativeMathCases } from './fixtures/differential-cases.mjs';
import { observeNativeCase } from './fixtures/native-differential.mjs';
import { compareNativeObservations, compareFloatWord } from './fixtures/native-observations.mjs';

for (const abi of Object.values(NATIVE_ABIS))
  test(`${abi.id} existing JS arithmetic executes authored GCALL scripts without an EXE host`, async () => {
    for (const fixture of nativeMathCases(abi.profile)) {
      const observation = await observeNativeCase(fixture);
      assert.ok(
        abi.tables[fixture.table].entries[fixture.id].controlCodes.includes(observation.control),
      );
      assert.equal(observation.nativeCalls.length, 1);
      assert.deepEqual(observation.peWrites, []);
    }
    await assert.rejects(
      observeNativeCase({ profile: abi.profile, table: 'main', id: 0xffff, args: [0] }),
      /No independent JS differential entry/,
    );
  });

function observation() {
  return {
    control: 1,
    resultWritten: true,
    value: floatBits(1),
    memory: { memory: new Uint8Array(16), shared: new Uint8Array(8), 'block:1': new Uint8Array(8) },
    peWrites: [],
    handles: { next: 2, records: [[1, { type: 'canary', value: { owner: 7, references: 1 } }]] },
    tasks: [
      { id: 7, status: 'waiting', pc: 12, frame: 9, machine: { nextBlockID: 2, switchValue: 0 } },
    ],
    events: [
      { sequence: 1, target: 7 },
      { sequence: 2, target: 8 },
    ],
    nativeCalls: [{ table: 'main', id: 318, args: [1, 2, 3, 4, 5], control: 1 }],
  };
}

test('comparison detects control, output, VM/PE bytes, handle ownership and task/event regressions', () => {
  const expected = observation();
  for (const mutate of [
    (actual) => (actual.control = 3),
    (actual) => (actual.resultWritten = false),
    (actual) => (actual.value = floatBits(2)),
    (actual) => (actual.memory.memory[7] = 1),
    (actual) => (actual.memory.shared[3] = 1),
    (actual) => (actual.memory['block:1'][5] = 1),
    (actual) => actual.peWrites.push({ region: '.data', offset: 12, after: 1 }),
    (actual) => actual.handles.records[0][1].value.owner++,
    (actual) => actual.handles.records[0][1].value.references++,
    (actual) => (actual.tasks[0].status = 'finished'),
    (actual) => actual.tasks[0].frame++,
    (actual) => actual.tasks[0].machine.nextBlockID++,
    (actual) => actual.tasks[0].machine.switchValue++,
    (actual) => actual.events.reverse(),
    (actual) => actual.nativeCalls[0].control++,
  ]) {
    const actual = structuredClone(expected);
    mutate(actual);
    assert.throws(() => compareNativeObservations(actual, expected));
  }
  compareNativeObservations(structuredClone(expected), expected);
});

test('floating tolerance is per word and cannot mask exact zero, infinity, integer or unrelated byte changes', () => {
  compareFloatWord(0x3f800001, 0x3f800000, { ulp: 1 });
  assert.throws(() => compareFloatWord(0x3f800002, 0x3f800000, { ulp: 1 }), /ULP/);
  assert.throws(() => compareFloatWord(0, 0x80000000, { ulp: 10 }), /zero/);
  assert.throws(() => compareFloatWord(0x7f800000, 0xff800000, { ulp: 10 }), /infinity/);
  compareFloatWord(0x7fc00001, 0x7fc00002, { nan: 'classification' });
  assert.throws(
    () => compareFloatWord(0x7fa00001, 0x7fc00002, { nan: 'classification' }),
    /quiet\/signaling/,
  );
  assert.throws(() => compareFloatWord(0x7fc00001, 0x7fc00002), /NaN/);
  assert.throws(() => compareFloatWord(0x7fc00001, 0x7fc00002, { nan: 'exact' }), /NaN/);
  assert.throws(() => compareFloatWord(0x7fc00001, 0x3f800000), /NaN/);
  assert.throws(() => compareFloatWord(1, 1, { ulp: Infinity }), /policy/);
  const expected = observation(),
    actual = structuredClone(expected);
  new DataView(expected.memory.memory.buffer).setUint32(4, floatBits(1), true);
  new DataView(actual.memory.memory.buffer).setUint32(4, floatBits(1) + 1, true);
  const policy = {
    result: 'f32',
    ulp: 1,
    memory: [{ region: 'memory', offset: 4, words: 1, ulp: 1 }],
  };
  compareNativeObservations(actual, expected, policy);
  actual.memory.memory[9] = 1;
  assert.throws(() => compareNativeObservations(actual, expected, policy), /exact bytes/);
  assert.throws(
    () =>
      compareNativeObservations(actual, expected, {
        ...policy,
        memory: [...policy.memory, ...policy.memory],
      }),
    /overlapping/,
  );
  assert.throws(
    () =>
      compareNativeObservations(actual, expected, {
        ...policy,
        memory: [{ region: 'memory', offset: 16, words: 1 }],
      }),
    /float range/,
  );
  assert.equal(nativeABI(Object.keys(NATIVE_ABIS)[0]).floatingPoint.x87ControlWord, 0x7f);
});
