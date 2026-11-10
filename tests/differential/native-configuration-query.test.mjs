// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  configurationQueryState,
  authorOriginalQueryInputs,
} from '../fixtures/configuration-query-fixture.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
const text = (value) => [...encodeCP932(value), 0];
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent legacy/configuration query sequences`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      for (const seed of [0, 1, 2, 4, 8])
        await t.test(`configuration seed ${seed}`, async () => {
          const state = configurationQueryState(fixture.profile, seed);
          state.configuration.queryWords.set([0x12345678, 0x80000000]);
          const engine = await NativeEngineProcess.open({
              profile: fixture.profile,
              bytes: fixture.bytes,
              configuration: state.configuration,
            }),
            setup = async (world, oracle) => {
              world.configuration.restore(state.configuration.snapshot());
              world.soundConfiguration.restore(state.soundConfiguration.snapshot());
              world.game.nativeResources = state.game.nativeResources;
              if (oracle) return authorOriginalQueryInputs(oracle, state);
            },
            steps = [
              { id: 0x24d, args: [0, 4], write: [[0, new Array(12).fill(0xa5)]] },
              { id: 0x24d, args: [0, 0] },
              ...[
                'bg001.ogg',
                'SE001.ogg',
                'voice_1.ogg',
                'system_1.ogg',
                'pcm.int\\unrelated.ogg',
                'unknown\\voice_1.ogg',
                '日本語_1.ogg',
                'missing',
              ].flatMap((name) =>
                [0x25d, 0x25e, 0x25f, 0x34c].map((id) => ({
                  id,
                  args: [64],
                  write: [[64, text(name)]],
                })),
              ),
              ...['image', 'sound', 'SOUND', '', '日本語', 'missing'].map((category) => ({
                id: 0x2a2,
                args: [64, 256],
                write: [
                  [64, text('voice_child_1.ogg')],
                  [256, text(category)],
                ],
              })),
            ];
          try {
            const actual = await observeDataSequence(fixture.profile, steps, { setup }),
              expected = await observeDataSequence(fixture.profile, steps, { setup, engine });
            actual.forEach((value, i) =>
              assert.deepEqual(
                value,
                expected[i],
                `${seed}/${i} native ${steps[i].id.toString(16)}`,
              ),
            );
          } finally {
            await engine.close();
          }
        });
    },
  );
