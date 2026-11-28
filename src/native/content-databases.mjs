// SPDX-License-Identifier: MPL-2.0
// Independent JS models share the script's typed content-database handle family.
import { NativeQuestionTable, installNativeQuestionTables } from './question-table.mjs';
import { NativeSelectionTable, installNativeSelectionTables } from './selection-table.mjs';
import { NativeCompiledTable, installNativeCompiledTables } from './compiled-table.mjs';
import { NativeMissionTable, installNativeMissionTables } from './mission-table.mjs';

const models = Object.freeze({
  question: NativeQuestionTable,
  selection: NativeSelectionTable,
  compiledTable: NativeCompiledTable,
  mission: NativeMissionTable,
});
export const nativeContentDatabaseCodec = Object.freeze({
  snapshot: (value) => ({ family: value.family, state: value.data.snapshot() }),
  restore: ({ family, state }) => {
    const Model = models[family];
    if (!Model) throw new Error('Invalid native content database family');
    return { family, data: new Model().restore(state) };
  },
});
export function installNativeContentDatabases(world) {
  installNativeQuestionTables(world);
  installNativeSelectionTables(world);
  installNativeCompiledTables(world);
  installNativeMissionTables(world);
}
