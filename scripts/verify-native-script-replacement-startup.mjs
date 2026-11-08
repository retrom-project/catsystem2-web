// SPDX-License-Identifier: MPL-2.0
// Original XML parser/import and startup SCRIPT/replace insertion region.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import { parseNativeXML } from '../src/native/xml.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/verify-native-script-replacement-startup.mjs FIXED_EXE IGNORED_REPORT',
  );
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('SCRIPT startup oracle requires a frozen engine image');
const sdk = profile.startsWith('sdk'),
  engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  root = p.allocate(100000, true),
  frame = p.allocate(8192, true) + 6144,
  code = 0x1f000000,
  binding = sdk
    ? {
        create: 0x5d2ed0,
        parse: 0x5d5e90,
        import: 0x5d34d0,
        start: 0x5cf54c,
        end: 0x5cf7b9,
        owner: -0xf0c,
        index: -0x598,
        map: 0xcc58,
        sprintf: 0x636423,
      }
    : {
        create: 0x722660,
        parse: 0x725700,
        import: 0x722c60,
        start: 0x71e63c,
        end: 0x71e876,
        owner: -0x1030,
        index: -0x7ac,
        map: 0xe4d8,
        sprintf: 0x79d913,
      },
  u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255],
  encoding = sdk ? 'shift_jis' : 'utf-8',
  encode = sdk ? encodeCP932 : (text) => new TextEncoder().encode(text),
  cases = [
    '',
    '<r01><find>a</find><rep>b</rep></r01>',
    '<r00><find>a</find></r00><r01><find>b</find><rep>c</rep></r01>',
    '<r00><rep>b</rep></r00>',
    '<r00><find></find><rep>x</rep></r00>',
    '<r00><find>猫</find><rep>日本語</rep></r00>',
    '<r00><find>a</find><rep>b</rep></r00><r01><find>a</find><rep>wrong</rep></r01>',
    '<r00><find>first</find><find>last</find><rep>one</rep><rep>two</rep></r00>',
    '<r00><find>  a\r\n b\t </find><rep>&amp;</rep></r00>',
    '<r00><find>\\_</find><rep> </rep></r00><r02><find>never</find><rep>x</rep></r02>',
    Array.from(
      { length: 105 },
      (_, i) =>
        `<r${String(i).padStart(2, '0')}><find>key${i}</find><rep>long replacement ${i} 猫</rep></r${String(i).padStart(2, '0')}>`,
    ).join(''),
  ];
let passed = 0;
p.map(code, 4096, 'authored SCRIPT loader entry');
engine.patch(binding.sprintf, 'authored startup integer sprintf', 3, ([out, , index]) => {
  const text = 'r' + String(index).padStart(2, '0');
  p.write(out, new TextEncoder().encode(text + '\0'));
  return text.length;
});
p.write(code + 128, [0x5f, 0x5e, 0x5b, 0x5d, 0xc3]);
p.write(binding.end, [0xe9, ...u32(code + 128 - binding.end - 5)]);
try {
  for (const body of cases) {
    const source = encode(
        `<?xml version="1.0" encoding="${encoding}"?><document><SCRIPT><replace>${body}</replace></SCRIPT></document>`,
      ),
      document = p.allocate(8, true),
      input = p.allocate(source.length),
      map = p.allocate(8, true),
      head = p.allocate(64, true);
    p.write(input, source);
    await engine.call(binding.create, [], document);
    assert.equal(
      await engine.call(binding.parse, [input, source.length], p.load(document)),
      0,
      'original XML parse',
    );
    passed++;
    await engine.call(binding.import, [], document);
    p.store(map, head);
    for (const at of [0, 4, 8]) p.store(head + at, head);
    p.write(head + 12, [1, 1]);
    p.store(root + binding.map, map);
    p.store(frame + binding.owner, root);
    p.write(frame + binding.index, new TextEncoder().encode('r00\0'));
    // Authored call frame enters after the original first sprintf. All XML
    // lookup, std::string, duplicate handling, map insertion/balancing and
    // subsequent numbered iterations run from the original executable.
    const entry = [
      0x55,
      0x53,
      0x56,
      0x57,
      0xbd,
      ...u32(frame),
      0xbb,
      ...u32(document),
      0xbe,
      ...u32(root),
      0x31,
      0xff,
    ];
    entry.push(0xe9, ...u32(binding.start - (code + entry.length) - 5));
    p.write(code, entry);
    await engine.call(code);
    const rows = [],
      str = (at) => {
        const len = p.load(at + 16),
          ptr = p.load(at + 20) < 16 ? at : p.load(at);
        return p.read(ptr, len);
      },
      visit = (at) => {
        if (p.read(at + 13, 1)[0]) return;
        visit(p.load(at));
        rows.push([str(at + 16), str(at + 40)]);
        visit(p.load(at + 8));
      };
    visit(p.load(head + 4));
    const model = new NativeScriptReplacements(parseNativeXML(source), { encoding }),
      expected = [...model.entries.values()]
        .sort((a, b) => Buffer.compare(a.find, b.find))
        .map(({ find, replacement }) => [find, replacement]);
    assert.equal(
      p.load(map + 4),
      model.entries.size,
      'original first duplicate wins / stops at missing record',
    );
    passed++;
    assert.deepEqual(rows, expected, 'original ordered map raw key/value bytes');
    passed++;
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        encoding,
        scope:
          'Original XML constructor, parser/import and complete SCRIPT/replace insertion loop, with original std::string and balanced map code. Only entry/exit, empty map allocation and integer sprintf are authored boundaries. Covers UTF-8 versus CP932, empty/deleted/missing/gapped records, duplicate keys/fields, whitespace/entity spellings and 105 contiguous long-value records.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original SCRIPT startup differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
