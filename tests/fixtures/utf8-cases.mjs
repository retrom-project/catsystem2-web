// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../../src/native/abi/index.mjs';
export function authoredByteWords(bytes) {
  const b = new Uint8Array(Math.ceil((bytes.length + 2) / 4) * 4);
  b.set(bytes);
  b[bytes.length + 1] = 0xa5;
  return Array.from({ length: b.length / 4 }, (_, i) =>
    new DataView(b.buffer).getUint32(i * 4, true),
  );
}
export function nativeUTF8Cases(profile) {
  const cases = [],
    abi = nativeABI(profile);
  const add = (operation, name, args, bytes, key = []) => {
    const entry = abi.tables.main.entries.find((e) => e.name === operation);
    if (!entry) return;
    cases.push({
      profile,
      table: 'main',
      id: entry.id,
      name,
      operation,
      args,
      initial: {
        words: [
          [256, authoredByteWords(bytes)],
          [512, authoredByteWords(key)],
        ],
      },
      policy: {},
      oracle: {
        boundaries: [
          'kernel32.dll!MultiByteToWideChar',
          'kernel32.dll!WideCharToMultiByte',
          'kernel32.dll!GetLastError',
          'kernel32.dll!SetLastError',
          'kernel32.dll!TlsGetValue',
          'kernel32.dll!TlsSetValue',
          'engine:CRT operator new:0x79ea57',
          'engine:CRT free:0x6f81d0',
        ],
      },
    });
  };
  const utf8 = (t) => [...new TextEncoder().encode(t)];
  for (const [name, bytes] of [
    ['empty', []],
    ['ascii', utf8('abc')],
    ['japanese', utf8('猫abc')],
    ['supplementary', utf8('😀a猫')],
    ['unchecked tail', [0xe7, 0x8c, 65, 66]],
    ['overlong', [0xc0, 0x80, 65]],
    ['six ones', [0xfc, 65]],
    ['continuation', [0x80]],
    ['invalid middle', [0xe7, 65, 66]],
  ])
    for (const [operation, limit] of [
      ['utf8.truncateBytes', 3],
      ['utf8.truncateBytes', 4],
      ['utf8.truncateCharacters', 1],
    ])
      add(operation, name + '/' + operation + '/' + limit, [256, limit], bytes);
  for (const [name, source, key] of [
    ['japanese', 'ab猫cat', [0x94, 0x4c]],
    ['ascii', 'ab猫cat', [99, 97, 116]],
    ['absent', 'ab猫cat', [122]],
    ['empty', 'ab猫cat', []],
    ['halfwidth', 'ｶ猫', [0xb6]],
    ['extension', '①猫', [0x87, 0x40]],
    ['invalid key', '�x', [0x80]],
    ['long key', 'abc', new Array(4001).fill(97)],
  ])
    add('utf8.findCP932Key', 'search ' + name, [256, 512], utf8(source), key);
  return cases;
}
