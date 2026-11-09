// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bitmapMemoryFixture } from './fixtures/bitmap-memory-fixture.mjs';
import { imageOwnerFiles } from './fixtures/image-owner-fixture.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} persistent bitmap wrappers preserve aliases, native writes and final references`,
    { skip: !process.env[variable] },
    async () => {
      const f = await bitmapMemoryFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        { images, memory, process: p, engine } = f;
      try {
        const h = images.create(3, 2, 7),
          alias = images.alias(h, 8),
          bitmap = images.get(h);
        await bitmap.fill(0, 0, 3, 2, 0xff123456);
        const pointer = await memory.pointer(h),
          wrapper = await memory.wrapper(h),
          second = await memory.wrapper(alias);
        assert.equal(p.load(wrapper), pointer);
        assert.equal(p.load(second), pointer);
        assert.notEqual(wrapper, second);
        assert.equal(await memory.wrapper(h), wrapper);
        assert.equal(p.load(pointer + 80), 2);
        const frame = await bitmap.frame(),
          revision = bitmap.state.revision;
        await engine.call(p.load(NATIVE_EXE_PROFILES[profile].tables.main.va), [0, 0, 0, 0]);
        assert.equal(await bitmap.frame(), frame);
        assert.equal(bitmap.state.revision, revision);
        bitmap.state.offsetX = -3;
        bitmap.state.baseY = 7;
        bitmap.state.clip = [1, 0, 3, 2];
        assert.equal(p.load(pointer + 36), -3 >>> 0);
        assert.equal(images.get(alias).state.baseY, 7);
        assert.deepEqual([...bitmap.state.clip], [1, 0, 3, 2]);
        // Native writes cannot be overwritten merely by asking for its pointer.
        const pixels = p.load(pointer + 12),
          stride = p.load(pointer + 20);
        p.write(pixels + stride, Uint8Array.of(3, 2, 1, 4));
        assert.equal(await memory.pointer(h), pointer);
        assert.deepEqual([...(await bitmap.pixels()).slice(0, 4)], [1, 2, 3, 4]);
        const argv = p.allocate(24),
          out = p.allocate(4);
        bitmap.state.offsetX = 0;
        bitmap.state.baseY = 0;
        bitmap.state.clip = [0, 0, 3, 2];
        [wrapper, 0, 0, 1, 1, 0xffaabbcc].forEach((v, i) => p.store(argv + i * 4, v));
        await engine.call(p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + 0x75 * 4), [
          0,
          0,
          argv,
          out,
        ]);
        p.free(out);
        p.free(argv);
        assert.deepEqual(
          [...(await images.get(alias).pixels()).slice(12, 16)],
          [0xaa, 0xbb, 0xcc, 0xff],
        );
        await bitmap.fill(1, 0, 1, 1, 0x88112233);
        assert.deepEqual(
          [...p.read(p.load(pointer + 12) + stride + 4, 4)],
          [0x33, 0x22, 0x11, 0x88],
        );
        const later = images.alias(h, 9);
        assert.equal(await memory.pointer(later), pointer);
        assert.equal(p.load(pointer + 80), 3);
        p.store(pointer + 80, 4);
        await images.release(h);
        assert.equal(p.allocations.has(wrapper), false);
        assert.equal(p.load(pointer + 80), 3);
        await images.release(alias);
        await images.release(later);
        assert.equal(p.load(pointer + 80), 1);
        const attribute = p.allocate(20);
        [10, -20, 30, -40, 0xff800123].forEach((v, i) => p.store(attribute + i * 4, v));
        await f.memory.call(f.memory.layout.attribute, [7, 0, attribute], pointer);
        p.free(attribute);
        assert.equal(p.allocations.has(pointer), true);
        await memory.call(memory.layout.release, [], pointer);
        assert.equal(p.allocations.has(pointer), false);
      } finally {
        await engine.close();
      }
    },
  );
  test(
    `${profile} 16/24/32-bit guest rows project native color channels without changing storage`,
    { skip: !process.env[variable] },
    async () => {
      const f = await bitmapMemoryFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        h = f.images.create(4, 3),
        bitmap = f.images.get(h);
      try {
        const pointer = await f.memory.pointer(h),
          p = f.process,
          color = profile.startsWith('sdk-') ? 0x563840 : 0x68ccd0;
        for (const bpp of [2, 3, 4]) {
          const stride = (4 * bpp + 3) & ~3;
          p.store(pointer + 24, bpp);
          p.store(pointer + 20, stride);
          p.store(pointer + 16, stride * 3);
          p.write(
            p.load(pointer + 12),
            Uint8Array.from({ length: 48 }, (_, i) => (i * 37 + 19) & 255),
          );
          const rgba = await bitmap.pixels();
          for (let y = 0; y < 3; y++)
            for (let x = 0; x < 4; x++) {
              const value = await f.engine.call(color, [x, y], pointer),
                at = ((2 - y) * 4 + x) * 4,
                components = [(value >>> 16) & 255, (value >>> 8) & 255, value & 255, value >>> 24];
              assert.deepEqual(
                [...rgba.slice(at, at + 4)],
                bpp === 2
                  ? components.map((v) => (v / 16) * 17)
                  : bpp === 3
                    ? [...components.slice(0, 3), 255]
                    : components,
              );
            }
          const before = p.read(p.load(pointer + 12), stride * 3);
          await bitmap.changed();
          assert.deepEqual(p.read(p.load(pointer + 12), stride * 3), before);
        }
      } finally {
        await f.engine.close();
      }
    },
  );
  test(
    `${profile} physical bitmap checkpoint stores one guest pixel backing and restores independent aliases`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        f = await bitmapMemoryFixture(bytes, profile),
        fresh = await bitmapMemoryFixture(bytes, profile);
      try {
        const h = f.images.create(2, 2, 7),
          a = f.images.alias(h, 8);
        await f.images.get(h).fill(0, 0, 2, 2, 0x80123456);
        const wrapper = await f.memory.wrapper(h),
          pointer = await f.memory.pointer(a),
          state = structuredClone({ handles: f.handles.snapshot(), engine: f.engine.snapshot() });
        const savedData = state.handles.records.find(([, r]) => r.type === 'bitmap-data')[1];
        assert.equal(savedData.value.rgba, null);
        assert.equal(savedData.value.nativeBitmapPointer, pointer);
        fresh.handles.restore(state.handles);
        fresh.engine.restore(state.engine);
        assert.equal(await fresh.memory.wrapper(h), wrapper);
        assert.equal(await fresh.memory.pointer(a), pointer);
        assert.deepEqual(
          [...(await fresh.images.get(a).pixels()).slice(0, 4)],
          [0x12, 0x34, 0x56, 0x80],
        );
        await fresh.images.get(a).fill(0, 0, 1, 1, 0xffabcdef);
        assert.deepEqual(
          [...(await fresh.images.get(h).pixels()).slice(0, 4)],
          [0xab, 0xcd, 0xef, 0xff],
        );
        assert.deepEqual(
          [...(await f.images.get(h).pixels()).slice(0, 4)],
          [0x12, 0x34, 0x56, 0x80],
        );
        await fresh.images.releaseOwner(7);
        assert.equal(fresh.process.allocations.has(pointer), true);
        await fresh.images.releaseOwner(8);
        assert.equal(fresh.process.allocations.has(pointer), false);
      } finally {
        await fresh.engine.close();
        await f.engine.close();
      }
    },
  );
  test(
    `${profile} borrowed native bitmap mirrors share caches without retaining their original source`,
    { skip: !process.env[variable] },
    async () => {
      const f = await bitmapMemoryFixture(
        new Uint8Array(await readFile(process.env[variable])),
        profile,
      );
      try {
        const h = f.images.create(2, 1, 1),
          weak = f.images.create(2, 1, 2),
          pointer = await f.memory.pointer(h),
          p = f.process;
        await f.images.get(h).fill(0, 0, 2, 1, 0xff112233);
        f.memory.borrow(weak, pointer);
        assert.equal(p.load(pointer + 80), 1);
        const a = f.images.get(h),
          b = f.images.get(weak);
        assert.equal(await a.pixels(), await b.pixels());
        const oldFrame = await b.frame();
        await a.fill(0, 0, 1, 1, 0xffabcdef);
        assert.notEqual(await b.frame(), oldFrame);
        assert.deepEqual([...(await b.pixels()).slice(0, 4)], [0xab, 0xcd, 0xef, 255]);
        const saved = structuredClone({
          handles: f.handles.snapshot(),
          engine: f.engine.snapshot(),
        });
        const fresh = await bitmapMemoryFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        );
        try {
          fresh.handles.restore(saved.handles);
          fresh.engine.restore(saved.engine);
          assert.equal(await fresh.images.get(h).pixels(), await fresh.images.get(weak).pixels());
          await fresh.images.release(h);
          assert.equal(fresh.process.allocations.has(pointer), false);
          await fresh.images.release(weak);
        } finally {
          await fresh.engine.close();
        }
        await f.memory.wrapper(weak);
        assert.equal(p.load(pointer + 80), 2);
        await f.images.release(h);
        assert.equal(p.allocations.has(pointer), true);
        await f.images.release(weak);
        assert.equal(p.allocations.has(pointer), false);
      } finally {
        await f.engine.close();
      }
    },
  );
  test(
    `${profile} decoded bitmap adoption retains metadata, attributes and identity through resize and rotation`,
    { skip: !process.env[variable] },
    async () => {
      const f = await bitmapMemoryFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        source = (await imageOwnerFiles()).get('@cat/image/attr.hg3'),
        { buffers, process: p } = f;
      try {
        const block = buffers.wrapPointer(0, 0, { borrowed: false }),
          data = buffers.allocatePointer(block, source.length);
        p.write(data, source);
        const decoded = await buffers.decodeBitmapPointer(block, 0),
          pointer = p.load(decoded),
          h = await f.images.importNative(decoded, 7, { rowOrder: 'bottom-up' }),
          bitmap = f.images.get(h);
        assert.equal(p.allocations.has(decoded), false);
        assert.equal(await f.memory.pointer(h), pointer);
        assert.equal(p.load(pointer + 80), 1);
        assert.deepEqual(bitmap.state.attributes, [
          { id: 7, rect: [10, -20, 30, -40], color: 0xff800123 },
        ]);
        const head = p.load(p.load(pointer + 72)),
          attributeData = p.load(p.load(head) + 20);
        await bitmap.resize(8, 6);
        assert.equal(p.load(p.load(p.load(p.load(pointer + 72))) + 20), attributeData);
        assert.equal(await f.memory.pointer(h), pointer);
        assert.deepEqual([bitmap.width, bitmap.height], [8, 6]);
        assert.deepEqual(bitmap.state.attributes, [
          { id: 7, rect: [20, -40, 60, -80], color: 0xff800123 },
        ]);
        const alias = f.images.alias(h, 7),
          wrapper = await f.memory.wrapper(alias),
          before = (await bitmap.pixels()).slice(),
          canvasHeight = p.load(pointer + 32),
          rotate = (angle) => f.operations.apply(0x1d4, [alias, angle], f.machine, { id: 1 });
        assert.deepEqual(await rotate(89), { control: 2 });
        assert.deepEqual(await rotate(90), { control: 2 });
        assert.equal(p.load(wrapper), pointer);
        assert.equal(p.load(p.load(p.load(p.load(pointer + 72))) + 20), attributeData);
        assert.deepEqual([bitmap.width, bitmap.height], [6, 8]);
        assert.deepEqual(bitmap.state.attributes, [
          { id: 7, rect: [canvasHeight + 40, 20, 60, -80], color: 0xff800123 },
        ]);
        const expected = new Uint8Array(before.length);
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 6; x++) {
            const at = 4 * (8 * x + 7 - y);
            expected.set(before.subarray(at, at + 4), 4 * (6 * y + x));
          }
        assert.deepEqual([...(await f.images.get(alias).pixels())], [...expected]);

        p.store(pointer + 24, 3);
        const header = p.read(pointer, 92),
          pixels = p.read(p.load(pointer + 12), p.load(pointer + 16));
        await assert.rejects(rotate(180), /cannot fit a 18-byte row/);
        assert.deepEqual(p.read(pointer, 92), header);
        assert.deepEqual(p.read(p.load(pointer + 12), p.load(pointer + 16)), pixels);
        p.store(pointer + 24, 4);
        await f.images.release(alias);
        buffers.releasePointer(block);
        await f.images.release(h);
        assert.equal(p.allocations.has(pointer), false);
      } finally {
        await f.engine.close();
      }
    },
  );
}
