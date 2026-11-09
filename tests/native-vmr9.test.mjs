// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { EmoteD3D9 } from '../src/emote/native-d3d.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeVMR9 } from '../src/native/vmr9.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

test('the VMR9 notify vtable allocates its three surface kinds through the one D3D device', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn()),
    p = engine.process,
    d = new EmoteD3D9(p, { width: 8, height: 8 }),
    originalSize = d.objects.size;
  engine.registerFeature('renderer', { initialized: true, d3d: d, close: () => d.close() });
  const vmr = new NativeVMR9(engine),
    notify = vmr.create(),
    info = p.allocate(40, true),
    count = p.allocate(4, true),
    surfaces = p.allocate(16, true);
  const call = (...args) => vmr.call(notify, ...args);
  const request = (flags, format, pool, minimum, requested, width = 4) => {
    [flags, width, 8, format, pool, minimum, 3, 5, 3, 5].forEach((word, i) =>
      p.store(info + i * 4, word),
    );
    p.store(count, requested);
    for (let i = 0; i < 4; i++) p.store(surfaces + i * 4, 0xfedcba98);
    return call(6, info, count, surfaces);
  };
  try {
    assert.equal(await call(6, 0, count, surfaces), 0x80004003);
    assert.equal(await request(4, 21, 0, 1, 1), 0x80040227);
    assert.equal(await call(4, 0, d.monitor), 0x80004003);
    assert.equal(await call(4, d.device, d.monitor + 1), 0x80070057);
    assert.equal(await call(4, d.device, d.monitor), 0);
    assert.equal(await call(4, d.device, d.monitor), 0);
    assert.equal(d.objects.get(d.device).references, 2);
    for (const [flags, format, usage, kind, pool] of [
      [4, 22, 0x200, 'Texture9', 0],
      [4, 23, 0x200, 'Texture9', 2],
      [8, 21, 0, 'Surface9', 0],
      [8, 22, 0, 'Surface9', 2],
      [8, 21, 0, 'Surface9', 3],
      [1, 0, 1, 'Surface9', 2],
    ]) {
      assert.equal(await request(flags, format, pool, 1, 3), 0);
      assert.equal(p.load(count), 3);
      assert.equal(p.load(info + 12), format || 21);
      const pointers = Array.from({ length: 3 }, (_, i) => p.load(surfaces + i * 4));
      assert.equal(new Set(pointers).size, 3);
      for (const pointer of pointers) {
        const source = d.surfaceData(pointer);
        assert.deepEqual(
          [source.kind, source.usage, source.format, source.width, source.height, source.pool],
          [kind, usage, format || 21, 4, 8, flags === 1 ? 0 : pool],
        );
        assert.equal(await vmr.call(pointer, 2), 0);
      }
      assert.equal(p.load(surfaces + 12), 0xfedcba98);
      assert.equal(d.objects.size, originalSize);
    }
    for (const [args, result, actual] of [
      [[12, 22, 0, 1, 1], 0x80070057, 1],
      [[2, 22, 0, 1, 1], 0x80004001, 1],
      [[4, 22, 0, 2, 1], 0x80070057, 1],
      [[4, 22, 1, 1, 1], 0x8876086c, 0],
      [[4, 22, 3, 1, 1], 0x8876086c, 0],
      [[8, 22, 1, 1, 1], 0x8876086c, 0],
      [[4, 22, 0, 1, 1, 0], 0x8876086c, 0],
      [[4, 0x32595559, 0, 1, 1], 0x8876086a, 0],
    ]) {
      assert.equal(await request(...args), result);
      assert.equal(p.load(count), actual);
      assert.equal(p.load(surfaces), 0xfedcba98);
      assert.equal(d.objects.size, originalSize);
    }
    // Space for two real surfaces. A failed minimum leaves no live objects.
    d.textureMemoryBudget = d.textureMemoryBudget - d.availableTextureMemory() + 2 * 4 * 8 * 4;
    assert.equal(await request(4, 22, 0, 3, 3), 0x8876017c);
    assert.equal(p.load(count), 0);
    assert.equal(p.load(surfaces), 0xfedcba98);
    assert.equal(d.objects.size, originalSize);
    assert.equal(await request(4, 22, 0, 2, 3), 0);
    assert.equal(p.load(count), 2);
    assert.equal(p.load(surfaces + 8), 0xfedcba98);
    for (const offset of [0, 4]) assert.equal(await vmr.call(p.load(surfaces + offset), 2), 0);
    assert.equal(await call(7, 3, 0x12, 0x34), 0x8004025f);
    const sink = p.allocate(4, true),
      table = p.allocate(16, true),
      events = [];
    p.store(sink, table);
    p.store(
      table + 12,
      p.trap('authored VMR event sink', 4, (args) => {
        events.push(args);
        return 0;
      }),
    );
    vmr.bindEventSink(notify, sink);
    assert.equal(await call(7, 3, 0x12, 0x34), 0);
    assert.deepEqual(events, [[sink, 3, 0x12, 0x34]]);
    assert.equal(await call(2), 0);
    assert.equal(d.objects.get(d.device).references, 1);
    assert.equal(d.objects.size, originalSize);
    assert.equal(p.allocations.has(notify), false);
  } finally {
    await engine.close();
  }
});
