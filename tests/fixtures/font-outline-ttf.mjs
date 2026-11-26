// SPDX-License-Identifier: MPL-2.0
// Authored rectangles and Unicode cmap: deterministic, small, distinct glyph IDs.
export function authoredOutlineTTF(count = 200) {
  const bytes = (size) => new Uint8Array(size),
    view = (value) => new DataView(value.buffer),
    glyphs = count + 1,
    glyphSize = 34,
    tables = new Map();
  const head = bytes(54),
    h = view(head);
  h.setUint32(0, 0x10000);
  h.setUint32(4, 0x10000);
  h.setUint32(12, 0x5f0f3cf5);
  h.setUint16(16, 8);
  h.setUint16(18, 1000);
  h.setInt16(40, 600);
  h.setInt16(42, 700);
  h.setUint16(46, 8);
  tables.set('head', head);
  const hhea = bytes(36),
    hh = view(hhea);
  hh.setUint32(0, 0x10000);
  hh.setInt16(4, 800);
  hh.setInt16(6, -200);
  hh.setUint16(10, 800);
  hh.setInt16(16, 600);
  hh.setInt16(18, 1);
  hh.setUint16(34, glyphs);
  tables.set('hhea', hhea);
  const maxp = bytes(32),
    m = view(maxp);
  m.setUint32(0, 0x10000);
  m.setUint16(4, glyphs);
  m.setUint16(6, 4);
  m.setUint16(8, 1);
  m.setUint16(14, 1);
  tables.set('maxp', maxp);
  const glyf = bytes(glyphs * glyphSize),
    g = view(glyf),
    loca = bytes((glyphs + 1) * 2),
    l = view(loca),
    hmtx = bytes(glyphs * 4),
    hm = view(hmtx);
  for (let index = 0; index < glyphs; index++) {
    const at = index * glyphSize,
      width = 200 + (index % 17) * 20,
      height = 400 + (index % 13) * 20;
    g.setInt16(at, 1);
    g.setInt16(at + 6, width);
    g.setInt16(at + 8, height);
    g.setUint16(at + 10, 3);
    glyf.fill(1, at + 14, at + 18);
    for (const [offset, value] of [
      [20, width],
      [24, -width],
      [30, height],
    ])
      g.setInt16(at + offset, value);
    l.setUint16(index * 2, at / 2);
    hm.setUint16(index * 4, index === 180 ? 0 : 600 + (index % 7) * 20);
  }
  l.setUint16(glyphs * 2, glyf.length / 2);
  tables.set('glyf', glyf);
  tables.set('loca', loca);
  tables.set('hmtx', hmtx);
  const cmap = bytes(44),
    c = view(cmap);
  c.setUint16(2, 1);
  c.setUint16(4, 3);
  c.setUint16(6, 1);
  c.setUint32(8, 12);
  c.setUint16(12, 4);
  c.setUint16(14, 32);
  c.setUint16(18, 4);
  c.setUint16(20, 4);
  c.setUint16(22, 1);
  c.setUint16(26, 0x4e00 + count - 1);
  c.setUint16(28, 0xffff);
  c.setUint16(32, 0x4e00);
  c.setUint16(34, 0xffff);
  c.setInt16(36, 1 - 0x4e00);
  c.setInt16(38, 1);
  tables.set('cmap', cmap);
  const post = bytes(32),
    p = view(post);
  p.setUint32(0, 0x30000);
  tables.set('post', post);
  const names = ['CS2OutlineFixture', 'Regular'].map((text) =>
      Uint8Array.from(Array.from(text).flatMap((character) => [0, character.charCodeAt(0)])),
    ),
    name = bytes(30 + names.reduce((n, value) => n + value.length, 0)),
    nv = view(name);
  nv.setUint16(2, 2);
  nv.setUint16(4, 30);
  let stringOffset = 0;
  for (let index = 0; index < 2; index++) {
    const at = 6 + index * 12;
    nv.setUint16(at, 3);
    nv.setUint16(at + 2, 1);
    nv.setUint16(at + 4, 0x409);
    nv.setUint16(at + 6, index + 1);
    nv.setUint16(at + 8, names[index].length);
    nv.setUint16(at + 10, stringOffset);
    name.set(names[index], 30 + stringOffset);
    stringOffset += names[index].length;
  }
  tables.set('name', name);
  const checksum = (value) => {
    let sum = 0;
    for (let at = 0; at < value.length; at += 4)
      sum =
        (sum +
          ((value[at] ?? 0) * 0x1000000 +
            (value[at + 1] ?? 0) * 0x10000 +
            (value[at + 2] ?? 0) * 0x100 +
            (value[at + 3] ?? 0))) >>>
        0;
    return sum;
  };
  const sorted = [...tables].sort(([a], [b]) => a.localeCompare(b)),
    output = bytes(
      12 + sorted.length * 16 + sorted.reduce((n, [, data]) => n + ((data.length + 3) & ~3), 0),
    ),
    o = view(output);
  o.setUint32(0, 0x10000);
  o.setUint16(4, sorted.length);
  o.setUint16(6, 128);
  o.setUint16(8, 3);
  o.setUint16(10, sorted.length * 16 - 128);
  let offset = 12 + sorted.length * 16,
    headAt;
  for (let index = 0; index < sorted.length; index++) {
    const [tag, data] = sorted[index],
      at = 12 + index * 16;
    output.set(
      Array.from(tag, (character) => character.charCodeAt(0)),
      at,
    );
    o.setUint32(at + 4, checksum(data));
    o.setUint32(at + 8, offset);
    o.setUint32(at + 12, data.length);
    output.set(data, offset);
    if (tag === 'head') headAt = offset;
    offset += (data.length + 3) & ~3;
  }
  o.setUint32(headAt + 8, (0xb1b0afba - checksum(output)) >>> 0);
  return output;
}
