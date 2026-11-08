// SPDX-License-Identifier: MPL-2.0
// Differential execution of authored bytecode, using private fixed x86 bytes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, nativeReply, floatBits } from '../src/kcs.mjs';

const oracle = process.argv[2];
if (!oracle)
  throw new Error('Usage: node scripts/verify-native-vm.mjs PRIVATE_ORACLE [EVIDENCE_JSON]');
const cases = [],
  failures = [],
  golden = [];
let randomState = 0x14ea9285;
const random = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return randomState >>> 0;
};
function code(instructions) {
  return Uint8Array.from(
    instructions.flatMap(([op, ...args]) => [
      op,
      ...args.flatMap((arg) => {
        const [mode, value] = Array.isArray(arg) ? arg : [0x23, arg];
        return [mode, value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
      }),
    ]),
  );
}
function add(name, instructions, configure = () => {}, limit = 100, control = 2, value = 0) {
  const bytes = code(instructions),
    vm = new KCSMachine(
      {
        name,
        body: new Binary(bytes),
        codeSize: bytes.length,
        data: new Uint8Array(256),
        stackSize: 4096,
      },
      { native: () => nativeReply(control, [1, 3].includes(control) ? value : undefined) },
      new Uint8Array(128),
    );
  configure(vm);
  cases.push({ name, instructions, vm, limit, control, value });
}
const values = [
  0,
  1,
  255,
  0x7fffffff,
  0x80000000,
  0xffffffff,
  floatBits(-0),
  floatBits(1.25),
  floatBits(-19.75),
];
for (const op of [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20])
  for (const mode of [3, 0x23, 4])
    for (let i = 0; i < 30; i++) {
      const a = i < values.length ? values[i] : random(),
        b = i < values.length ? values.at(-1 - i) : random();
      if (op === 4 && mode === 0x23 && a === 0x80000000 && b === 0xffffffff) continue;
      add(`binary ${op} mode ${mode} ${i}`, [[op, [mode, a], [mode, b]], [59]]);
    }
for (const op of [8, 12, 26, 54, 55, 56, 57])
  for (const mode of [3, 0x23, 4])
    for (const value of values)
      add(`unary ${op} mode ${mode} ${value}`, [[op, [mode, value]], [59]]);
for (const op of [21, 22, 23, 24, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36])
  for (const mode of [0x11, 0x31, 0x12, 0x32, 0x13, 0x33, 0x14, 0x94])
    for (let i = 0; i < 10; i++) {
      const a = i < values.length ? values[i] : random(),
        b = i < values.length ? values.at(-1 - i) : random();
      if (op === 32 && a === 0x80000000 && b === 0xffffffff) continue;
      add(
        `assignment ${op} mode ${mode} ${i}`,
        [op >= 22 && op <= 25 ? [op, [mode, 64]] : [op, [mode, 64], [mode & 0x2f, b]], [59]],
        (m) => m.store(64, a),
      );
    }
for (const mode of [0x11, 0x31, 0x12, 0x32, 0x13, 0x33, 0x94])
  for (const op of [1, 21])
    add(
      `load width ${op} ${mode}`,
      [[op, op === 21 ? [0x13, 80] : [mode, 64], op === 21 ? [mode, 64] : 1], [59]],
      (m) => m.store(64, 0xdead80ff),
    );
for (const control of [0, 1, 2, 3, 4, 5])
  add(
    `native control ${control}`,
    [[37, 11], [37, 22], [43, 7, 8], [37, 99], [59]],
    () => {},
    100,
    control,
    4242,
  );
add('nested return frame', [
  [37, 17],
  [42, 18, 4],
  [59],
  [49, 8],
  [61, 0],
  [47, [0x43, 0]],
  [37, 7],
  [1, [0x63, 0], [0x63, 0]],
  [44, 4, 4],
]);
add('block copy return', [[42, 12, 0], [59], [37, 11], [37, 22], [44, 8, 0]]);
add('local and shared pointers', [
  [49, 8],
  [61, 0],
  [21, [0x53, 0], 91],
  [21, [0x13, 0x80000004], 71],
  [59],
]);
add('copy stack no pop', [[37, 1234], [48, [0x13, 80], 4], [59]]);
add('store consumes value', [[37, 1234], [38, [0x13, 80]], [59]]);
add('push ignores byte narrowing', [[37, [0x11, 64]], [59]], (m) => m.store(64, 0x123456ff));
add('push existing stack operand', [[37, 17], [37, [0x43, 0]], [58], [45], [59]]);
add('switch case instruction', [[37, 17], [51], [52, 17, 24], [37, 999], [59], [37, 42], [59]]);
add('reversed unsigned switch range', [
  [37, 17],
  [51],
  [53, 19, 15, 29],
  [37, 999],
  [59],
  [37, 42],
  [59],
]);
add('branch discards temporaries', [[37, 991], [37, 0], [39, 19], [59], [37, 42], [59]]);
add('scope stack survives reservation', [[49, 12], [37, 99], [60], [50, 4], [59]]);
add('debug source location', [[65, 123, 64], [66, 80], [59]], (m) => {
  m.writeString('case.wss', 64);
  m.writeString('func', 80);
});
add('native NOP', [[0], [37, 17], [59]]);
add('jump clears to stack floor', [[37, 17], [41, 12], [37, 7], [59]]);
add('true branch clears to stack floor', [[37, 17], [37, 1], [40, 19], [59], [37, 7], [59]]);
for (const mode of [0x11, 0x31, 0x12, 0x32, 0x13, 0x91, 0x92, 0x93, 0x94]) {
  for (const op of [22, 23, 24, 25])
    add(`pointer width increment ${op} ${mode}`, [[op, [mode, 64]], [59]], (m) =>
      m.store(64, 0x123456ff),
    );
  add(`pointer width store ${mode}`, [[37, 7], [38, [mode, 64]], [59]], (m) =>
    m.store(64, 0x123456ff),
  );
  add(`raw dereference ${mode}`, [[47, [mode, 64]], [59]], (m) => m.store(64, 0x123456ff));
  add(`raw push ${mode}`, [[46, [mode, 64]], [59]], (m) => m.store(64, 0x123456ff));
  add(`raw address addition ${mode}`, [[62, [mode, 64], 1], [59]], (m) => m.store(64, 0x123456ff));
}

for (const item of cases) {
  const { vm, limit, control, value } = item;
  const header = new Uint32Array([
    vm.script.codeSize,
    vm.memory.length,
    vm.data.length,
    vm.shared.length,
    vm.pc,
    vm.sp,
    vm.floor,
    vm.fp,
    vm.switchValue,
    limit,
    control,
    value,
  ]);
  const native = spawnSync(oracle, {
    input: Buffer.concat([Buffer.from(header.buffer), vm.script.body.bytes, vm.memory, vm.shared]),
    timeout: 3000,
    maxBuffer: 1024 * 1024,
  });
  if (native.status !== 0 || native.stdout.length !== 64 + vm.memory.length + vm.shared.length) {
    failures.push({
      name: item.name,
      kind: 'native',
      status: native.status,
      signal: native.signal,
      bytes: native.stdout.length,
    });
    continue;
  }
  const expected = new Uint32Array(native.stdout.buffer, native.stdout.byteOffset, 16);
  const expectedMemory = new Uint8Array(native.stdout.subarray(64, 64 + vm.memory.length));
  let result;
  try {
    result = vm.run({ budget: limit, yieldOnBudget: true });
    assert.deepEqual(
      [vm.pc, vm.sp, vm.floor, vm.fp, vm.switchValue],
      Array.from(expected.subarray(1, 6)),
    );
    assert.deepEqual(vm.memory, expectedMemory);
    assert.deepEqual(vm.shared, new Uint8Array(native.stdout.subarray(64 + vm.memory.length)));
    if (control !== 2 && item.name.startsWith('native control'))
      assert.equal(result.status, [1, 2].includes(control) ? 'halted' : 'yielded');
    if (
      golden.length < 12 ||
      /return frame|copy return|switch|pointer|native control|push ignores/.test(item.name)
    )
      golden.push({
        name: item.name,
        instructions: item.instructions,
        registers: Array.from(expected.subarray(1, 6)),
        stack: Array.from(
          new Uint32Array(expectedMemory.buffer, vm.data.length, (vm.sp - vm.data.length) / 4),
        ),
      });
  } catch (error) {
    failures.push({
      name: item.name,
      kind: 'web',
      error: error.message.slice(0, 1000),
      expected: Array.from(expected.subarray(1, 6)),
      actual: [vm.pc, vm.sp, vm.floor, vm.fp, vm.switchValue],
    });
  }
}
const report = {
  exeSHA256: 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0',
  scope:
    'Selected original x86 VM handlers; authored bytecode and memory. OS/memcpy/log are harness services. This is not an observation of game startup.',
  cases: cases.length,
  passed: cases.length - failures.length,
  failures,
  golden,
};
if (process.argv[3]) {
  await mkdir(dirname(process.argv[3]), { recursive: true });
  await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
}
console.log(
  JSON.stringify(
    {
      cases: report.cases,
      passed: report.passed,
      failures: failures.length,
      firstFailures: failures.slice(0, 8),
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
