// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFontNames } from '../src/formats/font.mjs';

function fontFixture({ codePages } = {}) {
  const names = [
      [1, 'Authored Gothic'],
      [4, '原作ゴシック Medium'],
      [16, 'Authored Sans'],
    ],
    texts = names.map(([, text]) =>
      Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0) >>> 8, c.charCodeAt(0) & 255])),
    ),
    size = 6 + names.length * 12 + texts.reduce((sum, text) => sum + text.length, 0),
    os2Size = codePages === undefined ? 6 : 86,
    bytes = new Uint8Array(44 + size + os2Size),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 2);
  bytes.set(new TextEncoder().encode('name'), 12);
  view.setUint32(20, 44);
  view.setUint32(24, size);
  bytes.set(new TextEncoder().encode('OS/2'), 28);
  view.setUint32(36, 44 + size);
  view.setUint32(40, os2Size);
  view.setUint16(46, names.length);
  view.setUint16(48, 6 + names.length * 12);
  let offset = 0;
  for (let i = 0; i < names.length; i++) {
    const at = 50 + i * 12;
    [3, 1, 0x411, names[i][0], texts[i].length, offset].forEach((word, n) =>
      view.setUint16(at + n * 2, word),
    );
    bytes.set(texts[i], 44 + 6 + names.length * 12 + offset);
    offset += texts[i].length;
  }
  view.setUint16(44 + size + 4, 500);
  if (codePages !== undefined) {
    view.setUint16(44 + size, 1);
    view.setUint32(44 + size + 78, codePages);
  }
  return bytes;
}
test('font selection reads localized family, full and typographic names with its real weight', () => {
  assert.deepEqual(readFontNames(fontFixture()).names, [
    'Authored Gothic',
    '原作ゴシック Medium',
    'Authored Sans',
  ]);
  assert.equal(readFontNames(fontFixture()).weight, 500);
});
test('Windows font enumeration uses the mounted face code page', () => {
  assert.equal(readFontNames(fontFixture({ codePages: 0x20001 })).windows.charset, 128);
  assert.equal(readFontNames(fontFixture({ codePages: 1 })).windows.charset, 0);
  assert.equal(readFontNames(fontFixture()).windows.charset, 1);
});
test('font name records cannot read outside their declared table', () => {
  const bytes = fontFixture();
  new DataView(bytes.buffer).setUint16(58, 65535);
  assert.throws(() => readFontNames(bytes), /record exceeds/);
});
