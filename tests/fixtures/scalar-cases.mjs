// SPDX-License-Identifier: MPL-2.0
import { floatBits } from '../../src/kcs.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
export function nativeScalarCases(profile) {
  const cases = [],
    abi = nativeABI(profile);
  const add = (name, words, initial = {}) => {
    const entry = abi.tables.main.entries.find((e) => e.name === `math.${name}`);
    const exact = [
      'ceil',
      'floor',
      'abs',
      'integerAbs',
      'packWords',
      'unpackWords',
      'degreeToRadian',
      'radianToDegree',
      'fmod',
      'triangleWave',
      'sqrt',
    ].includes(name);
    const floating = entry.result === 'f32';
    cases.push({
      profile,
      table: 'main',
      id: entry.id,
      operation: entry.name,
      name: `${name} ${words.map((w) => w.toString(16)).join('/')}`,
      args: words,
      initial,
      oracle: {
        boundaries: [
          'kernel32.dll!GetLastError',
          'kernel32.dll!SetLastError',
          'kernel32.dll!TlsGetValue',
          'kernel32.dll!TlsSetValue',
        ],
      },
      policy: floating
        ? {
            result: 'f32',
            ulp: exact ? 0 : 1,
            nan: 'exact',
            memory: [{ region: 'memory', offset: 4096, words: 1, ulp: exact ? 0 : 1 }],
          }
        : {},
    });
  };
  for (const name of [
    'sin',
    'cos',
    'tan',
    'asin',
    'acos',
    'atan',
    'ceil',
    'floor',
    'abs',
    'sqrt',
    'log10',
    'degreeToRadian',
    'radianToDegree',
  ])
    for (const word of [
      0,
      0x80000000,
      floatBits(0.5),
      floatBits(-1),
      floatBits(1),
      floatBits(2),
      1,
      0x7f7fffff,
      floatBits(1e30),
      0x7f800000,
      0xff800000,
      0x7fc12345,
      0xffa00001,
    ])
      add(name, [word]);
  for (const name of ['pow', 'fmod', 'atan2', 'triangleWave'])
    for (const values of [
      [0, 0],
      [-0, 1],
      [1, 2],
      [-1, 0.5],
      [-2, 3],
      [3, 4],
      [Infinity, 1],
      [1, Infinity],
      [NaN, 2],
      [2, NaN],
      [1, NaN],
      [0.75, 2],
    ])
      add(name, values.map(floatBits));
  for (const name of ['integerAbs'])
    for (const n of [0, 1, 0xffffffff, 0x80000000, 0x7fffffff]) add(name, [n]);
  for (const words of [
    [0, 0],
    [0xabcd1234, 0xef987654],
    [0xffffffff, 0x80000000],
  ])
    add('packWords', words);
  for (const [a, b, c] of [
    [0, 0, 4],
    [0x8000ffff, 64, 64],
    [0x1234abcd, 64, 65],
    [0x80007fff, 65, 64],
    [0x7fff1234, 0x80000010, 8200],
  ])
    add('unpackWords', [a, b, c], { blocks: c === 8200 ? [32] : [] });
  return cases;
}
