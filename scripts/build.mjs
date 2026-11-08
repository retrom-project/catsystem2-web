// SPDX-License-Identifier: MPL-2.0
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { walk } from './node-files.mjs';
import { PPI_BACKEND_FILES, PPI_BACKEND_SHA256 } from '../src/ppi/backend-artifact.mjs';
import { NATIVE_ZLIB_FILES, NATIVE_ZLIB_SHA256 } from '../src/native/zlib-artifact.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const path of ['src', 'web', 'index.html', 'LICENSE', 'NOTICE.md', 'references.json'])
  await cp(join(root, path), join(output, path), { recursive: true });
const backendRoot = join(root, '.local/vendor/ppi');
const backendManifest = JSON.parse(await readFile(join(backendRoot, 'manifest.json'), 'utf8'));
if (backendManifest.artifacts['unicorn_x86.js'].sha256 !== PPI_BACKEND_SHA256)
  throw new Error('Unicorn manifest does not identify the fixed patched backend');
for (const [name, artifact] of Object.entries(backendManifest.artifacts)) {
  if (!PPI_BACKEND_FILES.includes(name)) throw new Error(`Unexpected backend artifact ${name}`);
  const bytes = await readFile(join(backendRoot, name));
  if (
    bytes.length !== artifact.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
  )
    throw new Error(`Unicorn artifact does not match manifest: ${name}`);
}
await mkdir(join(output, 'vendor'));
for (const name of PPI_BACKEND_FILES)
  await cp(join(backendRoot, name), join(output, 'vendor', name));
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
await cp(join(root, 'third_party'), join(output, 'third_party'), { recursive: true });
const files = [];
for (const entry of (await walk(output)).sort((a, b) => a.path.localeCompare(b.path)))
  files.push({
    path: entry.path,
    size: entry.size,
    sha256: createHash('sha256')
      .update(await readFile(join(output, entry.path)))
      .digest('hex'),
  });
await writeFile(
  join(output, 'build.json'),
  JSON.stringify({ format: 'catsystem2-web-standalone', files }, null, 2) + '\n',
);
console.log(`Built ${files.length} standalone files; no game assets included.`);
