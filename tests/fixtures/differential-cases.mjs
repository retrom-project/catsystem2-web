// SPDX-License-Identifier: MPL-2.0
// Authored inputs. The only private input is the separately mounted oracle EXE.
import { floatBits } from '../../src/kcs.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
const floats = (words) => words.map(floatBits);
const resultFloat = {
  result: 'f32',
  ulp: 1,
  nan: 'exact',
  memory: [{ region: 'memory', offset: 4096, words: 1, ulp: 1 }],
};
export function nativeMathCases(profile) {
  const cases = [];
  const add = (table, operation, name, args, initial, policy = {}) => {
    const entry = nativeABI(profile).tables[table].entries.find(
      (entry) => entry.name === operation,
    );
    if (!entry) throw new Error(`Unreviewed fixture operation ${profile}/${operation}`);
    cases.push({ profile, table, id: entry.id, operation, name, args, initial, policy });
  };
  for (const operation of ['math.sin', 'math.cos'])
    for (const input of [0, -0, 0.5, -0.5, 1])
      add(
        'generic',
        operation,
        `${operation}(${Object.is(input, -0) ? '-0' : input})`,
        [floatBits(input)],
        {},
        resultFloat,
      );
  const matrix = floats(Array.from({ length: 16 }, (_, i) => i + 0.25));
  add('generic', 'matrix.copy', 'matrix data copy', [64, 128], { words: [[128, matrix]] });
  add('generic', 'matrix.copy', 'matrix self alias', [64, 64], { words: [[64, matrix]] });
  add('generic', 'matrix.copy', 'matrix shared to heap', [8192 + 8, 0x80000080], {
    blocks: [96],
    words: [[0x80000080, matrix]],
  });
  for (const [name, address, region, offset, blocks] of [
    ['data', 64, 'memory', 64, []],
    ['shared', 0x80000080, 'shared', 128, []],
    ['heap', 8208, 'block:1', 16, [48]],
  ])
    add(
      'generic',
      'vector4.normalize',
      `vector normalization in ${name}`,
      [address],
      { blocks, words: [[address, floats([3, 4, 0, 0])]] },
      { memory: [{ region, offset, words: 4, ulp: 1 }] },
    );
  for (const values of [
    [0, 10, 0, 1, 0.25],
    [10, -10, -2, 2, 1],
    [2, 8, 0, 1, -1],
    [2, 8, 0, 1, 2],
  ])
    add(
      'main',
      'math.linearInterpolate',
      `interpolation ${values.join(',')}`,
      floats(values),
      {},
      resultFloat,
    );
  for (const value of [0, -0, 0.5, -0.5, 2.5, -2.5, 2147483648])
    add('main', 'math.roundInteger', `integer rounding ${value}`, [floatBits(value)], {});
  return cases;
}
