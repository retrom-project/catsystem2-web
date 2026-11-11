// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { PPIWindowsServices } from '../src/ppi/native-services.mjs';
import { nativeRendererPixelMemory } from '../oracle/renderer-consumer-projection.mjs';

test('a large renderer projection commits one nonexecutable span during a guest COM callback', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new PPIWindowsServices(p),
    memory = nativeRendererPixelMemory({ process: p, kernel }),
    // Real D3D interface dimensions that exposed the page-protection stall.
    bytes = 4095 * 4 * 2122,
    heap = p.heap;
  try {
    const allocate = p.trap('authored large renderer projection', 0, () => memory.allocate(bytes)),
      pointer = await p.callAsync(allocate),
      region = p.regions.find((r) => r.address === pointer);
    assert.ok(pointer && pointer >= p.heapLimit);
    assert.equal(region.permissions, p.uc.PROT_READ | p.uc.PROT_WRITE);
    assert.equal(region.size, Math.ceil(bytes / 4096) * 4096);
    assert.equal(kernel.virtual.get(pointer).committed.size, region.size / 4096);
    assert.deepEqual(p.read(pointer, 16), new Uint8Array(16));
    p.write(pointer + bytes - 4, Uint8Array.of(9, 8, 7, 6));
    assert.deepEqual(p.read(pointer + bytes - 4, 4), Uint8Array.of(9, 8, 7, 6));
    assert.equal(memory.free(pointer), 1);
    assert.ok(!p.regions.includes(region));
    assert.throws(() => memory.free(pointer), /live owner/);
    assert.equal(p.heap, heap); // trap bytes do not allocate guest heap storage.
  } finally {
    p.close();
  }
});

test('render projections retain ownership, holes and bytes across a current checkpoint', async () => {
  const backend = await loadUnicorn(),
    processes = [new PE32Process(backend), new PE32Process(backend)],
    services = processes.map((p) => new PPIWindowsServices(p)),
    memory = processes.map((process, i) =>
      nativeRendererPixelMemory({ process, kernel: services[i] }),
    );
  try {
    const foreign = services[0].virtualAllocate(0, 4096, 0x3000, 4),
      first = memory[0].allocate(4095 * 4 * 2122),
      second = memory[0].allocate(4096);
    assert.notEqual(first, foreign);
    assert.throws(() => memory[0].free(foreign), /live owner/);
    const large = { process: processes[0].snapshot(), kernel: services[0].snapshot() };
    processes[1].restore(large.process);
    services[1].restore(large.kernel);
    assert.equal(services[1].protectionAt(first), 4);
    processes[0].write(second, Uint8Array.of(1, 2, 3, 4));
    memory[0].free(first);
    assert.equal(memory[0].allocate(4096), first);
    const snapshot = { process: processes[0].snapshot(), kernel: services[0].snapshot() };
    processes[1].restore(snapshot.process);
    services[1].restore(snapshot.kernel);
    assert.deepEqual(processes[1].read(second, 4), Uint8Array.of(1, 2, 3, 4));
    assert.equal(memory[1].free(second), 1);
    assert.ok(services[1].virtual.has(foreign));
    assert.equal(memory[1].allocate(0), 0);
    assert.equal(memory[1].allocate(2 ** 31), 0);
  } finally {
    for (const process of processes) process.close();
  }
});

test('a renderer projection restores explicitly protected pages and decommitted holes', async () => {
  const backend = await loadUnicorn(),
    processes = [new PE32Process(backend), new PE32Process(backend)],
    services = processes.map((p) => new PPIWindowsServices(p)),
    memory = nativeRendererPixelMemory({ process: processes[0], kernel: services[0] });
  try {
    const at = memory.allocate(4 * 4096),
      oldProtection = processes[0].allocate(4);
    assert.equal(services[0].virtualProtect(at + 4096, 4096, 2, oldProtection), 1);
    assert.equal(services[0].virtualFree(at + 8192, 4096, 0x4000), 1);
    const saved = { process: processes[0].snapshot(), kernel: services[0].snapshot() };
    processes[1].restore(saved.process);
    services[1].restore(saved.kernel);
    for (const [offset, permissions] of [
      [0, 3],
      [4096, 1],
      [8192, 0],
      [12288, 3],
    ]) {
      const page = BigInt(at + offset),
        region = processes[1].cpu
          .mem_regions()
          .find(({ begin, end }) => page >= begin && page <= end);
      assert.equal(region.perms, permissions);
    }
    assert.equal(services[1].protectionAt(at + 8192), undefined);
    assert.equal(services[1].protectionAt(at + 4096), 2);
    assert.equal(
      nativeRendererPixelMemory({ process: processes[1], kernel: services[1] }).free(at),
      1,
    );
  } finally {
    for (const process of processes) process.close();
  }
});
