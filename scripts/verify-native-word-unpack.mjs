// SPDX-License-Identifier: MPL-2.0
// Compare both full original 36B wrappers and every byte of caller VM storage.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Binary } from '../src/binary.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { transitionalExe } from '../web/transitional-entry.mjs';
import { scalarHandler } from '../oracle/scalar-handlers.mjs';
import { captureFloatingPoint } from '../src/ppi/floating-point.mjs';
import {
  NativeEngineProcess,
  NATIVE_ENGINE_IMAGES,
  nativeImageIdentity,
} from '../src/native/engine-process.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeScalarMath, NATIVE_SCALAR_MATH_CONTRACTS } from '../src/native/scalar-math.mjs';

export async function verifyWordUnpacking(bytes, profile) {
  const original = await NativeEngineProcess.open({ bytes, profile }),
    engine = await NativeEngineProcess.open({ bytes, profile }),
    scalar = new NativeScalarMath(engine, undefined, transitionalExe),
    spec = NATIVE_SCALAR_MATH_CONTRACTS.find((item) => item.id === 0x36b),
    handler = scalarHandler(profile, spec.id),
    create = () => {
      const machine = new KCSMachine(
        {
          body: new Binary(Uint8Array.of(59)),
          codeSize: 1,
          data: new Uint8Array(128),
          stackSize: 384,
        },
        {},
        new Uint8Array(64),
      );
      machine.allocate(20);
      machine.allocate(12);
      for (const [region, memory] of [machine.memory, machine.shared, ...machine.blocks].entries())
        memory.set(Array.from(memory, (_, i) => (i * 37 + region * 41 + 13) & 255));
      machine.fp = 256;
      return machine;
    },
    contents = (machine) => [
      machine.memory.slice(),
      machine.shared.slice(),
      ...machine.blocks.map((memory) => memory.slice()),
    ],
    destinations = [
      [0, 4],
      [5, 9],
      [128, 508],
      [0x80000000, 0x8000003c],
      [512, 540],
      [31, 31],
      [32, 33],
      [33, 32],
    ],
    inputs = [
      0, 1, 0x7fff, 0x8000, 0xffff, 0x7fff8000, 0x80007fff, 0x80000000, 0xffffffff, 0xabcd1234,
    ];
  let seed = 0x36b17a4,
    calls = 0,
    comparisons = 0;
  for (let i = 0; i < 128; i++) inputs.push((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0));
  const check = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    comparisons++;
  };
  async function reference(machine, words) {
    const p = original.process,
      bridge = new NativeKCSMemory(p, machine),
      argv = p.allocate(12),
      out = p.allocate(12);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.write(out, new Uint8Array(12).fill(0xcc));
      const control = await original.call(handler, [bridge.pointer, 0, argv, out + 4]);
      check(
        p.read(out, 12),
        new Uint8Array(12).fill(0xcc),
        'original leaves the caller result untouched',
      );
      return { control };
    } finally {
      bridge.close();
      p.free(out);
      p.free(argv);
    }
  }
  try {
    check(
      original.process.load(NATIVE_EXE_PROFILES[profile].tables.main.va + 0x36b * 4),
      handler,
      'frozen original main table entry',
    );
    for (const value of inputs)
      for (const [low, high] of destinations) {
        const a = create(),
          b = create(),
          literal = create(),
          words = [value, low, high],
          baseline = engine.process.allocations.size;
        const expected = await reference(a, words),
          actual = await scalar.apply(0x36b, words, b, { id: 1 });
        literal.store(low, (value << 16) >> 16);
        literal.store(high, value >> 16);
        check(actual, expected, 'original void control code');
        check(contents(b), contents(a), 'all data, stack, shared, block and canary bytes');
        check(
          contents(b),
          contents(literal),
          'signed halves and overlapping destination write order',
        );
        check(words, [value, low, high], 'caller argument words');
        check(
          captureFloatingPoint(engine.process),
          captureFloatingPoint(original.process),
          'unmodified native floating-point context',
        );
        check(engine.process.allocations.size, baseline, 'temporary bridge ownership');
        calls++;
      }
    const a = create(),
      b = create(),
      words = [0x8000ffff, 0x80000003, 516];
    words.forEach((word, i) => b.store(256 + i * 4, word));
    b.nativeArgumentBase = 256;
    words.forEach((word, i) => a.store(256 + i * 4, word));
    const expected = await reference(a, words),
      actual = await scalar.apply(0x36b, [], b, { id: 1 });
    check(actual, expected, 'adjacent original native argument frame');
    check(contents(b), contents(a), 'adjacent frame complete memory');
    calls++;
    return {
      profile,
      calls,
      comparisons,
      scope:
        'Complete original 36B wrapper and translator; signed low/high halves, zero valid address, unaligned, overlapping and identical outputs, stack/shared/two extended blocks, all caller bytes, adjacent argument reads, FP context and temporary allocation ownership.',
    };
  } finally {
    await engine.close();
    await original.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filename, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: verify-native-word-unpack.mjs FIXED_EXE IGNORED_REPORT');
  const bytes = new Uint8Array(await readFile(filename)),
    sha256 = await nativeImageIdentity(bytes),
    profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
      (id) => NATIVE_ENGINE_IMAGES[id].sha256 === sha256,
    );
  if (!profile) throw new Error('Word unpacking requires a frozen engine');
  const result = await verifyWordUnpacking(bytes, profile);
  await writeFile(output, JSON.stringify({ ...result, sha256 }, null, 2) + '\n');
  console.log(`Word unpacking passed ${result.calls} calls/${result.comparisons} comparisons`);
}
