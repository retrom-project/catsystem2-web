// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { EmoteD3D9 } from '../src/emote/native-d3d.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import {
  com,
  expectedVMRFrame,
  probeVMRSurface,
  profiles,
} from './fixtures/native-vmr-surface.mjs';

const noInterface = 0x80004002;
const invalidCall = 0x8876086c;
const surfaceBusy = 0x887601ae;
const canary = 0x12345678;
const iids = [
  [0, 0, 0xc0, 0x46000000],
  [0xd0223b96, 0x43fdbf7a, 0x3ba4bd92, 0xebb9820d],
  [0x85c31227, 0x4f003de5, 0x1af13a9b, 0xb5188cc3],
  [0x580ca87e, 0x4d541d3c, 0xd3b71d99, 0xce98c2e3],
  [0x05eec05d, 0x43628f7d, 0xbad199b9, 0x04c757f3],
  [0x0cfbaf3a, 0x429a9ff6, 0x79a2b399, 0x9bb8f86a],
  [0x794950f2, 0x458aadfc, 0xa1105e90, 0x3b500b0b],
  [canary, 1, 2, 3],
];
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-d3d9-surface-golden.json', import.meta.url)),
);

async function withDevice(run, options = {}) {
  const p = new PE32Process(await loadUnicorn(), options),
    d = new EmoteD3D9(p, { width: 8, height: 8 }),
    out = p.allocate(304, true);
  const words = (values) => {
    const ptr = p.allocate(values.length * 4, true);
    values.forEach((word, i) => p.store(ptr + i * 4, word));
    return ptr;
  };
  const make = (kind, format = 21, pool = 0, usage = kind === 3 ? 1 : 0) => {
    let parent = 0;
    if (kind === 1 || kind === 3) {
      assert.equal(com(p, d.device, 23, 4, 4, 1, usage, format, pool, out, 0), 0);
      parent = p.load(out);
      assert.equal(com(p, parent, 18, 0, out), 0);
    } else if (kind === 2) assert.equal(com(p, d.device, 28, 4, 4, format, 0, 0, 1, out, 0), 0);
    else if (kind === 4) assert.equal(com(p, d.device, 36, 4, 4, format, pool, out, 0), 0);
    else if (kind === 5) assert.equal(com(p, d.device, 18, 0, 0, 0, out), 0);
    else assert.equal(com(p, d.device, 40, out), 0);
    return { object: p.load(out), parent };
  };
  try {
    const pp = words([8, 8, 22, 1, 0, 0, 3, 1, 1, 1, 80, 1, 0, 0]);
    assert.equal(com(p, d.d3d, 16, 0, 1, 1, 0x20, pp, out), 0);
    await run({ p, d, out, make, words });
  } finally {
    d.close();
    p.close();
  }
}

test('CreateTexture memory pressure returns HRESULT and permits the next resource call', async () => {
  await withDevice(
    ({ p, d, out }) => {
      const objects = d.objects.size;
      assert.equal(com(p, d.device, 23, 1, 1, 1, 0, 21, 0, out, 0), 0);
      assert.equal(com(p, p.load(out), 2), 0);
      // Keep the interface table warm; exhaust the actual guest arena, then
      // leave just enough room for pixels but no room for their COM interface.
      const scratch = p.allocate(64);
      while (true) {
        try {
          p.allocate(16);
        } catch (error) {
          assert.equal(error.message, 'PE32 heap exhausted');
          break;
        }
      }
      p.free(scratch);
      p.store(out, canary);
      assert.equal(com(p, d.device, 23, 4, 4, 1, 0, 21, 0, out, 0), 0x8007000e);
      assert.equal(p.load(out), 0);
      assert.equal(d.objects.size, objects);
      assert.equal(com(p, d.device, 23, 1024, 1024, 1, 0, 21, 0, out, 0), 0x8007000e);
      assert.equal(d.objects.size, objects);
      assert.equal(com(p, d.device, 23, 1, 1, 1, 0, 21, 0, out, 0), 0);
      assert.equal(com(p, p.load(out), 2), 0);
      assert.equal(d.objects.size, objects);
      const allocate = p.allocate;
      p.allocate = () => {
        throw new Error('unrelated memory corruption');
      };
      try {
        assert.throws(
          () => com(p, d.device, 23, 1, 1, 1, 0, 21, 0, out, 0),
          /unrelated memory corruption/,
        );
      } finally {
        p.allocate = allocate;
      }
    },
    { heapSize: 0x10000 },
  );
});

test('Surface9.GetContainer returns the real texture identity and one reference', async () => {
  const source = await readFile(
    new URL('../scripts/native-d3d9-surface-oracle.cpp', import.meta.url),
  );
  assert.equal(createHash('sha256').update(source).digest('hex'), golden.sourceSHA256);
  await withDevice(({ p, d, out, make, words }) => {
    const addresses = iids.map(words);
    for (const kind of [1, 3]) {
      const { object, parent } = make(kind);
      for (const [surfaceKind, index, status, identity, references] of golden.containers) {
        if (surfaceKind !== kind) continue;
        p.store(out, canary);
        assert.equal(com(p, object, 11, addresses[index], out), status);
        assert.equal(p.load(out), identity === 2 ? parent : 0);
        if (!status) assert.equal(com(p, p.load(out), 2), references);
      }
      assert.equal(com(p, parent, 2), 1);
      assert.equal(com(p, object, 11, addresses[2], out), 0);
      assert.equal(com(p, p.load(out), 2), 1);
      assert.equal(com(p, object, 11, addresses[2], 0), 0x80004003);
      assert.equal(com(p, object, 11, 0, out), 0x80004003);
      assert.equal(com(p, object, 2), 0);
      assert.equal(d.objects.has(parent), false);
      assert.equal(d.objects.has(object), false);
    }
    for (const kind of [2, 4, 6]) {
      const { object } = make(kind);
      assert.equal(com(p, object, 11, addresses[1], out), 0);
      assert.equal(p.load(out), d.device);
      assert.equal(com(p, p.load(out), 2), 1);
      assert.equal(com(p, object, 11, addresses[2], out), noInterface);
      assert.equal(p.load(out), 0);
      com(p, object, 2);
    }
    const { object } = make(5);
    assert.equal(com(p, object, 11, addresses[2], out), noInterface);
    assert.equal(p.load(out), 0);
    assert.throws(() => com(p, object, 11, addresses[6], out), /implicit swap chain/);
  });
});

const texel = (x, y) =>
  ((0x20 + 7 * y + 13 * x) << 24) |
  ((0x10 + 31 * y + 6 * x) << 16) |
  ((0x08 + 5 * y + 37 * x) << 8) |
  (0x17 + 9 * y + 28 * x);
const clear = 0x914a3826;
const pixelWords = Array.from({ length: 16 }, (_, i) => texel(i % 4, i >> 2));
const all = [0, 0, 4, 4];

test('StretchRect matches Wine color transfers and preserves untouched guest pixels', async () => {
  await withDevice(({ p, d, out, make, words }) => {
    assert.equal(com(p, d.device, 7, out), 0);
    assert.equal(p.load(out + 208) & 0x10, 0x10);
    assert.equal(p.load(out + 240), 0x03000300);
    for (const row of golden.stretch) {
      const [from, to, format, target, pool, targetPool, filter, flags, hr, src, dst, expected] =
        row;
      const source = make(from, format, pool),
        destination = flags & 4 ? source : make(to, target, targetPool),
        a = d.surfaceData(source.object),
        b = d.surfaceData(destination.object);
      const packed = (record) =>
        Array.from({ length: 16 }, (_, i) => p.load(record.pixels + i * 4));
      pixelWords.forEach((pixel, i) => p.store(a.pixels + i * 4, pixel));
      if (a !== b) pixelWords.forEach((_, i) => p.store(b.pixels + i * 4, clear));
      if (flags & 8) assert.equal(com(p, d.device, 41), 0);
      if (flags & 16) assert.equal(com(p, source.object, 13, out, 0, 0), 0);
      if (flags & 32) assert.equal(com(p, destination.object, 13, out, 0, 0), 0);
      const revision = b.revision,
        status = com(
          p,
          d.device,
          34,
          source.object,
          src ? words(src) : 0,
          destination.object,
          dst ? words(dst) : 0,
          filter,
        );
      // The Windows conformance suite rejects RT/texture to offscreen and
      // the API excludes same-surface scaling. Wine8 permits both.
      const invalid =
        (!b.usage && (a.usage || a.kind === 'Texture9')) ||
        (a === b &&
          src &&
          (src[2] - src[0] !== dst[2] - dst[0] || src[3] - src[1] !== dst[3] - dst[1]));
      assert.equal(status, invalid ? invalidCall : hr, JSON.stringify(row.slice(0, 11)));
      if (status) {
        assert.equal(b.revision, revision);
        assert.deepEqual(packed(b), a === b ? pixelWords : new Array(16).fill(clear));
      } else {
        const mask = target === 22 ? 0x00ffffff : 0xffffffff;
        for (const [index, pixel] of packed(b).entries()) {
          if ((pixel & mask) === (expected[index] & mask)) continue;
          const s = src ?? all,
            t = dst ?? all,
            x = index % 4,
            y = index >> 2;
          assert.ok(x >= t[0] && x < t[2] && y >= t[1] && y < t[3], 'Untouched pixel changed');
          if (filter === 2) {
            for (let shift = 0; shift < (target === 22 ? 24 : 32); shift += 8)
              assert.ok(
                Math.abs(((pixel >>> shift) & 255) - ((expected[index] >>> shift) & 255)) <= 1,
                `Linear channel ${index}/${shift}`,
              );
            continue;
          }
          const fx = s[0] + ((x - t[0] + 0.5) * (s[2] - s[0])) / (t[2] - t[0]),
            fy = s[1] + ((y - t[1] + 0.5) * (s[3] - s[1])) / (t[3] - t[1]);
          assert.ok(Number.isInteger(fx) || Number.isInteger(fy), `Nearest texel ${index}`);
          const samples = [Math.floor(fx), Math.ceil(fx) - 1].flatMap((sx) =>
            [Math.floor(fy), Math.ceil(fy) - 1].map(
              (sy) => (texel(sx, sy) | (format === 22 ? 0xff000000 : 0)) & mask,
            ),
          );
          assert.ok(samples.includes(pixel & mask) && samples.includes(expected[index] & mask));
        }
      }
      if (a !== b) assert.deepEqual(packed(a), pixelWords);
      if (flags & 16) assert.equal(com(p, source.object, 14), 0);
      if (flags & 32) assert.equal(com(p, destination.object, 14), 0);
      if (flags & 8) assert.equal(com(p, d.device, 42), 0);
      for (const item of a === b ? [source] : [source, destination]) {
        com(p, item.object, 2);
        if (item.parent) com(p, item.parent, 2);
      }
    }
    const dynamic = make(1, 21, 0, 0x200),
      source = make(2);
    assert.equal(com(p, d.device, 34, source.object, 0, dynamic.object, 0, 0), invalidCall);
    assert.ok(golden.stretch.some((row) => row[8] === surfaceBusy));
  });
});

for (const profile of profiles)
  test(
    `${profile[0]} original VMR PresentImage copies both decoder surface kinds through stdcall`,
    { skip: !process.env[profile[1]] },
    async () => {
      const result = await probeVMRSurface(
        profile,
        new Uint8Array(await readFile(process.env[profile[1]])),
      );
      assert.equal(result.constructed, true);
      assert.equal(result.originalSlot, true);
      assert.equal(result.destroyed, true);
      assert.deepEqual(result.calls, [2, 2, 1, 1]);
      const expected = (format) => ({
        status: 0,
        bytes: expectedVMRFrame(format),
        gpu: null,
        flags: [1, 1],
        refs: result.before,
      });
      assert.deepEqual(result.before, [2, 1, 1, 2, 1]);
      assert.deepEqual(result.texture, expected(21));
      assert.deepEqual(result.plain, expected(22));
      assert.deepEqual(result.freshPlain, result.plain);
      assert.deepEqual(result.restored, {
        bytes: result.texture.bytes,
        gpu: null,
        refs: result.before,
      });
    },
  );
