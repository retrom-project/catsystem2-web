// SPDX-License-Identifier: MPL-2.0
// BUTTON's attachment, directional reader and initial mouse-hit helper. References
// and controls belong to the existing FES collection; this module owns no state.
import { fesPositionQuery, fesCoordinateParent, fesPlanePosition } from './fes-image-model.mjs';
import { setFESControlValue } from './fes-control-model.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { bitmapSample } from './bitmap-pixels.mjs';

export function validateFESButtonInitialHandle(entry) {
  const handle = entry.initialHandle;
  if (!Number.isInteger(handle) || (handle !== 0 && (handle < 0x1001 || handle > 0xfffffffe)))
    throw new Error('FES BUTTON resource has no valid initial semantic handle');
}

export async function findFESInitialButton(instance, world, point, live) {
  if (typeof live !== 'function' || !instance.runtime?.resources || !instance.collection?.graph)
    throw new TypeError('FES initial hit requires its owning runtime, graph and call liveness');
  const entries = instance.runtime.resources.entries,
    reference = (entry) => ({ nameBytes: new Uint8Array(entry.nameBytes), index: entry.index | 0 });
  try {
    for (let at = 0; at < entries.length; at++) {
      if (!live()) return null;
      const entry = entries[at];
      if (entry.savedType !== 6) continue;
      validateFESButtonInitialHandle(entry);
      if (entry.initialHandle === 0) continue;
      const object = instance.collection.graph.get(entry.initialHandle);
      if (!object)
        throw new Error('FES mouse-hit reads a deleted initial BUTTON before resource cleanup');
      if (object.nativeType !== 6)
        throw new Error('FES mouse-hit initial identity is not a BUTTON');
      const position = fesPositionQuery(instance, object, 'image'),
        left = position[0],
        top = position[1],
        right = (left + (object.width | 0)) | 0,
        bottom = (top + (object.height | 0)) | 0;
      if (!(point[0] >= left && point[0] < right && point[1] >= top && point[1] < bottom)) continue;
      if (!object.buttonType) return reference(entry);
      if (!object.imageAuxiliaryBitmap && !object.imageResource) return reference(entry);
      const handle = world.imagesFES.currentBitmap(object);
      if (!handle) throw new Error('FES mouse-hit alpha wrapper has a NULL bitmap buffer');
      const bitmap = world.graphics.images.get(handle),
        bpp = bitmap.state.bpp,
        color =
          bpp === 2 || bpp === 3 || bpp === 4
            ? await bitmapSample(bitmap, (point[0] - left) | 0, (point[1] - top) | 0, true)
            : 0;
      if (!live()) return null;
      if (entries[at] !== entry || instance.collection.graph.get(entry.initialHandle) !== object)
        throw new Error('FES mouse-hit initial identity changed during its pixel query');
      if (color >>> 24) return reference(entry);
    }
    return null;
  } catch (error) {
    if (live()) throw error;
    return null;
  }
}

export function setFESButtonAttachment(object, reference) {
  if (object.nativeType !== 6) throw new TypeError('FES attachment requires a BUTTON');
  object.buttonAttachment =
    reference === null
      ? null
      : { nameBytes: new Uint8Array(reference.nameBytes), index: reference.index | 0 };
}

// The optional object-reference parser returns failure for an empty original
// name or an unclosed index. Numeric evaluation errors and undefined empty []
// outputs remain errors; they must not become an attachment clear.
export function readFESButtonAttachment(bytes, reference, diagnostic) {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0 && bytes[end] !== 32 && bytes[end] !== 91) end++;
  if (!end) return null;
  if (bytes[end] === 91) {
    let close = end + 1;
    while (close < bytes.length && bytes[close] !== 0 && bytes[close] !== 32 && bytes[close] !== 93)
      close++;
    if (close - end > 511) throw new RangeError('FES object index exceeds its512-byte destination');
    if (bytes[close] !== 93) {
      diagnostic('FES attach object reference has no closing bracket');
      return null;
    }
  }
  return reference();
}

const enabled = (object) => object?.nativeType === 6 && object.enable && !object.deleted;
const emptyResult = () => ({ button: null, controlChanged: false });

export function fesButtonCursorPoint(instance, object) {
  // The caller queries virtual slot+20 with initial XY=0, adds KEYPOS, then
  // optionally adds an exposing PLANE's integer position. It never assigns a
  // region's active field or moves the virtual pointer directly.
  const parent = fesCoordinateParent(instance, object),
    f = Math.fround;
  let x, y;
  if (!object.buttonLock && (parent?.nativeType === 3 || parent?.nativeType === 4)) {
    const point = fesPlanePosition(instance, parent),
      px = f(point[0] - f(parent.baseX)),
      py = f(point[1] - f(parent.baseY));
    x = truncateFloat32(f(f(f(f(object.imageOriginX) + f(object.x)) - f(object.baseX)) + px));
    y = truncateFloat32(f(f(f(f(object.imageOriginY) + f(object.y)) - f(object.baseY)) + py));
  } else [x, y] = fesPositionQuery(instance, object, 'image');
  x = (x + (object.auxiliaryWidth | 0)) | 0;
  y = (y + (object.auxiliaryHeight | 0)) | 0;
  const ref = object.planeReference,
    plane = ref ? instance.collection.lookup(ref.nameBytes ?? ref.name, ref.index) : null;
  if ((plane?.nativeType === 3 || plane?.nativeType === 4) && plane.planeProperty) {
    const point = fesPlanePosition(instance, plane);
    x = (x + truncateFloat32(point[0])) | 0;
    y = (y + truncateFloat32(point[1])) | 0;
  }
  return [x, y];
}

function adjustAttachment(instance, source, direction) {
  const ref = source.buttonAttachment;
  if (ref === null) return false;
  if (!ref) throw new Error('FES BUTTON has no initialized attachment state');
  const object = instance.collection.lookup(ref.nameBytes, ref.index),
    type = object?.nativeType;
  if (type !== 13 && type !== 14 && type !== 15) return false;
  // SCROLL's value getter consumes its pending flag even if this direction or
  // bound prevents a new value. The other two getters do not consume it.
  const current = object.value | 0;
  if (type === 13) object.valuePending = false;
  const horizontal = type === 13 ? !!object.controlType : !object.direction,
    negative = horizontal ? 2 : 0;
  if (direction !== negative && direction !== negative + 1) return false;
  const value = (current + (direction === negative ? -1 : 1)) | 0,
    maximum = ((object.maximum | 0) - (type === 15 ? 0 : object.pageSize | 0)) | 0;
  if (value === current || value < (object.minimum | 0) || value > maximum) return false;
  setFESControlValue(object, value, 1);
  return true;
}

export function navigateFESButton(instance, reference, direction) {
  const collection = instance.collection;
  if (!collection) throw new TypeError('FES navigation requires its canonical collection');
  if (!Number.isInteger(direction) || direction < 0 || direction > 3)
    throw new RangeError('FES navigation requires direction0..3');
  let source = reference ? collection.lookup(reference.nameBytes, reference.index) : null;
  if (!enabled(source)) return emptyResult();
  let { block = -1, x = 0, y = 0 } = source.keyblock ?? {};
  if (block < 0) return emptyResult();
  const blocks = instance.program.keyblocks,
    count = instance.program.keyblockCount ?? blocks.length,
    areaFor = (index) => {
      const area = index >= 0 && index < count ? blocks[index] : null;
      if (!area) throw new Error('FES KEYBLOCK navigation reads an undefined block');
      return area;
    },
    objects = collection.ordered(),
    cell = (block, x, y) => {
      // A disabled first matching cell masks a later same-cell BUTTON. The
      // original lookup returns before the separate enable check in the reader.
      const object = objects.find(
        (o) =>
          o.nativeType === 6 &&
          o.keyblock?.block === block &&
          o.keyblock.x === x &&
          o.keyblock.y === y,
      );
      return enabled(object) ? object : null;
    },
    nearest = (origin, block) => {
      const point = fesPositionQuery(instance, origin, 'image'),
        x = Math.fround(point[0]),
        y = Math.fround(point[1]);
      let distance = 100000000,
        result = null;
      for (const object of objects) {
        if (!enabled(object) || object.keyblock?.block !== block) continue;
        const p = fesPositionQuery(instance, object, 'image'),
          dx = Math.fround(x - Math.fround(p[0])),
          dy = Math.fround(y - Math.fround(p[1])),
          squared = Math.fround(Math.fround(Math.fround(dy * dy) + Math.fround(dx * dx)) + 0);
        if (squared < distance) {
          distance = squared;
          result = object;
        }
      }
      return result;
    };
  if (direction < 2) y = (y + (direction === 0 ? -1 : 1)) | 0;
  else x = (x + (direction === 2 ? -1 : 1)) | 0;
  let attachmentEligible = true;
  for (;;) {
    const area = areaFor(block),
      vertical = direction < 2,
      step = direction % 2 ? 1 : -1;
    for (
      let major = vertical ? y : x;
      step < 0 ? major >= 0 : major < (vertical ? area.height : area.width);
      major = (major + step) | 0
    ) {
      if (vertical) y = major;
      else x = major;
      let button = cell(block, x, y);
      if (button) return { button, controlChanged: false };
      const cross = vertical ? x : y,
        extent = vertical ? area.width : area.height;
      for (
        let lower = (cross - 1) | 0, upper = (cross + 1) | 0;
        lower >= 0 || upper < extent;
        lower--, upper++
      ) {
        // Both horizontal branches actually pass (cross,y), not (x,cross).
        // Preserve those original argument slots instead of imposing symmetry.
        if (lower >= 0) button = cell(block, lower, y);
        if (!button && upper < extent) button = cell(block, upper, y);
        if (button) return { button, controlChanged: false };
      }
    }
    if (attachmentEligible && adjustAttachment(instance, source, direction))
      return { button: null, controlChanged: true };
    attachmentEligible = false;
    const seen = new Set();
    let next;
    for (;;) {
      if (seen.has(block)) throw new Error('FES KEYBLOCK has an empty cyclic direction chain');
      seen.add(block);
      const link = areaFor(block).links[direction];
      if (link < 0 || link >= count) return emptyResult();
      block = link;
      next = nearest(source, block);
      if (next) break;
    }
    source = next;
    ({ block, x, y } = source.keyblock);
  }
}
