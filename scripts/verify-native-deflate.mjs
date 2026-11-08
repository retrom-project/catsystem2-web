// SPDX-License-Identifier: MPL-2.0
// Execute the original level-9 encoder without substituting its zlib/CRT.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { nativeDeflate } from '../src/native/zlib.mjs';
import { authoredDeflateBytes, authoredDeflateCases } from '../tests/fixtures/deflate-fixture.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-deflate.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (p) => NATIVE_ENGINE_IMAGES[p].sha256 === sha256,
  );
if (!profile) throw new Error('Deflate oracle requires a frozen engine');
const engine = await NativeEngineProcess.open({ profile, bytes, standardLibraries: false }),
  p = engine.process,
  address = NATIVE_ENGINE_IMAGES[profile].zlib - 0x190,
  cases = [];
let passed = 0;
try {
  for (const row of authoredDeflateCases()) {
    const source = authoredDeflateBytes(row.length, row.pattern),
      input = p.allocate(source.length + 16),
      out = p.allocate(row.capacity + 16),
      guard = new Uint8Array(row.capacity + 16).fill(row.fill);
    try {
      p.write(input, new Uint8Array(source.length + 16).fill(0xa5));
      p.write(input + 8, source);
      p.write(out, guard);
      const result = await engine.call(address, [out + 8, row.capacity, input + 8, source.length]),
        actual = await nativeDeflate(source, guard.subarray(8, -8)),
        expected = p.read(out, row.capacity + 16),
        model = guard.slice();
      model.set(actual.bytes, 8);
      assert.equal(actual.result, result, JSON.stringify(row));
      passed++;
      assert.deepEqual(model, expected);
      passed++;
      assert.deepEqual(p.read(input + 8, source.length), source);
      passed++;
      cases.push({
        ...row,
        result,
        sha256: createHash('sha256').update(expected.subarray(8, -8)).digest('hex'),
      });
    } finally {
      p.free(input);
      p.free(out);
    }
  }
  await writeFile(output, JSON.stringify({ profile, sha256, passed, cases }, null, 2) + '\n');
  console.log(`Original zlib1.2.3 level9 deflate ${passed}/${passed} (${cases.length} cases)`);
} finally {
  await engine.close();
}
