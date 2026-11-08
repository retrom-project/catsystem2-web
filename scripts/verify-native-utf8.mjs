// SPDX-License-Identifier: MPL-2.0
// Original game415/416/41B wrappers versus the VM/process address adapter.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { nativeUTF8 } from '../src/native/utf8.mjs';
import { NATIVE_PROFILES } from '../src/native/catalog.mjs';
import { KCSMachine, encodeCP932 } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
const [filename, output] = process.argv.slice(2),
  profile = 'nekopara-vol3-engine-2.6.1.76';
if (!output)
  throw new Error('Usage: node scripts/verify-native-utf8.mjs FIXED_GAME_EXE IGNORED_REPORT');
const bytes = new Uint8Array(await readFile(filename)),
  sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
assert.equal(sha256, NATIVE_ENGINE_IMAGES[profile].sha256, 'frozen game image');
const engine = await NativeEngineProcess.open({ profile, bytes }),
  p = engine.process,
  make = () => {
    const m = new KCSMachine(
      {
        body: new Binary(Uint8Array.of(59)),
        codeSize: 1,
        data: new Uint8Array(8192),
        stackSize: 1024,
      },
      undefined,
      new Uint8Array(4096),
    );
    m.allocate(4096);
    return m;
  },
  source = make(),
  model = make(),
  world = { profile, ensureNativeEngine: async () => engine, objects: { machine: () => null } },
  argv = p.allocate(8),
  out = p.allocate(4),
  sources = ['', 'a', 'abc', '猫', 'a猫b', '猫と日本語', '😀a猫', 'a'.repeat(128)],
  compare = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    passed++;
  },
  state = (m) => [m.memory.slice(), m.shared.slice(), ...m.blocks.map((b) => b.slice())];
let passed = 0;
async function run(id, args) {
  const bridge = new NativeKCSMemory(p, source);
  let expected;
  try {
    args.forEach((word, i) => p.store(argv + i * 4, word));
    p.store(out, 0xcccccccc);
    expected = {
      control: await engine.call(p.load(NATIVE_PROFILES[profile].tables.main.va + id * 4), [
        bridge.pointer,
        0,
        argv,
        out,
      ]),
      value: p.load(out),
    };
  } finally {
    bridge.close();
  }
  compare(
    await nativeUTF8(id, args, model, { id: 10 }, world),
    expected,
    'complete original wrapper return',
  );
  compare(state(model), state(source), 'all VM data/stack/shared/block bytes and canaries');
}
try {
  for (const address of [256, 0x80000100, source.memory.length + 256])
    for (const text of sources) {
      const input = new TextEncoder().encode(text),
        reset = () => {
          for (const m of [source, model]) {
            m.memory.fill(0xa5);
            m.shared.fill(0xa5);
            m.blocks[0].fill(0xa5);
            m.bytes(address, input.length + 1).set([...input, 0]);
          }
        };
      for (const id of [0x415, 0x416])
        for (const limit of [0, 1, 2, 3, 4, 5, 6, 8, 10, 32, 0xffffffff]) {
          reset();
          await run(id, [address, limit]);
        }
      for (const needle of ['', 'a', '猫', 'b', '日本語', 'missing', 'a'.repeat(4001)]) {
        reset();
        const encoded = encodeCP932(needle);
        for (const m of [source, model]) m.bytes(2048, encoded.length + 1).set([...encoded, 0]);
        await run(0x41b, [address, 2048]);
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
          'Complete original UTF-8 415/416/41B handlers, permissive original byte walker, SSO conversion, Windows NLS calls and original CRT. VM/process adapter compared across data/shared/extension-block domains with full canaries. Covers empty/ASCII/Japanese/supplementary text, unsigned limits, byte/character truncation, CP932 search keys, absent/empty keys and over-4000 key branch. Undefined original conversion-buffer overflow and malformed UTF-8 underflow are not asserted.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Original UTF-8 adapter differential ${passed}/${passed}`);
} finally {
  await engine.close();
}
