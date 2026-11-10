// SPDX-License-Identifier: MPL-2.0
// Authored hand/round inputs. These records seed the independent native model
// and JS model before execution. Observations use the actual native table.
import assert from 'node:assert/strict';
import { NativeKCSMemory } from '../../src/native/kcs-memory.mjs';
import { NATIVE_EXE_PROFILES } from '../../src/native/catalog.mjs';
import { NATIVE_TILE_GAME_LAYOUTS } from '../../oracle/tile-game.mjs';
import { observeDataSequence } from './data-sequence.mjs';
export function tileCards(text) {
  const result = [];
  for (const match of text.matchAll(/(\d+)([mpsz])/g)) {
    const suit = 'mpsz'.indexOf(match[2]);
    for (const number of match[1]) result.push((suit << 8) | ((Number(number) - 1) << 4));
  }
  return result;
}
export function tileHandBytes(source, selfDraw, flags = [], melds = []) {
  const cards = tileCards(source),
    bytes = new Uint8Array(476),
    view = new DataView(bytes.buffer);
  melds.forEach(({ count, flags }, index) => {
    const set = cards.splice(0, 3),
      at = 72 + 24 * index;
    if (count === 4) set.push(set[0]);
    set.forEach((tile, i) => view.setUint32(at + 4 * i, tile, true));
    view.setUint32(at + 16, set.length, true);
    view.setUint32(at + 20, flags, true);
  });
  view.setUint32(192, melds.length, true);
  cards.forEach((tile, index) => view.setUint32(index * 4, tile, true));
  view.setUint32(64, cards.at(-1), true);
  view.setUint32(68, cards.length, true);
  bytes[434] = Number(selfDraw);
  for (const flag of flags) bytes[flag] = 1;
  return bytes;
}
const seedFields = {
  remaining: 8444,
  doraCount: 8452,
  next: 8532,
  current: 8412,
  discardChoice: 8516,
  wallCursor: 8436,
  replacementCursor: 8440,
  pendingDora: 8460,
  kans: 8464,
  kanMask: 8468,
  robbedTile: 8472,
};
export async function compareTileSequence(
  profile,
  engine,
  steps,
  { hand, fields = {}, discarded, historical = false } = {},
) {
  const setup = async (world, oracle) => {
    // This authored hand client uses a 1 KiB shared VM segment. Copy all of it
    // after every operation without retaining a 1 MiB unused bank per sample.
    world.main.machine.shared = new Uint8Array(1024);
    const values = {
      current: 0,
      discardChoice: 0,
      remaining: 70,
      doraCount: 0,
      wallCursor: 0,
      replacementCursor: 0,
      pendingDora: 0,
      kans: 0,
      kanMask: 0,
      robbedTile: -1,
      ...fields,
    };
    if (oracle) {
      await oracle.call(NATIVE_TILE_GAME_LAYOUTS[profile].initialize);
      const base = NATIVE_TILE_GAME_LAYOUTS[profile].model,
        p = oracle.process;
      const bridge = new NativeKCSMemory(p, world.main.machine),
        argv = p.allocate(36),
        out = p.allocate(4),
        table = NATIVE_EXE_PROFILES[profile].tables.main.va;
      const raw = async (id, values) => {
        values.forEach((value, index) => p.store(argv + 4 * index, value));
        await oracle.call(p.load(table + 4 * id), [bridge.pointer, 0, argv, out]);
        return p.load(out);
      };
      try {
        const context = await raw(0x1d6, []);
        await raw(0x1d8, [context, 4, 2, 0, 1, 2, 1, 512, 544]);
        await raw(0x1d9, [context]);
        await raw(0x1d7, [context]);
      } finally {
        bridge.close();
        p.free(argv);
        p.free(out);
      }

      if (hand) p.write(base + 1632, hand);
      for (const [name, value] of Object.entries(values)) p.store(base + seedFields[name], value);
      if (discarded) {
        const { player, tile } = discarded;
        if (historical) {
          p.write(base + 1104 + 132 * player, new Uint8Array(132));
          p.store(base + 1104 + 132 * player, tile);
          p.store(base + 1232 + 132 * player, 1);
        } else {
          p.write(base + 1632 + 476 * player, new Uint8Array(476));
          p.store(base + 1632 + 476 * player, tile);
          p.store(base + 1700 + 476 * player, 1);
        }
      }
      // A bounded authored wall makes the draw/replacement event continuations
      // valid for isolated hand cases. It is independent of shuffle evidence.
      for (let row = 0; row < 4; row++) {
        p.write(base + 544 + row * 140, new Uint8Array(140));
        p.store(base + 680 + row * 140, 34);
      }
      for (let index = 0; index < 68; index++) p.store(base + 3536 + index * 4, 2 * index + 1);
    } else {
      const model = world.tileGame.model;
      model.start();
      model.shuffle();
      if (hand) model.hand(0).set(new Int32Array(hand.buffer));
      for (const [name, value] of Object.entries(values)) model.set(name, value);
      if (discarded) {
        const { player, tile } = discarded;
        if (historical) {
          model.river(player)[0] = tile;
          model.river(player)[32] = 1;
        } else {
          model.hand(player).fill(0);
          model.hand(player)[0] = tile;
          model.hand(player)[17] = 1;
        }
      }
      for (let row = 0; row < 4; row++) {
        model.wall(row).fill(0);
        model.wall(row)[34] = 34;
      }
      for (let index = 0; index < 68; index++) model.words[884 + index] = 2 * index + 1;
    }
  };
  const expected = await observeDataSequence(profile, steps, { engine, setup }),
    actual = await observeDataSequence(profile, steps, { setup });
  actual.forEach((result, index) =>
    assert.deepEqual(
      result,
      expected[index],
      `step ${index} native ${steps[index].id.toString(16)} ${steps[index].args}`,
    ),
  );
}
export const tileContext = { id: 0x1d6, args: [], create: 'context', type: 'tile-game' };
export const tileRelease = { id: 0x1d7, args: ['context'], release: 'context' };
export function tileEvents(count, words = 14) {
  return Array.from({ length: count }, () => [
    { id: 0x1d9, args: ['context'] },
    { id: 0x1e1, args: ['context'] },
    ...Array.from({ length: words }, (_, index) => ({ id: 0x1e0, args: ['context', index] })),
  ]).flat();
}
export function tileActionQueries(masks, selector = 'own') {
  const steps = [];
  for (const mask of masks) {
    steps.push({
      id: selector === 'own' ? 0x1e5 : 0x1fd,
      args: selector === 'own' ? ['context', mask] : ['context', selector, mask],
    });
    for (let index = 0; index < 5; index++) {
      if (selector === 'own')
        steps.push(
          { id: 0x1fa, args: ['context', index] },
          { id: 0x1e6, args: ['context', index, 2048] },
          { id: 0x1e7, args: ['context', mask, index, 2048] },
        );
      else steps.push({ id: 0x1fe, args: ['context', 0, index, 2048] });
    }
  }
  return steps;
}
