// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { textConfig, packTextConfiguration } from '../src/native/text-config.mjs';
import { nativeTextPublicationWriter } from '../src/native/text.mjs';
import { NativeScreenCapture } from '../src/native/screen-capture.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { authoredHG3 } from './fixtures/hg3.mjs';
import {
  nativeBitmapState,
  nativeBitmapPixels,
  nativeBitmapStorageOwned,
} from '../src/native/image.mjs';

// These probes inspect the kernel's owned record. Public borrowing is exercised
// explicitly below; probes never reset ownership or pass records to providers.

const profiles = [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
];
const fontBytes = new Uint8Array(
  await readFile(new URL('../third_party/fonts/noto-sans-jp/NotoSansJP.ttf', import.meta.url)),
);
function memory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    load: (at) => view.getUint32(at, true),
    store: (at, n) => view.setUint32(at, n >>> 0, true),
    bytes: (at, n) => bytes.subarray(at, at + n),
    write: (at, value) => bytes.set(value, at),
  };
}
async function setup(profile = 'nekopara-vol3-engine-2.6.1.76', options = {}) {
  const world = await defaultFESWorld(
    profile,
    { 'font.ttf': fontBytes },
    { glyphs: undefined, ...options, initialize: false },
  );
  const texture = world.configuration.fields.texture;
  texture.size.set([64, 64]);
  texture.grid.set([2, 2]);
  texture.areas[0].set([0, 0, 2, 2]);
  texture.bppY.set([0, 2]);
  texture.dither = 0;
  await world.initialize('case.kcs');
  const id = await world.objects.create({ kind: 48, parent: world.main.id }),
    task = world.graphics.get(id),
    runtime = await world.text.runtime(),
    config = textConfig(profile, 'cp932', world.configuration),
    view = new DataView(config.buffer),
    fontLength = config.length - 128 - 24;
  view.setUint32(4, 48, true);
  view.setUint32(8, 24, true);
  config.fill(0, 128, 128 + fontLength);
  const name = 'font.ttf';
  if (fontLength === 64)
    for (let i = 0; i < name.length; i++) view.setUint16(128 + 2 * i, name.charCodeAt(i), true);
  else config.set(encodeCP932(name), 128);
  view.setUint32(128 + fontLength + 20, 1, true);
  const packet = packTextConfiguration(runtime.bindings('cp932'), config, 3, 5, 1),
    send = (op, bytes = null, batch = null) =>
      task.message([world.main.id, task.firstMessage + op, 0, 0], {
        ...(bytes ? { payload: memory(bytes) } : {}),
        ...(batch ? { textPublication: batch } : {}),
      });
  await send(1, packet);
  await task.message([world.main.id, 47, 0, 1]);
  await send(3, Uint8Array.from([...encodeCP932('あい'), 0]));
  await send(8);
  const writer = await task.writer(),
    vram = world.graphics.images.get(world.graphics.vramHandle);
  assert(writer.frame().rgba.some((n, i) => i % 4 === 3 && n));
  return { world, task, writer, vram, config, packet, send };
}
function settled(h) {
  assert.equal(h.world.text.publications.size, 0);
  assert.equal(h.world.text.flushingPublication, null);
  assert.equal(h.world.runtime.textPublicationBarrier ?? null, null);
}

const imageFontBytes = authoredHG3([
  { id: 1, width: 2, height: 2, rgba: Uint8Array.from({ length: 16 }, (_, i) => i * 17) },
]);
for (const loaded of [false, true])
  test(`owned image-font selectors retain empty-clear results and revisions: loaded=${loaded}`, async () => {
    const results = [];
    for (const coalesce of [false, true]) {
      const h = await setup();
      let fresh;
      try {
        await h.writer.userFont(loaded ? imageFontBytes : null);
        for (let i = 0; i < 9; i++) await h.writer.resourceMessage(10, 0x8740 + i, i + 1);
        assert.equal(h.writer.decodedFonts.length, loaded ? 1 : 0);
        if (loaded) h.writer.setCharacterImage(0x8748, h.writer.decodedFonts[0]);
        assert(nativeTextPublicationWriter(h.writer, h.config));
        const before = nativeBitmapState(h.vram).revision,
          batch = coalesce ? h.world.text.beginPublication(h.task, h.config) : null,
          replies = [];
        for (const [operation, bytes] of [
          [4, null],
          [2, h.packet],
          [4, null],
          [14, null],
        ]) {
          if (batch) await batch.before();
          replies.push(await h.send(operation, bytes, batch));
        }
        await h.world.text.flushPublications();
        assert.equal(nativeBitmapState(h.vram).revision, before + 4);
        if (batch) assert.equal(batch.physicalPublications, 1);
        results.push({
          replies,
          task: h.task.snapshot(),
          writer: h.writer.snapshot(),
          pixels: (await h.vram.pixels()).slice(),
          revision: nativeBitmapState(h.vram).revision,
          pages: h.world.graphics.texturePages.snapshot(),
        });
        // Actual glyph consumption runs after settlement, including the missing
        // selector's ordinary blank-cell fallback.
        await h.send(3, Uint8Array.from([...encodeCP932('①'), 0]));
        await h.send(8);
        assert.equal(h.writer.fontImages.size, 9);
        if (coalesce) {
          fresh = await defaultFESWorld(
            profiles[3],
            { 'font.ttf': fontBytes },
            {
              initialize: false,
              glyphs: undefined,
            },
          );
          await fresh.restore(h.world.snapshot());
          const writer = await fresh.graphics.get(h.task.record.id).writer();
          assert.deepEqual(writer.snapshot(), h.writer.snapshot());
          assert(nativeTextPublicationWriter(writer, writer.config));
        }
        settled(h);
      } finally {
        await fresh?.close({ flushFiles: false });
        await h.world.close({ flushFiles: false });
      }
    }
    assert.deepEqual(results[1], results[0]);
  });

test('a dirty FES image font keeps the clear before resource lookup and replacement', async () => {
  const source =
    '#DEFINE\nIMAGE uf\nSTRING8 a\n#OBJECT FILE IDN\nuf missing -1\n#OBJECT SIZE POS PRI DISP\na 48,24 0,0 60000 1\n#START\na layout fontind 1 font.ttf\na str AB\na draw\nnext IDLE\n#IDLE\n';
  const world = await defaultFESWorld(
    profiles[3],
    {
      'screen.fes': new TextEncoder().encode(source),
      'font.ttf': fontBytes,
    },
    { glyphs: undefined },
  );
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    const object = h.instance.byKey.get('a'),
      strings = world.text.fes,
      sourceObject = h.instance.byKey.get('uf'),
      vram = world.graphics.images.get(world.graphics.vramHandle),
      before = nativeBitmapState(vram).revision,
      read = strings.imageDataFor;
    let reads = 0;
    await strings.command(h.instance, object, 'clear');
    strings.setFontSource(object, sourceObject);
    assert(object.nativeTextState.fontDirty);
    world.text.beginPublication = () => {
      throw Error('font IO cannot enter a publication transaction');
    };
    strings.imageDataFor = function (...args) {
      reads++;
      assert.equal(nativeBitmapState(vram).revision, before + 1);
      assert.equal(world.text.publications.size, 0);
      return Reflect.apply(read, this, args);
    };
    await strings.drive(h.instance, object);
    assert.equal(reads, 1);
    assert.equal(object.nativeTextState.fontDirty, false);
    assert.equal((await world.graphics.get(object.nativeTaskID).writer()).imageFont, null);
    settled({ world });
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('loaded image-font replacement, nonempty input and capture settle prior empty outputs', async () => {
  for (const boundary of ['input', 'resource', 'capture', 'unknown-map']) {
    const h = await setup();
    try {
      await h.writer.userFont(imageFontBytes);
      await h.writer.resourceMessage(10, 0x8740, 1);
      await h.send(4);
      const batch = h.world.text.beginPublication(h.task, h.config),
        before = nativeBitmapState(h.vram).revision;
      assert(batch);
      await h.send(4, null, batch);
      if (boundary === 'input') {
        await h.send(3, Uint8Array.from([...encodeCP932('①'), 0]), batch);
        await batch.before();
        await h.send(8, null, batch);
      } else if (boundary === 'resource') {
        await h.task.message([h.world.main.id, h.task.firstMessage + 9, 0, 0], {
          resourceBytes: imageFontBytes,
          consumeResource() {
            assert(!batch.enabled);
            assert.equal(nativeBitmapState(h.vram).revision, before + 1);
          },
        });
      } else if (boundary === 'capture') await h.vram.frame();
      else {
        h.writer.fontImages.set(65, {});
        await batch.before();
        h.writer.fontImages.delete(65);
      }
      assert(!batch.enabled);
      assert.equal(batch.physicalPublications, 1);
      settled(h);
    } finally {
      await h.world.close({ flushFiles: false });
    }
  }
  const h = await setup();
  try {
    let reads = 0;
    const descriptor = Object.getOwnPropertyDescriptor(h.writer, 'fontImages');
    Object.defineProperty(h.writer, 'fontImages', {
      configurable: true,
      get() {
        reads++;
        throw Error('foreign map accessor');
      },
    });
    assert.equal(h.world.text.beginPublication(h.task, h.config), null);
    assert.equal(reads, 0);
    Object.defineProperty(h.writer, 'fontImages', descriptor);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

for (const profile of profiles)
  test(`${profile} owned FT clear messages keep results and pixels with one final publication`, async () => {
    const h = await setup(profile);
    let fresh;
    try {
      const before = nativeBitmapState(h.vram).revision,
        batch = h.world.text.beginPublication(h.task, h.config);
      assert(batch);
      const replies = [];
      for (const [op, bytes] of [
        [4, null],
        [2, h.packet],
        [4, null],
        [14, null],
      ]) {
        await batch.before();
        replies.push(await h.send(op, bytes, batch));
      }
      assert.equal(nativeBitmapState(h.vram).revision, before);
      assert.throws(() => h.world.text.snapshot(), /settled publication/);
      assert.throws(() => h.world.snapshot(), /settled text publication/);
      assert.equal(batch.enabled, true);
      assert.equal(nativeBitmapState(h.vram).revision, before);
      await h.world.text.flushPublications();
      settled(h);
      assert.equal(nativeBitmapState(h.vram).revision, before + 4);
      assert.equal(batch.physicalPublications, 1);
      assert.deepEqual(replies.slice(0, 3), [replies[0], replies[0], replies[0]]);
      assert.equal(replies[3], 1);
      assert(h.writer.frame().rgba.every((n) => n === 0));
      const pixels = await h.vram.pixels();
      for (let y = 5; y < 29; y++)
        assert(
          pixels
            .subarray((y * h.vram.width + 3) * 4, (y * h.vram.width + 51) * 4)
            .every((n) => n === 0),
        );
      const saved = h.world.snapshot();
      fresh = await defaultFESWorld(
        profile,
        { 'font.ttf': fontBytes },
        { initialize: false, glyphs: undefined },
      );
      await fresh.restore(saved);
      const restored = fresh.graphics.get(h.task.record.id),
        writer = await restored.writer();
      assert.deepEqual(writer.snapshot(), h.writer.snapshot());
      assert.deepEqual(
        fresh.graphics.texturePages.snapshot(),
        h.world.graphics.texturePages.snapshot(),
      );
      assert(
        nativeTextPublicationWriter(writer, writer.config),
        'cold restored owned fonts remain ready',
      );
    } finally {
      await fresh?.close({ flushFiles: false });
      await h.world.close({ flushFiles: false });
    }
  });

test('replacement glyph providers flush the current clear before the unknown callback', async () => {
  const h = await setup();
  try {
    const batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    const fonts = h.writer.runtime.glyphs,
      original = fonts.advance;
    let calls = 0;
    fonts.advance = function (...args) {
      calls++;
      assert(!batch.enabled);
      assert(!h.world.text.publications.size);
      assert(
        nativeBitmapState(h.vram)
          .rgba.subarray((5 * h.vram.width + 3) * 4, (5 * h.vram.width + 51) * 4)
          .every((n) => n === 0),
      );
      return Reflect.apply(original, this, args);
    };
    await batch.before();
    assert.equal(batch.enabled, false);
    await h.send(3, Uint8Array.from([...encodeCP932('あ'), 0]), batch);
    await h.send(14, null, batch);
    assert(calls > 0);
    delete fonts.advance;
    settled(h);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

for (const boundary of [
  'state',
  'pixels',
  'frame',
  'page',
  'bitmap-snapshot',
  'page-snapshot',
  'alias',
  'ensureVRAM',
  'fill',
  'capture',
  'native',
  'message',
])
  test(`public ${boundary} observes a settled preceding text clear`, async () => {
    const h = await setup();
    try {
      const before = nativeBitmapState(h.vram).revision,
        batch = h.world.text.beginPublication(h.task, h.config);
      assert(batch);
      await h.send(4, null, batch);
      assert.equal(nativeBitmapState(h.vram).revision, before);
      if (boundary === 'state') assert.equal(h.vram.state.revision, before + 1);
      if (boundary === 'pixels') await h.vram.pixels();
      if (boundary === 'frame') await h.vram.frame();
      if (boundary === 'page') h.world.graphics.texturePages.frame(0);
      if (boundary === 'bitmap-snapshot') assert.equal(h.vram.snapshot().revision, before + 1);
      if (boundary === 'page-snapshot') h.world.graphics.texturePages.snapshot();
      if (boundary === 'alias') {
        const handle = h.world.graphics.images.alias(h.world.graphics.vramHandle);
        await h.world.graphics.images.get(handle).pixels();
        await h.world.graphics.images.release(handle);
      }
      if (boundary === 'message')
        await h.world.sendEngine(h.task.record.id, h.world.main.id, h.task.firstMessage + 14);
      if (boundary === 'ensureVRAM') await h.world.graphics.ensureVRAM(48, 24);
      if (boundary === 'fill') await h.world.graphics.fill(0, 0, 1, 1, 0);
      if (boundary === 'capture') {
        h.world.stageRenderer = {
          gpu: { primaryTarget: { width: 1, height: 1 }, pixels: () => new Uint8Array(4) },
          async render() {
            assert.equal(nativeBitmapState(h.vram).revision, before + 1);
          },
        };
        await new NativeScreenCapture(h.world).screenshot({ id: h.world.main.id });
        h.world.stageRenderer = null;
      }
      if (boundary === 'native') {
        const reply = await h.world.runtime.native(
          'main',
          0x172,
          [h.world.graphics.vramHandle, 3, 5],
          { debug: null, pc: 0 },
          h.world.main,
        );
        assert.equal(reply.value, 0);
      }
      assert(nativeBitmapState(h.vram).revision >= before + 1);
      assert.equal(batch.enabled, false);
      settled(h);
    } finally {
      await h.world.close({ flushFiles: false });
    }
  });

test('GDI/custom readiness, foreign image fonts and replaced frame methods retain the full fallback', async () => {
  const h = await setup();
  try {
    const fonts = h.writer.runtime.glyphs;
    for (const [owner, key, replacement] of [
      [
        h.writer,
        'frame',
        () => {
          throw Error('unknown frame');
        },
      ],
      [fonts.source, 'ready', async () => {}],
      [fonts, 'advance', () => 0],
      [fonts.module, '_cs2_font_glyph', () => 0],
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      Object.defineProperty(owner, key, { configurable: true, writable: true, value: replacement });
      assert.equal(h.world.text.beginPublication(h.task, h.config), null);
      if (descriptor) Object.defineProperty(owner, key, descriptor);
      else delete owner[key];
    }
    const config = h.config.slice(),
      view = new DataView(config.buffer);
    view.setUint32(config.length - 4, 0, true);
    assert.equal(h.world.text.beginPublication(h.task, config), null);
    h.writer.fontImages.set(65, { width: 1, height: 1, bpp: 4, rgba: new Uint8ClampedArray(4) });
    assert.equal(h.world.text.beginPublication(h.task, h.config), null);
    h.writer.fontImages.clear();
    fonts.fonts.delete('font.ttf');
    assert.equal(h.world.text.beginPublication(h.task, h.config), null);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

test('one ordinary FES clear drive publishes once; first and unknown-provider drives retain their writes', async () => {
  const source =
    '#DEFINE\nSTRING a\n#OBJECT SIZE POS PRI DISP\na 48,24 0,0 60000 1\n#START\na layout fontind 1 font.ttf\na str AB\na draw\nnext IDLE\n#IDLE\n#CLEAR\na clear\na layout size 25\nbreak\n';
  const open = () =>
    defaultFESWorld(
      profiles[2],
      { 'screen.fes': new TextEncoder().encode(source), 'font.ttf': fontBytes },
      { glyphs: undefined, initialize: false },
    );
  const candidate = await open(),
    control = await open();
  try {
    for (const world of [candidate, control]) {
      const texture = world.configuration.fields.texture;
      texture.size.set([64, 64]);
      texture.grid.set([2, 2]);
      texture.areas[0].set([0, 0, 2, 2]);
      texture.bppY.set([0, 2]);
      texture.dither = 0;
      await world.initialize('case.kcs');
    }
    const a = await loadDefaultFES(candidate),
      b = await loadDefaultFES(control);
    await a.task.tick();
    await b.task.tick();
    const av = candidate.graphics.images.get(candidate.graphics.vramHandle),
      bv = control.graphics.images.get(control.graphics.vramHandle),
      ar = nativeBitmapState(av).revision,
      br = nativeBitmapState(bv).revision;
    control.text.beginPublication = () => null;
    await a.task.player.notify('CLEAR');
    await a.task.syncObjects();
    await b.task.player.notify('CLEAR');
    await b.task.syncObjects();
    assert.equal(nativeBitmapState(av).revision - ar, 4);
    assert.equal(nativeBitmapState(bv).revision - br, 4);
    assert.deepEqual(await av.pixels(), await bv.pixels());
    assert.deepEqual(nativeBitmapState(av), nativeBitmapState(bv));
    assert.deepEqual(
      candidate.graphics.texturePages.snapshot(),
      control.graphics.texturePages.snapshot(),
    );
    assert.equal(candidate.graphics.texturePages.pages.size, 4);
    const at = candidate.graphics.get(a.instance.byKey.get('a').nativeTaskID),
      bt = control.graphics.get(b.instance.byKey.get('a').nativeTaskID);
    assert.deepEqual(at.snapshot(), bt.snapshot());
    assert.deepEqual((await at.writer()).snapshot(), (await bt.writer()).snapshot());
    assert.deepEqual(
      a.instance.byKey.get('a').nativeTextState,
      b.instance.byKey.get('a').nativeTextState,
    );
    assert.deepEqual(
      candidate.graphics.texturePages.dirtyFlags,
      control.graphics.texturePages.dirtyFlags,
    );
    settled({ world: candidate });
    settled({ world: control });
  } finally {
    await candidate.close({ flushFiles: false });
    await control.close({ flushFiles: false });
  }
});

test('an in-flight flush serializes later public VRAM reads', async () => {
  const h = await setup();
  try {
    const batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    const flushing = h.world.text.flushPublications();
    assert(h.world.text.flushingPublication);
    const reading = h.vram.pixels(),
      frame = h.vram.frame();
    await Promise.all([flushing, reading, frame]);
    assert.equal(h.world.text.flushingPublication, null);
    assert(
      (await reading)
        .subarray((5 * h.vram.width + 3) * 4, (5 * h.vram.width + 51) * 4)
        .every((n) => n === 0),
    );
    settled(h);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

test('a previously borrowed raw VRAM view keeps ordinary write and clear order', async () => {
  const h = await setup();
  try {
    const raw = await h.vram.pixels(),
      inside = (5 * h.vram.width + 3) * 4,
      batch = h.world.text.beginPublication(h.task, h.config);
    assert.equal(batch, null);
    await h.send(4);
    raw[0] = 173;
    raw[inside] = 211;
    assert.equal(raw[0], 173);
    assert.equal(raw[inside], 211);
    await h.send(4);
    assert.equal(raw[0], 173);
    assert.equal(raw[inside], 0);
    settled(h);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

test('a failed FES profile edit flushes the last requested clear and propagates the original error', async () => {
  const source =
    '#DEFINE\nSTRING a\n#OBJECT SIZE POS PRI DISP\na 48,24 0,0 60000 1\n#START\na layout fontind 1 font.ttf\na str AB\na draw\nnext IDLE\n#IDLE\n';
  const world = await defaultFESWorld(
    profiles[2],
    { 'screen.fes': new TextEncoder().encode(source), 'font.ttf': fontBytes },
    { glyphs: undefined },
  );
  try {
    const h = await loadDefaultFES(world);
    await h.task.tick();
    const object = h.instance.byKey.get('a'),
      strings = h.instance.runtime.strings,
      task = world.graphics.get(object.nativeTaskID),
      vram = world.graphics.images.get(world.graphics.vramHandle),
      before = nativeBitmapState(vram).revision;
    await strings.command(h.instance, object, 'clear');
    const layout = strings.layout(object);
    layout.profiles.prof = { index: -1, bytes: Uint8Array.of(65) };
    strings.saveLayout(object, layout);
    object.nativeTextState.dirty = true;
    await assert.rejects(strings.drive(h.instance, object), TypeError);
    assert.equal(nativeBitmapState(vram).revision, before + 3);
    assert(task.text.sourceEvents.length === 0);
    assert((await vram.pixels()).every((n) => n === 0));
    settled({ world });
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('a reentrant GDI glyph callback keeps the original clear before raster output', async () => {
  const h = await setup();
  try {
    const batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    const fonts = h.writer.runtime.glyphs,
      observations = [],
      offset = (5 * h.vram.width + 3) * 4;
    const observe = (name) => {
      observations.push(name);
      assert.equal(batch.enabled, false);
      assert(
        nativeBitmapState(h.vram)
          .rgba.subarray(offset, offset + 48 * 4)
          .every((n) => n === 0),
      );
    };
    fonts.source = {
      ready() {
        observe('ready');
      },
      measure(_font, text) {
        observe('measure');
        return {
          width: text.length * 5,
          height: 10,
          ascent: 7,
          descent: 3,
          averageWidth: 5,
          maximumWidth: 8,
        };
      },
      glyph() {
        observe('glyph');
        return {
          width: 4,
          height: 6,
          originX: 0,
          originY: 6,
          advanceX: 5,
          advanceY: 0,
          alpha: new Uint8Array(24).fill(255),
        };
      },
    };
    await batch.before();
    const config = h.config.slice();
    new DataView(config.buffer).setUint32(config.length - 4, 0, true);
    const packet = packTextConfiguration(h.writer.runtime.bindings('cp932'), config, 3, 5, 1);
    await h.send(2, packet, batch);
    await h.send(3, Uint8Array.from([...encodeCP932('あ'), 0]), batch);
    await h.send(8, null, batch);
    assert(observations.includes('ready'));
    assert(observations.includes('glyph'));
    assert(observations.includes('measure'));
    settled(h);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

test('unknown frame providers and failed readiness run after settling the earlier publication', async () => {
  const h = await setup();
  try {
    const batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    const previous = h.writer.frame;
    let frames = 0;
    h.writer.frame = function () {
      frames++;
      assert(!batch.enabled);
      assert.equal(h.world.text.flushingPublication, null);
      return Reflect.apply(previous, this, []);
    };
    await batch.before();
    await h.send(4, null, batch);
    assert.equal(frames, 1);
    delete h.writer.frame;
    const next = h.world.text.beginPublication(h.task, h.config);
    assert(next);
    await h.send(4, null, next);
    const failure = new Error('external readiness rejected');
    h.writer.runtime.glyphs.source.ready = () => {
      assert(!next.enabled);
      throw failure;
    };
    await next.before();
    await assert.rejects(h.send(2, h.packet, next), (error) => error === failure);
    settled(h);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

test('a changing footprint or unknown bitmap/texture consumer keeps ordinary publication', async () => {
  const h = await setup();
  try {
    const config = h.config.slice();
    new DataView(config.buffer).setUint32(4, 47, true);
    assert.equal(h.world.text.beginPublication(h.task, config), null);
    assert.equal(h.world.text.beginPublication(h.task, h.config, [4, 5]), null);
    assert.equal(h.world.text.beginPublication(h.task, h.config, [3, 5], 0), null);
    for (const [owner, key] of [
      [h.vram, 'pixels'],
      [h.vram, 'frame'],
      [h.vram, 'blit'],
      [h.vram, 'changed'],
      [h.world.graphics.texturePages, 'upload'],
    ]) {
      let reads = 0;
      Object.defineProperty(owner, key, {
        configurable: true,
        get() {
          reads++;
          throw Error('unknown accessor must not be evaluated');
        },
      });
      assert.equal(h.world.text.beginPublication(h.task, h.config), null);
      assert.equal(reads, 0);
      delete owner[key];
    }
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

test('a new failing provider runs only after the older owned request is complete', async () => {
  const h = await setup();
  try {
    const before = nativeBitmapState(h.vram).revision,
      batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    const failure = new Error('new publication provider failed');
    let calls = 0;
    h.world.graphics.output = () => {
      calls++;
      assert.equal(nativeBitmapState(h.vram).revision, before + 1);
      throw failure;
    };
    await batch.before();
    assert.equal(calls, 0);
    assert.equal(nativeBitmapState(h.vram).revision, before + 1);
    await assert.rejects(h.send(4), (e) => e === failure);
    assert.equal(calls, 1);
    settled(h);
    delete h.world.graphics.output;
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

for (const afterAwait of [false, true])
  for (const site of ['output', 'ensureVRAM', 'pixels', 'frame', 'blit', 'changed', 'upload'])
    test(`replaced ${site} reenters native/raw reads after settling its predecessor: await=${afterAwait}`, async () => {
      const results = [];
      for (const transaction of [false, true]) {
        const h = await setup();
        try {
          const batch = transaction ? h.world.text.beginPublication(h.task, h.config) : null;
          if (transaction) assert(batch);
          await h.send(4, null, batch);
          const owner = ['output', 'ensureVRAM'].includes(site)
              ? h.world.graphics
              : site === 'upload'
                ? h.world.graphics.texturePages
                : h.vram,
            original = owner[site],
            seen = [];
          owner[site] = async function (...args) {
            if (afterAwait) await Promise.resolve();
            assert.equal(h.world.text.flushingPublication, null);
            const reply = await h.world.runtime.native(
              'main',
              0,
              [],
              { debug: null, pc: 0 },
              h.world.main,
            );
            // Read through the original pixel method if that is the provider replaced
            // here, so this is real native/VRAM reentry rather than wrapper recursion.
            const pixels =
              site === 'pixels' ? await Reflect.apply(original, h.vram, []) : await h.vram.pixels();
            assert(
              pixels
                .subarray((5 * h.vram.width + 3) * 4, (5 * h.vram.width + 51) * 4)
                .every((n) => n === 0),
            );
            seen.push(reply);
            return Reflect.apply(original, this, args);
          };
          if (batch) {
            await batch.before();
            assert.equal(seen.length, 0);
          }
          await h.send(4);
          delete owner[site];
          settled(h);
          results.push({
            seen,
            task: h.task.snapshot(),
            writer: h.writer.snapshot(),
            vram: nativeBitmapState(h.vram),
            pages: h.world.graphics.texturePages.snapshot(),
          });
        } finally {
          await h.world.close({ flushFiles: false });
        }
      }
      assert.deepEqual(results[1], results[0]);
    });

test('a captured pixel failure releases the completion barrier without pretending to publish', async () => {
  const h = await setup();
  try {
    const before = nativeBitmapState(h.vram).revision,
      batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    const pixels = batch.pending.frame.rgba;
    structuredClone(pixels.buffer, { transfer: [pixels.buffer] });
    await assert.rejects(h.world.text.flushPublications(), TypeError);
    assert.equal(batch.physicalPublications, 0);
    assert.equal(nativeBitmapState(h.vram).revision, before);
    settled(h);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

for (const mutation of ['resize', 'grow-vram'])
  test(`owned storage ${mutation} settles the old footprint before replacement`, async () => {
    const results = [];
    for (const transaction of [false, true]) {
      const h = await setup();
      try {
        const originalPixels = await nativeBitmapPixels(h.vram),
          batch = transaction ? h.world.text.beginPublication(h.task, h.config) : null;
        if (transaction) assert(batch);
        await h.send(4, null, batch);
        if (mutation === 'resize') await h.vram.resize(160, 96);
        else await h.world.graphics.ensureVRAM(256, 256);
        const target = h.world.graphics.images.get(h.world.graphics.vramHandle);
        settled(h);
        results.push({
          oldBytes: originalPixels.slice(),
          state: structuredClone(target.state),
          pages: h.world.graphics.texturePages.snapshot(),
        });
      } finally {
        await h.world.close({ flushFiles: false });
      }
    }
    assert.deepEqual(results[1], results[0]);
  });

test('a page storage failure keeps the same partial CPU write and propagates its error', async () => {
  const results = [];
  for (const transaction of [false, true]) {
    const h = await setup();
    try {
      const batch = transaction ? h.world.text.beginPublication(h.task, h.config) : null;
      if (transaction) {
        assert(batch);
        await h.send(4, null, batch);
      }
      const page = [...h.world.graphics.texturePages.pages.values()].find(
        (p) => p.x < 51 && p.y < 29 && p.x + p.frame.width > 3 && p.y + p.frame.height > 5,
      );
      structuredClone(page.frame.rgba.buffer, { transfer: [page.frame.rgba.buffer] });
      await assert.rejects(transaction ? h.world.text.flushPublications() : h.send(4), TypeError);
      settled(h);
      if (batch) assert.equal(batch.physicalPublications, 0);
      results.push({
        revision: nativeBitmapState(h.vram).revision,
        pixels: (await h.vram.pixels()).slice(),
        dirty: h.world.graphics.texturePages.dirtyFlags.slice(),
      });
    } finally {
      await h.world.close({ flushFiles: false });
    }
  }
  assert.deepEqual(results[1], results[0]);
});

for (const mutation of ['state', 'release-alias', 'clear-pages', 'release-pages'])
  test(`owned storage ${mutation} commits the older clear before the mutation`, async () => {
    const results = [];
    for (const transaction of [false, true]) {
      const h = await setup();
      try {
        const pixels = await nativeBitmapPixels(h.vram),
          alias = h.world.graphics.images.alias(h.world.graphics.vramHandle),
          batch = transaction ? h.world.text.beginPublication(h.task, h.config) : null;
        if (transaction) assert(batch);
        await h.send(4, null, batch);
        if (mutation === 'state')
          h.vram.state = { ...h.vram.state, rgba: new Uint8ClampedArray(pixels.length).fill(37) };
        if (mutation === 'release-alias') await h.world.graphics.images.release(alias);
        if (mutation === 'clear-pages') h.world.graphics.texturePages.clear(0, 0, 64, 64);
        if (mutation === 'release-pages')
          h.world.graphics.texturePages.releaseRectangle(0, 0, 64, 64);
        settled(h);
        if (batch) assert.equal(batch.physicalPublications, 1);
        results.push({
          original: pixels.slice(),
          current: structuredClone(nativeBitmapState(h.vram)),
          pages: h.world.graphics.texturePages.snapshot(),
        });
        if (mutation !== 'release-alias') await h.world.graphics.images.release(alias);
      } finally {
        await h.world.close({ flushFiles: false });
      }
    }
    assert.deepEqual(results[1], results[0]);
  });

test('retained pixel copying never calls later typed-array species providers', async () => {
  const h = await setup();
  try {
    const batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    let calls = 0;
    Object.defineProperty(batch.pending.frame.rgba, 'constructor', {
      configurable: true,
      get() {
        calls++;
        throw Error('late species provider');
      },
    });
    await h.world.text.flushPublications();
    assert.equal(calls, 0);
    assert.equal(batch.physicalPublications, 1);
    settled(h);
    delete batch.pending.frame.rgba.constructor;
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

for (const held of ['state', 'pixels', 'frame', 'alias', 'page'])
  test(`a preexisting public ${held} alias keeps ordinary publication across await`, async () => {
    const results = [];
    for (const attemptTransaction of [false, true]) {
      const h = await setup();
      let alias;
      try {
        if (held === 'alias') alias = h.world.graphics.images.alias(h.world.graphics.vramHandle);
        const owner = alias ? h.world.graphics.images.get(alias) : h.vram,
          reference =
            held === 'state' || held === 'alias'
              ? owner.state
              : held === 'pixels'
                ? await owner.pixels()
                : held === 'frame'
                  ? await owner.frame()
                  : h.world.graphics.texturePages.frame(0),
          pixels = reference.rgba ?? reference,
          before = reference.revision;
        if (held !== 'page') assert.equal(nativeBitmapStorageOwned(h.vram), false);
        const batch = attemptTransaction ? h.world.text.beginPublication(h.task, h.config) : null;
        assert.equal(batch, null);
        await h.send(4, null, batch);
        await Promise.resolve();
        if (before !== undefined)
          assert.equal(reference.revision, before + Number(held !== 'frame'));
        pixels[0] = 173;
        if (held === 'state' || held === 'alias') {
          reference.revision += 3;
          owner.state = { ...reference, rgba: new Uint8ClampedArray(pixels).fill(37) };
        }
        await h.send(4);
        // A later operation does not revoke a view already returned to a caller.
        assert.equal(h.world.text.beginPublication(h.task, h.config), null);
        results.push({
          heldRevision: reference.revision,
          heldPixels: pixels.slice(),
          current: structuredClone(nativeBitmapState(h.vram)),
          pages: h.world.graphics.texturePages.snapshot(),
        });
        settled(h);
      } finally {
        if (alias) await h.world.graphics.images.release(alias);
        await h.world.close({ flushFiles: false });
      }
    }
    assert.deepEqual(results[1], results[0]);
  });

test('independent copies preserve eligibility, while public borrowing lasts until new storage', async () => {
  const h = await setup();
  try {
    const copy = h.vram.snapshot(),
      clone = h.vram.clone(),
      crop = await h.vram.crop(0, 0, 8, 8),
      pages = h.world.graphics.texturePages.snapshot(),
      checkpoint = h.world.snapshot();
    const savedData = checkpoint.runtime.handles.records.find(([id]) => id === h.vram.dataHandle)[1]
      .value;
    savedData.clip[0] = 77;
    assert.notEqual(nativeBitmapState(h.vram).clip[0], 77);
    copy.rgba.fill(99);
    (await clone.pixels()).fill(98);
    (await crop.pixels()).fill(97);
    pages.pages[0][1].frame.revision += 3;
    assert(nativeBitmapStorageOwned(h.vram));
    let batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    await h.world.text.flushPublications();
    const held = h.vram.state;
    assert.equal(h.world.text.beginPublication(h.task, h.config), null);
    await h.world.graphics.ensureVRAM(256, 256);
    const next = h.world.graphics.images.get(h.world.graphics.vramHandle);
    assert.notEqual(nativeBitmapState(next), held);
    assert.notEqual(nativeBitmapState(next).rgba.buffer, held.rgba.buffer);
    assert(nativeBitmapStorageOwned(next));
    batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    await h.world.text.flushPublications();
    settled(h);
  } finally {
    await h.world.close({ flushFiles: false });
  }
});

test('fresh World texture pages retain their public observation fence', async () => {
  const h = await setup();
  let fresh;
  try {
    const saved = h.world.snapshot();
    fresh = await defaultFESWorld(
      profiles[3],
      { 'font.ttf': fontBytes },
      { initialize: false, glyphs: undefined },
    );
    await fresh.restore(saved);
    const task = fresh.graphics.get(h.task.record.id),
      batch = fresh.text.beginPublication(task, h.config),
      pages = fresh.graphics.texturePages;
    assert(batch);
    await task.message([fresh.main.id, task.firstMessage + 4, 0, 0], { textPublication: batch });
    pages.frame(0);
    assert.equal(batch.physicalPublications, 1);
    assert.equal(batch.enabled, false);
    assert.equal(fresh.text.beginPublication(task, h.config), null);
  } finally {
    await fresh?.close({ flushFiles: false });
    await h.world.close({ flushFiles: false });
  }
});
