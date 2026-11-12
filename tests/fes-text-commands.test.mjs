// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { hg3 } from './helpers.mjs';
import { append } from './fixtures/fes-log-model.mjs';

const source = `#DEFINE
STRING mixed[5]
#OBJECT SIZE
mixed 24,16
#START
next IDLE
#IDLE
#TEXT
mixed str ABC
break
#MARK
mixed apendmark ++$10
break
#CLEAR
mixed clear ++$10
break
#SKIP
mixed skip ++$10
break
#RESET
mixed reset ++$10
break
#ISDRAW
mixed isdraw ++$10
break
#ISDRAWMARK
mixed isdrawmark ++$10
break
#INSERT
mixed insert ++$10
break
#INSERTNV
mixed[2] insert ++$10
break
#LINE
mixed linecnt ++$10
break
#LINENV
mixed[2] linecnt ++$10
break
#LINEBASE
mixed[3] linecnt ++$10
break
#LINEMISSING
mixed linecnt
break
#END
mixed endpos ++$10 ++$10
break
#ENDY
mixed endpos -1 ++$10
break
#ENDMISSING
mixed endpos
break
`;
async function setup(profile) {
  const world = await defaultFESWorld(profile, {
    'screen.fes': new TextEncoder().encode(source),
  });
  try {
    const h = await loadDefaultFES(world),
      { instance } = h,
      collection = instance.collection,
      replace = async (index, type) => {
        await collection.remove(collection.lookup('mixed', index));
        instance.createObjects(FES_OBJECT_DEFINITION_ORDER.indexOf(type), 'mixed', index + 1);
        await instance.applyObjects('#OBJECT SIZE', `mixed[${index}] 24,16`);
      };
    await replace(2, 'NVSTRING');
    await replace(3, 'VIEW');
    if (profile === profiles[1]) await replace(4, 'STRING8');
    await collection.remove(collection.lookup('mixed', 1));
    await instance.applyObjects('#OBJECT SIZE', 'mixed 24,16');
    await h.task.syncObjects();
    assert.deepEqual(
      Array.from({ length: 5 }, (_, index) => collection.lookup('mixed', index)?.nativeType),
      [21, undefined, 29, 0, profile === profiles[1] ? 37 : 21],
    );
    instance.setGlobal(10, 41);
    return { world, ...h };
  } catch (error) {
    await world.close();
    throw error;
  }
}

for (const profile of profiles) {
  for (const type of profile === profiles[0] ? ['LOGSTRING'] : ['LOGSTRING', 'LOGSTRING8'])
    test(`${profile}: default ${type} reset skips missing LOGs and resets their actual generated text subset`, async () => {
      const world = await defaultFESWorld(profile, {
        'screen.fes': new TextEncoder().encode(`#DEFINE
${type} history[3]
#OBJECT COUNT POS2 SIZE2 PRI
history 1 area:0 area:0 60000
#START
next IDLE
#IDLE
#BIND
history setlog $0
break
#RESET
history reset ++$10
break
`),
        'area.hg3': hg3(24, 16, new Uint8Array(24 * 16 * 4)),
      });
      try {
        const h = await loadDefaultFES(world),
          handle = world.displayLogs.create(h.id);
        append(world.displayLogs, world.displayLogs.get(handle), 'A', 0);
        h.instance.setGlobal(0, handle);
        h.instance.setGlobal(10, 41);
        await h.task.player.notify('BIND');
        await h.task.syncObjects();
        const groups = [0, 1, 2].map((index) => {
          const object = h.instance.collection.lookup('history', index);
          return object.slots.flatMap((slot) =>
            [slot.main, slot.secondary]
              .filter((value) => value !== null)
              .map((value) => h.instance.collection.graph.get(value)),
          );
        });
        for (const children of groups)
          for (const child of children) child.nativeTextState.dirty = false;
        assert.deepEqual(
          groups.map((children) => children.map((child) => child.handle)),
          [0, 1, 2].map(() => groups[0].map((child) => child.handle)),
          'same-name LOGs borrow the canonical first-wins generated STRING group',
        );
        const calls = [],
          commands = world.text.log,
          command = commands.command.bind(commands);
        commands.command = (...args) => {
          if (args[2] === 'reset') calls.push(args[1].index);
          return command(...args);
        };
        await h.instance.collection.remove(h.instance.collection.lookup('history', 1));
        await h.task.player.notify('RESET');
        assert.deepEqual(calls, [0, 2]);
        for (const children of groups) {
          assert.equal(children.length, type === 'LOGSTRING' ? 1 : 2);
          for (const child of children) assert.equal(child.nativeTextState.dirty, true);
        }
        assert.equal(h.instance.global(10), 41);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
      }
    });

  test(`${profile}: default FES text mutations skip holes while NV insert stops, and pending mutations restore once`, async () => {
    const h = await setup(profile),
      { world, instance } = h,
      objects = [0, 2, 4].map((at) => instance.collection.lookup('mixed', at));
    let fresh;
    try {
      await h.task.player.notify('TEXT');
      await h.task.player.notify('MARK');
      for (const object of objects)
        assert.deepEqual(
          object.nativeTextState.source,
          Uint8Array.from(
            object.nativeType === 37 ? [65, 66, 67, 239, 191, 191] : [65, 66, 67, 255],
          ),
        );
      await h.task.player.notify('INSERT');
      assert.equal(objects[1].nativeTextState.section, false);
      await h.task.player.notify('INSERTNV');
      assert.equal(objects[1].nativeTextState.section, true);
      await h.task.player.notify('SKIP');
      for (const object of objects) assert.equal(object.nativeTextState.finish, true);
      const saved = world.snapshot();
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (name !== 'case.kcs') throw new Error(`text command restore read ${name}`);
        return read(name);
      };
      await fresh.restore(saved);
      const task = fresh.objects.objects.get(h.id).implementation,
        root = task.player.root;
      for (const object of objects)
        assert.deepEqual(
          root.collection.lookup('mixed', object.index).nativeTextState,
          object.nativeTextState,
        );
      await task.player.notify('CLEAR');
      for (const at of [0, 2, 4]) {
        const state = root.collection.lookup('mixed', at).nativeTextState;
        assert.deepEqual(state.source, new Uint8Array());
        assert.equal(state.pendingClear, true);
      }
      await task.syncObjects();
      for (const at of [0, 2, 4]) {
        const object = root.collection.lookup('mixed', at),
          text = fresh.graphics.get(object.nativeTaskID);
        assert.equal(object.nativeTextState.pendingClear, false);
        assert.deepEqual(text.text.sourceEvents, []);
      }
      assert.equal(root.global(10), 41, 'ignored mutation arguments never evaluate');
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile}: default text queries keep each output position shared and preserve distinct hole rules`, async () => {
    const h = await setup(profile),
      { instance, world } = h,
      objects = [0, 2, 4].map((at) => instance.collection.lookup('mixed', at)),
      query = (label) => h.task.player.notify(label);
    try {
      for (const [at, object] of objects.entries())
        Object.assign(object.nativeTextState, {
          remaining: 11 + at,
          remainingPage: 21 + at,
          line: 31 + at,
          end: [41 + at, 51 + at],
          dirty: false,
        });
      const localWrites = [],
        original = instance.setLocal.bind(instance);
      instance.setLocal = (index, value) => {
        localWrites.push([index, value]);
        return original(index, value);
      };
      await query('ISDRAW');
      assert.deepEqual(
        localWrites,
        [11, 12, 13].map((value) => [0, value]),
      );
      localWrites.length = 0;
      await query('ISDRAWMARK');
      assert.deepEqual(
        localWrites,
        [21, 22, 23].map((value) => [0, value]),
      );
      instance.setLocal = original;
      assert.equal(instance.global(10), 41);
      await query('LINE');
      assert.equal(instance.global(10), 42);
      assert.equal(instance.global(42), 31, 'linecnt stops at the first missing slot');
      await query('LINENV');
      assert.equal(instance.global(10), 43);
      assert.equal(
        instance.global(43),
        0,
        'NV linecnt reads its output expression but never writes',
      );
      await query('LINEBASE');
      assert.equal(instance.global(10), 44);
      await query('LINEMISSING');
      assert.equal(instance.global(10), 44);
      instance.setGlobal(10, 41);
      await query('END');
      assert.equal(
        instance.global(10),
        43,
        'identical expressions at two parameter positions run twice',
      );
      assert.deepEqual([instance.global(42), instance.global(43)], [43, 53]);
      instance.setGlobal(10, 41);
      await query('ENDY');
      assert.equal(instance.global(10), 42);
      assert.equal(instance.global(42), 53);
      await query('ENDMISSING');
      assert.equal(instance.global(10), 42);
      await query('RESET');
      for (const object of objects) assert.equal(object.nativeTextState.dirty, true);
      assert.equal(instance.global(10), 42, 'reset ignores authored argument tokens');
      for (const at of [0, 2, 4])
        await instance.collection.remove(instance.collection.lookup('mixed', at));
      await query('ISDRAW');
      assert.equal(
        instance.local(0),
        23,
        'an empty text subset leaves the previous local untouched',
      );
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });
}
