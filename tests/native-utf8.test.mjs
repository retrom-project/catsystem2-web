// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeUTF8 } from '../oracle/utf8.mjs';
import { KCSMachine, encodeCP932 } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
test(
  'game UTF-8 primitives preserve original byte-limit boundary and CP932-key search across fresh process restore',
  { skip: !process.env.CATSYSTEM2_ENGINE_EXE },
  async () => {
    const profile = 'nekopara-vol3-engine-2.6.1.76',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      engine = await NativeEngineProcess.open({ profile, bytes }),
      m = new KCSMachine({
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(4096),
        stackSize: 1024,
      }),
      world = { profile, ensureNativeEngine: async () => engine, objects: { machine: () => null } },
      put = (text, address = 256) => {
        const bytes = new TextEncoder().encode(text);
        m.bytes(address, bytes.length + 2).set([...bytes, 0, 0xa5]);
      };
    try {
      put('猫abc');
      assert.deepEqual(await nativeUTF8(0x415, [256, 3], m, { id: 10 }, world), {
        control: 1,
        value: 0,
      });
      put('猫abc');
      assert.deepEqual(await nativeUTF8(0x415, [256, 4], m, { id: 10 }, world), {
        control: 1,
        value: 3,
      });
      assert.deepEqual([...m.bytes(256, 6)], [0xe7, 0x8c, 0xab, 0, 0, 99]);
      put('猫abc');
      assert.deepEqual(await nativeUTF8(0x416, [256, 1], m, { id: 10 }, world), {
        control: 1,
        value: 3,
      });
      put('ab猫cat');
      m.bytes(512, 3).set([...encodeCP932('猫'), 0]);
      const fresh = await NativeEngineProcess.open({ profile, bytes });
      try {
        fresh.restore(engine.snapshot());
        world.ensureNativeEngine = async () => fresh;
        assert.deepEqual(await nativeUTF8(0x41b, [256, 512], m, { id: 10 }, world), {
          control: 1,
          value: 2,
        });
        m.writeString('missing', 512);
        assert.deepEqual(await nativeUTF8(0x41b, [256, 512], m, { id: 10 }, world), {
          control: 1,
          value: 8,
        });
      } finally {
        await fresh.close();
      }
    } finally {
      await engine.close();
    }
  },
);
