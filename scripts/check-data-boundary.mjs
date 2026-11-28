// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCalculationSource } from './check-calculation-boundary.mjs';
const DATA_MODULES = Object.freeze([
  'src/gallery.mjs',
  'src/native/bank.mjs',
  'src/native/buffer-memory.mjs',
  'src/native/character-names.mjs',
  'src/native/compiled-table.mjs',
  'src/native/configuration-query.mjs',
  'src/native/content-databases.mjs',
  'src/native/data-buffer.mjs',
  'src/native/data-text.mjs',
  'src/native/database.mjs',
  'src/native/dictionary.mjs',
  'src/native/gallery-tables.mjs',
  'src/native/gallery.mjs',
  'src/native/heap-data.mjs',
  'src/native/history-cursor.mjs',
  'src/native/image-buffer-info.mjs',
  'src/native/mission-table.mjs',
  'src/native/motion-persistence.mjs',
  'src/native/nametable.mjs',
  'src/native/ordered-map.mjs',
  'src/native/persistence.mjs',
  'src/native/question-table.mjs',
  'src/native/record-queue.mjs',
  'src/native/record-sort.mjs',
  'src/native/record-stack.mjs',
  'src/native/resource-cache.mjs',
  'src/native/resource-search.mjs',
  'src/native/resource-selection.mjs',
  'src/native/resources.mjs',
  'src/native/save-slots.mjs',
  'src/native/scene-checkpoint.mjs',
  'src/native/scene-data.mjs',
  'src/native/scene-history.mjs',
  'src/native/script-xml.mjs',
  'src/native/section-table.mjs',
  'src/native/selection-table.mjs',
  'src/native/sparse-bytes.mjs',
  'src/native/storage.mjs',
  'src/native/string-bank.mjs',
  'src/native/tile-actions.mjs',
  'src/native/tile-game.mjs',
  'src/native/tile-hands.mjs',
  'src/native/tile-model.mjs',
  'src/native/tile-round.mjs',
  'src/native/tile-special.mjs',
  'src/native/xml.mjs',
  'src/saves.mjs',
]);

export async function checkDataBoundary(root) {
  for (const file of DATA_MODULES)
    validateCalculationSource(await readFile(resolve(root, file), 'utf8'), file, 'Data');
  console.log('Data source boundary checked against actual ordinary modules.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkDataBoundary(fileURLToPath(new URL('..', import.meta.url)));
