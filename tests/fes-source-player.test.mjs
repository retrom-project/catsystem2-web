// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { FESPlayer } from '../src/fes/player.mjs';
import { parseProgram } from '../src/fes/program.mjs';
import { NativeFESText } from '../src/native/fes-text.mjs';
import { tokenizeNativeFESSoundConfiguration } from '../src/native/fes-sound-config.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { memoryGame, ascii, u32 } from './helpers.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
function packed(text) {
  const bytes = new TextEncoder().encode(text + '\0'),
    body = deflateSync(bytes);
  return new Uint8Array([
    ...ascii('FES\0'),
    ...u32(body.length),
    ...u32(bytes.length),
    ...u32(0),
    ...body,
  ]);
}
function player(source, profile, strings = {}) {
  const game = memoryGame({
      'screen.fes': typeof source === 'string' ? new TextEncoder().encode(source) : source,
      'types.h': new TextEncoder().encode('#DEFINE\rSTRING label\r#OBJECT DEFAULT\rlabel A\r'),
    }),
    p = new FESPlayer(
      game,
      {},
      {
        fesTokens: (line) => tokenizeNativeFESSoundConfiguration(line, profile),
        fesMacroLiterals: () => nativeABI(profile).fes.macroLiterals,
      },
      {},
      strings,
    ),
    text = new NativeFESText({ world: {} });
  p.captured = [];
  p.nativeText = {
    supports: (object) => text.supports(object),
    command(instance, object, verb, args, context) {
      p.captured.push({
        verb,
        input: new TextDecoder('shift_jis').decode(text.input(instance, object, args, context)),
        source: p.localSources.string(context.commandPointer),
        pointer: context.commandPointer,
        name: p.localSources.string(context.objectNameAddress),
      });
      return 0;
    },
  };
  return p;
}

test('the FES player prepares plain source once and restores registered macros and executing source copies', async () => {
  const source = `#INCLUDE
 types.h
#MACRO
 A B ignored
 B 7
 VALUE $str0
 SHOW str
#START
 wait 1
 $0=VALUE
 if (1) label SHOW "A  B"
 next WAIT
#WAIT
`;
  for (const profile of profiles) {
    const p = player(source, profile, { 0: '9' });
    await p.start('screen');
    assert.equal(p.root.byKey.get('label').defaultHandler, 'A');
    assert.equal(p.root.expandMacros('A B'), 'B 7');
    assert.equal(p.root.expandMacros('"A"'), '"A"');
    assert.deepEqual(p.root.program.blocks.START, [
      'wait 1',
      '$0=VALUE',
      'if (1)',
      'label SHOW "A B"',
      'endif',
      'next WAIT',
    ]);
    p.strings[0] = '99';
    await p.step();
    const saved = p.snapshot(),
      restored = player(source, profile, { 0: '99' });
    await restored.restore(saved);
    await Promise.all([p.step(), restored.step()]);
    assert.equal(p.globals[0], 9);
    assert.equal(restored.globals[0], 9);
    assert.deepEqual(p.captured, [
      {
        verb: 'str',
        input: '"A B"',
        source: 'label str "A B"',
        pointer: p.captured[0].pointer,
        name: 'label',
      },
    ]);
    assert.deepEqual(restored.captured, p.captured);
    assert.deepEqual(restored.snapshot(), p.snapshot());
    assert.equal(p.root.program.blocks.START[3], 'label SHOW "A B"');
  }
});

test('compressed FES indexes prepared source without normalizing spaces, comments or includes again', async () => {
  const source =
    '#INCLUDE\r\nabsent.h\r\n#DEFINE\r\nSTRING label\r\n#START\r\nlabel str "A   B" // retained\r\nexit 0\r\n';
  for (const profile of profiles) {
    const p = player(packed(source), profile);
    await p.start('screen');
    await p.step();
    assert.equal(p.root.finished, 0);
    assert.equal(p.captured[0].input, '"A   B" // retained');
    assert.equal(p.captured[0].source, 'label str "A   B" // retained');
    assert.deepEqual(p.root.program.blocks.START, ['label str "A   B" // retained', 'exit 0']);
  }
});

test('section registration preserves raw header tokens, only the first macro value, and ordinary identifier labels', () => {
  const program = parseProgram(
    '#MACRO\nA replacement extra\nB 17\n#DEFINE\nIMAGE A\n#OBJECT PRI\nA B\n#__proto__\nexit 1\n#constructor\nexit 2\n',
  );
  assert.deepEqual(program.macros, [
    ['A', 'replacement'],
    ['B', '17'],
  ]);
  assert.deepEqual(program.definitions, [{ type: 'IMAGE', name: 'A', count: null }]);
  assert.deepEqual(program.tables, [
    {
      header: '#OBJECT PRI',
      columns: ['PRI'],
      rows: [{ target: 'A', values: ['B'], source: 'A B' }],
    },
  ]);
  assert.deepEqual(program.blocks.__proto__, ['exit 1']);
  assert.deepEqual(program.blocks.constructor, ['exit 2']);
});

test('data definitions and commands consume grouped parameter tokens without splitting them again', async () => {
  const { NativeFESData } = await import('../src/native/fes-data.mjs'),
    source =
      '#DEFINE\nSTRTABLE words\nFILELIST files\n#OBJECT FILE\nwords (:table with space.tsv)\n#START\nfiles make (:folder with space) *\nnext WAIT\n#WAIT\n';
  for (const profile of profiles) {
    const reads = [],
      searches = [],
      world = {
        profile,
        runtime: {
          async read(name, category) {
            reads.push([name, category]);
            return new Uint8Array();
          },
        },
        async findNativeFiles(pattern) {
          searches.push(pattern);
          return [];
        },
        getNativeFeature() {
          throw new Error('Data tokens must not request the EXE');
        },
      },
      p = player(packed(source), profile),
      service = new NativeFESData(world);
    p.nativeData = service;
    await p.start('screen');
    await service.initialize(p.root, p.root.byKey.get('words'));
    await p.step();
    assert.deepEqual(reads, [['table with space.tsv', 'config']]);
    assert.deepEqual(searches, ['folder with space\\*']);
    assert.equal(p.root.label, 'WAIT');
  }
});
