// SPDX-License-Identifier: MPL-2.0
// Typed control state; World resources, child tasks and driver consumption
// remain separate from these value and geometry operations.
import { markFESObjectDirty } from './fes-common-model.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';

const scratch = new WeakMap(),
  fields = [
    'file',
    'x',
    'y',
    'width',
    'height',
    'vramX',
    'vramY',
    'pri',
    'planePriority',
    'controlType',
    'direction',
    'value',
    'minimum',
    'maximum',
    'pageSize',
    'disp',
    'enable',
    'alpha',
    'dirty',
    'filePending',
    'pagePending',
    'valuePending',
    'valueNotify',
    'alphaPending',
    'tablePending',
  ];

export function isFESControl(object) {
  return object.nativeType >= 13 && object.nativeType <= 15;
}
function requireControl(object) {
  if (!isFESControl(object)) throw new TypeError('Expected an FES SCROLL, SCROLL2 or SLIDER');
}
function workspace(object) {
  let state = scratch.get(object);
  if (!state) {
    state = {
      position: new Int32Array(3),
      range: new Int32Array(object.nativeType === 15 ? 2 : 3),
      load: {
        kind: object.nativeType + 27,
        drawID: null,
        file: '',
        priority: 10,
        planePriority: 1000,
        type: 0,
        x: 0,
        y: 0,
        vramX: 0,
        vramY: 0,
        rect: new Int32Array(4),
        planeX: 0,
        planeY: 0,
      },
    };
    scratch.set(object, state);
  }
  return state;
}

// Creation does not load a resource or create an input/draw child. Definition
// application calls the typed setters below; defaults are not explicit PRI 0.
export function initializeFESControl(object) {
  requireControl(object);
  Object.assign(object, {
    file: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    vramX: 0,
    vramY: 0,
    pri: 10,
    planePriority: 1000,
    controlType: 0,
    direction: 0,
    value: 0,
    minimum: 0,
    maximum: 0,
    pageSize: 0,
    disp: false,
    enable: true,
    alpha: 255,
    filePending: false,
    pagePending: false,
    valuePending: false,
    valueNotify: 0,
    alphaPending: false,
    tablePending: false,
    planeReference: null,
    skinTable: [0, 0, 2, 3],
  });
  return object;
}
export function setFESControlFile(object, file) {
  if (!isFESControl(object)) return false;
  object.file = String(file);
  object.filePending = true;
  return true;
}
export function setFESControlPriority(object, value) {
  if (!isFESControl(object)) return false;
  object.pri = ((value | 0) + 20) | 0;
  return true;
}
export function setFESControlPlanePriority(object, value) {
  if (object.nativeType !== 13) return false;
  object.planePriority = value | 0;
  return true;
}
export function setFESControlType(object, value) {
  if (object.nativeType !== 13) return false;
  // The original setter only stores TYPE. It does not itself request reload.
  object.controlType = value | 0;
  return true;
}
export function setFESControlOrigin(instance, object, x, y) {
  if (object.nativeType !== 13) return false;
  object.x = x | 0;
  object.y = y | 0;
  markFESObjectDirty(instance, object);
  return true;
}
export function setFESControlVRAM(instance, object, x, y) {
  if (object.nativeType !== 13) return false;
  object.vramX = x | 0;
  object.vramY = y | 0;
  markFESObjectDirty(instance, object);
  return true;
}
export function setFESControlRect(instance, object, left, top, right, bottom) {
  if (object.nativeType !== 14 && object.nativeType !== 15) return false;
  object.x = left | 0;
  object.y = top | 0;
  object.width = ((right | 0) - object.x) | 0;
  object.height = ((bottom | 0) - object.y) | 0;
  markFESObjectDirty(instance, object);
  return true;
}
export function setFESControlDisplay(instance, object, value) {
  if (!isFESControl(object)) return false;
  object.disp = (value | 0) !== 0;
  markFESObjectDirty(instance, object);
  return true;
}
export function setFESControlPage(object, minimum, maximum, pageSize) {
  if (!isFESControl(object)) return false;
  object.minimum = minimum | 0;
  object.maximum = maximum | 0;
  if (object.nativeType !== 15) object.pageSize = pageSize | 0;
  object.pagePending = true;
  return true;
}
export function setFESControlValue(object, value, notify = 0) {
  if (!isFESControl(object)) return false;
  object.value = value | 0;
  object.valueNotify = notify | 0;
  object.valuePending = true;
  return true;
}
export function setFESControlSkin(object, slot, frame) {
  if ((object.nativeType !== 14 && object.nativeType !== 15) || slot >>> 0 > 3) return false;
  object.skinTable[slot >>> 0] = frame | 0;
  object.tablePending = true;
  return true;
}

// pos/getpos is the control's FES value, never the author's screen origin.
// The result is borrowed and is reused per object.
export function fesControlPosition(object) {
  if (!isFESControl(object)) return null;
  const out = workspace(object).position;
  out[0] = object.value | 0;
  out[1] = out[2] = 0;
  return out;
}
export function fesControlRangePacket(object) {
  requireControl(object);
  const out = workspace(object).range;
  out[0] = object.minimum | 0;
  out[1] = object.maximum | 0;
  if (out.length === 3) out[2] = object.pageSize | 0;
  return out;
}

// drawID is a World identity. This packet deliberately contains no PE pointer,
// native namespace identity, input area ID, retained key or FES object handle.
// POS2 resolution has already called Origin/Rect; a PL link only accepts PLANE4.
export function fesControlLoadPacket(object, drawID, plane = null) {
  requireControl(object);
  const out = workspace(object).load;
  out.drawID = drawID;
  out.file = object.file;
  out.priority = object.pri | 0;
  out.planePriority = object.planePriority | 0;
  out.type = object.controlType | 0;
  out.x = object.x | 0;
  out.y = object.y | 0;
  out.vramX = object.vramX | 0;
  out.vramY = object.vramY | 0;
  out.rect[0] = out.x;
  out.rect[1] = out.y;
  out.rect[2] = (out.x + (object.width | 0)) | 0;
  out.rect[3] = (out.y + (object.height | 0)) | 0;
  out.planeX = plane?.nativeType === 4 ? truncateFloat32(plane.x) : 0;
  out.planeY = plane?.nativeType === 4 ? truncateFloat32(plane.y) : 0;
  return out;
}
export function snapshotFESControl(object) {
  requireControl(object);
  const out = {};
  for (const field of fields) out[field] = object[field];
  out.skinTable = object.skinTable.slice();
  out.planeReference = object.planeReference && { ...object.planeReference };
  return out;
}
export function restoreFESControl(object, snapshot) {
  requireControl(object);
  for (const field of fields) object[field] = snapshot[field];
  object.skinTable = snapshot.skinTable.slice();
  object.planeReference = snapshot.planeReference && { ...snapshot.planeReference };
  return object;
}
