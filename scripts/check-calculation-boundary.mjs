// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
export const CALCULATION_MODULES = Object.freeze(
  [
    'scalar-math',
    'matrix',
    'geometry',
    'calculation-math',
    'calculation-memory',
    'rectangles',
    'view-geometry',
    'utf8',
    'utf8-codec',
    'unicode-output',
    'cp932',
    'cp932-data',
  ].map((name) => 'src/native/' + name + '.mjs'),
);
export function validateCalculationInventory(board) {
  const rows = board.profiles.flatMap((profile) =>
    profile.entries.filter((entry) => entry.domain === 3),
  );
  if (
    !rows.length ||
    rows.some((entry) => ['original-handler', 'exe-region', 'patch'].includes(entry.implementation))
  )
    throw Error('Calculation native still executes the EXE');
  for (const file of board.files.filter(
    (file) => file.domain === 3 && file.file !== 'src/native/random-memory.mjs',
  ))
    if (Object.values(file.exeDependencies).some(Boolean))
      throw Error('Calculation EXE dependency ' + file.file);
  for (const entry of rows)
    if (entry.review === 'needs-review' && !entry.reviewReasons.length)
      throw Error('Calculation review reason is missing');
}
export function validateCalculationSource(source, file) {
  const forbidden = new Set([
    'ensureNativeEngine',
    'getNativeFeature',
    'call',
    'callFromHost',
    'patch',
    'invokeRegion',
    'invokeNative',
  ]);
  const messages = new Linter().verify(
    source,
    [
      {
        plugins: {
          boundary: {
            rules: {
              calculation: {
                create(context) {
                  return {
                    ImportDeclaration(node) {
                      if (
                        /\/(engine-process|kcs-memory|catalog|transitional-exe)\.mjs$/.test(
                          node.source.value,
                        )
                      )
                        context.report({ node, message: 'Calculation imports EXE capability' });
                    },
                    MemberExpression(node) {
                      const name = node.computed ? node.property.value : node.property.name;
                      if (forbidden.has(name))
                        context.report({
                          node,
                          message: 'Calculation references EXE capability ' + name,
                        });
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'boundary/calculation': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw Error(file + ': ' + messages[0].message);
}
export async function checkCalculationBoundary(root) {
  validateCalculationInventory(
    JSON.parse(await readFile(resolve(root, 'docs/b-migration.json'), 'utf8')),
  );
  for (const file of CALCULATION_MODULES)
    validateCalculationSource(await readFile(resolve(root, file), 'utf8'), file);
  console.log(
    'Calculation boundary: no EXE execution; random-memory binding is the recorded phase-10 exception.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkCalculationBoundary(fileURLToPath(new URL('..', import.meta.url)));
