// SPDX-License-Identifier: MPL-2.0
// The original FES virtual adapters share the MOT manager, but expose distinct
// KX2 state for images, planes and alpha-only objects. Angles stay in radians.
import { MOTION_ABI } from '../motion/abi.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';
import {
  fesObjectFamily,
  markFESObjectDirty,
  setFESGraphicalPriority,
  setFESRawGraphicalDisplay,
} from './fes-common-model.mjs';

const scratch = new WeakMap(),
  alphaOnly = new Set([13, 14, 15, 23]),
  baseOnly = new Set([0, 7, 8, 24, 26, 27, 30, 31, 32, 34, 35, 38]),
  imagePosition = ['x', 'y'],
  imageBase = ['baseX', 'baseY'],
  imageScale = ['scaleX', 'scaleY'],
  planePosition = ['x', 'y', 'z'],
  planeBase = ['baseX', 'baseY', 'baseZ'],
  planeScale = ['scaleX', 'scaleY', 'scaleZ'],
  planeRotation = ['rotationX', 'rotationY', 'rotation'];
function workspace(object) {
  let state = scratch.get(object);
  if (!state) {
    const bytes = new Uint8Array(MOTION_ABI.objectSize);
    state = { bytes, view: new DataView(bytes.buffer) };
    scratch.set(object, state);
  }
  return state;
}
function matrixView(object) {
  if (!(object.motionMatrix instanceof Float32Array) || object.motionMatrix.length !== 16)
    throw new TypeError('FES plane matrix requires 16 float32 components');
  const state = workspace(object);
  if (state.matrix !== object.motionMatrix) {
    state.matrix = object.motionMatrix;
    state.matrixBytes = new Uint8Array(state.matrix.buffer, state.matrix.byteOffset, 64);
    state.matrixWords = new Uint32Array(state.matrix.buffer, state.matrix.byteOffset, 16);
  }
  return state;
}
function inputView(object, bytes) {
  const state = workspace(object);
  if (state.inputBuffer !== bytes.buffer || state.inputOffset !== bytes.byteOffset) {
    state.inputBuffer = bytes.buffer;
    state.inputOffset = bytes.byteOffset;
    state.inputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return state.inputView;
}
function vectorOut(view, offset, object, fields) {
  for (let index = 0; index < fields.length; index++)
    view.setFloat32(offset + index * 4, object[fields[index]], true);
}
function vectorIn(instance, object, view, offset, fields, w) {
  let changed = false;
  for (let index = 0; index < fields.length; index++) {
    const key = fields[index],
      value = view.getFloat32(offset + index * 4, true);
    if (object[key] !== value) changed = true;
  }
  if (w && object[w] !== 0) changed = true;
  if (changed) {
    for (let index = 0; index < fields.length; index++)
      object[fields[index]] = view.getFloat32(offset + index * 4, true);
    if (w) object[w] = 0;
    markFESObjectDirty(instance, object);
  }
}
// The returned buffer is borrowed, reused per owner and never checkpoint state.
export function fesMotionState(object) {
  const { bytes, view } = workspace(object),
    family = fesObjectFamily(object);
  bytes.fill(0);
  if (family === 'image') {
    vectorOut(view, MOTION_ABI.base, object, imageBase);
    view.setFloat32(MOTION_ABI.base + 8, ((object.pri | 0) - 20) | 0, true);
    vectorOut(view, MOTION_ABI.pos, object, imagePosition);
    vectorOut(view, MOTION_ABI.scale, object, imageScale);
    view.setFloat32(MOTION_ABI.scale + 8, 1, true);
    view.setFloat32(MOTION_ABI.rotation + 8, object.rotation, true);
    view.setUint32(MOTION_ABI.color, (object.alpha & 255) << 24, true);
    view.setInt32(MOTION_ABI.display, object.displayValue, true);
  } else if (family === 'plane') {
    vectorOut(view, MOTION_ABI.base, object, imageBase);
    // Snapshot base Z is priority; application writes it to local base Z and
    // leaves priority unchanged. PLANE's separate VRAM origin is not exposed.
    view.setFloat32(MOTION_ABI.base + 8, object.pri | 0, true);
    vectorOut(view, MOTION_ABI.pos, object, planePosition);
    vectorOut(view, MOTION_ABI.scale, object, planeScale);
    vectorOut(view, MOTION_ABI.rotation, object, planeRotation);
    bytes.set(matrixView(object).matrixBytes, MOTION_ABI.matrix);
    view.setUint32(MOTION_ABI.color, object.color, true);
    view.setInt32(MOTION_ABI.display, object.displayValue, true);
  } else if (alphaOnly.has(object.nativeType)) {
    view.setUint32(MOTION_ABI.color, (object.alpha & 255) << 24, true);
  } else if (baseOnly.has(object.nativeType)) return null;
  else throw new Error(`Unrecovered FES motion state for raw type ${object.nativeType}`);
  return bytes;
}

export function applyFESMotionState(instance, object, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== MOTION_ABI.objectSize)
    throw new TypeError('FES motion output requires exactly 144 KX2 bytes');
  const view = inputView(object, bytes),
    family = fesObjectFamily(object),
    alpha = view.getUint8(MOTION_ABI.color + 3);
  if (family === 'image') {
    vectorIn(instance, object, view, MOTION_ABI.pos, imagePosition);
    if (object.alpha !== alpha) {
      object.alpha = alpha;
      markFESObjectDirty(instance, object);
    }
    vectorIn(instance, object, view, MOTION_ABI.scale, imageScale);
    const angle = view.getFloat32(MOTION_ABI.rotation + 8, true);
    if (object.rotation !== angle) {
      object.rotation = angle;
      markFESObjectDirty(instance, object);
    }
    vectorIn(instance, object, view, MOTION_ABI.base, imageBase);
    setFESGraphicalPriority(
      instance,
      object,
      truncateFloat32(view.getFloat32(MOTION_ABI.base + 8, true)),
    );
    setFESRawGraphicalDisplay(instance, object, view.getInt32(MOTION_ABI.display, true));
  } else if (family === 'plane') {
    vectorIn(instance, object, view, MOTION_ABI.base, planeBase, 'baseW');
    vectorIn(instance, object, view, MOTION_ABI.pos, planePosition, 'positionW');
    const matrix = matrixView(object).matrixWords;
    let changed = false;
    for (let index = 0; index < 16; index++) {
      const word = view.getUint32(MOTION_ABI.matrix + index * 4, true);
      if (matrix[index] !== word) changed = true;
      matrix[index] = word;
    }
    if (changed) markFESObjectDirty(instance, object);
    // Rotation does not use the dirty setter, nor does it overwrite its W.
    for (let index = 0; index < 3; index++)
      object[planeRotation[index]] = view.getFloat32(MOTION_ABI.rotation + index * 4, true);
    vectorIn(instance, object, view, MOTION_ABI.scale, planeScale, 'scaleW');
    object.color = view.getUint32(MOTION_ABI.color, true);
    object.alpha = alpha;
    markFESObjectDirty(instance, object); // Original plane color setter is unconditional.
    setFESRawGraphicalDisplay(instance, object, view.getInt32(MOTION_ABI.display, true));
  } else if (alphaOnly.has(object.nativeType)) {
    object.alpha = alpha;
    if (object.nativeType === 13 || object.nativeType === 23) markFESObjectDirty(instance, object);
    else object.alphaPending = true;
  } else if (!baseOnly.has(object.nativeType))
    throw new Error(`Unrecovered FES motion output for raw type ${object.nativeType}`);
}
