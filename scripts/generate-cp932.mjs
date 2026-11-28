// SPDX-License-Identifier: MPL-2.0
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { format } from 'prettier';
const input = await readFile(new URL('../third_party/cp932/CP932.TXT', import.meta.url));
if (
  createHash('sha256').update(input).digest('hex') !==
  'c9bc0b0cd42e0fbcb82a09635bb5abed86afbdd4abc9e76fa5716638217cb59f'
)
  throw Error('CP932 source differs from the reviewed Microsoft table');
const pairs = [...input.toString().matchAll(/^0x([0-9A-Fa-f]+)\s+0x([0-9A-Fa-f]+)/gm)].map((m) =>
  m.slice(1).map((n) => Number.parseInt(n, 16)),
);
const data = pairs
  .map((pair) => pair.map((n) => n.toString(16).padStart(4, '0')).join(''))
  .join('');
const chunks = data
  .match(/.{1,128}/g)
  .map((s) => JSON.stringify(s))
  .join('+\n');
await writeFile(
  new URL('../src/native/cp932-data.mjs', import.meta.url),
  await format(
    '// Derived from Microsoft CP932.TXT table 2.01 (1998), Unicode 2.0.\n// Source and Unicode license: third_party/cp932/. Regenerate: node scripts/generate-cp932.mjs\nexport const CP932_PAIRS = ' +
      chunks +
      ';\n',
    { parser: 'babel', singleQuote: true, printWidth: 100 },
  ),
);
console.log('Generated ' + pairs.length + ' fixed CP932 mappings');
