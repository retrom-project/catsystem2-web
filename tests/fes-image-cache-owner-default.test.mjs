// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CatSystem2 } from '../src/engine.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { hg3 } from './helpers.mjs';
import {
  startupProfiles,
  StartupCanvas,
  startupEnvironment,
  ordinaryStartupGame,
} from './fixtures/ordinary-startup.mjs';

const ascii = (source) => new TextEncoder().encode(source),
  name = 'assets.int/tile.hg3',
  raw = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9),
  pixels = Uint8Array.of(17, 34, 51, 255, 90, 120, 150, 255),
  encoded = hg3(2, 1, pixels),
  windowFixture = JSON.parse(
    await readFile(new URL('./fixtures/fes-window-image.json', import.meta.url)),
  ),
  defaultSource = '#START\nbreak\n';

async function environment(profile, files = {}) {
  const scope = startupEnvironment();
  let player;
  try {
    const template = await ordinaryStartupGame(profile, {
        sound: false,
        files: Object.fromEntries(
          Object.entries({
            [name]: encoded,
            'assets.int/screen.fes': ascii(defaultSource),
            ...files,
          }).map(([file, bytes]) => [file.replace(/^assets\.int\//, 'assets/'), bytes]),
        ),
      }),
      startup = await template.require('startup.xml'),
      marker = ascii('</INT>'),
      at = startup.findIndex((_, index) =>
        marker.every((byte, offset) => startup[index + offset] === byte),
      ),
      mounts = ascii(
        '<int02><name>fes</name><int>assets.int</int><ext>fes</ext><dir>assets</dir></int02><int03><name>image</name><int>assets.int</int><ext>hg3</ext><dir>assets</dir></int03>',
      ),
      source = new Uint8Array(startup.length + mounts.length);
    assert.ok(at >= 0);
    source.set(startup.subarray(0, at));
    source.set(mounts, at);
    source.set(startup.subarray(at), at + mounts.length);
    const input = new Map(template.input);
    input.set('startup.xml', new BlobFile(new Blob([source])));
    const game = new GameFiles(input);
    await game.open();
    player = new CatSystem2({
      game,
      nativeProfile: profile,
      canvas: new StartupCanvas(),
      randomSeed: 77,
      audioContext: { currentTime: 0, close: async () => {} },
      uiLanguage: 0x409,
      transitionalExe: {
        open() {
          throw new Error('Cache owner must not open the original');
        },
      },
    });
    await player.initialize();
    assert.equal(player.world.frame, 1);
    assert.equal(player.world.runtime.variableBank(player.world.main, false).get(7), 0x12345678);
    assert.equal(player.world.nativeEngine, undefined);
    return {
      player,
      world: player.world,
      game,
      async close() {
        try {
          await player.dispose();
        } finally {
          scope.restore();
        }
      },
    };
  } catch (error) {
    try {
      await player?.dispose();
    } finally {
      scope.restore();
    }
    throw error;
  }
}
async function task(world, source = 'assets.int/screen.fes', { load = true } = {}) {
  const owner = world.main.id,
    parent = world.objects.objects.get(owner);
  world.runtime.stringBank(parent);
  const id = await world.objects.create({ kind: 34, parent: owner }),
    surface = await world.objects.create({ kind: 15, parent: owner }),
    implementation = world.objects.objects.get(id).implementation;
  await world.sendEngine(surface, owner, 279, 64, 48);
  await world.sendEngine(surface, owner, 283);
  await world.sendEngine(id, owner, 331, 0, parent.context.variableBank);
  await world.sendEngine(id, owner, 334, 0, world.nativeTaskID(surface));
  if (load) {
    await world.sendEngine(id, owner, 332, 0, 0, { payload: { string: () => source } });
    await world.sendEngine(id, owner, 333);
  }
  if (load) assert.ok(implementation.player.root.runtime instanceof FESCoordinator);
  return { id, surface, task: implementation, cache: implementation.imageCacheModel };
}
function expectedPrefix(buffers, pointer, source) {
  assert.deepEqual(buffers.data(pointer).subarray(0, source.length), source);
  const [, size, capacity] = buffers.words(pointer);
  assert.equal(size, capacity);
  assert.equal(size % 8, 0);
  assert.ok(size >= source.length && size < source.length + 8);
}
function defineCheckpointPixels(world) {
  const gpu = world.stageRenderer.gpu,
    { width, height } = gpu.primaryTarget;
  // Public CPU-entry fixture defines the target fully; this is no GPU oracle.
  gpu.uploadRenderTarget(gpu.primaryTarget, {
    width,
    height,
    rgba: new Uint8Array(width * height * 4).fill(0x62),
  });
}
function windowBytes() {
  const frames = windowFixture.inputs.map(({ width, height, rgba }) =>
      hg3(width, height, Uint8Array.from(rgba)),
    ),
    output = new Uint8Array(12 + frames.reduce((size, frame) => size + frame.length - 12, 0));
  output.set(frames[0].subarray(0, 12));
  let at = 12;
  for (const [index, frame] of frames.entries()) {
    const body = frame.slice(12),
      view = new DataView(body.buffer);
    view.setUint32(0, index + 1 < frames.length ? body.length : 0, true);
    view.setUint32(4, windowFixture.inputs[index].id, true);
    output.set(body, at);
    at += body.length;
  }
  return output;
}

for (const profile of startupProfiles) {
  test(`default FES two lazy misses are independent caller owns, not residents: ${profile}`, async (t) => {
    const h = await environment(profile, { [name]: raw });
    try {
      const current = await task(h.world),
        buffers = h.world.runtime.imageDataBuffers,
        candidates = h.game.nativeCandidates.bind(h.game),
        modes = [];
      t.mock.method(h.game, 'nativeCandidates', (path, mode) => {
        if (path === name) modes.push(mode);
        return candidates(path, mode);
      });
      const first = await current.task.imageData(name),
        second = await current.task.imageData(name);
      assert.notEqual(first, second);
      assert.deepEqual(modes, [3, 3]);
      assert.equal(current.cache.entries.size, 0);
      assert.deepEqual(buffers.words(first).slice(1), [16, 16, 1, 0]);
      expectedPrefix(buffers, first, raw);
      expectedPrefix(buffers, second, raw);
      buffers.releasePointer(first);
      assert.equal(buffers.owns(first), false);
      assert.equal(buffers.words(second)[3], 1);
      await h.world.objects.release(current.id);
      assert.equal(buffers.words(second)[3], 1, 'task owns no lazy miss reference');
      buffers.releasePointer(second);
      assert.equal(buffers.owns(second), false);
    } finally {
      await h.close();
    }
  });
  test(`resident preload reads before first-win and only hits retain one caller ref: ${profile}`, async (t) => {
    const h = await environment(profile, { [name]: raw });
    try {
      const current = await task(h.world),
        buffers = h.world.runtime.imageDataBuffers,
        candidates = h.game.nativeCandidates.bind(h.game),
        modes = [];
      t.mock.method(h.game, 'nativeCandidates', (path, mode) => {
        if (path === name) modes.push(mode);
        return candidates(path, mode);
      });
      await current.cache.preload(name);
      const resident = current.cache.entries.get(name);
      assert.equal(buffers.words(resident)[3], 1);
      expectedPrefix(buffers, resident, raw);
      await h.world.storage.write('assets/tile.hg3', Uint8Array.of(99, 88, 77));
      await current.cache.preload(name);
      assert.deepEqual(modes, [3, 3]);
      assert.equal(current.cache.entries.get(name), resident);
      expectedPrefix(buffers, resident, raw);
      const own = await current.task.imageData(name);
      assert.equal(own, resident);
      assert.equal(buffers.words(own)[3], 2);
      assert.deepEqual(modes, [3, 3], 'resident lookup does not open a file');
      await h.world.objects.release(current.id);
      assert.equal(buffers.words(own)[3], 1, 'task releases precisely its residency ref');
      buffers.releasePointer(own);
      assert.equal(buffers.owns(own), false);
    } finally {
      await h.close();
    }
  });
  test(`resident map survives interpreter replacement and fresh once without ref replay: ${profile}`, async (t) => {
    const h = await environment(profile);
    let fresh;
    try {
      const current = await task(h.world),
        buffers = h.world.runtime.imageDataBuffers,
        pointer = buffers.createPointer(encoded);
      await h.world.sendEngine(current.id, h.world.main.id, 350, 0, pointer, {
        nativePointer: true,
        payload: { string: () => name },
      });
      buffers.releasePointer(pointer);
      assert.equal(buffers.words(pointer)[3], 1);
      await h.world.sendEngine(
        current.id,
        h.world.main.id,
        331,
        0,
        h.world.main.context.variableBank,
      );
      assert.equal(current.cache.entries.get(name), pointer);
      assert.equal(buffers.words(pointer)[3], 1);
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => 'assets.int/screen.fes' },
      });
      defineCheckpointPixels(h.world);
      const checkpoint = await h.player.snapshot();
      for (const file of [name, 'assets.int/screen.fes'])
        t.mock.method(h.game.lookup(file).file, 'read', () => {
          throw new Error('Restore must not read resident/FES sources');
        });
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('No original restore');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const restored = fresh.world.objects.objects.get(current.id).implementation;
      assert.deepEqual(restored.imageCacheModel.snapshot(), [[name, pointer]]);
      assert.equal(fresh.world.runtime.imageDataBuffers.words(pointer)[3], 1);
      assert.equal(buffers.words(pointer)[3], 1);
      await fresh.world.objects.destroy(current.id);
      assert.equal(
        fresh.world.runtime.imageDataBuffers.owns(pointer),
        true,
        'Task deletion retires at the next normal logic phase',
      );
      await fresh.world.tick();
      assert.equal(fresh.world.runtime.imageDataBuffers.owns(pointer), false);
      assert.equal(buffers.words(pointer)[3], 1);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
  test(`held lazy IMAGE data checkpoints in the real object, not in residency or source replay: ${profile}`, async (t) => {
    const source =
        '#DEFINE\nIMAGE held\n#OBJECT FILE IDN DISP\nheld assets.int/tile.hg3 -1 1\n#START\nbreak\n',
      h = await environment(profile, {
        'assets.int/screen.fes': ascii(source),
        'assets.int/empty.fes': ascii('#START\nbreak\n'),
      });
    let fresh;
    try {
      const current = await task(h.world),
        object = current.task.player.root.byKey.get('held'),
        pointer = object.imageEncodedPointer,
        buffers = h.world.runtime.imageDataBuffers;
      assert.ok(pointer);
      assert.equal(current.cache.entries.size, 0);
      assert.equal(buffers.words(pointer)[3], 1);
      expectedPrefix(buffers, pointer, encoded);
      defineCheckpointPixels(h.world);
      const checkpoint = await h.player.snapshot();
      for (const file of [name, 'assets.int/screen.fes'])
        t.mock.method(h.game.lookup(file).file, 'read', () => {
          throw new Error('Held data restore must not reread source');
        });
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('No original restore');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      const restored = fresh.world.objects.objects.get(current.id).implementation,
        held = restored.player.root.byKey.get('held'),
        next = fresh.world.runtime.imageDataBuffers;
      assert.equal(held.imageEncodedPointer, pointer);
      assert.equal(restored.imageCacheModel.entries.size, 0);
      assert.equal(next.words(pointer)[3], 1);
      expectedPrefix(next, pointer, encoded);
      assert.deepEqual(next.data(pointer), buffers.data(pointer));
      await fresh.world.objects.destroy(current.id);
      assert.equal(
        next.owns(pointer),
        true,
        'Task deletion retires at the next normal logic phase',
      );
      await fresh.world.tick();
      assert.equal(next.owns(pointer), false);
      assert.equal(buffers.words(pointer)[3], 1);
      await h.world.sendEngine(
        current.id,
        h.world.main.id,
        331,
        0,
        h.world.main.context.variableBank,
      );
      assert.equal(
        buffers.owns(pointer),
        true,
        'pending Core handoff retains held object until replacement source loads',
      );
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => 'assets.int/empty.fes' },
      });
      assert.equal(buffers.owns(pointer), false);
      assert.equal(current.cache.entries.size, 0);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
  test(`IMGWND uses one temporary owner for every frame and leaves pixels unchanged: ${profile}`, async (t) => {
    const expected = windowFixture.outputs[0],
      source = `#DEFINE\nIMGWND window\n#OBJECT FILE DISP\nwindow assets.int/window.hg3 1\n#START\nwindow size ${expected.width} ${expected.height}\nbreak\n`,
      h = await environment(profile, {
        'assets.int/window.hg3': windowBytes(),
        'assets.int/screen.fes': ascii(source),
      });
    try {
      const pointers = [],
        selectors = [],
        decode = h.world.runtime.imageDataBuffers.decodeImage,
        candidates = h.game.nativeCandidates.bind(h.game),
        modes = [];
      t.mock.method(h.world.runtime.imageDataBuffers, 'decodeImage', function (pointer, selector) {
        pointers.push(pointer);
        selectors.push(selector);
        return decode.call(this, pointer, selector);
      });
      t.mock.method(h.game, 'nativeCandidates', (file, mode) => {
        if (file === 'assets.int/window.hg3') modes.push(mode);
        return candidates(file, mode);
      });
      const current = await task(h.world),
        object = current.task.player.root.byKey.get('window'),
        bitmap = h.world.graphics.images.get(object.imageResource.bitmap);
      assert.deepEqual(selectors, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
      assert.equal(new Set(pointers).size, 1);
      assert.deepEqual(modes, [3]);
      assert.equal(h.world.runtime.imageDataBuffers.owns(pointers[0]), false);
      assert.equal(current.cache.entries.size, 0);
      assert.equal(Buffer.from(await bitmap.pixels()).toString('hex'), expected.rgbaHex);
    } finally {
      await h.close();
    }
  });
  test(`failed image assignment returns temporary own while the actual object retains its data: ${profile}`, async (t) => {
    const h = await environment(profile, {
      'assets.int/screen.fes': ascii(
        '#DEFINE\nIMAGE held\n#OBJECT FILE IDN\nheld assets.int/tile.hg3 -1\n#START\nbreak\n',
      ),
    });
    try {
      const current = await task(h.world, undefined, { load: false });
      t.mock.method(h.world.renderSources, 'decode', async () => {
        throw new Error('authored assignment decode failure');
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => 'assets.int/screen.fes' },
      });
      await assert.rejects(
        h.world.sendEngine(current.id, h.world.main.id, 333),
        /authored assignment decode failure/,
      );
      const object = current.task.player.root.byKey.get('held'),
        pointer = object.imageEncodedPointer,
        buffers = h.world.runtime.imageDataBuffers;
      assert.ok(pointer);
      assert.equal(buffers.words(pointer)[3], 1);
      assert.equal(current.cache.entries.size, 0);
      await h.world.objects.release(current.id);
      assert.equal(buffers.owns(pointer), false);
    } finally {
      await h.close();
    }
  });
  test(`cache load returns its temporary own after an asynchronous decoder failure: ${profile}`, async (t) => {
    const h = await environment(profile);
    try {
      const current = await task(h.world),
        buffers = h.world.runtime.imageDataBuffers;
      let held;
      t.mock.method(buffers, 'decodeImage', async (pointer) => {
        held = pointer;
        assert.equal(buffers.words(pointer)[3], 1);
        await Promise.resolve();
        throw new Error('authored async decode failure');
      });
      await assert.rejects(current.cache.load(name), /authored async decode failure/);
      assert.ok(held);
      assert.equal(buffers.owns(held), false);
      assert.equal(current.cache.entries.size, 0);
    } finally {
      await h.close();
    }
  });
  test(`cache load keeps exactly one temporary own while its Task closes during decode: ${profile}`, async (t) => {
    const h = await environment(profile);
    let resume;
    try {
      const current = await task(h.world),
        buffers = h.world.runtime.imageDataBuffers,
        gate = new Promise((resolve) => {
          resume = resolve;
        });
      let entered, held;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      t.mock.method(buffers, 'decodeImage', async (pointer) => {
        held = pointer;
        entered();
        await gate;
        return null;
      });
      const pending = current.cache.load(name);
      await started;
      assert.ok(held);
      assert.equal(buffers.words(held)[3], 1);
      await h.world.objects.release(current.id);
      assert.equal(buffers.words(held)[3], 1, 'Task owns no lazy-map reference to release');
      resume();
      assert.equal(await pending, 0);
      assert.equal(buffers.owns(held), false);
      assert.equal(current.cache.entries.size, 0);
    } finally {
      resume?.();
      await h.close();
    }
  });
  test(`default IMGWND releases the one temporary owner and partial bitmaps on a later frame failure: ${profile}`, async (t) => {
    const h = await environment(profile, {
      'assets.int/window.hg3': windowBytes(),
      'assets.int/screen.fes': ascii(
        '#DEFINE\nIMGWND window\n#OBJECT FILE DISP\nwindow assets.int/window.hg3 1\n#START\nwindow size 13 11\nbreak\n',
      ),
    });
    try {
      const current = await task(h.world, undefined, { load: false }),
        buffers = h.world.runtime.imageDataBuffers,
        decode = buffers.decodeImage,
        pointers = [],
        bitmapCount = () =>
          [...h.world.runtime.handles.records.values()].filter((record) => record.type === 'bitmap')
            .length;
      t.mock.method(buffers, 'decodeImage', async function (pointer, selector) {
        pointers.push(pointer);
        if (selector === 4) throw new Error('authored later window frame failure');
        return decode.call(this, pointer, selector);
      });
      await h.world.sendEngine(current.id, h.world.main.id, 332, 0, 0, {
        payload: { string: () => 'assets.int/screen.fes' },
      });
      const before = bitmapCount();
      await assert.rejects(
        h.world.sendEngine(current.id, h.world.main.id, 333),
        /authored later window frame failure/,
      );
      assert.equal(pointers.length, 5);
      assert.equal(new Set(pointers).size, 1);
      assert.equal(buffers.owns(pointers[0]), false);
      assert.equal(current.cache.entries.size, 0);
      assert.equal(bitmapCount(), before);
    } finally {
      await h.close();
    }
  });
  test(`real PANEL font-frame failure returns its temporary encoded owner: ${profile}`, async (t) => {
    const h = await environment(profile, {
      'assets.int/screen.fes': ascii('#DEFINE\nPANEL font\n#START\nbreak\n'),
    });
    try {
      const current = await task(h.world),
        instance = current.task.player.root,
        object = instance.byKey.get('font'),
        buffers = h.world.runtime.imageDataBuffers,
        data = buffers.data,
        pointers = [];
      t.mock.method(buffers, 'data', function (pointer) {
        pointers.push(pointer);
        assert.equal(buffers.words(pointer)[3], 1);
        return data.call(this, pointer);
      });
      t.mock.method(h.world.imagesFES, 'decodeEntry', async () => {
        throw new Error('authored PANEL font decode failure');
      });
      await assert.rejects(
        h.world.imagesFES.fontResources(instance, object, {
          userFonts: [{ file: name, code: 65, frame: 0 }],
        }),
        /authored PANEL font decode failure/,
      );
      assert.equal(pointers.length, 1);
      assert.equal(buffers.owns(pointers[0]), false);
      assert.equal(current.cache.entries.size, 0);
    } finally {
      await h.close();
    }
  });
  for (const kind of ['image', 'panel', 'control', 'plane', 'string'])
    test(`real ${kind} metadata consumer finally returns its temporary own on failure: ${profile}`, async (t) => {
      const h = await environment(profile);
      try {
        const current = await task(h.world),
          buffers = h.world.runtime.imageDataBuffers,
          seen = [],
          reference = { name, index: 0 },
          object = {};
        t.mock.method(buffers, 'data', (pointer) => {
          seen.push(pointer);
          assert.equal(buffers.words(pointer)[3], 1);
          throw new Error('authored metadata read failure');
        });
        const call =
          kind === 'image'
            ? () => h.world.imagesFES.geometry(current.task.player.root, object, reference)
            : kind === 'panel'
              ? () => h.world.imagesFES.panelMetadata(current.task.player.root, { file: name }, 0)
              : kind === 'control'
                ? () => h.world.controlsFES.metadata(current.task.player.root, object, reference)
                : kind === 'plane'
                  ? () => h.world.planesFES.metadata(current.task.player.root, object, reference)
                  : () => h.world.text.fes.reference(current.task.player.root, reference);
        await assert.rejects(call(), /authored metadata read failure/);
        assert.equal(seen.length, 1);
        assert.equal(buffers.owns(seen[0]), false);
        assert.equal(current.cache.entries.size, 0);
      } finally {
        await h.close();
      }
    });
}

// Complete owned HG3 frames: ID1 is absent although ordinal1 exists (ID7).
function pos2GeometryFrames() {
  const frames = [
    { id: 3, x: 5, y: 11 },
    { id: 7, x: 31, y: 37 },
  ].map(({ id, x, y }) => {
    const bytes = hg3(2, 1, pixels),
      view = new DataView(bytes.buffer);
    view.setUint32(16, id, true);
    view.setInt32(48, x, true);
    view.setInt32(52, y, true);
    view.setInt32(56, 64, true);
    view.setInt32(60, 64, true);
    return bytes;
  });
  const joined = new Uint8Array(12 + frames.reduce((n, bytes) => n + bytes.length - 12, 0));
  joined.set(frames[0].subarray(0, 12));
  let at = 12;
  for (const [index, bytes] of frames.entries()) {
    const body = bytes.slice(12);
    new DataView(body.buffer).setUint32(0, index + 1 < frames.length ? body.length : 0, true);
    joined.set(body, at);
    at += body.length;
  }
  return joined;
}

for (const profile of startupProfiles) {
  test(`default FES decode settles POS2 and preserves hidden and missing image owners: ${profile}`, async (t) => {
    const missingSource =
        '#DEFINE\nDIFIMAGE face[3]\n#OBJECT POS POS2 DISP PRI\nface 17,23 absent.hg3:1 0 15\n#START\n\\60 = 73\nbreak\n',
      selectorSource = [
        '#DEFINE',
        'IMAGE sample',
        'IMAGE anchor',
        'DIFIMAGE avatar[1]',
        '#OBJECT FILE IDN POS POS2 DISP PRI',
        'sample tile.hg3 0 17,23 geometry.hg3:1 0 20',
        'anchor tile.hg3 0 0,0 geometry.hg3:7 0 21',
        '#OBJECT POS2 DISP PRI',
        'avatar geometry.hg3:7 0 22',
        '#START',
        'avatar[0] getpos 50 51',
        '\\64 = $50',
        '\\65 = $51',
        'decode',
        'avatar[0] getpos 50 51',
        '\\62 = $50',
        '\\63 = $51',
        '\\61 = 89',
        'break',
        '',
      ].join('\n'),
      h = await environment(profile, {
        'assets.int/missing-pos2.fes': ascii(missingSource),
        'assets.int/selector-pos2.fes': ascii(selectorSource),
        'assets.int/geometry.hg3': pos2GeometryFrames(),
      });
    let fresh;
    try {
      const world = h.world,
        buffers = world.runtime.imageDataBuffers,
        pointers = [],
        observed = [],
        requests = [],
        create = buffers.createPointer,
        geometry = world.imagesFES.geometry,
        candidates = h.game.nativeCandidates;
      t.mock.method(buffers, 'createPointer', function (...args) {
        const pointer = create.apply(this, args);
        pointers.push(pointer);
        return pointer;
      });
      t.mock.method(world.imagesFES, 'geometry', function (instance, object, reference) {
        observed.push({
          type: object.nativeType,
          key: object.key,
          x: object.x,
          y: object.y,
          name: reference.name,
          index: reference.index,
        });
        return geometry.call(this, instance, object, reference);
      });
      t.mock.method(h.game, 'nativeCandidates', function (path, mode) {
        if (/\.(?:fes|hg3)$/.test(path)) requests.push([path, mode]);
        return candidates.call(this, path, mode);
      });

      const first = await task(world, 'assets.int/missing-pos2.fes'),
        root = first.task.player.root,
        faces = [0, 1, 2].map((index) => root.byKey.get(`face[${index}]`));
      // Primary functional oracle: the ordinary kind34 FILE/drain completed,
      // consumed the missing POS2 request and reached the real guest assignment.
      assert.equal(root.local(60), 73);
      assert.deepEqual(
        faces.map((object) => [object.nativeType, object.x, object.y]),
        [
          [25, 0, 0],
          [25, 0, 0],
          [25, 0, 0],
        ],
      );
      assert.deepEqual(
        observed.filter((row) => row.type === 25),
        [0, 1, 2].map((index) => ({
          type: 25,
          key: `face[${index}]`,
          x: 17,
          y: 23,
          name: 'absent.hg3',
          index: 1,
        })),
      );
      for (const object of faces) {
        assert.equal(object.positionPending, false);
        assert.equal(object.dirty, false);
        assert.equal(object.imageResource.bitmap, 0, 'No replacement pixels were invented');
        assert.equal(object.imageResource.source, 0);
      }

      const second = await task(world, 'assets.int/selector-pos2.fes'),
        images = second.task.player.root,
        sample = images.byKey.get('sample'),
        anchor = images.byKey.get('anchor'),
        avatar = images.byKey.get('avatar[0]'),
        bitmapHandle = sample.nativeImageHandle,
        bitmap = world.graphics.images.get(bitmapHandle);
      assert.equal(images.local(61), 89);
      assert.deepEqual([images.local(64), images.local(65)], [0, 0]);
      assert.deepEqual([images.local(62), images.local(63)], [31, 37]);
      assert.deepEqual(
        [avatar.x, avatar.y, avatar.disp, avatar.imageResource.source],
        [31, 37, false, 0],
      );
      assert.equal(sample.nativeType, 2);
      assert.deepEqual([sample.x, sample.y], [0, 0], 'ID1 miss does not select ordinal1/ID7');
      assert.deepEqual([anchor.x, anchor.y], [31, 37], 'The actual ID7 metadata is available');
      assert.deepEqual(
        observed.filter((row) => row.key === 'sample'),
        [{ type: 2, key: 'sample', x: 17, y: 23, name: 'geometry.hg3', index: 1 }],
      );
      assert.equal(sample.positionPending, false);
      assert.equal(anchor.positionPending, false);
      assert.ok(bitmapHandle > 0);
      assert.equal(bitmap.state.width, 2);
      assert.equal(bitmap.state.height, 1);
      assert.deepEqual(
        Array.from(await bitmap.pixels()),
        Array.from(pixels),
        'FILE pixels survive a missing geometry ID',
      );
      assert.ok(pointers.length > 0);
      for (const pointer of pointers) assert.equal(buffers.owns(pointer), false);
      assert.equal(first.cache.entries.size, 0);
      assert.equal(second.cache.entries.size, 0);
      assert.ok(
        requests.some(([path]) => path === 'assets.int/geometry.hg3'),
        'Real image I/O was observed',
      );
      const settledRequests = requests.slice();
      await world.sendEngine(first.id, world.main.id, 333);
      await world.sendEngine(second.id, world.main.id, 333);
      assert.deepEqual(requests, settledRequests, 'Consumed POS2/FILE requests do not replay');
      assert.equal(sample.nativeImageHandle, bitmapHandle);

      defineCheckpointPixels(world);
      const checkpoint = await h.player.snapshot(),
        beforeRestore = requests.slice();
      fresh = new CatSystem2({
        game: h.game,
        nativeProfile: profile,
        canvas: new StartupCanvas(),
        audioContext: { currentTime: 0, close: async () => {} },
        transitionalExe: {
          open() {
            throw new Error('POS2 restore must not open the original');
          },
        },
      });
      await fresh.initialize({ checkpoint });
      assert.notStrictEqual(fresh.world, world);
      assert.equal(fresh.world.nativeEngine, undefined);
      assert.deepEqual(requests, beforeRestore, 'Restore reuses settled FES/image state');
      const restoredFirst = fresh.world.objects.objects.get(first.id).implementation.player.root,
        restoredSecond = fresh.world.objects.objects.get(second.id).implementation.player.root;
      for (let index = 0; index < 3; index++) {
        const object = restoredFirst.byKey.get(`face[${index}]`);
        assert.deepEqual([object.x, object.y, object.positionPending], [0, 0, false]);
      }
      assert.deepEqual(
        [
          restoredSecond.byKey.get('sample').x,
          restoredSecond.byKey.get('sample').y,
          restoredSecond.byKey.get('sample').positionPending,
        ],
        [0, 0, false],
      );
      assert.deepEqual(
        [restoredSecond.byKey.get('anchor').x, restoredSecond.byKey.get('anchor').y],
        [31, 37],
      );
      assert.deepEqual([restoredSecond.local(62), restoredSecond.local(63)], [31, 37]);
      await world.objects.release(first.id);
      await world.objects.release(second.id);
      assert.equal(world.objects.objects.has(first.id), false);
      assert.equal(world.objects.objects.has(second.id), false);
      for (const pointer of pointers) assert.equal(buffers.owns(pointer), false);
      assert.equal(fresh.world.objects.objects.has(first.id), true, 'Fresh owners are independent');
      assert.equal(fresh.world.objects.objects.has(second.id), true);
    } finally {
      await fresh?.dispose();
      await h.close();
    }
  });
}
