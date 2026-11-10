// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  compareTileSequence,
  tileContext,
  tileRelease,
  tileHandBytes,
  tileActionQueries,
  tileEvents,
} from '../fixtures/tile-game-oracle.mjs';
for (const fixture of await engineFixtureSet()) {
  const options = { skip: fixture.available ? false : fixture.reason };
  test(
    fixture.profile + ' independent own hand choices and command-state continuations',
    options,
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const [cards, flags] of [
          ['1111m234m567p789s1z', []],
          ['123m123p123s456s22p', []],
          ['112233m445566p77s', []],
          ['123m123p123s456s22p', [432, 433, 436]],
          ['1111m234m567p789s1z', [432]],
          ['234m456p789s222m55z', []],
          ['1111m234m567p789s1z', [435]],
        ]) {
          await compareTileSequence(
            fixture.profile,
            engine,
            [
              tileContext,
              ...tileEvents(1, 0),
              { id: 0x1e4, args: ['context'] },
              ...tileActionQueries([0x1a0000, 0x1000000, 0x20000000, 0xffffffff]),
              { id: 0x1e8, args: ['context', 0] },
              ...tileEvents(8),
              tileRelease,
            ],
            { hand: tileHandBytes(cards, true, flags), fields: { next: 20020 } },
          );
        }
      } finally {
        await engine.close();
      }
    },
  );
  test(
    fixture.profile + ' independent response and historical discard choice lists',
    options,
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const player of [1, 3])
          for (const [cards, flags, tile] of [
            ['12m123p123s789s11z', [], 0x20],
            ['11m123p123s789s11z', [], 0],
            ['111m123p123s789s1z', [], 0],
            ['123m123p123s456s2p', [], 0x110],
            ['123m123p123s456s2p', [438], 0x110],
            ['123m123p123s456s2p', [432], 0x110],
            ['123m123p123s456s2p', [444], 0x110],
            ['19m19p19s1234567z', [], 0],
          ]) {
            const hand = tileHandBytes(cards, false, flags),
              masks = [0x10000, 0x20000, 0x40000, 0x10000000, 0xffffffff];
            await compareTileSequence(
              fixture.profile,
              engine,
              [
                tileContext,
                ...tileEvents(1, 0),
                { id: 0x1e4, args: ['context'] },
                ...tileActionQueries(masks),
                tileRelease,
              ],
              {
                hand,
                fields: { next: 20018, current: player, discardChoice: 0 },
                discarded: { player, tile },
              },
            );
            hand[454] = 1;
            await compareTileSequence(
              fixture.profile,
              engine,
              [
                tileContext,
                ...tileEvents(1, 0),
                { id: 0x1fc, args: ['context'] },
                ...tileActionQueries(masks, player << 6),
                { id: 0x1fb, args: ['context', player << 6] },
                { id: 0x1ff, args: ['context', 0] },
                ...tileEvents(3, 12),
                tileRelease,
              ],
              {
                hand,
                historical: true,
                fields: { next: 20066, current: 0 },
                discarded: { player, tile },
              },
            );
          }
      } finally {
        await engine.close();
      }
    },
  );
}
