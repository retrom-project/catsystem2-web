// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import {
  databaseFixture,
  databaseState,
  compiledDatabase,
  DATABASE_ROWS,
} from './fixtures/database-fixture.mjs';
import { SaveSlotFiles } from './fixtures/save-slots-fixture.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    `${profile} original KCDB records preserve flag transitions, raw serialization and dirty boundaries`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const f = await databaseFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        { database, machine, engine } = f,
        p = engine.process,
        invoke = (id, args) => database.apply(id, args, machine, { id: 1 }),
        put = (text, at = 1280) => machine.writeString(text, at);
      try {
        for (const [at, text] of [
          [256, 'authored'],
          [512, '\\n'],
          [768, '\\n'],
          [896, ''],
        ])
          put(text, at);
        const h = (await invoke(0x365, [256, 512, 768, 896])).value,
          pointer = database.pointer(h);
        assert.deepEqual(
          databaseState(p, pointer).rows.map((row) => row.id),
          [3, 1, 2],
        );
        const size = (await invoke(0x368, [h, 0])).value,
          data = p.allocate(size + 32);
        try {
          p.write(data, new Uint8Array(size + 32).fill(0xa5));
          await invoke(0x368, [h, data + 16]);
          assert.equal(p.load(data + 16), 3);
          assert.deepEqual([...p.read(data, 16)], [...new Uint8Array(16).fill(0xa5)]);
          assert.deepEqual([...p.read(data + 16 + size, 16)], [...new Uint8Array(16).fill(0xa5)]);
          put('alpha');
          await invoke(0x367, [h, 2, 1280]);
          assert.equal((await invoke(0x36d, [h])).value, 1);
          assert.deepEqual(databaseState(p, pointer).rows[0].flags, [4, 4, 1]);
          await invoke(0x36e, [h]);
          await invoke(0x367, [h, 34, 1280]);
          assert.equal(
            (await invoke(0x36d, [h])).value,
            0,
            'shift count wraps modulo 32; repeat preserves clean state',
          );
          await invoke(0x367, [h, 31, 1280]);
          assert.deepEqual(databaseState(p, pointer).rows[0].flags, [0x80000004, 0x80000004, 1]);
          await invoke(0x36e, [h]);
          await invoke(0x368, [h, data + 16]);
          [0xffffffff, 0x12345678, 0x87654321].forEach((value, i) =>
            p.store(data + 16 + 4 + 256 + i * 4, value),
          );
          assert.equal((await invoke(0x369, [h, data + 16])).value, 1);
          assert.deepEqual(
            databaseState(p, pointer).rows[0].flags,
            [0xffffffff, 0x12345678, 0x87654321],
          );
          assert.equal((await invoke(0x36d, [h])).value, 0, 'flag import does not mark dirty');
          assert.equal((await invoke(0x369, [h, 0])).value, 0);
        } finally {
          p.free(data);
        }
        assert.deepEqual(await invoke(0x368, [0, 0]), { control: 1, value: 0xcccccccc });
        assert.deepEqual(await invoke(0x369, [0, 0]), { control: 1, value: 0xcccccccc });
        assert.deepEqual(await invoke(0x367, [0]), { control: 2 });
        assert.deepEqual(await invoke(0x368, [0]), { control: 1, value: 0xcccccccc });
        assert.deepEqual(await invoke(0x369, [0]), { control: 1, value: 0xcccccccc });
        await invoke(0x366, [h]);
        assert.equal(p.allocations.has(pointer), false);
        await assert.rejects(() => invoke(0x36d, [h]), /released/);
        assert.deepEqual(await invoke(0x366, [0]), { control: 2 });
        put('missing', 256);
        const missing = (await invoke(0x365, [256, 512, 768, 896])).value;
        assert.notEqual(missing, 0, 'missing source still leaves the native empty object');
        assert.equal((await invoke(0x368, [missing, 0])).value, 4);
        assert.equal((await invoke(0x36d, [missing])).value, 0);
      } finally {
        await engine.close();
      }
    },
  );
  test(
    `${profile} database flags pass through raw heap/CSS into a fresh World and retain native identity on checkpoint`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        files = new SaveSlotFiles(),
        make = async () => {
          const game = memoryGame({
            'main.kcs': kcsProgram([[37, 2048], [43, 0x47, 4], [59]]),
            'authored.kdb': compiledDatabase(DATABASE_ROWS),
          });
          game.resolveCategory = (name, category) =>
            category === 'database' && !name.endsWith('.kdb') ? `${name}.kdb` : name;
          game.readCategory = async (name, category) =>
            game.read(game.resolveCategory(name, category));
          const configuration = new NativeConfiguration({ profile }),
            random = new ParticleRandom(),
            world = new NativeWorld({
              game,
              profile,
              configuration,
              random,
              images: {},
              host: {},
              storage: files,
              motionLibrary: new MotionLibrary(game, { profile, random }),
            }),
            engine = await NativeEngineProcess.open({
              bytes,
              profile,
              configuration,
              ...files.options(),
            });
          new NativeGlobalStringsBridge(engine, world.globalStrings);
          world.nativeEngine = engine;
          world.nativeEngineLoading = Promise.resolve(engine);
          return world;
        },
        first = await make(),
        call = (world, id, args) =>
          world.runtime.native(
            'main',
            id,
            args,
            world.main.machine,
            world.main,
            world.runtime.scheduler,
          ),
        load = async (world) => {
          for (const [at, text] of [
            [256, 'authored'],
            [512, '\\n'],
            [768, '\\n'],
            [896, ''],
          ])
            world.main.machine.writeString(text, at);
          return (await call(world, 0x365, [256, 512, 768, 896])).value;
        };
      let fresh, restored;
      try {
        await first.initialize('main.kcs');
        const db = await load(first),
          feature = await first.getNativeFeature('databases');
        first.main.machine.writeString('alpha', 1280);
        await call(first, 0x367, [db, 5, 1280]);
        const expected = databaseState(first.nativeEngine.process, feature.pointer(db)),
          size = (await call(first, 0x368, [db, 0])).value,
          payload = (await call(first, 0x341, [size])).value,
          css = (await call(first, 0xee, [0x10203])).value;
        await call(first, 0x368, [db, payload]);
        assert.equal((await call(first, 0x343, [css, 7, size, payload])).value, 1);
        await call(first, 0x342, [payload]);
        first.main.machine.writeString('database-flags.dat', 1536);
        assert.equal((await call(first, 0xf5, [css, 1536])).value, 1);
        fresh = await make();
        await fresh.initialize('main.kcs');
        const peer = await load(fresh),
          peerFeature = await fresh.getNativeFeature('databases');
        assert.deepEqual(
          databaseState(fresh.nativeEngine.process, peerFeature.pointer(peer)).rows[0].flags,
          [0, 0, 0],
        );
        fresh.main.machine.writeString('database-flags.dat', 1536);
        const opened = (await call(fresh, 0xf7, [1536])).value,
          imported = (await call(fresh, 0x344, [opened, 7, 1792])).value;
        assert.equal(fresh.main.machine.load(1792), size);
        await call(fresh, 0x369, [peer, imported]);
        await call(fresh, 0x342, [imported]);
        const state = databaseState(fresh.nativeEngine.process, peerFeature.pointer(peer));
        assert.deepEqual(state.rows, expected.rows);
        assert.equal(state.dirty, 0);
        const pointer = peerFeature.pointer(peer);
        restored = await make();
        await restored.restore(structuredClone(fresh.snapshot()));
        const restoredFeature = await restored.getNativeFeature('databases');
        assert.equal(restoredFeature.pointer(peer), pointer);
        assert.deepEqual(databaseState(restored.nativeEngine.process, pointer), state);
        restored.main.machine.writeString('zeta', 1280);
        await call(restored, 0x367, [peer, 7, 1280]);
        assert.equal((await call(restored, 0x36d, [peer])).value, 1);
        assert.equal((await call(fresh, 0x36d, [peer])).value, 0);
        await call(restored, 0x366, [peer]);
        assert.equal(restored.nativeEngine.process.allocations.has(pointer), false);
      } finally {
        await restored?.close({ flushFiles: false });
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
}
