// SPDX-License-Identifier: MPL-2.0
import { bitsFloat, floatBits } from '../kcs/vm.mjs';
export const floatWords = (bytes) =>
  Array.from({ length: bytes.length / 4 }, (_, i) =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(i * 4, true),
  );
export const floats = (bytes) => floatWords(bytes).map(bitsFloat);
export function floatBytes(values) {
  const bytes = new Uint8Array(values.length * 4),
    view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, floatBits(value), true));
  return bytes;
}
export function writeCalculationBytes(machine, address, bytes) {
  if (machine.writeBytes) machine.writeBytes(address, bytes);
  else machine.bytes(address, bytes.length).set(bytes);
}
export function copyCalculationBytes(machine, target, source, count) {
  if (machine.copyBytes) machine.copyBytes(target, source, count);
  else machine.bytes(target, count).set(machine.bytes(source, count).slice());
}
export function matrixStorage(machine, address, state) {
  try {
    machine.region(address, 1);
  } catch (error) {
    if (!state) throw error;
    return { read: () => state.matrix.slice(), write: (bytes) => state.matrix.set(bytes) };
  }
  return {
    read: () => machine.bytes(address, 64).slice(),
    write: (bytes) => writeCalculationBytes(machine, address, bytes),
  };
}
