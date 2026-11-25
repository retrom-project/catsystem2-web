// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply, bitsFloat } from '../kcs/vm.mjs';
import { identity, multiplySSE, translation, scaling } from '../motion/matrix.mjs';
import { yawPitchRollX87 } from '../motion/native-rotation.mjs';
import { multiplyNativeMatrix } from './calculation-math.mjs';
import { matrixStorage, floats, floatBytes } from './calculation-memory.mjs';
import { nativeScalarMath } from './scalar-math.mjs';
export const NATIVE_MATRIX_OPERATIONS = Object.freeze([
  'matrix.rotateXYZ',
  'matrix.translate',
  'matrix.scale',
  'matrix.identity',
  'matrix.setYawPitchRoll',
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
export function nativeMatrix(
  operation,
  args,
  machine,
  state,
  multiply = multiplyNativeMatrix,
  useNativeReduction = false,
) {
  const count = operation === 'matrix.identity' ? 1 : 4;
  if (operation === 'matrix.rotateXYZ' && args.length === 0) {
    const storage = matrixStorage(machine, machine.nativeArgument(0), state);
    // An original MOT handler can still read the live stack after a zero-byte GCALL.
    // A rotation can alias the following angles, so write each axis before reading the next.
    for (let axis = 0; axis < 3; axis++) {
      const angle = machine.nativeArgument(axis + 1);
      const matrix = multiply(floats(storage.read()), rotation(axis, angle));
      storage.write(floatBytes(matrix));
    }
    return nativeReply(2);
  }
  if (args.length !== count) throw new Error(`${operation} expects ${count} arguments`);
  if (operation === 'matrix.setYawPitchRoll') {
    const output = machine.bytes(args[0], 64);
    output.set(floatBytes(yawPitchRollX87(...args.slice(1).map(bitsFloat), useNativeReduction)));
    return nativeReply(2);
  }
  const storage = matrixStorage(machine, args[0] >>> 0, state);
  let m = floats(storage.read());
  if (operation === 'matrix.identity') m = identity();
  else if (operation === 'matrix.rotateXYZ')
    for (let i = 0; i < 3; i++) m = multiply(m, rotation(i, args[i + 1]));
  else
    m = multiply(
      m,
      (operation === 'matrix.translate' ? translation : scaling)(...args.slice(1).map(bitsFloat)),
    );
  storage.write(floatBytes(m));
  return nativeReply(2);
}
export function installNativeMatrices(world) {
  const abi = nativeABI(world.profile),
    multiply = abi.math?.mainMatrixMultiplySSE ? multiplySSE : multiplyNativeMatrix;
  for (const entry of abi.tables.main.entries)
    if (NATIVE_MATRIX_OPERATIONS.includes(entry.name))
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeMatrix(
          entry.name,
          args,
          machine,
          world.calculations,
          multiply,
          abi.math?.d3dxUsesNativeReduction,
        ),
      );
}
