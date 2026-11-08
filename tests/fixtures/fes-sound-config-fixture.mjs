// SPDX-License-Identifier: MPL-2.0
import { NativeConfiguration } from '../../src/native/config.mjs';
import { NativeSoundConfiguration } from '../../src/native/sound-config.mjs';

export const soundConfigurationFields = [
  'volume',
  'play',
  'sysplay',
  'voicevol',
  'skipvol',
  'mute',
];
export function fesSoundConfigurationFixture(profile, seed = 0) {
  const configuration = new NativeConfiguration({ profile }),
    soundConfiguration = new NativeSoundConfiguration({ profile });
  const record = (key, id, type, index, children = []) => ({
    key,
    id,
    type,
    head: '',
    mastervol: 100,
    defaults: Object.fromEntries(
      soundConfigurationFields.map((field, i) => [
        field,
        (seed + index + i) % 4 === 0 ? -1 : 20 + index * 3 + i,
      ]),
    ),
    current: Object.fromEntries(
      soundConfigurationFields.map((field, i) => [field, 71 + index * 7 + i + seed]),
    ),
    children,
  });
  soundConfiguration.master = record('MASTER', -1, '', 0);
  soundConfiguration.parts = [
    record('voice', 7, 'voice', 1, [
      record('a', 3, 'voice', 2),
      record('b', -1, 'MiXeD', 3, [record('leaf', 0, 'voice', 4)]),
      record('a', 3, 'voice', 5),
    ]),
    record('master', -1, 'master', 6),
    record('123', 0, '123', 7),
    record('-1', 9, 'voice', 8),
    record('other', 7, 'MiXeD', 9),
    record('日本語', 10, '日本語', 10),
  ];
  // The common setter epilogue recomputes the older VOICE block as well.
  const words = new DataView(configuration.blocks[0].buffer);
  for (let i = 0; i < 48; i++) {
    words.setUint32((5 + 29 * i) * 4, i % 3, true);
    words.setUint32((26 + 29 * i) * 4, (i * 13 + seed) % 137, true);
  }
  for (let i = 0; i < 10; i++) words.setUint32((1397 + i) * 4, i < 5 ? 40 + i * 7 : i % 2, true);
  return { configuration, soundConfiguration };
}

export function* fesSoundConfigurationCases() {
  const fields = ['volume', 'play', 'sysplay', 'mute', 'voicebgm'];
  for (let seed = 0; seed < 3; seed++) {
    for (const operation of ['get', 'set']) {
      const first = operation === 'get' ? 'destination' : 'value';
      for (const tokens of [[], [first]]) yield { seed, operation, tokens, value: 37 };
      for (const field of [...fields, ...(operation === 'set' ? ['reset'] : [])]) {
        for (const suffix of ['', '_id', '_type']) {
          const selectors =
            suffix === '_id'
              ? [
                  [],
                  ['7'],
                  ['7', '3'],
                  ['7', '999', '3'],
                  ['999'],
                  ['7', '-1'],
                  ['-1'],
                  ['0'],
                  ['negative'],
                  ['parent', 'child'],
                ]
              : suffix === '_type'
                ? [
                    [],
                    ['voice'],
                    ['VOICE'],
                    ['MiXeD'],
                    ['mixed'],
                    ['none'],
                    ['master'],
                    ['123'],
                    ['日本語'],
                    ['voice', 'ignored'],
                  ]
                : [
                    [],
                    ['master'],
                    ['MASTER'],
                    ['voice'],
                    ['a'],
                    ['123'],
                    ['-1'],
                    ['日本語'],
                    ['none'],
                    ['voice', 'ignored'],
                  ];
          for (const selector of selectors)
            for (const value of operation === 'get' ? [37] : [-1, 0, 37, -2147483648])
              yield { seed, operation, tokens: [first, field + suffix, ...selector], value };
        }
      }
      for (const name of [
        'unknown',
        'Volume',
        'voicevol',
        'skipvol',
        'reset_all',
        'volume_ID',
        'reset',
      ]) {
        if (operation === 'set' && name === 'reset') continue;
        yield { seed, operation, tokens: [first, name, 'not_an_expression'], value: 31 };
      }
    }
  }
}

export function fesSoundExpression(token, row, trace) {
  trace.push(token);
  const symbols = { destination: 19, value: row.value, negative: -1, parent: 7, child: 3 };
  if (Object.hasOwn(symbols, token)) return symbols[token];
  if (!/^-?\d+$/.test(token)) throw new Error(`Unexpected authored numeric expression ${token}`);
  return Number(token) | 0;
}

export function fesSoundConfigurationState(configuration, soundConfiguration) {
  const output = [],
    visit = (record) => {
      output.push(...soundConfigurationFields.map((field) => record.current[field] >>> 0));
      for (const child of record.children) visit(child);
    };
  visit(soundConfiguration.master);
  for (const part of soundConfiguration.parts) visit(part);
  return Buffer.concat([
    Buffer.from(Uint32Array.from(output).buffer),
    ...configuration.blocks.map((block) => Buffer.from(block)),
  ]);
}

export function* fesSoundConfigurationTokenCases() {
  const forms = [
    '7',
    '-1',
    '(1 + (2 * 3))',
    '(:1 + 2)',
    '"voice"',
    '":voice"',
    '"v o i c e"',
    '":v o i c e"',
    'name(3)',
    '$(3)',
    'abc"str"',
    '"unterminated',
    '(unterminated',
    '日本語',
    '$str-1',
    '$str0x10',
    '\\_',
    '\\n',
    '(:)',
    '":"',
    '()',
    '""',
    'a\tb',
    '("(")',
  ];
  for (const form of forms)
    for (const space of [' ', '  ', '\t']) {
      yield `getsndconfex ${form}${space}volume master`;
      yield `setsndconfex 37 volume_id ${form}${space}7 3`;
    }
  yield '';
  yield '   ';
  yield 'get volume_id 7\0 3';
}
