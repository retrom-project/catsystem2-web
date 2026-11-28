// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadUnicorn } from '../oracle/ppi-backend.mjs';
import { NativeEngineProcess } from '../oracle/engine-process.mjs';
import { NativeRegistry } from '../oracle/registry-original.mjs';
import { registryDecodeANSI, registryEncodeANSI } from '../src/native/registry-codepage.mjs';
import { configurationQueryMachine } from './fixtures/configuration-query-fixture.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeWorld as OrdinaryWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
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

function ordinaryRegistryFixture(profile, platform, quiet = false) {
  const call = (id, args, out) => [
      ...args.map((x) => [37, x]),
      [43, id, args.length * 4],
      [38, out],
    ],
    operations = [
      [37, 17],
      [38, 0],
      [37, 9],
      [38, 4],
      [37, 0x13579bdf],
      ...(!quiet
        ? [
            ...call(0xc2, [512, 640, 0x80000000], 256),
            ...call(0xc0, [512, 640], 260),
            ...call(0xc1, [512, 640, 832, 4], 264),
            ...call(0xc3, [512, 704, 768], 268),
            [37, 0xa5a5a5a5],
            [38, 848],
            [37, 0xa5a5a5a5],
            [38, 852],
            ...call(0xc1, [512, 704, 848, 8], 272),
            ...call(0xc0, [512, 704], 276),
          ]
        : []),
      [37, 2048],
      [43, 0x47, 4],
      [59],
    ],
    game = memoryGame({
      'main.kcs': kcsProgram(operations, [
        [512, 'RetromNormal\\%d[G0]'],
        [640, 'value_%d[G4]'],
        [704, 'literal'],
        [768, 'ABC'],
      ]),
    }),
    configuration = new NativeConfiguration({ profile }),
    random = new ParticleRandom(19, 23),
    events = { reads: [], writes: [], native: [], cpu: 0 },
    world = new OrdinaryWorld({
      game,
      profile,
      configuration,
      random,
      images: {},
      host: {},
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: {
        read: async () => null,
        write: async () => true,
        async readPlatform(name) {
          events.reads.push(name);
          return platform.get(name)?.slice() ?? null;
        },
        async writePlatform(name, bytes) {
          events.writes.push(name);
          platform.set(name, bytes.slice());
        },
      },
    });
  world.ensureNativeEngine = () => {
    events.cpu++;
    throw new Error('ordinary registry attempted original CPU');
  };
  const native = world.runtime.native;
  world.runtime.native = function (...args) {
    events.native.push(args[1]);
    return native.apply(this, args);
  };
  return { world, events };
}
for (const profile of [
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
]) {
  test(`ordinary registry GCALLs retain raw bytes, persistence and cold World ownership in ${profile}`, async () => {
    const platform = new Map(),
      first = ordinaryRegistryFixture(profile, platform),
      fresh = ordinaryRegistryFixture(profile, platform),
      cold = ordinaryRegistryFixture(profile, platform, true);
    try {
      await first.world.initialize('main.kcs');
      const machine = first.world.main.machine,
        ansi = !nativeABI(profile).capabilities.unicodeOutput;
      assert.deepEqual(
        [256, 260, 264, 268, 272, 276].map((x) => machine.load(x)),
        [1, 1, 4, 1, ansi ? 4 : 3, 1],
      );
      assert.deepEqual(machine.bytes(832, 4), Uint8Array.of(0, 0, 0, 128));
      assert.deepEqual(
        machine.bytes(848, 8),
        Uint8Array.from(
          ansi ? [65, 66, 67, 0, 165, 165, 165, 165] : [65, 66, 67, 0, 0, 165, 165, 165],
        ),
      );
      assert.equal(machine.load(machine.sp - 4), 0x13579bdf);
      assert.deepEqual(first.events.native, [0xc2, 0xc0, 0xc1, 0xc3, 0xc1, 0xc0, 0x47]);
      assert.deepEqual(first.events.reads, ['windows-hkcu']);
      assert.equal(
        first.events.writes.length,
        3,
        'key creation and each value write persist through the existing hive',
      );
      assert.equal(first.world.platformRegistry.handles.size, 0);
      const dto = structuredClone(first.world.snapshot());
      let rng = 0;
      for (const stream of [fresh.world.random.integer, fresh.world.random.real]) {
        const next = stream.nextUint32;
        stream.nextUint32 = function (...args) {
          rng++;
          return next.apply(this, args);
        };
      }
      await fresh.world.restore(structuredClone(dto));
      assert.deepEqual(fresh.world.snapshot(), dto);
      assert.deepEqual(fresh.events.reads, ['windows-hkcu']);
      assert.deepEqual(fresh.events.writes, []);
      assert.deepEqual(fresh.events.native, []);
      assert.equal(rng, 0);
      assert.notEqual(first.world.platformRegistry.keys, fresh.world.platformRegistry.keys);
      const task = fresh.world.main,
        m = task.machine;
      m.bytes(900, 8).fill(0xa5);
      assert.deepEqual(
        await fresh.world.runtime.native('main', 0xc1, [512, 640, 900, 3], m, task),
        { control: 1, value: 0 },
      );
      assert.deepEqual(m.bytes(900, 8), new Uint8Array(8).fill(0xa5));
      assert.deepEqual(
        await fresh.world.runtime.native('main', 0xc1, [512, 640, 0x7f000000, 0], m, task),
        { control: 1, value: 4 },
      );
      assert.deepEqual(await fresh.world.runtime.native('main', 0xc2, [512, 640, 7], m, task), {
        control: 1,
        value: 1,
      });
      await first.world.runtime.native('main', 0xc1, [512, 640, 936, 4], machine, first.world.main);
      assert.equal(
        machine.load(936),
        0x80000000,
        'fresh hive mutation does not share the prior World',
      );
      await cold.world.initialize('main.kcs');
      assert.deepEqual(cold.events.reads, [], 'unused registry does not read platform storage');
      const cm = cold.world.main.machine;
      assert.deepEqual(
        await cold.world.runtime.native('main', 0xc1, [512, 640, 936, 4], cm, cold.world.main),
        { control: 1, value: 4 },
      );
      assert.equal(cm.load(936), 7, 'a new ordinary World reads the real persisted value');
      assert.equal(first.events.cpu + fresh.events.cpu + cold.events.cpu, 0);
    } finally {
      await first.world.close();
      await fresh.world.close();
      await cold.world.close();
    }
  });
}
for (const profile of [
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
]) {
  test(`ordinary registry settles IO and retains failed persistence across cold restore in ${profile}`, async () => {
    const platform = new Map(),
      first = ordinaryRegistryFixture(profile, platform, true),
      fresh = ordinaryRegistryFixture(profile, platform, true);
    const readEntered = Promise.withResolvers(),
      readAllowed = Promise.withResolvers(),
      writeEntered = Promise.withResolvers(),
      writeAllowed = Promise.withResolvers();
    let pending;
    const originalWrite = first.world.storage.writePlatform;
    try {
      await first.world.initialize('main.kcs');
      const read = first.world.storage.readPlatform,
        write = originalWrite;
      first.world.storage.readPlatform = async function (...args) {
        readEntered.resolve();
        await readAllowed.promise;
        return read.apply(this, args);
      };
      let writes = 0;
      first.world.storage.writePlatform = async function (...args) {
        if (++writes === 1) {
          writeEntered.resolve();
          await writeAllowed.promise;
        }
        return write.apply(this, args);
      };
      const task = first.world.main,
        machine = task.machine;
      pending = first.world.runtime.native('main', 0xc2, [512, 640, 7], machine, task);
      await readEntered.promise;
      assert.throws(() => first.world.snapshot(), /platform load to settle/);
      readAllowed.resolve();
      await writeEntered.promise;
      assert.throws(() => first.world.snapshot(), /settled call/);
      writeAllowed.resolve();
      assert.deepEqual(await pending, { control: 1, value: 1 });
      assert.equal(writes, 2);
      assert.equal(first.world.platformRegistry.handles.size, 0);
      const failure = new Error('owned registry write failed');
      first.world.storage.writePlatform = () => Promise.reject(failure);
      assert.deepEqual(
        await first.world.runtime.native('main', 0xc2, [512, 640, 9], machine, task),
        { control: 1, value: 0 },
      );
      assert.equal(first.world.platformRegistry.dirty, true);
      assert.equal(first.world.platformRegistry.handles.size, 0);
      const dto = structuredClone(first.world.snapshot());
      await fresh.world.restore(structuredClone(dto));
      assert.deepEqual(fresh.world.snapshot(), dto);
      assert.equal(fresh.world.platformRegistry.dirty, true);
      assert.deepEqual(fresh.events.writes, []);
      await fresh.world.flush();
      assert.equal(fresh.world.platformRegistry.dirty, false);
      const values = JSON.parse(new TextDecoder().decode(platform.get('windows-hkcu'))).keys;
      assert.equal(
        values.find(([name]) => name === 'SOFTWARE\\RETROMNORMAL\\17')[1][0][2],
        '09000000',
      );
      assert.equal(first.events.cpu + fresh.events.cpu, 0);
    } finally {
      readAllowed.resolve();
      writeAllowed.resolve();
      await pending?.catch(() => {});
      first.world.storage.writePlatform = originalWrite;
      await first.world.close();
      await fresh.world.close();
    }
  });
}

for (const profile of [
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
]) {
  test(`ordinary Registry keeps NativeFileStorage transaction abort nonfatal in ${profile}`, async () => {
    const platform = new Map(),
      { world } = ordinaryRegistryFixture(profile, platform, true);
    let storage;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        machine = task.machine;
      assert.deepEqual(await world.runtime.native('main', 194, [512, 640, 7], machine, task), {
        control: 1,
        value: 1,
      });
      const durable = platform.get('windows-hkcu').slice();
      storage = new NativeFileStorage(world.game, 'registry-transaction-test');
      storage.platformStore.records.set('windows-hkcu', { data: { bytes: durable } });
      const failure = new DOMException(
        'Controlled registry transaction abort',
        'QuotaExceededError',
      );
      let aborts = 0;
      storage.platformStore.db = {
        close() {},
        transaction() {
          const tx = {};
          tx.objectStore = () => ({
            put() {
              const request = { error: failure };
              queueMicrotask(() => {
                aborts++;
                tx.error = failure;
                tx.onabort?.();
              });
              return request;
            },
          });
          return tx;
        },
      };
      world.storage = storage;
      assert.deepEqual(await world.runtime.native('main', 194, [512, 640, 9], machine, task), {
        control: 1,
        value: 0,
      });
      assert.equal(world.platformRegistry.dirty, true);
      assert.deepEqual(await storage.readPlatform('windows-hkcu'), durable);
      const live = world.platformRegistry.keys.get('SOFTWARE\\RETROMNORMAL\\17').get('VALUE_9');
      assert.equal(new DataView(live.data.buffer).getUint32(0, true), 9);
      assert.deepEqual(await world.runtime.native('main', 193, [512, 640, 896, 4], machine, task), {
        control: 1,
        value: 0,
      });
      await world.flush();
      assert.equal(world.platformRegistry.dirty, true);
      await world.close({ flushFiles: false });
      assert.equal(world.closed, true);
      assert.equal(world.platformRegistry.handles.size, 0);
      assert.equal(aborts, 4, 'native write, query, explicit flush and close attempt persistence');
      assert.deepEqual(await storage.readPlatform('windows-hkcu'), durable);
    } finally {
      if (!world.closed) await world.close({ flushFiles: false });
      storage?.close();
    }
  });
}

test('ordinary Registry retries storage reads without swallowing malformed hive or VM input errors', async () => {
  const platform = new Map();
  const { world } = ordinaryRegistryFixture('bokutomo-engine-2.6.1.67', platform, true);
  try {
    await world.initialize('main.kcs');
    const task = world.main,
      machine = task.machine;
    world.storage.readPlatform = async () => {
      throw new Error('controlled hive read rejection');
    };
    assert.deepEqual(await world.runtime.native('main', 192, [512, 640], machine, task), {
      control: 1,
      value: 0,
    });
    assert.equal(world.platformRegistry, null);
    assert.equal(world.platformRegistryLoading, null);
    world.storage.readPlatform = async () => new TextEncoder().encode('{"keys":"invalid"}');
    await assert.rejects(
      world.runtime.native('main', 192, [512, 640], machine, task),
      /Invalid registry hive/,
    );
    world.storage.readPlatform = async () => null;
    assert.deepEqual(await world.runtime.native('main', 194, [512, 640, 7], machine, task), {
      control: 1,
      value: 1,
    });
    await assert.rejects(world.runtime.native('main', 195, [512, 640, 0x7f000000], machine, task));
    assert.equal(world.platformRegistry.handles.size, 0);
    machine.writeString('P'.repeat(251), 1024);
    await assert.rejects(
      world.runtime.native('main', 194, [1024, 640, 7], machine, task),
      /native scratch/,
    );
    machine.writeString('N'.repeat(256), 1024);
    await assert.rejects(
      world.runtime.native('main', 194, [512, 1024, 7], machine, task),
      /native scratch/,
    );
    await assert.rejects(
      world.runtime.native('main', 192, [0x7f000000, 640], machine, task),
      /not mapped/,
    );
  } finally {
    await world.close({ flushFiles: false });
  }
});
