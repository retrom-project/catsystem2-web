// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { NATIVE_TILE_GAME_LAYOUTS } from '../src/native/tile-game.mjs';
import { prepareTileGame, tileGameEventReply } from './fixtures/tile-game-fixture.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    `${profile} tile contexts share the original model and resume its pending event in a fresh World`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        make = async () => {
          const game = memoryGame({
              'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
            }),
            configuration = new NativeConfiguration({ profile }),
            random = new ParticleRandom();
          const world = new NativeWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: {},
            motionLibrary: new MotionLibrary(game, { profile, random }),
            storage: { read: async () => null, write: async () => true },
          });
          // This authored rules client executes no title/plugin bootstrap.
          // It supplies the same reviewed process used by the World features.
          const engine = await NativeEngineProcess.open({ bytes, profile, configuration });
          new NativeGlobalStringsBridge(engine, world.globalStrings);
          world.nativeEngine = engine;
          world.nativeEngineLoading = Promise.resolve(engine);
          return world;
        },
        first = await make(),
        invoke = (world, id, args) =>
          world.runtime.native('main', id, args, world.main.machine, world.main),
        advance = async (world, handle, count) => {
          const events = [];
          for (let i = 0; i < count; i++) {
            const event = (await invoke(world, 0x1d9, [handle])).value;
            events.push(event);
            const response = tileGameEventReply(event);
            if (response) await invoke(world, response[0], [handle, ...response.slice(1)]);
          }
          return events;
        };
      let fresh;
      try {
        await first.initialize('main.kcs');
        const handle = (await invoke(first, 0x1d6, [])).value,
          peer = (await invoke(first, 0x1d6, [])).value,
          feature = await first.getNativeFeature('tile-game'),
          pointer = first.runtime.handles.get(handle, 'tile-game').pointer,
          peerPointer = first.runtime.handles.get(peer, 'tile-game').pointer,
          p = first.nativeEngine.process,
          layout = NATIVE_TILE_GAME_LAYOUTS[profile];
        assert.notEqual(pointer, peerPointer);
        assert.equal(p.load(pointer), p.load(peerPointer));
        const options = prepareTileGame(first.main.machine, 2);
        await invoke(first, 0x1d8, [handle, ...options]);
        assert.equal((await invoke(first, 0x1db, [peer])).value, 2);
        const events = await advance(first, handle, 170);
        assert.ok(events.includes(10003));
        assert.ok(events.includes(10004));
        assert.ok(events.some((event) => event >= 20001));
        const pending = (await invoke(first, 0x1d9, [handle])).value;
        await invoke(first, 0x1f5, [handle]);
        fresh = await make();
        await fresh.restore(structuredClone(first.snapshot()));
        assert.equal((await invoke(fresh, 0x1d9, [handle])).value, pending);
        assert.equal((await invoke(first, 0x1d9, [handle])).value, pending);
        assert.equal((await invoke(fresh, 0x1db, [peer])).value, 2);
        const expected = await advance(first, handle, 600),
          actual = await advance(fresh, handle, 600);
        assert.deepEqual(actual, expected);
        assert.ok(actual.includes(20047), 'the authored client reaches the end of a dealt hand');
        assert.deepEqual(
          fresh.nativeEngine.process.read(layout.model, 0x2700),
          p.read(layout.model, 0x2700),
        );
        assert.deepEqual(fresh.main.machine.memory, first.main.machine.memory);
        const wrong = fresh.runtime.handles.add('unrelated', {});
        await assert.rejects(() => invoke(fresh, 0x1db, [wrong]), /expected tile-game/);
        await assert.rejects(() => invoke(fresh, 0x1d8, [handle]), /expects 9/);
        await invoke(fresh, 0x1d7, [handle]);
        await assert.rejects(() => invoke(fresh, 0x1d9, [handle]), /released/);
        assert.equal((await invoke(fresh, 0x1db, [peer])).value, 2);
        await invoke(fresh, 0x1d7, [0]);
        assert.equal((await invoke(fresh, 0x1eb, [0, 0, 0])).value, 0xffffffff);
        assert.ok(
          feature.refs.contexts.has(pointer),
          'fresh destruction leaves the original context alive',
        );
        assert.equal(feature.refs.contexts.size, 2);
        await fresh.close({ flushFiles: false });
        assert.equal(fresh.nativeEngine.features.get('tile-game').refs.contexts.size, 0);
        assert.equal(fresh.nativeEngine.features.get('tile-game').refs.initialized, false);
        assert.ok(p.allocations.has(pointer));
      } finally {
        await first.close({ flushFiles: false });
        await fresh?.close({ flushFiles: false });
      }
    },
  );
}
