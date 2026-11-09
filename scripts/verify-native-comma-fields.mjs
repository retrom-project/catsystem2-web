// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, formatNativeAt } from '../src/kcs.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { nativeStandard } from '../src/native/standard.mjs';
import { parseNativeResourceSelection } from '../src/native/resource-selection.mjs';
const [filename, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: verify-native-comma-fields.mjs FIXED_EXE IGNORED_REPORT');
const exe = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(exe).digest('hex'),
  profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
    (k) => NATIVE_ENGINE_IMAGES[k].sha256 === sha256,
  );
if (!profile) throw new Error('Comma proof requires a frozen image');
const engine = await NativeEngineProcess.open({ bytes: exe, profile }),
  p = engine.process,
  machine = () =>
    new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(8192),
        stackSize: 4096,
      },
      undefined,
      new Uint8Array(1024),
    ),
  a = machine(),
  b = machine(),
  blockA = a.allocate(2048),
  blockB = b.allocate(2048);
assert.equal(blockA, blockB);
const cases = [
    '',
    '1,2,3',
    ',,,',
    '@,@,9',
    'one,,two,',
    'a, ,b',
    'a,(b,c),d',
    '"a,b",c',
    '猫,日本語,犬',
    '@,@@,@x',
    ' ,@, ',
    'a\\tb,@,c',
    '%%,@,%%',
    Uint8Array.of(0x81, 0x30, 44, 0xff, 44, 64),
    Uint8Array.from([...new TextEncoder().encode('猫,日'), 44, 64]),
    Uint8Array.of(97, 0, 44, 64),
  ],
  oldCases = cases.slice(0, 12);
let calls = 0,
  comparisons = 0,
  helperCalls = 0;
const check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  },
  put = (bytes, at) => {
    const src = typeof bytes === 'string' ? encodeCP932(bytes) : bytes;
    for (const m of [a, b]) m.bytes(at, src.length + 1).set([...src, 0]);
  };
async function run(id, args) {
  calls++;
  const bridge = new NativeKCSMemory(p, a),
    argv = p.allocate(args.length * 4),
    out = p.allocate(4);
  let control, value;
  try {
    args.forEach((v, i) => p.store(argv + i * 4, v));
    p.store(out, 0xcccccccc);
    control = await engine.call(p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + id * 4), [
      bridge.pointer,
      0,
      argv,
      out,
    ]);
    value = p.load(out);
  } finally {
    bridge.close();
    p.free(out);
    p.free(argv);
  }
  const reply = nativeStandard(id, args, b, { formatBytes: formatNativeAt });
  check(reply.control, control, 'original control');
  if (control === 1) check(reply.value, value, 'original word');
  else check(value, 0xcccccccc, 'original void leaves result untouched');
  check(b.memory, a.memory, 'complete data/stack/canaries');
  check(b.shared, a.shared, 'complete shared');
  check(b.blocks, a.blocks, 'complete blocks');
}
try {
  for (const old of oldCases)
    for (const replacement of cases)
      for (const destination of [0, 2048, 0x80000020, blockA + 32]) {
        for (const m of [a, b]) {
          m.memory.fill(0xa5);
          m.shared.fill(0xa5);
          m.blocks[0].fill(0xa5);
        }
        put(old, destination);
        put(replacement, 4096);
        await run(0x388, [destination, 4096]);
      }
  for (const source of cases)
    for (const [dest, at] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [0, 8],
    ]) {
      for (const m of [a, b]) m.memory.fill(0xa5);
      put('old,prior,fields', dest);
      put(source, at);
      await run(0x388, [dest, at]);
    }
  for (const source of [...cases, 'x'.repeat(2046), ','.repeat(3000)]) {
    for (const m of [a, b]) m.memory.fill(0xa5);
    put(source, 0);
    put('@', 4096);
    await run(0x388, [0, 4096]);
  }
  const selections = [
    ...cases.filter((x) => !(typeof x === 'string' && x.includes('%'))),
    'base,123,-2,+3,0x10',
    'base,A,z, ',
    'x'.repeat(254),
    ',' + Array(60).fill('1').join(','),
    Uint8Array.of(97, 44, 0xff, 44, 0x80, 44, 0x7f, 44, 0x81, 0x30),
  ];
  for (const source of selections)
    for (const [at, destination] of [
      [4096, 0],
      [0, 0],
      [0, 1],
      [4096, 2048],
      [4096, 0x80000020],
      [4096, blockA + 32],
    ]) {
      for (const m of [a, b]) {
        m.memory.fill(0xa5);
        m.shared.fill(0xa5);
        m.blocks[0].fill(0xa5);
      }
      put(source, at);
      await run(0x256, [at, destination]);
    }
  // Execute the original shared 7914A0/629680 selector helper as well as its
  // KCS wrapper. Only the result's original written prefix is compared.
  for (const source of [
    ...selections,
    ...Array.from({ length: 256 }, (_, byte) => Uint8Array.of(98, 44, byte, 44, 49)),
  ]) {
    helperCalls++;
    const data = typeof source === 'string' ? encodeCP932(source) : source,
      input = p.allocate(data.length + 8),
      base = p.allocate(288),
      selectors = p.allocate(288),
      count = p.allocate(36);
    try {
      p.write(input, new Uint8Array(data.length + 8));
      p.write(input, data);
      for (const addr of [base, selectors, count])
        p.write(addr, new Uint8Array(addr === count ? 36 : 288).fill(0xa5));
      const found = await engine.call(profile.startsWith('sdk') ? 0x629680 : 0x7914a0, [
          input,
          base + 16,
          selectors + 16,
          count + 16,
        ]),
        parsed = parseNativeResourceSelection(data);
      check(found, Number(!!parsed), 'original selector helper success');
      check(p.load(count + 16), parsed?.selectors.length ?? 0, 'selector count');
      const expectedBase = new Uint8Array(288).fill(0xa5),
        expectedSelectors = new Uint8Array(288).fill(0xa5),
        expectedCount = new Uint8Array(36).fill(0xa5);
      expectedBase.set([...(parsed?.base ?? []), 0], 16);
      new DataView(expectedCount.buffer).setUint32(16, parsed?.selectors.length ?? 0, true);
      parsed?.selectors.forEach((word, index) =>
        new DataView(expectedSelectors.buffer).setInt32(16 + 4 * index, word, true),
      );
      check(p.read(base, 288), expectedBase, 'base raw bytes and whole allocation canaries');
      check(
        p.read(selectors, 288),
        expectedSelectors,
        'signed selector bytes and whole allocation canaries',
      );
      check(p.read(count, 36), expectedCount, 'count and whole allocation canaries');
      if (parsed)
        check(
          Array.from({ length: parsed.selectors.length }, (_, i) => p.load(selectors + 16 + i * 4)),
          Array.from(parsed.selectors, (x) => x >>> 0),
          'signed leading selector bytes',
        );
      for (const addr of [base, selectors, count])
        check(p.read(addr, 16), new Uint8Array(16).fill(0xa5), 'leading helper canary');
    } finally {
      p.free(count);
      p.free(selectors);
      p.free(base);
      p.free(input);
    }
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        profile,
        sha256,
        calls,
        helperCalls,
        comparisons,
        ids: [0x256, 0x388],
        scope:
          'Full original KCS wrappers, formatter, address translation and raw 7914A0/629680 selector helper. Raw UTF8/CP932/invalid bytes, repeated comma collapse, exact @ inheritance, signed byte selectors, alias, four VM regions, complete memory/canaries. Original scratch overflows are excluded.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Original comma fields differential ' +
      comparisons +
      '/' +
      comparisons +
      '; ' +
      calls +
      ' complete wrappers + ' +
      helperCalls +
      ' selector helpers',
  );
} finally {
  await engine.close();
}
