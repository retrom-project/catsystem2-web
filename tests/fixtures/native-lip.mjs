// SPDX-License-Identifier: MPL-2.0
// Independently authored lip records. No game sidecar is redistributed.
export function nativeLPB() {
  const bytes = new Uint8Array(20 + 8 * 32),
    data = new DataView(bytes.buffer);
  data.setUint32(0, 0x0044504c, true);
  data.setUint32(4, 1, true);
  data.setUint32(8, 32, true);
  data.setUint32(12, 8, true);
  data.setFloat32(16, -100, true);
  for (let frame = 0; frame < 8; frame++) {
    data.setUint32(20 + frame * 32, frame, true);
    data.setUint32(24 + frame * 32, (frame % 5) + 1, true);
    data.setFloat32(48 + frame * 32, -20 - frame * 10, true);
  }
  return bytes;
}

export function nativeLV() {
  return new Uint8Array(Float32Array.of(0, 1, 0.25, 0.5, 0.75, 0, 1, 0).buffer);
}

export function nativeLipWAV() {
  const rate = 22050,
    count = rate * 4,
    bytes = new Uint8Array(44 + count * 2),
    data = new DataView(bytes.buffer);
  for (const [at, text] of [
    [0, 'RIFF'],
    [8, 'WAVEfmt '],
    [36, 'data'],
  ])
    bytes.set(new TextEncoder().encode(text), at);
  data.setUint32(4, bytes.length - 8, true);
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  data.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++)
    data.setInt16(44 + i * 2, Math.round(Math.sin((i * 2 * Math.PI * 220) / rate) * 4096), true);
  return bytes;
}
