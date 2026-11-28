// SPDX-License-Identifier: MPL-2.0
import { readFile, readdir } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { Linter } from 'eslint';
import { nativeEntryGraph, isOriginalExecutionPath } from './check-native-entry.mjs';
import { NATIVE_ZLIB_FILES } from '../src/native/zlib-artifact.mjs';
import { NATIVE_FREETYPE_FILES } from '../src/native/freetype-artifact.mjs';

const fontModules = ['native_freetype_248.mjs', 'native_freetype.mjs'];
function localPath(file, name) {
  if (typeof name !== 'string' || /^(?:[a-z]+:|\/\/)/i.test(name) || name.includes('\\'))
    throw new Error('Nonlocal production dependency: ' + file + ': ' + name);
  const path = posix.normalize(
    name.startsWith('/') ? name.slice(1) : posix.join(posix.dirname(file), name),
  );
  if (path.startsWith('../') || path === '..')
    throw new Error('Production dependency leaves its root: ' + path);
  return path;
}
function moduleAssets(source, file) {
  const assets = new Set(),
    dynamic = [];
  const messages = new Linter().verify(
    source,
    [
      {
        plugins: {
          build: {
            rules: {
              assets: {
                create() {
                  const importMetaURL = (node) =>
                    node?.type === 'MemberExpression' &&
                    node.object?.type === 'MetaProperty' &&
                    node.object.meta.name === 'import' &&
                    node.object.property.name === 'meta' &&
                    node.property.name === 'url';
                  const urlPath = (node) =>
                    node?.type === 'NewExpression' &&
                    node.callee.name === 'URL' &&
                    node.arguments.length === 2 &&
                    importMetaURL(node.arguments[1])
                      ? node.arguments[0]
                      : null;
                  const declaredImport = (node) => {
                    const path = urlPath(node.source);
                    if (!path) return false;
                    if (file === 'src/native/zlib.mjs' && path.type === 'Literal')
                      return [
                        '../../vendor/native_zlib.mjs',
                        '../../.local/vendor/zlib/native_zlib.mjs',
                      ].includes(path.value);
                    if (
                      file === 'src/native/font-backend.mjs' &&
                      path.type === 'BinaryExpression' &&
                      path.operator === '+' &&
                      path.left.type === 'Literal' &&
                      path.right.type === 'Identifier' &&
                      path.right.name === 'filename'
                    )
                      return ['../../vendor/', '../../.local/vendor/freetype/'].includes(
                        path.left.value,
                      );
                    return false;
                  };
                  return {
                    ImportExpression(node) {
                      if (node.source.type === 'Literal' && typeof node.source.value === 'string')
                        return;
                      if (!declaredImport(node))
                        throw new Error('Undeclared dynamic production import: ' + file);
                      dynamic.push(source.slice(node.start, node.end));
                    },
                    NewExpression(node) {
                      const path = urlPath(node);
                      if (path?.type !== 'Literal' || typeof path.value !== 'string') return;
                      const target = localPath(file, path.value);
                      // The development-only fallback is never a distribution file. Both
                      // real public libraries are supplied at vendor/ by the checked build.
                      if (target.startsWith('.local/vendor/')) {
                        if (
                          file !== 'src/native/zlib.mjs' ||
                          target !== '.local/vendor/zlib/native_zlib.mjs'
                        )
                          throw new Error('Unexpected development resource in product: ' + file);
                        return;
                      }
                      assets.add(target);
                    },
                    VariableDeclarator(node) {
                      if (file !== 'src/native/font-backend.mjs' || node.id.name !== 'filename')
                        return;
                      if (
                        node.init?.type !== 'ConditionalExpression' ||
                        !fontModules.includes(node.init.consequent.value) ||
                        !fontModules.includes(node.init.alternate.value)
                      )
                        throw new Error(
                          'FreeType dynamic import left its finite public artifact domain',
                        );
                    },
                  };
                },
              },
            },
          },
        },
        rules: { 'build/assets': 'error' },
      },
    ],
    { filename: file },
  );
  if (messages.length) throw new Error(file + ': ' + messages[0].message);
  if (file === 'src/native/font-backend.mjs')
    for (const name of fontModules) assets.add('vendor/' + name);
  return { assets: [...assets], dynamic };
}
async function legalFiles(root, directory) {
  const files = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) files.push(...(await legalFiles(root, path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error('Nonregular legal source: ' + path);
  }
  return files;
}

export function validateOrdinaryDistribution(files) {
  for (const item of files) {
    const file = typeof item === 'string' ? item : item.path;
    if (
      isOriginalExecutionPath(file) ||
      /(?:^|\/)(?:unicorn[^/]*|ppi-(?:pe32|backend|native-services|floating-point))\.[^/]+$/i.test(
        file,
      ) ||
      /\.(?:exe|dll)$/i.test(file) ||
      file.startsWith('.local/')
    )
      throw new Error('Ordinary distribution contains original execution: ' + file);
  }
}

export async function productionFiles(root) {
  const modules = await nativeEntryGraph(root, 'web/app.mjs', new Map(), { strict: true }),
    assets = new Set(),
    dynamic = [];
  for (const file of modules) {
    const facts = moduleAssets(await readFile(resolve(root, file), 'utf8'), file);
    for (const asset of facts.assets) assets.add(asset);
    for (const expression of facts.dynamic) dynamic.push({ file, expression });
  }
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g))
    assets.add(localPath('index.html', match[1]));
  for (const file of assets) {
    if (file.startsWith('vendor/')) continue;
    await readFile(resolve(root, file));
    if (file.endsWith('.css')) {
      const css = await readFile(resolve(root, file), 'utf8');
      for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g))
        assets.add(localPath(file, match[1]));
    }
  }
  const vendor = [
    ...NATIVE_ZLIB_FILES.map((name) => ({
      file: 'vendor/' + name,
      source: '.local/vendor/zlib/' + name,
    })),
    ...NATIVE_FREETYPE_FILES.map((name) => ({
      file: 'vendor/' + name,
      source: '.local/vendor/freetype/' + name,
    })),
  ];
  const vendorNames = new Set(vendor.map((row) => row.file));
  for (const file of assets)
    if (file.startsWith('vendor/') && !vendorNames.has(file))
      throw new Error('Unreviewed production vendor: ' + file);
  const legal = [
    'LICENSE',
    'NOTICE.md',
    'references.json',
    ...(await legalFiles(root, 'licenses')),
    'third_party/fonts/noto-sans-jp/OFL.txt',
    'third_party/fonts/noto-sans-jp/README.md',
    'third_party/fonts/noto-sans-jp/METADATA.pb',
  ];
  const files = [
    ...new Set(['index.html', ...modules, ...assets, ...legal, ...vendorNames]),
  ].sort();
  validateOrdinaryDistribution(files);
  for (const row of vendor) await readFile(resolve(root, row.source));
  return { modules, assets: [...assets].sort(), vendor, legal, dynamic, files };
}
