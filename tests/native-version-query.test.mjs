// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MotionLibrary } from '../src/motion/library.mjs';
import { NATIVE_EXE_PROFILES } from '../oracle/executable-catalog.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../oracle/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../oracle/global-strings-bridge.mjs';
import { NATIVE_VERSION_QUERY } from '../oracle/version-query-original.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeWorld as OrdinaryWorld } from '../src/native/world.mjs';
import { nativeModuleMetadata, readPEVersionResource } from '../src/native/profile.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import {
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

const { id, handlers } = NATIVE_VERSION_QUERY;
const program = kcsProgram([
  [37, 256],
  [37, 260],
  [37, 264],
  [37, 268],
  [43, id, 16],
  [37, 2048],
  [43, 0x47, 4],
  [59],
]);
for (const profile of Object.keys(handlers)) {
  const sdk = profile.startsWith('sdk-'),
    executable = process.env[sdk ? 'CATSYSTEM2_SDK_EXE' : 'CATSYSTEM2_ENGINE_EXE'];
  test(
    `original main 1BC uses the actual file version and live VM output in ${profile}`,
    {
      skip: !executable,
    },
    async () => {
      const bytes = new Uint8Array(await readFile(executable));
      const make = async () => {
        const game = memoryGame({ 'main.kcs': program }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(),
          world = new NativeWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: {},
            storage: { read: async () => null, write: async () => true },
            motionLibrary: new MotionLibrary(game, { profile, random }),
          }),
          engine = await NativeEngineProcess.open({
            bytes,
            profile,
            configuration,
            name: '原エンジン.exe',
          });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        return world;
      };
      const first = await make();
      let fresh;
      try {
        await first.initialize('main.kcs');
        assert.equal(
          first.nativeEngine.process.load(NATIVE_EXE_PROFILES[profile].tables.main.va + id * 4),
          handlers[profile],
        );
        const version = [2, 6, 1, sdk ? 74 : 76];
        assert.deepEqual(
          version.map((_, i) => first.main.machine.load(256 + i * 4)),
          version,
        );
        fresh = await make();
        await fresh.restore(structuredClone(first.snapshot()));
        const m = fresh.main.machine,
          out = m.allocate(16);
        await fresh.runtime.native('main', id, [out, out, out + 4, out], m, fresh.main);
        assert.equal(m.load(out), version[3], 'last aliased write wins');
        assert.equal(m.load(out + 4), version[2]);
        assert.deepEqual(
          version.map((_, i) => m.load(256 + i * 4)),
          version,
        );
      } finally {
        await fresh?.close();
        await first.close();
      }
    },
  );
}

const versionWord = (n) => [n & 255, (n >>> 8) & 255],
  versionWide = (s) => [...s].flatMap((c) => versionWord(c.charCodeAt(0))).concat(0, 0),
  versionDWORD = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
function versionBlock(key, data = [], children = [], text = false) {
  const bytes = [
    0,
    0,
    ...versionWord(text ? data.length / 2 : data.length),
    ...versionWord(Number(text)),
    ...versionWide(key),
  ];
  const align = () => {
    while (bytes.length % 4) bytes.push(0);
  };
  align();
  bytes.push(...data);
  for (const child of children) {
    align();
    bytes.push(...child);
  }
  [bytes[0], bytes[1]] = versionWord(bytes.length);
  return bytes;
}
function ownedVersionImage(profile, fileVersion, translated = true) {
  const minor = Number(profile.split('.').at(-1)),
    resource = Uint8Array.from(
      versionBlock(
        'VS_VERSION_INFO',
        [0xfeef04bd, 0x10000, 0x20006, 0x10000 + minor, ...Array(9).fill(0)].flatMap(versionDWORD),
        [
          versionBlock(
            'StringFileInfo',
            [],
            [
              versionBlock(
                '041104b0',
                [],
                fileVersion === null
                  ? []
                  : [versionBlock('FileVersion', versionWide(fileVersion), [], true)],
              ),
            ],
          ),
          ...(translated
            ? [versionBlock('VarFileInfo', [], [versionBlock('Translation', [0x11, 4, 0xb0, 4])])]
            : []),
        ],
      ),
    ),
    size = 0x80 + resource.length,
    bytes = new Uint8Array(0x200 + size),
    view = new DataView(bytes.buffer),
    u16 = (at, n) => view.setUint16(at, n, true),
    u32 = (at, n) => view.setUint32(at, n, true);
  bytes.set([77, 90]);
  u32(60, 128);
  bytes.set([80, 69, 0, 0], 128);
  u16(134, 1);
  u16(148, 224);
  u16(152, 0x10b);
  u32(264, 4096);
  u32(268, size);
  u32(384, size);
  u32(388, 4096);
  u32(392, size);
  u32(396, 512);
  for (const [at, name, target] of [
    [0, 16, 0x80000020],
    [32, 1, 0x80000040],
    [64, 0x411, 96],
  ]) {
    u16(512 + at + 14, 1);
    u32(512 + at + 16, name);
    u32(512 + at + 20, target);
  }
  u32(512 + 96, 4096 + 128);
  u32(512 + 100, resource.length);
  bytes.set(resource, 512 + 128);
  return bytes;
}
async function ordinaryVersionFixture(profile, text, translated = true) {
  const script = kcsProgram([
      [37, 0x13579bdf],
      [37, 256],
      [37, 260],
      [37, 264],
      [37, 268],
      [43, id, 16],
      [37, 2048],
      [43, 0x47, 4],
      [59],
    ]),
    game = memoryGame({
      'main.kcs': script,
      'owned_engine.exe': ownedVersionImage(profile, text, translated),
    }),
    reads = [],
    originalRead = game.read,
    originalRequire = game.require;
  game.read = function (...args) {
    reads.push(['read', args[0]]);
    return originalRead.apply(this, args);
  };
  game.require = function (...args) {
    reads.push(['require', args[0]]);
    return originalRequire.apply(this, args);
  };
  const selected = {
      profile,
      module: nativeModuleMetadata(profile, {
        name: 'owned_engine.exe',
        resource: readPEVersionResource(await game.require('owned_engine.exe')),
      }),
    },
    configuration = new NativeConfiguration({ profile }),
    random = new ParticleRandom(7, 11),
    world = new OrdinaryWorld({
      game,
      profile,
      nativeModule: selected.module,
      configuration,
      random,
      images: {},
      host: {},
      storage: { read: async () => null, write: async () => true },
      motionLibrary: new MotionLibrary(game, { profile, random }),
    });
  let cpu = 0;
  world.ensureNativeEngine = () => {
    cpu++;
    throw new Error('ordinary module version attempted original CPU');
  };
  return { world, reads, selected, cpu: () => cpu };
}
for (const profile of [
  ...Object.keys(handlers),
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
]) {
  test(`ordinary main 1BC reads its selected module FileVersion and preserves aliases across cold restore in ${profile}`, async () => {
    const text = ' 0x10002, -3, +4, 0x12345suffix',
      expected = [2, 65533, 4, profile.endsWith('.23') ? 0 : 9029],
      first = await ordinaryVersionFixture(profile, text),
      fresh = await ordinaryVersionFixture(profile, text);
    try {
      await first.world.initialize('main.kcs');
      const machine = first.world.main.machine;
      assert.deepEqual(
        [256, 260, 264, 268].map((x) => machine.load(x)),
        expected,
      );
      assert.equal(first.selected.profile, profile);
      assert.equal(first.world.nativeModule.name, 'owned_engine.exe');
      assert.deepEqual(first.world.nativeModule, first.selected.module);
      assert.equal(machine.load(machine.sp - 4), 0x13579bdf);
      const dto = structuredClone(first.world.snapshot()),
        beforeReads = fresh.reads.slice(),
        restoredReads = [
          ...beforeReads,
          ['read', 'main.kcs'],
          ...(profile === 'nekopara-vol3-engine-2.6.1.76' ? [['read', 'm2view.cnf']] : []),
        ];
      assert.notEqual(dto.nativeModule.resource, first.world.nativeModule.resource);
      let draws = 0;
      for (const stream of [fresh.world.random.integer, fresh.world.random.real]) {
        const next = stream.nextUint32;
        stream.nextUint32 = function (...args) {
          draws++;
          return next.apply(this, args);
        };
      }
      await fresh.world.restore(structuredClone(dto));
      assert.deepEqual(fresh.world.snapshot(), dto);
      assert.deepEqual(fresh.reads, restoredReads);
      assert.equal(draws, 0);
      assert.notEqual(first.world.nativeModule.resource, fresh.world.nativeModule.resource);
      const m = fresh.world.main.machine,
        out = m.allocate(16),
        stores = [],
        store = m.store;
      m.store = function (...args) {
        stores.push(args.slice(0, 2));
        return store.apply(this, args);
      };
      assert.deepEqual(
        await fresh.world.runtime.native('main', id, [out, out, out + 4, out], m, fresh.world.main),
        { control: 2 },
      );
      assert.deepEqual(stores, [
        [out, 2],
        [out, 65533],
        [out + 4, 4],
        [out, expected[3]],
      ]);
      assert.equal(m.load(out), expected[3]);
      assert.equal(m.load(out + 4), 4);
      assert.deepEqual(fresh.reads, restoredReads);
      assert.equal(first.cpu() + fresh.cpu(), 0);
    } finally {
      await first.world.close();
      await fresh.world.close();
    }
  });
}

for (const profile of [
  ...Object.keys(handlers),
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
]) {
  test(`ordinary main 1BC retains native separators, low words and missing resource results in ${profile}`, async () => {
    const cases = profile.endsWith('.23')
      ? [
          ['1.2.3.4', [0, 0, 0, 0]],
          ['0x10002.0x10003.0x10004.0x10005', [0, 0, 0, 0]],
          ['65536, 65537, 2147483647, -2147483648', [0, 1, 65535, 13108]],
          ['1.2,3.4,5,6', [1, 3, 5, 6]],
          ['1,,3,4', [1, 1, 3, 4]],
          ['3,4', [3, 0, 0, 0]],
          ['none', [0, 0, 0, 0]],
          ['1.2.3.4', [0, 0, 0, 0], false],
        ]
      : [
          ['1.2.3.4', [1, 2, 3, 4]],
          ['0x10002.0x10003.0x10004.0x10005', [2, 3, 4, 5]],
          ['65536, 65537, 2147483647, -2147483648', [0, 1, 65535, 0]],
          ['1.2,3.4,5,6', [1, 3, 5, 6]],
          ['1,,3,4', [1, 1, 3, 4]],
          ['3,4', [3, 0, 0, 0]],
          ['none', [0, 0, 0, 0]],
          ['1.2.3.4', [0, 0, 0, 0], false],
        ];
    for (const [text, expected, translated] of cases) {
      const fixture = await ordinaryVersionFixture(profile, text, translated);
      try {
        await fixture.world.initialize('main.kcs');
        const machine = fixture.world.main.machine;
        assert.deepEqual(
          [256, 260, 264, 268].map((at) => machine.load(at)),
          expected,
          text,
        );
        assert.equal(machine.load(machine.sp - 4), 0x13579bdf);
        assert.equal(fixture.cpu(), 0);
      } finally {
        await fixture.world.close();
      }
    }
  });

  test(`ordinary main 1BC rejects unavailable module authority and unwritten scratch in ${profile}`, async () => {
    const missing = await ordinaryVersionFixture(profile, '1.2.3.4'),
      unwritten = await ordinaryVersionFixture(profile, 'bad,1,2,3');
    missing.world.nativeModule = null;
    try {
      await assert.rejects(
        missing.world.initialize('main.kcs'),
        /actual uniquely selected main module/,
      );
      await assert.rejects(
        unwritten.world.initialize('main.kcs'),
        /first component leaves its native scratch unwritten/,
      );
      for (const fixture of [missing, unwritten]) {
        assert.deepEqual(
          [256, 260, 264, 268].map((at) => fixture.world.main.machine.load(at)),
          [0, 0, 0, 0],
        );
        assert.equal(fixture.cpu(), 0);
      }
    } finally {
      await missing.world.close();
      await unwritten.world.close();
    }
  });
}

test('ordinary main module cold restore rejects a different selected source before replay', async () => {
  const profile = 'sdk-4.01-engine-2.6.1.74',
    first = await ordinaryVersionFixture(profile, '1.2.3.4'),
    fresh = await ordinaryVersionFixture(profile, '5.6.7.8');
  try {
    await first.world.initialize('main.kcs');
    const before = fresh.reads.slice();
    await assert.rejects(
      fresh.world.restore(structuredClone(first.world.snapshot())),
      /main module differs from its selected source/,
    );
    assert.deepEqual(fresh.reads, before);
    assert.equal(fresh.world.main, undefined);
    assert.equal(fresh.world.objects.objects.size, 0);
    assert.equal(first.cpu() + fresh.cpu(), 0);
  } finally {
    await first.world.close();
    await fresh.world.close();
  }
});

for (const profile of Object.keys(handlers)) {
  test(`executable-free explicit authoring restores a Core without inventing module authority: ${profile}`, async () => {
    const environment = startupEnvironment();
    let first, fresh, automatic;
    try {
      const game = await ordinaryStartupGame(profile, { sound: false }),
        options = {
          game,
          nativeProfile: profile,
          audioContext: { currentTime: 0, close: async () => {} },
          randomSeed: 77,
        };
      first = new CatSystem2({ ...options, canvas: new StartupCanvas() });
      await first.initialize();
      const saved = await first.snapshot();
      automatic = new CatSystem2({
        ...options,
        nativeProfile: undefined,
        canvas: new StartupCanvas(),
      });
      await assert.rejects(
        automatic.initialize({ checkpoint: structuredClone(saved) }),
        /unique reviewed/,
      );
      assert.equal(automatic.world, undefined);
      fresh = new CatSystem2({ ...options, canvas: new StartupCanvas() });
      await fresh.initialize({ checkpoint: structuredClone(saved) });
      assert.equal(fresh.nativeModule, null);
      assert.deepEqual(fresh.world.snapshot(), saved.world);
      const before = fresh.world;
      await fresh.restore(structuredClone(saved));
      assert.notEqual(fresh.world, before);
      assert.deepEqual(fresh.world.snapshot(), saved.world);
      const wrong = {
        ...saved,
        world: {
          ...saved.world,
          nativeModule: {
            name: 'unmounted.exe',
            resource: readPEVersionResource(ownedVersionImage(profile, '7,8,9,10')),
          },
        },
      };
      await assert.rejects(fresh.restore(wrong), /current reviewed executable/);
      assert.deepEqual(fresh.world.snapshot(), saved.world);
    } finally {
      await automatic?.dispose();
      await fresh?.dispose();
      await first?.dispose();
      environment.restore();
    }
  });
}

const legacyModuleVersion = JSON.parse(
  await readFile(new URL('./fixtures/native-module-version-legacy-golden.json', import.meta.url)),
);
for (const own of legacyModuleVersion.versions) {
  const profile = {
    23: 'grisaia-jp-engine-2.6.1.23',
    63: 'rebellions-jp-engine-2.6.1.63',
    67: 'bokutomo-engine-2.6.1.67',
  }[own.version];
  test(`ordinary module.version matches own text fields and fixed buffer limits in ${profile}`, async () => {
    for (const row of own.cases) {
      const fixture = await ordinaryVersionFixture(profile, row.text, row.translated);
      try {
        await fixture.world.initialize('main.kcs');
        const machine = fixture.world.main.machine;
        assert.deepEqual(
          [256, 260, 264, 268].map((at) => machine.load(at)),
          row.values,
          String(row.text),
        );
        assert.equal(fixture.cpu(), 0);
      } finally {
        await fixture.world.close();
      }
    }
    const oversized = await ordinaryVersionFixture(profile, '1,2,3,' + '4'.repeat(250));
    try {
      await assert.rejects(oversized.world.initialize('main.kcs'), /native fixed buffer/);
      assert.deepEqual(
        [256, 260, 264, 268].map((at) => oversized.world.main.machine.load(at)),
        [0, 0, 0, 0],
      );
    } finally {
      await oversized.world.close();
    }
  });
}
