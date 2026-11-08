// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeEngineProcess, NATIVE_ENGINE_IMAGES } from '../src/native/engine-process.mjs';
import { NativeScalarMath, NATIVE_SCALAR_MATH_CONTRACTS } from '../src/native/scalar-math.mjs';
import { captureFloatingPoint } from '../src/ppi/floating-point.mjs';
import { floatBits } from '../src/kcs.mjs';

export async function verifyScalarMath(bytes, profile) {
  const original = await NativeEngineProcess.open({ bytes, profile }),
    engine = await NativeEngineProcess.open({ bytes, profile }),
    math = new NativeScalarMath(engine),
    index = Number(profile.startsWith('sdk-')),
    inputs = [
      0,
      0x80000000,
      floatBits(1),
      floatBits(-1),
      floatBits(0.5),
      floatBits(-0.5),
      floatBits(2),
      floatBits(3),
      floatBits(Math.PI),
      floatBits(12345.125),
      1,
      0x80000001,
      0x007fffff,
      0x00800000,
      0x7f7fffff,
      0xff7fffff,
      0x7f800000,
      0xff800000,
      0x7fc12345,
      0xffc12345,
      0x7fa00001,
      0xffffffff,
      0x12345678,
      0x87654321,
    ],
    cases = new Map();
  let calls = 0,
    comparisons = 0;
  const check = (a, b, label) => {
    assert.deepEqual(a, b, label);
    comparisons++;
  };
  function configure(process, word) {
    process.cpu.reg_write_i32(process.uc.X86_REG_FPTAG, 0xffff);
    process.cpu.reg_write_i32(process.uc.X86_REG_FPSW, 0);
    process.cpu.reg_write_i32(process.uc.X86_REG_FPCW, word);
    process.cpu.reg_write_i32(process.uc.X86_REG_MXCSR, 0x1f80 | (((word >> 10) & 3) << 13));
  }
  async function reference(spec, args) {
    const p = original.process,
      argv = p.allocate(args.length * 4),
      out = p.allocate(12);
    try {
      args.forEach((v, i) => p.store(argv + i * 4, v));
      p.write(out, new Uint8Array(12).fill(0xcc));
      const control = await original.call(spec.handlers[index], [0, 0, argv, out + 4]);
      check([p.load(out), p.load(out + 8)], [0xcccccccc, 0xcccccccc], 'original output canaries');
      return { control, value: p.load(out + 4) };
    } finally {
      p.free(out);
      p.free(argv);
    }
  }
  try {
    for (const base of [0x7f, 0x37f])
      for (const rounding of [0, 0x400, 0x800, 0xc00]) {
        const control = base | rounding;
        for (const spec of NATIVE_SCALAR_MATH_CONTRACTS.filter((item) => !item.memory))
          for (let i = 0; i < inputs.length; i++) {
            const words = inputs.slice(i, i + 1);
            if (spec.words === 2) words.push(inputs[(i * 7 + 3) % inputs.length]);
            configure(original.process, control);
            configure(engine.process, control);
            const before = words.slice(),
              expected = await reference(spec, words),
              actual = await math.apply(spec.id, words, null, { id: 1 });
            calls++;
            cases.set(spec.id, (cases.get(spec.id) ?? 0) + 1);
            check(actual, expected, `reply/${spec.name}/${control.toString(16)}/${i}`);
            check(words, before, 'caller argument words');
            check(
              captureFloatingPoint(engine.process),
              captureFloatingPoint(original.process),
              'complete original floating-point context',
            );
            if (spec.id === 0x36a)
              check(actual.value, ((words[0] & 65535) | (words[1] << 16)) >>> 0, 'packed DWORD');
            if (spec.id === 0x40)
              check(actual.value, Math.abs(words[0] | 0) >>> 0, 'signed absolute DWORD');
          }
      }
    for (const spec of NATIVE_SCALAR_MATH_CONTRACTS.filter((item) => !item.memory)) {
      const frame = [floatBits(0.75), floatBits(2)],
        machine = { nativeArgument: (i) => frame[i] };
      configure(original.process, 0x37f);
      configure(engine.process, 0x37f);
      const expected = await reference(spec, frame),
        actual = await math.apply(spec.id, [], machine, { id: 1 });
      calls++;
      cases.set(spec.id, (cases.get(spec.id) ?? 0) + 1);
      check(actual, expected, 'adjacent argument frame');
      // One-argument wrappers allocate only their actually read word here;
      // the resulting x87 data pointer can differ from the reference buffer.
      check(
        engine.process.cpu.reg_read_i32(engine.process.uc.X86_REG_FPCW),
        original.process.cpu.reg_read_i32(original.process.uc.X86_REG_FPCW),
        'adjacent caller control',
      );
    }
    return {
      profile,
      calls,
      comparisons,
      covered: Object.fromEntries([...cases].map(([id, n]) => [id.toString(16), n])),
      scope:
        'All eighteen complete main scalar wrappers, raw f32/integer words, signed zero, infinities, qNaN/sNaN payloads, denormals, domain errors and limits. Eight masked x87 precision/rounding configurations with matched MXCSR, original output canaries and complete x87/SIMD context are compared; adjacent native argument reads are separate.',
    };
  } finally {
    await engine.close();
    await original.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filename, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: verify-native-scalar-math.mjs FIXED_EXE IGNORED_REPORT');
  const bytes = new Uint8Array(await readFile(filename)),
    sha256 = createHash('sha256').update(bytes).digest('hex'),
    profile = Object.keys(NATIVE_ENGINE_IMAGES).find(
      (key) => NATIVE_ENGINE_IMAGES[key].sha256 === sha256,
    );
  if (!profile) throw new Error('Scalar math requires a frozen engine');
  const result = await verifyScalarMath(bytes, profile);
  await writeFile(output, JSON.stringify({ ...result, sha256 }, null, 2) + '\n');
  console.log(`Scalar math passed ${result.calls} calls/${result.comparisons} comparisons`);
}
