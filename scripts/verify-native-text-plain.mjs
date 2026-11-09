// SPDX-License-Identifier: MPL-2.0
// Full original main188 wrapper versus the shared original-parser adapter.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeTextRuntime } from '../src/native/text.mjs';
import { nativePlainText } from '../src/native/text-plain.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { Binary } from '../src/binary.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
const [filename, output] = process.argv.slice(2);
if (!output)
  throw new Error('Usage: node scripts/verify-native-text-plain.mjs FIXED_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = createHash('sha256').update(bytes).digest('hex'),
  profile = Object.entries(NATIVE_ENGINE_IMAGES).find(([, image]) => image.sha256 === sha256)?.[0];
if (!profile) throw new Error('Plain-text oracle requires a frozen engine image');
const engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  sdk = profile.startsWith('sdk'),
  runtime = new NativeTextRuntime(engine, {
    glyphs: {
      measure: (_font, text) => ({
        width: text.length * 8,
        height: 16,
        ascent: 12,
        descent: 4,
        averageWidth: 8,
        maximumWidth: 16,
      }),
    },
  }),
  machine = new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(32768),
    stackSize: 1024,
  }),
  memory = p.allocate(machine.memory.length),
  argv = p.allocate(8),
  out = p.allocate(4),
  world = {
    profile,
    runtime: { services: { formatBytes: () => formatted } },
    getNativeFeature: async () => runtime,
  },
  sources = [
    '',
    'Authored plain text.',
    '猫と日本語。',
    'a\nb\rc\td',
    'a\\nb',
    'a\\@b',
    'a\\pb',
    'a\\wb',
    'a\\_b',
    'a\\[b',
    'a\\cb',
    'a\\c(255,0,0)b',
    'a\\c[255,0,0]b',
    'a\\r(猫,ねこ)b',
    'a\\r[猫,ねこ]b',
    'a<ruby>猫</ruby>b',
    'a\\{猫|ねこ\\}b',
    'a\\s(20)b',
    'a\\s[20]b',
    'a\\v[3]b',
    'a\\b',
    'a\\',
    '(a b)',
    'a'.repeat(512),
    new TextEncoder().encode('UTF-8 猫 и 中文'),
    Uint8Array.of(0x80, 65, 0x81, 0x7f, 0xff, 66),
  ];
let formatted = new Uint8Array(),
  passed = 0;
engine.patch(
  sdk ? 0x8a6510 : 0x876ea0,
  'authored plain-text formatter boundary',
  2,
  ([, target]) => {
    p.write(target, Uint8Array.from([...formatted, 0]));
    return 1;
  },
  { calleePops: true },
);
engine.patch(
  sdk ? 0x8a6910 : 0x8772a0,
  'authored plain-text VM address boundary',
  1,
  ([address]) => (address < machine.memory.length ? memory + address : 0),
  { calleePops: true },
);
try {
  for (const id of sdk ? [0x188] : [0x188, 0x419])
    for (const source of sources)
      for (const destination of [0, 16, 8192, 0xffffffff]) {
        formatted = typeof source === 'string' ? encodeCP932(source) : source;
        machine.memory.fill(0xa5);
        machine.bytes(16, formatted.length + 1).set([...formatted, 0]);
        p.write(memory, machine.memory);
        p.store(argv, destination);
        p.store(argv + 4, 16);
        p.store(out, 0xcafebabe);
        const control = await engine.call(
            p.load(NATIVE_EXE_PROFILES[profile].tables.main.va + id * 4),
            [0, 0, argv, out],
          ),
          expected = await nativePlainText(id, [destination, 16], machine, world);
        assert.deepEqual(
          { control, value: p.load(out) },
          expected,
          'original complete wrapper result',
        );
        passed++;
        assert.deepEqual(
          p.read(memory, machine.memory.length),
          machine.memory,
          `full output/canaries ${Buffer.from(formatted).toString('hex')}/${destination}`,
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
          'Original full main188 constructor, formatting boundary, rich-text parsing/layout, extraction, strlen and destructor versus the shared-process adapter. Text parser/defaults and Windows text services execute through the reviewed native runtime. Authored plain/CP932/UTF-8/invalid bytes, control/escape/ruby spellings, empty/long source, aliases, mapped zero, unmapped destination and full canaries. Pixel/font fidelity is not asserted by this text-output test.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original plain-text differential ${passed}/${passed}`);
} finally {
  await runtime.close();
  await engine.close();
}
