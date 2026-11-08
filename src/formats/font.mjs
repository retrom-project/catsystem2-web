// SPDX-License-Identifier: MPL-2.0
// OpenType name records identify the names exposed to Win32 font selection.
// https://learn.microsoft.com/en-us/typography/opentype/spec/name
export function readFontNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    range = (offset, size) => {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(size) ||
        offset < 0 ||
        size < 0 ||
        offset + size > bytes.length
      )
        throw new Error('OpenType table exceeds font bounds');
      return bytes.subarray(offset, offset + size);
    },
    u16 = (at) => {
      range(at, 2);
      return view.getUint16(at);
    },
    u32 = (at) => {
      range(at, 4);
      return view.getUint32(at);
    },
    tag = (at) => new TextDecoder('ascii').decode(range(at, 4));
  if (u32(0) !== 0x00010000 && !['OTTO', 'true', 'typ1'].includes(tag(0)))
    throw new Error('Unsupported OpenType font container');
  const tables = new Map();
  for (let index = 0; index < u16(4); index++) {
    const at = 12 + index * 16,
      offset = u32(at + 8),
      size = u32(at + 12);
    range(offset, size);
    tables.set(tag(at), { offset, size });
  }
  const names = tables.get('name');
  if (!names) throw new Error('OpenType font has no name table');
  const at = names.offset,
    format = u16(at),
    count = u16(at + 2),
    storage = u16(at + 4),
    records = [];
  if (format > 1 || 6 + count * 12 > names.size) throw new Error('Invalid OpenType name table');
  for (let i = 0; i < count; i++) {
    const record = at + 6 + i * 12,
      platform = u16(record),
      encoding = u16(record + 2),
      language = u16(record + 4),
      id = u16(record + 6),
      length = u16(record + 8),
      offset = storage + u16(record + 10);
    if (offset + length > names.size) throw new Error('OpenType name record exceeds its table');
    if (![1, 2, 4, 16, 17].includes(id)) continue;
    const codec =
      platform === 0 || platform === 3
        ? 'utf-16be'
        : platform === 1 && encoding === 0
          ? 'macintosh'
          : null;
    if (!codec) continue;
    records.push({
      platform,
      encoding,
      language,
      id,
      text: new TextDecoder(codec, { fatal: true }).decode(range(at + offset, length)),
    });
  }
  const os2 = tables.get('OS/2');
  return {
    records,
    names: [...new Set(records.filter((r) => [1, 4, 16].includes(r.id)).map((r) => r.text))],
    weight: os2 && os2.size >= 6 ? u16(os2.offset + 4) : 400,
  };
}
