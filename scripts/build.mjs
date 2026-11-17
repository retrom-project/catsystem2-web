// SPDX-License-Identifier: MPL-2.0
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { productionFiles, validateOrdinaryDistribution } from './production-files.mjs';
import { checkPluginBoundary, validatePluginDistribution } from './check-plugin-boundary.mjs';
import { checkNativeEntry } from './check-native-entry.mjs';
import { walk } from './node-files.mjs';
import { NATIVE_ZLIB_FILES, NATIVE_ZLIB_SHA256 } from '../src/native/zlib-artifact.mjs';
import { NATIVE_FREETYPE_FILES, NATIVE_FREETYPE_SHA256 } from '../src/native/freetype-artifact.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  output = join(root, 'dist');
await checkNativeEntry(root);
const plan = await productionFiles(root);
await checkPluginBoundary(root);
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const path of plan.files.filter((path) => !path.startsWith('vendor/'))) {
  await mkdir(dirname(join(output, path)), { recursive: true });
  await cp(join(root, path), join(output, path));
}
await mkdir(join(output, 'vendor'));
const zlibRoot = join(root, '.local/vendor/zlib'),
  zlibManifest = JSON.parse(await readFile(join(zlibRoot, 'zlib-manifest.json'), 'utf8'));
if (zlibManifest.artifacts['native_zlib.mjs'].sha256 !== NATIVE_ZLIB_SHA256)
  throw new Error('zlib manifest does not identify the fixed native library');
for (const [name, artifact] of Object.entries(zlibManifest.artifacts)) {
  if (!NATIVE_ZLIB_FILES.includes(name)) throw new Error(`Unexpected zlib artifact ${name}`);
  const bytes = await readFile(join(zlibRoot, name));
  if (
    bytes.length !== artifact.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
  )
    throw new Error(`zlib artifact does not match manifest: ${name}`);
}
for (const name of NATIVE_ZLIB_FILES) await cp(join(zlibRoot, name), join(output, 'vendor', name));
const fontRoot = join(root, '.local/vendor/freetype'),
  fontManifest = JSON.parse(await readFile(join(fontRoot, 'freetype-manifest.json'), 'utf8'));
for (const [name, sha256] of Object.entries(NATIVE_FREETYPE_SHA256))
  if (fontManifest.artifacts[name].sha256 !== sha256)
    throw new Error('FreeType manifest does not identify the fixed font backend: ' + name);
for (const [name, artifact] of Object.entries(fontManifest.artifacts)) {
  if (!NATIVE_FREETYPE_FILES.includes(name)) throw new Error(`Unexpected font artifact ${name}`);
  const bytes = await readFile(join(fontRoot, name));
  if (
    bytes.length !== artifact.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
  )
    throw new Error(`FreeType artifact does not match manifest: ${name}`);
}
for (const name of NATIVE_FREETYPE_FILES)
  await cp(join(fontRoot, name), join(output, 'vendor', name));
const files = [];
for (const entry of (await walk(output)).sort((a, b) => a.path.localeCompare(b.path)))
  files.push({
    path: entry.path,
    size: entry.size,
    sha256: createHash('sha256')
      .update(await readFile(join(output, entry.path)))
      .digest('hex'),
  });
validatePluginDistribution(files);
validateOrdinaryDistribution(files);
const actual = files.map((row) => row.path).sort();
if (JSON.stringify(actual) !== JSON.stringify(plan.files))
  throw new Error('Actual distribution differs from its ordinary dependency/asset closure');
await writeFile(
  join(output, 'build.json'),
  JSON.stringify({ format: 'catsystem2-web-standalone', files }, null, 2) + '\n',
);
console.log(`Built ${files.length} standalone files; no game assets included.`);
