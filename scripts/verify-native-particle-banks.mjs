// SPDX-License-Identifier: MPL-2.0
// Run the pinned CST bank loops, intercepting only the original native task calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { nodeGame } from './node-files.mjs';
import { readKCS, KCSMachine, nativeReply } from '../src/kcs.mjs';

const [root] = process.argv.slice(2);
if (!root) throw new Error('Usage: node scripts/verify-native-particle-banks.mjs FIXTURE_ROOT');

const fixtures = [
  {
    path: 'catsystem2-4.01/sdk/system',
    sha256: '17de548390b8c2b15a4f413418bbf1b408d6dee6ab830879f09cf305f5c128fd',
    table: 0x16314,
    stops: [0x702c8, 0x72769, 0x7a5e7],
    load: 0x975a3,
  },
  {
    path: 'nekopara-vol3/analysis/game',
    sha256: '5554f1f99f83c63087572ec1a7fb8ddf31987cedab4185c8503a1b1e29f5011a',
    table: 0x16c9c,
    stops: [0x736d3, 0x75b74, 0x7db31],
    load: 0x9b13c,
  },
];

for (const { path, sha256, table, stops, load } of fixtures) {
  const game = await nodeGame(resolve(root, path)),
    bytes = await game.require('sscript.kcs');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, path);
  const calls = [],
    vm = new KCSMachine(await readKCS(bytes), {
      native(id, args) {
        calls.push([id, ...args]);
        return id === 0x42 ? nativeReply(1, 70 + calls.length) : nativeReply(2);
      },
    }),
    slot = (index) => table + 0xc64 + index * 4;
  function start(pc, frameSize) {
    calls.length = 0;
    vm.start(pc);
    vm.sp = vm.floor = vm.fp + frameSize;
  }
  function executeTo(end) {
    assert.equal(vm.run(3000, () => vm.pc === end).status, 'stopped');
    assert.equal(vm.pc, end);
  }
  for (const [i, pc] of stops.entries()) {
    const count = i === 0 ? 4 : 8,
      tasks = Array.from({ length: 8 }, (_, n) => 0x12 + n),
      end = vm.instruction(pc + 11).args[0].value;
    start(pc - 0x18, 0x44);
    vm.store(table, 0xff000123);
    tasks.forEach((task, n) => vm.store(slot(n), task));
    executeTo(end);
    assert.deepEqual(
      calls,
      tasks.slice(0, count).flatMap((task) => [
        [0x111, task],
        [0x43, task],
      ]),
    );
    assert.deepEqual(
      tasks.map((_, n) => vm.load(slot(n))),
      tasks.map((task, n) => (n < count ? 0 : task)),
    );
    assert.equal(vm.load(table), i === 0 ? 0xf0000123 : 0x123);
    // Every explicit stop form indexes the shared table, including its last slot.
    start(end + 6, 0x44);
    vm.store(vm.fp + 0x34, 7);
    vm.store(slot(7), 0x49);
    executeTo(vm.instruction(end).args[0].value);
    assert.deepEqual(calls, [
      [0x111, 0x49],
      [0x43, 0x49],
    ]);
    assert.equal(vm.load(slot(7)), 0);
  }
  start(load - 0x18, 0x20);
  vm.store(table, 0x90000000);
  for (const [index, id, name] of [
    [4, 0, 'snow'],
    [7, 1, 'effect'],
  ]) {
    const descriptor = table + 4 + index * 0x18c;
    vm.writeString(name, descriptor);
    vm.writeString('quad', descriptor + 0x20);
    vm.store(descriptor + 0x40, 13 + id);
    vm.store(descriptor + 0x44, 440 + id);
    vm.store(descriptor + 0xcc, 255);
    vm.store(descriptor + 0xe4, 0xffffffff);
    vm.store(descriptor + 0x170, id);
    vm.store(slot(index), 0);
  }
  executeTo(vm.instruction(load + 11).args[0].value);
  assert.deepEqual(
    calls.map(([id]) => id),
    [0x42, 0x10f, 0x1aa, 0x110, 0x42, 0x2b5, 0x1aa, 0x110],
  );
  assert.deepEqual(
    [calls[1], calls[5]].map(([, task, name, texture, count, priority]) => [
      task,
      vm.string(name),
      vm.string(texture),
      count,
      priority,
    ]),
    [
      [71, 'snow', 'quad', 13, 440],
      [75, 'effect', 'quad', 14, 441],
    ],
  );
  assert.deepEqual([vm.load(slot(4)), vm.load(slot(7))], [71, 75]);
  console.log(`${path}: stop-all 4/8/8, explicit stop at 7, PTCL and PPI load in upper slots`);
}
