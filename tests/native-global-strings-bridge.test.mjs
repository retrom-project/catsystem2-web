// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStrings } from '../src/native/global-strings.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74'])
  test(`language pointers and owned translations survive a fresh native process: ${profile}`, async () => {
    const u = await loadUnicorn(),
      wide = profile.startsWith('nekopara'),
      address = wide ? 0x5abe00 : 0x47ecf0,
      strings = new NativeGlobalStrings({ profile }),
      make = () => {
        const engine = new NativeEngineProcess(u, { profile });
        engine.identity = 'authored-pointer-boundary';
        engine.name = 'authored';
        engine.process.map(address & ~4095, 4096);
        const bridge = new NativeGlobalStringsBridge(engine, strings);
        return { engine, bridge, p: engine.process };
      },
      first = make();
    let second;
    try {
      strings.parse(
        0,
        wide
          ? new TextEncoder().encode('$key$\n猫の名前\n$empty$\n$empty$\n')
          : encodeCP932('$key$\n猫の名前\n$empty$\n$empty$\n'),
      );
      const input = first.p.allocate(256, true),
        write = (p, text) => {
          if (wide) {
            const bytes = new Uint8Array((text.length + 1) * 2),
              view = new DataView(bytes.buffer);
            for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
            p.write(input, bytes);
          } else p.write(input, Uint8Array.from([...encodeCP932(text), 0]));
        };
      for (const text of ['plain', '$unclosed', '#unclosed']) {
        write(first.p, text);
        assert.equal(await first.engine.call(address, [input]), input);
      }
      write(first.p, '$miss$fallback');
      assert.equal(await first.engine.call(address, [input]), input + 6 * (wide ? 2 : 1));
      write(first.p, '$key$fallback');
      const translated = await first.engine.call(address, [input]);
      assert.notEqual(translated, input);
      assert.equal(first.p.string(translated, wide), '猫の名前');
      assert.equal(await first.engine.call(address, [input]), translated);
      const snapshot = structuredClone(first.engine.snapshot());
      second = make();
      second.engine.restore(snapshot);
      assert.equal(await second.engine.call(address, [input]), translated);
      assert.equal(second.p.string(translated, wide), '猫の名前');
      write(second.p, '$empty$literal');
      const empty = await second.engine.call(address, [input]);
      assert.notEqual(empty, input + 7 * (wide ? 2 : 1));
      assert.equal(second.p.string(empty, wide), '');
      if (wide) {
        strings.parse(1, new TextEncoder().encode('$secondary$\nsecond table\n'));
        write(second.p, '$secondary$fallback');
        const secondary = await second.engine.call(address, [input]);
        assert.equal(second.p.string(secondary, true), 'second table');
        second.bridge.invalidate([1]);
        write(second.p, '$key$fallback');
        assert.equal(await second.engine.call(address, [input]), translated);
        assert.equal(second.p.string(translated, true), '猫の名前');
      }
      second.bridge.invalidate();
      assert.equal(second.bridge.cache.size, 0);
      assert.throws(() => second.bridge.lookup(0), /NULL input/);
    } finally {
      await first.engine.close();
      await second?.engine.close();
    }
  });
