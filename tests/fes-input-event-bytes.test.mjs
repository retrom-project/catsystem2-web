// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld } from './fixtures/default-fes-world.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { FESInput } from '../src/native/fes-input.mjs';
import { FESObjectCollection } from '../src/native/fes-object-collection.mjs';
import { createFESTypedObject } from '../src/native/fes-object-factory.mjs';
import { initializeFESImage } from '../src/native/fes-image-driver.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  names = [Uint8Array.of(114, 0x81), Uint8Array.of(114, 0x82)],
  controlNames = [Uint8Array.of(115, 0x81), Uint8Array.of(115, 0x82)],
  events = ['FOCUS', 'UNFOCUS', 'PUSH_L', 'PUSH_R', 'RELEASE_L', 'RELEASE_R', 'TOUCH', 'SCRL_P'],
  join = (...parts) => {
    const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    return bytes;
  },
  reference = (nameBytes, index) => ({ nameBytes: nameBytes.slice(), index }),
  marker = (base, event, index) => base + events.indexOf(event) * 10 + index;

function source() {
  const parts = [
    ascii(
      '#KEYBLOCK 1\n0 2,1 -1,-1,-1,-1\n#DEFINE\nBUTTON anchor\n#OBJECT SIZE POS\nanchor 6,4 0,0,0\n#START\n$60=++$60\nlockactive 1\nnext IDLE\n#IDLE\nbreak\nnext IDLE\n',
    ),
  ];
  for (const event of events) {
    parts.push(ascii('#SHARED.' + event + '\n$41=++$41\nbreak\n'));
    for (const [name, base] of [
      [names[0], 100],
      [names[1], 200],
      [controlNames[0], 300],
      [controlNames[1], 400],
      [ascii('r?'), 900],
      [ascii('s?'), 950],
    ])
      parts.push(
        ascii('#'),
        name,
        ascii(
          '.' +
            event +
            '\n$40=' +
            marker(base, event, 0) +
            '+@\n$42=++$42\n$43=@\n$44=$41\nbreak\n',
        ),
      );
  }
  return join(...parts);
}

async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': source() });
  world.ensureNativeEngine = () => {
    throw new Error('raw event identities must stay JavaScript');
  };
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
    await task.tick();
    const instance = task.player.root,
      runtime = instance.runtime,
      buttons = names.map((name) => instance.collection.create('BUTTON', name, 2)),
      controls = controlNames.map((name) => instance.collection.create('SLIDER', name, 2));
    buttons.flat().forEach((object, at) =>
      Object.assign(object, {
        width: 6,
        height: 4,
        x: 10 + at * 20,
        y: 20,
        z: 0,
        disp: true,
        displayValue: 1,
        dirty: true,
        sizeDirty: true,
        defaultHandler: 'SHARED',
        systemKey: at === 2 ? 79 : -1,
        keyblock: at < 2 ? { block: 0, x: at, y: 0 } : { block: -1, x: 0, y: 0 },
      }),
    );
    controls.flat().forEach((object) => {
      object.defaultHandler = 'SHARED';
    });
    await runtime.initializeResources();
    await runtime.resources.traverse();
    task.input.input.pointer(120, 90, 1);
    return {
      world,
      id,
      task,
      instance,
      runtime,
      buttons,
      controls,
      sourceReads: () => sourceReads,
    };
  } catch (error) {
    await world.close();
    throw error;
  }
}

function observe(t, task) {
  const seen = [],
    fields = [],
    event = task.player.nativeEvent.bind(task.player);
  t.mock.method(task.player, 'nativeEvent', (ref, name) => {
    const result = event(ref, name);
    seen.push({ ref: structuredClone(ref), name });
    fields.push({
      ref: structuredClone(ref),
      name,
      clickL: task.player.root.clickL,
      pushRight: task.player.root.pushRight,
    });
    return result;
  });
  return { seen, fields };
}
function checkLabel(instance, base, event, index) {
  assert.equal(instance.global(40), marker(base, event, index));
  assert.equal(instance.global(43), index);
  assert.equal(instance.global(41), instance.global(42), 'Both default and raw own labels ran');
  assert.equal(instance.global(44), instance.global(41), 'Default ran before raw own label');
}
async function focus(world, id, object) {
  await world.sendEngine(id, world.main.id, 64, world.nativeTaskID(object.nativeInputTaskID), 1);
}

for (const profile of profiles) {
  test(
    'normal event raw tuples reach actual FES input and controls with fresh restore: ' + profile,
    async (t) => {
      const h = await open(profile);
      let fresh;
      try {
        const a = h.buttons[0][1],
          b = h.buttons[1][0],
          aRef = reference(names[0], 1),
          bRef = reference(names[1], 0),
          { seen, fields } = observe(t, h.task);
        assert.equal(
          a.baseName,
          h.buttons[1][1].baseName,
          'Raw names have the same decoded presentation',
        );
        assert.equal(a.key, h.buttons[1][1].key);
        assert.notEqual(a.handle, h.buttons[1][1].handle);
        assert.deepEqual(h.instance.collection.reference(a), aRef);
        await focus(h.world, h.id, a);
        h.task.input.input.key(0, true, 2);
        await h.world.tick();
        const pushFields = fields.findLast((row) => row.name === 'PUSH_L');
        assert.ok(pushFields, 'The actual World Graph produced PUSH_L');
        assert.equal(
          pushFields.clickL,
          a.handle,
          'The actual PUSH keeps raw owner and signed index',
        );
        assert.equal(h.instance.clickL, 0, 'The frame clears the transient click field');
        assert.deepEqual(seen.findLast((row) => row.name === 'PUSH_L').ref, aRef);
        checkLabel(h.instance, 100, 'PUSH_L', 1);
        assert.deepEqual(h.task.input.state.pressed, aRef);
        assert.notEqual(
          h.task.input.state.pressed.nameBytes.buffer,
          h.task.input.state.focus.nameBytes.buffer,
        );
        assert.equal(h.instance.global(60), 1);
        assert.equal(h.sourceReads(), 1);

        const state = h.world.snapshot(),
          resourceCount = h.runtime.resources.entries.length,
          objectCount = h.world.objects.objects.size;
        fresh = await defaultFESWorld(profile, {}, { initialize: false });
        fresh.ensureNativeEngine = () => {
          throw new Error('raw event restore must stay JavaScript');
        };
        const reads = [],
          read = fresh.game.read.bind(fresh.game);
        fresh.game.read = (name) => {
          reads.push(name);
          if (name !== 'case.kcs') throw new Error('raw event source replayed ' + name);
          return read(name);
        };
        await fresh.restore(state);
        const task = fresh.objects.objects.get(h.id).implementation,
          root = task.player.root,
          restoredA = root.collection.lookup(aRef.nameBytes, aRef.index),
          restoredB = root.collection.lookup(bRef.nameBytes, bRef.index),
          { seen: restoredSeen, fields: restoredFields } = observe(t, task);
        assert.equal(root.runtime.resources.entries.length, resourceCount);
        assert.equal(
          fresh.objects.objects.size,
          objectCount,
          'Restore does not allocate resources again',
        );
        assert.equal(restoredA.handle, a.handle);
        assert.equal(restoredB.handle, b.handle);
        assert.deepEqual(task.input.state.pressed, aRef);
        assert.notEqual(
          task.input.state.pressed.nameBytes.buffer,
          h.task.input.state.pressed.nameBytes.buffer,
        );
        assert.equal(root.global(60), 1);
        assert.deepEqual(reads, ['case.kcs']);
        task.input.input.key(0, false);
        await fresh.tick();
        assert.deepEqual(restoredSeen.findLast((row) => row.name === 'RELEASE_L').ref, aRef);
        assert.equal(restoredFields.findLast((row) => row.name === 'RELEASE_L').clickL, 0);
        assert.equal(root.clickL, 0);
        checkLabel(root, 100, 'RELEASE_L', 1);

        await fresh.sendEngine(
          h.id,
          restoredB.nativeInputTaskID,
          65,
          fresh.nativeTaskID(restoredB.nativeInputTaskID),
          0,
        );
        assert.deepEqual(restoredSeen.at(-1), { ref: bRef, name: 'TOUCH' });
        assert.equal(root.touch, restoredB.handle);
        checkLabel(root, 200, 'TOUCH', 0);

        await focus(fresh, h.id, root.collection.lookup(names[0], 0));
        const labelCount = root.global(42);
        task.input.input.key(7, true, 2);
        await fresh.tick();
        assert.deepEqual(restoredSeen.findLast((row) => row.name === 'PUSH_RIGHT').ref, aRef);
        assert.equal(
          restoredFields.findLast((row) => row.name === 'PUSH_RIGHT').pushRight,
          restoredA.handle,
        );
        assert.equal(root.pushRight, 0, 'The frame clears the transient direction field');
        assert.equal(
          root.global(42),
          labelCount,
          'Direction writes its field without inventing a label',
        );
        task.input.input.key(7, false);
        await fresh.tick();
        task.input.input.key(79, true, 2);
        await fresh.tick();
        assert.deepEqual(restoredSeen.findLast((row) => row.name === 'PUSH_L').ref, bRef);
        assert.equal(
          restoredFields.findLast((row) => row.name === 'PUSH_L').clickL,
          restoredB.handle,
        );
        assert.equal(root.clickL, 0, 'The SYSKEY frame also clears its transient field');
        checkLabel(root, 200, 'PUSH_L', 0);

        for (const [name, index, base, value] of [
          [controlNames[0], 1, 300, 37],
          [controlNames[1], 0, 400, 42],
        ]) {
          const object = root.collection.lookup(name, index),
            ref = reference(name, index),
            child = fresh.objects.objects.get(object.nativeTaskID);
          assert.equal(child.kind, 42);
          assert.equal(child.parent, h.id);
          await fresh.sendEngine(h.id, child.id, 27, 0, value);
          assert.deepEqual(restoredSeen.at(-1), { ref, name: 'SCRL_P' });
          assert.equal(object.value, value);
          assert.equal(root.scrollPosition, object.handle);
          checkLabel(root, base, 'SCRL_P', index);
          await fresh.sendEngine(h.id, child.id, 28, 0, 1);
          assert.deepEqual(restoredSeen.at(-1), { ref, name: 'FOCUS' });
          checkLabel(root, base, 'FOCUS', index);
          await fresh.sendEngine(h.id, child.id, 28, 0, 0);
          assert.deepEqual(restoredSeen.at(-1), { ref, name: 'UNFOCUS' });
          checkLabel(root, base, 'UNFOCUS', index);
        }
        assert.deepEqual(reads, ['case.kcs']);
        assert.equal(root.global(60), 1);
        assert.equal(root.runtime.resources.entries.length, resourceCount);
        assert.equal(fresh.objects.objects.size, objectCount);
        assert.equal(h.sourceReads(), 1);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await h.world.close();
      }
    },
  );
}

test('normal pressed event references retain NULL, missing and current nonBUTTON distinctions', async () => {
  const collection = new FESObjectCollection({
      create: (identity) => createFESTypedObject(identity, { initializeImage: initializeFESImage }),
    }),
    a = collection.create('BUTTON', names[0], 2)[1],
    b = collection.create('BUTTON', names[1], 2)[1],
    player = new FESPlayer({}, {}),
    calls = [],
    instance = {
      collection,
      runtime: {},
      byKey: collection.byKey,
      objects: collection.objects,
      dispatchEvent: (object, event) => {
        calls.push([object.handle, event]);
        return true;
      },
    },
    record = { id: 7, implementation: { player } },
    input = new FESInput(record, {});
  player.root = instance;
  input.state.focus = reference(names[0], 1);
  const captured = input.capturePressedReference();
  assert.deepEqual(captured, reference(names[0], 1));
  assert.notEqual(captured.nameBytes.buffer, input.state.focus.nameBytes.buffer);
  assert.equal(a.key, b.key);
  assert.equal(player.nativeEvent(captured, 'PUSH_L'), true);
  assert.equal(instance.clickL, a.handle);
  assert.deepEqual(calls.at(-1), [a.handle, 'PUSH_L']);

  await collection.remove(a);
  const replacement = collection.create('VIEW', names[0], 2)[1];
  assert.equal(replacement.nativeType, 0);
  assert.equal(input.pressedEventReference(), captured);
  assert.equal(player.nativeEvent(input.pressedEventReference(), 'RELEASE_L'), true);
  assert.equal(instance.clickL, 0);
  assert.deepEqual(calls.at(-1), [replacement.handle, 'RELEASE_L']);

  input.state.focus = reference(ascii('missing'), 1);
  assert.equal(input.capturePressedReference(), undefined);
  assert.deepEqual(input.state.pressed, reference(ascii('missing'), 1));
  assert.equal(input.pressedEventReference(), undefined);
  input.state.pressed = reference(names[0], -1);
  assert.equal(input.pressedEventReference(), null);
  input.state.focus = null;
  assert.equal(input.capturePressedReference(), null);
  assert.equal(input.state.pressed, null);
  assert.equal(player.nativeEvent(null, 'PUSH_L'), false);
  assert.equal(instance.clickL, -1);
});
