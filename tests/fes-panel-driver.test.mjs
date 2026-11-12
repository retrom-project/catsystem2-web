// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageWorld, setupImages, imageObject, profiles } from './fixtures/fes-panel-world.mjs';
import { hg3 } from './helpers.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { setFESImageTable, fesImageFrameID } from '../src/native/fes-image-model.mjs';
import { initializeFESPlane } from '../src/native/fes-object-factory.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  setFESPanelFile,
  setFESPanelDisplayID,
  fesPanelPart,
  readFESPanelType,
  readFESPanelSelector,
  setFESSavePanelType,
  setFESPanelNumber,
  fesSavePanelFlag,
  setFESPanelUserFont,
  readFESPanelUserFont,
} from '../src/native/fes-panel-model.mjs';

const glyphs = {
  measure: (_font, text) => ({
    width: text.length * 4,
    height: 8,
    ascent: 6,
    descent: 2,
    averageWidth: 4,
    maximumWidth: 8,
  }),
  glyph: () => ({
    width: 4,
    height: 6,
    originX: 0,
    originY: 6,
    advanceX: 4,
    advanceY: 0,
    alpha: new Uint8Array(24).fill(255),
  }),
};
const evaluate = (source) => Number(source),
  reference = (source) => ({
    name: String(source),
    nameBytes: encodeCP932(String(source)),
    index: 0,
  }),
  readType = (tokens) => readFESPanelType(tokens, { evaluate, reference });
function atlas() {
  const frames = Array.from({ length: 10 }, (_, id) => {
      const bytes = hg3(
          2,
          2,
          Uint8Array.from(Array.from({ length: 4 }, () => [id * 30, 0, 150, 255]).flat()),
        ),
        view = new DataView(bytes.buffer);
      view.setUint32(16, id, true);
      view.setUint32(36 + 20, 8, true);
      view.setUint32(36 + 24, 8, true);
      return bytes;
    }),
    output = new Uint8Array(12 + frames.reduce((n, b) => n + b.length - 12, 0));
  output.set(frames[0].subarray(0, 12));
  let at = 12;
  frames.forEach((bytes, index) => {
    output.set(bytes.subarray(12), at);
    new DataView(output.buffer).setUint32(
      at,
      index === frames.length - 1 ? 0 : bytes.length - 12,
      true,
    );
    at += bytes.length - 12;
  });
  return output;
}
function resourceExpected(rgba, width = 2, height = 2) {
  const bytes = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 0; y < height; y++) {
    bytes.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), (8 - height + y) * 32);
    bytes.set(
      [...rgba.subarray(((y + 1) * width - 1) * 4, ((y + 1) * width - 1) * 4 + 3), 0],
      (8 - height + y) * 32 + width * 4,
    );
  }
  return bytes;
}
const solid = (red) => Uint8Array.from(Array.from({ length: 4 }, () => [red, 0, 150, 255]).flat());
function textExpected(color, firstY, height) {
  const bytes = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = firstY; y < firstY + height; y++)
    for (let x = 1; x <= 4; x++) bytes.set(color, (y * 8 + x) * 4);
  return bytes;
}
async function pixels(world, object) {
  return (await world.graphics.images.get(object.imageResource.bitmap).pixels()).slice();
}
async function cssStore() {
  const files = new Map(),
    reads = [],
    modifiedMs = Date.UTC(2025, 3, 18, 11, 23, 45),
    storage = {
      read: async (name) => {
        reads.push(name);
        return files.get(name) ?? null;
      },
      write: async (name, bytes) => {
        files.set(name, bytes.slice());
        return true;
      },
      stat: async (name) => (files.has(name) ? { modifiedMs } : null),
    };
  const file = new NativeGlobalFile(),
    flags = new Uint32Array(1024);
  flags[5] = 617;
  file.write(0x400, new Uint8Array(flags.buffer));
  const thumbnail = Uint8Array.of(
    17,
    33,
    67,
    255,
    71,
    39,
    19,
    255,
    55,
    12,
    99,
    255,
    31,
    80,
    40,
    255,
  );
  file.write(0x100, hg3(2, 2, thumbnail));
  file.write(0x200, Uint8Array.from([...encodeCP932('7'), 0]));
  files.set('save0007.dat', await file.file());
  return { files, reads, storage, thumbnail };
}
test('ptype reads each original argument once and preserves its frozen ignored branches', () => {
  const image = { idIndex: 1, usesIDTable: true, ids: [70, 80, 90] };
  assert.equal(fesImageFrameID(image), 80);
  assert.equal(fesImageFrameID(image, 2), 90);
  assert.equal(fesImageFrameID(image, -1), 0);
  assert.equal(fesImageFrameID(image, 32), 0);
  assert.equal(image.idIndex, 1);
  assert.equal(fesImageFrameID({ ...image, usesIDTable: false }, -1), 0xffffffff);
  const calls = [],
    parsed = readFESPanelType(
      ['SSTR', '10', 'FLAG.5:10', '4', '8', '0xabcdef', '3', '0x123456', '2', '1', 'face'],
      {
        evaluate(source) {
          calls.push(source);
          return Number(source);
        },
        reference,
      },
    );
  assert.deepEqual(calls, ['10', '5', '10', '4', '8', '0xabcdef', '3', '0x123456', '2', '1']);
  assert.deepEqual(parsed.definition.styles, [1, 1]);
  assert.equal(parsed.definition.flag, 5);
  assert.equal(parsed.definition.digits, 10);
  assert.equal(parsed.definition.color, 0xabcdef);
  assert.equal(parsed.definition.columns, 8);
  assert.equal(readType(['IMAGE', '0', 'ignored-resource']).definition.bitmap, 0);
  assert.equal(readType(['NUM_S', '0', 'ignored', 'more']).definition.fontSize, 0);
  assert.equal(readType(['NUM_I', '0', 'ignored', 'more']).definition.reference, null);
  assert.equal(readType(['SSTR', '0', '0x200', '4']), null);
  assert.equal(readType(['unknown', '0']), null);
  assert.deepEqual(readFESPanelSelector('DATE_Y', evaluate), {
    selector: 0,
    flag: 0,
    digits: -1,
    constant: 0,
  });
  const partial = [];
  assert.equal(
    readFESPanelType(['SSTR', '1', 'FLAG.5:10', '4'], {
      evaluate: (token) => {
        partial.push(token);
        return Number(token);
      },
      reference,
    }),
    null,
  );
  assert.deepEqual(
    partial,
    ['1', '5', '10', '4'],
    'incomplete ptype keeps already performed expression effects',
  );
  const font = readFESPanelUserFont(['65537', 'picture', '65591', '2'], evaluate);
  assert.equal(font.id, 1);
  assert.equal(font.specification.code, 55);
  assert.equal(font.specification.frame, 2);
  assert.deepEqual(
    readFESPanelUserFont(['0', 'picture', '55', '1', '2', '3', '4'], evaluate).specification,
    { file: 'picture', code: 55, x: 1, y: 2, width: 3, height: 4, frame: -1 },
  );
});
for (const profile of profiles) {
  test(`${profile} PANEL lazily allocates its true canvas, does not invent parts and composes actual NORM pixels`, async () => {
    const world = await imageWorld(profile, { 'authored.hg3': atlas() });
    try {
      const { api, draw } = await setupImages(world),
        object = imageObject(api, 11, 'panel', {
          renderID: 10,
          pri: 30,
          x: 2,
          y: 3,
          disp: true,
          displayValue: 1,
        });
      assert.equal(object.width, -1);
      assert.equal(object.sizeDirty, false);
      await api.images.update(api.instance, object, { restoring: true });
      assert.equal(object.imageResource, undefined);
      setFESPanelFile(object, 'authored');
      await api.images.initialize(api.instance, object);
      assert.equal(api.cache.entries.size, 0);
      assert.equal(object.imageResource.bitmap, 0);
      setFESPanelDisplayID(object, 3);
      setFESPanelDisplayID(object, 1);
      setFESPanelDisplayID(object, 3);
      assert.deepEqual(object.panel.displayIDs, [1, 3]);
      assert.equal(
        setFESSavePanelType(object, readType(['NORM', '3'])),
        false,
        'frozen ptype does not apply to PANEL',
      );
      await api.images.update(api.instance, object);
      assert.deepEqual([object.width, object.height], [8, 8]);
      assert.deepEqual(await pixels(world, object), new Uint8ClampedArray(256));
      fesPanelPart(object, 3, true).kind = 0;
      setFESPanelDisplayID(object, 3);
      await api.images.update(api.instance, object);
      assert.deepEqual(await pixels(world, object), resourceExpected(solid(90)));
      const bitmap = object.imageResource.bitmap;
      await api.images.update(api.instance, object);
      assert.equal(object.imageResource.bitmap, bitmap);
      await draw.render();
      assert.ok(draw.state.renderer.items.length);
      setFESPanelFile(object, 'authored');
      assert.equal(object.sizeDirty, true, 'same FILE still explicitly resizes PANEL');
      await api.images.update(api.instance, object);
      assert.notEqual(object.imageResource.bitmap, bitmap);
      assert.ok(!world.nativeEngine);
    } finally {
      await world.close();
    }
  });
  test(`${profile} SAVEPANEL executes all ten ptype branches using real CSS, text glyphs and private flags then restores complete composites`, async () => {
    const storage = await cssStore(),
      files = { 'authored.hg3': atlas() },
      world = await imageWorld(profile, files, true, { storage: storage.storage, glyphs });
    let fresh;
    try {
      world.runtime.services.localOffsetMinutes = () => 0;
      const { api, id } = await setupImages(world),
        digits = imageObject(api, 2, 'digits');
      digits.file = 'authored';
      const kinds = [
          ['NORM'],
          ['IMAGE', 'ignored:4'],
          ['SIMAGE', '0x100'],
          ['IMAGEOBJ', 'digits'],
          ['STR', '7', '4', '8', '0xffffff', '0', '0'],
          ['SSTR', '0x200', '4', '8', '0xffffff', '0', '0'],
          ['NUM_S', '11', '4', '8', '0xffffff', '0', '0'],
          ['NUM_O', 'digits', '3'],
          ['NUM_O2', 'digits', '3'],
          ['NUM_I', 'digits', '3'],
        ],
        objects = [];
      for (const [index, [kind, ...args]] of kinds.entries()) {
        const object = imageObject(api, 12, 'saved' + index, {
          renderID: 20 + index,
          pri: 40 + index,
          disp: true,
          displayValue: 1,
        });
        objects.push(object);
        setFESPanelFile(object, 'authored');
        assert.equal(setFESSavePanelType(object, readType([kind, '0', ...args])), true);
        assert.equal(object.panel.parts.size, 0, 'ptype stores definition until setsave rebuild');
        await api.images.setSave(api.instance, object, 7, 0x400, 0);
        setFESPanelDisplayID(object, 0);
        await api.images.update(api.instance, object);
      }
      assert.equal(fesSavePanelFlag(objects[0], 5), 617);
      assert.equal(fesSavePanelFlag(objects[0], -1), 0);
      assert.equal(fesSavePanelFlag(objects[0], 1024), 0);
      assert.deepEqual(objects[0].panel.save.date, [2025, 4, 18, 11, 23, 45]);
      const results = await Promise.all(objects.map((object) => pixels(world, object))),
        expected = [
          resourceExpected(solid(0)),
          new Uint8ClampedArray(256),
          resourceExpected(storage.thumbnail),
          resourceExpected(solid(0)),
          new Uint8ClampedArray(256),
          textExpected([255, 255, 255, 255], 3, 5),
          textExpected([0, 0, 0, 255], 7, 1),
          resourceExpected(solid(90)),
          resourceExpected(solid(90)),
          new Uint8ClampedArray(256),
        ];
      results.forEach((actual, index) =>
        assert.deepEqual(actual, expected[index], kinds[index][0]),
      );
      const readCount = storage.reads.length;
      fresh = await imageWorld(profile, files, false, { storage: storage.storage, glyphs });
      await fresh.restore(structuredClone(world.snapshot()));
      const restored = fresh.objects.objects.get(id).implementation;
      for (const original of objects) {
        const object = restored.instance.byKey.get(original.key);
        await restored.images.update(restored.instance, object, { restoring: true });
        assert.deepEqual(await pixels(fresh, object), await pixels(world, original));
        assert.equal(object.imageResource.bitmap, original.imageResource.bitmap);
      }
      assert.equal(
        storage.reads.length,
        readCount,
        'fresh World does not reload CSS or rerun glyph composition',
      );
      assert.ok(!world.nativeEngine && !fresh.nativeEngine);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} SAVEPANEL preserves the previous CSS/flags on missing file and keeps owned image refs through part type changes`, async () => {
    const storage = await cssStore(),
      world = await imageWorld(profile, { 'authored.hg3': atlas() }, true, {
        storage: storage.storage,
      });
    try {
      const { api } = await setupImages(world),
        object = imageObject(api, 12, 'saved', {
          renderID: 4,
          pri: 24,
          disp: true,
          displayValue: 1,
        });
      setFESPanelFile(object, 'authored');
      setFESSavePanelType(object, readType(['SIMAGE', '0', '0x100']));
      await api.images.setSave(api.instance, object, 7, 0x400, 0);
      setFESPanelDisplayID(object, 0);
      await api.images.update(api.instance, object);
      const file = structuredClone(object.panel.save.file);
      assert.equal(await api.images.setSave(api.instance, object, 8, 0x400, 0), false);
      assert.deepEqual(object.panel.save.file, file);
      assert.deepEqual(object.panel.save.date, [0, 0, 0, 0, 0, 0]);
      assert.equal(fesSavePanelFlag(object, 5), 617);
      await api.images.update(api.instance, object);
      assert.deepEqual(await pixels(world, object), resourceExpected(storage.thumbnail));
      const handle = fesPanelPart(object, 0).bitmap;
      setFESSavePanelType(object, readType(['NUM_I', '0', 'ignored']));
      await api.images.rebuildSavedParts(api.instance, object);
      assert.equal(fesPanelPart(object, 0).bitmap, 0);
      assert.ok(object.panel.ownedBitmaps.has(handle));
      await api.images.update(api.instance, object);
      assert.deepEqual(await pixels(world, object), new Uint8ClampedArray(256));
      await api.images.close(object);
      assert.equal(world.runtime.handles.records.has(handle), false);
    } finally {
      await world.close();
    }
  });
  test(`${profile} SAVEPANEL numeric object selectors distinguish the ID table, direct ID and consumed setnum`, async () => {
    const storage = await cssStore(),
      world = await imageWorld(profile, { 'authored.hg3': atlas() }, true, {
        storage: storage.storage,
      });
    try {
      const { api } = await setupImages(world),
        digits = imageObject(api, 2, 'digits');
      digits.file = 'authored';
      setFESImageTable(digits, 3, 4);
      const normal = imageObject(api, 12, 'normal', {
          renderID: 5,
          pri: 25,
          disp: true,
          displayValue: 1,
        }),
        direct = imageObject(api, 12, 'direct', {
          renderID: 6,
          pri: 26,
          disp: true,
          displayValue: 1,
        });
      for (const [object, kind] of [
        [normal, 'NUM_O'],
        [direct, 'NUM_O2'],
      ]) {
        setFESPanelFile(object, 'authored');
        setFESSavePanelType(object, readType([kind, '0', 'digits', '3']));
        await api.images.setSave(api.instance, object, 7, 0x400, 0);
        setFESPanelDisplayID(object, 0);
        await api.images.update(api.instance, object);
      }
      assert.deepEqual(await pixels(world, normal), resourceExpected(solid(120)));
      assert.deepEqual(await pixels(world, direct), resourceExpected(solid(90)));
      assert.equal(setFESPanelNumber(normal, 0, 5), true);
      assert.equal(normal.imageChanged, true);
      await api.images.update(api.instance, normal);
      assert.deepEqual(await pixels(world, normal), resourceExpected(solid(150)));
      assert.equal(setFESPanelNumber(normal, 9, 2), false);
    } finally {
      await world.close();
    }
  });
  test(`${profile} PANEL image fonts use the same World glyph owner, first mapping and exact physical glyph canvas`, async () => {
    const world = await imageWorld(
      profile,
      {
        'authored.hg3': atlas(),
        'font.hg3': hg3(1, 1, Uint8Array.of(9, 80, 170, 255)),
        'font-b.hg3': hg3(2, 1, Uint8Array.of(9, 170, 80, 255, 200, 10, 20, 255)),
      },
      true,
      { glyphs },
    );
    try {
      const { api } = await setupImages(world),
        object = imageObject(api, 11, 'fontpanel', {
          renderID: 3,
          pri: 23,
          disp: true,
          displayValue: 1,
        });
      setFESPanelFile(object, 'authored');
      const part = fesPanelPart(object, 0, true);
      Object.assign(part, {
        kind: 3,
        text: encodeCP932('7'),
        fontSize: 4,
        color: 0xff0000,
        columns: 8,
        maxLines: 1,
      });
      setFESPanelUserFont(object, 0, { file: 'font', code: 55, frame: 0 });
      setFESPanelUserFont(object, 0, { file: 'font', code: 55, frame: 9 });
      setFESPanelDisplayID(object, 0);
      const runtime = await world.text.runtime();
      await api.images.update(api.instance, object);
      assert.equal(world.text.core, runtime);
      assert.equal(runtime.writers.size, 0);
      assert.equal(object.panel.userFontChanged, false);
      assert.deepEqual(await pixels(world, object), textExpected([9, 80, 170, 255], 3, 4));
      const glyph = object.imageResource.panelGlyphBitmap,
        source = object.imageResource.bitmap;
      setFESPanelDisplayID(object, 0);
      await api.images.update(api.instance, object);
      assert.equal(object.imageResource.panelGlyphBitmap, glyph);
      assert.equal(object.imageResource.bitmap, source);
      part.userFonts = [];
      setFESPanelUserFont(object, 0, {
        file: 'font',
        code: 55,
        frame: -1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      });
      setFESPanelUserFont(object, 0, {
        file: 'font-b',
        code: 55,
        frame: -1,
        x: 1,
        y: 0,
        width: 1,
        height: 1,
      });
      setFESPanelDisplayID(object, 0);
      await api.images.update(api.instance, object);
      // The pinned D6 bilinear kernel includes the neighboring source texel;
      // these exact 15-bit weights also expose the physical glyph row order.
      const expectedSprite = new Uint8ClampedArray(256),
        rows = [
          [9, 170, 80, 255, 20, 160, 76, 255, 32, 150, 72, 255, 44, 140, 68, 255],
          [9, 170, 80, 255, 32, 150, 72, 255, 56, 130, 65, 255, 80, 110, 57, 255],
          [9, 170, 80, 255, 44, 140, 68, 255, 80, 110, 57, 255, 116, 80, 46, 255],
          [9, 170, 80, 255, 56, 130, 65, 255, 104, 90, 50, 255, 152, 50, 35, 255],
        ];
      rows.forEach((row, index) => expectedSprite.set(row, ((index + 3) * 8 + 1) * 4));
      assert.deepEqual(
        await pixels(world, object),
        expectedSprite,
        'sprite cells retain the first rectangle but share the final copied font canvas',
      );
      assert.ok(!world.nativeEngine);
    } finally {
      await world.close();
    }
  });
  test(`${profile} PANEL uses the original text wrap/color and local image position plus PLANE VRAM origin`, async () => {
    const world = await imageWorld(profile, { 'authored.hg3': atlas() }, true, { glyphs });
    try {
      const { api, draw, id } = await setupImages(world),
        parent = imageObject(api, 2, 'parent', { x: 5, y: 6 }),
        object = imageObject(api, 11, 'panel', {
          renderID: 8,
          pri: 28,
          x: 2,
          y: 3,
          baseX: 1,
          baseY: 1,
          parentHandle: parent.handle,
          disp: true,
          displayValue: 1,
        }),
        plane = initializeFESPlane({ nativeType: 4, key: 'plane', handle: 0x2000 });
      Object.assign(plane, { x: 100, y: 200, vramX: 3, vramY: 4, width: 20, height: 15 });
      api.instance.objects.push(plane);
      api.instance.byKey.set('plane', plane);
      object.planeReference = { name: 'plane', index: 0 };
      setFESPanelFile(object, 'authored');
      const part = fesPanelPart(object, 0, true);
      Object.assign(part, {
        kind: 3,
        text: encodeCP932('ABC'),
        fontSize: 4,
        color: 0xff0000,
        columns: 1,
        maxLines: 2,
        lineSpacing: 1,
      });
      setFESPanelDisplayID(object, 0);
      await api.images.update(api.instance, object);
      assert.deepEqual(await pixels(world, object), textExpected([255, 0, 0, 255], 0, 8));
      const entry = draw.entry((world.nativeTaskID(id) | (8 << 16)) >>> 0);
      assert.deepEqual(entry.position, [9, 12]);
      assert.deepEqual(entry.base, [1, 1]);
      assert.deepEqual(entry.clip, [3, 4, 23, 19]);
      await draw.render();
      assert.ok(!world.nativeEngine);
    } finally {
      await world.close();
    }
  });
  test(`${profile} SAVEPANEL scaled SIMAGE uses actual dimensions, default minus-one crop and explicit physical rectangle`, async () => {
    const storage = await cssStore(),
      file = await NativeGlobalFile.fromFile(storage.files.get('save0007.dat'));
    file.write(0x101, hg3(1, 1, Uint8Array.of(23, 61, 109, 255)));
    storage.files.set('save0007.dat', await file.file());
    const world = await imageWorld(profile, { 'authored.hg3': atlas() }, true, {
      storage: storage.storage,
    });
    try {
      const { api } = await setupImages(world),
        object = imageObject(api, 12, 'scaled', {
          renderID: 4,
          pri: 24,
          disp: true,
          displayValue: 1,
        });
      setFESPanelFile(object, 'authored');
      const definition = readType(['SIMAGE', '0', '0x101', '5', '4']);
      assert.deepEqual(definition.definition.crop, [0, 0, 4, 3]);
      setFESSavePanelType(object, definition);
      await api.images.setSave(api.instance, object, 7, 0x400, 0);
      setFESPanelDisplayID(object, 0);
      await api.images.update(api.instance, object);
      // Constant RGB loses one at the non-integral weight sums. Preserve
      // those exact native D6 values while checking the PANEL crop wiring.
      const original = [23, 61, 109, 255],
        truncated = [22, 60, 108, 255];
      assert.deepEqual(
        await pixels(world, object),
        resourceExpected(
          Uint8Array.from(
            [
              original,
              truncated,
              original,
              truncated,
              original,
              truncated,
              truncated,
              truncated,
              original,
              original,
              original,
              original,
            ].flat(),
          ),
          4,
          3,
        ),
      );
      setFESSavePanelType(object, readType(['SIMAGE', '0', '0x101', '5', '4', '1', '1', '2', '1']));
      await api.images.rebuildSavedParts(api.instance, object);
      await api.images.update(api.instance, object);
      assert.deepEqual(
        await pixels(world, object),
        resourceExpected(Uint8Array.of(22, 60, 108, 255, 22, 60, 108, 255), 2, 1),
      );
    } finally {
      await world.close();
    }
  });
}
