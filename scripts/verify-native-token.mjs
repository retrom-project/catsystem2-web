// SPDX-License-Identifier: MPL-2.0
// Complete main207 wrapper and original grouped tokenizer, including VM aliases.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { nativeStandard } from '../src/native/standard.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-token.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Token oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ bytes, profile }),
  p = engine.process,
  memory = p.allocate(8192, true),
  argv = p.allocate(12, true),
  out = p.allocate(4, true),
  table = NATIVE_PROFILES[profile].tables.main.va,
  local = new Uint8Array(8192),
  machine = {
    load: (at) => local[at],
    store: (at, word, size = 4) => {
      const view = new DataView(local.buffer);
      if (size === 1) view.setUint8(at, word);
      else if (size === 2) view.setUint16(at, word, true);
      else view.setUint32(at, word, true);
    },
    bytes: (at, size) => local.subarray(at, at + size),
  },
  sources = [
    '',
    ' ',
    '   a  b c   ',
    'a\tb c',
    'frameoff fade 30',
    'abc(x y) (z (q r)) end',
    '(a b)(c d)',
    '123(a b)',
    '(:literal text) tail',
    'a(:literal text)tail',
    '(:one (:two) three)',
    '(unclosed',
    'a) b',
    '猫(日本語) a',
    '猫 ねこ\t犬',
    '"quoted text" z',
    'a'.repeat(1000),
    '(a b c) d e f',
  ];
let passed = 0;
engine.patch(
  profile.startsWith('sdk') ? 0x8a6910 : 0x8772a0,
  'authored token VM mapping boundary',
  1,
  ([at]) => (at < local.length ? memory + at : 0),
  { calleePops: true },
);
try {
  for (const text of sources)
    for (const index of [0, 1, 2, 3, 4, 5, 99, 0x80000000, 0xffffffff])
      for (const destination of [1024, 16, 19]) {
        local.fill(0xa5);
        local.set(Uint8Array.from([...encodeCP932(text), 0]), 16);
        p.write(memory, local);
        [destination, 16, index].forEach((word, i) => p.store(argv + i * 4, word));
        p.store(out, 0xcafebabe);
        const control = await engine.call(p.load(table + 0x207 * 4), [0, 0, argv, out]),
          expected = nativeStandard(0x207, [destination, 16, index], machine);
        assert.deepEqual(
          { control, value: p.load(out) },
          expected,
          `reply ${text}/${index}/${destination}`,
        );
        passed++;
        assert.deepEqual(
          p.read(memory, local.length),
          local,
          `all bytes ${text}/${index}/${destination}`,
        );
        passed++;
      }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        passed,
        scope:
          'Original main207 and grouped tokenizer, full destination/source/canary memory and result/control. Space-only splitting, nested/literal groups, CP932 bytes, unsigned indices, misses and overlapping destinations. VM pointer mapping is supplied; malformed literal groups that write before scratch are outside this report.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original token differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
