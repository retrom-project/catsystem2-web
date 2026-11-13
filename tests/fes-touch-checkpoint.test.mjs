// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const source = `#DEFINE
BUTTON b
#OBJECT SIZE POS
b 16,16 10,10,0
#START
$41=++$41
next IDLE
#IDLE
break
next IDLE
#b.TOUCH
$40=++$40
break
`;
function javascriptOnly(world) {
  world.ensureNativeEngine = () => {
    throw new Error('TOUCH checkpoint must stay JavaScript');
  };
}
for (const profile of profiles) {
  test(`${profile}: real TOUCH survives portable checkpoint and fresh World without source or event replay`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': new TextEncoder().encode(source),
    });
    javascriptOnly(world);
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const input = h.task.input.input,
        button = h.instance.collection.lookup('b', 0),
        initialSavedTouch = h.task.player.snapshot().root.touch,
        receive = h.task.input.message.bind(h.task.input);
      let callbacks = 0;
      h.task.input.message = (words, context) => {
        if (words[1] === 65) callbacks++;
        return receive(words, context);
      };
      assert.equal(h.instance.system('_TOUCH_'), 0);
      input.pointer(12, 12, 1);
      await world.tick();
      input.pointerActivation = true;
      await world.tick();
      assert.equal(callbacks, 2, 'real BUTTON and low-button Graph callbacks ran');
      assert.equal(input.pointerActivation, false);
      assert.equal(h.instance.system('_TOUCH_'), button.handle);
      assert.equal(h.instance.global(40), 1);
      assert.equal(h.instance.global(41), 1);
      await world.tick();
      assert.equal(callbacks, 2);
      assert.equal(
        h.instance.system('_TOUCH_'),
        button.handle,
        'ordinary frame does not clear TOUCH',
      );

      const file = await serializeCheckpoint(world.snapshot()),
        saved = await deserializeCheckpoint(file);
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      javascriptOnly(fresh);
      const reads = [],
        messages = [],
        read = fresh.game.read.bind(fresh.game),
        dispatch = fresh.engineMessages.dispatch.bind(fresh.engineMessages),
        dispatchNative = fresh.engineMessages.dispatchNative.bind(fresh.engineMessages);
      fresh.game.read = (name) => {
        reads.push(name);
        return read(name);
      };
      fresh.engineMessages.dispatch = (target, sender, code, ...args) => {
        messages.push(code);
        return dispatch(target, sender, code, ...args);
      };
      fresh.engineMessages.dispatchNative = (sender, target, code, ...args) => {
        messages.push(code);
        return dispatchNative(sender, target, code, ...args);
      };
      await fresh.restore(saved);
      const task = fresh.objects.objects.get(h.id).implementation,
        instance = task.player.root;
      assert.equal(
        instance.system('_TOUCH_'),
        button.handle,
        'fresh restore preserves sole TOUCH owner',
      );
      assert.equal(instance.collection.lookup('b', 0).handle, button.handle);
      assert.equal(instance.global(40), 1, 'restoring does not replay the TOUCH label');
      assert.equal(instance.global(41), 1, 'restoring does not replay START');
      assert.equal(
        initialSavedTouch,
        0,
        'before-event snapshot uses existing system zero semantics',
      );
      await fresh.tick();
      assert.equal(
        instance.system('_TOUCH_'),
        button.handle,
        'restored ordinary frame retains TOUCH',
      );
      assert.equal(instance.value('_TOUCH_'), button.handle);
      assert.equal(instance.global(40), 1);
      assert.equal(instance.global(41), 1);
      assert.equal(
        messages.includes(65),
        false,
        'neither restore nor its frame replays TOUCH delivery',
      );
      assert.equal(messages.includes(332), false, 'restore does not request a new FES source');
      assert.ok(
        reads.every((name) => name === 'case.kcs'),
        `no FES/FILE replay: ${reads}`,
      );
      assert.equal(task.input.input.pointerActivation, false);
      assert.equal(fresh.nativeEngine, undefined);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await world.close();
    }
  });
}
