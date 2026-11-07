// SPDX-License-Identifier: MPL-2.0
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { walk } from './node-files.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const path of ['src', 'web', 'index.html', 'LICENSE', 'NOTICE.md', 'references.json'])
  await cp(join(root, path), join(output, path), { recursive: true });
const files = [];
for (const entry of (await walk(output)).sort((a, b) => a.path.localeCompare(b.path)))
  files.push({
    ...entry,
    sha256: createHash('sha256')
      .update(await readFile(join(output, entry.path)))
      .digest('hex'),
  });
await writeFile(
  join(output, 'build.json'),
  JSON.stringify({ format: 'catsystem2-web-standalone', files }, null, 2) + '\n',
);
console.log(`Built ${files.length} standalone files; no game assets included.`);
