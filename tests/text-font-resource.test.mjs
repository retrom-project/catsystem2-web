// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDataBuffers } from '../src/native/data-buffer.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { nativeText, NativeTextTask } from '../src/native/text-task.mjs';

test('text image-font assignment routes JS bytes and consumes the source only at an initialized receiver', async () => {
  const buffers = new NativeDataBuffers({ handles: new NativeHandles() }),
    bytes = Uint8Array.of(1, 2, 3),
    pointer = buffers.createPointer(bytes),
    handle = buffers.handle(pointer),
    calls = [];
  const task = {
    text: { writer: null },
    firstMessage: 449,
    mode: 'cp932',
    world: { profile: 'nekopara-vol3-engine-2.6.1.76' },
    service: { runtime: async () => ({ bindings: () => ({}) }) },
    memory: () => null,
    writer: async () => null,
  };
  const world = {
    runtime: { imageDataBuffers: buffers },
    getNativeFeature() {
      throw Error('Text must not request an EXE projection');
    },
    sendNativeEngine: async (target, sender, message, w, l, context) => {
      calls.push({ target, sender, message, w, l, context });
      await NativeTextTask.prototype.message.call(task, [sender, message, w, l], context);
    },
  };
  await nativeText(0x26c, [11, handle], {}, { id: 7 }, world);
  assert(buffers.owns(pointer), 'uninitialized receiver does not take ownership');
  const received = [];
  task.writer = async () => ({ userFont: async (b) => received.push(b.slice()) });
  await nativeText(0x26c, [11, handle], {}, { id: 7 }, world);
  assert.deepEqual(received, [bytes]);
  assert.equal(buffers.owns(pointer), false, 'assignment consumes the canonical source reference');
  assert(calls.every((c) => c.l === 0 && c.context.resourceBytes instanceof Uint8Array));
});

test('legacy image-font maps fall back to a blank cell when no 32-bit bitmap is assigned', async () => {
  const { NativeLegacyTextTask } = await import('../src/native/text-legacy.mjs');
  for (const bpp of [null, 2, 3, 4]) {
    const pixels = new Uint8ClampedArray(16 * 16 * 4),
      row = Int32Array.of(65, -1, 0, 0, 8, 8, 0, 0, 0, 0),
      bitmap = {
        width: 16,
        height: 16,
        state: { rgba: pixels },
        pixels: async () => pixels,
        async changed() {},
      },
      glyphs = {
        measure() {
          throw Error('Mapped cell must not measure a GDI glyph');
        },
        glyph() {
          throw Error('Mapped cell must not raster a GDI glyph');
        },
      },
      task = {
        text: { rows: [row], w: () => 0 },
        bitmap: 1,
        imageFont:
          bpp === null
            ? null
            : { bpp, width: 2, height: 2, rgba: new Uint8ClampedArray(16).fill(255) },
        glyphMap: new Map([[65, [0, 0, 2, 2]]]),
        world: {
          graphics: { images: { get: () => bitmap } },
          getNativeFeature: async () => ({ glyphs }),
        },
      };
    await NativeLegacyTextTask.prototype.raster.call(task, 1);
    assert.equal(row[9], 1, 'a blank cell still completes reveal');
    assert.equal(
      bitmap.state.rgba.some((value, index) => index % 4 === 3 && value !== 0),
      bpp === 4,
    );
  }
});
