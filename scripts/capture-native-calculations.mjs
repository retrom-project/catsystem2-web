// SPDX-License-Identifier: MPL-2.0
// Explicit private-fixture tool; never imported by the runtime or public lane.
import { readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { engineFixtureSet } from '../tests/fixtures/oracle-fixtures.mjs';
import { nativeScalarCases } from '../tests/fixtures/scalar-cases.mjs';
import { nativeGeometryCases } from '../tests/fixtures/geometry-cases.mjs';
import { nativeViewRectangleCases } from '../tests/fixtures/view-rectangle-cases.mjs';
import { nativeUTF8Cases } from '../tests/fixtures/utf8-cases.mjs';
import { nativeRandomCases } from '../tests/fixtures/random-cases.mjs';
import {
  nativeSDKStandardCases,
  SDK_STANDARD_PROFILE,
} from '../tests/fixtures/sdk-standard-cases.mjs';
import {
  nativeUnicodeOutputCases,
  UNICODE_OUTPUT_PROFILE,
} from '../tests/fixtures/unicode-output-cases.mjs';
import { observeNativeCase } from '../tests/fixtures/native-differential.mjs';
import { observeUnicodeOutput } from '../tests/fixtures/unicode-output-observer.mjs';
import { calculationOracle } from '../tests/fixtures/calculation-oracle.mjs';
import { viewRectangleOracle } from '../tests/fixtures/view-rectangle-oracle.mjs';
import { randomOracle } from '../tests/fixtures/random-oracle.mjs';
import { sdkStandardOracle } from '../tests/fixtures/sdk-standard-oracle.mjs';
import { unicodeOutputOracle } from '../tests/fixtures/unicode-output-oracle.mjs';
import { nativeGolden } from '../tests/fixtures/native-golden.mjs';
const families = {
  scalar: {
    cases: nativeScalarCases,
    scope:
      'Authored scalar GCALLs through unmodified original handlers at FPCW 0x007f/MXCSR 0x1f80 on the pinned backend. Declared floating memory words are retained explicitly; all other bytes hash exactly. Results use the fixed per-operation budget.',
  },
  geometry: {
    cases: nativeGeometryCases,
    adapter: calculationOracle,
    scope:
      'Authored main matrix/vector inputs, original table handlers and semantic current-matrix RAM, normal FPCW 0x007f/MXCSR 0x1f80. Declared f32 words retained explicitly; all other bytes hashed exactly.',
  },
  'view-rectangle': {
    cases: nativeViewRectangleCases,
    adapter: viewRectangleOracle,
    scope:
      'Authored main rectangle/view GCALL inputs; original table handlers, USER32 rectangle service as independently Wine-tested boundary; full VM and semantic view state exact.',
  },
  utf8: {
    cases: nativeUTF8Cases,
    scope:
      'Authored game UTF8 inputs and original handlers, permissive byte walker, fixed NLS boundary, all VM bytes exact.',
  },
  random: {
    cases: nativeRandomCases,
    adapter: randomOracle,
    scope:
      'Independently seeded main/generic MT19937 GCALL sequences, full integer/real RAM state, exact output bits including float endpoints; JS does not bind oracle RAM.',
  },
  'sdk-standard': {
    cases: (profile) => (profile === SDK_STANDARD_PROFILE ? nativeSDKStandardCases(profile) : []),
    adapter: sdkStandardOracle,
    scope:
      'Authored SDK standard inputs, actual SDK table wrappers. Exact VM/return/control, only explicitly checked formatter result bytes treated as private scratch.',
  },
  'unicode-output': {
    scope:
      'Authored Unicode clipboard/log GCALL inputs. Original formatter, converter and wide CRT execute; only verified private OS transports supplied. Raw UTF-16 service input retained including lone surrogates; VM bytes exact.',
  },
};
const [mode, ...selected] = process.argv.slice(2);
if (
  !['--check', '--write'].includes(mode) ||
  selected.some((name) => !Object.hasOwn(families, name))
)
  throw Error(
    'Usage: capture-native-calculations.mjs --check|--write [scalar|geometry|view-rectangle|utf8|random|sdk-standard|unicode-output ...]',
  );
const fixtures = await engineFixtureSet({ required: true });
let differs = false;
for (const name of selected.length ? selected : Object.keys(families)) {
  const family = families[name],
    output = { scope: family.scope };
  let count = 0;
  if (name === 'unicode-output') {
    const fixture = fixtures.find((f) => f.profile === UNICODE_OUTPUT_PROFILE),
      cases = {};
    for (const input of nativeUnicodeOutputCases()) {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        const observation = await observeUnicodeOutput(
          input,
          unicodeOutputOracle(engine, input.id),
        );
        cases[input.name] = { native: nativeGolden(observation), effects: observation.effects };
        count++;
      } finally {
        await engine.close();
      }
    }
    Object.assign(output, { profile: fixture.profile, sha256: fixture.sha256, cases });
  } else {
    output.profiles = {};
    for (const fixture of fixtures) {
      const inputs = family.cases(fixture.profile);
      if (!inputs.length) continue;
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        const cases = {};
        for (const input of inputs) {
          cases[input.name] = nativeGolden(
            await observeNativeCase(input, engine, family.adapter),
            input.policy,
          );
          count++;
        }
        output.profiles[fixture.profile] = { sha256: fixture.sha256, cases };
      } finally {
        await engine.close();
      }
    }
  }
  const url = new URL('../tests/fixtures/' + name + '-golden.json', import.meta.url),
    text = await format(JSON.stringify(output, null, 2), {
      ...(await resolveConfig(url.pathname)),
      parser: 'json',
    });
  if (mode === '--write') await writeFile(url, text);
  else if ((await readFile(url, 'utf8')) !== text) {
    differs = true;
    console.error(name + ' golden differs; inspect oracle evidence before --write');
  }
  console.log(name + ': ' + count + ' authored inputs');
}
if (differs) process.exitCode = 1;
