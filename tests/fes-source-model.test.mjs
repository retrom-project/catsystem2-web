// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  prepareFESSource,
  replaceFESMacros,
  fesRawTail,
  splitFESLines,
} from '../src/fes/source.mjs';
import { tokenizeFESLine } from '../src/fes/tokens.mjs';
import { tokenizeNativeFESSoundConfiguration } from '../src/native/fes-sound-config.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
const oracle = JSON.parse(
  await readFile(new URL('./fixtures/fes-source-model.json', import.meta.url), 'utf8'),
);
const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];

test('source normalization preserves original quote-blind cleanup, literal parentheses and mechanical inline condition expansion', () => {
  for (const profile of profiles)
    for (const sample of oracle.normalization)
      assert.deepEqual(
        prepareFESSource(sample.input, {
          tokens: (line) => tokenizeNativeFESSoundConfiguration(line, profile),
        }),
        sample.lines,
        `${profile}/${sample.label}`,
      );
  assert.deepEqual(splitFESLines('one\rtwo\r\nthree\nfour\0ignored'), [
    'one',
    'two',
    'three',
    'four',
  ]);
  assert.deepEqual(prepareFESSource('  one\t two  \n　fullwidth　\n'), [
    'one two',
    '　fullwidth　',
  ]);
});

test('macro replacement matches both original literal emission strategies and does not recursively expand aliases', () => {
  const macros = new Map([
    ['A', 'B'],
    ['B', '7'],
    ['NAME', 'ALIAS'],
    ['ALIAS', 'other'],
  ]);
  for (const sample of oracle.macros)
    assert.equal(
      replaceFESMacros(sample.input, macros, nativeABI(sample.profile).fes.macroLiterals),
      sample.output,
      sample.profile + '/' + sample.input,
    );
  const once = replaceFESMacros('cmd A', macros);
  assert.equal(once, 'cmd B');
  assert.equal(replaceFESMacros(once, macros), 'cmd 7');
  assert.equal(
    replaceFESMacros('"a\\"b"', new Map(), nativeABI(profiles[0]).fes.macroLiterals),
    '"a\\"b"',
    'no macro table means no lexical reconstruction',
  );
  assert.equal(replaceFESMacros('NAME NAME2', new Map([['NAME', '']])), ' NAME2');
});

test('raw text tails retain quotes and spaces inserted after source preparation', () => {
  const line = prepareFESSource('obj str "a  b"')[0];
  assert.equal(fesRawTail(line, 2), '"a b"');
  const replaced = replaceFESMacros('obj str WORD', new Map([['WORD', '  a  b']]));
  assert.equal(fesRawTail(replaced, 2), '  a  b');
  assert.equal(fesRawTail('obj str', 2), '');
  assert.deepEqual(tokenizeFESLine('command (1 + (2 * 3)) tail'), [
    'command',
    '(1 + (2 * 3))',
    'tail',
  ]);
  assert.deepEqual(tokenizeFESLine('command a\tb'), ['command', 'a\tb']);
});
