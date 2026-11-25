// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, formatNativeAt } from '../src/kcs.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-format-golden.json', import.meta.url)),
  ),
  decoder = new TextDecoder('shift_jis'),
  copyProgram = kcsProgram([
    [37, 0x36eb67a5],
    [37, [0x13, 64]],
    [37, 128],
    [43, 14, 8],
    [38, [0x13, 68]],
    [37, 77],
    [38, [0x13, 72]],
    [37, 240],
    [43, 71, 4],
    [38, [0x13, 80]],
    [37, [0x13, 64]],
    [37, 128],
    [43, 14, 8],
    [38, [0x13, 84]],
    [59],
  ]);
function seed(machine, input) {
  const source = Buffer.from(input.source, 'base64');
  machine.bytes(128, source.length + 1).set([...source, 0]);
  machine.store(512, input.word);
  for (const store of input.stores) {
    const bytes = Buffer.from(store.bytes, 'base64');
    machine.bytes(store.address, bytes.length).set(bytes);
  }
}
function machine() {
  return new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(4096),
    stackSize: 4096,
  });
}
for (const { profile } of golden.builds) {
  test(`${profile} byte formatter matches its own physical CRT fixtures`, () => {
    for (const input of golden.cases) {
      const vm = machine();
      seed(vm, input);
      assert.deepEqual(
        formatNativeAt(128, vm),
        Uint8Array.from(Buffer.from(input.expected, 'base64')),
        input.name,
      );
    }
  });
  test(`${profile} formatted-copy GCALL retains native bytes and cold continuations`, async () => {
    const files = { 'case.kcs': kcsProgram([[59]]), 'format.kcs': copyProgram },
      world = await dataWorld(profile, files),
      cold = new Set([
        'float-infinity',
        'precision-101-1066192077',
        'recursive-depth-60',
        'cp932-string-precision1',
      ]);
    try {
      for (const input of golden.cases) {
        const task = await world.spawnScript('format.kcs', {
            parent: world.main.id,
            initialExecute: false,
          }),
          vm = task.machine,
          expected = Uint8Array.from(Buffer.from(input.expected, 'base64')),
          zero = expected.indexOf(0),
          value = zero < 0 ? expected : expected.subarray(0, zero),
          destination = vm.allocate(value.length + 3);
        seed(vm, input);
        vm.store(64, destination);
        vm.bytes(destination, value.length + 3).fill(0xa5);
        await world.runtime.scheduler.execute(task);
        assert.equal(vm.load(68), destination, input.name);
        assert.equal(vm.load(72), 77, input.name);
        assert.deepEqual(
          vm.bytes(destination, value.length + 3),
          Uint8Array.from([...value, 0, 0, 0xa5]),
          input.name,
        );
        assert.equal(vm.waiting.native, 71, input.name);
        // The text service decodes the complete byte result exactly once.
        assert.equal(world.runtime.services.format(128, vm), decoder.decode(value), input.name);
        if (cold.has(input.name)) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
            fresh = await dataWorld(profile, files, { initialize: false });
          try {
            await fresh.restore(state);
            const restored = fresh.runtime.scheduler.tasks.get(task.id);
            assert.deepEqual(fresh.snapshot(), world.snapshot(), input.name);
            assert.deepEqual(
              restored.machine.bytes(destination, value.length + 3),
              vm.bytes(destination, value.length + 3),
              input.name,
            );
            await fresh.runtime.scheduler.send(task.id, [1, 2, 3, 4]);
            assert.equal(restored.machine.halted, true, input.name);
            assert.equal(restored.machine.load(80), 1, input.name);
            assert.equal(restored.machine.load(84), destination, input.name);
            assert.deepEqual(
              restored.machine.bytes(destination, value.length + 3),
              vm.bytes(destination, value.length + 3),
              input.name,
            );
            assert.equal(restored.machine.pop(), 0x36eb67a5, input.name);
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
        await world.objects.release(task.id);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test('formatting diagnoses actual temporary overflows and cyclic sources', () => {
  const vm = machine();
  vm.writeString('%10240d[G512]', 128);
  vm.store(512, 42);
  assert.throws(() => formatNativeAt(128, vm), /original VM temporary/);
  vm.writeString('%s[G1024]', 128);
  vm.bytes(1024, 2049).fill(65);
  vm.store(1024 + 2048, 0, 1);
  assert.throws(() => formatNativeAt(128, vm), /original recursive temporary/);
  vm.writeString('%s[G128]', 128);
  assert.throws(() => formatNativeAt(128, vm), /cyclic string/);
});

const integerGolden = JSON.parse(
  await readFile(new URL('./fixtures/native-format-integer-golden.json', import.meta.url)),
);
for (const { profile } of integerGolden.builds) {
  test(`${profile} integer prefix/precision matches own Main14 including alias and cold`, async () => {
    const files = {
        'integer.kcs': kcsProgram([
          [37, 0x36eb67a5],
          [37, [0x13, 64]],
          [37, 128],
          [43, 14, 8],
          [59],
        ]),
      },
      world = await dataWorld(profile, files);
    try {
      for (const input of integerGolden.cases) {
        const task = await world.spawnScript('integer.kcs', {
            parent: world.main.id,
            initialExecute: false,
          }),
          vm = task.machine,
          expected = Uint8Array.from(Buffer.from(input.expected, 'base64')),
          allocation = vm.allocate(expected.length + 8),
          destination = input.destination ?? allocation;
        vm.bytes(allocation, expected.length + 8).fill(0xa5);
        seed(vm, input);
        vm.store(64, destination);
        assert.deepEqual(formatNativeAt(128, vm), expected, input.name);
        const check = async (target, current) => {
          const original = target.runtime.native.bind(target.runtime);
          target.runtime.native = (...args) => {
            const machine = args[3],
              before = [
                machine.memory.slice(),
                machine.shared.slice(),
                ...machine.blocks.map((_, i) => machine.blockBytes(i).slice()),
              ],
              [region, offset] = machine.region(destination),
              index = region === machine.memory ? 0 : region === machine.shared ? 1 : 2,
              reply = original(...args);
            before[index].set([...expected, 0, 0], offset);
            assert.deepEqual(
              [
                machine.memory.slice(),
                machine.shared.slice(),
                ...machine.blocks.map((_, i) => machine.blockBytes(i).slice()),
              ],
              before,
              input.name,
            );
            assert.equal(reply.control, 1, input.name);
            assert.equal(reply.value, destination, input.name);
            return reply;
          };
          try {
            await target.runtime.scheduler.execute(current);
            assert.equal(current.machine.pop(), destination, input.name);
            assert.equal(current.machine.pop(), 0x36eb67a5, input.name);
          } finally {
            target.runtime.native = original;
          }
        };
        if (['short-zero-p0-x', 'integer-p513', 'short-negative-min'].includes(input.name)) {
          const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot())),
            fresh = await dataWorld(profile, files, { initialize: false });
          try {
            await fresh.restore(state);
            await check(fresh, fresh.runtime.scheduler.tasks.get(task.id));
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
        await check(world, task);
        await world.objects.release(task.id);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
