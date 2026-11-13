// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { parseProgram } from '../src/fes/program.mjs';
import { fesByteView } from '../src/fes/tokens.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part])),
  first = Uint8Array.of(0x81),
  second = Uint8Array.of(0x82),
  a = Uint8Array.of(0x82, 0xa0),
  i = Uint8Array.of(0x82, 0xa2),
  filename = 'assets.int/label-bytes.fes',
  source = join(
    ascii(
      '#MACRO\nGO_TARGET $str0\nCALL_TARGET $str1\n#DEFINE\nBUTTON left[2]\nBUTTON right\nCIMAGE panel\n#OBJECT SIZE COLOR DEFAULT\nleft 2,2 0xff112233 ',
    ),
    first,
    ascii('\nright 2,2 0xff445566 '),
    second,
    ascii(
      '\n#OBJECT SIZE COLOR\npanel 3,2 0xff778899\n#START\nbreak\n#JUMP\nnext\ncall CALL_TARGET\n$58+=1\nnext GO_TARGET\n#',
    ),
    first,
    ascii('\n$59+=1\nwait 1\n$60+=1\nnext IDLE\n#'),
    second,
    ascii('\n$57+=1\nbreak\n#IDLE\nbreak\n#?\n$57=999\n$61=999\nbreak\n#'),
    first,
    ascii('.FOCUS\n$55=$55*10+1\n$56=@\nbreak\n#left.FOCUS\n$55=$55*10+2\n$56=@\nbreak\n#'),
    second,
    ascii('.FOCUS\n$55=$55*10+3\nbreak\n#right.FOCUS\n$55=$55*10+4\nbreak\n#'),
    a,
    ascii('\n$61=11\nbreak\n#'),
    i,
    ascii('\n$61+=100\nbreak\n#LITERAL\n$62+=1\nnext literal\\n\n#literal\\n\n$63+=1\nbreak\n'),
    ascii('#'),
    first,
    ascii('.NAMEPTR\ncall NAMECOPY\nbreak\n#'),
    second,
    ascii('.NAMEPTR\ncall NAMECOPY\nbreak\n#NAMECOPY\n@ getid 53\n$54=@\nbreak\n'),
    ascii('#'),
    first,
    ascii('.COMMON\ncall COMMONSTEP\nbreak\n#'),
    second,
    ascii(
      '.COMMON\ncall COMMONSTEP\nbreak\n#COMMONSTEP\n@ delay (10+@)\n$52=@\nbreak\n#COMMON_GROUP\n',
    ),
    first,
    ascii(' delay 21\nbreak\n'),
  );

// This author owns raw NUL buffers. The legacy text view is observed only to
// prove that native label messages consume the existing byte service directly.
function memory(label, name = null, index = 0) {
  const data = new Uint8Array(256);
  data.set(label, 0);
  if (name) {
    data.set(name, 64);
    new DataView(data.buffer).setInt32(96, index, true);
  }
  let stringReads = 0;
  return {
    bytes(address, count) {
      return data.subarray(address, address + count);
    },
    load(address) {
      return new DataView(data.buffer).getUint32(address, true);
    },
    string(address) {
      stringReads++;
      const value = data.subarray(address),
        end = value.indexOf(0);
      return new TextDecoder('shift_jis').decode(value.subarray(0, end));
    },
    get stringReads() {
      return stringReads;
    },
  };
}
async function environment(profile, contents = source) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/label-bytes.fes': contents },
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mount = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02>',
      ),
      bytes = new Uint8Array(startup.length + mount.length);
    assert.ok(at >= 0);
    bytes.set(startup.subarray(0, at));
    bytes.set(mount, at);
    bytes.set(startup.subarray(at), at + mount.length);
    const input = new Map(template.input);
    input.set('startup.xml', new BlobFile(new Blob([bytes])));
    const game = new GameFiles(input);
    await game.open();
    player = new CatSystem2({
      game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      randomSeed: 77,
      audioContext: { currentTime: 0, close: async () => {} },
      uiLanguage: 0x409,
      transitionalExe: {
        open() {
          throw new Error('Label bytes must not open the original');
        },
      },
    });
    await player.initialize();
    assert.equal(player.world.frame, 1);
    assert.equal(player.world.runtime.variableBank(player.world.main, false).get(7), 0x12345678);
    assert.equal(player.world.nativeEngine, undefined);
    return {
      player,
      world: player.world,
      game,
      async close() {
        try {
          await player.dispose();
        } finally {
          scope.restore();
        }
      },
    };
  } catch (error) {
    try {
      await player?.dispose();
    } finally {
      scope.restore();
    }
    throw error;
  }
}
async function task(world) {
  const parent = world.main;
  world.runtime.stringBank(parent);
  const id = await world.objects.create({ kind: 34, parent: parent.id }),
    surface = await world.objects.create({ kind: 15, parent: parent.id });
  await world.sendEngine(surface, parent.id, 279, 64, 48);
  await world.sendEngine(surface, parent.id, 283);
  await world.sendEngine(id, parent.id, 331, 0, parent.context.variableBank);
  await world.sendEngine(id, parent.id, 334, 0, world.nativeTaskID(surface));
  assert.equal(world.objects.objects.get(id).context.stringBank, parent.context.stringBank);
  return {
    id,
    implementation: world.objects.objects.get(id).implementation,
    strings: world.runtime.handles.get(parent.context.stringBank, 'string-bank'),
  };
}
function defineCheckpointPixels(world) {
  const gpu = world.stageRenderer.gpu,
    { width, height } = gpu.primaryTarget;
  // The CPU-entry fixture supplies a full known frame, without a GPU claim.
  gpu.uploadRenderTarget(gpu.primaryTarget, {
    width,
    height,
    rgba: new Uint8Array(width * height * 4).fill(0x62),
  });
}

for (const profile of startupProfiles) {
  test(`normal labels retain raw aliases, exact argument stages and fresh ownership: ${profile}`, async (t) => {
    const h = await environment(profile);
    let fresh,
      phase = 'load',
      reads = 0,
      initializes = 0;
    const targetCalls = [],
      scriptCalls = [],
      eventInputs = [],
      negativeIndexInputs = [];
    try {
      const current = await task(h.world),
        words = h.world.runtime.variableBank(h.world.main, false),
        strings = current.strings,
        rules = h.world.configuration.scriptReplacements,
        file = h.game.lookup(filename).file,
        read = file.read.bind(file),
        host = current.implementation.player.host,
        argument = host.nativeFESArgumentBytes,
        apply = rules.apply,
        invokeLabels = FESInstance.prototype.invokeEventLabels;
      for (let index = 55; index < 64; index++) words.set(index, 0);
      strings.setBytes(0, ascii('$str0'));
      strings.setBytes(1, ascii('$str1'));
      rules.add(ascii('LABEL_GO'), first);
      rules.add(ascii('LABEL_CALL'), second);
      t.mock.method(file, 'read', (...args) => {
        if (phase === 'restore') throw new Error('Fresh labels must not read source');
        reads++;
        return read(...args);
      });
      t.mock.method(host, 'nativeFESArgumentBytes', function (token, ...args) {
        if (phase === 'jump' && ['$str0', '$str1'].includes(fesByteView(token)))
          targetCalls.push(fesByteView(token));
        return argument.call(this, token, ...args);
      });
      t.mock.method(rules, 'apply', function (bytes, ...args) {
        if (phase === 'jump' && ['LABEL_GO', 'LABEL_CALL'].includes(fesByteView(bytes)))
          scriptCalls.push(fesByteView(bytes));
        return apply.call(this, bytes, ...args);
      });
      t.mock.method(FESInstance.prototype, 'invokeEventLabels', function (labels, object, index) {
        if (this.runtimeID === current.id && object)
          eventInputs.push({
            labels: [...labels],
            owner: this.collection.reference(object),
            index,
          });
        if (this.runtimeID === current.id && index === -1)
          negativeIndexInputs.push({ labels: [...labels], object, index });
        return invokeLabels.call(this, labels, object, index);
      });
      const initialize = current.implementation.loadSource;
      t.mock.method(current.implementation, 'loadSource', async function (...args) {
        if (phase === 'restore') throw new Error('Fresh labels must not initialize source');
        initializes++;
        return initialize.apply(this, args);
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => filename },
      });
      const root = current.implementation.player.root,
        c = root.runtime.collection,
        left = c.lookup(ascii('left'), 1),
        right = c.lookup(ascii('right'), 0);
      assert.ok(root.program.blocks[fesByteView(first)]);
      assert.ok(root.program.blocks[fesByteView(second)]);
      assert.notEqual(
        root.program.blocks[fesByteView(first)],
        root.program.blocks[fesByteView(second)],
      );
      assert.equal(left.defaultHandler, fesByteView(first));
      assert.equal(right.defaultHandler, fesByteView(second));
      assert.equal(fesByteView(root.macros.get('GO_TARGET')), '$str0');
      assert.equal(fesByteView(root.macros.get('CALL_TARGET')), '$str1');
      strings.setBytes(0, ascii('LABEL_GO'));
      strings.setBytes(1, ascii('LABEL_CALL'));
      await h.world.sendEngine(current.id, h.world.main.id, 333);
      words.set(55, 0);
      assert.equal(await root.player.nativeEvent(left.key, 'FOCUS'), true);
      assert.equal(await root.player.nativeEvent(right.key, 'FOCUS'), true);
      assert.equal(words.get(55), 1234);
      assert.deepEqual(eventInputs.slice(0, 2), [
        {
          labels: [fesByteView(first) + '.FOCUS', 'left.FOCUS'],
          owner: { nameBytes: ascii('left'), index: 1 },
          index: 1,
        },
        {
          labels: [fesByteView(second) + '.FOCUS', 'right.FOCUS'],
          owner: { nameBytes: ascii('right'), index: 0 },
          index: 0,
        },
      ]);
      assert.equal(c.count('left'), 2);
      assert.equal(c.count('right'), 1);
      assert.equal(root.runtime.resources.entries.length, 4);
      assert.ok(c.lookup('panel', 0).imageResource.bitmap);
      // Author raw current owners through the existing JS collection service.
      // This does not enable non-ASCII DEFINE or the separate native338 entry.
      c.create('SOUND', first, 2);
      c.create('SOUND', second, 1);
      const namePointer = async (world, nameBytes, index) => {
        const payload = memory(ascii('NAMEPTR'), nameBytes, index);
        await world.sendEngine(current.id, world.main.id, 337, 64, 0, { payload });
        const bank = world.runtime.variableBank(world.main, false);
        assert.equal(bank.get(54), index);
        assert.equal(payload.stringReads, 0);
        return bank.get(53);
      };
      const firstNameAddress = await namePointer(h.world, first, 1),
        secondNameAddress = await namePointer(h.world, second, 0);
      assert.notEqual(
        firstNameAddress,
        secondNameAddress,
        'native SOUND getid must not collapse decoded aliases in one executing record',
      );
      assert.deepEqual(h.world.fesSources.read(firstNameAddress, 2), Uint8Array.of(0x81, 0));
      assert.deepEqual(h.world.fesSources.read(secondNameAddress, 2), Uint8Array.of(0x82, 0));
      assert.equal(await namePointer(h.world, first, 0), firstNameAddress);
      // Common commands use those same raw owners, not their lossy presentation keys.
      c.create('SOUND', '?', 1);
      const commonRoute = async (world, nameBytes, index) => {
        const payload = memory(ascii('COMMON'), nameBytes, index);
        await world.sendEngine(current.id, world.main.id, 337, 64, 0, { payload });
        assert.equal(world.runtime.variableBank(world.main, false).get(52), index);
        assert.equal(payload.stringReads, 0);
      };
      const commonDelays = (collection) => [
        collection.lookup(first, 0).motionDelay,
        collection.lookup(first, 1).motionDelay,
        collection.lookup(second, 0).motionDelay,
        collection.lookup('?', 0).motionDelay,
      ];
      await commonRoute(h.world, first, 1);
      await commonRoute(h.world, second, 0);
      assert.deepEqual(commonDelays(c), [0, 11, 10, 0]);
      await h.world.sendEngine(current.id, h.world.main.id, 337, 0, 0, {
        payload: memory(ascii('COMMON_GROUP')),
      });
      assert.deepEqual(commonDelays(c), [21, 21, 10, 0]);

      phase = 'jump';
      assert.equal(await root.player.notify('JUMP'), true);
      phase = 'loaded';
      assert.deepEqual(targetCalls, ['$str1', '$str0']);
      assert.deepEqual(scriptCalls, ['LABEL_CALL', 'LABEL_GO']);
      assert.equal(root.label, fesByteView(first));
      assert.deepEqual(root.suspended, [[fesByteView(first), 2]]);
      assert.equal(words.get(57), 1);
      assert.equal(words.get(58), 1);
      assert.equal(words.get(59), 1);
      assert.equal(words.get(60), 0);
      defineCheckpointPixels(h.world);
      const checkpoint = await h.player.snapshot();
      phase = 'restore';
      words.set(59, 90);
      strings.setBytes(0, ascii('changed'));
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('No original label restore');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const next = fresh.world.objects.objects.get(current.id).implementation.player.root,
        nextWords = fresh.world.runtime.variableBank(fresh.world.main, false),
        nextStrings = fresh.world.runtime.stringBank(fresh.world.main);
      assert.equal(next.label, fesByteView(first));
      assert.deepEqual(next.suspended, [[fesByteView(first), 2]]);
      assert.notEqual(
        next.program.blocks[fesByteView(first)],
        root.program.blocks[fesByteView(first)],
      );
      assert.notEqual(next.collection.lookup('left', 1), left);
      assert.equal(next.collection.lookup('left', 1).defaultHandler, fesByteView(first));
      assert.equal(nextWords.get(59), 1);
      assert.equal(words.get(59), 90);
      assert.deepEqual(nextStrings.getBytes(0), ascii('LABEL_GO'));
      assert.equal(reads, 1);
      assert.equal(initializes, 1);
      assert.deepEqual(targetCalls, ['$str1', '$str0']);
      assert.deepEqual(scriptCalls, ['LABEL_CALL', 'LABEL_GO']);
      const sourceExtent = fresh.world.fesSources.used;
      assert.equal(await namePointer(fresh.world, first, 1), firstNameAddress);
      assert.equal(await namePointer(fresh.world, second, 0), secondNameAddress);
      assert.equal(await namePointer(fresh.world, first, 0), firstNameAddress);
      assert.equal(fresh.world.fesSources.used, sourceExtent);
      assert.deepEqual(fresh.world.fesSources.read(firstNameAddress, 2), Uint8Array.of(0x81, 0));
      assert.deepEqual(fresh.world.fesSources.read(secondNameAddress, 2), Uint8Array.of(0x82, 0));
      assert.deepEqual(commonDelays(next.collection), [21, 21, 10, 0]);
      await commonRoute(fresh.world, first, 1);
      await commonRoute(fresh.world, second, 0);
      assert.deepEqual(commonDelays(next.collection), [21, 11, 10, 0]);

      await fresh.world.sendEngine(current.id, fresh.world.main.id, 333);
      assert.equal(nextWords.get(59), 1);
      assert.equal(nextWords.get(60), 1);
      assert.equal(next.label, 'IDLE');
      const jumpMemory = memory(second);
      assert.equal(
        await fresh.world.sendEngine(current.id, fresh.world.main.id, 335, 0, 0, {
          payload: jumpMemory,
        }),
        1,
      );
      assert.equal(next.label, fesByteView(second));
      await fresh.world.sendEngine(current.id, fresh.world.main.id, 333);
      assert.equal(nextWords.get(57), 2);
      const notifyMemory = memory(second);
      await fresh.world.sendEngine(current.id, fresh.world.main.id, 337, 0, 0, {
        payload: notifyMemory,
      });
      assert.equal(nextWords.get(57), 3);
      const named = memory(ascii('FOCUS'), ascii('left'), 1);
      await fresh.world.sendEngine(current.id, fresh.world.main.id, 337, 64, 0, { payload: named });
      assert.equal(nextWords.get(55), 12342);
      assert.equal(nextWords.get(56), 1);
      assert.deepEqual(eventInputs.at(-1), {
        labels: ['left.FOCUS'],
        owner: { nameBytes: ascii('left'), index: 1 },
        index: 1,
      });
      const negativeIndex = memory(ascii('FOCUS'), ascii('left'), -1);
      await fresh.world.sendEngine(current.id, fresh.world.main.id, 337, 64, 0, {
        payload: negativeIndex,
      });
      assert.deepEqual(negativeIndexInputs, [{ labels: ['left.FOCUS'], object: null, index: -1 }]);
      assert.equal(nextWords.get(55), 123422);
      assert.equal(nextWords.get(56), 0xffffffff);
      const canonicalJump = memory(a);
      assert.equal(
        await fresh.world.sendEngine(current.id, fresh.world.main.id, 335, 0, 0, {
          payload: canonicalJump,
        }),
        1,
      );
      await fresh.world.sendEngine(current.id, fresh.world.main.id, 333);
      assert.equal(nextWords.get(61), 11);
      const canonicalNotify = memory(i);
      await fresh.world.sendEngine(current.id, fresh.world.main.id, 337, 0, 0, {
        payload: canonicalNotify,
      });
      assert.equal(nextWords.get(61), 111);
      for (const payload of [
        jumpMemory,
        notifyMemory,
        named,
        negativeIndex,
        canonicalJump,
        canonicalNotify,
      ])
        assert.equal(payload.stringReads, 0);
      assert.equal(await next.player.notify('LITERAL'), true);
      assert.equal(nextWords.get(62), 1);
      assert.equal(nextWords.get(63), 1);
      assert.equal(next.label, 'literal\\n');
      assert.equal(reads, 1);
      assert.equal(initializes, 1);
      assert.deepEqual([...next.player.unsupportedCommands], []);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}

test('bare labels keep explicit CP932 String and raw/UTF8 source boundaries', () => {
  const cpSource = join(ascii('#START\nnext '), a, ascii('\n#'), a, ascii('\n$0+=1\nbreak\n')),
    cp = new FESInstance('cp-label', parseProgram(cpSource), new FESPlayer(null, null));
  assert.ok(cp.program.blocks[fesByteView(a)]);
  cp.run([['START', 0]]);
  assert.equal(cp.global(0), 1);
  assert.equal(cp.invoke('あ'), true);
  assert.equal(cp.invoke(a), true);
  assert.equal(cp.global(0), 3);
  const utfSource = '#START\nnext 猫\n#猫\n$1+=1\nbreak\n',
    utf = new FESInstance('utf-label', parseProgram(utfSource), new FESPlayer(null, null));
  assert.ok(utf.program.blocks[fesByteView(ascii('猫'))]);
  utf.run([['START', 0]]);
  assert.equal(utf.global(1), 1);
  assert.equal(utf.invoke('猫'), false);
  assert.equal(utf.invoke(ascii('猫')), true);
  assert.equal(utf.global(1), 2);
  assert.deepEqual(encodeCP932('あ'), a);
});
