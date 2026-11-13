// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { fesByteView } from '../src/fes/tokens.mjs';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  fesNotificationMemory,
} from './fixtures/default-fes-world.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  source = ascii(`#DEFINE
CPLANE owner
CPLANE calljs[2]
CPLANE solo
#START
wait 2
$39=77
break
#owner.REDIRECT
@ getid 10
break
#owner.OWN
@ getid 14
break
#DYNAMIC
calljs[++$20-1] getid 11
solo[-1] getid 12
break
#REMOVE
calljs delete
break
#MISS
calljs ++$24
break
#MISSINDEX
unknown[++$20] getid ++$24
break
#lost.MISSINGCTX
@ getid ++$24
break
`);

const tuple = ({ nameBytes, index, current }) => ({ nameBytes: nameBytes.slice(), index, current });
async function notify(world, id, label, name = null, index = 0, packet) {
  packet ??= fesNotificationMemory(ascii(label), name === null ? null : ascii(name), index);
  await world.sendEngine(id, world.main.id, 337, name === null ? 0 : 64, 0, { payload: packet });
  assert.equal(packet.stringReads, 0);
}

function observe(t, world, root) {
  const state = { phase: '', packet: null },
    calls = [],
    getters = [],
    indices = [],
    probes = [],
    execute = root.execute,
    host = root.player.host,
    argument = host.nativeFESArgumentBytes,
    operand = root.operandValue,
    lookup = root.collection.lookup,
    command = root.runtime.command;
  let executing = false,
    commanding = 0,
    carrier;
  t.mock.method(root, 'execute', function (...args) {
    executing = true;
    try {
      return execute.apply(this, args);
    } finally {
      executing = false;
    }
  });
  t.mock.method(host, 'nativeFESArgumentBytes', function (token, instance) {
    const bytes = argument.call(this, token, instance);
    if (instance === root && executing && !commanding) {
      getters.push({
        phase: state.phase,
        token: fesByteView(token),
        context: tuple(root.nativeContext),
      });
      if (state.phase === 'redirect' && fesByteView(token) === '@') carrier = bytes;
      if (state.phase === 'missing-context' && state.packet) state.packet.bytes(64, 1)[0] = 0x78;
    }
    return bytes;
  });
  t.mock.method(root, 'operandValue', function (bytes) {
    if (executing && !commanding) indices.push({ phase: state.phase, bytes: fesByteView(bytes) });
    return operand.call(this, bytes);
  });
  t.mock.method(root.collection, 'lookup', function (name, index) {
    if (executing && !commanding)
      probes.push({ phase: state.phase, nameBytes: name.slice(), index });
    return lookup.call(this, name, index);
  });
  t.mock.method(root.runtime, 'command', async function (verb, selection, args, context) {
    commanding++;
    try {
      const entry = root.nativeContext,
        call = {
          phase: state.phase,
          verb,
          nameBytes: selection.nameBytes.slice(),
          index: selection.index,
          commandBytes: context.commandBytes.slice(),
          commandPointer: context.commandPointer,
          objectNameAddress: context.objectNameAddress,
          context: tuple(entry),
        };
      // The service result may be reused after selection; it cannot own the selected tuple.
      if (state.phase === 'redirect' && carrier) carrier[0] = 0x78;
      assert.deepEqual(selection.nameBytes, call.nameBytes);
      call.result = await command.call(this, verb, selection, args, context);
      assert.strictEqual(root.nativeContext, entry);
      calls.push(call);
      return call.result;
    } finally {
      commanding--;
    }
  });
  return { state, calls, getters, indices, probes };
}

for (const profile of profiles) {
  test(`normal command heads preserve raw tuple selection and pending common gates: ${profile}`, async (t) => {
    const world = await defaultFESWorld(profile, { 'screen.fes': source });
    let fresh,
      restoring = false,
      sourceReads = 0;
    try {
      const read = world.game.read;
      t.mock.method(world.game, 'read', function (file, ...args) {
        if (file === 'screen.fes') sourceReads++;
        return read.call(this, file, ...args);
      });
      const { id, instance: root } = await loadDefaultFES(world),
        words = world.runtime.variableBank(world.main, false),
        rules = world.configuration.scriptReplacements,
        observed = observe(t, world, root);
      await world.sendEngine(id, world.main.id, 333);
      const suspended = structuredClone(root.suspended),
        waitFrames = root.waitFrames,
        frame = root.player.frameCount;
      assert.deepEqual(suspended, [['START', 1]]);
      assert.equal(waitFrames, 2);
      rules.add(ascii('@'), ascii('calljs[1]'));
      observed.state.phase = 'redirect';
      await notify(world, id, 'REDIRECT', 'owner');
      const first = observed.calls[0];
      // Baseline bypasses the actual getter for @ and incorrectly selects owner.
      assert.deepEqual(first.nameBytes, ascii('calljs'));
      assert.equal(first.index, 1);
      assert.equal(first.result, 0);
      assert.deepEqual(first.context, { nameBytes: ascii('owner'), index: 0, current: 0 });
      assert.deepEqual(first.commandBytes, ascii('@ getid 10'));
      assert.equal(words.get(10), first.objectNameAddress);
      assert.equal(world.fesSources.string(first.objectNameAddress), 'calljs');
      assert.equal(world.fesSources.string(first.commandPointer), '@ getid 10');
      assert.deepEqual(root.program.blocks['owner.REDIRECT'][0], ascii('@ getid 10'));
      assert.equal(observed.getters.filter(({ token }) => token === '@').length, 1);
      assert.deepEqual(observed.indices, [{ phase: 'redirect', bytes: '1' }]);
      rules.entries.clear();
      observed.state.phase = 'dynamic';
      await notify(world, id, 'DYNAMIC');
      assert.equal(words.get(20), 1);
      assert.deepEqual(
        observed.calls.slice(1).map(({ nameBytes, index }) => [nameBytes, index]),
        [
          [ascii('calljs'), 0],
          [ascii('solo'), 0],
        ],
      );
      assert.deepEqual(
        observed.indices.filter(({ phase }) => phase === 'dynamic'),
        [
          { phase: 'dynamic', bytes: '++$20-1' },
          { phase: 'dynamic', bytes: '-1' },
        ],
      );
      assert.deepEqual(root.suspended, suspended);
      assert.equal(root.waitFrames, waitFrames);
      assert.equal(root.player.frameCount, frame);
      assert.equal(root.player.pending.size, 0);
      assert.equal(sourceReads, 1);

      // Only the existing quiescent wait is snapshotted, with no pending continuation.
      const checkpoint = structuredClone(world.snapshot()),
        arena = world.fesSources.snapshot(),
        identities = [...world.objects.objects.values()].map(({ id, kind, parent, creator }) => ({
          id,
          kind,
          parent,
          creator,
        }));
      for (const [prototype, method] of [
        [FESInstance.prototype, 'execute'],
        [FESInstance.prototype, 'expandMacros'],
        [FESCoordinator.prototype, 'initialize'],
      ]) {
        const original = prototype[method];
        t.mock.method(prototype, method, function (...args) {
          assert.equal(restoring, false, 'fresh command head must not replay ' + method);
          return original.apply(this, args);
        });
      }
      fresh = await defaultFESWorld(profile, { 'screen.fes': source }, { initialize: false });
      const freshRead = fresh.game.read;
      t.mock.method(fresh.game, 'read', function (file, ...args) {
        assert.notEqual(file, 'screen.fes', 'fresh command head must not reopen source');
        return freshRead.call(this, file, ...args);
      });
      restoring = true;
      await fresh.restore(checkpoint);
      restoring = false;
      const next = fresh.objects.objects.get(id).implementation.player.root,
        nextWords = fresh.runtime.variableBank(fresh.main, false),
        following = observe(t, fresh, next);
      assert.deepEqual(next.suspended, suspended);
      assert.equal(next.waitFrames, waitFrames);
      assert.equal(nextWords.get(20), 1);
      assert.deepEqual(fresh.fesSources.snapshot(), arena);
      assert.deepEqual(
        [...fresh.objects.objects.values()].map(({ id, kind, parent, creator }) => ({
          id,
          kind,
          parent,
          creator,
        })),
        identities,
      );
      following.state.phase = 'owned';
      await notify(fresh, id, 'OWN', 'owner');
      assert.deepEqual(following.calls[0].nameBytes, ascii('owner'));
      assert.equal(following.calls[0].index, 0);
      assert.equal(nextWords.get(14), following.calls[0].objectNameAddress);
      assert.deepEqual(following.indices, [{ phase: 'owned', bytes: '0' }]);
      following.state.phase = 'dynamic-fresh';
      await notify(fresh, id, 'DYNAMIC');
      assert.equal(nextWords.get(20), 2);
      assert.equal(following.calls[1].index, 1);
      assert.equal(following.calls[2].index, 0);
      following.state.phase = 'remove';
      await notify(fresh, id, 'REMOVE');
      assert.equal(next.collection.lookup(ascii('calljs'), 0), null);
      assert.equal(next.collection.lookup(ascii('calljs'), 1), null);
      const calls = following.calls.length;
      following.state.phase = 'common-miss';
      await assert.rejects(
        notify(fresh, id, 'MISS'),
        profile.startsWith('sdk-')
          ? /FES native common handler is pending: calljs/
          : /FES whole-row evaluator is pending: calljs/,
      );
      assert.deepEqual(
        following.getters.filter(({ phase }) => phase === 'common-miss').map(({ token }) => token),
        ['calljs', 'calljs'],
      );
      assert.equal(following.calls.length, calls);
      assert.equal(nextWords.get(24), 0);
      following.state.phase = 'index-miss';
      await assert.rejects(
        notify(fresh, id, 'MISSINDEX'),
        /FES whole-row evaluator is pending: unknown/,
      );
      assert.equal(nextWords.get(20), 3);
      assert.deepEqual(
        following.indices.filter(({ phase }) => phase === 'index-miss'),
        [{ phase: 'index-miss', bytes: '++$20' }],
      );
      assert.equal(nextWords.get(24), 0);
      following.state.phase = 'missing-context';
      const packet = fesNotificationMemory(ascii('MISSINGCTX'), ascii('lost'), -1);
      following.state.packet = packet;
      await assert.rejects(
        notify(fresh, id, 'MISSINGCTX', 'lost', -1, packet),
        /FES whole-row evaluator is pending: @/,
      );
      assert.equal(packet.bytes(64, 1)[0], 0x78);
      assert.deepEqual(
        following.probes.filter(({ phase }) => phase === 'missing-context'),
        [{ phase: 'missing-context', nameBytes: ascii('lost'), index: 0 }],
      );
      for (const { context } of following.getters.filter(
        ({ phase }) => phase === 'missing-context',
      ))
        assert.deepEqual(context, { nameBytes: ascii('lost'), index: -1, current: -1 });
      assert.equal(nextWords.get(24), 0);
      assert.equal(following.calls.length, calls);
      assert.deepEqual(next.runtime.pendingRecords, []);
      assert.deepEqual(next.suspended, suspended);
      assert.equal(next.waitFrames, waitFrames);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      restoring = false;
      await fresh?.close();
      await world.close();
    }
  });
}
