// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { transitionalRuntimeFiles } from './transitional-runtime.mjs';

export async function nativeEntryGraph(root, entry = 'src/engine.mjs', importCache = new Map()) {
  const visited = new Set();
  async function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    let facts = importCache.get(file);
    if (!facts) {
      const source = await readFile(resolve(root, file), 'utf8');
      facts = { imports: [], privateFixtureReads: false };
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
                        ImportDeclaration: (node) => facts.imports.push(node.source.value),
                        ExportNamedDeclaration: (node) => {
                          if (node.source) facts.imports.push(node.source.value);
                        },
                        ExportAllDeclaration: (node) => facts.imports.push(node.source.value),
                        ImportExpression: (node) => {
                          if (typeof node.source.value === 'string')
                            facts.imports.push(node.source.value);
                        },
                        MemberExpression(node) {
                          const object = node.object;
                          if (
                            object.type !== 'MemberExpression' ||
                            object.object.name !== 'process'
                          )
                            return;
                          const property = object.computed
                            ? object.property.value
                            : object.property.name;
                          if (property !== 'env') return;
                          const name = node.computed ? node.property.value : node.property.name;
                          if (typeof name !== 'string' || name.startsWith('CATSYSTEM2_'))
                            facts.privateFixtureReads = true;
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
      importCache.set(file, facts);
    }
    for (const target of facts.imports.filter((target) => target.startsWith('.')))
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
