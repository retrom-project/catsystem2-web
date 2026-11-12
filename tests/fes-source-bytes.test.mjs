// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgram } from '../src/fes/program.mjs';
import { prepareFESSource, replaceFESMacros, fesRawTail } from '../src/fes/source.mjs';
import {
  fesSourceBytes,
  fesByteView,
  fesNarrowText,
  tokenizeFESByteLine,
} from '../src/fes/tokens.mjs';
import { NativeFESSourceArena } from '../src/native/fes-source.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const utf8 = (text) => new TextEncoder().encode(text),
  join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]));

test('FES scanning keeps BOM, codec-ambiguous and invalid bytes at their actual parameter positions', () => {
  for (const payload of [
    utf8('日本語'),
    encodeCP932('猫'),
    Uint8Array.of(0xc2, 0xa5),
    Uint8Array.of(0x81, 0xff, 0x80),
  ]) {
    const line = join(utf8('label str '), payload),
      source = join(
        Uint8Array.of(0xef, 0xbb, 0xbf),
        utf8('#DEFINE\r\nSTRING hidden\r\n#START\r\n'),
        line,
        utf8('\0ignored'),
      );
    const program = parseProgram(source);
    assert.deepEqual(program.definitions, [], 'a BOM is retained before the first header');
    assert.deepEqual(program.blocks.START, [line]);
    assert.deepEqual(fesRawTail(program.blocks.START[0], 2), payload);
    assert.deepEqual(
      prepareFESSource(join(utf8(' label\t str  '), payload, utf8('  // discarded'))),
      [line],
    );
  }
  assert.deepEqual(parseProgram('\ufeff#START\nexit 0').blocks, Object.create(null));
  const first = Uint8Array.of(0x81),
    second = Uint8Array.of(0x82),
    tokens = tokenizeFESByteLine(join(first, utf8(' '), second));
  assert.equal(fesNarrowText(first), fesNarrowText(second));
  assert.deepEqual(tokens, [first, second]);
  assert.notEqual(tokens[0].buffer, tokens[1].buffer);
  assert.deepEqual(
    fesSourceBytes('猫'),
    utf8('猫'),
    'direct JavaScript source has one UTF8 convention',
  );
});

test('FES macro lexing preserves CP932 pair bytes before identifier and quote interpretation', () => {
  for (const profile of profiles) {
    const literals = nativeABI(profile).fes.macroLiterals,
      macros = new Map([['A', utf8('replacement')]]),
      pairWithA = Uint8Array.of(0x82, 0x41),
      pairWithSlash = Uint8Array.of(0x82, 0x5c),
      source = join(pairWithA, utf8(' A "'), pairWithSlash, utf8('" A')),
      expected = join(pairWithA, utf8(' replacement "'), pairWithSlash, utf8('" replacement'));
    assert.deepEqual(replaceFESMacros(source, macros, literals), expected);
    assert.deepEqual(
      replaceFESMacros(join(utf8('A'), Uint8Array.of(26), utf8(' A')), macros, literals),
      utf8('replacement'),
    );
    assert.deepEqual(
      replaceFESMacros(utf8('A /* A */ "//A" //A'), macros, literals),
      utf8('replacement  "//A" '),
    );
  }
});

test('FES executing copies distinguish lossy decoded aliases and restore byte offsets without registration replay', () => {
  const arena = new NativeFESSourceArena(),
    original = join(utf8('a str '), Uint8Array.of(0x81)),
    alias = join(utf8('a str '), Uint8Array.of(0x82)),
    program = { blocks: { START: [original] } },
    key = arena.register(1, 'authored', program),
    first = arena.context(key, 'START', 0, { bytes: original, offset: 2, name: '文字' }),
    second = arena.context(key, 'START', 0, { bytes: alias, offset: 2, name: '文字' });
  assert.equal(fesNarrowText(original), fesNarrowText(alias));
  assert.notEqual(first.commandPointer, second.commandPointer);
  assert.equal(first.objectNameAddress, second.objectNameAddress);
  assert.deepEqual(
    arena.read(first.commandPointer, original.length - 1),
    join(original.subarray(2), Uint8Array.of(0)),
  );
  const state = arena.snapshot(),
    restored = new NativeFESSourceArena();
  restored.restore(state);
  assert.deepEqual(
    restored.context(key, 'START', 0, { bytes: alias, offset: 2, name: '文字' }),
    second,
  );
  assert.deepEqual(restored.snapshot(), state);
  const invalid = structuredClone(state);
  invalid.blocks[0].data[0] ^= 1;
  assert.throws(() => new NativeFESSourceArena().restore(invalid), /copy mismatch/);
});

for (const profile of profiles) {
  test(`${profile} ordinary FES text shares exact mixed source bytes across holes and restores pending text without resource reads`, async () => {
    const source =
        '#INCLUDE\nmixed.h\n#DEFINE\nSTRING mix[4]\nSTRING visible\n#OBJECT SIZE PRI DISP\nmix 48,16 60001 1\nvisible 48,16 60010 1\n#START\nwait 1\nmix str WORD $str1\nvisible layout size 4\nvisible str A\nvisible draw\nvisible skip\nnext IDLE\n#IDLE\n#APPEND\nmix apend $str1\nbreak\n#NAME\nmix name WORD\nbreak\n#OVERRIDE\nmix[0] str Z\nbreak\n#EMPTYAPPEND\nmix apend\nbreak\n#CLEAR\nmix str\nbreak\n#CLEARNAME\nmix name\nbreak\n',
      header = join(utf8('#MACRO\nWORD '), encodeCP932('猫'), utf8('\nCAPTURED $str0\n')),
      bankText = join(utf8('日本'), Uint8Array.of(0xc2, 0xa5), utf8('X')),
      expandedBank = join(bankText.subarray(0, -1), utf8('XX')),
      expected = join(encodeCP932('猫'), utf8(' '), expandedBank),
      world = await defaultFESWorld(profile, { 'screen.fes': utf8(source), 'mixed.h': header });
    let fresh;
    try {
      const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id));
      bank.setBytes(0, encodeCP932('初'));
      bank.setBytes(1, bankText);
      world.configuration.scriptReplacements.add(utf8('X'), utf8('XX'));
      const h = await loadDefaultFES(world),
        { instance } = h,
        collection = instance.collection;
      assert.deepEqual(instance.macros.get('CAPTURED'), encodeCP932('初'));
      bank.setBytes(0, utf8('changed after registration'));
      for (let index = 1; index < 4; index++)
        await collection.remove(collection.lookup('mix', index));
      instance.createObjects(
        FES_OBJECT_DEFINITION_ORDER.indexOf(profile === profiles[1] ? 'STRING8' : 'NVSTRING'),
        'mix',
        3,
      );
      instance.createObjects(FES_OBJECT_DEFINITION_ORDER.indexOf('NVSTRING'), 'mix', 4);
      await instance.applyObjects('#OBJECT SIZE PRI DISP', 'mix 48,16 60001 1');
      await collection.remove(collection.lookup('mix', 1));
      const reads = [],
        expand = bank.expandBytes.bind(bank);
      bank.expandBytes = (bytes) => {
        reads.push(bytes.slice());
        return expand(bytes);
      };
      await h.task.tick();
      await h.task.tick();
      await h.task.syncObjects();
      await world.tick();
      const objects = [0, 2, 3].map((index) => collection.lookup('mix', index));
      for (const object of objects) {
        assert.deepEqual(object.nativeTextState.source, expected);
        const textTask = world.graphics.get(object.nativeTaskID),
          writer = await textTask.writer();
        assert.deepEqual(
          join(
            ...textTask.text.sourceEvents
              .filter((event) => event.kind === 'append')
              .map((event) => event.bytes),
          ),
          expected,
          'the actual D5 service receives unchanged bytes',
        );
        if (object.nativeType !== 29) assert.deepEqual(writer.parser.source, expected);
      }
      assert.equal(
        reads.filter(
          (bytes) => fesByteView(bytes) === fesByteView(join(encodeCP932('猫'), utf8(' $str1'))),
        ).length,
        1,
      );
      assert.notEqual(
        objects[0].nativeTextState.source.buffer,
        objects[1].nativeTextState.source.buffer,
      );
      const visibleTask = world.graphics.get(instance.byKey.get('visible').nativeTaskID),
        pixels = (await visibleTask.writer()).frame();
      assert.ok(
        pixels.rgba.some((value, index) => index % 4 === 3 && value),
        'the actual D5 bitmap contains text pixels',
      );
      assert.equal(world.graphics.stage.planes[visibleTask.plane.stageKey].visible, true);
      await h.task.player.notify('EMPTYAPPEND');
      for (const object of objects) assert.deepEqual(object.nativeTextState.source, expected);
      await h.task.player.notify('NAME');
      assert.deepEqual(objects[2].nativeTextState.secondary, encodeCP932('猫'));
      assert.equal(objects[0].nativeTextState.secondary.length, 0);
      await h.task.player.notify('APPEND');
      assert.equal(reads.filter((bytes) => fesByteView(bytes) === '$str1').length, 1);
      const pending = join(expected, expandedBank);
      for (const object of objects) assert.deepEqual(object.nativeTextState.source, pending);
      const checkpoint = world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = async (name) => {
        if (name !== 'case.kcs')
          throw new Error(`Fresh FES restore read unexpected resource ${name}`);
        return read(name);
      };
      await fresh.restore(checkpoint);
      const root = fresh.objects.objects.get(h.id).implementation.player.root;
      assert.deepEqual(root.macros.get('CAPTURED'), encodeCP932('初'));
      for (const index of [0, 2, 3])
        assert.deepEqual(root.collection.lookup('mix', index).nativeTextState.source, pending);
      await root.runtime.sync();
      for (const index of [0, 2, 3]) {
        const object = root.collection.lookup('mix', index),
          textTask = fresh.graphics.get(object.nativeTaskID),
          writer = await textTask.writer();
        assert.deepEqual(
          join(
            ...textTask.text.sourceEvents
              .filter((event) => event.kind === 'append')
              .map((event) => event.bytes),
          ),
          pending,
        );
        if (object.nativeType !== 29) assert.deepEqual(writer.parser.source, pending);
      }
      await root.player.notify('OVERRIDE');
      assert.deepEqual(root.collection.lookup('mix', 0).nativeTextState.source, utf8('Z'));
      assert.deepEqual(root.collection.lookup('mix', 2).nativeTextState.source, pending);
      const restoredVisible = fresh.graphics.get(root.byKey.get('visible').nativeTaskID);
      assert.deepEqual((await restoredVisible.writer()).frame(), pixels);
      assert.equal(fresh.graphics.stage.planes[restoredVisible.plane.stageKey].visible, true);
      const restoredBank = fresh.runtime.handles.get(
          fresh.objects.objects.get(h.id).context.stringBank,
          'string-bank',
        ),
        expandRestored = restoredBank.expandBytes.bind(restoredBank);
      let emptyReads = 0;
      restoredBank.expandBytes = (bytes) => {
        if (!bytes.length) emptyReads++;
        return expandRestored(bytes);
      };
      await root.player.notify('CLEARNAME');
      await root.player.notify('CLEAR');
      for (const index of [0, 2, 3])
        assert.equal(root.collection.lookup('mix', index).nativeTextState.source.length, 0);
      assert.equal(root.collection.lookup('mix', 3).nativeTextState.secondary.length, 0);
      assert.equal(
        emptyReads,
        0,
        'missing str/name tails clear without running the bank or SCRIPT',
      );
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
