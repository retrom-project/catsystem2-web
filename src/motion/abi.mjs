// SPDX-License-Identifier: MPL-2.0
// Layout facts from the two frozen native profiles and the SDK p* KX2 scripts.
export const MOTION_ABI = Object.freeze({
  objectSize: 0x90,
  sharedSize: 1192,
  vram: 0x00,
  base: 0x0c,
  pos: 0x18,
  matrix: 0x24,
  scale: 0x64,
  color: 0x70,
  rotation: 0x74,
  vscale: 0x80,
  display: 0x8c,
  frame: 144,
  active: 148,
  skip: 152,
  registers: 156,
  registerCount: 256,
  extraData: 1180,
  extraSize: 1184,
  flags: 1188,
});

export function initialMotionObject() {
  const bytes = new Uint8Array(MOTION_ABI.objectSize);
  const view = new DataView(bytes.buffer);
  for (const index of [0, 5, 10, 15]) view.setFloat32(MOTION_ABI.matrix + index * 4, 1, true);
  for (let i = 0; i < 3; i++) view.setFloat32(MOTION_ABI.scale + i * 4, 1, true);
  view.setUint32(MOTION_ABI.color, 0xffffffff, true);
  view.setInt32(MOTION_ABI.display, 1, true);
  return bytes;
}

export function motionVector(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: 3 }, (_, i) => view.getFloat32(offset + i * 4, true));
}

export function setMotionVector(bytes, offset, vector) {
  if (vector.length !== 3) throw new Error('A motion vector requires three components');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  vector.forEach((value, i) => view.setFloat32(offset + i * 4, value, true));
}
