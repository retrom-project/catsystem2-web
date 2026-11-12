// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { fesMotionState } from '../src/native/fes-motion-model.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { kcsProgram } from './helpers.mjs';

const source = new TextEncoder().encode(`#DEFINE
CPLANE tint
#OBJECT SIZE COLOR DISP
tint 4,4 0xff123456 1
#SUBCOMMAND
continue custom absent PX[0] : [0]
continue broken malformed : 0
continue inaccessible inaccessible : 0
#START
next IDLE
#IDLE
#MISSING
tint delay 3
tint blend 128
tint pos 7 -8
tint custom ++$10
tint ismot 11
tint getpos 12 13
break
#ZERO
tint blend 96
break
#PLAY
tint blend 64
break
#CUSTOM
tint custom ++$10
break
#STOP
tint stop
tint delay 3
break
#BAD
tint broken
break
#IO
tint inaccessible
break
`);
const shared = (offset) => [0x13, (0x80000000 + offset) >>> 0],
  colorScript = kcsProgram([[21, shared(MOTION_ABI.pos), shared(MOTION_ABI.registers)], [59]]);
function recordReads(world) {
  const reads = [],
    game = world.motionLibrary.game;
  for (const method of ['read', 'require']) {
    const read = game[method].bind(game);
    game[method] = (name) => {
      if (name.endsWith('.kcs') && name !== 'case.kcs')
        reads.push(name.toLowerCase().replace(/\.kcs$/, ''));
      return read(name);
    };
  }
  return reads;
}

for (const profile of profiles) {
  test(`${profile}: default missing and empty MOT return normally without consuming motion state; present/cache/fresh paths still execute`, async () => {
    const world = await defaultFESWorld(profile, { 'screen.fes': source }),
      game = world.motionLibrary.game,
      readColor = game.read.bind(game);
    let fresh,
      emptyFresh,
      color = null;
    game.read = (name) => (name === 'pcolor.kcs' ? color : readColor(name));
    const reads = recordReads(world);
    try {
      const h = await loadDefaultFES(world),
        { instance } = h,
        object = instance.collection.lookup('tint', 0),
        runtime = instance.runtime,
        randomBefore = world.random.snapshot();
      await h.task.tick();
      const taskIDs = [...world.objects.objects.keys()],
        entries = runtime.resources.entries.slice();
      await h.task.player.notify('MISSING');
      const target = runtime.targetFor(object, false);
      assert.deepEqual(reads, ['pcolor', 'ppos', 'absent']);
      assert.deepEqual([object.alpha, object.x, object.y, object.motionDelay], [128, 7, -8, 3]);
      assert.deepEqual(
        [instance.global(10), instance.global(11), instance.global(12), instance.global(13)],
        [1, 0, 7, -8],
      );
      assert.equal(target.manager.records.size, 0);
      assert.equal(target.manager.nextHandle, 1);
      assert.equal(target.lastFrame, -1);
      assert.equal(target.lastHandle, 0);
      assert.deepEqual(target.manager.base, fesMotionState(object));
      assert.deepEqual(world.random.snapshot(), randomBefore);
      assert.deepEqual([...world.objects.objects.keys()], taskIDs);
      assert.deepEqual(runtime.resources.entries, entries);
      assert.equal(
        world.motionLibrary.scripts.size,
        0,
        'absence must not poison the filename cache',
      );

      color = new Uint8Array();
      await h.task.player.notify('ZERO');
      assert.equal(reads.filter((name) => name === 'pcolor').length, 2);
      assert.equal(object.alpha, 96, 'blend applies its ordinary alpha before the failed load');
      assert.equal(object.motionDelay, 3);
      assert.equal(target.manager.nextHandle, 1);
      assert.equal(target.manager.records.size, 0);
      assert.equal(world.motionLibrary.scripts.size, 0);
      assert.deepEqual(target.manager.base, fesMotionState(object));

      emptyFresh = await defaultFESWorld(profile, {}, { initialize: false });
      const emptyReads = recordReads(emptyFresh),
        emptyRead = emptyFresh.game.read.bind(emptyFresh.game);
      emptyFresh.game.read = (name) => {
        if (name !== 'case.kcs') throw new Error(`empty MOT restore read ${name}`);
        return emptyRead(name);
      };
      await emptyFresh.restore(world.snapshot());
      const emptyTask = emptyFresh.objects.objects.get(h.id).implementation,
        emptyObject = emptyTask.player.root.collection.lookup('tint', 0),
        emptyTarget = emptyTask.player.root.runtime.targetFor(emptyObject, false);
      assert.deepEqual(emptyReads, [], 'restoring an absent MOT must not retry its load');
      assert.deepEqual(emptyTarget.snapshot(), target.snapshot());
      await emptyTask.player.notify('CUSTOM');
      assert.deepEqual(emptyReads, ['absent']);
      assert.equal(emptyTarget.manager.records.size, 0);
      assert.equal(emptyTarget.manager.nextHandle, 1);
      assert.equal(emptyObject.motionDelay, 3);
      assert.equal(emptyTask.player.root.global(10), 2);
      assert.equal(emptyFresh.nativeEngine, undefined);

      color = colorScript;
      await h.task.player.notify('PLAY');
      assert.equal(target.manager.nextHandle, 2);
      assert.equal(target.manager.records.size, 1);
      assert.equal(target.manager.records.get(1).instance.delay, 3);
      assert.equal(object.motionDelay, 3);
      assert.equal(world.motionLibrary.scripts.size, 1);
      for (let frame = 0; frame < 2; frame++) await world.tick();
      assert.equal(object.x, 7, 'the actual MOT still observes the original delay');
      const checkpoint = world.snapshot();
      fresh = await defaultFESWorld(profile, { 'pcolor.kcs': colorScript }, { initialize: false });
      const freshReads = recordReads(fresh),
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (!['case.kcs', 'pcolor.kcs'].includes(name)) throw new Error(`MOT restore read ${name}`);
        return read(name);
      };
      await fresh.restore(checkpoint);
      const freshTask = fresh.objects.objects.get(h.id).implementation,
        restored = freshTask.player.root.collection.lookup('tint', 0),
        restoredTarget = freshTask.player.root.runtime.targetFor(restored, false);
      assert.deepEqual(freshReads, ['pcolor']);
      assert.deepEqual(restoredTarget.snapshot(), target.snapshot());
      for (let frame = 0; frame < 2; frame++) {
        await world.tick();
        await fresh.tick();
        assert.deepEqual(restoredTarget.snapshot(), target.snapshot());
        assert.deepEqual(
          [restored.x, restored.y, restored.alpha],
          [object.x, object.y, object.alpha],
        );
      }
      assert.equal(object.x, 64, 'the successfully loaded KCS copies the real blend register');
      assert.equal(target.busy(), true);
      const active = target.snapshot();
      await h.task.player.notify('CUSTOM');
      assert.deepEqual(
        target.snapshot(),
        active,
        'a missing subcommand leaves the active MOT untouched',
      );
      assert.equal(
        instance.global(10),
        2,
        'subcommand parameter evaluation still happens before loading',
      );
      color = null;
      await h.task.player.notify('PLAY');
      assert.equal(
        reads.filter((name) => name === 'pcolor').length,
        3,
        'a cached success does not reopen the missing file',
      );
      assert.equal(target.manager.records.size, 2);
      assert.equal(target.manager.nextHandle, 3);

      await h.task.player.notify('STOP');
      const stopped = target.snapshot();
      stopped.manager.base = fesMotionState(object).slice();
      assert.equal(stopped.lastFrame, 0);
      assert.equal(stopped.lastHandle, 2);
      await h.task.player.notify('CUSTOM');
      assert.deepEqual(
        target.snapshot(),
        stopped,
        'an idle miss preserves the previous frame/handle and only takes the original pre-load base snapshot',
      );
      assert.equal(object.motionDelay, 3);
      assert.equal(instance.global(10), 3);
      assert.deepEqual(world.random.snapshot(), randomBefore);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await emptyFresh?.close();
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile}: default malformed MOT and I/O errors remain explicit, while required callers still require a resource`, async () => {
    for (const [label, expected] of [
      ['BAD', /Expected KCS/],
      ['IO', new Error('authored MOT I/O failure')],
    ]) {
      const world = await defaultFESWorld(profile, {
        'screen.fes': source,
        'malformed.kcs': new Uint8Array(32),
      });
      try {
        const h = await loadDefaultFES(world);
        await h.task.tick();
        const game = world.motionLibrary.game,
          read = game.read.bind(game);
        game.read = (name) => {
          if (name === 'inaccessible.kcs') throw expected;
          return read(name);
        };
        await assert.rejects(h.task.player.notify(label), expected);
        const object = h.instance.collection.lookup('tint', 0),
          target = h.instance.runtime.targetFor(object, false);
        assert.equal(target.manager.records.size, 0);
        assert.equal(target.manager.nextHandle, 1);
        assert.equal(world.motionLibrary.scripts.size, 0);
        await assert.rejects(world.motionLibrary.load('required-absence'), /Missing resource:/);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
      }
    }
  });
}
