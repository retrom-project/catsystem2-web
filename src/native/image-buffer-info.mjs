// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';

const signed16 = (b, at) => (b.u16(at) << 16) >> 16;

function* hg3Frames(b) {
  let at = 12;
  for (let count = 0; count < 10000; count++) {
    const next = b.u32(at),
      id = b.u32(at + 4);
    let tag = at + 8,
      fields = null;
    for (let tags = 0; tags < 10000; tags++) {
      const step = b.u32(tag + 8);
      if (b.str(tag, 8, 'utf-8') === 'stdinfo') {
        const p = tag + 16;
        fields = [
          b.i32(p + 12),
          b.i32(p + 16),
          b.i32(p),
          b.i32(p + 4),
          b.i32(p + 20),
          b.i32(p + 24),
          Math.trunc(signed16(b, p + 8) / 8),
          b.i32(p + 32),
          b.i32(p + 36),
        ];
        break;
      }
      if (!step) break;
      if (step < 16) throw new Error('Invalid HG3 metadata tag link');
      tag += step;
    }
    yield { id, fields };
    if (!next) return;
    if (next < 8) throw new Error('Invalid HG3 metadata frame link');
    at += next;
  }
  throw new Error('HG3 metadata frame limit exceeded');
}
function* hg2Frames(b) {
  const version = signed16(b, 8);
  if (![16, 32, 37].includes(version)) return;
  let at = 12;
  for (let count = 0; count < 10000; count++) {
    const extended = version !== 16,
      next = extended ? b.u32(at + 64) : 0;
    yield {
      id: extended ? b.u32(at + 40) : null,
      fields: [
        extended ? b.i32(at + 52) : 0,
        extended ? b.i32(at + 56) : 0,
        b.i32(at),
        b.i32(at + 4),
        extended ? b.i32(at + 44) : b.i32(at),
        extended ? b.i32(at + 48) : b.i32(at + 4),
        Math.trunc(signed16(b, at + 10) / 8),
        version === 37 ? b.i32(at + 68) : 0,
        version === 37 ? b.i32(at + 72) : 0,
      ],
    };
    if (!next) return;
    if (next < 68) throw new Error('Invalid HG2 metadata frame link');
    at += next;
  }
  throw new Error('HG2 metadata frame limit exceeded');
}
function jpegInfo(b) {
  let at = 2;
  while (at < b.bytes.length) {
    if (b.u8(at++) !== 255) return null;
    while (b.u8(at) === 255) at++;
    const marker = b.u8(at++);
    if ([0xd8, 0x01].includes(marker) || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if ([0xda, 0xd9].includes(marker)) return null;
    const size = b.u8(at) * 256 + b.u8(at + 1);
    if (size < 2) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = b.u8(at + 3) * 256 + b.u8(at + 4),
        width = b.u8(at + 5) * 256 + b.u8(at + 6);
      return [0, 0, width, height, width, height, 3, 0, 0];
    }
    at += size;
  }
  return null;
}
export function nativeImageMetadata(bytes, selector, container, output) {
  const b = new Binary(bytes, 'Native image metadata'),
    view = new DataView(output.buffer, output.byteOffset, output.byteLength),
    write = (fields) => fields.forEach((word, i) => view.setInt32(i * 4, word, true));
  if (!bytes.length) return { success: false, written: false };
  if (!b.magic('HG-3') && !b.magic('HG-2')) {
    const fields = !container && bytes[0] === 255 && bytes[1] === 216 ? jpegInfo(b) : null;
    if (fields) write(fields);
    return { success: Boolean(fields), written: Boolean(fields) };
  }
  const hg3 = b.magic('HG-3');
  if (container && !hg3 && signed16(b, 8) < 37) return { success: false, written: false };
  const frames = hg3 ? hg3Frames(b) : hg2Frames(b);
  if (!container) {
    for (const frame of frames)
      if (frame.id === null || frame.id === selector >>> 0) {
        if (frame.fields) write(frame.fields);
        return { success: Boolean(frame.fields), written: Boolean(frame.fields) };
      }
    return { success: false, written: false };
  }
  // The container helper deliberately leaves DWORD6 untouched.
  const fields = [
    0x7fffffff,
    0x7fffffff,
    0,
    0,
    0,
    0,
    view.getInt32(24, true),
    0x7fffffff,
    0x7fffffff,
  ];
  for (const frame of frames) {
    if (!frame.fields) continue;
    for (let i = 0; i < 6; i++)
      fields[i] =
        i < 2 ? Math.min(fields[i], frame.fields[i]) : Math.max(fields[i], frame.fields[i]);
    for (const i of [7, 8])
      if (hg3 ? fields[i] === 0x7fffffff : fields[i] > frame.fields[i]) fields[i] = frame.fields[i];
  }
  write(fields);
  return { success: true, written: true };
}
