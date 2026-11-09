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

test(
  'the original JavaScript task loads a program and resumes its closure in a fresh process',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      program = new TextEncoder().encode(
        'var next = (function () { var count = 0; return function () { return ++count; }; }());\n' +
          'function GameLoop(frame) { if (next() === 2) cfExit(42); }',
      ),
      open = () =>
        NativeEngineProcess.open({
          profile,
          bytes,
          configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
          bootstrapOwner: { embeddedJavaScript: true },
          readFile: async (name) => (name === 'authored.js' ? program : null),
        }),
      engine = await open(),
      p = engine.process,
      scratch = p.allocate(80, true),
      task = p.allocate(0x264, true),
      name = scratch,
      source = scratch + 24,
      context = scratch + 56,
      out = scratch + 72;
    engine.kernel.writeString(name, 'authored JS task');
    engine.kernel.writeString(source, 'authored.js');
    let fresh;
    const state = ({ process }) => [140, 144, 80].map((offset) => process.load(task + offset)),
      tick = (instance, frame) => instance.call(0x50f7b0, [frame, out], task),
      destroy = async (instance) => {
        const p = instance.process;
        if (p.allocations.has(task) && p.load(task) === 0x9984c0) {
          await instance.call(p.load(p.load(task)), [1], task);
          assert.equal(p.allocations.has(task), false);
          assert.equal(instance.kernel.threadHandles.handles.size, 1);
        }
      };
    try {
      assert.equal(await engine.call(0x50e4b0, [10, name, 60, 0, 0, context], task), task);
      assert.equal(p.load(task), 0x9984c0);
      assert.ok(p.load(task + 104) && p.load(task + 108));
      assert.equal(await engine.call(0x5100b0, [10, 158, 0, source, 0, out], task), 1);
      assert.deepEqual(state(engine), [1, 1, 0xffffffff]);
      assert.equal(await tick(engine, 1), 1);
      assert.deepEqual(state(engine), [1, 1, 0xffffffff]);
      fresh = await open();
      fresh.restore(engine.snapshot());
      assert.deepEqual(state(fresh), [1, 1, 0xffffffff]);
      assert.equal(await tick(fresh, 2), 1);
      assert.deepEqual(state(fresh), [1, 0, 42]);
      assert.deepEqual(state(engine), [1, 1, 0xffffffff]);
      assert.equal(await tick(engine, 2), 1);
      assert.deepEqual(state(engine), [1, 0, 42]);
    } finally {
      try {
        if (fresh) await destroy(fresh);
        await destroy(engine);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    }
  },
);
