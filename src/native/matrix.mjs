// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply, bitsFloat, floatBits } from '../kcs/vm.mjs';
import { identity, translation, scaling } from '../motion/matrix.mjs';
import { yawPitchRollSSE, yawPitchRollX87 } from '../motion/native-rotation.mjs';
import { multiplyNativeMatrix } from './calculation-math.mjs';
import { matrixStorage, floats, floatBytes, floatWords } from './calculation-memory.mjs';
import { nativeTrigWord } from './scalar-math.mjs';
import { multiplyMatrixSSEWords } from '../motion/native-sse.mjs';
export const NATIVE_MATRIX_OPERATIONS = Object.freeze([
  'matrix.rotateXYZ',
  'matrix.translate',
  'matrix.scale',
  'matrix.identity',
  'matrix.setYawPitchRoll',
]);
function rotation(axis, word, useNativeWords) {
  const angle = bitsFloat(word),
    outsideHardwareRange = Number.isFinite(angle) && Math.abs(angle) >= 2 ** 63;
  // FSINCOS leaves the original value in ST0 when reduction cannot finish.
  const c = outsideHardwareRange ? angle : bitsFloat(nativeTrigWord('cos', word, useNativeWords)),
    s = outsideHardwareRange
      ? useNativeWords
        ? bitsFloat(0xffc00000)
        : 0
      : bitsFloat(nativeTrigWord('sin', word, useNativeWords));
  const m = identity();
  if (axis === 0) [m[5], m[6], m[9], m[10]] = [c, s, -s, c];
  if (axis === 1) [m[0], m[2], m[8], m[10]] = [c, -s, s, c];
  if (axis === 2) [m[0], m[1], m[4], m[5]] = [c, s, -s, c];
  return m;
}

export function nativeMatrix(operation, args, machine, state, math) {
  const multiply = (left, right) =>
    floatBytes(
      math?.matrixMultiplyUsesSSEWords
        ? multiplyMatrixSSEWords(floatWords(left), right.map(floatBits)).map(bitsFloat)
        : multiplyNativeMatrix(floats(left), right),
    );
  if (operation === 'matrix.rotateXYZ' && args.length === 0) {
    const storage = matrixStorage(machine, machine.nativeArgument(0), state);
    // The original interpreter forwards a live cursor even with no explicit words.
    for (let axis = 0; axis < 3; axis++) {
      const angle = machine.nativeArgument(axis + 1);
      storage.write(
        multiply(storage.read(), rotation(axis, angle, math?.axisRotationUsesX87Words)),
      );
    }
    return nativeReply(2);
  }
  const count = operation === 'matrix.identity' ? 1 : 4;
  if (args.length !== count) throw new Error(`${operation} expects ${count} arguments`);
  if (operation === 'matrix.setYawPitchRoll' || operation === 'matrix.rotateYawPitchRoll') {
    const output = machine.bytes(args[0], 64),
      angles = args.slice(1),
      matrix = math?.yawPitchRollUsesSSEWords
        ? yawPitchRollSSE(...angles)
        : yawPitchRollX87(...angles.map(bitsFloat), math?.d3dxUsesNativeReduction);
    output.set(
      operation === 'matrix.setYawPitchRoll' ? floatBytes(matrix) : multiply(output, matrix),
    );
    return nativeReply(2);
  }
  const storage = matrixStorage(machine, args[0] >>> 0, state);
  if (operation === 'matrix.identity') storage.write(floatBytes(identity()));
  else if (operation === 'matrix.rotateXYZ') {
    for (let axis = 0; axis < 3; axis++)
      storage.write(
        multiply(storage.read(), rotation(axis, args[axis + 1], math?.axisRotationUsesX87Words)),
      );
  } else {
    const makeMatrix = operation === 'matrix.translate' ? translation : scaling;
    storage.write(multiply(storage.read(), makeMatrix(...args.slice(1).map(bitsFloat))));
  }
  return nativeReply(2);
}

export function installNativeMatrices(world) {
  const abi = nativeABI(world.profile);
  for (const entry of abi.tables.main.entries)
    if (NATIVE_MATRIX_OPERATIONS.includes(entry.name))
      world.runtime.register('main', entry.id, (args, machine) =>
        nativeMatrix(entry.name, args, machine, world.calculations, abi.math),
      );
}
