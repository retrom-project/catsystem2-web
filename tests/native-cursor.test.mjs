// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeGraphics } from '../src/native/graphics.mjs';
import { NativeHandles } from '../src/native/handles.mjs';

function fixture(backend = 'direct3d') {
  const calls = [],
    visibility = [],
    frames = {
      first: {
        width: 32,
        height: 32,
        canvasWidth: 70,
        canvasHeight: 80,
        offsetX: 7,
        offsetY: 8,
        baseX: 11,
        baseY: 13,
      },
      second: { width: 32, height: 32 },
      large: { width: 40, height: 2 },
    },
    world = {
      profile: 'nekopara-vol3-engine-2.6.1.76',
      game: { width: 100, height: 100, resolveCategory: (name) => (frames[name] ? name : null) },
      input: { x: 20, y: 30 },
      runtime: { handles: new NativeHandles() },
      host: { nativeCursorChanged: (visible) => visibility.push(visible) },
      images: {
        load: async (name) => {
          calls.push(name);
          return {
            frame: () =>
              frames[name] && {
                canvasWidth: frames[name].width,
                canvasHeight: frames[name].height,
                offsetX: 0,
                offsetY: 0,
                baseX: 0,
                baseY: 0,
                bpp: 32,
                ...frames[name],
              },
            decode: async (frame) => {
              frame.rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
            },
          };
        },
      },
    },
    graphics = new NativeGraphics(world);
  graphics.cursor.state.backend = backend;
  return { graphics, cursor: graphics.cursor, world, calls, visibility };
}

test('D3D cursor retains actual valid pixels and hotspot on a failed image change while recording its request', async () => {
  const { cursor, graphics, calls } = fixture();
  try {
    assert.equal(await cursor.setImage('first', 3, 4), 0);
    const first = cursor.state.image,
      backup = cursor.state.backup;
    assert.ok(first);
    assert.ok(backup);
    assert.notEqual(first, backup);
    await cursor.setImage('large', 10, 12);
    assert.equal(cursor.state.image, first);
    assert.deepEqual(cursor.state.hotspot, [3, 4]);
    assert.deepEqual(cursor.state.requestedHotspot, [10, 12]);
    assert.equal(cursor.state.filename, 'large');
    await cursor.setImage('second', 5, 6);
    assert.notEqual(cursor.state.image, first);
    assert.equal(cursor.state.backup, backup);
    assert.throws(() => graphics.images.get(first), /released/);
    assert.deepEqual(calls, ['first', 'large', 'second']);
    await cursor.setImage(null, 1, 2);
    assert.equal(cursor.state.image, 0);
    assert.equal(cursor.state.backup, backup);
    assert.equal(graphics.images.get(backup).width, 32);
  } finally {
    await cursor.close();
  }
  assert.equal(graphics.world.runtime.handles.records.size, 0);
});

test('software cursor drops the old plane before attempting a load and uses the raw rectangle at pointer minus hotspot', async () => {
  const { cursor, graphics } = fixture('software');
  try {
    await cursor.setImage('first', 3, 4);
    const bitmap = graphics.images.get(cursor.state.image),
      calls = [];
    bitmap.context = async () => ({ canvas: 'authored raw bitmap' });
    await cursor.drawItems()[0].draw({ drawImage: (...args) => calls.push(args) });
    assert.deepEqual(calls, [['authored raw bitmap', 17, 26]]);
    assert.equal(cursor.drawItems()[0].priority, 0x7fffffff);
    await cursor.setImage('large', 1, 2);
    assert.equal(graphics.images.get(cursor.state.image).width, 40);
    await cursor.setImage('missing', 4, 5);
    assert.equal(cursor.state.image, 0);
    assert.equal(cursor.state.filename, 'missing');
    assert.deepEqual(cursor.state.requestedHotspot, [4, 5]);
    assert.deepEqual(cursor.drawItems(), []);
  } finally {
    await cursor.close();
  }
});

test('cursor gate, visibility and resource ownership survive a fresh graphics and handle owner', async () => {
  const first = fixture(),
    fresh = fixture();
  try {
    await first.cursor.setImage('first', 3, 4);
    first.cursor.setVisible(false);
    first.graphics.cursorAllowed = 0;
    const saved = first.cursor.snapshot();
    await first.cursor.setImage('second', 5, 6);
    assert.deepEqual(first.cursor.snapshot(), saved);
    assert.deepEqual(first.calls, ['first']);
    assert.deepEqual(first.cursor.drawItems(), []);
    fresh.world.runtime.handles.restore(structuredClone(first.world.runtime.handles.snapshot()));
    fresh.graphics.restore(structuredClone(first.graphics.snapshot()));
    assert.deepEqual(fresh.cursor.snapshot(), saved);
    assert.equal(fresh.graphics.cursorAllowed, 0);
    assert.equal(fresh.graphics.images.get(saved.image).state.offsetX, 7);
    await first.cursor.close();
    assert.equal(fresh.graphics.images.get(saved.image).width, 32);
    fresh.cursor.setVisible(true);
    assert.equal(fresh.cursor.state.visible, false);
    fresh.graphics.cursorAllowed = 1;
    fresh.cursor.setVisible(0xffffffff);
    assert.equal(fresh.cursor.state.visibleWord, 0xffffffff);
    assert.equal(fresh.cursor.drawItems().length, 1);
    assert.equal(fresh.visibility.at(-1), true);
  } finally {
    if (first.cursor.state.image || first.cursor.state.backup) await first.cursor.close();
    await fresh.cursor.close();
  }
});
