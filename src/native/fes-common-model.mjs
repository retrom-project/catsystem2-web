// SPDX-License-Identifier: MPL-2.0
// Typed FES object state. Command tokenization, MOT execution and child tasks
// are separate from these setters; no guest memory is authoritative here.
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { fesCoordinateParent, fesPositionQuery } from './fes-image-model.mjs';

const images = new Set([1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25]),
  planes = new Set([3, 4, 21, 29, 33, 36, 37]),
  sizedImages = new Set([1, 2, 6, 11, 12, 22]),
  sizedPlanes = new Set([3, 4, 21, 29, 37]),
  clippedImages = new Set([1, 2, 6, 11, 12, 22, 25]),
  scratch = new WeakMap(),
  f = Math.fround;

export function fesObjectFamily(object) {
  const type = object.nativeType;
  return images.has(type)
    ? 'image'
    : planes.has(type)
      ? 'plane'
      : type >= 13 && type <= 15
        ? 'control'
        : type === 24 || type === 38
          ? 'log'
          : 'base';
}
function workspace(object) {
  let state = scratch.get(object);
  if (!state) {
    state = {
      pending: [],
      seen: new Set(),
      words: new Int32Array(3),
      position: new Float32Array(3),
    };
    scratch.set(object, state);
  }
  return state;
}

export function markFESObjectDirty(instance, object) {
  const { pending, seen } = workspace(object);
  pending.length = 0;
  seen.clear();
  pending.push(object);
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) throw new Error(`FES object parent cycle at ${current.key}`);
    seen.add(current);
    current.dirty = true;
    for (const child of instance.objects)
      if (!child.deleted && fesCoordinateParent(instance, child) === current) pending.push(child);
  }
}

export function setFESEnabled(object, value) {
  if (![6, 13, 14, 15].includes(object.nativeType)) return false;
  value = (value | 0) !== 0;
  if (object.enable !== value) {
    object.enable = value;
    object.dirty = true;
  }
  return true;
}
export function setFESGraphicalDisplay(instance, object, value) {
  return setFESRawGraphicalDisplay(instance, object, Number((value | 0) !== 0));
}
export function setFESRawGraphicalDisplay(instance, object, value) {
  if (!images.has(object.nativeType) && !planes.has(object.nativeType)) return false;
  value |= 0;
  if ((object.displayValue ?? Number(object.disp)) !== value) {
    object.displayValue = value;
    object.disp = value !== 0;
    if (images.has(object.nativeType))
      object.displayDelta = ((object.displayDelta ?? 0) + (value ? 1 : -1)) | 0;
    markFESObjectDirty(instance, object);
  }
  return true;
}
export function setFESGraphicalPriority(instance, object, value, definition = false) {
  value |= 0;
  if (images.has(object.nativeType)) {
    // The comparison uses the unadjusted request, even though the new raw
    // priority has a +20 bias. The retained-entry key changes only in #OBJECT.
    if (object.pri !== value) {
      object.oldPriority = object.pri | 0;
      object.priorityChanged = true;
      object.pri = (value + 20) | 0;
    }
    if (definition) object.renderID = value;
  } else if (planes.has(object.nativeType)) {
    object.pri = value;
    markFESObjectDirty(instance, object);
  } else return false;
  return true;
}

// The borrowed position is also the pPos register packet. The command layer
// must execute that real MOT program after applying the authored coordinates.
export function setFESGraphicalPosition(instance, object, values) {
  const family = fesObjectFamily(object);
  if (family !== 'image' && family !== 'plane') return null;
  const position = workspace(object).position;
  position[0] = f(values[0] === undefined ? truncateFloat32(object.x) : values[0] | 0);
  position[1] = f(values[1] === undefined ? truncateFloat32(object.y) : values[1] | 0);
  position[2] =
    family === 'image' ? 0 : f(values[2] === undefined ? truncateFloat32(object.z) : values[2] | 0);
  const changed =
    object.x !== position[0] ||
    object.y !== position[1] ||
    (family === 'plane' && (object.z !== position[2] || object.positionW !== 1));
  object.x = position[0];
  object.y = position[1];
  if (family === 'plane') {
    object.z = position[2];
    object.positionW = 1;
  }
  if (changed) markFESObjectDirty(instance, object);
  return position;
}
export function fesGraphicalPosition(instance, object, visible = false) {
  const family = fesObjectFamily(object);
  if (family !== 'image' && family !== 'plane') return null;
  if (visible) return fesPositionQuery(instance, object, family);
  const words = workspace(object).words;
  words[0] = truncateFloat32(object.x);
  words[1] = truncateFloat32(object.y);
  words[2] = family === 'image' ? 0 : truncateFloat32(object.z);
  return words;
}
export function setFESGraphicalSize(object, width, height) {
  width |= 0;
  height |= 0;
  if (sizedImages.has(object.nativeType)) {
    if (object.width !== width || object.height !== height) {
      object.width = width;
      object.height = height;
      object.sizeDirty = true;
    }
    if (!object.auxiliarySizeMode) {
      object.auxiliaryWidth = (width - 16) | 0;
      object.auxiliaryHeight = (height - 8) | 0;
    }
  } else if (sizedPlanes.has(object.nativeType)) {
    object.width = width;
    object.height = height;
    object.sizeDirty = true;
  } else return false;
  return true;
}
export function fesGraphicalSize(object) {
  if (!images.has(object.nativeType) && !sizedPlanes.has(object.nativeType)) return null;
  const words = workspace(object).words;
  words[0] = object.width | 0;
  words[1] = object.height | 0;
  words[2] = 0;
  return words;
}
export function fesGraphicalBase(object) {
  const family = fesObjectFamily(object);
  if (family !== 'image' && family !== 'plane') return null;
  const words = workspace(object).words;
  words[0] = truncateFloat32(object.baseX);
  words[1] = truncateFloat32(object.baseY);
  words[2] = family === 'image' ? 0 : truncateFloat32(object.baseZ);
  return words;
}
export function setFESImageClip(instance, object, x, y, width, height) {
  if (!clippedImages.has(object.nativeType)) return false;
  x |= 0;
  y |= 0;
  width |= 0;
  height |= 0;
  object.clip = [x, y, (x + width) | 0, (y + height) | 0];
  object.clipEnabled = true;
  markFESObjectDirty(instance, object);
  return true;
}
export function setFESImagePlane(instance, object, name, index) {
  if (!images.has(object.nativeType)) return false;
  index |= 0;
  const previous = object.planeReference;
  if (previous?.name !== name || previous?.index !== index) {
    object.planeReference = { name, index };
    markFESObjectDirty(instance, object);
  }
  return true;
}
export function setFESImageParentPlane(object, planeID) {
  if (!images.has(object.nativeType)) return false;
  object.parentPlaneID = planeID | 0;
  object.dirty = true;
  return true;
}

// Only the exact -1 sentinel suppresses an output. Other negative indices
// still reach the native variable-bank service (which marks itself dirty).
export function writeFESQuery(values, outputs, write) {
  if (!values) return;
  for (let index = 0; index < 3; index++)
    if (outputs[index] !== undefined && (outputs[index] | 0) !== -1)
      write(outputs[index] | 0, values[index] | 0);
}
