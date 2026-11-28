// SPDX-License-Identifier: MPL-2.0
// A tiny PE32 DLL with only a resource section. It has no executable entry.
export function resourcePE() {
  const bytes = new Uint8Array(0x600),
    view = new DataView(bytes.buffer),
    resource = 0x200,
    rva = 0x1000,
    optional = 0x98,
    section = optional + 224,
    put16 = (at, word) => view.setUint16(at, word, true),
    put32 = (at, word) => view.setUint32(at, word, true);
  put16(0, 0x5a4d);
  put32(0x3c, 0x80);
  put32(0x80, 0x4550);
  put16(0x84, 0x14c);
  put16(0x86, 1);
  put16(0x94, 224);
  put16(0x96, 0x2102);
  put16(optional, 0x10b);
  put32(optional + 8, 0x400);
  put32(optional + 24, rva);
  put32(optional + 28, 0x10000000);
  put32(optional + 32, 0x1000);
  put32(optional + 36, 0x200);
  put16(optional + 40, 6);
  put16(optional + 48, 6);
  put32(optional + 56, 0x2000);
  put32(optional + 60, resource);
  put16(optional + 68, 3);
  put32(optional + 72, 0x100000);
  put32(optional + 76, 0x1000);
  put32(optional + 80, 0x100000);
  put32(optional + 84, 0x1000);
  put32(optional + 92, 16);
  put32(optional + 112, rva);
  bytes.set(new TextEncoder().encode('.rsrc'), section);
  put32(section + 8, 0x400);
  put32(section + 12, rva);
  put32(section + 16, 0x400);
  put32(section + 20, resource);
  put32(section + 36, 0x40000040);

  let position = 0;
  function reserve(size) {
    const at = position;
    position = (position + size + 3) & ~3;
    if (position > bytes.length - resource) throw new Error('Authored resource section overflows');
    return at;
  }
  function table(entries) {
    const offset = reserve(16 + entries.length * 8),
      at = resource + offset,
      named = entries.filter(([id]) => typeof id === 'string').length;
    put16(at + 12, named);
    put16(at + 14, entries.length - named);
    entries.forEach(([id, next], i) => {
      const entry = at + 16 + i * 8;
      if (typeof id === 'string') {
        const name = reserve(2 + id.length * 2);
        put32(entry, 0x80000000 | name);
        put16(resource + name, id.length);
        for (let unit = 0; unit < id.length; unit++)
          put16(resource + name + 2 + unit * 2, id.charCodeAt(unit));
      } else put32(entry, id);
      if (Array.isArray(next)) put32(entry + 4, 0x80000000 | table(next));
      else {
        const payload = new TextEncoder().encode(next),
          leaf = reserve(16),
          start = reserve(payload.length);
        put32(entry + 4, leaf);
        put32(resource + leaf, rva + start);
        put32(resource + leaf + 4, payload.length);
        bytes.set(payload, resource + start);
      }
    });
    return offset;
  }
  table([
    [
      'CUSTOM',
      [
        [
          '日本',
          [
            [9, 'English neutral'],
            [0x409, 'English'],
            [0x411, 'Japanese'],
          ],
        ],
      ],
    ],
    [
      10,
      [
        [
          50,
          [
            [0, 'Neutral'],
            [0x411, 'Japanese'],
          ],
        ],
        [51, [[0x416, 'Portuguese']]],
      ],
    ],
  ]);
  put32(optional + 116, position);
  return bytes;
}
