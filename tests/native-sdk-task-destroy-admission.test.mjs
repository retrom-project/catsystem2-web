// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
// Real MSG return words are consumed by POP. Idle produces 0, a delivered
// notification produces 1, and the program arms the same owned packet again.
const recipient = kcsProgram([
  [37, 256],
  [43, 71, 4],
  [38, [0x13, 512]],
  [41, 0],
]);
const callerProgram = kcsProgram([
  [37, [0x13, 128]],
  [43, 67, 4],
  [37, [0x13, 128]],
  [43, 67, 4],
  [43, 65, 0], // The ordinary yield lets the next World frame consume pending close.
  [37, [0x13, 128]],
  [43, 67, 4], // The same real ID is now missing; zero is never used as a miss.
  [37, 73],
  [38, [0x13, 512]],
  [59],
]);

function declaration(profile) {
  const entry = nativeABI(profile).tables.main.entries[67];
  assert.equal(entry.status, 'recovered');
  assert.equal(entry.name, 'task.destroy');
  assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[67].signature);
  assert.equal(entry.signature.argumentWords, 1);
  assert.deepEqual(entry.controlCodes, [2]);
  assert.equal(entry.signature.result.kind, 'void');
  assert.equal(entry.signature.resultWritten, false);
  if (profile === profiles[0]) {
    assert.match(entry.evidence, /SDK-2\.6\.1\.74-main67-full-wrapper/);
    assert.notEqual(entry.evidence, nativeABI(profiles[1]).tables.main.entries[67].evidence);
  }
  for (const id of [70, 361, 467])
    assert.equal(nativeABI(profiles[0]).tables.main.entries[id].status, 'unknown');
}

for (const profile of profiles) {
  test(`${profile} main67 GCALL retains deferred Script destruction and a missing-ID void reply`, async () => {
    const world = await dataWorld(profile, {
      'recipient.kcs': recipient,
      'caller.kcs': callerProgram,
    });
    try {
      const parent = world.objects.objects.get(world.main.id),
        top = world.engineMessages.closestTop(parent.id),
        targetID = await world.objects.create({ kind: 12, parent: parent.id, name: 'target' }),
        ownedID = await world.objects.create({ kind: 12, parent: targetID, name: 'owned' }),
        target = world.objects.objects.get(targetID),
        owned = world.objects.objects.get(ownedID),
        targetNative = world.nativeTaskID(targetID);
      await target.implementation.loadScript('recipient.kcs');
      await owned.implementation.loadScript('recipient.kcs');
      await world.tick();
      const targetMachine = target.implementation.machine,
        ownedMachine = owned.implementation.machine;
      assert.equal(targetMachine.waiting.kind, 'message');
      assert.equal(ownedMachine.waiting.kind, 'message');
      assert.equal(targetMachine.load(512), 0);
      assert.equal(ownedMachine.load(512), 0);

      const callerID = await world.objects.create({ kind: 12, parent: parent.id, name: 'caller' }),
        callerRecord = world.objects.objects.get(callerID);
      await callerRecord.implementation.loadScript('caller.kcs');
      const caller = callerRecord.implementation.task,
        machine = caller.machine,
        initialSP = machine.sp,
        calls = [],
        notifications = [],
        raw = [],
        order = [],
        native = world.runtime.native,
        send = world.runtime.scheduler.send;
      assert.strictEqual(world.runtime.scheduler.tasks.get(callerID), caller);
      assert.strictEqual(callerRecord.context, caller.context);
      machine.store(128, targetNative);
      machine.bytes(800, 8).fill(0xa5);
      world.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table !== 'main' || id !== 67) return reply;
        return Promise.resolve(reply).then((result) => {
          calls.push({ args: [...args[0]], reply: result });
          return result;
        });
      };
      world.runtime.scheduler.send = function (id, words) {
        if (words[1] === 0xffff0006) {
          const record = world.objects.objects.get(id);
          notifications.push({
            id,
            words: [...words],
            pending: !!record.destroyRequested,
            parentTargetNull: parent.nativeTaskRoutes.get(targetNative) === null,
            topTargetNull: top.nativeTaskRoutes.get(targetNative) === null,
          });
        }
        return send.call(this, id, words);
      };
      for (const [name, record] of [
        ['target', target],
        ['owned', owned],
      ]) {
        const message = record.implementation.message,
          tick = record.implementation.tick,
          close = record.implementation.close;
        record.implementation.message = function (words, context) {
          if (words[1] === 3) raw.push({ id: record.id, words: [...words] });
          return message.call(this, words, context);
        };
        record.implementation.tick = function (...args) {
          order.push(name + ' tick');
          return tick.apply(this, args);
        };
        record.implementation.close = function (...args) {
          order.push(name + ' close');
          return close.apply(this, args);
        };
      }

      await world.runtime.scheduler.execute(caller);
      // These checks follow actual GCALL dispatch, so an unknown SDK entry is
      // a functional red rather than a registration-literal-only failure.
      declaration(profile);
      assert.deepEqual(
        calls,
        Array.from({ length: 2 }, () => ({ args: [targetNative], reply: { control: 2 } })),
      );
      assert.equal(machine.sp, initialSP, 'Both GCALL arguments were popped without a result push');
      assert.equal(machine.halted, false);
      assert.strictEqual(world.objects.objects.get(targetID), target);
      assert.equal(target.state, 'active');
      assert.equal(target.destroyRequested, true);
      assert.equal(!!owned.destroyRequested, false);
      assert.equal(
        targetMachine.load(512),
        1,
        'The real preclose notification executed its Script continuation',
      );
      assert.deepEqual(
        Array.from({ length: 4 }, (_, i) => targetMachine.load(256 + i * 4)),
        [0xffffffff, 0xffff0006, 0, 0],
      );
      assert.equal(
        notifications.length,
        1,
        'The repeated request does not send another notification',
      );
      assert.equal(notifications[0].pending, false, 'Notification precedes the Base pending flag');
      assert.deepEqual(raw, [{ id: targetID, words: [world.nativeTaskID(callerID), 3, 0, 0] }]);
      assert.equal(parent.nativeTaskRoutes.get(targetNative), targetID);
      assert.deepEqual(order, []);

      await world.tick();
      assert.deepEqual(order, ['owned tick', 'target close', 'owned close']);
      assert.equal(world.objects.objects.has(targetID), false);
      assert.equal(world.objects.objects.has(ownedID), false);
      assert.equal(world.runtime.scheduler.tasks.has(targetID), false);
      assert.equal(world.runtime.scheduler.tasks.has(ownedID), false);
      assert.equal(parent.nativeTaskRoutes.has(targetNative), false);
      assert.equal(top.nativeTaskRoutes.has(targetNative), false);
      assert.equal(world.engineMessages.resolve(parent.id, targetNative), null);
      assert.equal(
        ownedMachine.load(512),
        1,
        'The owned child received its real teardown notification',
      );
      assert.deepEqual(
        notifications.map(({ id, words, pending }) => ({ id, words, pending })),
        [
          { id: targetID, words: [0xffffffff, 0xffff0006, 0, 0], pending: false },
          { id: ownedID, words: [0xffffffff, 0xffff0006, 0, 0], pending: false },
        ],
      );
      assert.equal(notifications[1].parentTargetNull, true);
      assert.equal(notifications[1].topTargetNull, true);
      assert.deepEqual(raw[1], { id: ownedID, words: [targetNative, 3, 0, 0] });
      assert.equal(raw.length, 2);
      assert.deepEqual(
        calls,
        Array.from({ length: 3 }, () => ({ args: [targetNative], reply: { control: 2 } })),
      );
      assert.equal(caller.status, 'finished');
      assert.equal(
        machine.load(512),
        73,
        'The released-ID GCALL returned and the real caller continued',
      );
      assert.equal(machine.sp, initialSP, 'The missing-ID GCALL also has no result push');
      assert.deepEqual(machine.bytes(800, 8), new Uint8Array(8).fill(0xa5));
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });
}
