// SPDX-License-Identifier: MPL-2.0
import { test, expect } from '@playwright/test';
test('mask wipes reveal their two regions at different times and terminate on the new frame', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Transition } = await import('/src/render/transition.mjs'),
      old = new OffscreenCanvas(2, 1),
      canvas = new OffscreenCanvas(2, 1),
      ctx = canvas.getContext('2d');
    old.getContext('2d').fillStyle = '#ff0000';
    old.getContext('2d').fillRect(0, 0, 2, 1);
    const transition = new Transition(
      old,
      10,
      0,
      'rwipe',
      Promise.resolve({
        width: 2,
        height: 1,
        rgba: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
      }),
    );
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 2, 1);
    await transition.composite(ctx, 5);
    const middle = [...ctx.getImageData(0, 0, 2, 1).data];
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 2, 1);
    const done = await transition.composite(ctx, 10);
    return { middle, done, final: [...ctx.getImageData(0, 0, 2, 1).data] };
  });
  expect(result.middle).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
  expect(result.done).toBe(true);
  expect(result.final).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
});
test('WebGL draws BGRA atlases with alpha stencils across consecutive frames and releases its context', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { EmoteGL } = await import('/src/render/emote-gl.mjs'),
      gpu = new EmoteGL(32, 32);
    const model = {
      textures: [
        {
          width: 2,
          height: 2,
          pixels: new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]),
        },
      ],
    };
    const icon = { width: 2, height: 2, left: 0, top: 0, originX: 0, originY: 0 };
    const list = {
      nodes: [
        { transform: [8, 0, 0, 8, 8, 8], parent: -1, box: [0, 0, 1, 1] },
        { transform: [0.5, 0, 0, 1, 0, 0], parent: 0, box: [0, 0, 1, 1] },
      ],
      masks: [[{ node: 1, texture: 0, icon, divisions: 1, opacity: 1, clips: [] }]],
      items: [{ node: 0, texture: 0, icon, divisions: 1, opacity: 1, clips: [0] }],
    };
    const gl = gpu.gl,
      left = new Uint8Array(4),
      right = new Uint8Array(4),
      frames = [];
    for (let i = 0; i < 3; i++) {
      gpu.render(model, list);
      gl.readPixels(10, 15, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, left);
      gl.readPixels(20, 15, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right);
      frames.push({ left: [...left], right: [...right], error: gl.getError() });
    }
    gpu.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { frames, disposed: gl.isContextLost() };
  });
  for (const frame of result.frames) {
    expect(frame.left).toEqual([255, 0, 0, 255]);
    expect(frame.right).toEqual([0, 0, 0, 0]);
    expect(frame.error).toBe(0);
  }
  expect(result.disposed).toBe(true);
});
test('IndexedDB saves survive a new store instance, remain scoped by content and cannot overwrite copy identity', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SaveStore } = await import('/src/saves.mjs'),
      first = new SaveStore('content-a', 'catsystem2-public-tests');
    await first.open();
    await first.put(0, { story: 'state', variables: { 1: 42 } }, { title: 'Slot 0' });
    first.close();
    const second = new SaveStore('content-a', 'catsystem2-public-tests');
    await second.open();
    const saved = second.get(0);
    await second.put(1, saved.data, saved);
    const copied = second.get(1);
    second.close();
    const other = new SaveStore('content-b', 'catsystem2-public-tests');
    await other.open();
    const count = other.records.size;
    other.close();
    return { data: saved.data, copyKey: copied.key, copySlot: copied.slot, otherCount: count };
  });
  expect(result.data.variables['1']).toBe(42);
  expect(result.copyKey).toBe('content-a:1');
  expect(result.copySlot).toBe(1);
  expect(result.otherCount).toBe(0);
});
test('HTTP files request exact byte ranges and reject a full-response server', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { HTTPFile } = await import('/src/files.mjs'),
      head = await fetch('/src/binary.mjs', { method: 'HEAD' });
    const file = new HTTPFile('/src/binary.mjs', Number(head.headers.get('content-length'))),
      bytes = await file.read(0, 7);
    const original = globalThis.fetch;
    let rejected = false;
    try {
      globalThis.fetch = async () => new Response(new Uint8Array(100));
      await file.read(0, 7);
    } catch {
      rejected = true;
    } finally {
      globalThis.fetch = original;
    }
    return { text: new TextDecoder().decode(bytes), rejected };
  });
  expect(result.text).toBe('// SPDX');
  expect(result.rejected).toBe(true);
});
