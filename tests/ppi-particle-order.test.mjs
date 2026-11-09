// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { initialParticle } from '../src/ppi/abi.mjs';
import { particleGeometry } from '../src/ppi/geometry.mjs';

const particles = (depths) =>
  depths.map((z, index) => ({
    ...initialParticle(8, 8),
    pos: [0, 0, z],
    disp: Number(index % 5 !== 3),
  }));
const order = (depths) =>
  particleGeometry(particles(depths), { width: 64, height: 64 }).map(({ index }) => index);

test('a hidden entry participates in the original particle depth partition', () => {
  assert.deepEqual(order([20, 20, 10, 1]), [2, 1, 0]);
  assert.deepEqual(order([0, 0, 0, 0]), [1, 2, 0]);
});

for (const [profile, fixture, sorter, comparator] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x7c80f0, 0x5f6cc0],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x868ad0, 0x4d1500],
])
  test(
    profile + ' original depth partition and draw order agree for ties and unordered floats',
    { skip: !process.env[fixture] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[fixture])),
          heapSize: 0x200000,
        }),
        p = engine.process,
        entries = p.allocate(256 * 8),
        table = p.allocate(256 * 4),
        inputs = [
          [],
          [0],
          [20, 20, 10, 1],
          [0, -0, NaN, -Infinity, 7, Infinity, NaN, 0, Infinity, -Infinity],
          Array(256).fill(3),
          Array(256).fill(NaN),
        ];
      let seed = 0x7f161a34;
      for (let size = 2; size <= 128; size++)
        inputs.push(
          Array.from({ length: size }, () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return ((seed >>> 27) & 15) - 8;
          }),
        );
      try {
        for (const depths of inputs) {
          const records = new DataView(new ArrayBuffer(depths.length * 8)),
            pointers = new DataView(new ArrayBuffer(depths.length * 4));
          for (const [index, depth] of depths.entries()) {
            records.setFloat32(index * 8, depth, true);
            records.setUint32(index * 8 + 4, index, true);
            pointers.setUint32(index * 4, entries + index * 8, true);
          }
          if (depths.length) {
            p.write(entries, new Uint8Array(records.buffer));
            p.write(table, new Uint8Array(pointers.buffer));
          }
          await engine.call(sorter, [table, 0, depths.length - 1, comparator]);
          const native = Array.from({ length: depths.length }, (_, i) =>
            p.load(p.load(table + 4 * i) + 4),
          ).filter((i) => i % 5 !== 3);
          assert.deepEqual(order(depths), native, 'input length ' + depths.length);
        }
      } finally {
        await engine.close();
      }
    },
  );
