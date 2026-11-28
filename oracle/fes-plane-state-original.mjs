// SPDX-License-Identifier: MPL-2.0
// FES object/task and retained drawing bridge: 628D60 / 62DA50,
// 65D1D0 / 661940 (planes), 65CD40 / 65E110 (CPU image entries).
import { MOTION_ABI, setMotionVector } from '../src/motion/abi.mjs';
import { objectMotionState } from '../src/motion/target.mjs';
import { identity, multiply } from '../src/motion/matrix.mjs';

const f = Math.fround;
function planeChain(instance, object) {
  const result = [];
  let parent = instance.plane(object);
  while (parent) {
    if (result.includes(parent) || result.length >= 64)
      throw new Error(`FES plane cycle at ${object.key}`);
    result.push(parent);
    parent = instance.plane(parent);
  }
  return result;
}
export function planeState(instance, object) {
  const bytes = objectMotionState(object),
    parents = planeChain(instance, object);
  const pos = [object.x, object.y, object.z],
    base = [object.baseX, object.baseY, object.pri];
  const scale = [object.scaleX, object.scaleY, object.scaleZ];
  let matrix = identity();
  for (const parent of parents.toReversed()) {
    if (parent.isPlane)
      for (let i = 0; i < 3; i++) pos[i] = f(pos[i] + [parent.x, parent.y, parent.z][i]);
    if (parent.type === 'PLANE') {
      base[0] = f(base[0] + parent.baseX);
      base[1] = f(base[1] + parent.baseY);
      for (let i = 0; i < 3; i++)
        scale[i] = f(scale[i] * [parent.scaleX, parent.scaleY, parent.scaleZ][i]);
      if (parent.motionMatrix) matrix = multiply(matrix, parent.motionMatrix);
    }
  }
  if (object.motionMatrix) matrix = multiply(matrix, object.motionMatrix);
  setMotionVector(bytes, MOTION_ABI.pos, pos);
  setMotionVector(bytes, MOTION_ABI.base, base);
  setMotionVector(bytes, MOTION_ABI.scale, scale);
  setMotionVector(bytes, MOTION_ABI.vram, [0, 0, 0]);
  matrix.forEach((v, i) =>
    new DataView(bytes.buffer).setFloat32(MOTION_ABI.matrix + i * 4, v, true),
  );
  return bytes;
}
