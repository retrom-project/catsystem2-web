// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';

export async function nativeEntryGraph(
  root,
  entry = 'src/engine.mjs',
  importCache = new Map(),
  { strict = false } = {},
) {
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
                          if (typeof name !== 'string' || /^(?:CATSYSTEM2_|CAT2_)/i.test(name))
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
    if (strict && facts.privateFixtureReads)
      throw new Error('Product source reads private fixture environment: ' + file);
    for (const target of facts.imports) {
      if (!target.startsWith('.')) {
        if (strict)
          throw new Error('Product source imports an external capability: ' + file + ': ' + target);
        continue;
      }
      const dependency = relative(root, resolve(root, dirname(file), target));
      if (dependency.startsWith('..'))
        throw new Error('Product import leaves its source root: ' + file);
      await visit(dependency);
    }
  }
  await visit(entry);
  return [...visited].sort();
}

export function isOriginalExecutionPath(file) {
  return (
    file.startsWith('oracle/') ||
    file === 'web/transitional-entry.mjs' ||
    /(?:^|\/)(?:engine-process|backend|backend-artifact|pe32|floating-point|native-services)\.mjs$/.test(
      file,
    )
  );
}

export async function checkNativeEntry(root) {
  const cache = new Map(),
    graph = await nativeEntryGraph(root, 'src/engine.mjs', cache, { strict: true }),
    app = await nativeEntryGraph(root, 'web/app.mjs', cache, { strict: true }),
    forbidden = [...new Set([...graph, ...app])].filter(isOriginalExecutionPath);
  if (forbidden.length)
    throw new Error(`Ordinary product entry reaches original execution\n${forbidden.join('\n')}`);
  if (!app.includes('src/engine.mjs'))
    throw new Error('The actual application does not consume the ordinary Core');
  return graph;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const graph = await checkNativeEntry(fileURLToPath(new URL('..', import.meta.url)));
  console.log(`Pure native entry checked ${graph.length} modules.`);
}
