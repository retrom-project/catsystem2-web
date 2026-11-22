// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';

const source = new TextEncoder().encode('#START\nexit 7\n');

function observe(world) {
  const sends = [],
    send = world.sendNativeEngine;
  world.sendNativeEngine = function (...args) {
    sends.push(args.slice(0, 5));
    return send.apply(this, args);
  };
  return sends;
}

function declaration(profile, id) {
  const entry = nativeABI(profile).tables.main.entries[id];
  assert.equal(entry.status, 'recovered');
  assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[id].signature);
  assert.equal(entry.signature.argumentWords, 1);
  assert.equal(entry.signature.review, 'declared');
  if (id === 452) {
    assert.deepEqual(entry.controlCodes, [1]);
    assert.deepEqual(entry.signature.result, {
      bits: 32,
      description: 'i32',
      kind: 'integer',
      signed: true,
    });
    assert.equal(entry.signature.resultWritten, true);
    assert.deepEqual(entry.signature.parameters[0].type, {
      handleKind: 'unknown',
      kind: 'handle',
      ownership: 'unknown',
    });
  } else {
    assert.deepEqual(entry.controlCodes, [2]);
    assert.equal(entry.signature.result.kind, 'void');
    assert.equal(entry.signature.resultWritten, false);
    assert.deepEqual(entry.signature.parameters[0].type, {
      addressSpace: 'unknown',
      direction: 'unknown',
      kind: 'pointer',
      target: { bits: 8, encoding: 'unknown', kind: 'character' },
    });
  }
  if (profile === profiles[0]) {
    assert.match(entry.evidence, new RegExp('SDK-2\\.6\\.1\\.74-main' + id + '-full-wrapper'));
    assert.notEqual(entry.evidence, nativeABI(profiles[1]).tables.main.entries[id].evidence);
  }
  for (const unknown of [467, 361])
    assert.equal(nativeABI(profiles[0]).tables.main.entries[unknown].status, 'unknown');
}

test('main452 queries real FES and Script exit-code words through both explicit profiles', async () => {
  for (const profile of profiles) {
    const world = await defaultFESWorld(profile, { 'screen.fes': source });
    try {
      const h = await loadDefaultFES(world),
        owner = world.main,
        machine = owner.machine,
        fes = world.objects.objects.get(h.id),
        caller = world.objects.objects.get(owner.id),
        sends = observe(world);
      assert.equal(fes.kind, 34);
      assert.equal(caller.kind, 12);
      assert.strictEqual(world.runtime.scheduler.tasks.get(caller.id), owner);
      const query = async (id, expected) => {
        const target = world.nativeTaskID(id),
          args = [target],
          before = machine.snapshot(),
          sendIndex = sends.length;
        const reply = await world.runtime.native(
          'main',
          452,
          args,
          machine,
          owner,
          world.runtime.scheduler,
        );
        assert.deepEqual(reply, { control: 1, value: expected >>> 0 });
        assert.deepEqual(sends.slice(sendIndex), [[target, owner.id, 23, 0, 0]]);
        assert.deepEqual(args, [target]);
        assert.deepEqual(
          machine.snapshot(),
          before,
          'The direct reply is not a caller-memory write',
        );
      };
      assert.equal(fes.exitCode, -1);
      await query(h.id, -1);
      declaration(profile, 452);
      await world.runtime.native(
        'main',
        448,
        [world.nativeTaskID(h.id)],
        machine,
        owner,
        world.runtime.scheduler,
      );
      assert.equal(h.task.player.root.finished, 7);
      assert.equal(fes.exitCode, 7, 'The ordinary FES exit command produced its finished code');
      await query(h.id, 7);
      for (const word of [0, -7, 0x80000000]) {
        assert.deepEqual(
          await world.runtime.native('main', 453, [word], machine, owner, world.runtime.scheduler),
          { control: 2 },
        );
        assert.equal(caller.exitCode, word | 0);
        await query(owner.id, word);
      }
      assert.equal(fes.exitCode, 7, 'Caller setters leave the different FES record alone');
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  }
});

test('main454 copies a loaded Script caller context CString into its owned guest block', async () => {
  for (const profile of [...profiles, 'rebellions-jp-engine-2.6.1.63']) {
    const world = await defaultFESWorld(profile, { 'child.kcs': kcsProgram([[59]]) });
    try {
      const parent = world.main,
        parentMachine = parent.machine,
        name = 'owned-script-context≒',
        nameBytes = Uint8Array.from([
          ...new TextEncoder().encode('owned-script-context'),
          0x87,
          0x90,
        ]),
        input = parentMachine.allocate(nameBytes.length + 1);
      parentMachine.writeStringBytes(nameBytes, input);
      await world.sendEngine(parent.id, parent.id, 26, 0, input, { machine: parentMachine });
      const id = await world.objects.create({ kind: 12, parent: parent.id, name: 'loaded child' }),
        record = world.objects.objects.get(id);
      await record.implementation.loadScript('child.kcs');
      const owner = record.implementation.task,
        machine = owner.machine;
      assert.strictEqual(record.context, owner.context);
      assert.strictEqual(world.runtime.scheduler.tasks.get(id), owner);
      assert.equal(record.kind, 12);
      assert.equal(
        record.context.contextName,
        name,
        'Normal load inherited the parent message25 CString',
      );
      assert.deepEqual(record.context.contextNameBytes, nameBytes);
      // A subsequent real parent message cannot substitute the child's caller context.
      parentMachine.writeString('later', input);
      await world.sendEngine(parent.id, parent.id, 26, 0, input, { machine: parentMachine });
      const block = machine.allocate(nameBytes.length + 9),
        destination = block + 4,
        args = [destination];
      machine.bytes(block, nameBytes.length + 9).fill(0xa5);
      const expected = machine.snapshot(),
        sends = observe(world);
      expected.blocks.at(-1).set([...nameBytes, 0], 4);
      const reply = await world.runtime.native(
        'main',
        454,
        args,
        machine,
        owner,
        world.runtime.scheduler,
      );
      assert.deepEqual(
        reply,
        { control: 2 },
        'Guest output is distinct from a universal VM result',
      );
      assert.deepEqual(
        machine.bytes(block, nameBytes.length + 9),
        Uint8Array.from([0xa5, 0xa5, 0xa5, 0xa5, ...nameBytes, 0, 0xa5, 0xa5, 0xa5, 0xa5]),
      );
      assert.deepEqual(
        machine.snapshot(),
        expected,
        'Only the owned destination and its NUL changed',
      );
      assert.deepEqual(args, [destination]);
      assert.deepEqual(sends, [], 'The caller-context copy sends no engine message');
      assert.equal(parent.context.contextName, 'later');
      assert.equal(record.context.contextName, name);
      declaration(profile, 454);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  }
});

test('63 FES named words use the original formatted CP932 bytes across restoration', async (t) => {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    files = { 'screen.fes': new TextEncoder().encode('#START\nnext HOLD\n#HOLD\n') },
    world = await defaultFESWorld(profile, files);
  let fresh;
  t.after(async () => {
    try {
      await fresh?.close();
    } finally {
      await world.close();
    }
  });
  const loaded = await loadDefaultFES(world),
    native = (current, id, args) =>
      current.runtime.native('main', id, args, current.main.machine, current.main),
    target = world.nativeTaskID(loaded.id),
    m = world.main.machine;
  m.writeStringBytes(Uint8Array.of(0x87, 0x90), 128);
  m.writeStringBytes(Uint8Array.of(0x81, 0xe0), 144);
  for (const [address, value] of [
    [128, 0xfedcba98],
    [144, 23],
    [128, 0x84211345],
  ])
    assert.deepEqual(await native(world, 882, [target, address, value]), { control: 2 });
  assert.deepEqual(await native(world, 883, [target, 128]), { control: 1, value: 0x84211345 });
  assert.deepEqual(await native(world, 883, [target, 144]), { control: 1, value: 23 });
  assert.deepEqual(await native(world, 883, [target, 0]), { control: 1, value: 0 });
  fresh = await defaultFESWorld(profile, files, { initialize: false });
  await fresh.restore(structuredClone(world.snapshot()));
  assert.deepEqual(await native(fresh, 883, [target, 128]), { control: 1, value: 0x84211345 });
  assert.deepEqual(await native(fresh, 883, [target, 144]), { control: 1, value: 23 });
});
