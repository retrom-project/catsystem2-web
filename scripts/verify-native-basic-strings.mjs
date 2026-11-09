// SPDX-License-Identifier: MPL-2.0
// Original main 0D..18 wrappers, formatter and translator versus the VM primitives.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, encodeCP932, formatNativeAt } from '../src/kcs.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { nativeStandard } from '../src/native/standard.mjs';

const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-basic-strings.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('String oracle requires a frozen engine image');

const engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  table = NATIVE_PROFILES[profile].tables.main.va,
  make = () => {
    const m = new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(4096),
        stackSize: 2048,
      },
      undefined,
      new Uint8Array(4096),
    );
    m.fp = 4096;
    m.allocate(4096);
    return m;
  },
  original = make(),
  model = make(),
  domains = [0, 0x80000000, original.memory.length],
  argv = p.allocate(8),
  outputWord = p.allocate(4),
  services = { formatBytes: formatNativeAt };

const backing = (m) => [m.memory, m.shared, ...m.blocks],
  put = (m, at, input) => {
    const data = typeof input === 'string' ? encodeCP932(input) : input;
    m.bytes(at, data.length + 1).set([...data, 0]);
  },
  reset = (fixture) => {
    for (const m of [original, model]) {
      for (const region of backing(m)) region.fill(0xa5);
      m.store(2048, 42);
      m.store(m.fp + 128, 78);
      put(m, 0x80000600, '猫 %04d[G2048]');
      fixture(m);
    }
  };
let calls = 0,
  comparisons = 0;
async function check(id, args, label, fixture) {
  reset(fixture);
  const bridge = new NativeKCSMemory(p, original);
  let reference;
  try {
    args.forEach((arg, i) => p.store(argv + i * 4, arg));
    p.store(outputWord, 0xcccccccc);
    reference = {
      control: await engine.call(p.load(table + id * 4), [bridge.pointer, 0, argv, outputWord]),
      value: p.load(outputWord),
    };
  } finally {
    bridge.close();
  }
  const caseName = `0x${id.toString(16)} ${label} [${args.map((a) => a.toString(16)).join(', ')}]`;
  assert.deepEqual(nativeStandard(id, args, model, services), reference, caseName);
  comparisons++;
  for (const [i, actual] of backing(model).entries()) {
    const expected = backing(original)[i];
    if (!Buffer.from(actual).equals(Buffer.from(expected))) {
      const offset = actual.findIndex((byte, at) => byte !== expected[at]);
      assert.fail(
        `${caseName} region ${i} offset ${offset}: actual ${Buffer.from(actual.subarray(offset, offset + 12)).toString('hex')}, original ${Buffer.from(expected.subarray(offset, offset + 12)).toString('hex')}`,
      );
    }
    comparisons++;
  }
  calls++;
}

try {
  const inputs = [
    '',
    'a',
    'ABCde',
    '猫B',
    'a猫日本語b',
    new TextEncoder().encode('UTF-8 猫'),
    Uint8Array.of(0x80, 0x81, 0x7f, 0xef, 0x80, 0x81, 0xfc, 0x81, 0xfd, 0xf0, 0x40, 0xff),
    '%% %04d[G2048] %d[L128] %s[H1536]',
  ];
  for (const [i, input] of inputs.entries())
    for (const domain of domains) {
      const source = domain + 64,
        target = domains[(domains.indexOf(domain) + 1) % domains.length] + 320,
        fixture = (m) => {
          put(m, source, input);
          put(m, target, 'aBC猫');
        };
      for (const id of [0x0d, 0x0e, 0x0f, 0x10, 0x13, 0x14, 0x15, 0x16])
        await check(id, [target, source], `separate input ${i}`, fixture);
      for (const id of [0x11, 0x12]) await check(id, [source], `length ${i}`, fixture);
      for (const id of [0x17, 0x18])
        for (const limit of [0, 1, 2, 3, 4, 5, 8, 16, 0xffffffff])
          await check(id, [source, limit], `truncate ${i}`, fixture);
    }
  for (const id of [0x0d, 0x0e, 0x10])
    for (const [target, source] of [
      [64, 64],
      [63, 64],
      [0, 64],
    ])
      await check(id, [target, source], 'mapped zero or alias', (m) => put(m, source, 'abcde'));
  for (const [target, source, input] of [
    [64, 64, 'abc'],
    [64, 64, 'abcde'],
    [65, 64, 'abcd'],
    [65, 64, 'abcde'],
    [70, 64, 'abcdefghijk'],
    [64, 67, 'abcd'],
  ])
    await check(0x0f, [target, source], 'forward overlapping append', (m) => {
      put(m, Math.min(source, target), input);
      m.store(96, 0, 1);
    });
  for (const id of [0x14, 0x16])
    for (const length of [1022, 1023, 1024, 1025, 1037])
      await check(id, [64, 0x80000040], 'formatted comparison scratch boundary', (m) => {
        put(m, 64, 'a'.repeat(length));
        put(m, 0x80000040, 'a'.repeat(1024));
      });
  await writeFile(
    output,
    JSON.stringify({ profile, sha256, calls, comparisons, slots: '0D..18' }, null, 2) + '\n',
  );
  console.log(`Original basic strings: ${calls} calls, ${comparisons} comparisons`);
} finally {
  await engine.close();
}
