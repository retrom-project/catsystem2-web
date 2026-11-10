// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeDataBuffers } from '../../src/native/data-buffer.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} image projection owns an independent PE reference`,
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile: fixture.profile,
          bytes: fixture.bytes,
        }),
        handles = new NativeHandles(),
        source = new NativeDataBuffers({ handles }),
        projection = engine.createDataBufferProjection({ source, handles }),
        bytes = Uint8Array.of(1, 2, 3, 4),
        original = source.createPointer(bytes),
        handle = source.handle(original),
        alias = source.alias(handle),
        pointer = projection.pointer(handle),
        p = engine.process;
      try {
        assert.equal(projection.pointer(alias), pointer);
        assert.deepEqual(p.read(p.load(pointer), bytes.length), bytes);
        assert.equal(p.load(pointer + 12), 1, 'one projection pin, independent of JS alias count');
        p.store(pointer + 12, 77);
        p.write(p.load(pointer), Uint8Array.of(9, 9, 9, 9));
        assert.equal(source.words(original)[3], 2);
        assert.deepEqual(source.data(original), bytes);
        p.store(pointer + 12, 1);
        projection.transferPointer(pointer);
        assert.equal(source.words(original)[3], 1);
        assert.equal(p.load(pointer + 12), 2, 'pin plus external font reference');
        source.release(alias);
        assert.throws(() => source.pointer(handle), /released/);
        assert.equal(p.load(pointer + 12), 1, 'external reference survives canonical release');
        projection.releasePointer(pointer);
        assert.equal(p.allocations.has(pointer), false);
      } finally {
        await engine.close();
      }
    },
  );
