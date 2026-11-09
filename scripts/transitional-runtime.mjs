// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function transitionalRuntimeFiles(root) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, 'scripts/transitional-runtime.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.some(
      (file) =>
        typeof file !== 'string' || !/^(?!.*(?:^|\/)\.\.?\/)(?:web|oracle)\/.+\.mjs$/.test(file),
    ) ||
    new Set(manifest.files).size !== manifest.files.length
  )
    throw new Error('Invalid transitional runtime include list');
  return manifest.files;
}
