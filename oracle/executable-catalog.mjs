// SPDX-License-Identifier: MPL-2.0
// Physical EXE table identity belongs only to explicit oracle consumers.
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
