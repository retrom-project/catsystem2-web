// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';

test(
  'the original SDK initializes and restores its V8 platform and ArrayBuffer allocator',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      open = () =>
        NativeEngineProcess.open({
          profile,
          bytes,
          configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          bootstrapOwner: { embeddedJavaScript: true },
          readFile: async () => null,
        }),
      engine = await open(),
      state = engine.refs.sdkJavaScript,
      size = 257,
      allocate = (instance) => {
        const p = instance.process,
          vtable = p.load(state.allocator);
        return instance.call(p.load(vtable + 4), [size], state.allocator);
      },
      free = (instance, address) => {
        const p = instance.process,
          vtable = p.load(state.allocator);
        return instance.call(p.load(vtable + 12), [address, size], state.allocator);
      };
    let fresh;
    try {
      assert.equal(engine.process.load(0xc981cc), state.isolate);
      assert.equal(engine.process.load(state.isolate + 0x1a50), 1);
      assert.equal(engine.process.load(0xc98210), state.allocator);
      assert.equal(engine.kernel.threadHandles.handles.size, 1);
      assert.ok(engine.kernel.virtual.size > 0);
      const address = await allocate(engine);
      assert.ok(address);
      assert.deepEqual(engine.process.read(address, size), new Uint8Array(size));
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 29 + 3) & 255);
      engine.process.write(address, bytes);
      fresh = await open();
      fresh.restore(engine.snapshot());
      assert.deepEqual(fresh.refs.sdkJavaScript, state);
      assert.deepEqual(fresh.process.read(address, size), bytes);
      await free(fresh, address);
      const reused = await allocate(fresh);
      assert.ok(reused);
      assert.deepEqual(fresh.process.read(reused, size), new Uint8Array(size));
      await free(fresh, reused);
      await free(engine, address);
    } finally {
      await fresh?.close();
      await engine.close();
    }
    for (const instance of [engine, fresh]) {
      assert.equal(instance.refs.sdkJavaScript, undefined);
      assert.equal(instance.process.allocations.has(state.isolate), false);
      assert.equal(instance.process.allocations.has(state.allocator), false);
      assert.equal(instance.kernel.locks.has(0xc981e4), false);
    }
  },
);
