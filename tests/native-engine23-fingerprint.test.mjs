// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
const caller = 'sdk-call.kcs';
const sentinel = 0xe8a7b319;

async function guest(code, { services = {}, initial = () => {} } = {}) {
  const bytes = kcsProgram([[37, sentinel], ...code, [59]]);
  const runtime = new NativeRuntime({ profile, read: async () => bytes, services });
  const task = await runtime.spawn(caller);
  initial(task.machine);
  return { task, runtime };
}

async function result(code, options) {
  const { task, runtime } = await guest(code, options);
  await runtime.tick();
  const { machine } = task;
  assert.equal(task.status, 'finished');
  assert.equal(machine.sp, machine.floor + 8, 'control 1 pushes exactly one word');
  const value = machine.pop();
  assert.equal(machine.pop(), sentinel);
  return value;
}

test('fixed 2.6.1.23 clock wrapper returns the current DWORD and handles rollover', async () => {
  const entry = nativeABI(profile).tables.main.entries[4];
  assert.equal(entry.signature.argumentWords, 0);
  assert.equal(entry.signature.resultWritten, true);
  let now = 0xfffffff0;
  const clock = new NativeSystemClock({ now: () => now });
  const services = { clock: () => clock.now() };
  assert.equal(await result([[43, 4, 0]], { services }), 0xfffffff0);
  now = 0x23;
  assert.equal(await result([[43, 4, 0]], { services }), 0x23);
});

test('fixed 2.6.1.23 integer parser consumes a CP932 format string from the guest frame', async () => {
  const entry = nativeABI(profile).tables.main.entries[25];
  assert.equal(entry.signature.argumentWords, 1);
  assert.equal(entry.signature.resultWritten, true);
  assert.deepEqual(entry.parameters[0].type, {
    addressSpace: 'vm',
    direction: 'in',
    kind: 'pointer',
    target: { kind: 'format-string', encoding: 'CP932' },
  });
  const cases = [
    ['-0xabcDtail', 0xffff5433],
    ['0X80invalid', 128],
    ['42.5', 0],
    [' 7', 0],
    ['4294967297', 1],
    ['0xFFFFFFFF', 0xffffffff],
    ['-2147483648', 0x80000000],
    ['+106;', 106],
    ['12日', 12],
    ['１２', 0],
    ['1e3', 1],
  ];
  for (const [text, word] of cases)
    assert.equal(
      await result(
        [
          [61, 256],
          [43, 25, 4],
        ],
        {
          initial: (machine) => machine.writeString(text, machine.fp + 256),
        },
      ),
      word,
      text,
    );
  assert.equal(
    await result(
      [
        [61, 256],
        [43, 25, 4],
      ],
      {
        initial: (machine) => {
          machine.store(128, 9);
          machine.writeString('-%d[G128]', machine.fp + 256);
        },
      },
    ),
    0xfffffff7,
  );
});

test('fixed 2.6.1.23 weekday uses signed century arithmetic from three guest words', async () => {
  const entry = nativeABI(profile).tables.main.entries[786];
  assert.equal(entry.signature.argumentWords, 3);
  assert.equal(entry.signature.resultWritten, true);
  const cases = [
    [2000, 2, 29, 2],
    [1900, 3, 1, -3],
    [2026, 11, 24, 2],
    [-1, 1, 1, 6],
    [0, 1, 1, 0],
    [-444, 11, 0, -4],
    [99999999, 1, 1, -2],
    [1, -1, -20, 3],
    [0x7fffffff, 0x7fffffff, 0x7fffffff, 5],
    [-0x80000000, -0x80000000, -0x80000000, 5],
  ];
  for (const [year, month, day, word] of cases)
    assert.equal(
      await result([...[64, 68, 72].map((address) => [37, [0x13, address]]), [43, 786, 12]], {
        initial: (machine) => {
          machine.store(64, year);
          machine.store(68, month);
          machine.store(72, day);
        },
      }),
      word >>> 0,
      [year, month, day].join('/'),
    );
});

test('fixed 2.6.1.23 clock, integer and weekday check arity and mapped string addresses', async () => {
  const cases = [
    [4, [0], /expects 0 arguments/],
    [25, [], /expects 1 arguments/],
    [25, [0xffffffff], /KCS memory ffffffff/],
    [786, [2026, 11], /expects year, month and day/],
  ];
  for (const [id, args, error] of cases) {
    const { runtime, task } = await guest([
      ...args.map((word) => [37, word]),
      [43, id, args.length * 4],
    ]);
    await assert.rejects(runtime.tick(), error);
    assert.equal(task.status, 'failed');
    assert.equal(task.machine.sp, task.machine.floor + 4);
    assert.equal(task.machine.pop(), sentinel);
  }
});
