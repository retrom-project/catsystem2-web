// SPDX-License-Identifier: MPL-2.0
// Original image-data wrappers and heap/buffer helpers execute without their
// startup entry point. Only KCS formatting, resource routing and mounted file
// reads cross into authored host services.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_DATA_BUFFER_LAYOUTS } from '../oracle/data-buffer.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  dataBufferCases,
  dataBufferPayload,
  dataBufferState,
  runDataBufferCase,
} from '../tests/fixtures/data-buffer-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!filename || !output)
  throw new Error('Usage: node scripts/verify-native-data-buffer.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await fs.readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Native data-buffer probe requires a frozen engine image');
const sdk = profile.startsWith('sdk-'),
  layout = NATIVE_DATA_BUFFER_LAYOUTS[profile],
  engine = await NativeEngineProcess.open({
    profile,
    bytes,
    standardLibraries: false,
    trace: true,
  }),
  p = engine.process,
  functions = sdk
    ? { format: 0x8a6510, path: 0x4b0830, file: 0x4b1ca0, diagnostic: 0x4a82f0 }
    : { format: 0x876ea0, path: 0x5d39e0, file: 0x5d5160, diagnostic: 0x5cac90 },
  outputWord = p.allocate(4, true),
  parameters = p.allocate(4, true),
  results = [];
let current,
  reads = 0,
  routes = [];
const free = p.free.bind(p);
p.frees = [];
p.free = (address) => {
  p.frees.push(address);
  return free(address);
};
engine.patch(
  functions.format,
  'data-buffer KCS format boundary',
  2,
  ([, out]) => {
    p.write(out, encodeCP932(`${current.name}\0`));
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  functions.path,
  'data-buffer image resource boundary',
  3,
  ([out, name, category]) => {
    routes.push([p.string(name), p.string(category)]);
    p.write(out, p.stringBytes(name));
    p.zero(out + p.stringBytes(name).length, 1);
    return out;
  },
  { calleePops: true },
);
engine.patch(
  functions.file,
  'data-buffer mounted file boundary',
  3,
  ([name, out, flags]) => {
    if (flags !== 3) throw new Error('Native data-buffer read changed its archive flags');
    if (p.string(name, !sdk) !== current.name)
      throw new Error('Native data-buffer filename conversion differed');
    reads++;
    const size =
        current.size < 0 ? 0 : Math.max(0, current.size - Number(Boolean(current.short && out))),
      source = dataBufferPayload(size);
    if (out) p.write(out, source);
    return size;
  },
  { calleePops: true },
);
engine.patch(functions.diagnostic, 'data-buffer diagnostic boundary', 0, () => 0);

for (const testCase of dataBufferCases()) {
  current = testCase;
  reads = 0;
  routes = [];
  p.frees = [];
  let actual,
    pointer = 0,
    data = 0;
  if (current.operation === 'load') {
    p.store(parameters, 1);
    p.store(outputWord, 0xa5a55a5a);
    const control = await engine.call(layout.load, [0, 0, parameters, outputWord]);
    pointer = p.load(outputWord);
    if (control !== 1) throw new Error('Original data-buffer loader changed its control code');
    if (JSON.stringify(routes) !== JSON.stringify([[current.name, 'image']]))
      throw new Error('Original data-buffer loader changed its resource category');
    if (pointer) data = p.load(pointer);
    actual = pointer
      ? { reads, result: 1, state: dataBufferState(p, pointer, data) }
      : { reads, result: 0 };
  } else {
    data = await engine.call(layout.heapAllocate, [0, 17]);
    p.write(data, dataBufferPayload(17));
    pointer = p.allocate(20, true);
    [data, 17, 17, 1, current.borrowed].forEach((value, i) => p.store(pointer + i * 4, value));
    if (current.operation === 'release') {
      p.store(pointer + 12, current.references);
      p.store(data - 4, current.innerReferences);
      if (current.nullData) p.store(pointer, 0);
      p.store(parameters, pointer);
      const control = await engine.call(layout.release, [0, 0, parameters, outputWord]);
      if (control !== 2) throw new Error('Original data-buffer release changed its control code');
    } else await engine.call(layout.allocate, [current.size], pointer);
    actual = dataBufferState(p, pointer, data);
    if (current.operation === 'allocate') delete actual.bytes;
  }
  const expected = await runDataBufferCase(profile, current),
    equal = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ case: current, actual, expected, equal });
  if (!equal) console.error(JSON.stringify(results.at(-1)));
  // A probe can deliberately leave multiple raw references or borrowed data.
  // Tear down only allocations still present after capturing the real result.
  if (pointer && p.allocations.has(pointer)) {
    const stored = p.load(pointer);
    if (stored && p.allocations.has(stored - 4)) p.free(stored - 4);
    p.free(pointer);
  }
  if (data && p.allocations.has(data - 4)) p.free(data - 4);
}
const report = {
  profile,
  sha256,
  original: layout,
  boundaries: [
    'KCS formatter',
    'image category path resolution',
    'mounted file reads',
    'diagnostics',
    'CRT/Win32 heap services',
  ],
  total: results.length,
  passed: results.filter((entry) => entry.equal).length,
  results,
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--golden')) {
  const target = new URL('../tests/fixtures/data-buffer-golden.json', import.meta.url);
  await fs.writeFile(
    target,
    JSON.stringify(
      {
        source: { profile, sha256 },
        cases: results.map(({ case: testCase, actual: result }) => ({ case: testCase, result })),
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(JSON.stringify({ profile, total: report.total, passed: report.passed }));
await engine.close();
if (report.passed !== report.total) process.exitCode = 1;
