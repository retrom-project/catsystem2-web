// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './fixtures/data-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfigurationQueries } from '../oracle/configuration-query.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  configurationQueryState,
  configurationQueryMachine,
} from './fixtures/configuration-query-fixture.mjs';

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
        state.configuration.queryWords.set([0xdeadbeef, 0x80000000]);
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

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS Settings queries share live state and preserve raw words across restore',
    async () => {
      const world = await dataWorld(profile);
      let fresh;
      const call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main);
      try {
        const state = configurationQueryState(profile, 1);
        world.configuration.restore(state.configuration.snapshot());
        world.soundConfiguration.restore(state.soundConfiguration.snapshot());
        world.game.nativeResources = state.game.nativeResources;
        world.main.machine.writeString('long_sound_filename_1', 512);
        world.main.machine.writeString('sound', 768);
        assert.equal((await call(world, 0x2a2, [512, 768])).value, 127);
        world.configuration.queryWords.set([0x12345678, 0x80000000]);
        fresh = await dataWorld(profile, {}, { initialize: false });
        fresh.game.nativeResources = structuredClone(state.game.nativeResources);
        await fresh.restore(structuredClone(world.snapshot()));
        const m = fresh.main.machine;
        assert.equal((await call(fresh, 0x2a2, [512, 768])).value, 127);
        m.bytes(0, 12).fill(0xa5);
        await call(fresh, 0x24d, [0, 4]);
        assert.deepEqual([m.load(0), m.load(4), m.load(8)], [0x12345678, 0x80000000, 0xa5a5a5a5]);
        fresh.soundConfiguration.parts[1].children[1].int = 'other';
        assert.equal((await call(fresh, 0x2a2, [512, 768])).value, 7);
        assert.equal((await call(world, 0x2a2, [512, 768])).value, 127);
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
