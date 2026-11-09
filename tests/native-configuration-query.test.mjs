// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfigurationQueries } from '../src/native/configuration-query.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  configurationQueryState,
  configurationQueryMachine,
} from './fixtures/configuration-query-fixture.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} Settings queries share live legacy sound words, archive declarations and nested sound records`,
    { skip: !process.env[variable] },
    async () => {
      const state = configurationQueryState(profile),
        engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
          configuration: state.configuration,
        }),
        world = { ...state, objects: { machine: () => null } },
        feature = new NativeConfigurationQueries(engine, world),
        m = configurationQueryMachine(),
        p = engine.process,
        voice = new DataView(state.configuration.blocks[0].buffer),
        text = (value, at = 512) => {
          const bytes = encodeCP932(value);
          m.bytes(at, bytes.length + 1).set([...bytes, 0]);
          return at;
        },
        call = (id, args) => feature.apply(id, args, m, { id: 1 });
      try {
        voice.setUint32(0, 37, true);
        voice.setUint32(1402 * 4, 0, true);
        voice.setUint32(1403 * 4, 0, true);
        assert.deepEqual(await call(0x25d, [text('bg01')]), { control: 1, value: 37 });
        voice.setUint32(1403 * 4, 2, true);
        assert.equal((await call(0x25d, [512])).value, 0);
        voice.setUint32((5 + 29 * 2) * 4, 0xfffffff0, true);
        voice.setUint32((14 + 29 * 2) * 4, 0x80000000, true);
        assert.equal((await call(0x25e, [text('voice01')])).value, 0xfffffff0);
        assert.equal((await call(0x25f, [512])).value, 0x80000000);
        assert.equal((await call(0x34c, [512])).value, 2);
        assert.equal((await call(0x34c, [text('missing')])).value, 0xffffffff);
        assert.equal((await call(0x2a2, [text('voice01'), text('sound', 768)])).value, 2);
        state.soundConfiguration.loaded = true;
        const encoded = profile.startsWith('sdk-')
          ? encodeCP932('日本語01')
          : new TextEncoder().encode('日本語01');
        m.bytes(512, encoded.length + 1).set([...encoded, 0]);
        assert.equal(
          (await call(0x2a2, [512, 768])).value,
          11,
          'profile XML string bytes remain unchanged',
        );
        assert.equal((await call(0x2a2, [text('long_sound_filename_01'), 768])).value, 127);
        state.soundConfiguration.parts[1].children[1].int = 'other';
        assert.equal((await call(0x2a2, [512, 768])).value, 7);
        state.game.nativeResources.entries[7].name = 'renamed';
        assert.equal((await call(0x2a2, [512, 768])).value, 0xffffffff);
        state.soundConfiguration.parts[1].children[1].int = 'renamed';
        assert.equal((await call(0x2a2, [512, 768])).value, 7);
        m.bytes(0, 12).fill(0xa5);
        [0xdeadbeef, 0x80000000].forEach((v, i) =>
          p.store(engine.refs.owner + feature.layout.query24D + i * 4, v),
        );
        assert.deepEqual(await call(0x24d, [0, 4]), { control: 2 });
        assert.deepEqual([m.load(0), m.load(4), m.load(8)], [0xdeadbeef, 0x80000000, 0xa5a5a5a5]);
        const count = feature.refs.allocations.size;
        for (let i = 0; i < 20; i++) await call(0x25e, [text('voice01')]);
        assert.equal(
          feature.refs.allocations.size,
          count,
          'read-only projections reuse their allocations',
        );

        const settings = engine.configurationMemory,
          first = engine.refs.owner + settings.layout.first,
          second = engine.refs.owner + settings.layout.second;
        p.store(second + 44, 0xdec0de42);
        state.configuration.setField('screen.width', 1234);
        state.configuration.setField('screen.height', 567);
        state.configuration.setField('d3d.textureCompression', 3);
        state.configuration.setField('general.dualCore', 1);
        settings.push();
        assert.deepEqual(
          [p.load(first), p.load(second + 40), p.load(second + 44), p.load(second + 48)],
          [(567 << 16) | 1234, 3, 0xdec0de42, 1],
        );
        p.store(first, (678 << 16) | 1444);
        p.store(second + 40, 2);
        p.store(second + 48, 0);
        assert.equal(settings.pull(), true);
        assert.deepEqual(
          [
            state.configuration.screen.width,
            state.configuration.screen.height,
            state.configuration.getField('d3d.textureCompression'),
            state.configuration.getField('general.dualCore'),
          ],
          [1444, 678, 2, 0],
        );
      } finally {
        await engine.close();
      }
    },
  );

test(
  'SDK World Settings queries preserve shared state, raw tail words and native identities in a fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      make = () => {
        const state = configurationQueryState(profile, 1),
          game = memoryGame({
            'engine.exe': bytes,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          random = new ParticleRandom();
        game.nativeResources = state.game.nativeResources;
        return new NativeWorld({
          ...state,
          game,
          profile,
          random,
          images: {},
          host: {},
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const m = world.main.machine,
        text = (text, at) => {
          m.writeString(text, at);
          return at;
        },
        call = (id, args) => world.runtime.native('main', id, args, m, world.main);
      assert.equal(
        (await call(0x2a2, [text('long_sound_filename_1', 512), text('sound', 768)])).value,
        127,
      );
      const feature = await world.getNativeFeature('configuration-queries'),
        p = world.nativeEngine.process,
        root = p.load(world.nativeEngine.refs.owner + feature.layout.soundParts);
      p.store(world.nativeEngine.refs.owner + feature.layout.query24D, 0x12345678);
      p.store(world.nativeEngine.refs.owner + feature.layout.query24D + 4, 0x80000000);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const fm = fresh.main.machine,
        restored = await fresh.getNativeFeature('configuration-queries');
      assert.equal(
        fresh.nativeEngine.process.load(fresh.nativeEngine.refs.owner + restored.layout.soundParts),
        root,
      );
      assert.equal(
        (await fresh.runtime.native('main', 0x2a2, [512, 768], fm, fresh.main)).value,
        127,
      );
      fm.bytes(0, 12).fill(0xa5);
      await fresh.runtime.native('main', 0x24d, [0, 4], fm, fresh.main);
      assert.deepEqual([fm.load(0), fm.load(4), fm.load(8)], [0x12345678, 0x80000000, 0xa5a5a5a5]);
      fresh.soundConfiguration.parts[1].children[1].int = 'other';
      assert.equal(
        (await fresh.runtime.native('main', 0x2a2, [512, 768], fm, fresh.main)).value,
        7,
      );
      assert.equal((await call(0x2a2, [512, 768])).value, 127);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
