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
// Remaining EXE table locations are transition data, retained until their
// consumers migrate in phases 3–9. The ABI documents contain no addresses.
const executableTables = {
  'sdk-4.01-engine-2.6.1.74': {
    sha256: '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f',
    tables: {
      main: { count: 1009, va: 11782400 },
      generic: { count: 45, va: 12770024 },
      'particle-v1': { count: 44, va: 11865632 },
      'particle-v2': { count: 51, va: 11865816 },
    },
  },
  'nekopara-vol3-engine-2.6.1.76': {
    sha256: 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0',
    tables: {
      main: { count: 1055, va: 10673464 },
      generic: { count: 45, va: 11676064 },
      'particle-v1': { count: 44, va: 10749632 },
      'particle-v2': { count: 51, va: 10749816 },
    },
  },
};
export const NATIVE_EXE_PROFILES = Object.freeze(executableTables);
export function nativeCatalog(profile, table = 'main') {
  const definition = nativeABI(profile).tables[table];
  if (!definition) throw new Error(`Unknown native profile/table ${profile}/${table}`);
  return definition.entries.map(({ signature: _signature, ...entry }) =>
    Object.freeze({ profile, table, ...entry }),
  );
}
