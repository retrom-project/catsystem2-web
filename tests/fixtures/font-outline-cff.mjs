// SPDX-License-Identifier: MPL-2.0
// Authored CFF: A is a rectangle; B uses the legacy Type2 random operator.
// No third-party font outlines or names are embedded.
const join = (...parts) => Uint8Array.from(parts.flatMap((part) => Array.from(part)));
const index = (items) => {
  if (!items.length) return Uint8Array.of(0, 0);
  const offsets = [1];
  for (const item of items) offsets.push(offsets.at(-1) + item.length);
  if (offsets.at(-1) > 255) throw new Error('Small authored CFF INDEX exceeds one-byte offsets');
  return join([0, items.length, 1], offsets, ...items);
};
const integer = (value) => [
  29,
  value >>> 24,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
const operand = (value) => {
  if (value >= -107 && value <= 107) return [value + 139];
  if (value >= 108 && value <= 1131) return [247 + ((value - 108) >>> 8), (value - 108) & 255];
  if (value <= -108 && value >= -1131) return [251 + ((-value - 108) >>> 8), (-value - 108) & 255];
  return [28, (value >> 8) & 255, value & 255];
};
export function authoredOutlineCFF() {
  const rectangle = [500, 0, 0, 700, -500, 0, 0, -700].flatMap(operand),
    a = join(operand(600), operand(50), operand(0), [21], rectangle, [5, 14]),
    b = join(
      operand(600),
      operand(0),
      operand(0),
      [21, 12, 23],
      operand(100),
      [12, 24],
      operand(0),
      [21],
      rectangle,
      [5, 14],
    ),
    name = index([new TextEncoder().encode('CS2OutlineFixture')]),
    empty = index([]),
    charset = Uint8Array.of(0, 0, 34, 0, 35),
    strings = index([Uint8Array.of(14), a, b]);
  const dictionary = (charsetAt, stringsAt) =>
    join(...[0, 0, 600, 700].map(integer), [5], integer(charsetAt), [15], integer(stringsAt), [17]);
  const placeholder = index([dictionary(0, 0)]),
    charsetAt = 4 + name.length + placeholder.length + empty.length * 2,
    top = index([dictionary(charsetAt, charsetAt + charset.length)]);
  return join([1, 0, 4, 4], name, top, empty, empty, charset, strings);
}
