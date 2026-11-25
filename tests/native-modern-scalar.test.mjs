// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernScalarVM, unmappedModernScalar } from './fixtures/modern-scalar.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-interpreter-scalar-golden.json', import.meta.url)),
);
for (const [profile, record] of Object.entries(golden.profiles))
  for (const table of ['main', 'generic', 'particle-v1', 'particle-v2']) {
    test(`${profile} ${table} physical scalar words through real KCS`, async () => {
      for (const input of record.cases)
        assert.deepEqual(
          await modernScalarVM(profile, table, input),
          await modernScalarVM(profile, table, input, true),
          `${input.name}: complete caller/owner state versus sealed physical reply`,
        );
    });
    test(`${profile} ${table} fixed argv reads mapped prefixes and ignores tail words`, async () => {
      const inputs = [...new Map(record.cases.map((input) => [input.generic, input])).values()];
      // Main-only log10 is independently present in the physical Main corpus.
      if (table === 'main')
        inputs.push({ name: 'log10 3f800000', args: [0x3f800000], main: 461, value: 0 });
      for (const input of inputs)
        for (const mode of ['mapped', 'short', 'tail'])
          assert.deepEqual(
            await modernScalarVM(profile, table, input, false, mode),
            await modernScalarVM(profile, table, input, true, mode),
            `${input.name}/${mode}: GCALL declared words differ from fixed wrapper reads`,
          );
      const input = inputs[0];
      await unmappedModernScalar(
        profile,
        table,
        input[table === 'main' ? 'main' : table === 'generic' ? 'generic' : 'particle'],
      );
    });
  }
