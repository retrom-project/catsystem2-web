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
export function validateCalculationSource(source, file, label = 'Calculation') {
  const forbidden = new Set([
    'ensureNativeEngine',
    'getNativeFeature',
    'call',
    'callFromHost',
    'callAsync',
    'runThread',
    'emu_start',
    'beforeInstruction',
    'sendNativeEngine',
    'sendEngine',
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
                        context.report({ node, message: label + ' imports EXE capability' });
                    },
                    MemberExpression(node) {
                      const name = node.computed ? node.property.value : node.property.name;
                      if (forbidden.has(name))
                        context.report({
                          node,
                          message: label + ' references EXE capability ' + name,
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
  for (const file of CALCULATION_MODULES)
    validateCalculationSource(await readFile(resolve(root, file), 'utf8'), file);
  console.log('Calculation source boundary: ordinary math and codec modules.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkCalculationBoundary(fileURLToPath(new URL('..', import.meta.url)));
