// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeABI } from '../src/native/abi/index.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { prepareTileGame, tileGameEventReply } from './fixtures/tile-game-fixture.mjs';

const profile = 'bokutomo-engine-2.6.1.67';
const invoke = (world, id, args) =>
  world.runtime.native('main', id, args, world.main.machine, world.main);
const value = async (world, id, args) => (await invoke(world, id, args)).value;
const poll = (world, handle) => value(world, 473, [handle]);
async function command(world, handle, code, words) {
  words.forEach((word, index) => world.main.machine.store(512 + index * 4, word));
  return value(world, 505, [handle, code, words.length, 512]);
}
async function reply(world, handle, event) {
  const response = tileGameEventReply(event);
  if (response) await invoke(world, response[0], [handle, ...response.slice(1)]);
}
async function start(world, players) {
  const handle = await value(world, 470, []);
  await invoke(world, 472, [handle, ...prepareTileGame(world.main.machine, players)]);
  return handle;
}
async function list(world, handle, id, player) {
  const count = await value(world, id, [handle, player, 2048]);
  return Array.from({ length: count }, (_, index) => world.main.machine.load(2048 + index * 4));
}
async function arrange(world, handle, players, desired) {
  const records = [];
  for (let row = 0; row < 4; row++)
    records.push({ reference: row << 8, words: await list(world, handle, 477, row) });
  for (let player = 0; player < players; player++)
    records.push({
      reference: 0x20000 | (player << 8),
      words: await list(world, handle, 479, player),
    });
  const hand = records.find((record) => record.reference === 0x20000);
  assert.ok(hand.words.length >= desired.length);
  for (const [index, kind] of desired.entries()) {
    if (((hand.words[index] >>> 4) & 63) === kind) continue;
    let source;
    for (const record of records)
      for (const [at, word] of record.words.entries())
        if (
          !source &&
          !(record === hand && at <= index) &&
          !(word & 0x80000004) &&
          ((word >>> 4) & 63) === kind
        )
          source = { record, at };
    assert.ok(source, `Available tile kind ${kind}`);
    assert.equal(
      await command(world, handle, 10016, [0x20000 | index, source.record.reference | source.at]),
      1,
    );
    [hand.words[index], source.record.words[source.at]] = [
      source.record.words[source.at],
      hand.words[index],
    ];
  }
  assert.equal(await command(world, handle, 10017, []), 1);
}
async function open(t) {
  t.mock.method(Date, 'now', () => new Date(2026, 10, 25, 12, 34, 56).getTime());
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  return world;
}
async function cold(t, world) {
  const fresh = await dataWorld(profile, {}, { initialize: false });
  t.after(() => fresh.close({ flushFiles: false }));
  await fresh.restore(structuredClone(world.snapshot()));
  return fresh;
}

test('2.6.1.67 tile declarations retain own widths, controls and context ownership', () => {
  const entries = nativeABI(profile).tables.main.entries;
  for (let id = 470; id <= 513; id++) {
    const { status, signature } = entries[id];
    assert.equal(status, 'recovered');
    assert.equal(signature.review, 'reviewed');
    if (id === 470) assert.equal(signature.result.ownership, 'owned');
    else {
      assert.equal(signature.parameters[0].type.handleKind, 'tile-game');
      assert.equal(signature.parameters[0].type.ownership, id === 471 ? 'owned' : 'borrowed');
    }
  }
  assert.equal(entries[472].signature.argumentWords, 9);
  assert.deepEqual(entries[494].signature.controlCodes, [2]);
  assert.equal(entries[505].signature.argumentWords, 4);
  assert.equal(entries[505].signature.parameters[3].type.direction, 'in');
});

test('2.6.1.67 explicit human ability preserves the original ordinary event sequence', async (t) => {
  const world = await open(t),
    handle = await start(world, 2),
    expected = [
      10003, 10004, 20001, 20002, 20003, 20004, 20004, 20004, 20004, 20004, 20004, 20004, 20004,
      20005, 20006, 20009, 20010, 20019, 20042, 20043, 20017, 20018, 20007, 20008, 20046, 20013,
      20014, 20019, 20042, 20043, 20017, 20018, 20007, 20008, 20046, 20013, 20014, 20019, 20042,
      20043, 20017, 20018, 20007, 20008, 20046, 20013, 20014, 20019, 20042, 20043, 20017, 20018,
      20007, 20008, 20046, 20013, 20014, 20019, 20042, 20043, 20017, 20018, 20007, 20008, 20046,
      20013, 20014, 20019, 20042, 20043, 20017, 20018, 20007, 20008, 20021,
    ];
  let activated = false;
  for (const [index, event] of expected.entries()) {
    assert.equal(await poll(world, handle), event, `Original event ${index}`);
    if (event === 20043 && index > 30 && !activated) {
      assert.equal(await command(world, handle, 10010, [0, 3]), 1);
      activated = true;
    }
    await reply(world, handle, event);
  }
  assert.equal(activated, true);
});

test('2.6.1.67 public swaps reach scored results and resume nonempty result caches cold', async (t) => {
  const world = await open(t),
    handle = await start(world, 4),
    peer = await value(world, 470, []);
  let dealt = false;
  for (let index = 0; index < 60; index++) {
    const event = await poll(world, handle);
    if (event === 20010) {
      dealt = true;
      break;
    }
    await reply(world, handle, event);
  }
  assert.equal(dealt, true);
  await arrange(world, handle, 4, [0, 0, 0, 1, 2, 3, 16, 17, 18, 37, 38, 39, 52, 52]);
  assert.equal(await poll(world, handle), 20019);
  assert.equal(await poll(world, handle), 20020);
  assert.equal(await value(world, 497, [handle, 0]), 1);
  await invoke(world, 485, [handle, 0xffffffff]);
  const context = world.runtime.handles.get(handle, 'tile-game'),
    winning = context.choices.findIndex((action) => (action & 0xffff0000) === 0x20000000);
  assert.ok(winning >= 0);
  await invoke(world, 488, [handle, winning]);
  for (const event of [20026, 20029, 20049, 20050]) assert.equal(await poll(world, handle), event);
  assert.deepEqual(context.results, [0x1010e]);
  await invoke(world, 494, [handle, 0, 2048, 2052, 2056, 2060, 2064]);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => world.main.machine.load(2048 + index * 4)),
    [48000, 25, 0, 0, 1],
  );
  assert.equal(await value(world, 490, [handle, 0, 2048, 2052]), 1);
  assert.deepEqual([world.main.machine.load(2048), world.main.machine.load(2052)], [113, 1]);
  await invoke(world, 501, [handle]);
  const fresh = await cold(t, world);
  for (const item of [world, fresh]) {
    assert.equal(await poll(item, handle), 20050);
    assert.equal(await value(item, 490, [handle, 0, 2048, 2052]), 1);
    for (const event of [20061, 20051]) assert.equal(await poll(item, handle), event);
    [1200, -400, -400, -400].forEach((word, index) =>
      item.main.machine.store(544 + index * 4, word),
    );
    assert.equal(await value(item, 503, [handle, 544]), 1);
    assert.equal(await value(item, 502, [handle, 2048]), 1);
    assert.deepEqual(
      Array.from({ length: 4 }, (_, index) => item.main.machine.load(2048 + index * 4) | 0),
      [1200, -400, -400, -400],
    );
    assert.equal(await value(item, 475, [peer]), 4);
  }
  assert.deepEqual(fresh.tileGame.snapshot(), world.tileGame.snapshot());
});

test('2.6.1.67 historical menu and selected meld survive a cold checkpoint', async (t) => {
  const world = await open(t),
    handle = await start(world, 2);
  let armed = false,
    menu = false;
  for (let index = 0; index < 160; index++) {
    const event = await poll(world, handle);
    if (event === 20066) {
      menu = true;
      break;
    }
    if (event === 20043 && !armed) {
      const river = await list(world, handle, 478, 1);
      if (river.length) {
        const kind = (river[0] >>> 4) & 63;
        await arrange(world, handle, 2, [kind, kind]);
        assert.equal(await command(world, handle, 10010, [0, 3]), 1);
        armed = true;
      }
    }
    await reply(world, handle, event);
  }
  assert.equal(armed && menu, true);
  const context = world.runtime.handles.get(handle, 'tile-game');
  assert.ok(context.choices.length > 0);
  await invoke(world, 501, [handle]);
  const fresh = await cold(t, world);
  for (const item of [world, fresh]) {
    assert.equal(await poll(item, handle), 20066);
    assert.equal(await value(item, 506, [handle, 0]), context.choices[0]);
    assert.equal(await value(item, 507, [handle, context.choices[0]]), 1);
    assert.ok(await value(item, 509, [handle, context.choices[0], 0xffffffff]));
    assert.equal(await value(item, 510, [handle, 0, 0, 0x80000000]), 1);
    assert.equal(await value(item, 511, [handle, 0]), 1);
    assert.equal(await poll(item, handle), 20067);
    assert.equal(await poll(item, handle), 20068);
  }
  assert.deepEqual(fresh.tileGame.snapshot(), world.tileGame.snapshot());
  assert.deepEqual(fresh.main.machine.memory, world.main.machine.memory);
});
