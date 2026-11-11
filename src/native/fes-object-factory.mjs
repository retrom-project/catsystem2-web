// SPDX-License-Identifier: MPL-2.0
// Typed construction is pure: actual World resources are allocated separately.
import { FESObject } from '../fes/object.mjs';
import { FES_OBJECT_TYPES } from '../fes/types.mjs';
import { fesObjectFamily } from './fes-common-model.mjs';
import { initializeFESControl } from './fes-control-model.mjs';
import { initializeFESLog } from './fes-log-model.mjs';

const effects = new Set([7, 8, 26, 27, 30, 31, 32]);
export function initializeFESPlane(object) {
  Object.assign(object, {
    x: 0,
    y: 0,
    z: 0,
    positionW: 1,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseW: 1,
    rotationX: 0,
    rotationY: 0,
    rotation: 0,
    rotationW: 1,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    scaleW: 1,
    motionMatrix: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
    width: 800,
    height: 600,
    pri: 5000,
    disp: false,
    displayValue: 0,
    color: 0xffffffff,
    alpha: 255,
    planeType: 1,
    planeProperty: 0,
    positionReference: null,
    sizeReference: null,
    positionPending: false,
    sizePending: false,
    sizeDirty: false,
    resourceFile: '',
    resourcePending: false,
    blendMode: 0,
  });
  if (object.nativeType === 4)
    Object.assign(object, {
      vramX: 0,
      vramY: 0,
      vramZ: 0,
      vramW: 1,
      currentCount: 0,
      beforeCount: 0,
    });
  return object;
}
export function initializeFESParticle(object) {
  Object.assign(object, {
    particleProgram: '',
    particleTexture: '',
    particleCount: 0,
    pri: 0,
    particleFamily: 0,
    particleRegisters: new Float32Array(32),
    alpha: 255,
    allocationDirty: false,
    commonDirty: false,
    pendingStart: false,
    pendingStop: false,
    running: false,
    attachment: null,
    attachmentDirty: false,
  });
  return object;
}

// Existing sound/text/M2 authorities specialize their own tails. The image
// driver supplies its shared pure initializer rather than a second default set.
export function createFESTypedObject(identity, { initializeImage, initializeSpecial } = {}) {
  const declared = identity.type,
    expected = declared === 'BASE' ? 0 : FES_OBJECT_TYPES[declared],
    raw = declared === 'VIEW' ? 0 : expected;
  if (expected === undefined || identity.nativeType !== raw)
    throw new Error(`Invalid FES declaration/raw type ${declared}/${identity.nativeType}`);
  if (raw === FES_OBJECT_TYPES.NUMIMG)
    throw new Error('FES NUMIMG registers a group but does not construct an object');
  if (raw === FES_OBJECT_TYPES.EFKPLANE)
    throw new Error('FES EFKPLANE has no registered JavaScript implementation');
  const object = new FESObject(
    declared === 'BASE' ? 'VIEW' : declared,
    identity.baseName,
    identity.index,
    identity.handle,
  );
  Object.assign(object, identity, { nativeType: raw, enable: true, dirty: false, motionDelay: 0 });
  const family = fesObjectFamily(object);
  let specialized = false;
  if (family === 'image') {
    if (typeof initializeImage !== 'function')
      throw new Error('FES image pure initializer is missing');
    initializeImage(object);
    specialized = [11, 12, 25].includes(raw);
  } else if (raw === 3 || raw === 4) initializeFESPlane(object);
  else if (raw >= 13 && raw <= 15) initializeFESControl(object);
  else if (raw === 24 || raw === 38) initializeFESLog(object);
  else if (raw === 23) initializeFESParticle(object);
  else if (raw !== 0 && raw !== 34 && raw !== 35 && !effects.has(raw)) specialized = true;
  if (specialized) {
    if (typeof initializeSpecial !== 'function' || initializeSpecial(object) !== true)
      throw new Error(`FES ${declared} requires its pure family initializer`);
  }
  return object;
}
