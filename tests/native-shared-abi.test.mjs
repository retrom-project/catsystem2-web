// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import sdkRegistration from '../src/native/abi/2.6.1.74.mjs';
import gameRegistration from '../src/native/abi/2.6.1.76.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { abiForEngineVersion, nativeABI } from '../src/native/abi/index.mjs';
import { nativeCatalog } from '../src/native/catalog.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { NativeRuntime, UnsupportedKCSNative } from '../src/native/runtime.mjs';
import { kcsProgram } from './helpers.mjs';

const sdk = nativeABI(sdkRegistration.profile),
  game = nativeABI(gameRegistration.profile);

test('shared semantics do not name or enable explicitly unknown profile slots', () => {
  assert.equal(NATIVE_SEMANTICS.main[0x43].name, 'task.destroy');
  assert.equal(sdk.tables.main.entries[0x43].name, null);
  assert.equal(sdk.tables.main.entries[0x43].status, 'unknown');
  assert.equal(game.tables.main.entries[0x43].name, 'task.destroy');
  assert.equal(Object.hasOwn(NATIVE_SEMANTICS.main, 0x52), false);
  assert.deepEqual(sdk.tables.main.entries[0x52].controlCodes, []);
  assert.deepEqual(game.tables.main.entries[0x52].controlCodes, [2]);
  assert.throws(() => nativeABI('unregistered'), /Unregistered/);
  for (const version of ['2.6.1.23', '2.6.1.37', '2.6.1.58', '2.6.1.63', '2.6.1.67', '2.6.1.75'])
    assert.throws(() => abiForEngineVersion(version), /Unregistered/);
});

test('SDK JavaScript and game E-mote remain separate explicit bindings and stubs', () => {
  assert.equal(sdk.tables.main.entries[0x3ce].name, 'javascript.linkScript');
  assert.equal(game.tables.main.entries[0x3ce].name, 'reserved.noop');
  assert.equal(game.tables.main.entries[0x3ce].status, 'reserved');
  assert.equal(sdk.tables.main.entries[0x38a].name, 'reserved.noop');
  assert.equal(game.tables.main.entries[0x38a].name, 'emote.message524');
  assert.equal(sdk.tables.main.entries[0x38d].status, 'constant-zero');
  assert.equal(game.tables.main.entries[0x38d].name, 'emote.message528');
  for (const abi of [sdk, game]) {
    assert.equal(abi.tables.main.entries[0x181].signature.argumentWords, 5);
    assert.equal(abi.tables.main.entries[0x358].signature.argumentWords, 7);
  }
  assert.equal(sdk.tables.main.count, 1009);
  assert.equal(game.tables.main.count, 1055);
  assert.equal(sdk.tables.main.entries[1054], undefined);
  assert.equal(game.tables.main.entries[1054].name, 'window.postMessage468');
});

test('profile signature knowledge, encodings and independent observations remain exact', () => {
  assert.equal(sdk.tables.main.entries[6].signature.resultWritten, true);
  assert.equal(game.tables.main.entries[6].signature.resultWritten, null);
  assert.equal(sdk.tables.main.entries[0x251].parameters[1].type.target.encoding, 'CP932');
  assert.equal(game.tables.main.entries[0x251].parameters[1].type.target.encoding, 'UTF-8');
  assert.equal(sdk.tables.main.entries[0x38a].signature.argumentWords, null);
  assert.deepEqual(sdk.tables.main.entries[0x38a].observedArgumentWords, [3]);
  assert.equal(game.tables.main.entries[0x38a].signature.argumentWords, 3);
  assert.equal(sdk.tables.main.entries[1].signature.review, 'needs-review');
  assert.ok(sdk.tables.main.entries[1].signature.reviewReason);
});

for (const registration of [sdkRegistration, gameRegistration]) {
  test(`${registration.profile} ordinary World preserves resolved runtime dispatch and diagnostics`, async () => {
    const world = await dataWorld(registration.profile, { 'case.kcs': kcsProgram([[59]]) });
    try {
      const task = world.main,
        machine = task.machine,
        runtime = world.runtime,
        invoke = (id, args = []) =>
          runtime.native('main', id, args, machine, task, runtime.scheduler);
      assert.deepEqual(invoke(6, [0xdeadbeef]), { control: 1, value: 0xdeadbeef });
      assert.deepEqual(invoke(0xab), { control: 1, value: 0 });
      const noop = registration === sdkRegistration ? 0x38a : 0x3ce;
      assert.deepEqual(invoke(noop), { control: 2 });
      assert.throws(
        () => invoke(0x52),
        (error) =>
          error.name === 'UnsupportedKCSNative' &&
          error.details.id === 0x52 &&
          error.details.profile === registration.profile &&
          error.details.task === task.id,
      );
      assert.throws(() => invoke(registration.tables.main.count), /outside/);
      const catalog = nativeCatalog(registration.profile);
      assert.equal(catalog[0x52].name, null);
      assert.equal(catalog[noop].status, 'reserved');
      assert.equal(catalog[0x181].argumentWords, 5);
    } finally {
      await world.close();
    }
  });
}

test('SDK main447 explicitly binds its existing two-word unwritten FES contract', async () => {
  const entry = sdk.tables.main.entries[447],
    gameEntry = game.tables.main.entries[447],
    runtime = new NativeRuntime({
      profile: sdk.profile,
      read: async () => kcsProgram([[59]]),
    }),
    task = await runtime.spawn('control.kcs');
  runtime.register('main', 447, () => ({ control: 1, value: 0 }));
  let rejectedWrongControl = false;
  try {
    runtime.native('main', 447, [0, 0], task.machine, task, runtime.scheduler);
  } catch (error) {
    assert.match(error.message, /control 1 disagrees with the fixed ABI \(2\)/);
    rejectedWrongControl = true;
  }
  assert.deepEqual(
    { status: entry.status, name: entry.name, rejectedWrongControl },
    { status: 'recovered', name: 'fes.start', rejectedWrongControl: true },
  );
  assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[447].signature);
  assert.deepEqual(entry.signature, gameEntry.signature);
  assert.equal(entry.signature.argumentWords, 2);
  assert.deepEqual(entry.signature.controlCodes, [2]);
  assert.equal(entry.signature.result.kind, 'void');
  assert.equal(entry.signature.resultWritten, false);
  assert.equal(entry.signature.review, 'declared');
  assert.deepEqual(entry.observedArgumentWords, [2]);
  assert.match(entry.evidence, /SDK-2\.6\.1\.74-main447-full-wrapper/);
  assert.notEqual(entry.evidence, gameEntry.evidence);
  for (const id of [448, 449]) {
    assert.equal(sdk.tables.main.entries[id].status, 'unknown');
    assert.equal(sdk.tables.main.entries[id].name, null);
  }
});

for (const [id, message] of [
  [262, 286],
  [534, 304],
]) {
  test(`ordinary World main${id} sends recovered draw flag ${message} in both profiles`, async () => {
    for (const registration of [sdkRegistration, gameRegistration]) {
      const world = await dataWorld(registration.profile, { 'case.kcs': kcsProgram([[59]]) });
      try {
        const task = world.main,
          runtime = world.runtime;
        assert.equal(task.status, 'finished');
        const target = await world.objects.create({ kind: 15, parent: task.id }),
          receiver = world.objects.objects.get(target).implementation,
          nativeTarget = world.nativeTaskID(target),
          initial = { pending: receiver.state.pending, enabled: receiver.state.enabled },
          sends = [];
        const send = world.sendNativeEngine;
        world.sendNativeEngine = function (...args) {
          sends.push(args.slice(0, 5));
          return send.apply(this, args);
        };
        assert.equal(receiver.state.dirty, true);
        for (const flag of [0, 0x80000000]) {
          if (id === 262 && flag) {
            assert.equal(await world.sendEngine(target, task.id, 304, 0, 0), 0);
            assert.equal(receiver.state.dirty, false);
          }
          const reply = await runtime.native(
            'main',
            id,
            [nativeTarget, flag],
            task.machine,
            task,
            runtime.scheduler,
          );
          assert.deepEqual(reply, { control: 2 });
          assert.deepEqual(sends.at(-1), [nativeTarget, task.id, message, 0, flag]);
          if (id === 262) {
            assert.equal(receiver.state.pending, Boolean(flag));
            assert.equal(receiver.state.enabled, Boolean(flag));
            assert.equal(receiver.state.dirty, true);
          } else {
            assert.equal(receiver.state.dirty, Boolean(flag));
            assert.deepEqual(
              { pending: receiver.state.pending, enabled: receiver.state.enabled },
              initial,
            );
          }
        }
        assert.deepEqual(
          sends,
          [0, 0x80000000].map((flag) => [nativeTarget, task.id, message, 0, flag]),
        );
        const entry = nativeABI(registration.profile).tables.main.entries[id];
        assert.equal(entry.status, 'recovered');
        assert.equal(entry.name, id === 262 ? 'draw.setRasterEnabled' : 'draw.setDirty');
        assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[id].signature);
        assert.equal(entry.signature.argumentWords, 2);
        assert.deepEqual(entry.controlCodes, [2]);
        assert.equal(entry.signature.result.kind, 'void');
        assert.equal(entry.signature.resultWritten, false);
        assert.deepEqual(entry.parameters[1].type, { bits: 32, kind: 'bits' });
        assert.equal(entry.parameters[1].name, id === 262 ? 'enabled' : 'dirty');
        if (registration === sdkRegistration) {
          assert.match(entry.evidence, new RegExp(`SDK-2\\.6\\.1\\.74-main${id}-full-wrapper`));
          assert.notEqual(entry.evidence, game.tables.main.entries[id].evidence);
        }
      } finally {
        await world.close({ flushFiles: false });
      }
    }
  });
}

for (const registration of [sdkRegistration, gameRegistration]) {
  test(`${registration.profile} ordinary World main71 waits for four words and resumes on message or idle`, async () => {
    for (const delivery of ['message', 'idle']) {
      const world = await dataWorld(registration.profile, {}, { initialize: false });
      try {
        await world.initialize('case.kcs');
        const task = world.main,
          machine = task.machine,
          scheduler = world.runtime.scheduler,
          owner = world.objects.objects.get(task.id),
          waitingSP = machine.sp,
          buffer = () => [240, 244, 248, 252].map((address) => machine.load(address)),
          initialBuffer = buffer(),
          neighbours = [machine.load(236), machine.load(256)];
        assert.equal(world.frame, 1);
        assert.equal(task.status, 'waiting');
        assert.deepEqual(machine.waiting, { kind: 'message', address: 240, native: 71 });
        assert.equal(machine.halted, false);
        assert.equal(owner.kind, 12);
        assert.equal(owner.scriptEnabled, 1);
        assert.equal(world.runtime.calls.get('main:71'), 1);
        const entry = nativeABI(registration.profile).tables.main.entries[71];
        assert.equal(entry.status, 'recovered');
        assert.equal(entry.name, 'task.waitMessage');
        assert.equal(entry.signature.argumentWords, 1);
        assert.deepEqual(entry.controlCodes, [4]);
        assert.equal(entry.signature.resultWritten, null);
        assert.equal(entry.parameters[0].type.addressSpace, 'unknown');
        assert.equal(entry.parameters[0].type.direction, 'unknown');
        if (delivery === 'message') {
          const words = [world.nativeTaskID(world.root), 0x1357, 0x2468, 0x1020304];
          assert.deepEqual(await scheduler.send(task.id, words), {
            accepted: true,
            result: 0,
            message: words,
          });
          assert.equal(world.frame, 1);
          assert.deepEqual(buffer(), words);
          assert.equal(machine.sp, waitingSP + 4);
          assert.equal(machine.load(machine.sp - 4), 1);
          assert.equal(task.status, 'finished');
          assert.equal(machine.waiting, null);
          assert.equal(machine.halted, true);
          assert.deepEqual(await scheduler.send(task.id, words), { accepted: false, result: 0 });
          assert.equal(machine.sp, waitingSP + 4);
          assert.deepEqual(buffer(), words);
          await world.tick();
        } else {
          await world.tick();
          assert.deepEqual(buffer(), initialBuffer);
          assert.equal(machine.sp, waitingSP + 4);
          assert.equal(machine.load(machine.sp - 4), 0);
        }
        assert.equal(world.frame, 2);
        assert.equal(task.status, 'finished');
        assert.equal(machine.halted, true);
        assert.equal(machine.waiting, null);
        assert.equal(owner.scriptEnabled, 0);
        assert.equal(world.objects.objects.get(task.id), owner);
        assert.equal(scheduler.tasks.get(task.id), task);
        assert.deepEqual([machine.load(236), machine.load(256)], neighbours);
        assert.equal(world.runtime.calls.get('main:71'), 1);
      } finally {
        await world.close({ flushFiles: false });
      }
    }
  });
}

test('SDK unknown main264 blocks its installed drawing handler without side effects', async () => {
  const world = await dataWorld(sdkRegistration.profile, { 'case.kcs': kcsProgram([[59]]) });
  try {
    const task = world.main,
      runtime = world.runtime,
      target = await world.objects.create({ kind: 15, parent: task.id }),
      nativeTarget = world.nativeTaskID(target),
      args = [nativeTarget],
      sends = [];
    const send = world.sendNativeEngine;
    world.sendNativeEngine = function (...args) {
      sends.push(args.slice(0, 5));
      return send.apply(this, args);
    };
    const capture = () => ({
      world: world.snapshot(),
      calls: [...runtime.calls],
      imageBuffers: runtime.imageDataBuffers.snapshot(),
    });
    const before = capture();
    assert.throws(
      () => runtime.native('main', 264, args, task.machine, task, runtime.scheduler),
      (error) => {
        assert.ok(error instanceof UnsupportedKCSNative);
        assert.equal(
          error.message,
          `Unsupported ${sdkRegistration.profile}/main native 0x108 in ${task.name} at 0x${task.machine.pc.toString(16)}`,
        );
        assert.deepEqual(error.details, {
          profile: sdkRegistration.profile,
          table: 'main',
          id: 264,
          task: task.id,
          script: task.name,
          pc: task.machine.pc,
          args,
          source: task.machine.debug,
        });
        return true;
      },
    );
    assert.equal(runtime.handlers.has('main:264'), true);
    assert.equal(runtime.tables.get('main')[264].status, 'unknown');
    assert.equal(runtime.tables.get('main')[264].name, null);
    assert.equal(runtime.tables.get('main')[264].argumentWords, null);
    assert.deepEqual(runtime.tables.get('main')[264].controlCodes, []);
    assert.deepEqual(sends, []);
    assert.deepEqual(capture(), before);
  } finally {
    await world.close({ flushFiles: false });
  }
});
