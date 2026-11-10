// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_SECTION_TABLE_LAYOUTS } from '../oracle/section-table.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { kcsProgram } from '../tests/helpers.mjs';
import { sectionFixture, sectionFiles } from '../tests/fixtures/section-table-fixture.mjs';
import { contentAllocations } from '../tests/fixtures/content-databases-fixture.mjs';
const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-section-table.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (k) => NATIVE_ENGINE_IMAGES[k].sha256 === sha256,
  );
if (!profile) throw new Error('Section table proof requires a frozen engine');
const files = sectionFiles(),
  f = await sectionFixture(bytes, profile, files),
  raw = await NativeEngineProcess.open({
    bytes,
    profile,
    readFile: async (name) => files.get(name) ?? null,
  }),
  p = raw.process,
  a = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024)),
  b = f.machine,
  layout = NATIVE_SECTION_TABLE_LAYOUTS[profile],
  handles = new Map();
new NativeEngineFiles(raw, {
  game: { read: async (name) => files.get(name) ?? null },
  getNativeFeature: async (name) => {
    if (raw.features.has(name)) return raw.features.get(name);
    if (name === 'data-buffers') return new NativeDataBuffers(raw);
    throw new Error('Section raw missing ' + name);
  },
});
let comparisons = 0,
  calls = 0;
const check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  },
  put = (source, address) => {
    const bytes = typeof source === 'string' ? encodeCP932(source) : source;
    for (const m of [a, b]) m.bytes(address, bytes.length + 1).set([...bytes, 0]);
  };
const blockA = a.allocate(768),
  blockB = b.allocate(768);
check(blockB, blockA, 'same VM block');
async function run(id, args) {
  calls++;
  const words = Array.from(args),
    needed = id === 0x2ad && words[0] ? 5 : 1;
  while (words.length < needed) words.push(b.nativeArgument(words.length));
  const rawArgs = Array.from(words);
  if (id !== 0x2ab) rawArgs[0] = handles.get(words[0]) ?? 0;
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(rawArgs.length * 4),
    out = p.allocate(4);
  let control, value;
  try {
    rawArgs.forEach((v, i) => p.store(argv + i * 4, v));
    p.store(out, 0xcccccccc);
    control = await raw.call(layout.handlers[id - 0x2ab], [bridge.pointer, 0, argv, out]);
    value = p.load(out);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
  }
  const reply = await f.tables.apply(id, args, b, { id: 1 });
  check(reply.control, control, 'control');
  if (id === 0x2ab) {
    check(!!reply.value, !!value, 'load success');
    if (value) {
      check(f.tables.pointer(reply.value), value, 'same original owner');
      handles.set(reply.value, value);
    }
  } else if (control === 1) check(reply.value, value, 'result');
  if (id === 0x2ac) handles.delete(words[0]);
  check(b.memory, a.memory, 'full VM data/stack');
  check(b.shared, a.shared, 'shared');
  check(b.blocks, a.blocks, 'blocks');
  check(
    contentAllocations(f.engine.process),
    contentAllocations(p),
    'all original strings/tree/vector/heap',
  );
  return reply.value;
}
try {
  await run(0x2ac, [0]);
  await run(0x2ad, [0]);
  const snapshots = [];
  for (const filename of [
    'missing.txt',
    'empty.txt',
    'basic.txt',
    'syntax.txt',
    'crlf.txt',
    'cr.txt',
    'lf.txt',
    'nul.txt',
    'long.txt',
    'raw.txt',
    '',
  ]) {
    put(filename, 256);
    const h = await run(0x2ab, [256]);
    if (!h) continue;
    for (const [section, key] of [
      ['#first', 'key'],
      ['first', 'key'],
      ['#First', 'key'],
      ['#second', 'key'],
      ['#first', 'empty'],
      ['#first', 'spaces'],
      ['#first', 'comment'],
      ['#one', 'line'],
      ['#one', 'tab'],
      ['#one', 'tab\\tvalue'],
      ['#one', 'colon:value'],
      ['#empty', 'key'],
      ['#', 'key'],
      ['#x', 'a'],
      ['#missing', 'key'],
      ['#' + 'section'.repeat(16), 'key'.repeat(30)],
      ['#raw', Uint8Array.of(0x81, 0x30)],
    ]) {
      put(section, 512);
      put(key, 768);
      for (const ordinal of [0, 1, 2, 3, 0xffffffff])
        for (const address of [1024, a.data.length + 32, 0x80000020, blockA + 32, 0xffffffff]) {
          for (const m of [a, b]) {
            if (address !== 0xffffffff) m.bytes(address, 600).fill(0xa5);
          }
          const found = await run(0x2ad, [h, 512, 768, ordinal, address]);
          if (
            filename === 'basic.txt' &&
            section === '#first' &&
            key === 'key' &&
            address === 1024 &&
            found
          )
            snapshots.push({ ordinal, value: b.string(address) });
        }
    }
    for (const m of [a, b]) {
      m.nativeArgumentBase = 1280;
      m.store(1296, 1024);
    }
    put('#first', 512);
    put('key', 768);
    await run(0x2ad, [h, 512, 768, 0]);
    for (const address of [512, 768]) {
      put('#first', 512);
      put('key', 768);
      await run(0x2ad, [h, 512, 768, 1, address]);
    }
    await run(0x2ac, [h]);
  }
  check(
    snapshots,
    [
      { ordinal: 0, value: 'first value' },
      { ordinal: 1, value: 'second value' },
      { ordinal: 2, value: 'third value' },
    ],
    'source-order repeated values and sections',
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        ids: [0x2ab, 0x2ac, 0x2ad],
        scope:
          'Complete original section-table load/get/release wrappers and parser. Repeated sections/keys, case/raw CP932 bytes, first-space values, all EOL forms, comments, empty/missing/NUL files, long strings, signed ordinal and four VM destinations. Full VM/shared/blocks and all live original allocations compared; mounted file callbacks are explicit.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Original section table differential ' +
      comparisons +
      '/' +
      comparisons +
      '; ' +
      calls +
      ' complete-wrapper calls',
  );
} finally {
  for (const pointer of handles.values()) {
    await raw.call(layout.destroy, [], pointer);
    p.free(pointer);
  }
  await f.engine.close();
  await raw.close();
}
