// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PPIWindowsServices } from '../src/ppi/native-services.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

const dll = 'kernel32.dll',
  api = (kernel, name) => kernel.resolve({ dll, name });

test('SYSTEM_INFO describes the guest CPU and virtual memory without overwriting its caller', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new PPIWindowsServices(p),
    out = p.allocate(40),
    code = 0x11000000;
  try {
    p.map(code, 4096, 'CPUID probe');
    p.write(code, Uint8Array.of(0xb8, 1, 0, 0, 0, 0x0f, 0xa2, 0xc3));
    p.cpu.mem_protect(code, 4096, p.uc.PROT_READ | p.uc.PROT_EXEC);
    const signature = p.call(code),
      model = ((signature >>> 12) & 0xf0) | ((signature >>> 4) & 15),
      family = (signature >>> 8) & 15,
      stepping = signature & 15;
    for (const name of ['GetSystemInfo', 'GetNativeSystemInfo']) {
      p.write(out, new Uint8Array(40).fill(0x9c));
      p.call(api(kernel, 'SetLastError'), [0x55aa]);
      p.call(api(kernel, name), [out]);
      const words = Array.from({ length: 10 }, (_, i) => p.load(out + i * 4));
      assert.deepEqual(words.slice(0, 8), [0, 4096, 0x10000, 0x7ffeffff, 1, 1, 586, 65536]);
      assert.equal(words[8], (model << 24) | (stepping << 16) | family);
      assert.equal(words[9], 0x9c9c9c9c);
      assert.equal(p.call(api(kernel, 'GetLastError')), 0x55aa);
    }
    const requested = 0x41003455,
      base = p.call(api(kernel, 'VirtualAlloc'), [requested, 1, 0x3000, 4]),
      granularity = p.load(out + 28);
    assert.equal(base, requested - (requested % granularity));
    assert.equal(p.call(api(kernel, 'VirtualFree'), [base, 0, 0x8000]), 1);
  } finally {
    p.close();
  }
});

for (const [profile, variable, iat] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x98e1b4],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x8c6244],
])
  test(
    `${profile} resolves its original GetSystemInfo import`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({ profile, bytes }),
        { process: p, kernel } = engine,
        out = p.allocate(36, true);
      try {
        const entry = p.load(iat);
        assert.equal(entry, api(kernel, 'GetSystemInfo'));
        p.call(entry, [out]);
        assert.equal(p.load(out + 20), 1);
        assert.equal(p.load(out + 28), 65536);
      } finally {
        await engine.close();
      }
    },
  );
