// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeLegacyTextRuntime as RawLegacy } from '../../oracle/text-legacy.mjs';
import { NativeLegacyTextRuntime, NATIVE_LEGACY_TEXT_IDS } from '../../src/native/text-legacy.mjs';
import { KCSMachine } from '../../src/kcs/vm.mjs';
import { Binary } from '../../src/binary.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
for (const f of await engineFixtureSet())
  await test(
    `task8 wrapper control, payload and missing-receiver semantics: ${f.profile}`,
    { skip: !f.available && f.reason },
    async () => {
      const engine = await NativeEngineProcess.open(f),
        p = engine.process,
        m = new KCSMachine({
          body: new Binary(Uint8Array.of(59)),
          codeSize: 1,
          data: new Uint8Array(4096),
          stackSize: 1024,
        });
      const traces = [];
      const route = (target, sender, message, w, l, context = {}) => {
        if (target === 12) return;
        let data = null;
        const mem = context.payload;
        const bytes = (n) => mem.bytes(l, n);
        if (message === 101) data = [...bytes(1116)];
        if (message === 103 || message === 114) {
          const a = [];
          for (let i = 0; i < 1024; i++) {
            const n = bytes(i + 1)[i];
            if (!n) break;
            a.push(n);
          }
          data = a;
        }
        if (message === 117) data = [...bytes(20)];
        if (message === 119 && mem) mem.store(l, 0x12345678);
        traces.push({
          target,
          sender,
          message,
          w,
          l: data || message === 119 ? 'payload' : l,
          data,
        });
        return message === 108 ? 0x12345678 : 0;
      };
      const world = {
        profile: f.profile,
        objects: { objects: new Map([[11, { state: 'active' }]]) },
        graphics: {},
        runtime: {
          services: {
            formatBytes: (at) => {
              const b = [];
              for (let i = at; m.memory[i]; i++) b.push(m.memory[i]);
              return Uint8Array.from(b);
            },
          },
        },
        sendNativeEngine: route,
      };
      const raw = new RawLegacy(
          engine,
          world,
          { memory: { bytes: (a, n) => p.read(a, n), store: (a, n) => p.store(a, n) } },
          null,
        ),
        fresh = new NativeLegacyTextRuntime({ ...engine, registerFeature() {} }, world);
      try {
        for (const id of NATIVE_LEGACY_TEXT_IDS)
          for (const target of id === 0x81 ? [11] : [11, 12]) {
            m.memory.fill(0);
            for (let i = 0; i < 96; i++) m.memory[256 + i] = (i * 7) & 255;
            m.memory.set(encodeCP932('猫ぁｧA\0'), 512);
            m.memory.set(encodeCP932('…B\0'), 768);
            m.memory.set(encodeCP932('Authored %d\0'), 1024);
            const args = [target, 3, 9, 7, 5, 6];
            if (id === 0x7b || id === 0x1a2) {
              args[1] = 256;
              args[2] = 512;
              args[3] = 768;
            }
            if (id === 0x7c) args[1] = 1024;
            if (id === 0x86) args[2] = 512;
            if (id === 0x88) args[1] = 0;
            if (id === 0x187) args.length = 1;
            if ([0x1c8, 0x22d].includes(id)) args.length = 2;
            if (id === 0x1a2) args.length = 4;
            const saved = m.memory.slice();
            traces.length = 0;
            const a = await raw.applyGuest(id, args, m, { id: 7 }),
              expected = structuredClone(traces);
            m.memory.set(saved);
            traces.length = 0;
            const b = await fresh.apply(id, args, m, { id: 7 });
            assert.deepEqual(b, a, `${f.profile}/${id.toString(16)}/${target} reply`);
            const actual = target === 12 ? [] : traces;
            assert.deepEqual(actual, expected, `${id.toString(16)} transport`);
          }
        console.log(f.profile, 'legacy transport pass');
      } finally {
        await engine.close();
      }
    },
  );
