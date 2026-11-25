// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply, bitsFloat, floatBits } from '../kcs/vm.mjs';
import { roundX87Single as r } from '../ppi/x87.mjs';
import { quietFloat32Bits, x87Float32Arithmetic } from '../ppi/numeric.mjs';
import { inverseNativeMatrix, multiplyNativeMatrix } from './calculation-math.mjs';
import { matrixStorage, floats, floatBytes, floatWords } from './calculation-memory.mjs';
import { transformFloat32Pairs } from '../motion/matrix.mjs';
import {
  inverseSSEWords,
  multiplyMatrixSSEWords,
  normalizeSSEWords,
} from '../motion/native-sse.mjs';
const f = Math.fround;
export const NATIVE_GEOMETRY_OPERATIONS = Object.freeze([
  'matrix.inverse',
  'matrix.copy',
  'vector4.normalize',
  'vector4.add',
  'vector4.subtract',
  'vector4.length',
  'vector4.lengthSquared',
  'vector4.scale',
  'vector4.transform',
]);
const read = (m, a, n) => Array.from({ length: n }, (_, i) => bitsFloat(m.load((a + i * 4) >>> 0)));
const dot = (v) => f(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2])) + f(v[3] * v[3]));
const x87Dot = ([x, y, z, w]) => f(r(r(r(r(x * x) + r(y * y)) + r(z * z)) + r(w * w)));
function x87DotNaN(machine, address) {
  let result;
  for (let i = 0; i < 4; i++) {
    const word = machine.load((address + i * 4) >>> 0);
    if ((word & 0x7fffffff) <= 0x7f800000) continue;
    const squared = quietFloat32Bits(word);
    result = result === undefined ? squared : x87Float32Arithmetic('add', result, squared);
  }
  return result;
}
export function nativeGeometry(operation, args, machine, argumentWords, state, math) {
  if (math?.strictGeometryArity && args.length !== argumentWords)
    throw new Error(`Native ${operation} expects ${argumentWords} argument words`);
  const words = Array.from(args);
  while (words.length < argumentWords) words.push(machine.nativeArgument(words.length));
  const [a, b] = words;
  if (operation === 'matrix.inverse') {
    const storage = matrixStorage(machine, a >>> 0, state),
      bytes = storage.read(),
      value = math?.matrixInverseUsesSSEWords
        ? inverseSSEWords(floatWords(bytes))?.map(bitsFloat)
        : inverseNativeMatrix(floats(bytes));
    if (value) storage.write(floatBytes(value));
    return nativeReply(2);
  }
  if (operation === 'matrix.copy') {
    machine.bytes(a, 64);
    machine.bytes(b, 64);
    const width = math?.matrixCopyChunkBytes ?? 16;
    for (let i = 0; i < 64; i += width) {
      const chunk = machine.bytes((b + i) >>> 0, width).slice();
      machine.bytes((a + i) >>> 0, width).set(chunk);
    }
    return nativeReply(2);
  }
  if (operation === 'matrix.multiply') {
    const target = machine.bytes(a, 64),
      source = machine.bytes(b, 64);
    const value = math?.matrixMultiplyUsesSSEWords
      ? multiplyMatrixSSEWords(floatWords(target), floatWords(source)).map(bitsFloat)
      : multiplyNativeMatrix(floats(target), floats(source));
    target.set(floatBytes(value));
    return nativeReply(2);
  }
  if (['vector4.add', 'vector4.subtract', 'matrix.subtract'].includes(operation)) {
    const size = operation === 'matrix.subtract' ? 16 : 4,
      addition = operation === 'vector4.add';
    machine.bytes(a, size * 4);
    machine.bytes(b, size * 4);
    for (let i = 0; i < size; i++) {
      const target = (a + i * 4) >>> 0,
        x = machine.load(target),
        y = machine.load((b + i * 4) >>> 0);
      const value = math?.vectorWordArithmeticUsesX87
        ? x87Float32Arithmetic(addition ? 'add' : 'subtract', x, y)
        : floatBits(addition ? bitsFloat(x) + bitsFloat(y) : bitsFloat(x) - bitsFloat(y));
      machine.store(target, value);
    }
    return nativeReply(2);
  }
  machine.bytes(a, 16);
  const v = read(machine, a, 4);
  let output;
  if (operation === 'vector4.length' || operation === 'vector4.lengthSquared') {
    const nan = math?.vectorWordArithmeticUsesX87 ? x87DotNaN(machine, a) : undefined;
    if (nan !== undefined) return nativeReply(1, nan);
    const squared = math?.vectorLengthUsesX87 ? x87Dot(v) : dot(v);
    return nativeReply(1, floatBits(operation === 'vector4.length' ? Math.sqrt(squared) : squared));
  }
  if (operation === 'vector4.normalize' && math?.vectorNormalizeUsesSSEWords) {
    const target = machine.bytes(a, 16);
    target.set(floatBytes(normalizeSSEWords(floatWords(target)).map(bitsFloat)));
    return nativeReply(2);
  }
  if (operation === 'vector4.normalize') {
    const squared = x87Dot(v);
    if (Math.abs(squared - 1) <= 2 ** -23) return nativeReply(2);
    const inverse = r(1 / r(Math.sqrt(squared)));
    output = squared > 2 ** -126 ? v.map((n) => f(r(n * inverse))) : v.map(() => 0);
  } else if (operation === 'vector4.scale') {
    const factorWord = machine.load(b);
    if (math?.vectorWordArithmeticUsesX87) {
      for (let i = 0; i < 4; i++) {
        const target = (a + i * 4) >>> 0;
        machine.store(target, x87Float32Arithmetic('multiply', machine.load(target), factorWord));
      }
      return nativeReply(2);
    }
    const factor = bitsFloat(factorWord);
    output = v.map((n) => f(n * factor));
  } else {
    machine.bytes(b, 64);
    const m = read(machine, b, 16);
    if (
      math?.vectorTransformRequiresFinite &&
      (!v.every(Number.isFinite) || !m.every(Number.isFinite))
    )
      throw new RangeError('Native vector transform requires finite matrix and vector operands');
    if (math?.vectorTransformPairwise) output = transformFloat32Pairs(v, m);
    else
      output = Array.from({ length: 4 }, (_, i) => {
        const x = r(v[0] * m[i]),
          y = r(v[1] * m[i + 4]),
          z = r(v[2] * m[i + 8]),
          w = r(v[3] * m[i + 12]);
        if (math?.vectorTransformWFirst)
          return i === 0 ? f(r(r(r(w + y) + z) + x)) : f(r(r(r(w + y) + x) + z));
        return f(r(r(r(x + y) + z) + w));
      });
  }
  machine.bytes(a, 16).set(floatBytes(output));
  return nativeReply(2);
}
export function installNativeGeometry(world) {
  const abi = nativeABI(world.profile);
  for (const entry of abi.tables.main.entries)
    if (NATIVE_GEOMETRY_OPERATIONS.includes(entry.name))
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeGeometry(
          entry.name,
          args,
          machine,
          entry.signature.argumentWords,
          world.calculations,
          abi.math,
        ),
      );
}
