// SPDX-License-Identifier: MPL-2.0
// JS FES image selectors and coordinate queries. No executable/pointer state.
import { truncateFloat32 } from '../ppi/numeric.mjs';
const f = Math.fround;

export function createFESImageSelector() {
  return {
    idIndex: 0,
    usesIDTable: false,
    idTableChanged: true,
    imageChanged: false,
    ids: Array.from({ length: 32 }, (_, index) => index),
  };
}
export function setFESImageTable(state, index, value) {
  index >>>= 0;
  if (index > 31) return;
  state.ids[index] = value >>> 0;
  state.usesIDTable = true;
  state.idTableChanged = true;
}
export function setFESImageID(state, value) {
  value >>>= 0;
  if (state.usesIDTable && value > 31) return;
  if (state.idIndex === value && !state.idTableChanged) return;
  state.idTableChanged = false;
  state.imageChanged = true;
  state.idIndex = value;
}
export function fesImageFrameID(state) {
  return state.usesIDTable ? (state.ids[state.idIndex >>> 0] ?? 0) : state.idIndex >>> 0;
}

const imageParents = new Set([1, 2]),
  planeParents = new Set([3, 4, 21]),
  scratch = new WeakMap();
function workspace(object) {
  let state = scratch.get(object);
  if (!state) {
    state = { path: [], position: new Float32Array(3), words: new Int32Array(3) };
    scratch.set(object, state);
  }
  return state;
}
export function fesCoordinateParent(instance, object) {
  if (object.parentHandle !== undefined && object.parentHandle !== null) {
    for (const candidate of instance.objects)
      if (!candidate.deleted && candidate.handle === object.parentHandle) return candidate;
    return null;
  }
  if (!object.parent) return null;
  const parent = instance.byKey.get(object.parent) ?? instance.byKey.get(`${object.parent}[0]`);
  return parent?.deleted ? null : (parent ?? null);
}
function allowedParent(instance, current, allowed) {
  if (!current) return null;
  const parent = fesCoordinateParent(instance, current);
  return parent && allowed.has(parent.nativeType) ? parent : null;
}
function position(instance, object, family) {
  const state = workspace(object),
    allowed = family === 'image' ? imageParents : planeParents;
  // Detect cycles without a per-query Set or an arbitrary hierarchy limit.
  let slow = object,
    fast = object;
  do {
    slow = allowedParent(instance, slow, allowed);
    fast = allowedParent(instance, allowedParent(instance, fast, allowed), allowed);
    if (slow && slow === fast) throw new Error(`FES coordinate parent cycle at ${object.key}`);
  } while (fast);
  state.path.length = 0;
  for (let current = object; current; current = allowedParent(instance, current, allowed))
    state.path.push(current);
  const out = state.position;
  out.fill(0);
  // Original helpers recurse to the parent first. Reversing the arithmetic
  // changes cancellation at float32 boundaries, even for integer positions.
  for (let index = state.path.length - 1; index >= 0; index--) {
    const current = state.path[index];
    if (family === 'image') {
      out[0] = f(
        f(f(f(current.imageOriginX ?? 0) + f(current.x ?? 0)) - f(current.baseX ?? 0)) + out[0],
      );
      out[1] = f(
        f(f(f(current.imageOriginY ?? 0) + f(current.y ?? 0)) - f(current.baseY ?? 0)) + out[1],
      );
    } else {
      out[0] = f(f(current.x ?? 0) + out[0]);
      out[1] = f(f(current.y ?? 0) + out[1]);
      out[2] = f(f(current.z ?? 0) + out[2]);
    }
  }
  return out;
}
// Returned buffers are borrowed until the next query for this object. The
// FES record's authored state remains authoritative and checkpointable.
export function fesImagePosition(instance, object) {
  return position(instance, object, 'image');
}
export function fesPlanePosition(instance, object) {
  return position(instance, object, 'plane');
}
export function setFESButtonLock(instance, object, value) {
  if (object.nativeType !== 6) throw new Error('FES button lock requires a BUTTON');
  value >>>= 0;
  if (!object.buttonLock && value) {
    const point = fesImagePosition(instance, object);
    object.lockedPosition = [point[0], point[1]];
  }
  object.buttonLock = value;
}
export function fesPositionQuery(instance, object, family) {
  if (family !== 'image' && family !== 'plane')
    throw new Error(`Unknown FES position family ${family}`);
  const out = workspace(object).words;
  if (family === 'image' && object.nativeType === 6 && object.buttonLock) {
    if (!object.lockedPosition) throw new Error('FES BUTTON lock has no captured position');
    const parent = allowedParent(instance, object, imageParents),
      point = parent ? fesImagePosition(instance, parent) : null;
    // The captured visible position already included the parent at lock time;
    // the original locked query adds its current parent once more.
    out[0] = truncateFloat32(f(f(object.lockedPosition[0]) + (point?.[0] ?? 0)));
    out[1] = truncateFloat32(f(f(object.lockedPosition[1]) + (point?.[1] ?? 0)));
    out[2] = 0;
  } else {
    const source = position(instance, object, family);
    for (let index = 0; index < 3; index++) out[index] = truncateFloat32(source[index]);
  }
  return out;
}
