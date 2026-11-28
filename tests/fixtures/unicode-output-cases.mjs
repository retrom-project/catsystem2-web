// SPDX-License-Identifier: MPL-2.0
import { authoredByteWords } from './utf8-cases.mjs';
export const UNICODE_OUTPUT_PROFILE = 'nekopara-vol3-engine-2.6.1.76';
export function nativeUnicodeOutputCases() {
  const cases = [],
    encoder = new TextEncoder();
  for (const [name, bytes] of [
    ['empty', []],
    ['ascii', encoder.encode('hello')],
    ['japanese newline', encoder.encode('日本語\\nend')],
    ['supplementary BOM', encoder.encode('\ufeff😀tail')],
    ['percent', encoder.encode('100%% %s[G1024]')],
    ['percent run', encoder.encode('%%%%')],
    ['percent run three', encoder.encode('%%%%%%')],
    ['sentinel', [65, 255, 255, 66]],
    ['invalid stop', [65, 128, 66]],
    ['unchecked tail', [0xe7, 0x8c, 65, 66]],
    ['overlong', [0xc0, 0x80, 65]],
    ['long', [...encoder.encode('x'.repeat(499))]],
  ])
    for (const id of [0x40f, 0x410])
      cases.push({
        profile: UNICODE_OUTPUT_PROFILE,
        id,
        name: `${id.toString(16)}/${name}`,
        args: [256],
        words: [
          [256, authoredByteWords(bytes)],
          [1024, authoredByteWords(encoder.encode('日本語'))],
        ],
      });
  for (const options of [{ available: false }, { acceptEmpty: false }, { acceptWrite: false }])
    cases.push({
      profile: UNICODE_OUTPUT_PROFILE,
      id: 0x40f,
      name: 'clipboard ' + Object.keys(options)[0],
      args: [256],
      words: [[256, authoredByteWords(encoder.encode('text'))]],
      clipboard: options,
    });
  return cases;
}
