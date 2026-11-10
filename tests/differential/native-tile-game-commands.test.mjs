// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { compareTileSequence } from '../fixtures/tile-game-oracle.mjs';
const words = (values) => [...new Uint8Array(new Int32Array(values).buffer)];
for (const fixture of await engineFixtureSet()) {
  test(
    fixture.profile + ' independent all eight deal policies at representative strengths',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        const steps = [{ id: 0x1d6, args: [], create: 'context', type: 'tile-game' }];
        for (let policy = 0; policy < 8; policy++)
          for (const power of [1, 5]) {
            steps.push({
              id: 0x1d8,
              args: ['context', 4, 2, 0, 1, 2, 1, 512, 544],
              write: [[512, new Array(64).fill(0)]],
            });
            steps.push(
              { id: 0x1d9, args: ['context'] },
              { id: 0x1d9, args: ['context'] },
              { id: 0x1e3, args: ['context', 1, 2] },
              { id: 0x1d9, args: ['context'] },
            );
            steps.push({ id: 0x1e9, args: ['context', 0, policy, power] });
            for (const player of [0, 1, 2, 3])
              steps.push({ id: 0x1dd, args: ['context', player, 2048] });
          }
        steps.push({ id: 0x1d7, args: ['context'], release: 'context' });

        await compareTileSequence(fixture.profile, engine, steps);
      } finally {
        await engine.close();
      }
    },
  );
}
for (const fixture of await engineFixtureSet()) {
  test(
    fixture.profile + ' independent special abilities, command gates and packed reference swaps',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        const steps = [
          { id: 0x1d6, args: [], create: 'context', type: 'tile-game' },
          {
            id: 0x1d8,
            args: ['context', 2, 2, 0, 1, 2, 1, 512, 544],
            write: [[512, new Array(64).fill(0)]],
          },
        ];
        for (const values of [
          [0, 0],
          [0, 1],
          [0, 2],
          [0, 3],
          [0, 4],
          [0, 5],
          [0, 6],
          [0, 7],
          [1, 0],
          [1, 6],
          [1, 7],
          [2, 7],
          [-1, 0],
          [0, 8],
          [0, -1],
        ])
          steps.push({
            id: 0x1f9,
            args: ['context', 10010, 2, 512],
            write: [[512, words(values)]],
          });
        for (const values of [[], [0], [1], [2], [-1], [3]])
          steps.push({
            id: 0x1f9,
            args: ['context', 10011, values.length, 512],
            write: [[512, words(values)]],
          });
        for (const code of [
          10005, 10007, 10008, 10009, 10012, 10013, 10014, 10015, 10016, 10017, 19999,
        ])
          steps.push({ id: 0x1f9, args: ['context', code, 0, 512] });
        steps.push(
          { id: 0x1d9, args: ['context'] },
          { id: 0x1d9, args: ['context'] },
          { id: 0x1e3, args: ['context', 3, 6] },
        );
        for (const pair of [
          [0, 1],
          [0x100, 0x221],
          [0x20000, 0x20100],
          [0x10000, 0x10001],
          [0x40000, 0],
          [-1, 0],
        ])
          steps.push({ id: 0x1f9, args: ['context', 10016, 2, 512], write: [[512, words(pair)]] });
        for (let row = 0; row < 4; row++) steps.push({ id: 0x1dd, args: ['context', row, 2048] });
        for (let event = 0; event < 22; event++) {
          steps.push({ id: 0x1d9, args: ['context'] }, { id: 0x1e1, args: ['context'] });
          for (let index = 0; index < 3; index++)
            steps.push({ id: 0x1e0, args: ['context', index] });
        }
        steps.push(
          { id: 0x1ef, args: ['context', 0] },
          { id: 0x1ef, args: ['context', 1] },
          { id: 0x1f4, args: ['context'] },
          { id: 0x1d7, args: ['context'], release: 'context' },
        );

        await compareTileSequence(fixture.profile, engine, steps);
      } finally {
        await engine.close();
      }
    },
  );
}
