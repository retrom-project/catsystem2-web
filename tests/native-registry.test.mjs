// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRegistry } from '../src/native/registry.mjs';
import { registryDecodeANSI, registryEncodeANSI } from '../src/native/registry-codepage.mjs';
import { configurationQueryMachine } from './fixtures/configuration-query-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

test('registry NT CP932 conversion matches every authored single/DBCS input and every UTF16 code unit', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-registry-codepage-golden.json', import.meta.url)),
    ),
    bytes = new Uint8Array(golden.bytes),
    view = new DataView(bytes.buffer),
    lead = (a) => (a >= 0x81 && a <= 0x9f) || (a >= 0xe0 && a <= 0xfc);
  bytes.fill(0xa5);
  let at = 0;
  const decode = (input) => {
    const text = registryDecodeANSI(Uint8Array.from(input));
    assert.equal(text.length, 1);
    view.setUint32(at, 2, true);
    view.setUint16(at + 4, text.charCodeAt(0), true);
    at += 8;
  };
  for (let a = 0; a < 256; a++) decode([a]);
  for (let a = 0x81; a <= 0xfc; a++) if (lead(a)) for (let b = 0; b < 256; b++) decode([a, b]);
  for (let unit = 0; unit < 65536; unit++) {
    const encoded = registryEncodeANSI(String.fromCharCode(unit));
    view.setUint32(at, encoded.length, true);
    bytes.set(encoded, at + 4);
    at += 8;
  }
  assert.equal(at, bytes.length);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), golden.sha256);
});

test('registry A/W raw strings, lengths, odd bytes and short buffers match 884 pinned Wine results', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-registry-golden.json', import.meta.url)),
    ),
    engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    p = engine.process,
    registry = await NativeRegistry.open(engine),
    data = p.allocate(128, true),
    output = p.allocate(64),
    kind = p.allocate(4),
    size = p.allocate(4),
    nameA = p.allocate(16, true),
    nameW = p.allocate(32, true),
    call = (name, words) =>
      engine.call(engine.kernel.resolve({ dll: 'ADVAPI32.dll', name }), words),
    key = registry.open(0x80000001, 'Software\\RetromRegistryOracle', 0xf003f, true).handle;
  engine.kernel.writeString(nameA, 'value');
  engine.kernel.writeString(nameW, 'value', true);
  try {
    assert.equal(golden.ansiCodePage, 932);
    assert.equal(golden.cases.length, 884);
    for (const [index, row] of golden.cases.entries()) {
      const source = Uint8Array.from(Buffer.from(row.data, 'hex'));
      p.zero(data, 128);
      p.write(data, source);
      assert.equal(
        await call(`RegSetValueEx${row.setWide ? 'W' : 'A'}`, [
          key,
          row.setWide ? nameW : nameA,
          0,
          row.type,
          data,
          row.size,
        ]),
        row.setResult,
        'set/' + index,
      );
      p.write(output, new Uint8Array(64).fill(0xa5));
      p.store(kind, 0x13579bdf);
      p.store(size, row.capacity);
      assert.equal(
        await call(`RegQueryValueEx${row.queryWide ? 'W' : 'A'}`, [
          key,
          row.queryWide ? nameW : nameA,
          0,
          kind,
          row.nullData ? 0 : output,
          size,
        ]),
        row.result,
        'query/' + index,
      );
      assert.equal(p.load(kind), row.outputType, 'type/' + index);
      assert.equal(p.load(size), row.outputSize, 'size/' + index);
      assert.equal(
        Buffer.from(p.read(output, 64)).toString('hex'),
        row.output,
        'whole destination/' + index,
      );
    }
  } finally {
    await engine.close();
  }
});

test('registry platform loading is awaited and failed persistence remains dirty instead of reporting a successful native write', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' });
  let finish,
    fail = true,
    stored,
    reads = 0;
  const pending = NativeRegistry.open(engine, {
    read: () => {
      reads++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    write: async (bytes) => {
      if (fail) throw new Error('authored storage transaction failure');
      stored = bytes.slice();
    },
  });
  try {
    assert.equal(reads, 1);
    assert.equal(
      engine.features.has('registry'),
      false,
      'a factory cannot return before its platform load',
    );
    finish(null);
    const registry = await pending,
      p = engine.process,
      data = p.allocate(4),
      key = registry.open(0x80000001, 'Software\\Retrom', 0xf003f, true).handle;
    p.store(data, 0x12345678);
    await assert.rejects(registry.setValue(key, 'value', 4, data, 4, true), /transaction failure/);
    assert.equal(registry.dirty, true);
    assert.equal(stored, undefined);
    fail = false;
    await registry.flush();
    assert.equal(registry.dirty, false);
    assert.equal(JSON.parse(new TextDecoder().decode(stored)).keys.at(-1)[1][0][2], '78563412');
  } finally {
    await engine.close();
  }
});

test('registry key paths, creation dispositions, permissions and closed capabilities match 30 pinned Wine cases', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-registry-platform-golden.json', import.meta.url)),
    ),
    engine = new NativeEngineProcess(await loadUnicorn(), { profile: 'authored' }),
    p = engine.process,
    registry = await NativeRegistry.open(engine),
    key = registry.open(0x80000001, 'Software\\RetromRegistryOracle', 0xf003f, true).handle,
    input = p.allocate(1024, true),
    name = p.allocate(32, true),
    handle = p.allocate(4),
    disposition = p.allocate(4),
    type = p.allocate(4),
    size = p.allocate(4),
    data = p.allocate(4),
    call = (name, args) => engine.call(engine.kernel.resolve({ dll: 'ADVAPI32.dll', name }), args),
    classify = (value) => (value === 0xa5a5a5a5 ? 2 : Number(Boolean(value)));
  p.store(data, 0x78563412);
  await registry.setValue(key, 'value', 4, data, 4, true);
  try {
    assert.equal(golden.cases.length, 30);
    for (const [index, row] of golden.cases.entries()) {
      const suffix = row.wide ? 'W' : 'A';
      engine.kernel.writeString(name, 'value', row.wide);
      let result;
      if (row.api === 'path') {
        engine.kernel.writeString(input, row.path, row.wide);
        p.store(handle, 0xa5a5a5a5);
        p.store(disposition, 0x13579bdf);
        const created = await call(`RegCreateKeyEx${suffix}`, [
            0x80000001,
            input,
            0,
            0,
            0,
            0xf003f,
            0,
            handle,
            disposition,
          ]),
          key = p.load(handle),
          first = created ? 0xffffffff : await call('RegCloseKey', [key]),
          second = created ? 0xffffffff : await call('RegCloseKey', [key]);
        p.store(handle, 0xa5a5a5a5);
        const opened = await call(`RegOpenKeyEx${suffix}`, [0x80000001, input, 0, 0x20019, handle]);
        result = [
          created,
          classify(key),
          p.load(disposition),
          opened,
          classify(p.load(handle)),
          first,
          second,
        ];
        if (!opened) await call('RegCloseKey', [p.load(handle)]);
      } else {
        p.store(handle, 0);
        const opened = await call('RegOpenKeyExW', [key, 0, 0, row.access, handle]),
          h = p.load(handle);
        p.store(type, 0x13579bdf);
        p.store(size, 4);
        p.store(data, 0xa5a5a5a5);
        const query = await call(`RegQueryValueEx${suffix}`, [h, name, 0, type, data, size]),
          returned = p.load(data);
        p.store(data, 0x78563412);
        const set = await call(`RegSetValueEx${suffix}`, [h, name, 0, 4, data, 4]);
        result = [
          opened,
          query,
          set,
          p.load(type),
          p.load(size),
          returned,
          await call('RegCloseKey', [h]),
        ];
      }
      assert.deepEqual(result, row.result, 'platform case/' + index);
    }
  } finally {
    await engine.close();
  }
});

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} all four original wrappers retain byte data and persistent HKCU across a fresh process`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        open = () => NativeEngineProcess.open({ bytes, profile }),
        engine = await open(),
        machine = configurationQueryMachine(),
        text = (at, value) => {
          machine.writeString(value, at);
          return at;
        };
      let saved, fresh;
      const options = {
          read: async () => saved?.slice() ?? null,
          write: async (bytes) => {
            saved = bytes.slice();
          },
        },
        feature = await NativeRegistry.open(engine, options),
        call = (id, args) => feature.apply(id, args, machine, { id: 1 });
      try {
        const key = text(512, 'Retrom\\NativeOracle'),
          name = text(608, 'Value');
        assert.deepEqual(await call(0xc0, [key, name]), { control: 1, value: 0 });
        assert.deepEqual(await call(0xc2, [key, name, 0]), { control: 1, value: 1 });
        assert.deepEqual(
          await call(0xc0, [key, name]),
          { control: 1, value: 1 },
          'stored DWORD zero is still a successful query',
        );
        assert.deepEqual(await call(0xc2, [key, name, 0x87654321]), { control: 1, value: 1 });
        machine.bytes(800, 12).fill(0xa5);
        assert.deepEqual(await call(0xc1, [key, name, 800, 4]), { control: 1, value: 4 });
        assert.deepEqual([machine.load(800), machine.load(804)], [0x87654321, 0xa5a5a5a5]);
        await call(0xc3, [key, name, text(704, 'ABCD')]);
        machine.bytes(800, 12).fill(0xa5);
        const reply = await call(0xc1, [key, name, 800, 12]),
          expected = profile.startsWith('sdk-') ? [65, 66, 67, 68, 0] : [65, 66, 67, 68, 0, 0];
        assert.equal(reply.value, expected.length);
        assert.deepEqual(machine.bytes(800, expected.length), Uint8Array.from(expected));
        assert.equal(machine.bytes(800 + expected.length, 1)[0], 0xa5);
        const state = engine.snapshot();
        fresh = await open();
        const restored = await NativeRegistry.open(fresh, options);
        fresh.restore(structuredClone(state));
        assert.deepEqual(restored.snapshot(), feature.snapshot());
        machine.bytes(800, 12).fill(0xa5);
        assert.equal(
          (await restored.apply(0xc1, [key, name, 800, 12], machine, { id: 1 })).value,
          expected.length,
        );
        assert.deepEqual(machine.bytes(800, expected.length), Uint8Array.from(expected));
        assert.equal(restored.handles.size, 0, 'original wrappers close every opened key');
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );

test(
  'SDK World registry uses one loaded platform hive, restores it before returning, and persists later writes for a cold World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      platform = new Map(),
      make = () => {
        const game = memoryGame({
            'engine.exe': bytes,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          random = new ParticleRandom();
        return new NativeWorld({
          game,
          profile,
          random,
          configuration: new NativeConfiguration({ profile }),
          images: {},
          host: {},
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: {
            read: async () => null,
            write: async () => true,
            readPlatform: async (name) => platform.get(name)?.slice() ?? null,
            writePlatform: async (name, bytes) => {
              platform.set(name, bytes.slice());
              return true;
            },
          },
        });
      },
      world = make();
    let fresh, cold;
    const call = (world, id, args) =>
      world.runtime.native('main', id, args, world.main.machine, world.main);
    try {
      await world.initialize('main.kcs');
      world.main.machine.writeString('Retrom\\World', 512);
      world.main.machine.writeString('value', 608);
      await call(world, 0xc2, [512, 608, 1]);
      const state = structuredClone(world.snapshot());
      await call(world, 0xc2, [512, 608, 2]);
      fresh = make();
      await fresh.restore(state);
      assert.equal((await call(fresh, 0xc1, [512, 608, 800, 4])).value, 4);
      assert.equal(
        fresh.main.machine.load(800),
        1,
        'restored hive wins over the earlier asynchronous platform load',
      );
      await call(fresh, 0xc2, [512, 608, 3]);
      await call(world, 0xc1, [512, 608, 800, 4]);
      assert.equal(
        world.main.machine.load(800),
        2,
        'fresh Worlds have independent in-process state',
      );
      cold = make();
      await cold.initialize('main.kcs');
      cold.main.machine.writeString('Retrom\\World', 512);
      cold.main.machine.writeString('value', 608);
      await call(cold, 0xc1, [512, 608, 800, 4]);
      assert.equal(cold.main.machine.load(800), 3);
      assert.deepEqual([...platform.keys()], ['windows-hkcu']);
    } finally {
      await cold?.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
