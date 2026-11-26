// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { textConfig, packTextConfiguration } from '../src/native/text-config.mjs';
import { nativeTextPublicationWriter } from '../src/native/text.mjs';
import { NativeScreenCapture } from '../src/native/screen-capture.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

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

for (const profile of profiles)
  test(`${profile} owned FT clear messages keep results and pixels with one final publication`, async () => {
    const h = await setup(profile);
    let fresh;
    try {
      const before = h.vram.state.revision,
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
      assert.equal(h.vram.state.revision, before);
      assert.throws(() => h.world.text.snapshot(), /settled publication/);
      await h.world.text.flushPublications();
      settled(h);
      assert.equal(h.vram.state.revision, before + 4);
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
        h.vram.state.rgba
          .subarray((5 * h.vram.width + 3) * 4, (5 * h.vram.width + 51) * 4)
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
  'pixels',
  'frame',
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
      const before = h.vram.state.revision,
        batch = h.world.text.beginPublication(h.task, h.config);
      assert(batch);
      await h.send(4, null, batch);
      assert.equal(h.vram.state.revision, before);
      if (boundary === 'pixels') await h.vram.pixels();
      if (boundary === 'frame') await h.vram.frame();
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
            assert.equal(h.vram.state.revision, before + 1);
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
      assert(h.vram.state.revision >= before + 1);
      assert.equal(batch.enabled, false);
      settled(h);
    } finally {
      await h.world.close({ flushFiles: false });
    }
  });

test('GDI/custom readiness, image fonts and replaced frame methods retain the full fallback', async () => {
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
    h.writer.fontImages.set(65, null);
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
      ar = av.state.revision,
      br = bv.state.revision;
    control.text.beginPublication = () => null;
    await a.task.player.notify('CLEAR');
    await a.task.syncObjects();
    await b.task.player.notify('CLEAR');
    await b.task.syncObjects();
    assert.equal(av.state.revision - ar, 4);
    assert.equal(bv.state.revision - br, 4);
    assert.deepEqual(await av.pixels(), await bv.pixels());
    assert.deepEqual(av.state, bv.state);
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

test('a pending clear reasserts its full footprint while retaining outside raw VRAM writes', async () => {
  const h = await setup();
  try {
    const raw = await h.vram.pixels(),
      inside = (5 * h.vram.width + 3) * 4,
      batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    raw[0] = 173;
    raw[inside] = 211;
    await h.world.text.flushPublications();
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
      before = vram.state.revision;
    await strings.command(h.instance, object, 'clear');
    const layout = strings.layout(object);
    layout.profiles.prof = { index: -1, bytes: Uint8Array.of(65) };
    strings.saveLayout(object, layout);
    object.nativeTextState.dirty = true;
    await assert.rejects(strings.drive(h.instance, object), TypeError);
    assert.equal(vram.state.revision, before + 3);
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
      assert(h.vram.state.rgba.subarray(offset, offset + 48 * 4).every((n) => n === 0));
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

test('a failed final publication releases its barrier and propagates the provider error', async () => {
  const h = await setup();
  try {
    const batch = h.world.text.beginPublication(h.task, h.config);
    assert(batch);
    await h.send(4, null, batch);
    const failure = new Error('publication provider failed');
    h.world.graphics.output = () => {
      throw failure;
    };
    await assert.rejects(batch.before(), (error) => error === failure);
    assert.equal(batch.enabled, false);
    settled(h);
    delete h.world.graphics.output;
    await h.send(4);
    assert(
      h.vram.state.rgba
        .subarray((5 * h.vram.width + 3) * 4, (5 * h.vram.width + 51) * 4)
        .every((n) => n === 0),
    );
  } finally {
    await h.world.close({ flushFiles: false });
  }
});
