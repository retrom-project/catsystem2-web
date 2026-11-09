// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

test('a separate PE32 thread resumes its original import frame in a fresh process', async () => {
  const unicorn = await loadUnicorn(),
    make = () => {
      const p = new PE32Process(unicorn);
      const wait = p.trap('authored blocking import', 0, () =>
        p.stopThread({ wait: { handle: 17 } }),
      );
      return { p, wait };
    },
    { p, wait } = make(),
    entry = p.allocate(64, true),
    out = p.allocate(8, true),
    teb = p.allocate(4096, true),
    stackBottom = p.allocate(65536, true),
    thread = { teb, stackBottom, stackTop: stackBottom + 65536, registers: null },
    main = p.teb;
  let fresh;
  try {
    p.initializeTEB(teb, thread.stackBottom, thread.stackTop, 2);
    p.store(out + 4, 19);
    // Store the worker TEB, then keep EBX and the original return frame across the wait.
    p.write(
      entry,
      [
        0x53, 0x8b, 0x5c, 0x24, 8, 0x64, 0xa1, 0x18, 0, 0, 0, 0x89, 0x03, 0xb8, 0, 0, 0, 0, 0xff,
        0xd0, 0x03, 0x43, 4, 0x5b, 0xc2, 4, 0,
      ],
    );
    p.store(entry + 14, wait);
    const duringCallback = p.trap('authored parent callback', 0, async () => {
      const before = p.registers();
      assert.deepEqual(await p.runThread(thread, entry, out), { wait: { handle: 17 } });
      assert.deepEqual(p.registers(), before);
      assert.equal(p.teb, main);
      return 7;
    });
    assert.equal(await p.callAsync(duringCallback), 7);
    assert.equal(p.load(out), teb);
    assert.ok(thread.registers);
    const state = p.snapshot(),
      parked = structuredClone(thread);
    fresh = make().p;
    fresh.trap('authored parent callback', 0, () => {});
    fresh.restore(state);
    const parentRegisters = fresh.registers();
    assert.equal(await fresh.runThread(parked, entry, out, () => null), null);
    assert.deepEqual(await fresh.runThread(parked, entry, out, () => 23), { exitCode: 42 });
    assert.equal(parked.registers, null);
    assert.deepEqual(fresh.registers(), parentRegisters);
    assert.equal(fresh.teb, main);
    assert.equal(fresh.load(teb + 0x24), 2);
    assert.ok(thread.registers);
  } finally {
    fresh?.close();
    p.close();
  }
});
