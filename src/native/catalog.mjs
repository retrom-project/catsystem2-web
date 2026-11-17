// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
export const NATIVE_CONTROL_CODES = Object.freeze({
  0: 'suspend without a result',
  1: 'push a word result and continue',
  2: 'continue without a result',
  3: 'push a word result and suspend',
  4: 'suspend without a result',
  5: 'restore the GCALL program counter and arguments, then retry later',
});
export function nativeCatalog(profile, table = 'main') {
  const definition = nativeABI(profile).tables[table];
  if (!definition) throw new Error(`Unknown native profile/table ${profile}/${table}`);
  return definition.entries.map(({ signature, ...entry }) =>
    Object.freeze({ profile, table, ...entry, argumentWords: signature.argumentWords }),
  );
}
