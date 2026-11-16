// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';

const source = new TextEncoder().encode(
  '#START\nbreak\nnext START\n#GO0073\n$20=73\nnext IDLE\n#IDLE\nbreak\nnext IDLE\n',
);
const callerProgram = kcsProgram([
  [37, [0x13, 128]],
  [37, [0x13, 132]],
  [43, 450, 8],
  [37, [0x13, 128]],
  [37, [0x13, 136]],
  [43, 450, 8],
  [59],
]);

function ownedCString(machine, text) {
  const bytes = new TextEncoder().encode(text),
    buffer = machine.allocate(bytes.length + 9),
    address = buffer + 4;
  machine.bytes(buffer, bytes.length + 9).fill(0xa5);
  machine.writeString(text, address);
  const expected = Uint8Array.from([0xa5, 0xa5, 0xa5, 0xa5, ...bytes, 0, 0xa5, 0xa5, 0xa5, 0xa5]);
  assert.deepEqual(machine.bytes(buffer, expected.length), expected);
  return { address, buffer, expected };
}

function declaration(profile) {
  const entry = nativeABI(profile).tables.main.entries[450];
  assert.equal(entry.status, 'recovered');
  assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[450].signature);
  assert.equal(entry.signature.argumentWords, 2);
  assert.deepEqual(entry.controlCodes, [1]);
  assert.equal(entry.signature.result.kind, 'boolean');
  assert.equal(entry.signature.review, 'declared');
  assert.deepEqual(entry.signature.parameters[0].type, {
    handleKind: 'unknown',
    kind: 'handle',
    ownership: 'unknown',
  });
  assert.deepEqual(entry.signature.parameters[1].type, {
    addressSpace: 'unknown',
    direction: 'unknown',
    kind: 'pointer',
    target: { encoding: 'unknown', kind: 'format-string' },
  });
  if (profile === profiles[0]) {
    // The SDK functional red occurs before these shared-data assertions.
    for (const registered of profiles)
      assert.equal(nativeABI(registered).tables.main.entries[450].signature.resultWritten, true);
    assert.match(entry.evidence, /SDK-2\.6\.1\.74-main450-full-wrapper/);
    assert.notEqual(entry.evidence, nativeABI(profiles[1]).tables.main.entries[450].evidence);
  }
  assert.equal(nativeABI(profiles[0]).tables.main.entries[361].status, 'unknown');
}

for (const [profileIndex, profile] of profiles.entries()) {
  test(`${profile} main450 formats a real FES jump and applies its GCALL boolean`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': source,
      'caller.kcs': callerProgram,
    });
    try {
      const h = await loadDefaultFES(world),
        callerID = await world.objects.create({
          kind: 12,
          parent: world.main.id,
          name: 'jump caller',
        }),
        record = world.objects.objects.get(callerID);
      await record.implementation.loadScript('caller.kcs');
      const caller = record.implementation.task,
        machine = caller.machine,
        target = world.nativeTaskID(h.id),
        good = ownedCString(machine, 'GO%04d[G512]'),
        missing = ownedCString(machine, 'MISSING%d[G512]'),
        unsupported = ownedCString(machine, '%q[G512]'),
        strings = [good, missing, unsupported],
        packets = [],
        send = world.sendNativeEngine;
      assert.equal(world.objects.objects.get(h.id).kind, 34);
      assert.ok(h.instance.runtime instanceof FESCoordinator);
      assert.strictEqual(world.runtime.scheduler.tasks.get(callerID), caller);
      assert.strictEqual(record.context, caller.context);
      machine.store(128, target);
      machine.store(132, good.address);
      machine.store(136, missing.address);
      machine.store(512, 73);
      world.sendNativeEngine = function (...args) {
        const [to, sender, message, w, l, context] = args;
        if (message === 335)
          packets.push({
            to,
            sender,
            message,
            w,
            l,
            // Read the real temporary packet, then delegate to the actual receiver.
            bytes: context.payload.bytes(0, l + 256).slice(),
          });
        return send.apply(this, args);
      };
      const before = machine.snapshot(),
        initialSP = machine.sp;
      const direct = await world.runtime.native(
        'main',
        450,
        [target, good.address],
        machine,
        caller,
        world.runtime.scheduler,
      );
      assert.deepEqual(direct, { control: 1, value: 1 });
      assert.deepEqual(machine.snapshot(), before, 'A direct reply has not applied a VM result');
      assert.equal(h.instance.label, 'GO0073');
      assert.equal(h.instance.global(20), 0, 'Jump selects the block without executing its body');
      await assert.rejects(
        async () =>
          world.runtime.native(
            'main',
            450,
            [target, unsupported.address],
            machine,
            caller,
            world.runtime.scheduler,
          ),
        /Unsupported native format conversion/,
      );
      assert.equal(packets.length, 1, 'Unsupported formats do not send a jump packet');
      assert.deepEqual(machine.snapshot(), before);

      await world.runtime.scheduler.execute(caller);
      assert.equal(caller.status, 'finished');
      assert.equal(machine.halted, true);
      assert.equal(machine.sp, initialSP + 8);
      assert.equal(
        machine.load(initialSP),
        1,
        'The real GCALL applied the successful universal result',
      );
      assert.equal(
        machine.load(initialSP + 4),
        0,
        'The next GCALL applied the missing-label result',
      );
      assert.deepEqual(machine.memory.slice(0, initialSP), before.memory.slice(0, initialSP));
      assert.deepEqual(
        machine.snapshot().blocks,
        before.blocks,
        'Only VM stack results were written',
      );
      assert.equal(h.instance.label, 'GO0073', 'A missing label leaves the prior selection intact');
      assert.equal(packets.length, 3);
      for (const [index, label] of ['GO0073', 'GO0073', 'MISSING73'].entries()) {
        const packet = packets[index],
          text = new TextEncoder().encode(label);
        assert.deepEqual(
          [packet.to, packet.sender, packet.message, packet.w, packet.l],
          [target, callerID, 335, 0, 16],
        );
        assert.deepEqual(packet.bytes, Uint8Array.from([...new Uint8Array(16), ...text, 0]));
      }
      assert.equal(mapABIMessage(profile, 'control', 'raw', 335, 34), [330, 335][profileIndex]);
      declaration(profile);
      const frame = h.task.player.frameCount;
      await world.runtime.native('main', 448, [target], machine, caller, world.runtime.scheduler);
      assert.equal(h.task.player.frameCount, frame + 1);
      assert.equal(
        h.instance.global(20),
        73,
        'The selected normal FES block ran through its Coordinator',
      );
      assert.equal(h.instance.label, 'IDLE');
      for (const input of strings)
        assert.deepEqual(machine.bytes(input.buffer, input.expected.length), input.expected);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });
}
