// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld } from './fixtures/default-fes-world.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { NativeStringBank } from '../src/native/string-bank.mjs';
import { NativeScriptReplacements } from '../src/native/script-replacement.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  names = [Uint8Array.of(114, 0x81), Uint8Array.of(114, 0x82)],
  ref = (nameBytes, index) => ({ nameBytes: nameBytes.slice(), index }),
  bank = (world) => {
    const words = world.runtime.variableBank(world.main, false);
    assert.equal(words.capacity, 64);
    return Array.from({ length: 64 }, (_, index) => words.get(index));
  };

function source() {
  const parts = [
    ascii(
      '#DEFINE\nBUTTON anchor\n#OBJECT SIZE POS\nanchor 6,4 0,0,0\n#START\n$60=++$60\nlockactive 1\nnext IDLE\n#IDLE\nbreak\nnext IDLE\n',
    ),
  ];
  for (const [index, name] of names.entries())
    for (const [event, offset] of [
      ['FOCUS', 0],
      ['UNFOCUS', 10],
    ])
      parts.push(
        ascii('#'),
        name,
        ascii(
          '.' + event + '\n$20=' + ((index + 1) * 100 + offset) + '+@\n$21=++$21\n$22=@\nbreak\n',
        ),
      );
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': source() });
  try {
    const owner = world.main.id,
      parent = world.objects.objects.get(owner),
      id = await world.objects.create({ kind: 34, parent: owner }),
      surface = await world.objects.create({ kind: 15, parent: owner });
    world.runtime.variableBank(parent).initialize(64);
    world.runtime.stringBank(parent);
    await world.sendEngine(surface, owner, 279, 128, 96);
    await world.sendEngine(surface, owner, 283);
    await world.sendEngine(id, owner, 331, 0, parent.context.variableBank);
    await world.sendEngine(id, owner, 334, 0, world.nativeTaskID(surface));
    let sourceReads = 0;
    const read = world.game.read.bind(world.game);
    world.game.read = (name) => {
      if (name === 'screen.fes') sourceReads++;
      return read(name);
    };
    await world.sendEngine(id, owner, 332, 0, 0, { payload: { string: () => 'screen' } });
    await world.sendEngine(id, owner, 333);
    const task = world.objects.objects.get(id).implementation;
    task.input.input.pointer(120, 90, 1);
    await task.tick();
    const root = task.player.root,
      buttons = names.map((name) => root.collection.create('BUTTON', name, 2));
    // This raw collection author is not a non-ASCII DEFINE or 338 acceptance case.
    buttons.flat().forEach((object, index) =>
      Object.assign(object, {
        width: 6,
        height: 4,
        x: 10 + index * 20,
        y: 20,
        z: 0,
        disp: true,
        displayValue: 1,
        dirty: true,
        sizeDirty: true,
      }),
    );
    await root.runtime.initializeResources();
    await root.runtime.resources.traverse();
    task.input.input.pointer(120, 90, 1);
    assert.equal(world.objects.objects.get(id).kind, 34);
    assert.ok(root.runtime instanceof FESCoordinator);
    assert.strictEqual(task.player.nativeInput, task.input);
    return { world, id, task, root, buttons, sourceReads: () => sourceReads };
  } catch (error) {
    await world.close();
    throw error;
  }
}

function observe(t, task) {
  const events = [],
    dispatches = [],
    input = task.input,
    root = task.player.root,
    event = task.player.nativeEvent.bind(task.player),
    dispatch = root.dispatchEvent.bind(root);
  t.mock.method(task.player, 'nativeEvent', (reference, name) => {
    events.push({ reference: structuredClone(reference), name, focused: input.snapshot().focus });
    return event(reference, name);
  });
  t.mock.method(root, 'dispatchEvent', (object, name, ...args) => {
    dispatches.push({ reference: root.collection.reference(object), name, handle: object.handle });
    return dispatch(object, name, ...args);
  });
  return { events, dispatches };
}

for (const profile of profiles) {
  test(profile + ' public input focus uses owned raw references and fresh identity', async (t) => {
    const h = await open(profile);
    let fresh;
    try {
      const { world, root, task } = h,
        input = task.input,
        a = h.buttons[0][1],
        b = h.buttons[1][0],
        aRef = ref(names[0], 1),
        bRef = ref(names[1], 0),
        { events, dispatches } = observe(t, task);
      assert.equal(a.baseName, h.buttons[1][1].baseName);
      assert.equal(a.key, h.buttons[1][1].key);
      assert.notEqual(a.handle, h.buttons[1][1].handle);
      const borrowed = root.collection.reference(a);
      assert.equal(await input.focus(borrowed), undefined);
      assert.deepEqual(input.state.focus, aRef, 'The actual public focus selects the raw target');
      assert.strictEqual(task.player.focused.o, a);
      assert.deepEqual([root.global(20), root.global(21), root.global(22)], [101, 1, 1]);
      assert.deepEqual(events, [{ reference: aRef, name: 'FOCUS', focused: aRef }]);
      assert.deepEqual(dispatches, [{ reference: aRef, name: 'FOCUS', handle: a.handle }]);
      assert.notEqual(input.state.focus.nameBytes.buffer, borrowed.nameBytes.buffer);
      borrowed.nameBytes[1] = 0x82;
      assert.deepEqual(input.state.focus, aRef);
      await input.focus(ref(names[0], 1));
      assert.equal(events.length, 1, 'Equal raw values do not repeat the event');
      await input.focus(bRef);
      assert.deepEqual(input.state.focus, bRef);
      assert.deepEqual(events.slice(-2), [
        { reference: aRef, name: 'UNFOCUS', focused: bRef },
        { reference: bRef, name: 'FOCUS', focused: bRef },
      ]);
      assert.deepEqual(dispatches.slice(-2), [
        { reference: aRef, name: 'UNFOCUS', handle: a.handle },
        { reference: bRef, name: 'FOCUS', handle: b.handle },
      ]);
      assert.deepEqual([root.global(20), root.global(21), root.global(22)], [200, 3, 0]);
      await input.focus(null);
      assert.deepEqual(events.at(-1), { reference: bRef, name: 'UNFOCUS', focused: null });
      assert.equal(input.state.focus, null);
      for (const missing of [ref(Uint8Array.of(114, 0x83), 0), ref(names[0], -1)]) {
        await input.focus(aRef);
        await input.focus(missing);
        assert.equal(input.state.focus, null);
        assert.deepEqual(events.at(-1), { reference: aRef, name: 'UNFOCUS', focused: null });
      }
      const eventCount = events.length,
        savedBank = bank(world);
      await input.focus(ref(new Uint8Array(), 0));
      await input.focus(ref(names[0], -1));
      assert.equal(events.length, eventCount);
      assert.deepEqual(bank(world), savedBank);
      await input.focus(bRef);
      const state = world.snapshot(),
        inputState = input.snapshot(),
        sourceState = world.fesSources.snapshot(),
        oldBank = bank(world),
        random = world.random.snapshot(),
        playerRandom = task.player.randomState,
        resourceCount = root.runtime.resources.entries.length,
        objectCount = world.objects.objects.size;
      assert.equal(root.global(60), 1);
      assert.equal(h.sourceReads(), 1);
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const reads = [],
        read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        reads.push(name);
        assert.equal(name, 'case.kcs', 'Only immutable KCS may be read during fresh restore');
        assert.equal(reads.length, 1, 'Immutable KCS is restored once');
        return read(name);
      };
      let restoring = true;
      for (const [prototype, method] of [
        [FESInstance.prototype, 'execute'],
        [FESInstance.prototype, 'expandMacros'],
        [FESCoordinator.prototype, 'initialize'],
        [NativeStringBank.prototype, 'expandBytes'],
        [NativeScriptReplacements.prototype, 'apply'],
        [FESPlayer.prototype, 'random'],
        [ParticleRandom.prototype, 'rand'],
        [ParticleRandom.prototype, 'frand'],
      ]) {
        const original = prototype[method];
        t.mock.method(prototype, method, function (...args) {
          assert.equal(restoring, false, 'Fresh restore does not replay ' + method);
          return original.apply(this, args);
        });
      }
      try {
        await fresh.restore(state);
      } finally {
        restoring = false;
      }
      const restoredTask = fresh.objects.objects.get(h.id).implementation,
        next = restoredTask.player.root,
        nextInput = restoredTask.input,
        nextA = next.collection.lookup(names[0], 1),
        { events: nextEvents, dispatches: nextDispatches } = observe(t, restoredTask);
      assert.notEqual(restoredTask, task);
      assert.notEqual(nextInput, input);
      assert.notEqual(next, root);
      assert.notEqual(next.collection, root.collection);
      assert.notEqual(nextA, a);
      assert.equal(nextA.handle, a.handle);
      assert.deepEqual(nextInput.snapshot(), inputState);
      assert.notEqual(nextInput.state.focus.nameBytes.buffer, input.state.focus.nameBytes.buffer);
      assert.deepEqual(bank(fresh), oldBank);
      assert.deepEqual(fresh.random.snapshot(), random);
      assert.equal(restoredTask.player.randomState, playerRandom);
      assert.deepEqual(fresh.fesSources.snapshot(), sourceState);
      assert.equal(next.runtime.resources.entries.length, resourceCount);
      assert.equal(fresh.objects.objects.size, objectCount);
      assert.deepEqual(reads, ['case.kcs']);
      await nextInput.focus(aRef);
      assert.strictEqual(restoredTask.player.focused.o, nextA);
      assert.deepEqual(nextEvents, [
        { reference: bRef, name: 'UNFOCUS', focused: aRef },
        { reference: aRef, name: 'FOCUS', focused: aRef },
      ]);
      assert.deepEqual(nextDispatches, [
        { reference: bRef, name: 'UNFOCUS', handle: b.handle },
        { reference: aRef, name: 'FOCUS', handle: a.handle },
      ]);
      assert.deepEqual([next.global(20), next.global(22), next.global(60)], [101, 1, 1]);
      assert.deepEqual(bank(world), oldBank);
      assert.deepEqual(input.snapshot(), inputState);
      assert.deepEqual(world.random.snapshot(), random);
      assert.deepEqual(reads, ['case.kcs']);
      assert.equal(h.sourceReads(), 1);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await h.world.close();
    }
  });
}
