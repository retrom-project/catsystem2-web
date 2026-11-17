// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { kcsProgram } from './helpers.mjs';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { EngineHost } from '../src/host.mjs';

const source = `#DEFINE
BUTTON btn
#OBJECT POS SIZE PRI ENABLE DISP
btn 20,20 40,30 300 1 1
#START
next WAIT
#WAIT
#btn.PUSH_L
send 0x780 0 0
#MES_ENTER
next WAIT_TOUCH
#WAIT_TOUCH
`;

// A real Script waits for the FES request, then replies to its sender through
// the existing native notification wrapper. The two identity domains differ.
const program = () =>
  kcsProgram(
    [
      [37, 240],
      [43, 0x47, 4],
      [37, [0x33, 240]],
      [37, 768],
      [37, 832],
      [37, 0],
      [43, 0x276, 16],
      [41, 0],
    ],
    [
      [768, 'MES_ENTER'],
      [832, ''],
    ],
  );

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} real FES input replies through the parent's native sender identity`, async () => {
    const world = await defaultFESWorld(profile, {
      'case.kcs': program(),
      'screen.fes': new TextEncoder().encode(source),
    });
    try {
      const retired = await world.objects.create({ kind: 6, parent: world.main.id });
      await world.objects.release(retired);
      const { id, task, instance, surface } = await loadDefaultFES(world);
      await task.tick();
      const record = world.objects.objects.get(id),
        parent = world.runtime.scheduler.tasks.get(record.parent),
        region = world.inputFor(id).get(instance.byKey.get('btn').nativeInputTaskID),
        delivered = [],
        dispatch = world.input.dispatch;
      assert.notEqual(id, record.nativeID);
      assert.notEqual(world.nativeTaskID(surface), record.nativeID);
      assert.equal(parent.machine.waiting?.kind, 'message');
      assert.equal(instance.label, 'WAIT');
      assert.equal(region.enabled, 1);
      world.input.dispatch = function (...args) {
        delivered.push(args.slice(0, 4));
        return dispatch.apply(this, args);
      };
      const [left, top, right, bottom] = region.bounds;
      world.input.pointer((left + right) / 2, (top + bottom) / 2);
      await world.input.hover();
      await world.input.route(0, true, 2);
      await world.input.route(0, false, 2);
      await world.input.click();
      assert.ok(delivered.some(([owner, message]) => owner === region.owner && message === 4));
      assert.equal(parent.machine.load(240), record.nativeID);
      assert.equal(parent.machine.load(244), 0x780);
      assert.equal(instance.label, 'WAIT_TOUCH');
      const saved = await world.snapshot(),
        fresh = await defaultFESWorld(
          profile,
          {
            'case.kcs': program(),
            'screen.fes': new TextEncoder().encode(source),
          },
          { initialize: false },
        );
      try {
        let replay = 0,
          restoring = true;
        for (const [owner, key] of [
          [fresh, 'tick'],
          [fresh.runtime, 'native'],
          [fresh.runtime.scheduler, 'execute'],
        ]) {
          const original = owner[key];
          owner[key] = function (...args) {
            if (restoring) {
              replay++;
              throw new Error('Cold restore replayed guest execution');
            }
            return original.apply(this, args);
          };
        }
        try {
          await fresh.restore(saved);
        } finally {
          restoring = false;
        }
        assert.equal(replay, 0);
        assert.deepEqual(await fresh.snapshot(), saved);
        assert.equal(fresh.nativeTaskID(id), record.nativeID);
        assert.notEqual(fresh.objects.objects.get(id), record);
        await world.close({ flushFiles: false });
        assert.deepEqual(await fresh.snapshot(), saved);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

  test(`${profile} FES sendscript keeps its real child recipient and native sender word`, async () => {
    const childSource = source
        .replace('next WAIT\n', 'execkcs child.kcs\nnext WAIT\n')
        .replace('send 0x780 0 0', 'sendscript 0x780 0x80000001 0xffffffff'),
      world = await defaultFESWorld(profile, {
        'case.kcs': kcsProgram([[37, 240], [43, 0x47, 4], [59]]),
        'child.kcs': program(),
        'screen.fes': new TextEncoder().encode(childSource),
      });
    try {
      const retired = await world.objects.create({ kind: 6, parent: world.main.id });
      await world.objects.release(retired);
      const { id, task, instance } = await loadDefaultFES(world);
      await task.tick();
      const child = world.runtime.scheduler.tasks.get(instance.kcsTaskID),
        record = world.objects.objects.get(id),
        region = world.inputFor(id).get(instance.byKey.get('btn').nativeInputTaskID);
      assert.ok(child);
      assert.notEqual(child.id, world.nativeTaskID(child.id));
      assert.equal(child.machine.waiting?.kind, 'message');
      const [left, top, right, bottom] = region.bounds;
      world.input.pointer((left + right) / 2, (top + bottom) / 2);
      await world.input.hover();
      await world.input.route(0, true, 2);
      assert.equal(child.machine.load(240), record.nativeID);
      assert.deepEqual(
        [child.machine.load(244), child.machine.load(248), child.machine.load(252)],
        [0x780, 0x80000001, 0xffffffff],
      );
      assert.equal(instance.label, 'WAIT_TOUCH');
    } finally {
      await world.close({ flushFiles: false });
    }
  });

  test(`${profile} a released FES host cannot borrow a reused task's native identity`, async () => {
    const world = await defaultFESWorld(profile, {
      'case.kcs': program(),
      'screen.fes': new TextEncoder().encode(source),
    });
    try {
      const { id, task, instance } = await loadDefaultFES(world),
        host = task.player.host;
      await task.tick();
      await world.objects.release(id);
      const replacement = await world.objects.create({ kind: 6, parent: world.main.id });
      assert.equal(replacement, id);
      const parent = world.runtime.scheduler.tasks.get(world.main.id),
        packet = parent.machine.bytes(240, 16).slice(),
        send = world.runtime.scheduler.send;
      let calls = 0;
      world.runtime.scheduler.send = function (...args) {
        calls++;
        return send.apply(this, args);
      };
      await assert.rejects(host.send([0x780, 7, 9], instance), /FES message source owner/);
      assert.equal(calls, 0);
      assert.deepEqual(parent.machine.bytes(240, 16), packet);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test('an earlier live FES hover owner keeps the parent request unissued', async () => {
  const blockedSource = source
      .replace('BUTTON btn\n', 'BUTTON btn\nBUTTON front\n')
      .replace('btn 20,20 40,30 300 1 1\n', 'btn 20,20 40,30 300 1 1\nfront 20,20 40,30 400 1 1\n')
      .replace('#MES_ENTER\n', '#front.PUSH_L\nnext WAIT\n#MES_ENTER\n'),
    world = await defaultFESWorld('nekopara-vol3-engine-2.6.1.76', {
      'case.kcs': program(),
      'screen.fes': new TextEncoder().encode(blockedSource),
    });
  try {
    const { task, instance } = await loadDefaultFES(world);
    await task.tick();
    const front = instance.byKey.get('front').nativeInputTaskID,
      parent = world.runtime.scheduler.tasks.get(world.main.id),
      packet = parent.machine.bytes(240, 16).slice(),
      dispatch = world.input.dispatch,
      targets = [];
    world.input.dispatch = function (...args) {
      if (args[1] === 4) targets.push(args[0]);
      return dispatch.apply(this, args);
    };
    world.input.pointer(40, 35);
    await world.input.hover();
    await world.input.route(0, true, 2);
    assert.equal(targets[0], front);
    assert.equal(task.player.nativeInput.focused.o, instance.byKey.get('front'));
    assert.equal(instance.label, 'WAIT');
    assert.deepEqual(parent.machine.bytes(240, 16), packet);
  } finally {
    await world.close({ flushFiles: false });
  }
});

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`${profile} DOM system actions retain native FES sender and real Script replies`, async () => {
    const replyProgram = kcsProgram(
        [
          [37, 240],
          [43, 0x47, 4],
          [37, [0x33, 240]],
          [37, 768],
          [37, 832],
          [37, 0],
          [43, 0x276, 16],
          [41, 0],
        ],
        [
          [768, 'MES_ENTER'],
          [832, ''],
        ],
      ),
      world = await defaultFESWorld(profile, {
        'case.kcs': replyProgram,
        'child.kcs': replyProgram,
        'screen.fes': new TextEncoder().encode(
          source.replace('next WAIT\n', 'execkcs child.kcs\nnext WAIT\n'),
        ),
      });
    try {
      const retired = await world.objects.create({ kind: 6, parent: world.main.id });
      await world.objects.release(retired);
      const { id, task, instance } = await loadDefaultFES(world);
      await task.tick();
      const parent = world.runtime.scheduler.tasks.get(world.main.id),
        child = world.runtime.scheduler.tasks.get(instance.kcsTaskID),
        nativeID = world.nativeTaskID(id),
        host = new EngineHost({
          world,
          nativeRuntime: world.runtime,
          activeFES: () => world.objects.objects.get(id)?.implementation.player,
        }),
        words = (script) => Array.from({ length: 4 }, (_, i) => script.machine.load(240 + i * 4));
      assert.notEqual(id, nativeID);
      assert.notEqual(child.id, world.nativeTaskID(child.id));
      for (const action of [15, 21, 22]) {
        const reply = await host.systemAction(action);
        assert.deepEqual(words(parent), [nativeID, 0xffff0003, 0, action]);
        assert.equal(reply, 1);
        assert.equal(parent.machine.waiting?.kind, 'message');
        assert.equal(instance.label, 'WAIT_TOUCH');
      }
      const parentPacket = words(parent);
      assert.equal(
        await host.send([0x80000001, 0xffffffff, 0x80000002], instance, { target: 'script' }),
        1,
      );
      assert.deepEqual(words(child), [nativeID, 0x80000001, 0xffffffff, 0x80000002]);
      assert.deepEqual(words(parent), parentPacket);
      await world.objects.release(child.id);
      assert.equal(await host.send([7, 9, 11], instance, { target: 'script' }), 0);
      assert.deepEqual(words(parent), parentPacket);
      await world.objects.release(id);
      const replacement = await world.objects.create({ kind: 6, parent: world.main.id });
      assert.equal(replacement, id);
      await assert.rejects(host.systemAction(15), /No active native FES task/);
      await assert.rejects(host.send([7, 9, 11], instance), /FES message source owner/);
      assert.deepEqual(words(parent), parentPacket);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
