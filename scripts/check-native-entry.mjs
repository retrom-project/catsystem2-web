// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { transitionalRuntimeFiles } from './transitional-runtime.mjs';

export async function nativeEntryGraph(root, entry = 'src/engine.mjs') {
  const visited = new Set();
  async function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readFile(resolve(root, file), 'utf8'),
      imports = [];
    const messages = new Linter().verify(
      source,
      [
        {
          plugins: {
            graph: {
              rules: {
                imports: {
                  create() {
                    return {
                      ImportDeclaration: (node) => imports.push(node.source.value),
                      ExportNamedDeclaration: (node) => {
                        if (node.source) imports.push(node.source.value);
                      },
                      ExportAllDeclaration: (node) => imports.push(node.source.value),
                      ImportExpression: (node) => {
                        if (typeof node.source.value === 'string') imports.push(node.source.value);
                      },
                    };
                  },
                },
              },
            },
          },
          rules: { 'graph/imports': 'error' },
        },
      ],
      { filename: file },
    );
    if (messages.length) throw new Error(`${file}: ${messages[0].message}`);
    for (const target of imports.filter((target) => target.startsWith('.')))
      await visit(relative(root, resolve(root, dirname(file), target)));
  }
  await visit(entry);
  return [...visited].sort();
}

export async function checkNativeEntry(root) {
  const graph = await nativeEntryGraph(root);
  const forbidden = graph.filter(
    (file) => file.startsWith('oracle/') || file.endsWith('/engine-process.mjs'),
  );
  if (forbidden.length)
    throw new Error(`Pure entry reaches the EXE backend\n${forbidden.join('\n')}`);
  const includes = new Set(await transitionalRuntimeFiles(root));
  const mixed = await nativeEntryGraph(root, 'web/app.mjs');
  const unlisted = mixed.filter((file) => !file.startsWith('src/') && !includes.has(file));
  if (unlisted.length)
    throw new Error(`Uncounted shipped transitional dependency\n${unlisted.join('\n')}`);
  return graph;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const graph = await checkNativeEntry(fileURLToPath(new URL('..', import.meta.url)));
  console.log(`Pure native entry checked ${graph.length} modules.`);
}
