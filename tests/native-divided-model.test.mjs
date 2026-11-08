// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  clipNativeTriangle,
  divideNativeTriangles,
  nativeDivisionLayout,
} from '../src/native/divided-model.mjs';
import { decodeNativeMesh } from '../src/native/mesh.mjs';

test('source clipping, source position and page UVs match both original engine profiles', async () => {
  const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-divided-model-golden.json', import.meta.url)),
  );
  const bytes = (row) => Uint8Array.from(Buffer.from(row.expected, 'base64'));
  for (const row of golden.clip) {
    const values = new Float32Array(bytes(row).buffer),
      expected = Array.from({ length: values.length / 2 }, (_, i) => ({
        x: values[i * 2],
        y: values[i * 2 + 1],
      }));
    assert.deepEqual(clipNativeTriangle(row.triangle, row.rectangle), expected);
  }
  for (const row of golden.division)
    assert.deepEqual(
      divideNativeTriangles(row.triangles, row.layout, row.position),
      decodeNativeMesh(bytes(row)),
    );
});

test('graph division uses independent device guard bands and configured page dimensions', () => {
  assert.deepEqual(nativeDivisionLayout([512, 256], [2, 3]), {
    pageSize: [512, 256],
    cellSize: [256, 128],
    cells: [4, 6],
  });
  assert.deepEqual(nativeDivisionLayout([512, 256], [2, 3], [-2, -2, 2, 2]), {
    pageSize: [512, 256],
    cellSize: [512, 256],
    cells: [2, 3],
  });
  assert.deepEqual(nativeDivisionLayout([3, 5], [2, 3]), {
    pageSize: [3, 5],
    cellSize: [1, 2],
    cells: [6, 6],
  });
});
