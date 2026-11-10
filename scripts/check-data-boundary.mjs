// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCalculationSource } from './check-calculation-boundary.mjs';
export function validateDataInventory(board) {
  const rows = board.profiles.flatMap((profile) =>
    profile.entries.filter((entry) => entry.domain === 4),
  );
  if (
    !rows.length ||
    rows.some((entry) => !['pure-js', 'unsupported'].includes(entry.implementation))
  )
    throw new Error('Data native still executes the EXE or has an unresolved implementation');
  for (const entry of rows) {
    if (entry.review === 'needs-review') throw new Error('Data native has an unresolved review');
    if (
      entry.implementation === 'unsupported' &&
      entry.migrationReview?.decision !== 'retain-unsupported'
    )
      throw new Error('Data unsupported entry lacks its reachability decision');
  }
  for (const file of board.files.filter((file) => file.domain === 4))
    if (
      Object.values(file.exeDependencies).some(Boolean) ||
      file.executionSites.length ||
      file.indirectSites.length
    )
      throw new Error('Data EXE dependency ' + file.file);
  const selections = board.remainingProfileSelections;
  if (
    [
      ...selections.profileIndexSites,
      ...selections.addressSelections,
      ...selections.versionGuards,
    ].some((row) => row.domain === 4)
  )
    throw new Error('Data profile/VA selector remains');
  const scene = board.nonNativeEntries.find(
    (entry) => entry.name === 'js-scene-to-exe-reader-history',
  )?.projection;
  if (scene?.direction !== 'JS-to-PE' || scene.removePhase !== 8 || !scene.authority)
    throw new Error('Data scene projection lacks its one-way ownership record');
}
export async function checkDataBoundary(root) {
  const board = JSON.parse(await readFile(resolve(root, 'docs/b-migration.json'), 'utf8'));
  validateDataInventory(board);
  for (const file of board.files.filter((file) => file.domain === 4))
    validateCalculationSource(await readFile(resolve(root, file.file), 'utf8'), file.file, 'Data');
  console.log(
    'Data boundary checked. JS owns domain 4 state and registered projections retain their consumer phases.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkDataBoundary(fileURLToPath(new URL('..', import.meta.url)));
