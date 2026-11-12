// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { hg3 } from './helpers.mjs';

const types = (profile) =>
  profile === profiles[0] ? ['STRING', 'NVSTRING'] : ['STRING', 'NVSTRING', 'STRING8'];
async function setup(profile, type, { finish = true, definition = '', beforeLoad } = {}) {
  const area = hg3(24, 16, new Uint8Array(24 * 16 * 4)),
    info = new DataView(area.buffer);
  info.setInt32(48, 7, true);
  info.setInt32(52, 9, true);
  const world = await defaultFESWorld(profile, {
    'area.hg3': area,
    'screen.fes': new TextEncoder().encode(`#DEFINE
${type} text[1]
#OBJECT SIZE POS PRI DISP
text 48,16 4,4 60001 1
${definition}
#START
text layout size 4
text layout color 255 255 255
text layout frame 10
text layout shadow 0 0
${type === 'NVSTRING' ? 'text insert\ntext apend ABC' : 'text str ABC'}
text draw
${finish ? 'text skip' : ''}
next IDLE
#IDLE
#FONT
text userfont 65 7
break
#INSERT
text insert
break
#PROFILE
text layout prof 2 ABC
break
#CLEARPROFILE
text layout c_prof 2
break
#GUARDED
text layout shift 1
text layout d_prof 0 A
text layout prof 1 B
break
`),
  });
  try {
    beforeLoad?.(world);
    const h = await loadDefaultFES(world);
    await h.task.tick();
    if (finish) await h.task.tick();
    const object = h.instance.collection.lookup('text', 0),
      oldTaskID = object.nativeTaskID,
      oldTask = world.graphics.get(oldTaskID),
      oldWriter = await oldTask.writer();
    assert.ok(oldWriter);
    assert.equal(object.nativeTextState.first, false);
    assert.equal(object.nativeTextState.endKnown, true);
    assert.deepEqual(object.nativeTextState.end, await oldWriter.endPosition());
    return { world, ...h, object, oldTaskID, oldTask, oldWriter };
  } catch (error) {
    await world.close();
    throw error;
  }
}
async function redeclare(h, type) {
  const data = new Uint8Array(36),
    view = new DataView(data.buffer);
  data.set(new TextEncoder().encode('text'));
  view.setUint32(32, 1, true);
  await h.world.sendEngine(
    h.id,
    h.world.main.id,
    338,
    0,
    FES_OBJECT_DEFINITION_ORDER.indexOf(type),
    {
      payload: {
        string: (at) => new TextDecoder().decode(data.subarray(at, data.indexOf(0, at))),
        load: (at) => view.getUint32(at, true),
      },
    },
  );
}

for (const profile of profiles)
  for (const type of types(profile)) {
    test(`${profile}: post-first ${type} redeclaration keeps its null writer, prior actual cursor and old pixels through fresh restore`, async () => {
      const h = await setup(profile, type),
        { world, object, oldTaskID, oldWriter } = h;
      let fresh;
      try {
        assert.equal(object.nativeTextState.remaining, 0);
        const before = oldWriter.frame().rgba.slice(),
          end = [...object.nativeTextState.end],
          handle = object.handle;
        assert.ok(before.some((value, at) => at % 4 === 3 && value !== 0));
        await redeclare(h, type);
        await h.task.syncObjects();
        assert.equal(object.handle, handle);
        assert.notEqual(object.nativeTaskID, oldTaskID);
        assert.equal(object.nativeTextState.first, false);
        assert.equal(world.graphics.get(object.nativeTaskID).text.writer, null);
        assert.equal(await world.graphics.get(oldTaskID).writer(), oldWriter);
        assert.deepEqual(object.nativeTextState.end, end);
        assert.equal(object.nativeTextState.endKnown, true);
        assert.equal(h.instance.runtime.resources.entries.length, 2);
        assert.deepEqual(oldWriter.frame().rgba, before);
        assert.ok(world.graphics.get(oldTaskID).graph);
        assert.equal(world.graphics.get(object.nativeTaskID).graph, null);
        const saved = world.snapshot();
        fresh = await defaultFESWorld(profile, {}, { initialize: false });
        const read = fresh.game.read.bind(fresh.game);
        fresh.game.read = (name) => {
          if (name !== 'case.kcs') throw new Error(`duplicate STRING restore read ${name}`);
          return read(name);
        };
        await fresh.restore(saved);
        const task = fresh.objects.objects.get(h.id).implementation,
          restored = task.player.root.collection.lookup('text', 0);
        assert.equal(restored.handle, handle);
        assert.equal(restored.nativeTaskID, object.nativeTaskID);
        assert.equal(fresh.graphics.get(restored.nativeTaskID).text.writer, null);
        assert.equal(fresh.graphics.get(oldTaskID).text.writer, oldWriter.pointer);
        assert.deepEqual(restored.nativeTextState.end, end);
        assert.equal(restored.nativeTextState.endKnown, true);
        await task.syncObjects();
        assert.deepEqual((await fresh.graphics.get(oldTaskID).writer()).frame().rgba, before);
        assert.ok(fresh.graphics.get(oldTaskID).graph);
        assert.equal(fresh.graphics.get(restored.nativeTaskID).graph, null);
        assert.equal(world.nativeEngine, undefined);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await world.close();
      }
    });

    test(`${profile}: post-first ${type} remaining query reports its actual null-writer boundary`, async () => {
      const h = await setup(profile, type, { finish: false });
      try {
        assert.notEqual(h.object.nativeTextState.remaining, 0);
        await redeclare(h, type);
        await assert.rejects(
          h.task.syncObjects(),
          /remaining query requires an initialized writer/,
        );
        assert.equal(h.object.nativeTextState.first, false);
        assert.equal(h.world.graphics.get(h.object.nativeTaskID).text.writer, null);
        assert.equal(await h.world.graphics.get(h.oldTaskID).writer(), h.oldWriter);
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        await h.world.close();
      }
    });

    test(`${profile}: post-first ${type} POS2 writes its current Y/X pair and does not turn metadata into a known writer end`, async () => {
      const h = await setup(profile, type);
      let fresh;
      try {
        await redeclare(h, type);
        await h.task.syncObjects();
        await h.instance.applyObjects('#OBJECT POS2', 'text area:0');
        await assert.rejects(h.task.syncObjects(), /cursor query left outputs unwritten/);
        assert.deepEqual([h.object.x, h.object.y], [7, 9]);
        assert.deepEqual(h.object.nativeTextState.end, [9, 7]);
        assert.equal(h.object.nativeTextState.endKnown, false);
        assert.equal(h.object.positionPending, false);
        assert.equal(h.world.graphics.get(h.object.nativeTaskID).text.writer, null);
        const saved = h.world.snapshot();
        fresh = await defaultFESWorld(profile, {}, { initialize: false });
        const read = fresh.game.read.bind(fresh.game);
        fresh.game.read = (name) => {
          if (name !== 'case.kcs') throw new Error(`unknown cursor restore read ${name}`);
          return read(name);
        };
        await fresh.restore(saved);
        const task = fresh.objects.objects.get(h.id).implementation,
          restored = task.player.root.collection.lookup('text', 0);
        assert.deepEqual(restored.nativeTextState.end, [9, 7]);
        assert.equal(restored.nativeTextState.endKnown, false);
        await assert.rejects(task.syncObjects(), /cursor query left outputs unwritten/);
        assert.deepEqual(restored.nativeTextState.end, [9, 7]);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await h.world.close();
      }
    });

    test(`${profile}: post-first ${type} font-map cursor producers keep their actual single or double output boundary`, async () => {
      const h = await setup(profile, type);
      try {
        await redeclare(h, type);
        await h.task.syncObjects();
        const end = [...h.object.nativeTextState.end];
        await h.task.player.notify('FONT');
        await assert.rejects(h.task.syncObjects(), /cursor query left outputs unwritten/);
        assert.equal(h.object.nativeTextState.fontDirty, false);
        assert.deepEqual(h.object.nativeTextState.fontMap, [[65, 7]]);
        assert.deepEqual(h.object.nativeTextState.end, type === 'NVSTRING' ? [65, 7] : end);
        assert.equal(h.object.nativeTextState.endKnown, type !== 'NVSTRING');
        assert.equal(h.world.graphics.get(h.object.nativeTaskID).text.writer, null);
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        await h.world.close();
      }
    });

    if (type !== 'NVSTRING')
      test(`${profile}: post-first ${type} consumes guarded profile and shift commands through its null-writer receiver`, async () => {
        const h = await setup(profile, type);
        try {
          await redeclare(h, type);
          await h.task.syncObjects();
          const before = h.oldWriter.snapshot();
          await h.task.player.notify('GUARDED');
          await h.task.syncObjects();
          assert.deepEqual(h.object.nativeTextState.layout.profiles, {});
          assert.deepEqual(h.oldWriter.snapshot(), before);
          assert.equal(h.world.graphics.get(h.object.nativeTaskID).text.writer, null);
          assert.equal(h.object.nativeTextState.endKnown, true);
        } finally {
          await h.world.close();
        }
      });
  }

for (const profile of profiles) {
  test(`${profile}: actual first SIZE2 producers preserve plain/NV axes before the real writer query replaces them`, async () => {
    for (const type of types(profile)) {
      const observed = [],
        h = await setup(profile, type, {
          definition: '#OBJECT SIZE2\ntext area:0',
          beforeLoad(world) {
            const create = world.text.create.bind(world.text);
            world.text.create = (record) => {
              const task = create(record),
                message = task.message.bind(task);
              task.message = (words, context = {}) => {
                if (words[1] === task.firstMessage + (record.kind === 49 ? 12 : 11)) {
                  const root = world.objects.objects.get(record.parent).implementation.player.root,
                    object = root.collection.lookup('text', 0);
                  observed.push([...root.runtime.strings.workspace(object).cursor]);
                }
                return message(words, context);
              };
              return task;
            };
          },
        });
      try {
        assert.deepEqual(observed[0], type === 'NVSTRING' ? [24, 16] : [16, 24]);
        assert.deepEqual([h.object.width, h.object.height], [24, 16]);
        assert.deepEqual(h.object.nativeTextState.end, await h.oldWriter.endPosition());
        assert.equal(h.object.nativeTextState.endKnown, true);
        assert.equal(h.world.nativeEngine, undefined);
      } finally {
        await h.world.close();
      }
    }
  });

  test(`${profile}: post-first NV section and redraw preserve the explicit original null-writer error boundary`, async () => {
    const h = await setup(profile, 'NVSTRING');
    try {
      await redeclare(h, 'NVSTRING');
      await h.task.syncObjects();
      await h.task.player.notify('INSERT');
      await assert.rejects(h.task.syncObjects(), /NV section requires an initialized writer/);
      assert.equal(h.object.nativeTextState.section, true);
      await assert.rejects(
        h.world.sendEngine(h.object.nativeTaskID, h.id, 506),
        /NV redraw requires an initialized writer/,
      );
      assert.equal(h.world.graphics.get(h.object.nativeTaskID).text.writer, null);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });

  test(`${profile}: FES category clear obeys its frozen driver capability`, async () => {
    const h = await setup(profile, 'STRING');
    try {
      const bytes = Uint8Array.of(65, 66, 67, 0);
      await h.world.sendEngine(h.object.nativeTaskID, h.id, 465, 2, 0, {
        payload: { bytes: (at, length) => bytes.subarray(at, at + length) },
      });
      const before = [...h.oldWriter.parser.profiles[2]];
      for (const code of [65, 66, 67]) assert.ok(before.includes(code));
      await h.task.player.notify('CLEARPROFILE');
      await h.task.syncObjects();
      assert.deepEqual([...h.oldWriter.parser.profiles[2]], profile === profiles[0] ? before : []);
      assert.equal(h.world.nativeEngine, undefined);
    } finally {
      await h.world.close();
    }
  });
}
