// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';

function fixture() {
  const bytes = new Uint8Array(64 + 148 * 4),
    machine = new KCSMachine({
      body: new Binary(bytes),
      codeSize: 64,
      data: new Uint8Array(64),
      stackSize: 64,
      debugOffset: 64,
      debugSize: 148 * 4,
    });
  const step = (op, ...args) => {
    bytes.set(
      [op, ...args.flatMap((n) => [0x23, n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24])],
      0,
    );
    machine.pc = 0;
    machine.step();
  };
  return { machine, bytes, step };
}
test('compiler symbol ranges preserve global/local scope markers through calls, explicit pops and restore', () => {
  const { machine, step } = fixture();
  step(67, 0, 2);
  step(42, 50, 0);
  step(67, 2, 2);
  step(68, 1);
  assert.deepEqual(machine.debug.locals, [0, 1, 2]);
  assert.deepEqual(machine.debug.scopes, [0, 2]);
  const { machine: fresh } = fixture();
  fresh.restore(structuredClone(machine.snapshot()));
  assert.deepEqual(fresh.debug.scopes, [0, 2]);
  step(44, 0, 0);
  assert.deepEqual(machine.debug.scopes, [0]);
  assert.deepEqual(machine.debug.locals, [0, 1, 2]);
});
test('function debug records retain VM addresses until RETURN removes them', () => {
  const { machine, step } = fixture();
  machine.writeString('before', 4);
  step(42, 50, 0);
  step(66, 4);
  assert.deepEqual(machine.debug.functions, [4]);
  machine.writeString('after', 4);
  assert.equal(machine.string(machine.debug.functions[0]), 'after');
  step(44, 0, 0);
  assert.deepEqual(machine.debug.functions, []);
});
test('external shared views refresh after WASM growth and ordinary assignment clears the binding', () => {
  const { machine } = fixture(),
    memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
  machine.bindShared({ bytes: () => new Uint8Array(memory.buffer, 256, 32) });
  machine.store(0x80000004, 0xabcdef01);
  assert.equal(new DataView(memory.buffer).getUint32(260, true), 0xabcdef01);
  const old = machine.shared;
  memory.grow(1);
  assert.equal(old.length, 0);
  assert.equal(machine.load(0x80000004), 0xabcdef01);
  machine.bytes(0x80000008, 4).set([1, 2, 3, 4]);
  assert.equal(new DataView(memory.buffer).getUint32(264, true), 0x04030201);
  machine.shared = new Uint8Array(16);
  machine.store(0x80000004, 7);
  assert.equal(new DataView(memory.buffer).getUint32(260, true), 0xabcdef01);
});
test('contiguous memory and stable allocation identities retain live data/stack/block views after growth', () => {
  const { machine } = fixture(),
    memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  new Uint8Array(memory.buffer, 4096, 128).set(machine.memory);
  machine.bindMemory({ bytes: () => new Uint8Array(memory.buffer, 4096, 128) });
  const first = machine.allocate(16),
    second = machine.allocate(32),
    ids = machine.blockIDs;
  machine.bindBlock(0, { bytes: () => new Uint8Array(memory.buffer, 8192, 16) });
  machine.bindBlock(1, { bytes: () => new Uint8Array(memory.buffer, 8448, 32) });
  machine.data[4] = 7;
  machine.stack[0] = 9;
  machine.store(second + 4, 0x12345678);
  const old = machine.data;
  memory.grow(1);
  assert.equal(old.length, 0);
  assert.equal(machine.data[4], 7);
  assert.equal(machine.stack[0], 9);
  assert.equal(machine.free(first), true);
  assert.deepEqual(machine.blockIDs, [ids[1]]);
  assert.equal(machine.load(machine.memory.length + 4), 0x12345678);
  const state = structuredClone(machine.snapshot()),
    { machine: fresh } = fixture();
  fresh.restore(state);
  assert.equal(fresh.memoryID, machine.memoryID);
  assert.deepEqual(fresh.blockIDs, [ids[1]]);
  assert.equal(fresh.load(fresh.memory.length + 4), 0x12345678);
  assert.ok(fresh.allocate(8) > fresh.memory.length);
  assert.ok(fresh.blockIDs.at(-1) > ids[1]);
});
test('symbol queries retain the original record bytes and signed byte value while preserving the extra output tail', () => {
  const { machine, bytes, step } = fixture(),
    record = new DataView(bytes.buffer, 64, 148);
  record.setUint32(0, 3, true);
  bytes[72] = 0x2a;
  bytes[76] = 65;
  machine.store(3, 0xfe, 1);
  step(67, 0, 1);
  const output = new Uint8Array(160).fill(0xa7);
  assert.equal(machine.debugSymbol(0, false, output), true);
  assert.equal(new DataView(output.buffer).getUint32(148, true), 0xfffffffe);
  assert.deepEqual([...output.subarray(152)], Array(8).fill(0xa7));
  assert.equal(machine.debugSymbol(1, false, output), false);
});
test('descriptor refresh uses its separate shared-memory tag and frame-relative flag', () => {
  const { machine } = fixture(),
    bytes = new Uint8Array(156),
    view = new DataView(bytes.buffer);
  bytes[8] = 0x29;
  machine.store(0x80000010, 0xabcdef01);
  view.setUint32(0, 0x40000010, true);
  machine.debugValue(bytes);
  assert.equal(view.getUint32(148, true), 0xabcdef01);
  machine.store(64, 0x76543210);
  view.setUint32(0, 0, true);
  view.setUint32(152, 1, true);
  machine.debugValue(bytes);
  assert.equal(view.getUint32(148, true), 0x76543210);
  bytes[9] = 1;
  view.setUint32(0, 0xffffffff, true);
  machine.debugValue(bytes);
  assert.equal(view.getUint32(148, true), 0xbfffffff);
});
