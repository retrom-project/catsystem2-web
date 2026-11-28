// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeBitmap } from '../src/native/image.mjs';

function bitmap(pixels, width, height, { offset = 0, shared = false, resizable = false } = {}) {
  const size = pixels.length + offset,
    buffer = shared
      ? new SharedArrayBuffer(size)
      : new ArrayBuffer(size, resizable ? { maxByteLength: size * 2 } : undefined),
    view = new Uint8ClampedArray(buffer, offset, pixels.length),
    image = new NativeBitmap(null, { width, height, bpp: 4, rgba: null, source: null });
  view.set(pixels);
  image.state.rgba = view;
  return image;
}

// A one-byte view offset forces the scalar compositor. Compare complete output
// bytes and state against ordinary aligned rows without duplicating its math.
test('ordinary RGBA rows match scalar storage for clipped, flipped and transparent pixels', async () => {
  let seed = 0x5ef71329;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
    alphas = [0, 1, 127, 128, 254, 255];
  for (let n = 0; n < 384; n++) {
    const sw = 3 + (random() % 16),
      sh = 2 + (random() % 8),
      dw = 5 + (random() % 20),
      dh = 3 + (random() % 10),
      input = Uint8ClampedArray.from({ length: sw * sh * 4 }, () => random() >>> 24),
      initial = Uint8ClampedArray.from({ length: dw * dh * 4 }, () => random() >>> 24);
    for (let i = 3; i < input.length; i += 4) input[i] = alphas[random() % alphas.length];
    for (let i = 3; i < initial.length; i += 4) initial[i] = alphas[random() % alphas.length];
    if (n % 3 === 0) initial.fill(0);
    const options = {
        dx: (n % 7) - 2,
        dy: (n % 5) - 1,
        sx: (n % 4) - 1,
        sy: (n % 3) - 1,
        width: 2 + (n % 19),
        height: 1 + (n % 11),
        alpha: [0, 1, 127, 128, 254, 255, 256, 65535, -1, 65536, NaN][n % 11],
        flipY: Boolean(n & 1),
      },
      source = bitmap(input, sw, sh),
      destination = bitmap(initial, dw, dh),
      scalarSource = bitmap(input, sw, sh, { offset: 1 }),
      scalarDestination = bitmap(initial, dw, dh, { offset: 1 });
    assert.equal(
      await destination.blit(source, options),
      await scalarDestination.blit(scalarSource, options),
    );
    assert.deepEqual(destination.state, scalarDestination.state, `whole bitmap case ${n}`);
    assert.deepEqual(source.state.rgba, input, 'source remains independent');
  }
});

test('unknown opacity and pixel methods retain every scalar callback and its order', async () => {
  const input = new Uint8ClampedArray(24).fill(255),
    initial = new Uint8ClampedArray(24),
    source = bitmap(input, 3, 2),
    destination = bitmap(initial, 3, 2);
  let opacityReads = 0;
  await destination.blit(source, {
    alpha: {
      valueOf() {
        opacityReads++;
        return 255 - opacityReads;
      },
    },
  });
  assert.equal(opacityReads, 6);
  const pixels = destination.state.rgba,
    set = pixels.set;
  let writes = 0;
  pixels.set = function (...args) {
    writes++;
    return Reflect.apply(set, this, args);
  };
  await destination.blit(source);
  assert.equal(writes, 6);
  delete pixels.set;
  // An ordinary live geometry getter can install a callback between rows.
  let widthReads = 0;
  Object.defineProperty(source, 'width', {
    get() {
      widthReads++;
      if (widthReads === 4)
        pixels.set = function (...args) {
          writes++;
          return Reflect.apply(set, this, args);
        };
      return 3;
    },
  });
  writes = 0;
  await destination.blit(source);
  assert.equal(widthReads, 4);
  assert.equal(writes, 3, 'the second row observes the newly installed callback');
});

test('shared, resizable, fractional and aliased storage keep complete scalar results', async () => {
  const input = Uint8ClampedArray.from({ length: 48 }, (_, i) => (i * 13) & 255),
    initial = new Uint8ClampedArray(48);
  for (const storage of [{ shared: true }, { resizable: true }, {}])
    for (const options of [{ alpha: 128 }, { sx: 0.25, dx: 0.5, width: 2.5 }, { flipY: true }]) {
      const source = bitmap(input, 4, 3, storage),
        destination = bitmap(initial, 4, 3, storage),
        scalarSource = bitmap(input, 4, 3, { offset: 1 }),
        scalarDestination = bitmap(initial, 4, 3, { offset: 1 });
      const attempt = async (target, input) => {
        try {
          return { result: await target.blit(input, options) };
        } catch (error) {
          return { error: { name: error.name, message: error.message } };
        }
      };
      assert.deepEqual(
        await attempt(destination, source),
        await attempt(scalarDestination, scalarSource),
      );
      assert.deepEqual(destination.state, scalarDestination.state);
    }
  const a = bitmap(input, 4, 3),
    alias = bitmap(initial, 4, 3),
    ordinary = bitmap(input, 4, 3, { offset: 1 }),
    scalarAlias = bitmap(initial, 4, 3, { offset: 1 });
  alias.state.rgba = a.state.rgba.subarray();
  scalarAlias.state.rgba = ordinary.state.rgba.subarray();
  await alias.blit(a, { dx: 1, width: 3 });
  await scalarAlias.blit(ordinary, { dx: 1, width: 3 });
  assert.deepEqual(alias.state, scalarAlias.state);
  await a.blit(a, { dy: 1, height: 2 });
  await ordinary.blit(ordinary, { dy: 1, height: 2 });
  assert.deepEqual(a.state, ordinary.state);
});
