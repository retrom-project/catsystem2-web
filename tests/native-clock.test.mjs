// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { nativeStandard } from '../src/native/standard.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} clock keeps timeGetTime DWORD output and caller canaries`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        p = engine.process,
        out = p.allocate(12, true);
      let timer = 0,
        calls = 0;
      engine.registerWindows('WINMM.dll', 'timeGetTime', {
        count: 0,
        fn: () => {
          calls++;
          return timer;
        },
      });
      try {
        for (const [platform, expected] of [
          [0, 0],
          [123.999, 123],
          [-1.5, 0xffffffff],
          [0xffffffff + 0.75, 0xffffffff],
          [0x100000000 + 5.75, 5],
        ]) {
          timer = expected;
          p.write(out, new Uint8Array(12).fill(0xa5));
          const control = await engine.call(
            p.load(NATIVE_PROFILES[profile].tables.main.va + 4 * 4),
            [0, 0, 0, out + 4],
          );
          assert.deepEqual(nativeStandard(4, [], null, { clock: () => platform }), {
            control,
            value: p.load(out + 4),
          });
          assert.equal(p.load(out + 4), expected);
          assert.deepEqual([...p.read(out, 4), ...p.read(out + 8, 4)], new Array(8).fill(0xa5));
        }
        assert.equal(calls, 5);
      } finally {
        await engine.close();
      }
    },
  );
