// SPDX-License-Identifier: MPL-2.0
// Complete main3EA wrapper and original map traversal/string replacement.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import {
  NativeScriptReplacements,
  nativeScriptReplacement,
} from '../src/native/script-replacement.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-script-replacement.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Script replacement oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  sdk = profile.startsWith('sdk'),
  root = p.allocate(100000, true),
  memory = p.allocate(8192),
  argv = p.allocate(8),
  out = p.allocate(4),
  table = NATIVE_EXE_PROFILES[profile].tables.main.va,
  local = new Uint8Array(8192),
  machine = { bytes: (at, size) => local.subarray(at, at + size) };
p.store(sdk ? 0xc965d0 : 0xb91bf8, root);
let formatted = new Uint8Array(),
  passed = 0;
engine.patch(
  sdk ? 0x8a6510 : 0x876ea0,
  'authored SCRIPT replacement formatter boundary',
  2,
  ([, target]) => {
    p.write(target, Uint8Array.from([...formatted, 0]));
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  sdk ? 0x8a6910 : 0x8772a0,
  'authored SCRIPT replacement VM address boundary',
  1,
  ([address]) => memory + address,
  { calleePops: true },
);
const encode = (value) => (value instanceof Uint8Array ? value : encodeCP932(value)),
  sets = [
    [],
    [['a', 'aa']],
    [['x', '']],
    [
      ['abc', 'X'],
      ['a', 'abc'],
      ['aa', 'ab'],
    ],
    [
      ['z', 'a'],
      ['猫', 'ねこ'],
      ['a', 'b'],
    ],
    [['long find string 1234567890', 'long replacement string 9876543210']],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
      ['f', 'g'],
      ['g', 'h'],
    ],
    [
      [Uint8Array.of(0x81, 0x7f), Uint8Array.of(0xff, 0x80, 0x81)],
      ['A', 'B'],
      ['日本語', '猫'],
    ],
  ],
  sources = [
    '',
    'a',
    'x',
    'aa abc xa z aaaa!',
    'long find string 1234567890 tail',
    'z 猫 日本語 a',
    '日本語abc日本語',
    'no match!',
    'A a aA',
    'abc'.repeat(100),
    Uint8Array.of(0x81, 0x7f, 65, 0x81, 0x7f, 0xff),
  ];
function map(rules, nullMap = false) {
  if (nullMap) {
    p.store(root + (sdk ? 0xcc58 : 0xe4d8), 0);
    return;
  }
  const map = p.allocate(8, true),
    header = p.allocate(64, true),
    nodes = [],
    entries = [...rules.entries.values()].sort((a, b) => Buffer.compare(a.find, b.find));
  p.write(header + 13, Uint8Array.of(1));
  for (const entry of entries) {
    const node = p.allocate(64, true);
    nodes.push(node);
    for (const [offset, value] of [
      [16, entry.find],
      [40, entry.replacement],
    ]) {
      const size = value.length,
        storage = size < 16 ? node + offset : p.allocate(size + 1);
      p.write(storage, Uint8Array.from([...value, 0]));
      if (size >= 16) p.store(node + offset, storage);
      p.store(node + offset + 16, size);
      p.store(node + offset + 20, Math.max(15, size));
    }
  }
  const build = (start, end, parent) => {
      if (start === end) return header;
      const mid = (start + end) >> 1,
        node = nodes[mid];
      p.store(node, build(start, mid, node));
      p.store(node + 4, parent);
      p.store(node + 8, build(mid + 1, end, node));
      return node;
    },
    top = build(0, nodes.length, header);
  p.store(header, nodes[0] ?? header);
  p.store(header + 4, top);
  p.store(header + 8, nodes.at(-1) ?? header);
  p.store(map, header);
  p.store(map + 4, nodes.length);
  p.store(root + (sdk ? 0xcc58 : 0xe4d8), map);
}
try {
  for (const entries of sets) {
    const rules = new NativeScriptReplacements();
    for (const [find, replacement] of entries) rules.add(encode(find), encode(replacement));
    for (const nullMap of entries.length ? [false] : [false, true]) {
      map(rules, nullMap);
      for (const source of sources)
        for (const destination of [16, 512, 2000]) {
          formatted = encode(source);
          local.fill(0xa5);
          local.set([...formatted, 0], 16);
          p.write(memory, local);
          p.store(argv, destination);
          p.store(argv + 4, 16);
          p.store(out, 0xcafebabe);
          const control = await engine.call(p.load(table + 0x3ea * 4), [0, 0, argv, out]),
            expected = nativeScriptReplacement(0x3ea, [destination, 16], machine, {
              configuration: { scriptReplacements: rules },
              formatBytes: () => formatted.slice(),
            });
          assert.deepEqual(
            { control, value: p.load(out) },
            { ...expected, value: 0xcafebabe },
            'void output remains unwritten',
          );
          passed++;
          assert.deepEqual(
            p.read(memory, local.length),
            local,
            `${profile} rules=${JSON.stringify(entries)} source=${Buffer.from(formatted).toString('hex')} destination=${destination}`,
          );
          passed++;
        }
    }
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Complete original main3EA wrapper, SSO/map traversal, temporary std::string allocation/release and 6A59B0 replacement. Authored 0/1/3/7-node ordered maps include NULL/empty map, long heap strings, CP932/invalid bytes, growth/deletion, chained replacements, no matches, aliases and full canaries. Formatter and VM-address translation are explicit boundaries. Startup XML-to-map loading is not established by this report.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original SCRIPT replacement differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
