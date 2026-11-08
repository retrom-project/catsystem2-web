// SPDX-License-Identifier: MPL-2.0
// Byte-oriented KCS formatting versus the original formatter and CRT sprintf.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { KCSMachine, floatBits, formatNativeAt, encodeCP932 } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-format.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Formatter oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  machine = new KCSMachine(
    {
      body: new Binary(Uint8Array.of(59)),
      codeSize: 1,
      data: new Uint8Array(8192),
      stackSize: 4096,
    },
    undefined,
    new Uint8Array(4096),
  ),
  cases = [],
  literal = (text) => encodeCP932(text),
  add = (source, value = 0, string = literal('猫 %04d[G512]')) =>
    cases.push({ source: typeof source === 'string' ? literal(source) : source, value, string });
machine.fp = 4096;
for (const source of [
  '',
  'literal 猫',
  '%%',
  '%%d[G512]',
  '%',
  '%x[bad]',
  '%d[G]',
  '%d[L]',
  '%d[H]',
  '%08d[G512] %s[G2048]',
  '%s[L2048]',
  '%s[H512]',
  '%.1s[G2048]',
  '%8.3s[G2048]',
  '%-8.3s[G2048]',
  '%s[G2048] %s[G2048]',
  '%q text',
  '%d[G512] %d[L512] %u[H64]',
])
  add(source, 73);
for (const type of ['d', 'i', 'u', 'o', 'x', 'X'])
  for (const word of [0, 1, 0xffffffff, 0x80000000, 0x7fffffff, 0x12345678])
    for (const flags of ['', '+', ' ', '0', '#', '-', '+#'])
      for (const width of ['', '4', '12'])
        for (const precision of ['', '.0', '.1', '.8'])
          add(`a%${flags}${width}${precision}${type}[G512]z`, word);
for (const type of ['f', 'F'])
  for (const value of [0, -0, 1.25, -1.25, 2.5, 1 / 3, 4096.999, -999999.5])
    for (const flags of ['', '+', '#', '0', '-', ' '])
      for (const width of ['', '12'])
        for (const precision of ['', '.0', '.1', '.6'])
          add(`a%${flags}${width}${precision}${type}[G512]z`, floatBits(value));
for (const source of [
  new TextEncoder().encode('UTF-8 猫 中文 %s[G2048]'),
  Uint8Array.of(0x81, 0x7f, 0xff, 37, 115, 91, 71, 50, 48, 52, 56, 93),
])
  for (const string of [
    new TextEncoder().encode('UTF-8 日本語'),
    Uint8Array.of(0x81, 0x7f, 0xff, 37, 37),
  ])
    add(source, 3, string);
const mapping = new NativeKCSMemory(p, machine),
  target = p.allocate(8192),
  memory = p.load(mapping.pointer + 20),
  shared = p.load(mapping.pointer + 40);
let passed = 0;
try {
  for (const row of cases) {
    machine.memory.fill(0);
    machine.shared.fill(0);
    machine.bytes(0, row.source.length + 1).set([...row.source, 0]);
    for (const at of [512, 4096 + 512]) machine.store(at, row.value);
    machine.store(0x80000040, row.value);
    for (const at of [2048, 4096 + 2048, 0x80000200])
      machine.bytes(at, row.string.length + 1).set([...row.string, 0]);
    p.write(memory, machine.memory);
    p.write(shared, machine.shared);
    p.write(target, new Uint8Array(8192).fill(0xa5));
    assert.equal(
      await engine.call(
        profile.startsWith('sdk') ? 0x8a6510 : 0x876ea0,
        [0, target],
        mapping.pointer,
      ),
      1,
      'native formatter status',
    );
    passed++;
    const expected = formatNativeAt(0, machine),
      result = p.read(target, 8192),
      whole = new Uint8Array(8192).fill(0xa5);
    whole.set([...expected, 0]);
    assert.deepEqual(
      result,
      whole,
      `${profile} ${Buffer.from(row.source).toString('hex')}/${row.value}`,
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
        cases: cases.length,
        scope:
          'Full original KCS formatter with its actual CRT sprintf, pointer translation and recursive string path. All full output bytes/canaries are compared for signed/unsigned/octal/hex, numeric flags/width/precision, finite f32 values, local/global/shared references, recursion, string byte precision/width, CP932/UTF-8/invalid bytes and literal/invalid bracket syntax. Unsupported CRT conversions and nonfinite/very large float spellings remain outside this report.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original byte formatter differential ${passed}/${passed}`);
} finally {
  mapping.close();
  await engine.close();
}
