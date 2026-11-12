// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { append, files } from './fixtures/fes-log-model.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeFESTextLayout, fesConfigurationFontBytes } from '../src/native/fes-text-layout.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { hg3, u32 } from './helpers.mjs';

const utf8 = (text) => new TextEncoder().encode(text),
  join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]));
function wide(text) {
  return Uint8Array.from(
    [...text]
      .flatMap((char) => [char.charCodeAt(0) & 255, char.charCodeAt(0) >>> 8])
      .concat([0, 0]),
  );
}
const expectedFace = (profile, text) =>
  profile === profiles[0] ? join(encodeCP932(text), Uint8Array.of(0)) : wide(text);
function faces(world, object) {
  const state = object.nativeTextState,
    abi = nativeABI(world.profile),
    length = abi.text.fesLayouts[object.nativeType === 37 ? 37 : 21].fontBytes;
  if (state.layout) return [state.layout.bytes.slice(892, 892 + length)];
  const second = 24 + abi.layouts.textCores.cp932.configSize + 16;
  return [24, second].map((offset) => state.nv.slice(offset + 128, offset + 128 + length));
}
async function writerFaces(world, object) {
  const writer = await world.graphics.get(object.nativeTaskID).writer(),
    abi = nativeABI(world.profile),
    length = abi.text.fesLayouts[object.nativeType === 37 ? 37 : 21].fontBytes;
  return object.nativeType === 29
    ? [24, 24 + abi.layouts.textCores.cp932.configSize + 16].map((offset) =>
        writer.config.slice(offset + 128, offset + 128 + length),
      )
    : [writer.config.slice(128, 128 + length)];
}
function assertFace(actual, expected) {
  for (const face of actual) assert.deepEqual(face.subarray(0, expected.length), expected);
}
async function restoreFontWorld(profile, saved) {
  const world = await defaultFESWorld(profile, {}, { initialize: false }),
    read = world.game.read.bind(world.game);
  world.game.read = (name) => {
    if (name !== 'case.kcs') throw new Error(`reset font restore read ${name}`);
    return read(name);
  };
  try {
    await world.restore(saved);
    return world;
  } catch (error) {
    await world.close();
    throw error;
  }
}
function regions() {
  const frame = hg3(24, 16, new Uint8Array(24 * 16 * 4)),
    output = new Uint8Array(frame.length * 2 - 12),
    view = new DataView(output.buffer);
  output.set(frame);
  output.set(frame.subarray(12), frame.length);
  view.setUint32(12, frame.length - 12, true);
  view.setUint32(frame.length + 4, 1, true);
  return output;
}

test('font setters consume one owned narrow CString and current Settings supplies exact bytes', () => {
  for (const profile of profiles) {
    const configuration = new NativeConfiguration({ profile }),
      layout = new NativeFESTextLayout({ profile, type: 21 }),
      source = Buffer.from(join(encodeCP932('猫 EXTRA'), Uint8Array.of(0), utf8('ignored')));
    layout.apply('fontind', [7, source]);
    source.fill(0);
    assert.equal(layout.fontName(), '猫 EXTRA');
    assert.equal(layout.word(layout.abi.fontIndex), 7);
    layout.apply('font', [new Uint8Array()]);
    assert.equal(layout.fontName(), '');
    configuration.fields.font.name = 'Current Face';
    layout.apply('font', [], Number, {
      fontBytes: () => fesConfigurationFontBytes(profile, configuration),
    });
    assert.equal(layout.fontName(), 'Current Face');
    const owned = fesConfigurationFontBytes(profile, configuration);
    configuration.fields.data.fill(0, 0, 4);
    assert.deepEqual(owned, utf8('Current Face'));
    assert.equal(Object.getPrototypeOf(owned), Uint8Array.prototype);
    layout.apply('font', [Uint8Array.of(0xc2, 0xa5)]);
    assert.equal(layout.fontName(), 'ﾂ･');
    assert.throws(() => layout.apply('font'), /complete narrow face bytes/);
  }
  const configuration = new NativeConfiguration({ profile: profiles[0] });
  configuration.fields.data.set([0x87, 0x90, 0]);
  assert.deepEqual(
    fesConfigurationFontBytes(profiles[0], configuration),
    Uint8Array.of(0x87, 0x90),
  );
});

for (const profile of profiles) {
  test(`${profile}: default font tails preserve bytes across real mixed slots, holes, D5 and fresh restore`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': join(
        utf8(
          '#DEFINE\nSTRING mixed[4]\n#OBJECT SIZE\nmixed 24,16\n#START\nnext IDLE\n#IDLE\n#FACE\nmixed layout fontind ++$10 ',
        ),
        encodeCP932('猫 EXTRA'),
        utf8(
          '\nbreak\n#LITERAL\nmixed layout font $str1 X  EXTRA\nbreak\n#QUOTED\nmixed layout font ""\nbreak\n#DEFAULT\nmixed layout fontind ++$10\nbreak\n#HOLE\nmixed[1] layout fontind ++$10 IGNORED\nbreak\n#RESET\nmixed reset\nbreak\n',
        ),
      ),
    });
    let fresh, resetFresh;
    try {
      world.configuration.fields.font.name = 'Initial Face';
      const h = await loadDefaultFES(world),
        { instance } = h;
      assert.deepEqual(instance.program.blocks.LITERAL[0], utf8('mixed layout font $str1 X EXTRA'));
      for (const [index, type] of [
        [2, 'NVSTRING'],
        [3, profile === profiles[1] ? 'STRING8' : 'VIEW'],
      ]) {
        await instance.collection.remove(instance.collection.lookup('mixed', index));
        instance.createObjects(FES_OBJECT_DEFINITION_ORDER.indexOf(type), 'mixed', index + 1);
      }
      await instance.collection.remove(instance.collection.lookup('mixed', 1));
      await instance.applyObjects('#OBJECT SIZE', 'mixed 24,16');
      await h.task.syncObjects();
      const objects = instance.objects.filter((object) => [21, 29, 37].includes(object.nativeType)),
        nv = objects.find((object) => object.nativeType === 29),
        oldNV = faces(world, nv);
      assertFace(oldNV, expectedFace(profile, 'Initial Face'));
      assert.equal(nv.nativeTextState.nvFontDefault, true);
      const bank = world.runtime.stringBank(world.objects.objects.get(world.main.id));
      bank.setBytes(1, utf8('REPLACED'));
      world.configuration.scriptReplacements.add(utf8('X'), utf8('XX'));
      for (const [label, text, reads] of [
        ['FACE', '猫 EXTRA', 1],
        ['LITERAL', '$str1 X EXTRA', 0],
        ['QUOTED', '""', 0],
        ['DEFAULT', 'Current Face', 1],
      ]) {
        world.configuration.fields.font.name = 'Current Face';
        instance.setGlobal(10, 0);
        await h.task.player.notify(label);
        assert.equal(instance.global(10), reads);
        await h.task.syncObjects();
        for (const object of objects) {
          const actual = faces(world, object);
          if (profile === profiles[1] && object === nv) assert.deepEqual(actual, oldNV);
          else assertFace(actual, expectedFace(profile, text));
          assert.deepEqual(await writerFaces(world, object), actual);
        }
      }
      assert.equal(nv.nativeTextState.nvFontDefault, false);
      if (profile === profiles[0]) {
        // Two CP932 byte spellings can decode to the same Unicode name.
        // The original narrow Settings block is copied without that round trip.
        world.configuration.fields.data.set([0x87, 0x90, 0]);
        await h.task.player.notify('DEFAULT');
        await h.task.syncObjects();
        for (const object of objects) {
          assertFace(faces(world, object), Uint8Array.of(0x87, 0x90, 0));
          assertFace(await writerFaces(world, object), Uint8Array.of(0x87, 0x90, 0));
        }
      }
      instance.setGlobal(10, 0);
      await h.task.player.notify('HOLE');
      assert.equal(instance.global(10), 1);
      const savedFaces = objects.map((object) => faces(world, object));
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (name !== 'case.kcs') throw new Error(`font restore read ${name}`);
        return read(name);
      };
      await fresh.restore(world.snapshot());
      const task = fresh.objects.objects.get(h.id).implementation;
      await task.syncObjects();
      for (let at = 0; at < objects.length; at++) {
        const object = task.player.root.collection.graph.get(objects[at].handle);
        assert.deepEqual(faces(fresh, object), savedFaces[at]);
        assert.deepEqual(await writerFaces(fresh, object), savedFaces[at]);
        if (object.nativeType === 29) assert.equal(object.nativeTextState.nvFontDefault, false);
      }
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
      await h.task.player.notify('RESET');
      for (const object of objects) {
        if (object.nativeType === 29) assert.equal(object.nativeTextState.nvFontDefault, true);
        else {
          const layout = h.instance.runtime.strings.layout(object);
          assert.deepEqual(
            [-1, 0, 1, 2].map((at) => layout.word(layout.abi.flags + at)),
            [1, 1, 1, 1],
          );
        }
      }
      resetFresh = await restoreFontWorld(profile, world.snapshot());
      const resetTask = resetFresh.objects.objects.get(h.id).implementation;
      await resetTask.syncObjects();
      for (const object of objects) {
        const restored = resetTask.player.root.collection.graph.get(object.handle),
          layout = resetTask.player.root.runtime.strings.layout(restored);
        if (layout)
          assert.deepEqual(
            [-1, 0, 1, 2].map((at) => layout.word(layout.abi.flags + at)),
            [1, 1, 1, 1],
          );
        else assert.equal(restored.nativeTextState.nvFontDefault, true);
        assert.deepEqual(await writerFaces(resetFresh, restored), faces(world, object));
      }
      assert.equal(resetFresh.nativeEngine, undefined);
    } finally {
      await resetFresh?.close();
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile}: prepared font tails retain spaces through the real source decoder`, async () => {
    const body = utf8(
        '#DEFINE\nSTRING text\n#OBJECT SIZE\ntext 24,16\n#START\ntext layout font Face  EXTRA  \nnext IDLE\n#IDLE\n',
      ),
      compressed = deflateSync(body),
      world = await defaultFESWorld(profile, {
        'screen.fes': join(
          utf8('FES\0'),
          Uint8Array.from([...u32(compressed.length), ...u32(body.length), ...u32(0)]),
          compressed,
        ),
      });
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      assertFace(
        faces(world, h.instance.collection.lookup('text', 0)),
        expectedFace(profile, 'Face  EXTRA  '),
      );
    } finally {
      await world.close();
    }
  });

  for (const type of profile === profiles[0] ? ['LOGSTRING'] : ['LOGSTRING', 'LOGSTRING8'])
    test(`${profile}: default ${type} font commands preserve their main and secondary gates`, async () => {
      const world = await defaultFESWorld(profile, {
        ...files,
        'area.hg3': regions(),
        'screen.fes': utf8(
          `#DEFINE\n${type} log\n#OBJECT COUNT POS2 SIZE2 PRI\nlog 2 area:0 area:0 60000\n#START\nnext IDLE\n#IDLE\n#BIND\nlog setlog $0\nbreak\n#FONT\nlog layout font Main Both EXTRA\nbreak\n#INDEX\nlog layout fontind ++$10 Main Only EXTRA\nbreak\n#SECOND\nlog layout fontind_sub ++$10 Secondary Only EXTRA\nbreak\n#RESET\nlog reset\nbreak\n`,
        ),
      });
      let fresh, resetFresh;
      try {
        const h = await loadDefaultFES(world);
        await h.task.syncObjects();
        await h.task.syncObjects();
        const object = h.instance.collection.lookup('log', 0),
          log = world.displayLogs.create(h.id),
          model = world.displayLogs.get(log),
          slots = object.slots.map((slot) => ({
            main: h.instance.collection.graph.get(slot.main),
            secondary:
              slot.secondary === null ? null : h.instance.collection.graph.get(slot.secondary),
          }));
        append(world.displayLogs, model, 'A');
        append(world.displayLogs, model, 'B');
        h.instance.setGlobal(0, log);
        await h.task.player.notify('BIND');
        await h.task.player.notify('FONT');
        await h.task.syncObjects();
        for (const slot of slots) {
          assertFace(faces(world, slot.main), expectedFace(profile, 'Main Both EXTRA'));
          if (slot.secondary)
            assertFace(faces(world, slot.secondary), expectedFace(profile, 'Main Both EXTRA'));
        }
        h.instance.setGlobal(10, 0);
        await h.task.player.notify('INDEX');
        assert.equal(h.instance.global(10), 1);
        await h.task.syncObjects();
        for (const slot of slots) {
          assertFace(await writerFaces(world, slot.main), expectedFace(profile, 'Main Only EXTRA'));
          if (slot.secondary)
            assertFace(
              await writerFaces(world, slot.secondary),
              expectedFace(profile, 'Main Both EXTRA'),
            );
        }
        h.instance.setGlobal(10, 0);
        await h.task.player.notify('SECOND');
        assert.equal(h.instance.global(10), profile === profiles[1] ? 1 : 0);
        await h.task.syncObjects();
        for (const slot of slots) {
          assertFace(faces(world, slot.main), expectedFace(profile, 'Main Only EXTRA'));
          if (slot.secondary)
            assertFace(
              await writerFaces(world, slot.secondary),
              expectedFace(profile, 'Secondary Only EXTRA'),
            );
        }
        fresh = await defaultFESWorld(profile, {}, { initialize: false });
        const read = fresh.game.read.bind(fresh.game);
        fresh.game.read = (name) => {
          if (name !== 'case.kcs') throw new Error(`LOG font restore read ${name}`);
          return read(name);
        };
        await fresh.restore(world.snapshot());
        const task = fresh.objects.objects.get(h.id).implementation;
        await task.syncObjects();
        for (const slot of slots)
          for (const child of [slot.main, slot.secondary]) {
            if (!child) continue;
            const restored = task.player.root.collection.graph.get(child.handle);
            assert.deepEqual(faces(fresh, restored), faces(world, child));
            assert.deepEqual(await writerFaces(fresh, restored), await writerFaces(world, child));
          }
        assert.equal(world.nativeEngine, undefined);
        assert.equal(fresh.nativeEngine, undefined);
        await h.task.player.notify('RESET');
        for (const slot of slots)
          for (const child of [slot.main, slot.secondary]) {
            if (!child) continue;
            const layout = h.instance.runtime.strings.layout(child);
            assert.deepEqual(
              [-1, 0, 1, 2].map((at) => layout.word(layout.abi.flags + at)),
              [1, 1, 1, 1],
            );
          }
        resetFresh = await restoreFontWorld(profile, world.snapshot());
        const resetTask = resetFresh.objects.objects.get(h.id).implementation;
        await resetTask.syncObjects();
        for (const slot of slots)
          for (const child of [slot.main, slot.secondary]) {
            if (!child) continue;
            const restored = resetTask.player.root.collection.graph.get(child.handle),
              layout = resetTask.player.root.runtime.strings.layout(restored);
            assert.deepEqual(
              [-1, 0, 1, 2].map((at) => layout.word(layout.abi.flags + at)),
              [1, 1, 1, 1],
            );
            assert.deepEqual(await writerFaces(resetFresh, restored), faces(world, child));
          }
        assert.equal(resetFresh.nativeEngine, undefined);
      } finally {
        await resetFresh?.close();
        await fresh?.close();
        await world.close();
      }
    });
}
