// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply, bitsFloat } from '../kcs/vm.mjs';
import { identity, translation, scaling } from '../motion/matrix.mjs';
import { multiplyNativeMatrix } from './calculation-math.mjs';
import { matrixStorage, floats, floatBytes } from './calculation-memory.mjs';
import { nativeScalarMath } from './scalar-math.mjs';
export const NATIVE_MATRIX_OPERATIONS = Object.freeze([
  'matrix.rotateXYZ',
  'matrix.translate',
  'matrix.scale',
  'matrix.identity',
]);
function rotation(axis, word) {
  // D3DX uses FSINCOS directly. Outside its finite argument range the
  // pinned oracle leaves the operand on top; its second pop reads zero.
  // The scalar CRT path performs range reduction and is not interchangeable.
  const angle = bitsFloat(word),
    outOfRange = Number.isFinite(angle) && Math.abs(angle) >= 2 ** 63,
    c = outOfRange ? angle : bitsFloat(nativeScalarMath('math.cos', [word], null, 1).value),
    s = outOfRange ? 0 : bitsFloat(nativeScalarMath('math.sin', [word], null, 1).value),
    m = identity();
  if (axis === 0) [m[5], m[6], m[9], m[10]] = [c, s, -s, c];
  if (axis === 1) [m[0], m[2], m[8], m[10]] = [c, -s, s, c];
  if (axis === 2) [m[0], m[1], m[4], m[5]] = [c, s, -s, c];
  return m;
}
export function nativeMatrix(operation, args, machine, state) {
  const count = operation === 'matrix.identity' ? 1 : 4;
  if (args.length !== count) throw new Error(`${operation} expects ${count} arguments`);
  const storage = matrixStorage(machine, args[0] >>> 0, state);
  let m = floats(storage.read());
  if (operation === 'matrix.identity') m = identity();
  else if (operation === 'matrix.rotateXYZ')
    for (let i = 0; i < 3; i++) m = multiplyNativeMatrix(m, rotation(i, args[i + 1]));
  else
    m = multiplyNativeMatrix(
      m,
      (operation === 'matrix.translate' ? translation : scaling)(...args.slice(1).map(bitsFloat)),
    );
  storage.write(floatBytes(m));
  return nativeReply(2);
}
export function installNativeMatrices(world) {
  world.calculations = { matrix: new Uint8Array(64) };
  for (const entry of nativeABI(world.profile).tables.main.entries)
    if (NATIVE_MATRIX_OPERATIONS.includes(entry.name))
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeMatrix(entry.name, args, machine, world.calculations),
      );
}
