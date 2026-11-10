// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  contentDatabase,
  MISSION_COLUMNS,
  MISSION_ROWS,
} from '../fixtures/content-database-data.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';

const files = {
  empty: contentDatabase(
    MISSION_ROWS.map((row) => ({ ...row, CHAR: '' })),
    MISSION_COLUMNS,
  ),
};
const steps = [
  {
    id: 0x31b,
    args: [64],
    write: [[64, [...encodeCP932('empty'), 0]]],
    create: 'mission',
    type: 'content-database',
  },
  { id: 0x334, args: ['mission', 10, 9, 768] },
  { id: 0x334, args: ['mission', 10, 0, 772] },
  { id: 0x31c, args: ['mission'], release: 'mission' },
];
for (const fixture of await engineFixtureSet()) {
  test(
    fixture.profile + ' empty CHAR query writes a word and continues through the normal JS entry',
    async () => {
      const observations = await observeDataSequence(fixture.profile, steps, { files });
      assert.equal(observations[1].control, 1);
      assert.equal(observations[1].value, 1);
      assert.equal(new DataView(observations[1].memory.buffer).getUint32(768, true), 0);
      assert.equal(new DataView(observations[2].memory.buffer).getUint32(772, true), 1);
      assert.deepEqual(observations[3].handles, []);
    },
  );
  test(
    fixture.profile +
      ' original empty CHAR returns uninitialized sentinel contents without stopping',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        const actual = await observeDataSequence(fixture.profile, steps, { files });
        for (const pattern of [0, 0x12345678]) {
          const expected = await observeDataSequence(fixture.profile, steps, {
            engine,
            files,
            setup(world, oracle) {
              const p = oracle.process,
                allocate = p.allocate;
              // An empty MSVC set allocates a 20-byte sentinel. Its constructors
              // initialize links/color, leaving the payload at +16 untouched.
              p.allocate = function (size, zero = false) {
                const pointer = allocate.call(this, size, zero);
                if (size === 20 && !zero) this.store(pointer + 16, pattern);
                return pointer;
              };
              return () => {
                p.allocate = allocate;
              };
            },
          });
          assert.equal(new DataView(expected[1].memory.buffer).getUint32(768, true), pattern);
          for (let i = 1; i < expected.length; i++) {
            // Only this uninitialized payload is unspecified. Control, return,
            // every other VM byte, handles and the following query remain exact.
            new DataView(expected[i].memory.buffer).setUint32(768, 0, true);
          }
          assert.deepEqual(actual, expected);
        }
      } finally {
        await engine.close();
      }
    },
  );
}
