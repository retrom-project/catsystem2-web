// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { prepareTileGame, tileGameEventReply } from './fixtures/tile-game-fixture.mjs';

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} JS tile contexts share one model and restore independent event caches`, async () => {
    const first = await dataWorld(profile);
    let fresh;
    const invoke = async (world, id, args) =>
      world.runtime.native('main', id, args, world.main.machine, world.main);
    const advance = async (world, handle, count) => {
      const events = [];
      for (let index = 0; index < count; index++) {
        const event = (await invoke(world, 0x1d9, [handle])).value;
        events.push(event);
        const response = tileGameEventReply(event);
        if (response) await invoke(world, response[0], [handle, ...response.slice(1)]);
      }
      return events;
    };
    try {
      const handle = (await invoke(first, 0x1d6, [])).value,
        peer = (await invoke(first, 0x1d6, [])).value;
      assert.notEqual(handle, peer);
      assert.notEqual(
        first.runtime.handles.get(handle, 'tile-game'),
        first.runtime.handles.get(peer, 'tile-game'),
      );
      await invoke(first, 0x1d8, [handle, ...prepareTileGame(first.main.machine, 2)]);
      assert.equal((await invoke(first, 0x1db, [peer])).value, 2);
      const initial = await advance(first, handle, 170);
      assert.ok(initial.includes(10003) && initial.includes(10004));
      const pending = (await invoke(first, 0x1d9, [handle])).value;
      await invoke(first, 0x1f5, [handle]);
      const snapshot = structuredClone(first.snapshot());
      assert.equal(snapshot.nativeEngine, null);
      assert.equal(snapshot.tileGame.random.words.length, 624);
      assert.equal(
        snapshot.runtime.handles.records.filter(([, record]) => record.type === 'tile-game').length,
        2,
      );
      fresh = await dataWorld(profile, {}, { initialize: false });
      await fresh.restore(snapshot);
      assert.equal((await invoke(fresh, 0x1d9, [handle])).value, pending);
      assert.equal((await invoke(first, 0x1d9, [handle])).value, pending);
      assert.equal((await invoke(fresh, 0x1db, [peer])).value, 2);
      const expected = await advance(first, handle, 600),
        actual = await advance(fresh, handle, 600);
      assert.deepEqual(actual, expected);
      assert.ok(actual.includes(20047));
      assert.deepEqual(fresh.tileGame.snapshot(), first.tileGame.snapshot());
      assert.deepEqual(fresh.main.machine.memory, first.main.machine.memory);
      const wrong = fresh.runtime.handles.add('unrelated', {});
      await assert.rejects(() => invoke(fresh, 0x1db, [wrong]), /expected tile-game/);
      await assert.rejects(() => invoke(fresh, 0x1d8, [handle]), /expects 9/);
      await invoke(fresh, 0x1d7, [handle]);
      await assert.rejects(() => invoke(fresh, 0x1d9, [handle]), /released/);
      assert.equal((await invoke(fresh, 0x1db, [peer])).value, 2);
      await invoke(fresh, 0x1d7, [0]);
      assert.equal((await invoke(fresh, 0x1eb, [0, 0, 0])).value, 0xffffffff);
      assert.equal((await invoke(first, 0x1db, [handle])).value, 2);
      assert.equal(first.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await first.close();
      await fresh?.close();
    }
  });
}
