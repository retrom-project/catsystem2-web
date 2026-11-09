// SPDX-License-Identifier: MPL-2.0
// Independently invoke the original 2BF/2C0/2C2 wrappers on authored RAM.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  renderSourceFixture,
  RENDER_SOURCE_MANIFEST,
} from '../tests/fixtures/render-sources-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-render-sources.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('Render-source oracle requires a frozen engine');

const raw = await renderSourceFixture(bytes, profile),
  adapted = await renderSourceFixture(bytes, profile),
  a = raw.machine,
  b = adapted.machine,
  p = raw.process,
  q = adapted.process,
  { stride, wrapperBytes, retainedBytes, retainedRetain } = raw.layout,
  block = a.allocate(2048),
  blockB = b.allocate(2048),
  table = NATIVE_PROFILES[profile].tables.main.va,
  sdk = profile.startsWith('sdk-'),
  load = p.load(table + 0x2bf * 4),
  release = p.load(table + 0x2c0 * 4),
  geometry = p.load(table + 0x2c2 * 4),
  cases = [
    '',
    'probe.hg2',
    'single.hg3',
    'rgb.hg3',
    'anim.hg2',
    'alias.hg2',
    'sequence.hg3',
    'missing.hg3',
    'absent.hg3',
    'broken.hg3',
    'x,1.hg3',
    'x,1,2.hg3',
    'x,1,2,3.hg3',
    'x,1,0,2.hg3',
    'x,0,0.hg3',
    'y,1,2.hg3',
    'z,1,2.hg3',
    'q,1.hg3',
    'x,1,,2.hg3',
    'x,"1",2.hg3',
    'x,1,-2.hg3',
    'x,12,23.hg3',
    'abc,1,2.hg3',
    'folder/probe.hg2',
    '日本語.hg3',
    Uint8Array.of(0x82, 0xff, 0x41),
    new TextEncoder().encode('日本語.hg3'),
  ];
const calls = { load: 0, release: 0, geometry: 0 },
  produced = { bitmap: 0, retained: 0, empty: 0, multiple: 0 };
let comparisons = 0;
const check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  },
  put = (address, text) => {
    const data = text instanceof Uint8Array ? text : encodeCP932(text);
    for (const m of [a, b]) m.writeStringBytes(data, address);
    return address;
  },
  fill = (address, size) => {
    for (const m of [a, b]) m.bytes(address, size).fill(0xa5);
  },
  allocations = (process) =>
    [...process.allocations].map(([address, size]) => [address, size, process.read(address, size)]);

async function compare(id, args) {
  const loading = id === 0x2bf,
    returnsWord = id !== 0x2c0,
    count = loading ? 3 : 2,
    words = Array.from({ length: count }, (_, i) =>
      i < args.length ? args[i] : a.nativeArgument(i),
    ),
    host = loading ? p.allocate(120, true) : 0,
    bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(count * 4),
    out = p.allocate(12);
  let control, result;
  raw.requests.length = adapted.requests.length = 0;
  // The game selector path reads a narrow basename as wide characters. Its
  // caller-stack input is identical on both sides of this comparison.
  for (const process of [p, q]) process.zero(process.stackTop - 0x6000, 0x6000);
  try {
    if (host) p.store(host + 116, raw.view);
    words.forEach((word, i) => p.store(argv + i * 4, word));
    p.write(out, new Uint8Array(12).fill(0xcc));
    control = await raw.engine.call(
      p.load(table + id * 4),
      [bridge.pointer, host, argv, out + 4],
      undefined,
      { task: 1 },
    );
    result = p.read(out, 12);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
    if (host) p.free(host);
  }
  const value = new DataView(result.buffer).getUint32(4, true),
    reply = await adapted.sources.apply(id, args, b, { id: 1 });
  check(reply, returnsWord ? { control, value } : { control }, 'original control and output word');
  check(
    returnsWord ? [...result.subarray(0, 4), ...result.subarray(8)] : [...result],
    new Array(returnsWord ? 8 : 12).fill(0xcc),
    'original output write boundary',
  );
  check(b.memory, a.memory, 'whole VM data and stack');
  check(b.shared, a.shared, 'whole VM shared bytes');
  check(b.blocks, a.blocks, 'all extended blocks, raw names and pointer words');
  check(adapted.requests, raw.requests, 'original file candidate order');
  check(allocations(q), allocations(p), 'all live native allocations and bytes');
  check(
    adapted.engine.features.get('engine-workers')?.snapshot(),
    raw.engine.features.get('engine-workers')?.snapshot(),
    'original prefetch boundary state',
  );
  check(q.read(adapted.view, 0x118), p.read(raw.view, 0x118), 'whole original view');
  calls[loading ? 'load' : returnsWord ? 'geometry' : 'release']++;
  return returnsWord ? value : undefined;
}

async function run(source, destination, initialized) {
  const count = await compare(0x2bf, [source, destination, initialized]);
  if (!count) produced.empty++;
  if (count > 1) produced.multiple++;
  const records = [];
  for (let i = 0; i < count; i++) {
    const address = destination + i * stride,
      tag = b.load(address),
      pointer = b.load(address + 4);
    assert.ok(tag === 1 || tag === 2);
    check(
      q.allocations.get(pointer),
      tag === 1 ? wrapperBytes : retainedBytes,
      'native owner size',
    );
    check(
      q.load(pointer + (tag === 1 ? wrapperBytes - 4 : 188)),
      1,
      'one explicit source reference',
    );
    produced[tag === 1 ? 'bitmap' : 'retained']++;
    records.push(pointer);
  }
  await compare(0x2c0, [destination, Math.max(count, initialized | 0, 0)]);
  for (const pointer of records)
    check(q.allocations.has(pointer), false, 'unshared source is fully released');
  return count;
}

async function checkGeometry(animated) {
  const source = 768,
    argumentsAt = 4800,
    frameRecord = (process) => process.load(process.load(process.load(animated + 60))),
    sourceAt = (process, object) => process.load(process.load(object + 8)),
    geometryOf = (process, bitmap) => {
      const at = (offset) => process.load(bitmap + offset);
      return [
        at(36),
        at(40),
        at(4),
        at(8),
        at(28) || at(4),
        at(32) || at(8),
        at(24),
        at(48),
        at(52),
      ];
    };
  check(await compare(0x2bf, [put(2080, 'rgb.hg3'), source, 1]), 1, 'original static bitmap');
  check(a.load(source), 1, 'static source is an original bitmap wrapper');
  const fixtures = [];
  for (const fixture of [raw, adapted]) {
    const { process, engine, machine, retained } = fixture,
      empty = process.allocate(retainedBytes, true),
      still = process.allocate(retainedBytes, true);
    for (const object of [empty, still])
      await engine.call(retained.abi.construct, [0, 16, 16], object, { task: 1 });
    await engine.call(retained.abi.bitmap, [process.load(machine.load(source + 4))], still, {
      task: 1,
    });
    fixtures.push({ empty, still });
  }
  check(fixtures[0], fixtures[1], 'same original retained identities');
  const [{ empty, still }] = fixtures,
    stillBitmap = sourceAt(p, still),
    frame = frameRecord(p),
    frameWrapper = p.load(frame + 20),
    zeroWords = new Array(9).fill(0),
    stillWords = geometryOf(p, stillBitmap),
    animationWords = geometryOf(p, p.load(frameWrapper));
  check(stillWords.slice(0, 6), [0xffffffff, 2, 4, 1, 6, 9], 'authored signed static geometry');
  check(stillWords.slice(7), [1, 2], 'authored static base');
  check(animationWords, [0, 0, 3, 2, 7, 8, 4, 2, 1], 'authored animation frame geometry');

  async function query(object, destination, length, fill, value, words) {
    const args = [object, destination];
    for (const m of [a, b]) {
      m.nativeArgumentBase = argumentsAt;
      args.forEach((word, i) => m.store(argumentsAt + i * 4, word));
      if (words) m.bytes(destination, 44).fill(fill);
    }
    check(await compare(0x2c2, args.slice(0, length)), value, 'retained geometry status');
    if (!words) return;
    check(
      Array.from({ length: 9 }, (_, i) => b.load(destination + i * 4)),
      words,
      'all nine VM geometry words',
    );
    check(b.bytes(destination + 36, 8), new Uint8Array(8).fill(fill), 'VM result tail canary');
  }
  for (const destination of [0, 127, 4609, 0x80000040, block + 37])
    for (const length of [0, 1, 2])
      for (const fill of [0xa5, 0x5a]) {
        const marker = (fill * 0x01010101) >>> 0;
        await query(0, destination, length, fill, 0, new Array(9).fill(marker));
        await query(empty, destination, length, fill, 0, zeroWords);
        await query(still, destination, length, fill, 1, stillWords);
        await query(animated, destination, length, fill, 1, animationWords);
      }
  for (const destination of [0x7fffffff, 0x80000400, 0xffffffff])
    for (const object of [0, animated, 0xdeadbeef]) await query(object, destination, 2, 0xa5, 0);

  for (const process of [p, q]) {
    process.store(stillBitmap + 28, 0);
    process.store(stillBitmap + 32, 0);
  }
  await query(still, 128, 2, 0xa5, 1, geometryOf(p, stillBitmap));
  // Exercise the original animation lookup when the first entry has no image.
  for (const process of [p, q]) process.store(frame + 20, 0);
  await query(animated, 128, 2, 0x5a, 0, zeroWords);
  for (const process of [p, q]) process.store(frame + 20, frameWrapper);

  for (const fixture of [raw, adapted]) {
    const { engine, retained, machine } = fixture;
    for (const object of [still, empty])
      await engine.call(retained.abi.release, [], object, { task: 1 });
    // Queries into VM address zero reused the original array storage.
    machine.store(0, 2);
    machine.store(4, animated);
  }
  await compare(0x2c0, [source, 1]);
}

try {
  check(blockB, block, 'same extended VM block');
  check(load, sdk ? 0x519040 : 0x64c520, 'independent frozen load slot');
  check(release, sdk ? 0x518420 : 0x64b860, 'independent frozen release slot');
  check(geometry, sdk ? 0x518830 : 0x64bc70, 'independent frozen geometry slot');
  const regions = [
    [2080, 0],
    [2080, 512],
    [4608, 5120],
    [2080, 0x80000020],
    [2080, block + 32],
  ];
  for (const manifest of [null, RENDER_SOURCE_MANIFEST]) {
    await raw.table(manifest);
    await adapted.table(manifest);
    for (const [source, destination] of regions)
      for (const name of cases)
        for (const initialized of [1, 4]) {
          fill(destination, stride * 5);
          await run(put(source, name), destination, initialized);
        }
  }
  for (const initialized of [0, -1, -0x80000000]) {
    fill(0, stride * 4);
    check(
      await compare(0x2bf, [put(2080, 'probe.hg2'), 0, initialized]),
      0,
      'signed initialization count',
    );
    check(
      b.bytes(0, stride * 4),
      new Uint8Array(stride * 4).fill(0xa5),
      'nonpositive count leaves all records',
    );
  }
  for (const address of [0x7fffffff, 0x80000401, 0xffffffff]) {
    check(
      await compare(0x2bf, [put(2080, 'probe.hg2'), address, 2]),
      0,
      'unmapped destination returns empty',
    );
    await compare(0x2c0, [address, 0xffffffff]);
    fill(0, stride * 2);
    check(await compare(0x2bf, [address, 0, 2]), 0, 'unmapped format returns empty');
    const expected = new Uint8Array(stride * 2).fill(0xa5);
    expected.fill(0, 0, 8);
    expected.fill(0, stride, stride + 8);
    check(
      b.bytes(0, stride * 2),
      expected,
      'unmapped format initializes records before producing an empty result',
    );
  }
  for (const [, address] of regions) {
    fill(address, stride * 4);
    check(
      await run(put(address, 'x,1,2.hg3'), address, 1),
      2,
      'format is copied before its aliased records are initialized',
    );
  }
  for (const fixture of [raw, adapted])
    fixture.files.set('item_07.hg2', fixture.files.get('probe.hg2'));
  a.store(16, 7);
  b.store(16, 7);
  fill(512, stride * 4);
  check(await run(put(2080, 'item_%02d[G16].hg2'), 512, 1), 1, 'original filename formatter');
  put(0x80000300, 'probe.hg2');
  check(await run(put(2080, '%s[H768]'), 512, 1), 1, 'original recursive formatter');
  for (const m of [a, b]) {
    m.nativeArgumentBase = 3000;
    [2080, 512, 1].forEach((word, i) => m.store(3000 + i * 4, word));
  }
  put(2080, 'probe.hg2');
  check(await compare(0x2bf, []), 1, 'adjacent original load argument words');
  for (const m of [a, b]) {
    m.store(3000, 512);
    m.store(3004, 1);
  }
  await compare(0x2c0, []);

  fill(512, stride * 6);
  for (const m of [a, b]) {
    [0, 3, 0xffffffff, 1, 2].forEach((tag, i) => {
      const at = 512 + stride * i;
      m.store(at, tag);
      m.store(at + 4, i < 3 ? 0x12345678 : 0);
    });
  }
  await compare(0x2c0, [512, 0]);
  check(b.load(512 + stride), 3, 'zero release count preserves its records');
  await compare(0x2c0, [512, 5]);
  await compare(0x2c0, [512, 5]);
  for (let i = 0; i < 5; i++) {
    check(b.load(512 + stride * i), 0, 'each processed tag clears');
    check(b.load(516 + stride * i), i < 3 ? 0x12345678 : 0, 'unknown-tag pointer is retained');
    check(
      b.bytes(520 + stride * i, stride - 8),
      new Uint8Array(stride - 8).fill(0xa5),
      'release preserves original name bytes',
    );
  }
  check(
    b.bytes(512 + 5 * stride, stride),
    new Uint8Array(stride).fill(0xa5),
    'release stops before the next record',
  );

  check(
    await compare(0x2bf, [put(2080, 'sequence.hg3'), 0, 1]),
    1,
    'original multi-frame retained source',
  );
  const pointer = a.load(4);
  check(b.load(4), pointer, 'same raw retained pointer');
  await checkGeometry(pointer);
  await raw.engine.call(retainedRetain, [], pointer);
  await adapted.engine.call(retainedRetain, [], pointer);
  for (const m of [a, b]) {
    m.store(stride, 2);
    m.store(stride + 4, pointer);
  }
  await compare(0x2c0, [0, 1]);
  check(q.load(pointer + 188), 1, 'an independently retained source remains live');
  await compare(0x2c0, [stride, 1]);
  check(q.allocations.has(pointer), false, 'last retained source runs its destructor');
  check(
    adapted.engine.features.get('engine-workers')?.threads.size ?? 0,
    0,
    'prefetch handles close at final release',
  );
  assert.ok(produced.bitmap && produced.retained && produced.multiple && produced.empty);
  const report = {
    profile,
    sha256,
    calls,
    comparisons,
    produced,
    layout: raw.layout,
    boundaries: [
      'Authored kcView with its original anmtable parser and loaded manifest',
      'Shared original IFile reader with authored mounted resources',
      'Existing platform bridges for zlib, raster operations and image prefetch worker',
    ],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Render sources passed ${calls.load + calls.release} load/release calls, ${calls.geometry} geometry calls and ${comparisons} comparisons`,
  );
} finally {
  await adapted.close();
  await raw.close();
}
