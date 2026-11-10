// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { imageFileFixture } from '../fixtures/image-file-fixture.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS ANM presence and table aliases equal the independent original',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const files = {
          'empty.anm': new Uint8Array(),
          'broken.anm': Uint8Array.of(1),
          'fallback.anm': new Uint8Array(),
          'anmtable.csv': new Uint8Array(),
        },
        world = await dataWorld(fixture.profile, files),
        oracle = await imageFileFixture(fixture.bytes, fixture.profile);
      for (const [name, bytes] of Object.entries(files)) oracle.files.set(name, bytes);
      oracle.machine.memory.set(world.main.machine.memory);
      try {
        for (const table of [
          'source\tfallback\r\nsource\tmissing\r\n',
          'source\tmissing\r\nsource\tfallback\r\n',
          'SOURCE\tfallback\r\n',
          'source\t"fallback"junk\r\n',
          'source\t\r\n',
          'source\t""\r\n',
        ]) {
          const bytes = encodeCP932(table);
          world.imageFiles.loadTable(bytes);
          await oracle.table(table);
          for (const name of [
            '',
            'empty.hg3',
            'broken.bmp',
            'source.hg3',
            'DIR/SOURCE.HG3',
            'source,1,0.hg3',
            'missing.hg3',
          ]) {
            world.main.machine.writeString(name, 256);
            oracle.machine.writeString(name, 256);
            const a = await world.runtime.native(
                'main',
                0x1ae,
                [256],
                world.main.machine,
                world.main,
              ),
              b = await oracle.feature.apply(0x1ae, [256], oracle.machine, world.main);
            assert.deepEqual(a, b, table + ' ' + name);
            assert.deepEqual(world.main.machine.memory, oracle.machine.memory);
          }
        }
        assert.equal(world.nativeEngine, undefined);
        const fresh = await dataWorld(fixture.profile, {}, { initialize: false });
        try {
          await fresh.restore(structuredClone(world.snapshot()));
          assert.deepEqual(fresh.imageFiles.snapshot(), world.imageFiles.snapshot());
        } finally {
          await fresh.close();
        }
      } finally {
        await world.close();
        await oracle.close();
      }
    },
  );
