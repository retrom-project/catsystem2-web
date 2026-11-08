// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NativePPI, NativePPIRuntime } from '../src/ppi/native.mjs';
import { parsePE32 } from '../src/ppi/pe32.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { PPI_HOST_CONTRACTS } from '../src/ppi/contracts.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
const backend = new URL('../.local/vendor/ppi/unicorn_x86.js', import.meta.url),
  available = existsSync(backend);
let pending;
const unicornFactory = () =>
  (pending ||= (async () => {
    const module = await import(backend);
    return module.default();
  })());
const options = {
  unicornFactory,
  name: 'authored.ppi',
  count: 2,
  width: 64,
  height: 64,
  screenWidth: 1280,
  screenHeight: 720,
  now: () => 0,
  epoch: 0,
};

test('PPI loader parses exports and HIGHLOW relocations without Windows binaries', () => {
  const pe = parsePE32(nativeParticleFixture());
  assert.equal(pe.base, 0x30000000);
  assert.equal(pe.exports.size, 4);
  assert.ok(pe.relocations.length >= 12);
  const invalid = nativeParticleFixture();
  invalid[0] = 0;
  assert.throws(() => parsePE32(invalid), /MZ/);
  assert.deepEqual(PPI_HOST_CONTRACTS[2].parameters, []);
  assert.deepEqual(PPI_HOST_CONTRACTS[3].parameters, []);
});

test(
  'authored x86 PPI retains module globals, shares random and restores complete native state',
  { skip: !available },
  async () => {
    const bytes = nativeParticleFixture(),
      runtime = await NativePPIRuntime.open(options),
      rng = new ParticleRandom();
    let restored;
    try {
      const a = await runtime.create(bytes, options),
        b = await runtime.create(bytes, options);
      assert.equal(a.module, b.module);
      assert.equal(runtime.modules.size, 1);
      assert.equal(runtime.process.load(a.module.base + 0x2120), 1);
      assert.equal(a.particles()[0].pos[0], rng.frand());
      assert.equal(b.particles()[0].pos[0], rng.frand());
      a.update(0);
      b.update(0);
      assert.equal(a.particles()[0].disp, 1);
      assert.equal(b.particles()[0].disp, 2);
      assert.equal(a.particles()[0].pos[0], rng.frand());
      assert.equal(b.particles()[0].pos[0], rng.frand());
      const relocated = await runtime.create(bytes, { ...options, name: 'other.ppi' });
      assert.notEqual(relocated.module.base, a.module.base);
      assert.equal(runtime.modules.size, 2);
      const state = runtime.snapshot();
      for (const p of runtime.instances.values()) p.update(1);
      const expected = [...runtime.instances.values()].map((p) => p.records());
      restored = await NativePPIRuntime.fromSnapshot(state, {
        ...options,
        readPlugin: async () => bytes,
      });
      for (const [index, p] of [...restored.instances.values()].entries()) {
        p.update(1);
        assert.deepEqual(p.records(), expected[index]);
      }
      a.close();
      assert.equal(runtime.process.load(b.module.base + 0x2124), 1);
      b.update(2);
      assert.equal(runtime.modules.size, 2);
      assert.throws(() => b.snapshot(), /runtime.snapshot/);
    } finally {
      restored?.close();
      runtime.close();
    }
  },
);

test(
  'native heap ownership and missing imports produce observable Windows ABI results',
  { skip: !available },
  async () => {
    const p = await NativePPI.open(nativeParticleFixture(), options);
    try {
      const call = (name, args = []) =>
        p.process.call(p.services.resolve({ dll: 'KERNEL32.dll', name }), args);
      const heap = call('HeapCreate', [0, 0, 0]),
        memory = call('HeapAlloc', [heap, 8, 25]);
      assert.notEqual(heap, 1);
      assert.deepEqual(p.process.read(memory, 25), new Uint8Array(25));
      assert.equal(call('HeapFree', [1, 0, memory]), 0);
      assert.equal(call('GetLastError'), 6);
      assert.equal(call('HeapSize', [heap, 0, memory]), 25);
      p.process.store(memory, 0xabcdef12);
      const resized = call('HeapReAlloc', [heap, 8, memory, 500]);
      assert.equal(p.process.load(resized), 0xabcdef12);
      assert.equal(p.process.load(resized + 28), 0);
      assert.equal(call('HeapDestroy', [heap]), 1);
      assert.equal(p.process.allocations.has(resized), false);
      const utf8 = p.process.allocate(32, true),
        utf16 = p.process.allocate(32, true);
      p.process.write(utf8, new TextEncoder().encode('猫\u{1f43e}\0'));
      assert.equal(call('MultiByteToWideChar', [65001, 0, utf8, 0xffffffff, 0, 0]), 4);
      assert.equal(call('MultiByteToWideChar', [65001, 0, utf8, 0xffffffff, utf16, 16]), 4);
      assert.equal(p.process.string(utf16, true), '猫\u{1f43e}');
      assert.equal(call('WideCharToMultiByte', [65001, 0, utf16, 0xffffffff, utf8, 32, 0, 0]), 8);
      assert.deepEqual(
        p.process.stringBytes(utf8, false, true),
        new TextEncoder().encode('猫\u{1f43e}\0'),
      );
      p.process.free(utf8);
      p.process.free(utf16);
      assert.throws(() => call('UnknownImport'), /Unimplemented PPI import.*unknownimport/i);
    } finally {
      p.close();
    }
  },
);

const pluginRoot = process.env.CATSYSTEM2_PPI_FIXTURES;
test(
  'original frozen PPI DLLs match Wine and original-engine PPF golden records',
  { skip: !available || !pluginRoot },
  async () => {
    const golden = JSON.parse(
        await fs.readFile(new URL('fixtures/ppi-native-golden.json', import.meta.url)),
      ),
      plist = new Uint8Array(
        await fs.readFile(new URL('fixtures/ppi-native.plist', import.meta.url)),
      );
    for (const row of golden.plugins) {
      const bytes = new Uint8Array(await fs.readFile(`${pluginRoot}/${row.name}`));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), row.pluginSHA256);
      const p = await NativePPI.open(bytes, {
        ...options,
        name: row.name,
        count: 4,
        registers: Array(32).fill(1),
        attachPlane: 31,
        attachment: () => ({ base: [32, 32, 0], pos: [640, 360, 0], disp: 1 }),
        readParticleData: () => plist,
      });
      try {
        const records = [p.records()];
        for (const frame of [0, 1, 2, 15, 60, 61]) {
          p.update(frame);
          records.push(p.records());
        }
        assert.equal(
          createHash('sha256').update(Buffer.concat(records)).digest('hex'),
          row.recordSHA256,
          row.name,
        );
      } finally {
        p.close();
      }
    }
  },
);

test(
  'virtual reserve/commit/protect/decommit and a new-process checkpoint retain page state',
  { skip: !available },
  async () => {
    const bytes = nativeParticleFixture(),
      p = await NativePPI.open(bytes, options);
    let q;
    try {
      const call = (instance, name, args = []) =>
        instance.process.call(instance.services.resolve({ dll: 'KERNEL32.dll', name }), args);
      const region = call(p, 'VirtualAlloc', [0, 65536, 0x2000, 4]);
      assert.equal(region % 65536, 0);
      assert.equal(call(p, 'VirtualAlloc', [region + 4096, 4096, 0x1000, 0x40]), region + 4096);
      p.process.write(region + 4096, new Uint8Array([0xb8, 66, 0, 0, 0, 0xc3]));
      assert.equal(p.process.call(region + 4096), 66);
      const state = p.snapshot();
      assert.equal(call(p, 'VirtualFree', [region, 0, 0x8000]), 1);
      q = await NativePPI.fromSnapshot(state, { ...options, readPlugin: async () => bytes });
      assert.equal(q.process.call(region + 4096), 66);
      const old = q.process.allocate(4);
      assert.equal(call(q, 'VirtualProtect', [region + 4096, 8, 2, old]), 1);
      assert.equal(q.process.load(old), 0x40);
      assert.throws(() => q.process.call(region + 4096), /execution/);
      assert.equal(call(q, 'VirtualFree', [region + 4096, 4096, 0x4000]), 1);
      assert.equal(call(q, 'VirtualAlloc', [region + 4096, 4096, 0x1000, 4]), region + 4096);
      assert.deepEqual(q.process.read(region + 4096, 6), new Uint8Array(6));
      assert.equal(call(q, 'VirtualFree', [region + 1, 0, 0x8000]), 0);
      assert.equal(call(q, 'GetLastError'), 87);
    } finally {
      q?.close();
      p.close();
    }
  },
);

test(
  'static TLS callbacks precede DllMain, FS access relocates and restored TLS uses saved indexes',
  { skip: !available },
  async () => {
    const bytes = nativeParticleFixture({ tls: true, version: 0x20000 }),
      runtime = await NativePPIRuntime.open(options);
    let restored;
    try {
      const a = await runtime.create(bytes, options);
      assert.equal(a.version, 0x20000);
      assert.equal(runtime.process.load(a.module.base + 0x2134), 1);
      assert.equal(new DataView(a.records().buffer).getUint32(112, true), 0x1234abcd);
      assert.equal(runtime.process.load(a.module.tlsData + 4), 0);
      const temporary = await runtime.create(bytes, { ...options, name: 'temporary.ppi' });
      temporary.close();
      const b = await runtime.create(bytes, { ...options, name: 'relocated.ppi' });
      assert.equal(b.module.tlsIndex, 2);
      assert.equal(new DataView(b.records().buffer).getUint32(112, true), 0x1234abcd);
      const state = runtime.snapshot();
      restored = await NativePPIRuntime.fromSnapshot(state, {
        ...options,
        readPlugin: async () => bytes,
      });
      const instances = [...restored.instances.values()];
      assert.equal(instances[1].module.tlsIndex, 2);
      instances[1].start();
      assert.equal(new DataView(instances[1].records().buffer).getUint32(112, true), 0x1234abcd);
      const index = instances[1].module.tlsIndex,
        data = instances[1].module.tlsData;
      instances[1].close();
      assert.equal(restored.process.load(restored.process.load(0x2c) + index * 4), 0);
      assert.equal(restored.process.allocations.has(data), false);
    } finally {
      restored?.close();
      runtime.close();
    }
  },
);

test(
  'PPI2.0,2.1 and2.2 execute the same declared instance lifecycle',
  { skip: !available },
  async () => {
    for (const version of [0x20000, 0x20001, 0x20002]) {
      const runtime = await NativePPIRuntime.open(options);
      try {
        const particle = await runtime.create(nativeParticleFixture({ version }), {
          ...options,
          autoStart: false,
        });
        assert.equal(particle.version, version);
        assert.equal(particle.active, false);
        particle.start();
        particle.update(0);
        particle.stop();
        particle.stop();
        assert.equal(particle.process.load(particle.module.base + 0x2128), 2);
        particle.close({ stop: false });
        assert.equal(runtime.modules.size, 0);
      } finally {
        runtime.close();
      }
    }
  },
);
