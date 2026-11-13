// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { CatSystem2 } from '../src/engine.mjs';
import { BlobFile, GameFiles } from '../src/files.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { fesByteView } from '../src/fes/tokens.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  filename = 'assets.int/working-row.fes';

async function environment(profile, source) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/working-row.fes': ascii(source) },
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
          throw new Error('Working rows must not open the original');
        },
      },
    });
    await player.initialize();
    const world = player.world,
      parent = world.main;
    assert.equal(world.frame, 1);
    assert.equal(world.runtime.variableBank(parent, false).get(7), 0x12345678);
    world.runtime.stringBank(parent);
    const id = await world.objects.create({ kind: 34, parent: parent.id }),
      surface = await world.objects.create({ kind: 15, parent: parent.id });
    await world.sendEngine(surface, parent.id, 279, 64, 48);
    await world.sendEngine(surface, parent.id, 283);
    await world.sendEngine(id, parent.id, 331, 0, parent.context.variableBank);
    await world.sendEngine(id, parent.id, 334, 0, world.nativeTaskID(surface));
    const task = world.objects.objects.get(id).implementation;
    assert.equal(world.objects.objects.get(id).context.stringBank, parent.context.stringBank);
    return {
      player,
      world,
      game,
      id,
      task,
      strings: world.runtime.stringBank(parent),
      words: world.runtime.variableBank(parent, false),
      async load() {
        await world.sendEngine(id, parent.id, 332, 0, 0, {
          payload: { string: () => filename },
        });
        assert.ok(task.player.root.runtime instanceof FESCoordinator);
        return task.player.root;
      },
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

async function freshCheckpoint(t, h, profile) {
  const gpu = h.world.stageRenderer.gpu,
    { width, height } = gpu.primaryTarget;
  // Supply the fixture's known CPU frame for the existing checkpoint contract.
  gpu.uploadRenderTarget(gpu.primaryTarget, {
    width,
    height,
    rgba: new Uint8Array(width * height * 4).fill(0x62),
  });
  const source = h.world.fesSources.snapshot(),
    checkpoint = await h.player.snapshot();
  let restoring = true;
  for (const [prototype, method] of [
    [FESInstance.prototype, 'execute'],
    [FESInstance.prototype, 'expandMacros'],
    [FESCoordinator.prototype, 'initialize'],
    [NativeStringBank.prototype, 'expandBytes'],
    [NativeScriptReplacements.prototype, 'apply'],
  ]) {
    const original = prototype[method];
    t.mock.method(prototype, method, function (...args) {
      assert.equal(restoring, false, 'fresh restoration must not replay ' + method);
      return original.apply(this, args);
    });
  }
  const file = h.game.lookup(filename).file,
    read = file.read;
  t.mock.method(file, 'read', function (...args) {
    assert.equal(restoring, false, 'fresh restoration must not reopen the FES');
    return read.apply(this, args);
  });
  const player = new CatSystem2({
    game: h.game,
    nativeProfile: profile,
    canvas: new StartupCanvas(),
    audioContext: { currentTime: 0, close: async () => {} },
    transitionalExe: {
      open() {
        throw new Error('No original working-row restore');
      },
    },
  });
  try {
    await player.initialize({ checkpoint });
  } catch (error) {
    await player.dispose();
    throw error;
  } finally {
    restoring = false;
  }
  assert.deepEqual(player.world.fesSources.snapshot(), source);
  assert.equal(player.world.nativeEngine, undefined);
  return player;
}

function observe(t, root, trace, commands) {
  const host = root.player.host,
    bank = host.nativeFESStringBytes,
    macros = root.expandMacros,
    argument = host.nativeFESArgumentBytes,
    command = root.runtime.command;
  t.mock.method(host, 'nativeFESStringBytes', function (bytes, ...args) {
    const value = bank.call(this, bytes, ...args);
    if (fesByteView(bytes) === '$str1')
      trace.push(['row-bank', fesByteView(bytes), fesByteView(value)]);
    return value;
  });
  t.mock.method(root, 'expandMacros', function (bytes) {
    const value = macros.call(this, bytes);
    if (fesByteView(bytes).startsWith('probe getid '))
      trace.push(['macro', fesByteView(bytes), fesByteView(value)]);
    return value;
  });
  t.mock.method(host, 'nativeFESArgumentBytes', function (bytes, ...args) {
    if (['$str21', '$str22'].includes(fesByteView(bytes)))
      trace.push(['operand', fesByteView(bytes)]);
    return argument.call(this, bytes, ...args);
  });
  t.mock.method(root.runtime, 'command', function (verb, selection, args, source) {
    if (verb === 'getid') {
      trace.push(['command', fesByteView(source.commandBytes)]);
      commands.push({ ...source, commandBytes: source.commandBytes.slice() });
    }
    return command.call(this, verb, selection, args, source);
  });
}

for (const profile of startupProfiles) {
  test(`normal working row banks before one macro and owns actual source copies through fresh restore: ${profile}`, async (t) => {
    const h = await environment(
      profile,
      '#MACRO\nLATE $str21\nOTHER $str22\n#DEFINE\nSOUND probe\n#START\n$str1\nwait 1\nnext START\n',
    );
    let fresh;
    try {
      h.strings.setBytes(21, ascii('$str21'));
      h.strings.setBytes(22, ascii('$str22'));
      const root = await h.load(),
        trace = [],
        commands = [],
        rules = h.world.configuration.scriptReplacements,
        apply = rules.apply;
      assert.deepEqual(root.macros.get('LATE'), ascii('$str21'));
      assert.deepEqual(root.macros.get('OTHER'), ascii('$str22'));
      h.strings.setBytes(1, ascii('probe getid LATE'));
      h.strings.setBytes(21, ascii('DEST'));
      h.strings.setBytes(22, ascii('++$11'));
      rules.add(ascii('DEST'), ascii('++$10'));
      h.words.set(10, 30);
      h.words.set(11, 40);
      t.mock.method(rules, 'apply', function (bytes, ...args) {
        if (fesByteView(bytes) === 'DEST') trace.push(['SCRIPT', 'DEST']);
        return apply.call(this, bytes, ...args);
      });
      observe(t, root, trace, commands);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(trace, [
        ['row-bank', '$str1', 'probe getid LATE'],
        ['macro', 'probe getid LATE', 'probe getid $str21'],
        ['command', 'probe getid $str21'],
        ['operand', '$str21'],
        ['SCRIPT', 'DEST'],
      ]);
      assert.equal(h.words.get(10), 31);
      assert.equal(h.words.get(31), commands[0].objectNameAddress);
      assert.equal(h.world.fesSources.string(commands[0].objectNameAddress), 'probe');
      assert.equal(h.world.fesSources.string(commands[0].commandPointer), 'probe getid $str21');
      assert.deepEqual(root.program.blocks.START[0], ascii('$str1'));
      const record = h.world.fesSources.programs.get(root.program.sourceKey).blocks.START[0];
      assert.deepEqual([...record.copies.keys()], ['$str1', 'probe getid $str21']);
      assert.deepEqual(root.suspended, [['START', 2]]);
      const oldPointer = commands[0].commandPointer;
      fresh = await freshCheckpoint(t, h, profile);
      const next = fresh.world.objects.objects.get(h.id).implementation.player.root,
        nextStrings = fresh.world.runtime.stringBank(fresh.world.main),
        nextWords = fresh.world.runtime.variableBank(fresh.world.main, false),
        nextTrace = [],
        nextCommands = [];
      assert.notEqual(next.program.blocks.START[0], root.program.blocks.START[0]);
      assert.deepEqual(next.suspended, [['START', 2]]);
      assert.equal(nextWords.get(10), 31);
      nextStrings.setBytes(1, ascii('probe getid OTHER'));
      const nextRules = fresh.world.configuration.scriptReplacements,
        nextApply = nextRules.apply;
      t.mock.method(nextRules, 'apply', function (bytes, ...args) {
        if (fesByteView(bytes) === '++$11') nextTrace.push(['SCRIPT', '++$11']);
        return nextApply.call(this, bytes, ...args);
      });
      observe(t, next, nextTrace, nextCommands);
      await fresh.world.sendEngine(h.id, fresh.world.main.id, 333);
      assert.deepEqual(nextTrace, [
        ['row-bank', '$str1', 'probe getid OTHER'],
        ['macro', 'probe getid OTHER', 'probe getid $str22'],
        ['command', 'probe getid $str22'],
        ['operand', '$str22'],
        ['SCRIPT', '++$11'],
      ]);
      assert.equal(nextWords.get(11), 41);
      assert.equal(nextWords.get(41), nextCommands[0].objectNameAddress);
      assert.notEqual(nextCommands[0].commandPointer, oldPointer);
      assert.equal(fresh.world.fesSources.string(oldPointer), 'probe getid $str21');
      assert.equal(
        fresh.world.fesSources.string(nextCommands[0].commandPointer),
        'probe getid $str22',
      );
      assert.deepEqual(
        [
          ...fresh.world.fesSources.programs
            .get(next.program.sourceKey)
            .blocks.START[0].copies.keys(),
        ],
        ['$str1', 'probe getid $str21', 'probe getid $str22'],
      );
      assert.deepEqual(root.program.blocks.START[0], ascii('$str1'));
      assert.equal(h.words.get(11), 40);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });

  test(`empty normal working head advances a frame and stops each event loop including null notify and flush resume: ${profile}`, async (t) => {
    const h = await environment(
      profile,
      '#DEFINE\nBUTTON button\n#OBJECT SIZE POS DEFAULT\nbutton 4,4 1,1 defaults\n#START\n$str30\n$40=++$40\nwait 1\nnext IDLE\n#IDLE\n#defaults.FOCUS\n$41=++$41\n$str30\n$42=99\n#button.FOCUS\n$43=++$43\n$str30\n$44=99\n#NULL\n$45=++$45\n$str30\n$46=99\n#FLUSH\nbutton getid 50\n$str30\n$47=99\n',
    );
    let fresh;
    try {
      const root = await h.load(),
        host = root.player.host,
        bank = host.nativeFESStringBytes,
        rows = [];
      for (let index = 40; index < 48; index++) h.words.set(index, 0);
      h.strings.setBytes(30, new Uint8Array());
      h.words.set(50, 99);
      t.mock.method(host, 'nativeFESStringBytes', function (bytes, ...args) {
        const value = bank.call(this, bytes, ...args);
        if (fesByteView(bytes) === '$str30') rows.push([fesByteView(bytes), value.slice()]);
        return value;
      });
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.equal(h.words.get(40), 0);
      assert.deepEqual(root.suspended, [['START', 1]]);
      assert.equal(root.commandDelayUntil, root.player.frameCount + 1);
      assert.deepEqual(root.program.blocks.START[0], ascii('$str30'));
      const saved = structuredClone(root.suspended),
        delay = root.commandDelayUntil,
        frame = root.player.frameCount,
        button = root.collection.lookup('button', 0);
      root.player.focus({ s: root, o: button });
      assert.equal(await root.player.nativeEvent(root.collection.reference(button), 'FOCUS'), true);
      assert.deepEqual(
        [41, 42, 43, 44].map((index) => h.words.get(index)),
        [2, 0, 2, 0],
      );
      await h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
        payload: fesLabelPayload(() => 'NULL'),
      });
      assert.equal(root.eventObject, null);
      assert.equal(h.words.get(45), 1);
      assert.equal(h.words.get(46), 0);
      await h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
        payload: fesLabelPayload(() => 'FLUSH'),
      });
      assert.equal(h.words.get(47), 0);
      assert.equal(button.idIndex, 0);
      assert.equal(h.words.get(50), 0);
      assert.deepEqual(root.runtime.pendingRecords, []);
      assert.equal(root.decodePending, false);
      assert.equal(root.commandDelayUntil, delay);
      assert.equal(root.player.frameCount, frame);
      assert.deepEqual(root.suspended, saved);
      assert.deepEqual(
        rows,
        Array.from({ length: 7 }, () => ['$str30', new Uint8Array()]),
      );
      fresh = await freshCheckpoint(t, h, profile);
      const next = fresh.world.objects.objects.get(h.id).implementation.player.root,
        words = fresh.world.runtime.variableBank(fresh.world.main, false);
      assert.deepEqual(next.suspended, [['START', 1]]);
      assert.equal(next.commandDelayUntil, delay);
      await fresh.world.sendEngine(h.id, fresh.world.main.id, 333);
      assert.equal(words.get(40), 1);
      assert.deepEqual(next.suspended, [['START', 3]]);
      assert.equal(next.commandDelayUntil, null);
      await fresh.world.sendEngine(h.id, fresh.world.main.id, 333);
      assert.equal(next.label, 'IDLE');
      assert.deepEqual(
        [40, 41, 42, 43, 44, 45, 46, 47].map((index) => words.get(index)),
        [1, 2, 0, 2, 0, 1, 0, 0],
      );
      assert.equal(h.words.get(40), 0);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
