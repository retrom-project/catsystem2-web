// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
import { SaveSlotFiles } from '../fixtures/save-slot-files.mjs';
const text = (value) => [...encodeCP932(value), 0];
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' independent raw filename and formatted line append',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const storage = new SaveSlotFiles(),
        original = new SaveSlotFiles(),
        engine = await NativeEngineProcess.open({
          profile: fixture.profile,
          bytes: fixture.bytes,
          ...original.options(),
        });
      const steps = [
        {
          id: 0x237,
          args: [64, 128],
          write: [
            [64, text('記録%d[G256].txt')],
            [128, text('前 %d[G256]')],
            [256, [19, 0, 0, 0]],
          ],
        },
        {
          id: 0x237,
          args: [64, 128],
          write: [
            [128, text('後 %s[G300]')],
            [300, text('日本語')],
          ],
        },
        { id: 0x237, args: [64, 128], write: [[128, text('')]] },
        {
          id: 0x237,
          args: [64, 128],
          write: [
            [64, text('readonly.txt')],
            [128, text('unchanged')],
          ],
        },
      ];
      for (const files of [storage, original]) {
        await files.write('readonly.txt', Uint8Array.of(1, 2, 3));
        await files.setAttributes('readonly.txt', 1);
        files.operations.length = 0;
      }
      try {
        const actual = await observeDataSequence(fixture.profile, steps, {
            storage,
            observe: () => storage.snapshot(),
          }),
          expected = await observeDataSequence(fixture.profile, steps, {
            engine,
            observe: () => original.snapshot(),
          });
        actual.forEach((value, index) => assert.deepEqual(value, expected[index], String(index)));
      } finally {
        await engine.close();
      }
    },
  );
