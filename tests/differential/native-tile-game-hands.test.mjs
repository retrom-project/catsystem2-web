// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  compareTileSequence,
  tileContext,
  tileRelease,
  tileHandBytes,
} from '../fixtures/tile-game-oracle.mjs';
import { TILE_SCORE_CASES } from '../fixtures/tile-hand-cases.mjs';
for (const fixture of await engineFixtureSet()) {
  test(
    fixture.profile + ' independent hand scores, fu, han, limits and pattern results',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const [cards, selfDraw, flags, melds] of TILE_SCORE_CASES) {
          await compareTileSequence(
            fixture.profile,
            engine,
            [
              tileContext,
              { id: 0x1ee, args: ['context', 0, 2048, 2052, 2056, 2060, 2064] },
              { id: 0x1d9, args: ['context'] },
              ...Array.from({ length: 16 }, (_, index) => ({
                id: 0x1ea,
                args: ['context', index, 2048, 2052],
              })),
              tileRelease,
            ],
            { hand: tileHandBytes(cards, selfDraw, flags, melds), fields: { next: 20050 } },
          );
        }
      } finally {
        await engine.close();
      }
    },
  );
}
