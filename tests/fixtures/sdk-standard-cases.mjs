// SPDX-License-Identifier: MPL-2.0
// Authored inputs for independently reviewed SDK standard wrappers.
import { nativeABI } from '../../src/native/abi/index.mjs';
import { authoredByteWords } from './utf8-cases.mjs';
export const SDK_STANDARD_PROFILE = 'sdk-4.01-engine-2.6.1.74';
export function nativeSDKStandardCases(profile) {
  const abi = nativeABI(profile),
    cases = [],
    ascii = (s) => [...new TextEncoder().encode(s)];
  const add = (id, name, args, data = [], extra = []) =>
    cases.push({
      profile,
      table: 'main',
      id,
      name,
      args: args.map((n) => n >>> 0),
      initial: {
        words: [
          ...data.map(([a, b]) => [a, authoredByteWords(typeof b === 'string' ? ascii(b) : b)]),
          ...extra,
        ],
      },
      policy: {},
      oracle: {
        boundaries: [
          'kernel32.dll!GetLastError',
          'kernel32.dll!SetLastError',
          'kernel32.dll!TlsGetValue',
          'kernel32.dll!TlsSetValue',
        ],
      },
    });
  add(6, 'identity word', [0xdeadbeef]);
  add(0x23, 'memory copy', [512, 256, 5], [[256, [1, 2, 3, 4, 5]]]);
  add(0x24, 'memory low byte fill', [512, 0x1234, 7]);
  add(0x25, 'thousands signed', [512, -1234567, 1]);
  add(
    0x26,
    'separator plain',
    [512, 256, 896, 32],
    [
      [256, 'cat,dog'],
      [896, ','],
    ],
  );
  add(
    0x27,
    'separator formatted',
    [512, 768, 896, 32],
    [
      [256, 'cat,dog'],
      [768, '%s[G256]'],
      [896, ','],
    ],
  );
  add(0x28, 'CP932 lead', [256], [[256, [0x94, 0x4c]]]);
  add(0x28, 'ASCII byte', [256], [[256, 'a']]);
  add(
    0x29,
    'split plain',
    [512, 256, 896],
    [
      [256, 'one two,three'],
      [896, ' ,'],
    ],
  );
  add(0x2a, 'list select', [512, 256, 1], [[256, [...ascii('cat'), 0, ...ascii('dog'), 0]]]);
  add(
    0x2b,
    'split groups',
    [512, 256, 896],
    [
      [256, 'one (two three),four'],
      [896, ' ,'],
    ],
  );
  add(0x2c, 'join list', [512, 256, 0, -1], [[256, [...ascii('cat'), 0, ...ascii('dog'), 0]]]);
  add(
    0x2d,
    'replace bytes',
    [512, 256, 768, 896],
    [
      [256, 'banana'],
      [768, 'na'],
      [896, 'x'],
    ],
  );
  add(0x2f, 'character count', [256], [[256, [97, 0x94, 0x4c, 98]]]);
  add(
    0x30,
    'formatted character count',
    [768],
    [
      [256, [97, 0x94, 0x4c, 98]],
      [768, '%s[G256]'],
    ],
  );
  add(
    0x31,
    'find character boundary',
    [256, 768],
    [
      [256, [97, 0x94, 0x4c, 98]],
      [768, [0x94, 0x4c]],
    ],
  );
  add(
    0x31,
    'do not find a trail byte',
    [256, 768],
    [
      [256, [97, 0x94, 0x4c, 98]],
      [768, [0x4c]],
    ],
  );
  add(0x41, 'yield control', []);
  for (const input of cases)
    if (!abi.tables.main.entries[input.id].name)
      throw Error('Missing reviewed SDK semantic ' + input.id);
  for (const input of cases) {
    if (input.id === 0x27) input.oracle.formattedBytes = ascii('cat,dog');
    if (input.id === 0x30) input.oracle.formattedBytes = [97, 0x94, 0x4c, 98];
  }
  return cases;
}
