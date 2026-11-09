// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply, bitsFloat, floatBits } from '../kcs/vm.mjs';
import { roundX87Single as r } from '../ppi/x87.mjs';
import { inverseNativeMatrix } from './calculation-math.mjs';
import { matrixStorage, floats, floatBytes } from './calculation-memory.mjs';
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
export function nativeGeometry(operation, args, machine, argumentWords, state) {
  const words = Array.from(args);
  while (words.length < argumentWords) words.push(machine.nativeArgument(words.length));
  const [a, b] = words;
  if (operation === 'matrix.inverse') {
    const storage = matrixStorage(machine, a >>> 0, state),
      value = inverseNativeMatrix(floats(storage.read()));
    if (value) storage.write(floatBytes(value));
    return nativeReply(2);
  }
  if (operation === 'matrix.copy') {
    for (let i = 0; i < 64; i += 16) {
      const chunk = machine.bytes((b + i) >>> 0, 16).slice();
      machine.bytes((a + i) >>> 0, 16).set(chunk);
    }
    return nativeReply(2);
  }
  if (operation === 'vector4.add' || operation === 'vector4.subtract') {
    for (let i = 0; i < 4; i++) {
      const x = bitsFloat(machine.load((a + i * 4) >>> 0)),
        y = bitsFloat(machine.load((b + i * 4) >>> 0));
      machine.store((a + i * 4) >>> 0, floatBits(operation === 'vector4.add' ? x + y : x - y));
    }
    return nativeReply(2);
  }
  const v = read(machine, a, 4);
  let output;
  if (operation === 'vector4.lengthSquared') return nativeReply(1, floatBits(dot(v)));
  if (operation === 'vector4.length') return nativeReply(1, floatBits(Math.sqrt(dot(v))));
  if (operation === 'vector4.normalize') {
    const squared = f(r(r(r(r(v[0] * v[0]) + r(v[1] * v[1])) + r(v[2] * v[2])) + r(v[3] * v[3])));
    if (Math.abs(squared - 1) <= 2 ** -23) return nativeReply(2);
    const inverse = r(1 / r(Math.sqrt(squared)));
    output = squared > 2 ** -126 ? v.map((n) => f(r(n * inverse))) : v.map(() => 0);
  } else if (operation === 'vector4.scale') {
    const factor = bitsFloat(machine.load(b));
    output = v.map((n) => f(n * factor));
  } else {
    const m = read(machine, b, 16);
    output = Array.from({ length: 4 }, (_, i) =>
      f(r(r(r(r(v[0] * m[i]) + r(v[1] * m[i + 4])) + r(v[2] * m[i + 8])) + r(v[3] * m[i + 12]))),
    );
  }
  machine.bytes(a, 16).set(floatBytes(output));
  return nativeReply(2);
}
export function installNativeGeometry(world) {
  for (const entry of nativeABI(world.profile).tables.main.entries)
    if (NATIVE_GEOMETRY_OPERATIONS.includes(entry.name))
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeGeometry(
          entry.name,
          args,
          machine,
          entry.signature.argumentWords,
          world.calculations,
        ),
      );
}
