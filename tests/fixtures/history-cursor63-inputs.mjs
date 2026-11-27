// SPDX-License-Identifier: MPL-2.0
import { deflateSync } from 'node:zlib';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { historyCursorScene } from './history-cursor-fixture.mjs';
import { kcsProgram } from '../helpers.mjs';

export function narrowKIF(entries) {
  const table = [],
    body = [],
    first = 8 + 72 * entries.length;
  const word = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];
  for (const [name, bytes] of entries) {
    const encoded = encodeCP932(name);
    if (encoded.length > 63) throw new Error('Fixture filename exceeds the legal KIF field');
    table.push(
      ...encoded,
      ...new Uint8Array(64 - encoded.length),
      ...word(first + body.length),
      ...word(bytes.length),
    );
    body.push(...bytes);
  }
  return Uint8Array.from([75, 73, 70, 0, ...word(entries.length), ...table, ...body]);
}

export const cursor63Scenes = new Map([
  [
    'a',
    historyCursorScene([
      [
        [0x30, 'voice-a0'],
        [0x21, '名前A'],
        [0x20, '一番'],
        [0x20, '+'],
        [0x30, 'voice-a1'],
      ],
      [[0x30, 'command-only']],
      [
        [0x21, '名前B'],
        [0x20, '二番'],
      ],
      [[0x20, '末尾']],
    ]),
  ],
  [
    'b',
    historyCursorScene([
      [[0x20, '別先頭']],
      [],
      [
        [0x30, 'voice-b2'],
        [0x21, '名B'],
        [0x20, '別末尾'],
      ],
    ]),
  ],
  [
    '日本',
    historyCursorScene([
      [
        [0x21, '名前'],
        [0x20, '日本の文'],
        [0x30, '声 once'],
      ],
      [[0x20, 'JP-end']],
    ]),
  ],
]);
// Exercise one small packed original-format CST, not a patched inflate callee.
const plain = cursor63Scenes.get('b'),
  packed = deflateSync(plain.subarray(16));
const b = new Uint8Array(16 + packed.length);
b.set(plain.subarray(0, 16));
new DataView(b.buffer).setUint32(8, packed.length, true);
b.set(packed, 16);
cursor63Scenes.set('b', b);

export function cursor63Resources() {
  return new Map([
    ['scripts.int', narrowKIF([['resource63.kcs', kcsProgram([[37, 256], [43, 71, 4], [59]])]])],
    ['scene.int', narrowKIF([...cursor63Scenes].map(([name, bytes]) => [name + '.cst', bytes]))],
    ['tables.int', narrowKIF([['unused.dat', new Uint8Array(16)]])],
  ]);
}
