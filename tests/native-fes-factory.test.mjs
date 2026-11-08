// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

// Only map insertion is observed at the host boundary. Allocation selection,
// constructors, generated records and destruction execute original PE bytes.
for (const [profile, environment, abi] of [
  [
    'nekopara-vol3-engine-2.6.1.76',
    'CATSYSTEM2_ENGINE_EXE',
    {
      factory: 0x754b90,
      objectQuery: 0x755890,
      objectInsert: 0x7558d0,
      groupQuery: 0x5797b0,
      groupInsert: 0x5797f0,
    },
  ],
  [
    'sdk-4.01-engine-2.6.1.74',
    'CATSYSTEM2_SDK_EXE',
    {
      factory: 0x5f31f0,
      objectQuery: 0x5d9e00,
      objectInsert: 0x5da380,
      groupQuery: 0x444400,
      groupInsert: 0x511cc0,
    },
  ],
])
  test(
    `${profile} original factory creates VIEW as Base and declares NUMIMG without allocating an object`,
    { skip: !process.env[environment] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[environment])),
        }),
        p = engine.process,
        interpreter = p.allocate(8, true),
        node = p.allocate(64, true),
        objects = [],
        groups = [];
      engine.patch(
        abi.objectQuery,
        'authored object-map observation',
        1,
        ([record]) => {
          objects.push({
            name: p.string(record),
            index: p.load(record + 32),
            pointer: p.load(record + 36),
          });
          return node;
        },
        { calleePops: true },
      );
      engine.patch(
        abi.groupQuery,
        'authored group-map observation',
        1,
        ([record]) => {
          groups.push({
            name: p.string(p.load(record + 20) >= 16 ? p.load(record) : record),
            count: p.load(record + 24),
          });
          return node;
        },
        { calleePops: true },
      );
      for (const address of [abi.objectInsert, abi.groupInsert])
        engine.patch(address, `authored map insertion ${address.toString(16)}`, 4, ([out]) => out, {
          calleePops: true,
        });
      try {
        const sdk = profile.startsWith('sdk-'),
          cache = sdk ? 0xc967ec : 0xb91e54;
        p.store(cache, await engine.call(sdk ? 0x622ad0 : 0x78a9d0, [0, 0], cache));
        for (const type of [5, 28])
          for (const count of [0, 1, 3]) {
            objects.length = groups.length = 0;
            const text = count === 3 ? 'authored_long_group_name' : 'authored',
              bytes = encodeCP932(text + '\0'),
              name = p.allocate(bytes.length, true);
            p.write(name, bytes);
            try {
              assert.equal(await engine.call(abi.factory, [type, name, count, 0], interpreter), 1);
              assert.deepEqual(groups, [{ name: text, count }]);
              assert.equal(objects.length, type === 5 ? count : 0);
              for (const [index, object] of objects.entries()) {
                assert.equal(object.name, text);
                assert.equal(object.index, index);
                assert.equal(p.allocations.get(object.pointer), 44);
                assert.equal(p.load(object.pointer + 4), 0);
                await engine.call(p.load(p.load(object.pointer)), [1], object.pointer);
                assert.equal(p.allocations.has(object.pointer), false);
              }
            } finally {
              p.free(name);
            }
          }
      } finally {
        p.free(node);
        p.free(interpreter);
        await engine.close();
      }
    },
  );
