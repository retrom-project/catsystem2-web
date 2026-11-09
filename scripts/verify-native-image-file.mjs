// SPDX-License-Identifier: MPL-2.0
// Full ANM-presence wrapper, extension/basename helpers, original anmtable
// parser/map and original IFile existence/destruction. No predicate stub.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { imageFileFixture } from '../tests/fixtures/image-file-fixture.mjs';

const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-image-file.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (name) => NATIVE_ENGINE_IMAGES[name].sha256 === sha256,
  );
if (!profile) throw new Error('ANM presence oracle requires a frozen engine');
const raw = await imageFileFixture(bytes, profile),
  f = await imageFileFixture(bytes, profile),
  a = raw.machine,
  b = f.machine,
  block = a.allocate(1024),
  other = b.allocate(1024),
  inputs = [
    '',
    'source',
    'source.hg3',
    'SOURCE.HG3',
    'dir/source.hg3',
    'second/source.bmp',
    'direct.jpg',
    'direct.anm',
    'image-only.hg3',
    'empty.hg3',
    'broken.hg3',
    'missing',
    'missing.ext',
    'dir.with.dot/noext',
    '.hidden',
    'a.',
    '\\source.hg3',
    '/source.hg3',
    'source,1,0.hg3',
    '日本語.hg3',
    'no-category',
    Uint8Array.of(0x82, 0xff, 0x41),
    new TextEncoder().encode('日本語.hg3'),
  ],
  tables = [
    null,
    'source\tfallback\r\n',
    'source\tmissing-target\r\n',
    'source\tfallback\r\nsource\tdirect\r\n',
    'source\tfolder/target.hg3\r\n日本語\tfallback\r\n',
    'SOURCE\tfallback\r\nsource,1,0\tfallback\r\n',
  ],
  check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  },
  put = (at, value) => {
    const data = value instanceof Uint8Array ? value : encodeCP932(value);
    for (const m of [a, b]) m.bytes(at, data.length + 1).set([...data, 0]);
    return at;
  };
let comparisons = 0,
  calls = 0;
check(block, other, 'same extended VM block');
check(
  raw.process.load(NATIVE_EXE_PROFILES[profile].tables.main.va + 0x1ae * 4),
  raw.layout.handler,
  'independent frozen slot',
);
async function run(args) {
  const words = args.length ? [...args] : [a.nativeArgument(0)],
    p = raw.process,
    host = p.allocate(120, true),
    bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(words.length * 4),
    out = p.allocate(12);
  let control, result;
  raw.requests.length = f.requests.length = 0;
  try {
    p.store(host + 116, raw.view);
    words.forEach((word, i) => p.store(argv + i * 4, word));
    p.write(out, new Uint8Array(12).fill(0xcc));
    control = await raw.engine.call(raw.layout.handler, [bridge.pointer, host, argv, out + 4]);
    result = p.read(out, 12);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
    p.free(host);
  }
  const reply = await f.feature.apply(0x1ae, args, b, { id: 1 }),
    value = new DataView(result.buffer).getUint32(4, true);
  check(reply, { control, value }, 'complete original reply');
  check(
    [result[0], result[1], result[2], result[3], ...result.subarray(8)],
    new Array(8).fill(0xcc),
    'output canaries',
  );
  check(b.memory, a.memory, 'whole VM data/stack');
  check(b.shared, a.shared, 'whole shared data');
  check(b.blocks, a.blocks, 'every VM extension');
  check(f.requests, raw.requests, 'actual file candidates and fallback order');
  check(
    [...f.process.allocations],
    [...p.allocations],
    'all temporary IFiles and buffers released',
  );
  check(
    f.process.read(f.view, 0x118),
    p.read(raw.view, 0x118),
    'query preserves its view and anmtable identity',
  );
  calls++;
  return value;
}
try {
  for (const table of tables) {
    await raw.table(table);
    await f.table(table);
    for (const scenario of [0, 1, 2]) {
      for (const fixture of [raw, f]) {
        fixture.files.clear();
        fixture.files.set('direct.anm', Uint8Array.of(7, 8, 9));
        fixture.files.set('empty.anm', new Uint8Array());
        fixture.files.set('broken.anm', Uint8Array.of(0xff));
        fixture.files.set('image-only.hg3', Uint8Array.of(1, 2, 3));
        if (scenario !== 0) fixture.files.set('fallback.anm', Uint8Array.of(123));
        if (scenario === 2) {
          fixture.files.set('source.anm', Uint8Array.of(32));
          fixture.files.set('folder/target.anm', new Uint8Array());
          fixture.files.set('.anm', Uint8Array.of(3));
          fixture.files.set('日本語.anm', Uint8Array.of(4));
        }
      }
      for (const at of [0, 512, 4608, 0x80000020, block + 32])
        for (const name of inputs) await run([put(at, name)]);
    }
  }
  for (const fixture of [raw, f]) {
    fixture.files.set('item_07.anm', new Uint8Array());
    fixture.files.set('direct.anm', new Uint8Array());
  }
  put(512, 'item_%02d[G16]');
  a.store(16, 7);
  b.store(16, 7);
  check(await run([512]), 1, 'original integer formatter');
  put(512, '%s[H32]');
  put(0x80000020, 'direct.hg3');
  check(await run([512]), 1, 'recursive shared string formatter');
  for (const m of [a, b]) {
    m.nativeArgumentBase = 2048;
    m.store(2048, 512);
  }
  await run([]);
  put(512, 'direct.hg3');
  const before = f.process.allocations.size;
  for (let i = 0; i < 25; i++) await run([512]);
  check(f.process.allocations.size, before, 'repeated presence probes retain no IFile allocation');
  const report = {
    profile,
    sha256,
    calls,
    comparisons,
    original: raw.layout,
    boundaries: [
      'Mounted category resolution and original IFile opener from engine-files',
      'Authored kcView and original anmtable.csv map/parser',
    ],
    notCovered: ['1CC bitmap/composite factory', '2BF/2C0 owned render-source array family'],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`ANM presence passed ${calls} complete original calls/${comparisons} comparisons`);
} finally {
  await f.close();
  await raw.close();
}
