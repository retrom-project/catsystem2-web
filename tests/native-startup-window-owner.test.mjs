// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';
import { initializeNativeStartupMenu } from '../src/native/engine-startup-menu.mjs';
import {
  initializeNativeWindowOwner,
  releaseNativeWindowOwner,
} from '../src/native/engine-startup-window.mjs';

for (const [profile, variable, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'W'],
]) {
  test(
    `${profile} original kcWindow synchronization and callbacks survive independent restore`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        open = () =>
          NativeEngineProcess.open({
            profile,
            bytes,
            bootstrapOwner: {},
            configuration: new NativeConfiguration({ profile, uiLanguage: 0x411 }),
            readFile: async () => null,
          }),
        first = await open(),
        p = first.process,
        block = NATIVE_STARTUP_BLOCKS[profile];
      let restored;
      try {
        await initializeNativeStartupMenu(first);
        await initializeNativeWindowOwner(first);
        const owner = p.load(block),
          event = p.load(owner + 96),
          callbacks = p.load(owner + 56),
          head = p.load(callbacks);
        assert.equal(p.allocations.get(owner), 0x74);
        assert.equal(p.load(p.load(block + 36) + 4), block);
        assert.equal(p.load(owner + 84), event);
        assert.equal(p.allocations.get(callbacks), 8);
        assert.equal(p.load(head), head);
        assert.equal(p.load(head + 4), head);
        assert.equal(first.kernel.locks.get(owner + 60), 0);
        assert.equal(first.kernel.calls.get('kernel32.dll!CreateEvent' + suffix), 1);
        assert.equal(first.kernel.events.wait([event], false, 0), 0x102);
        first.kernel.events.signal(event, true);

        restored = await open();
        restored.restore(first.snapshot());
        assert.equal(restored.process.load(block), owner);
        assert.equal(restored.process.load(owner + 56), callbacks);
        assert.equal(restored.kernel.events.wait([event], false, 0), 0);
        assert.equal(restored.kernel.events.wait([event], false, 0), 0x102);
        await releaseNativeWindowOwner(restored);
        assert.equal(restored.process.load(block), 0);
        assert.equal(restored.process.allocations.has(owner), false);
        assert.equal(restored.process.allocations.has(callbacks), false);
        assert.equal(restored.process.allocations.has(head), false);
        assert.equal(restored.kernel.locks.has(owner + 60), false);
        assert.equal(restored.kernel.events.events.has(event), false);
        assert.equal(first.kernel.events.wait([event], false, 0), 0);
      } finally {
        await restored?.close();
        await first.close();
      }
    },
  );
}
