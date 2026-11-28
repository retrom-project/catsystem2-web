// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const source = `#DEFINE
BUTTON b
BUTTON c
#OBJECT SIZE POS
b 16,16 30,40,0
c 16,16 80,40,0
#START
b setact
next IDLE
#IDLE
break
next IDLE
#LOCK
lockactive 1
break
#DISABLE
b enable 0
break
#DELETE
b delete
break
#OTHER
c setact
break
#RESET
resetactive
break
#b.PUSH_L
$10=17
break
#b.PUSH_R
$11=23
break
#b.RELEASE_L
$12=37
break
#b.RELEASE_R
$13=43
break
`;
const notify = (h, label) =>
  h.world.sendEngine(h.id, h.world.main.id, 337, 0, 0, { payload: fesLabelPayload(() => label) });
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': new TextEncoder().encode(source) });
  world.ensureNativeEngine = () => {
    throw new Error('pressed reference must stay JavaScript');
  };
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    await notify({ ...h, world }, 'LOCK');
    h.task.input.input.pointer(110, 90, 1);
    return { ...h, world, runtime: h.instance.runtime, input: h.task.input.input };
  } catch (error) {
    await world.close();
    throw error;
  }
}
const ref = (name, index = 0) => ({ nameBytes: new TextEncoder().encode(name), index });
async function press(h, key = 0) {
  h.input.key(key, true, 2);
  await h.world.tick();
}
function observe(h) {
  const events = [],
    pushes = [],
    message = h.task.input.message.bind(h.task.input),
    event = h.task.player.nativeEvent.bind(h.task.player);
  h.task.input.message = async (words, context) => {
    if (words[1] === 9 && words[3] <= 1)
      pushes.push({ words: [...words], senderWorldID: context.nativeSenderWorldID, context });
    return message(words, context);
  };
  h.task.player.nativeEvent = (reference, name) => {
    // This recorder keeps its existing ASCII diagnostics; production receives the raw ref.
    const key =
      reference === null
        ? null
        : h.instance.collection.lookup(reference.nameBytes, reference.index).key;
    const result = event(reference, name);
    events.push({
      key,
      name,
      clickL: h.instance.clickL,
      clickR: h.instance.clickR,
      pressed: structuredClone(h.task.input.state.pressed),
    });
    return result;
  };
  return { events, pushes };
}
async function createImage(h) {
  // Actual default FES object-creation message338; no extra FES source grammar.
  const bytes = new Uint8Array(36),
    view = new DataView(bytes.buffer);
  bytes[0] = 98;
  view.setUint32(32, 1, true);
  await h.world.sendEngine(h.id, h.world.main.id, 338, 0, 1, {
    payload: {
      string: () => 'b',
      bytes: (at, count) => bytes.subarray(at, at + count),
      load: (at) => view.getUint32(at, true),
    },
  });
  await notify(h, 'IDLE');
  const object = h.instance.collection.lookup('b', 0);
  assert.equal(object.nativeType, 1);
  assert.equal(object.key, 'b[0]');
  return object;
}
function pause125(h) {
  const message = h.input.message.bind(h.input),
    entered = Promise.withResolvers(),
    gate = Promise.withResolvers();
  let armed = true;
  Object.defineProperty(h.input, 'message', {
    configurable: true,
    value: async (code, ...args) => {
      const result = await message(code, ...args);
      if (code === 125 && armed) {
        armed = false;
        entered.resolve();
        await gate.promise;
      }
      return result;
    },
  });
  return { entered: entered.promise, ...gate };
}
for (const profile of profiles) {
  test(`${profile}: ordinary mouse PUSH owns raw pressed pair and RELEASE resolves its current nonBUTTON replacement`, async () => {
    const h = await open(profile);
    try {
      const seen = observe(h),
        active = h.task.input.state.focus;
      await press(h);
      assert.deepEqual(h.task.input.state.pressed, ref('b'));
      assert.notEqual(h.task.input.state.pressed, active);
      assert.equal(h.task.input.state.pressed.nameBytes.constructor, Uint8Array);
      assert.notEqual(h.task.input.state.pressed.nameBytes.buffer, active.nameBytes.buffer);
      assert.equal(
        seen.pushes[0].senderWorldID,
        h.task.input.state.lowButton,
        'real independent low Graph captures this mouse path',
      );
      const saved = h.task.input.state.pressed;
      await notify(h, 'DELETE');
      const image = await createImage(h);
      assert.equal(h.task.input.state.pressed, saved);
      seen.events.length = 0;
      h.input.key(0, false);
      await h.world.tick();
      assert.ok(seen.events.some((e) => e.name === 'RELEASE_L' && e.key === image.key));
      assert.equal(h.task.input.state.pressed, saved);
      seen.events.length = 0;
      await press(h, 1);
      assert.deepEqual(h.task.input.state.pressed, ref('b'));
      assert.ok(
        seen.events.some(
          (e) => e.name === 'PUSH_R' && e.key === image.key && e.clickR === image.handle,
        ),
      );
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
  test(`${profile}: actual default PUSH distinguishes missing active from disabled raw6 and empty active`, async () => {
    for (const mode of ['missing', 'disabled', 'empty']) {
      const h = await open(profile);
      try {
        if (mode === 'missing') await notify(h, 'DELETE');
        else if (mode === 'disabled') await notify(h, 'DISABLE');
        else {
          await notify(h, 'RESET');
          await h.world.tick();
        }
        if (mode !== 'empty') assert.deepEqual(h.task.input.state.focus, ref('b'));
        if (mode === 'disabled') {
          const object = h.instance.collection.lookup('b', 0);
          assert.equal(object.nativeType, 6);
          assert.equal(object.enable, false);
        }
        const seen = observe(h),
          before = h.instance.clickL;
        await press(h);
        assert.ok(seen.pushes.length > 0);
        if (mode === 'missing') {
          assert.deepEqual(h.task.input.state.pressed, ref('b'));
          assert.deepEqual(seen.events, []);
          assert.equal(h.instance.clickL, before);
        } else {
          assert.equal(h.task.input.state.pressed, null);
          assert.ok(
            seen.events.some((e) => e.name === 'PUSH_L' && e.key === null && e.clickL === -1),
          );
        }
      } finally {
        await h.world.close();
      }
    }
  });
  test(`${profile}: settled fresh World retains owned missing pressed bytes and normal release skips missing rather than NULL event`, async () => {
    const h = await open(profile);
    let fresh;
    try {
      await press(h);
      await notify(h, 'DELETE');
      const saved = h.task.input.state.pressed;
      assert.deepEqual(saved, ref('b'));
      const state = h.world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      fresh.ensureNativeEngine = () => {
        throw new Error('pressed restore must stay JavaScript');
      };
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        reads.push(name);
        if (name !== 'case.kcs') throw new Error('pressed replayed ' + name);
        return read(name);
      };
      await fresh.restore(state);
      const task = fresh.objects.objects.get(h.id).implementation,
        restored = {
          world: fresh,
          id: h.id,
          task,
          instance: task.player.root,
          runtime: task.player.root.runtime,
          input: task.input.input,
        },
        pressed = task.input.state.pressed,
        seen = observe(restored),
        before = restored.instance.clickL;
      assert.deepEqual(reads, ['case.kcs']);
      assert.deepEqual(pressed, saved);
      assert.notEqual(pressed, saved);
      assert.notEqual(pressed.nameBytes.buffer, saved.nameBytes.buffer);
      assert.notEqual(pressed.nameBytes.buffer, task.input.state.focus.nameBytes.buffer);
      assert.equal(restored.instance.collection.lookup(pressed.nameBytes, pressed.index), null);
      const receive = task.input.message.bind(task.input),
        releases = [];
      task.input.message = (words, context) => {
        if (words[1] === 10) releases.push({ words: [...words], context });
        return receive(words, context);
      };
      restored.input.key(0, false);
      await fresh.tick();
      assert.ok(releases.length > 0, 'restored low Graph really delivered the release');
      assert.ok(releases.every((row) => row.context.executorEntry));
      assert.deepEqual(seen.events, []);
      assert.equal(restored.instance.clickL, before);
      assert.equal(task.input.state.pressed, pressed);
      assert.deepEqual(pressed, ref('b'));
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      if (fresh) await fresh.close();
      await h.world.close();
    }
  });
  test(`${profile}: real125 completion captures current active; close or live failure before completion retains the previous pressed pair`, async () => {
    for (const mode of ['live-resolve', 'close-resolve', 'close-reject', 'live-error']) {
      const h = await open(profile);
      let gate, pending;
      try {
        await press(h);
        h.input.key(0, false);
        await h.world.tick();
        const saved = h.task.input.state.pressed;
        assert.deepEqual(saved, ref('b'));
        await notify(h, 'OTHER');
        await h.world.tick();
        assert.deepEqual(h.task.input.state.focus, ref('c'));
        gate = pause125(h);
        // Exposed FES message boundary isolates an actual125 wait; not a second hardware producer.
        pending = h.world.withExecutor(h.world.effekseer.frameExecutor, (executorEntry) =>
          h.world.sendEngine(h.id, h.task.input.state.lowButton, 9, 0, 1, { executorEntry }),
        );
        await Promise.race([
          gate.entered,
          pending.then(() => {
            throw new Error('PUSH completed before actual125 wait');
          }),
        ]);
        assert.equal(h.task.input.state.pressed, saved);
        if (mode.startsWith('close')) await h.world.objects.release(h.id);
        if (mode.endsWith('resolve')) gate.resolve();
        else gate.reject(new Error(mode));
        if (mode === 'live-error') await assert.rejects(pending, /live-error/);
        else await pending;
        if (mode === 'live-resolve') {
          assert.deepEqual(h.task.input.state.pressed, ref('c'));
          assert.notEqual(h.task.input.state.pressed, saved);
        } else assert.equal(h.task.input.state.pressed, saved);
        assert.equal(h.runtime.closed, mode.startsWith('close'));
        assert.equal(h.instance.finished, null);
      } finally {
        gate?.resolve();
        await pending?.catch(() => {});
        await h.world.close();
      }
    }
  });
}
