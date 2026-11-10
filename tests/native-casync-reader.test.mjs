// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { installNativeEngineWorkers } from '../src/native/engine-workers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const PROFILES = [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x705730, 0x704cb0, 0x1f0],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x5bd580, 0x5bca60, 0x1e8],
];
const movie = 'authored/casync.avi',
  block = 0x400000,
  asyncReader = [0x56a868aa, 0x11ce0ad4, 0x20003ab0, 0x70a70baf];

function virtual(engine, pointer, slot, ...args) {
  const p = engine.process;
  return engine.call(p.load(p.load(pointer) + slot * 4), [pointer, ...args]);
}

for (const [profile, variable, streamCtor, readerCtor, readerSize] of PROFILES)
  test(
    `${profile} original CAsyncReader uses real events, reads its MemStream and restores a flushed pin`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        source = new Uint8Array(block + 37),
        cross = Uint8Array.from({ length: 20 }, (_, i) => 0x21 + i * 5),
        reads = [];
      source.set(cross, block - 8);
      source.set([0x8c, 0x1d], source.length - 2);
      const make = async () => {
        const engine = await NativeEngineProcess.open({ profile, bytes }),
          buffers = new NativeDataBuffers(engine),
          workers = installNativeEngineWorkers(engine);
        new NativeEngineFiles(engine, {
          game: {
            async read(path) {
              reads.push(path);
              return path === movie ? source : null;
            },
          },
          async getNativeFeature(name) {
            assert.equal(name, 'data-buffers');
            return buffers;
          },
        });
        return { engine, workers };
      };
      const original = await make();
      let fresh;
      try {
        const { engine } = original,
          p = engine.process,
          stream = p.allocate(384, true),
          reader = p.allocate(readerSize, true),
          name = p.allocate(64, true),
          outputs = p.allocate(16, true),
          destination = p.allocate(32, true),
          iid = p.allocate(16, true),
          media = p.allocate(8, true),
          baselineLocks = engine.kernel.locks.size;
        p.write(name, encodeCP932(movie + '\0'));
        assert.equal(await engine.call(streamCtor, [name, -1, outputs, 1], stream), stream);
        assert.equal(p.load(outputs), 1);
        assert.deepEqual(reads, [movie]);
        p.store(outputs, 0);
        assert.equal(await engine.call(readerCtor, [0, 0, stream, outputs], reader), reader);
        assert.equal(p.load(outputs), 0);
        const filter = reader + 12,
          events = engine.kernel.events;
        assert.deepEqual(
          [...events.events.values()],
          [
            { manual: true, signaled: false },
            { manual: true, signaled: false },
            { manual: false, signaled: false },
            { manual: true, signaled: false },
          ],
        );
        assert.equal(await virtual(engine, filter, 1), 1);
        const pin = await engine.call(p.load(p.load(reader) + 28), [0], reader);
        assert.equal(pin, reader + 248);
        assert.equal(await virtual(engine, pin + 12, 12, media), 0);
        const mediaTypes = p.load(media);
        assert.equal(await virtual(engine, mediaTypes, 3, 1, media, media + 4), 0);
        assert.equal(p.load(media + 4), 1);
        const mediaType = p.load(media),
          mediaBytes = p.read(mediaType, 72);
        assert.deepEqual(engine.kernel.comMemory.snapshot(), [mediaType]);
        assert.equal(p.allocations.get(mediaType), mediaBytes.length);
        assert.equal(await virtual(engine, mediaTypes, 2), 0);
        asyncReader.forEach((word, i) => p.store(iid + i * 4, word));
        assert.equal(await virtual(engine, pin + 12, 0, iid, outputs), 0);
        const access = p.load(outputs);
        assert.equal(access, reader + 240);
        assert.equal(await virtual(engine, access, 8, outputs, outputs + 8), 0);
        assert.deepEqual(
          Array.from({ length: 4 }, (_, i) => p.load(outputs + i * 4)),
          [source.length, 0, source.length, 0],
        );
        assert.equal(await virtual(engine, access, 9), 0);
        const handles = [...events.events.keys()];
        assert.equal(events.events.get(handles[1]).signaled, true);
        fresh = await make();
        fresh.engine.restore(engine.snapshot());
        assert.deepEqual(fresh.engine.kernel.events.snapshot(), events.snapshot());
        for (const { engine, workers } of [original, fresh]) {
          const p = engine.process;
          assert.deepEqual(p.read(mediaType, 72), mediaBytes);
          await engine.call(engine.resolve({ dll: 'OLE32.dll', name: 'CoTaskMemFree' }), [
            mediaType,
          ]);
          assert.deepEqual(engine.kernel.comMemory.snapshot(), []);
          assert.equal(p.allocations.has(mediaType), false);
          assert.equal(await virtual(engine, access, 10), 0);
          assert.equal(engine.kernel.events.events.get(handles[1]).signaled, false);
          assert.equal(
            await virtual(engine, access, 7, block - 8, 0, cross.length, destination),
            0,
          );
          assert.deepEqual(p.read(destination, cross.length), cross);
          p.write(destination, new Uint8Array(16).fill(0xa5));
          assert.equal(await virtual(engine, access, 7, source.length - 2, 0, 16, destination), 1);
          assert.deepEqual([...p.read(destination, 16)], [0x8c, 0x1d, ...new Array(14).fill(0xa5)]);
          assert.equal(await virtual(engine, access, 2), 1);
          assert.equal(await virtual(engine, filter, 2), 0);
          assert.equal(p.allocations.has(reader), false);
          assert.equal(engine.kernel.events.events.size, 0);
          await engine.call(p.load(p.load(stream)), [1], stream);
          assert.equal(p.allocations.has(stream), false);
          assert.equal(engine.kernel.locks.size, baselineLocks);
          assert.deepEqual(workers.snapshot().threads, []);
        }
        assert.deepEqual(reads, [movie]);
      } finally {
        await fresh?.engine.close();
        await original.engine.close();
      }
    },
  );
