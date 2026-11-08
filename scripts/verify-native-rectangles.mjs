// SPDX-License-Identifier: MPL-2.0
// Complete original RECT wrappers, pointer translation and image-size getter.
// USER32 is the existing shared platform boundary, independently Wine-tested.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NATIVE_RECTANGLE_CONTRACTS } from '../src/native/rectangles.mjs';
import { rectangleFixture, RECTANGLE_INPUTS } from '../tests/fixtures/rectangle-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-rectangles.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Rectangle oracle requires a frozen engine');
const raw = await rectangleFixture(bytes, profile),
  f = await rectangleFixture(bytes, profile),
  a = raw.machine,
  b = f.machine,
  block = a.allocate(1024),
  other = b.allocate(1024),
  specs = new Map(NATIVE_RECTANGLE_CONTRACTS.map((spec) => [spec.id, spec])),
  cases = new Map(),
  check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  };
let comparisons = 0,
  calls = 0;
check(block, other, 'same extended VM allocation');
for (const spec of NATIVE_RECTANGLE_CONTRACTS)
  check(
    raw.process.load(NATIVE_PROFILES[profile].tables.main.va + spec.id * 4),
    spec.handlers[Number(profile.startsWith('sdk-'))],
    'independently recovered frozen native slot',
  );
const put = (at, rect) => {
    for (const m of [a, b]) rect.forEach((value, i) => m.store(at + i * 4, value));
  },
  reset = () => {
    for (const m of [a, b]) {
      m.memory.fill(0xa5);
      m.shared.fill(0x5a);
      for (const bytes of m.blocks) bytes.fill(0x3c);
    }
  };
async function run(id, args) {
  const spec = specs.get(id),
    original = await raw.original(spec, args),
    reply = await f.feature.apply(id, args, b, { id: 1 }),
    value = new DataView(original.result.buffer).getUint32(4, true);
  check(
    reply,
    { control: original.control, ...(original.control === 1 ? { value } : {}) },
    'complete original control/result',
  );
  const expected = new Uint8Array(12).fill(0xcc);
  if (original.control === 1) new DataView(expected.buffer).setUint32(4, value, true);
  check(original.result, expected, 'native output and both canaries');
  check(b.memory, a.memory, 'whole VM data/stack');
  check(b.shared, a.shared, 'whole shared region');
  check(b.blocks, a.blocks, 'every extended VM block');
  calls++;
  cases.set(id, (cases.get(id) ?? 0) + 1);
}
try {
  for (const base of [0, 513, 4608, 0x80000020, block + 32]) {
    for (const rect of RECTANGLE_INPUTS) {
      reset();
      put(base, rect);
      await run(0xd9, [base]);
      await run(0xd6, [base]);
      await run(0xd9, [base]);
      for (const right of RECTANGLE_INPUTS) {
        reset();
        put(base, rect);
        put(base + 32, right);
        await run(0xd7, [base, base + 32]);
        reset();
        put(base, rect);
        await run(0xda, [base, ...right]);
      }
    }
    for (const shift of [0, 1, 4, 8, 12]) {
      reset();
      put(base, [-9, -7, 23, 30]);
      put(base + shift, [-4, -3, 50, 60]);
      await run(0xd7, [base, base + shift]);
    }
    for (const [width, height, empty] of [
      [7, 9, false],
      [0, 9, false],
      [-1, 9, false],
      [0x80000000, 0x7fffffff, false],
      [0xffffffff, 0xffffffff, false],
      [17, 19, true],
    ]) {
      raw.bitmap(17, width, height, { empty });
      f.bitmap(17, width, height, { empty });
      const beforeA = raw.process.read(raw.bitmaps.get(17).bitmap, 92),
        beforeB = f.process.read(f.bitmaps.get(17).bitmap, 92);
      for (const rect of RECTANGLE_INPUTS)
        for (const [x, y] of [
          [0, 0],
          [-11, -13],
          [0x7ffffffe, 0x7fffffff],
          [0x80000000, 0x80000001],
        ]) {
          reset();
          put(base, rect);
          await run(0xd8, [base, 17, x, y]);
          reset();
          put(base, rect);
          await run(0xd8, [base, 0, x, y]);
        }
      check(
        raw.process.read(raw.bitmaps.get(17).bitmap, 92),
        beforeA,
        'original size read leaves image metadata unchanged',
      );
      check(
        f.process.read(f.bitmaps.get(17).bitmap, 92),
        beforeB,
        'adapter size read leaves image metadata unchanged',
      );
    }
  }
  for (const spec of NATIVE_RECTANGLE_CONTRACTS) {
    reset();
    put(512, [-4, -5, 20, 30]);
    put(544, [-10, -3, 40, 17]);
    const words =
      spec.id === 0xd7
        ? [512, 544]
        : spec.id === 0xd8
          ? [512, 17, -13, 17]
          : spec.id === 0xda
            ? [512, -5, 0, 10, 10]
            : [512];
    for (const m of [a, b]) {
      m.nativeArgumentBase = 2048;
      words.forEach((word, i) => m.store(2048 + 4 * i, word));
    }
    await run(spec.id, []);
  }
  // Rectangles can overlap the VM's argument storage. The original wrapper
  // copies its inputs before committing the destination.
  for (const id of [0xd6, 0xd7, 0xda]) {
    reset();
    const words = id === 0xd7 ? [2052, 2068] : id === 0xda ? [2052, -10, -20, 100, 200] : [2048];
    for (const m of [a, b]) {
      m.nativeArgumentBase = 2048;
      words.forEach((word, i) => m.store(2048 + i * 4, word));
    }
    await run(id, []);
  }
  const report = {
    profile,
    sha256,
    calls,
    comparisons,
    cases: [...cases],
    boundary:
      'Shared USER32 rectangles, independently checked using authored Wine cases; authored bitmap width/height records',
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Rectangles passed ${calls} complete original calls/${comparisons} comparisons`);
} finally {
  await f.engine.close();
  await raw.engine.close();
}
