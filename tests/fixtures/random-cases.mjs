// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../../src/native/abi/index.mjs';
export function nativeRandomCases(profile) {
  const cases = [],
    abi = nativeABI(profile);
  for (const table of ['main', 'generic'])
    for (const operation of ['random.integer', 'random.float']) {
      const entry = abi.tables[table].entries.find((e) => e.name === operation);
      for (const spec of [
        { name: 'seed zero', integerSeed: 0, realSeed: 0, repeat: 4 },
        { name: 'seed normal', integerSeed: 4357, realSeed: 987, repeat: 4 },
        { name: 'seed max', integerSeed: 0xffffffff, realSeed: 0xffffffff, repeat: 4 },
        {
          name: 'checkpoint last word',
          integerSeed: 17,
          realSeed: 31,
          repeat: 2,
          overrides: { integer: { index: 623 }, real: { index: 623 } },
        },
        {
          name: 'unseeded sentinel',
          integerSeed: 17,
          realSeed: 31,
          repeat: 2,
          overrides: { integer: { index: 625 }, real: { index: 625 } },
        },
        {
          name: 'lower endpoint',
          integerSeed: 17,
          realSeed: 31,
          repeat: 1,
          overrides: { integer: { index: 0, firstWord: 0 }, real: { index: 0, firstWord: 0 } },
        },
        // 0x12dd9bb3 is an authored untempered 0xffffffff word, not an output stub.
        {
          name: 'upper endpoint',
          integerSeed: 17,
          realSeed: 31,
          repeat: 1,
          overrides: {
            integer: { index: 0, firstWord: 0x12dd9bb3 },
            real: { index: 0, firstWord: 0x12dd9bb3 },
          },
        },
      ]) {
        const { name, repeat, ...random } = spec;
        cases.push({
          profile,
          table,
          id: entry.id,
          operation,
          name: table + '/' + operation + '/' + name,
          args: [],
          repeat,
          initial: { random },
          domain: 'random',
          policy: {},
        });
      }
    }
  return cases;
}
