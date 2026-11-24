// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { floatBits, readKCS } from '../src/kcs.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { NATIVE_RESULT_SENTINEL } from '../src/kcs/vm.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67';

async function run(instructions, diagnostic) {
  const runtime = new NativeRuntime({
    profile,
    read: async () => kcsProgram(instructions),
    services: { diagnostic },
  });
  const task = await runtime.spawn('abi-probe.kcs');
  return { runtime, task, machine: task.machine };
}

test('2.6.1.67 Main stubs preserve their original three result behaviors', async () => {
  const table = nativeABI(profile).tables.main.entries;
  const noops = table.filter((entry) => entry.status === 'reserved');
  const zeros = table.filter((entry) => entry.status === 'constant-zero');
  const unwritten = [140, 142, 549].map((id) => table[id]);
  assert.equal(noops.length, 80);
  assert.equal(zeros.length, 19);
  const cases = [...noops, ...zeros, ...unwritten];
  const markerAddress = (index) => 512 + index * 4;
  const resultAddress = (index) => 1024 + index * 4;
  const marker = 0x82345678;

  // The fixed scripts exercise ignored calls with zero to seven argument words.
  for (let words = 0; words <= 7; words++) {
    const instructions = cases.flatMap((entry, index) => [
      [37, marker],
      ...Array.from({ length: words }, (_, word) => [37, 0xffa0b000 + word]),
      [43, entry.id, words * 4],
      ...(entry.status === 'reserved' ? [] : [[38, resultAddress(index)]]),
      [38, markerAddress(index)],
    ]);
    const diagnostics = [];
    const { runtime, task, machine } = await run([...instructions, [59]], (event) =>
      diagnostics.push(event),
    );
    machine.bytes(1024, cases.length * 4).fill(0xa5);
    machine.store(508, 0x3b46d32d);
    const stack = machine.sp;
    await runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, stack);
    assert.equal(machine.load(508), 0x3b46d32d);
    for (const [index, entry] of cases.entries()) {
      const noResult = entry.status === 'reserved';
      const zero = entry.status === 'constant-zero';
      assert.equal(runtime.calls.get(`main:${entry.id}`), 1);
      assert.equal(entry.signature.argumentWords, null);
      assert.equal(entry.signature.parameters.kind, 'ignored');
      assert.equal(entry.signature.resultWritten, zero);
      assert.deepEqual(entry.controlCodes, noResult ? [2] : [1]);
      assert.equal(machine.load(markerAddress(index)), marker);
      assert.equal(
        machine.load(resultAddress(index)),
        noResult ? 0xa5a5a5a5 : zero ? 0 : NATIVE_RESULT_SENTINEL,
      );
    }
    assert.equal(diagnostics.length, 3);
    assert.ok(diagnostics.every((event) => event.type === 'native-result-sentinel'));
  }
});

test('2.6.1.67 GCALL still rejects the adjacent unreviewed native slot', async () => {
  const { runtime, task } = await run([[37, 17], [37, 18], [37, 19], [43, 934, 12], [59]]);
  await assert.rejects(
    () => runtime.scheduler.execute(task),
    (error) => {
      assert.ok(error instanceof UnsupportedKCSNative);
      assert.equal(error.details.profile, profile);
      assert.equal(error.details.table, 'main');
      assert.equal(error.details.id, 934);
      assert.deepEqual(error.details.args, [17, 18, 19]);
      return true;
    },
  );
});

const scalarCases = [
  { ids: [57, 9, 14], args: [0x80000000], result: 0 },
  { ids: [57, 9, 14], args: [0xff812345], result: 0x7fc12345 },
  { ids: [62, 14, 19], args: [floatBits(180)], result: 0x40490fdb },
  { ids: [62, 14, 19], args: [0x7f7fffff], result: 0x7c8efa35 },
  { ids: [63, 15, 20], args: [0x7bbb3ee6], result: 0x7ea7a18e },
  { ids: [63, 15, 20], args: [0x80000000], result: 0x80000000 },
  { ids: [64, 16, 21], args: [0xffffffe3], result: 29 },
  { ids: [64, 16, 21], args: [0x80000000], result: 0x80000000 },
  { ids: [318, 41, 41], args: [10, 20, 0, 4, 2].map(floatBits), result: 0x41700000 },
  { ids: [318, 41, 41], args: [-0, 20, 0, 4, -1].map(floatBits), result: 0x80000000 },
  { ids: [318, 41, 41], args: [10, 20, 0, 4, 4].map(floatBits), result: 0x41a00000 },
  { ids: [319, 17, 42], args: [floatBits(4294967808)], result: 512 },
  { ids: [319, 17, 42], args: [floatBits(-1.5)], result: 0xffffffff },
  { ids: [319, 17, 42], args: [floatBits(2 ** 63)], result: 0 },
];

function scalarProgram(column) {
  return [
    [37, 0x82345678],
    ...scalarCases.flatMap(({ ids, args }) => [
      ...args.map((word) => [37, word]),
      [43, ids[column], args.length * 4],
    ]),
    [59],
  ];
}

function assertScalarOutput(machine) {
  const expected = [0x82345678, ...scalarCases.map(({ result }) => result)];
  const offset = machine.sp - expected.length * 4;
  assert.deepEqual(
    expected.map((_, index) => machine.load(offset + index * 4)),
    expected,
  );
}

test('2.6.1.67 Main scalar GCALLs write the original x87 and integer words', async (t) => {
  const world = await dataWorld(profile, { 'case.kcs': kcsProgram(scalarProgram(0)) });
  t.after(() => world.close({ flushFiles: false }));
  assertScalarOutput(world.main.machine);
});

for (const [table, version, column] of [
  ['generic', 0, 1],
  ['particle-v1', 1, 2],
  ['particle-v2', 2, 2],
]) {
  test(`2.6.1.67 ${table} scalar GCALLs use the original conversion and rounding words`, async () => {
    const bytes = kcsProgram(scalarProgram(column));
    new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, version, true);
    const script = await readKCS(bytes);
    const instance =
      version === 0
        ? new MotionInstance(script, { profile })
        : new ParticleScriptInstance(script, {
            profile,
            count: 1,
            width: 16,
            height: 16,
            screenWidth: 1280,
            screenHeight: 720,
          });
    if (version) assert.equal(instance.table, table);
    instance.update(19);
    assertScalarOutput(instance.machine);
  });
}

test('2.6.1.67 copies an opaque word and yields for one guest frame', async () => {
  const { runtime, task, machine } = await run([
    [37, 0xf31c5ba9],
    [43, 6, 4],
    [43, 65, 0],
    [37, 0xe6a8b101],
    [59],
  ]);
  const floor = machine.sp;
  await runtime.scheduler.execute(task);
  assert.equal(task.status, 'yielded');
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), 0xf31c5ba9);
  await runtime.tick();
  assert.equal(task.status, 'finished');
  assert.equal(machine.sp, floor + 8);
  assert.equal(machine.load(floor + 4), 0xe6a8b101);
});

test('2.6.1.67 existing MOT triangle GCALL follows the four ordered x87 quarters', async () => {
  const args = [
    [0, 0],
    [1, 0x3f000000],
    [3, 0x3f000000],
    [4, 0x80000000],
    [6, 0xbf800000],
    [8, 0],
  ];
  const script = await readKCS(
    kcsProgram([
      ...args.flatMap(([phase]) => [
        [37, floatBits(phase)],
        [37, floatBits(8)],
        [43, 42, 8],
      ]),
      [59],
    ]),
  );
  const motion = new MotionInstance(script, { profile });
  const floor = motion.machine.sp;
  motion.update(19);
  assert.equal(motion.machine.sp, floor + args.length * 4);
  assert.deepEqual(
    args.map((_, index) => motion.machine.load(floor + index * 4)),
    args.map(([, result]) => result),
  );
});
