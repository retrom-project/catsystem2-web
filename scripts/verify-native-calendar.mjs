// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { nativeCalendar } from '../src/native/calendar.mjs';

const [filename, output, fixtureFile] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-calendar.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, v]) => v.sha256 === sha256)?.[0];
if (!profile) throw new Error('Calendar oracle requires a frozen image');
const engine = await NativeEngineProcess.open({ profile, bytes, standardLibraries: false }),
  p = engine.process,
  args = p.allocate(12),
  out = p.allocate(12),
  table = NATIVE_PROFILES[profile].tables.main.va,
  fn = p.load(table + 0x312 * 4),
  cases = [];
for (const y of [
  -2147483648, -2000, -401, -400, -101, -100, -4, -1, 0, 1, 4, 100, 400, 1601, 1900, 1970, 2000,
  2024, 2100, 2147483647,
])
  for (const m of [-2147483648, -13, -1, 0, 1, 2, 3, 6, 12, 13, 2147483647])
    for (const d of [-2147483648, -1, 0, 1, 28, 29, 31, 32, 2147483647]) cases.push([y, m, d]);
let seed = 0x3696ac71;
for (let i = 0; i < 3000; i++) {
  const row = [];
  for (let n = 0; n < 3; n++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    row.push(seed);
  }
  cases.push(row);
}
let passed = 0;
const golden = [];
try {
  for (const [index, row] of cases.entries()) {
    row.forEach((n, i) => p.store(args + i * 4, n));
    p.write(out, new Uint8Array(12).fill(0xa5));
    const control = await engine.call(fn, [0, 0, args, out + 4]),
      actual = nativeCalendar(0x312, row);
    assert.deepEqual(actual, { control, value: p.load(out + 4) }, JSON.stringify(row));
    passed++;
    if (
      index < 30 ||
      index % 113 === 0 ||
      ([1970, 2000, 2024].includes(row[0]) &&
        row[1] >= 1 &&
        row[1] <= 12 &&
        row[2] >= 1 &&
        row[2] <= 31)
    )
      golden.push({ args: row, result: p.load(out + 4) });
    assert.deepEqual(
      [...p.read(out, 4), ...p.read(out + 8, 4)],
      new Array(8).fill(0xa5),
      'output canaries',
    );
    passed++;
  }
  if (fixtureFile)
    await writeFile(
      fixtureFile,
      JSON.stringify({ profile, sha256, cases: golden }, null, 2) + '\n',
    );
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        operations: cases.length,
        passed,
        scope:
          'Complete main312 and original weekday helper/SSE2 conversions (standard library hooks disabled), signed wrap and remainder for full DWORD years/months/days, leap-century and invalid values, complete output canaries.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original calendar differential ${passed}/${passed} (${cases.length} operations)`);
} finally {
  await engine.close();
}
