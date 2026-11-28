// SPDX-License-Identifier: MPL-2.0
// Original permissive lead-byte walker. The final continuation is not checked.
export function nativeUTF8Step(read, at) {
  const lead = read(at);
  let ones = 0;
  while (ones < 6 && lead & (0x80 >>> ones)) ones++;
  if (ones === 1) return -2;
  const follow = ones === 6 ? 0 : Math.max(0, ones - 1);
  for (let i = 1; i < follow; i++) if ((read(at + i) & 0xc0) !== 0x80) return -3;
  return follow + 1;
}
export function readNativeCString(machine, address) {
  const bytes = [];
  for (let i = 0; ; i++) {
    const byte = machine.load((address + i) >>> 0, 1);
    if (!byte) return Uint8Array.from(bytes);
    bytes.push(byte);
  }
}
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
export function nativeUTF16(bytes) {
  const units = [],
    read = (i) => bytes[i] ?? 0;
  for (let at = 0; read(at); ) {
    if (read(at) === 255 && read(at + 1) === 255) {
      units.push(65535);
      at += 2;
      continue;
    }
    const step = nativeUTF8Step(read, at);
    if (step <= 0) break;
    const text = decoder.decode(bytes.subarray(at, at + step));
    units.push(text.charCodeAt(0) || 0);
    at += step;
  }
  const nul = units.indexOf(0);
  return String.fromCharCode(...(nul < 0 ? units : units.slice(0, nul)));
}
