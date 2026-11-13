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
  filename = 'assets.int/object-verb.fes';

async function environment(profile, source) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: { 'assets/object-verb.fes': ascii(source) },
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
          throw new Error('Object verbs must not open the original');
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
        throw new Error('No original object-verb restore');
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

function observeVerb(t, root, slot, scriptInput) {
  const trace = [],
    calls = [],
    host = root.player.host,
    argument = host.nativeFESArgumentBytes,
    rules = root.runtime.world.configuration.scriptReplacements,
    apply = rules.apply,
    command = root.runtime.command;
  t.mock.method(host, 'nativeFESArgumentBytes', function (bytes, ...args) {
    if (fesByteView(bytes) === slot) trace.push(['getter', slot]);
    return argument.call(this, bytes, ...args);
  });
  // argumentBytes owns the actual inherited bank; wrap that service, not its output.
  const strings = root.runtime.world.runtime.stringBank(root.runtime.world.main),
    expand = strings.expandBytes;
  t.mock.method(strings, 'expandBytes', function (bytes, ...args) {
    const value = expand.call(this, bytes, ...args);
    if (fesByteView(bytes) === slot) trace.push(['bank', slot, fesByteView(value)]);
    return value;
  });
  t.mock.method(rules, 'apply', function (bytes, ...args) {
    if (fesByteView(bytes) === scriptInput) trace.push(['SCRIPT', scriptInput]);
    return apply.call(this, bytes, ...args);
  });
  t.mock.method(root.runtime, 'command', async function (verb, selection, args, context) {
    const call = {
      verb,
      nameBytes: selection.nameBytes.slice(),
      index: selection.index,
      commandPointer: context.commandPointer,
      objectNameAddress: context.objectNameAddress,
      commandBytes: context.commandBytes.slice(),
    };
    calls.push(call);
    call.result = await command.call(this, verb, selection, args, context);
    return call.result;
  });
  return { trace, calls };
}

async function notify(h, label) {
  return h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, {
    payload: fesLabelPayload(() => label),
  });
}

for (const profile of startupProfiles) {
  test(`normal object verb banks and SCRIPT once with exact source tuple and fresh continuation: ${profile}`, async (t) => {
    const h = await environment(
      profile,
      '#MACRO\nLATE_VERB $str21\nOTHER_VERB $str22\n#DEFINE\nSOUND probe\n#START\nprobe LATE_VERB ++$11\nwait 1\nnext AGAIN\n#AGAIN\nprobe OTHER_VERB ++$11\nwait 1\nnext IDLE\n#IDLE\n',
    );
    let fresh;
    try {
      h.strings.setBytes(21, ascii('$str21'));
      h.strings.setBytes(22, ascii('$str22'));
      const root = await h.load();
      assert.deepEqual(root.macros.get('LATE_VERB'), ascii('$str21'));
      assert.deepEqual(root.macros.get('OTHER_VERB'), ascii('$str22'));
      h.strings.setBytes(21, ascii('LOOKUP'));
      h.world.configuration.scriptReplacements.add(ascii('LOOKUP'), ascii('getid'));
      h.words.set(11, 30);
      const first = observeVerb(t, root, '$str21', 'LOOKUP');
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      assert.deepEqual(first.trace, [
        ['getter', '$str21'],
        ['bank', '$str21', 'LOOKUP'],
        ['SCRIPT', 'LOOKUP'],
      ]);
      assert.equal(first.calls.length, 1);
      assert.equal(first.calls[0].verb, 'getid');
      assert.equal(first.calls[0].result, 0);
      assert.deepEqual(first.calls[0].nameBytes, ascii('probe'));
      assert.equal(first.calls[0].index, 0);
      assert.deepEqual(first.calls[0].commandBytes, ascii('probe $str21 ++$11'));
      assert.equal(h.words.get(11), 31);
      assert.equal(h.words.get(31), first.calls[0].objectNameAddress);
      assert.equal(h.world.fesSources.string(first.calls[0].objectNameAddress), 'probe');
      assert.equal(h.world.fesSources.string(first.calls[0].commandPointer), 'probe $str21 ++$11');
      assert.deepEqual(root.program.blocks.START[0], ascii('probe LATE_VERB ++$11'));
      assert.deepEqual(root.suspended, [['START', 2]]);
      const oldPointer = first.calls[0].commandPointer;
      fresh = await freshCheckpoint(t, h, profile);
      const next = fresh.world.objects.objects.get(h.id).implementation.player.root,
        words = fresh.world.runtime.variableBank(fresh.world.main, false),
        strings = fresh.world.runtime.stringBank(fresh.world.main);
      assert.equal(words.get(11), 31);
      strings.setBytes(22, ascii('getid'));
      // Use the actual current rule set after restore; do not assume a dynamic rule persisted.
      const second = observeVerb(t, next, '$str22', 'getid');
      await fresh.world.sendEngine(h.id, fresh.world.main.id, 333);
      assert.deepEqual(second.trace, [
        ['getter', '$str22'],
        ['bank', '$str22', 'getid'],
        ['SCRIPT', 'getid'],
      ]);
      assert.equal(second.calls.length, 1);
      assert.equal(second.calls[0].result, 0);
      assert.deepEqual(second.calls[0].nameBytes, ascii('probe'));
      assert.equal(second.calls[0].index, 0);
      assert.equal(words.get(11), 32);
      assert.equal(words.get(32), second.calls[0].objectNameAddress);
      assert.equal(
        fresh.world.fesSources.string(second.calls[0].commandPointer),
        'probe $str22 ++$11',
      );
      assert.notEqual(second.calls[0].commandPointer, oldPointer);
      assert.equal(fresh.world.fesSources.string(oldPointer), 'probe $str21 ++$11');
      assert.deepEqual(next.suspended, [['AGAIN', 2]]);
      assert.equal(h.words.get(11), 31);
      assert.equal(h.world.nativeEngine, undefined);
      assert.equal(fresh.world.nativeEngine, undefined);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });

  test(`normal object missing empty and unknown verbs return through one event while builtin gaps stay explicit: ${profile}`, async (t) => {
    const h = await environment(
      profile,
      '#MACRO\nEMPTY_VERB $str23\n#DEFINE\nCPLANE probe\n#START\nwait 1\nnext IDLE\n#IDLE\n#VERBS\nprobe\n$40=++$40\nprobe EMPTY_VERB\n$41=++$41\nprobe unknown_v1\n$42=++$42\nbreak\n#BUILTIN\nprobe m2att\n$43=99\nbreak\n',
    );
    try {
      h.strings.setBytes(23, ascii('$str23'));
      const root = await h.load();
      assert.deepEqual(root.macros.get('EMPTY_VERB'), ascii('$str23'));
      h.strings.setBytes(23, new Uint8Array());
      for (let at = 40; at <= 43; at++) h.words.set(at, 0);
      await h.world.sendEngine(h.id, h.world.main.id, 333);
      const saved = structuredClone(root.suspended),
        delay = root.commandDelayUntil,
        frame = root.player.frameCount,
        host = root.player.host,
        getter = host.nativeFESArgumentBytes,
        getters = [],
        command = root.runtime.command,
        calls = [];
      t.mock.method(host, 'nativeFESArgumentBytes', function (bytes, ...args) {
        getters.push(fesByteView(bytes));
        return getter.call(this, bytes, ...args);
      });
      t.mock.method(root.runtime, 'command', async function (verb, selection, args, context) {
        const call = { verb, bytes: context.commandBytes.slice(), result: null };
        calls.push(call);
        call.result = await command.call(this, verb, selection, args, context);
        return call.result;
      });
      await notify(h, 'VERBS');
      assert.deepEqual(getters, ['probe', 'probe', '$str23', 'probe', 'unknown_v1']);
      assert.deepEqual(calls, [
        { verb: '', bytes: ascii('probe $str23'), result: 0 },
        { verb: 'unknown_v1', bytes: ascii('probe unknown_v1'), result: 0 },
      ]);
      assert.deepEqual(
        [40, 41, 42, 43].map((at) => h.words.get(at)),
        [1, 1, 1, 0],
      );
      assert.deepEqual(
        [...root.player.unsupportedCommands],
        [
          `${root.name}#VERBS:3: Unimplemented FES object command `,
          `${root.name}#VERBS:5: Unimplemented FES object command unknown_v1`,
        ],
      );
      assert.deepEqual(root.suspended, saved);
      assert.equal(root.commandDelayUntil, delay);
      assert.equal(root.player.frameCount, frame);
      assert.equal(root.decodePending, false);
      assert.equal(root.collection.lookup('probe', 0).nativeType, 3);
      await assert.rejects(notify(h, 'BUILTIN'), /Unimplemented FES raw3 command m2att/);
      assert.equal(h.words.get(43), 0);
      assert.deepEqual(
        [...root.player.unsupportedCommands],
        [
          `${root.name}#VERBS:3: Unimplemented FES object command `,
          `${root.name}#VERBS:5: Unimplemented FES object command unknown_v1`,
        ],
      );
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.close();
    }
  });
}
