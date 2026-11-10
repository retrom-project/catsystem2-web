// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeFrames } from './browser/native-performance.mjs';

test('profile counters sum array and typed-array bytes and restore host methods after sampling', async () => {
  const previous = globalThis.window;
  const host = {
    allocations: new Map([[0, 16]]),
    regions: [{ kind: 'heap', address: 0 }],
    heap: 16,
    heapLimit: 512,
    freeBlocks: [],
    cpu: { emu_start() {}, mem_protect() {} },
    uc: { ccall() {} },
    map() {},
    unmap() {},
    invalidateExecutable() {},
    read() {},
    write() {},
  };
  const originalWrite = host.write;
  const world = {
    frame: 121,
    nativeEngine: { process: host, options: {}, kernel: {}, features: new Map() },
    runtime: { handles: { records: new Map() } },
    graphics: {},
    async tick() {
      this.frame++;
    },
  };
  const events = [];
  globalThis.window = {
    catSystem2: { world, status: () => ({ stack: [] }), async snapshot() {} },
    async captureNativeProfile(event, evidence) {
      events.push({ event, evidence });
    },
    async nativeGameFrame() {
      host.write(0, [1, 2, 3]);
      host.write(0, new Uint8Array(5));
      host.read(0, 7);
      host.cpu.emu_start();
      host.uc.ccall();
      await world.tick();
    },
  };
  try {
    observeFrames();
    await window.nativeGameFrame();
    const totals = window.nativePerformance.totals;
    assert.equal(totals.writeBytes, 8);
    assert.equal(totals.readBytes, 7);
    assert.equal(totals.emuStart, 1);
    assert.equal(totals.wasmCalls, 1);
    assert.equal(host.write, originalWrite);
    assert.deepEqual(
      events.map(({ event }) => event),
      ['start', 'stop'],
    );
    assert.equal(events[1].evidence.after.liveBytes, 16);
    await window.nativeGameFrame();
    assert.equal(totals.writeBytes, 8);
  } finally {
    globalThis.window = previous;
  }
});
