// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  nativeDataBuffer,
  NativeDataBuffers,
  NATIVE_DATA_BUFFER_LAYOUTS,
} from '../src/native/data-buffer.mjs';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import {
  dataBufferFixture,
  dataBufferPayload,
  runDataBufferCase,
} from './fixtures/data-buffer-fixture.mjs';

const profile = 'nekopara-vol3-engine-2.6.1.76';
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(
    `${profile} original heap release and data-buffer release share allocation ownership`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await fs.readFile(process.env[variable])),
        }),
        p = engine.process,
        buffers = new NativeDataBuffers(engine),
        heap = engine.kernel.heaps.get(p.load(NATIVE_ENGINE_IMAGES[profile].heap)),
        release = NATIVE_DATA_BUFFER_LAYOUTS[profile].heapRelease;
      try {
        for (const size of [0, 1, 8, 33, 1024]) {
          const data = buffers.allocateData(size);
          assert.equal(heap.blocks.has(data - 4), true);
          assert.equal(p.allocations.get(data - 4), size + 4);
          p.store(data - 4, 2);
          await engine.call(release, [data]);
          assert.equal(p.load(data - 4), 1);
          assert.equal(heap.blocks.has(data - 4), true);
          buffers.releaseData(data);
          assert.equal(p.allocations.has(data - 4), false);
          assert.equal(heap.blocks.has(data - 4), false);
          const other = buffers.allocateData(size);
          await engine.call(release, [other]);
          assert.equal(p.allocations.has(other - 4), false);
          assert.equal(heap.blocks.has(other - 4), false);
        }
      } finally {
        await engine.close();
      }
    },
  );
test('data-buffer ownership and allocation match original engine scalar evidence', async () => {
  const golden = JSON.parse(
    await fs.readFile(new URL('./fixtures/data-buffer-golden.json', import.meta.url)),
  );
  for (const entry of golden.cases)
    assert.deepEqual(
      await runDataBufferCase(profile, entry.case),
      entry.result,
      JSON.stringify(entry.case),
    );
});

test('data-buffer descriptor references and heap references have separate lifetimes', () => {
  const { buffers, process: p, handles } = dataBufferFixture(profile),
    pointer = buffers.createPointer(dataBufferPayload(33)),
    data = p.load(pointer),
    first = buffers.handle(pointer, { owner: 11 }),
    second = buffers.alias(first, { owner: 12 });
  assert.equal(p.load(pointer + 12), 2);
  assert.equal(p.load(data - 4), 1);
  buffers.release(first);
  assert.equal(buffers.pointer(second), pointer);
  assert.equal(p.load(pointer + 12), 1);
  assert.equal(p.load(data - 4), 1);
  assert.throws(() => handles.get(first, 'image-data'), /released/);
  buffers.release(second);
  assert.equal(p.allocations.has(pointer), false);
  assert.equal(p.allocations.has(data - 4), false);
  assert.throws(() => buffers.pointer(second), /released/);
});

test('borrowed buffers preserve their external allocation and clear only the descriptor', () => {
  const { buffers, process: p } = dataBufferFixture(profile),
    external = p.allocate(19),
    bytes = dataBufferPayload(19),
    pointer = buffers.wrapPointer(external, bytes.length);
  p.write(external, bytes);
  assert.deepEqual(buffers.data(pointer), bytes);
  buffers.releasePointer(pointer);
  assert.equal(p.allocations.has(pointer), false);
  assert.equal(p.allocations.has(external), true);
  assert.deepEqual(p.read(external, bytes.length), bytes);
});

test('original font ownership can invalidate a handle without creating a copied resource', () => {
  const { buffers, process: p } = dataBufferFixture(profile),
    pointer = buffers.createPointer(Uint8Array.of(1, 2, 3)),
    handle = buffers.handle(pointer);
  // The original font setter takes this reference without incrementing it.
  assert.equal(buffers.pointer(handle), pointer);
  assert.equal(p.load(pointer + 12), 1);
  buffers.releasePointer(pointer);
  assert.throws(() => buffers.pointer(handle), /released native data-buffer pointer/);
});

test('fresh restore retains one guest allocation shared by several opaque handles', () => {
  const before = dataBufferFixture(profile),
    pointer = before.buffers.createPointer(dataBufferPayload(260)),
    first = before.buffers.handle(pointer),
    second = before.buffers.alias(first),
    state = {
      process: before.process.snapshot(),
      handles: before.handles.snapshot(),
      buffers: before.buffers.snapshot(),
    },
    after = dataBufferFixture(profile);
  after.process.restore(state.process);
  after.handles.restore(state.handles);
  after.buffers.restore(state.buffers);
  assert.equal(after.buffers.pointer(first), after.buffers.pointer(second));
  assert.equal(after.process.load(pointer + 12), 2);
  after.buffers.release(first);
  assert.deepEqual(after.buffers.data(after.buffers.pointer(second)), dataBufferPayload(260));
  after.buffers.release(second);
  assert.equal(after.process.allocations.size, 0);
});

test('KCS image-data loading and release use the mounted image category and explicit replies', async () => {
  const reads = [],
    { buffers } = dataBufferFixture(profile, {
      read: async (name, category) => {
        reads.push([name, category]);
        return dataBufferPayload(9);
      },
    }),
    services = { dataBuffers: () => buffers, format: () => 'authored_日本語', owner: 22 },
    loaded = await nativeDataBuffer(0x16d, [0], {}, services);
  assert.equal(loaded.control, 1);
  assert.deepEqual(reads, [
    ['authored_日本語', 'image'],
    ['authored_日本語', 'image'],
  ]);
  assert.deepEqual(await nativeDataBuffer(0x16e, [loaded.value], {}, services), { control: 2 });
  assert.deepEqual(await nativeDataBuffer(0x16e, [0], {}, services), { control: 2 });
  assert.equal(await nativeDataBuffer(0x16f, [], {}, services), undefined);
  assert.equal(await nativeDataBuffer(0x16d, [0], {}, {}), undefined);
  await assert.rejects(nativeDataBuffer(0x16d, [], {}, services), /expects 1 arguments/);
});

test('metadata queries preserve null-handle output and distinguish file-header initialization', async () => {
  const {
      buffers,
      engine,
      process: p,
    } = dataBufferFixture(profile, {
      read: async (name) => (name === 'present' ? Uint8Array.of(1, 2, 3) : null),
    }),
    data = buffers.handle(buffers.createPointer(Uint8Array.of(1, 2, 3))),
    memory = new Uint8Array(64).fill(0xa5),
    machine = {
      bytes(address, size) {
        if (address < 0 || address + size > memory.length) throw new RangeError('Unmapped pointer');
        return memory.subarray(address, address + size);
      },
    },
    services = { dataBuffers: () => buffers, format: () => 'present' };
  engine.call = async (_address, args) => {
    p.store(args[1] + 8, 44);
    return 0;
  };
  const untouched = [...memory];
  assert.deepEqual(await nativeDataBuffer(0x170, [0, 0, 0], machine, services), {
    control: 1,
    value: 0,
  });
  assert.deepEqual([...memory], untouched);
  assert.deepEqual(await nativeDataBuffer(0x170, [data, 0, 0xffffffff], machine, services), {
    control: 1,
    value: 0,
  });
  assert.deepEqual([...memory], untouched);
  await nativeDataBuffer(0x170, [data, 17, 0], machine, services);
  assert.deepEqual([...memory.subarray(0, 36)], [...new Uint8Array(8), 44, ...new Uint8Array(27)]);
  assert.equal(memory[36], 0xa5);
  memory.fill(0xa5);
  await nativeDataBuffer(0x177, [1, 0], machine, services);
  assert.deepEqual([...memory.subarray(0, 8)], new Array(8).fill(0xa5));
  assert.equal(memory[8], 44);
  assert.deepEqual([...memory.subarray(12)], new Array(52).fill(0xa5));
  memory.fill(0xa5);
  await nativeDataBuffer(0x177, [1, 0], machine, { ...services, format: () => 'missing' });
  assert.deepEqual([...memory], untouched);
  assert.deepEqual(
    await nativeDataBuffer(0x177, [1, 0xffffffff], machine, {
      ...services,
      format: () => 'missing',
    }),
    { control: 1, value: 0 },
  );
  buffers.release(data);
});

test('bitmap decoding transfers its original wrapper and rolls back a rejected import', async () => {
  const closed = [],
    imported = [],
    services = {
      dataBuffers: () => ({
        pointer: (handle) => handle + 100,
        decodeBitmapPointer: async (pointer, selector) => pointer + selector,
        releaseBitmapPointer: async (pointer) => closed.push(pointer),
      }),
      owner: 28,
      importNativeBitmap: async (...args) => {
        imported.push(args);
        return 712;
      },
    };
  assert.deepEqual(await nativeDataBuffer(0x16c, [1, 9], {}, services), { control: 1, value: 712 });
  assert.deepEqual(imported, [[110, 28, { rowOrder: 'bottom-up' }]]);
  assert.deepEqual(closed, []);
  await assert.rejects(
    nativeDataBuffer(
      0x16c,
      [1, 9],
      {},
      {
        ...services,
        importNativeBitmap: () => {
          throw new Error('import failed');
        },
      },
    ),
    /import failed/,
  );
  assert.deepEqual(closed, [110]);
  assert.deepEqual(await nativeDataBuffer(0x16c, [0, 9], {}, services), { control: 1, value: 0 });
});
