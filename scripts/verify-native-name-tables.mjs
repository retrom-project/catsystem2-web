// SPDX-License-Identifier: MPL-2.0
// All eight original TSV/name/filename-rule wrappers and original parser.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_NAME_TABLE_CONTRACTS } from '../src/native/nametable.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { nameTableFixture, nameTableFiles } from '../tests/fixtures/name-table-fixture.mjs';
import { contentAllocations } from '../tests/fixtures/content-databases-fixture.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-name-tables.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (key) => NATIVE_ENGINE_IMAGES[key].sha256 === sha256,
  );
if (!profile) throw new Error('Name table oracle requires a frozen engine');
const files = nameTableFiles(),
  raw = await nameTableFixture(bytes, profile, files),
  f = await nameTableFixture(bytes, profile, files),
  p = raw.process,
  a = raw.machine,
  b = f.machine,
  index = Number(profile.startsWith('sdk-')),
  byID = new Map(NATIVE_NAME_TABLE_CONTRACTS.map((s) => [s.id, s])),
  pointers = new Map(),
  covered = new Map();
let calls = 0,
  comparisons = 0;
const check = (x, y, label) => {
    assert.deepEqual(x, y, label);
    comparisons++;
  },
  put = (text, at = 256) => {
    for (const m of [a, b])
      m.writeStringBytes(typeof text === 'string' ? encodeCP932(text) : text, at);
  };
const block = a.allocate(2048);
check(b.allocate(2048), block, 'same block base');
async function run(id, args) {
  const spec = byID.get(id),
    words = Array.from(args);
  while (!words.length) words.push(a.nativeArgument(0));
  const count = id !== 0x279 && !words[0] ? 1 : spec.words;
  while (words.length < count) words.push(a.nativeArgument(words.length));
  const handle = words[0];
  if (id !== 0x279) words[0] = pointers.get(words[0]) ?? 0;
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(words.length * 4),
    out = p.allocate(4);
  let control, value;
  try {
    words.forEach((w, i) => p.store(argv + i * 4, w));
    p.store(out, 0xcccccccc);
    control = await raw.tables.call(spec.handlers[index], [bridge.pointer, 0, argv, out], 1);
    value = p.load(out);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
  }
  const reply = await f.tables.apply(id, args, b, { id: 1 });
  calls++;
  covered.set(id, (covered.get(id) ?? 0) + 1);
  check(reply.control, control, 'control/' + id.toString(16));
  if (id === 0x279) {
    check(reply.value !== 0, value !== 0, 'open result');
    if (value) {
      pointers.set(reply.value, value);
      raw.tables.pointers.add(value);
      check(f.tables.pointer(reply.value), value, 'original table owner identity');
    }
  } else if (control === 1) check(reply.value, value, 'word/' + id.toString(16));
  if (id === 0x27a && handle) {
    raw.tables.pointers.delete(words[0]);
    pointers.delete(handle);
  }
  check(b.memory, a.memory, 'all data/stack/canaries');
  check(b.shared, a.shared, 'shared/canaries');
  check(b.blocks, a.blocks, 'blocks/canaries');
  check(
    contentAllocations(f.process),
    contentAllocations(p),
    'all live original table/file allocations',
  );
  return reply.value;
}
try {
  for (const spec of NATIVE_NAME_TABLE_CONTRACTS) if (spec.id !== 0x279) await run(spec.id, [0]);
  for (const name of [
    'missing.tsv',
    'empty.tsv',
    'header.tsv',
    'names.tsv',
    'quoted.tsv',
    'raw.tsv',
  ]) {
    put(name);
    const h = await run(0x279, [256]);
    if (!h) continue;
    for (const row of [0, 1, 2, 3, 4, 5, 6, 0xffffffff, 0x7fffffff]) {
      await run(0x27c, [h, row]);
      for (const at of [1024, a.data.length + 64, 0x80000040, block + 64]) {
        for (const m of [a, b]) m.bytes(at, 300).fill(0xa5);
        await run(0x27d, [h, row, at]);
        for (const field of [0, 1, 2, 0xffffffff]) await run(0x27e, [h, row, field, at]);
      }
    }
    for (const alias of [
      'Alias',
      'alias',
      'Same',
      'Dup',
      '猫',
      '犬',
      'plain',
      'Hex',
      'Decimal',
      '猫,犬',
      'a"b',
      'lineline',
      '',
      'missing',
      new TextEncoder().encode('猫é'),
      Uint8Array.of(0x81, 0x7f),
    ]) {
      put(alias, 512);
      await run(0x27b, [h, 512]);
    }
    await run(0x27a, [h]);
  }
  // Filename rules share the records loaded above; no shadow rule map.
  put('names.tsv');
  const h = await run(0x279, [256]);
  const sources = [
    'bg001.hg2',
    'BG001.HG2',
    'bg.hg2',
    'bg001.hg3',
    'bg012.hg2,1,2',
    'pc12.hg3',
    'pc1.hg3',
    'pc123.hg3',
    'voice.ogg',
    'a/b.ogg',
    'a.b.c',
    'noext',
    '',
    '猫001.hg2',
    Uint8Array.of(0x81, 0x7f, 0x2e, 0x68, 0x67, 0x32),
    'x'.repeat(200) + '.ogg',
  ];
  for (let row = 0; row < 6; row++)
    for (const source of sources) {
      put(source, 512);
      await run(0x27f, [h, row, 512]);
      for (const out of [1024, 0x80000080, block + 128]) {
        for (const m of [a, b]) m.bytes(out, 640).fill(0xa5);
        await run(0x280, [h, row, 512, out]);
      }
    }
  // Native replacement directives, unknown percent literals and signed-byte
  // comma scanning quirks all execute inside the original replacement helper.
  const templates = ['%s', '%n', '%f', '%c', '%r', '%%', '%x', 'prefix-%n-%r', '', '%s%s'];
  for (let i = 0; i < templates.length; i++) {
    files.set('@cat/fes/template.tsv', encodeCP932('1\tname\t*.hg2\t' + templates[i] + '\r\n'));
    put('template.tsv');
    const t = await run(0x279, [256]);
    for (const source of ['bg123.hg2,1,2', 'none', '123', '.hg2', 'x,3', '']) {
      put(source, 512);
      await run(0x280, [t, 0, 512, 1024]);
    }
    if (templates[i] === '%s' || templates[i] === '%n' || templates[i] === '') {
      put('abc123.hg2', 512);
      await run(0x280, [t, 0, 512, 512]);
    }
    await run(0x27a, [t]);
  }
  a.nativeArgumentBase = b.nativeArgumentBase = 7000;
  for (const m of [a, b]) {
    m.store(7000, h);
    m.store(7004, 0);
    m.store(7008, 512);
    m.store(7012, 1024);
  }
  put('bg1.hg2', 512);
  await run(0x280, []);
  await run(0x27a, []);
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        comparisons,
        covered: Object.fromEntries([...covered].map(([id, n]) => [id.toString(16), n])),
        scope:
          'All eight complete original wrappers, original TSV/parser/alias map and filename match/substitution, null gates, invalid query indexes, four VM domains, raw encodings, alias, adjacent GCALL words and every original live allocation. No parser/matcher/replacement helper replaced.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Native name tables passed ${calls} wrappers / ${comparisons} comparisons`);
} finally {
  await f.engine.close();
  await raw.engine.close();
}
