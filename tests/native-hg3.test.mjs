// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../oracle/engine-process.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { unpackHG32RGBA, unpackHGPixels } from '../src/formats/hg-codec.mjs';
import { HG3 } from '../src/formats/hg3.mjs';
import { BlobFile, RangeFile } from '../src/files.mjs';
import { SceneImagePreparation } from '../src/native/scene-image-preparation.mjs';
import { authoredHG3, authoredHG3Frames } from './fixtures/hg3.mjs';
import { hg3 } from './helpers.mjs';

const metadata = (frame) =>
  ['width', 'height', 'canvasWidth', 'canvasHeight', 'offsetX', 'offsetY', 'baseX', 'baseY'].map(
    (field) => frame[field],
  );
test('HG3 parts preserve top-down rows, independent alpha, crop metadata and distinct selectors', async () => {
  const frames = authoredHG3Frames(),
    image = new HG3(authoredHG3(frames));
  for (const original of frames) {
    const decoded = await image.decode(image.frame(original.id));
    assert.deepEqual(metadata(decoded), metadata(original));
    assert.deepEqual([...decoded.rgba], [...original.rgba]);
  }
  assert.equal(image.frame(999), undefined);
});

test('HG bit-plane readers reject incomplete short codes and out-of-bounds runs', () => {
  const data = Uint8Array.of(1, 2, 3, 4);
  for (const unpack of [
    (control) => unpackHGPixels(data, control, 1, 1, 4),
    (control) => unpackHG32RGBA(data, control, 1, 1, new Uint32Array(1)),
  ]) {
    // The run length begins in the last two bits and needs a third bit.
    assert.throws(() => unpack(Uint8Array.of(0x89)), /HG control stream exhausted/);
    assert.throws(() => unpack(new Uint8Array(5)), /HG gamma exceeds limit/);
    assert.throws(() => unpack(Uint8Array.of(0x09, 0x05)), /HG invalid pixel run/);
  }
});

test('scene image preparation keeps mount identity and falls back on early demand or worker failure', async (t) => {
  let stopped, decoding, allowDecode, failWorker, workerCount;
  class ImageWorker {
    constructor() {
      workerCount++;
    }
    async postMessage({ bytes }) {
      if (failWorker) {
        this.onerror({ preventDefault() {} });
        return;
      }
      if (allowDecode) {
        decoding.resolve();
        await allowDecode.promise;
      }
      const image = new HG3(bytes);
      image.decode(image.frames[0]).then(
        ({ width, height, rgba }) => this.onmessage?.({ data: { width, height, rgba } }),
        () => this.onmessage?.({ data: null }),
      );
    }
    terminate() {
      stopped.resolve();
    }
  }
  const worker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ImageWorker });
  t.after(() => {
    if (worker) Object.defineProperty(globalThis, 'Worker', worker);
    else delete globalThis.Worker;
  });
  const pixels = Uint8Array.from({ length: 16 }, (_, index) => index * 17),
    bytes = hg3(2, 2, pixels),
    nativeBlob = new Blob([bytes, new Uint8Array(64 * 1024)]),
    encoder = new TextEncoder(),
    rows = ['bg 0 background', 'eg 1 overlay'];
  for (const demand of ['offline', 'ready', 'reading', 'decoding', 'failure', 'named']) {
    const calls = [],
      waitForCache = Promise.withResolvers(),
      readStarted = Promise.withResolvers(),
      waitForRead = Promise.withResolvers();
    const mounts = new Map(
      ['background', 'overlay'].map((name) => {
        const file = new RangeFile(nativeBlob.size, async (offset, size) => {
          calls.push(name);
          if (name === 'background') {
            readStarted.resolve();
            await waitForRead.promise;
          }
          return new Uint8Array(await nativeBlob.slice(offset, offset + size).arrayBuffer());
        });
        return [name, { file, size: nativeBlob.size, offset: 0 }];
      }),
    );
    const mounted = {
      game: { nativeCandidates: (name) => [{ hit: mounts.get(name) }] },
      profile: 'nekopara-vol3-engine-2.6.1.76',
      resourceCache: { pending: 1, lock: waitForCache.promise, entries: [] },
      runtime: { scheduler: { tasks: new Map([[1, { id: 1 }]]) } },
    };
    const preparation = new SceneImagePreparation({
        world: mounted,
        images: { resolve: (name) => name },
        assets: new Map(),
      }),
      history = { value: 0 },
      scene = {
        reader: {
          body: { bytes: new Uint8Array() },
          blockCount: 1,
          blockInfo: () => ({ count: rows.length }),
          type: () => 0x30,
          text: (_block, line) => encoder.encode(rows[line]),
        },
        history: { path: [history] },
      };
    const background = mounts.get('background');
    const foreign = { ...background, file: new BlobFile(nativeBlob) };
    stopped = Promise.withResolvers();
    decoding = Promise.withResolvers();
    allowDecode = demand === 'decoding' ? Promise.withResolvers() : null;
    failWorker = demand === 'failure';
    workerCount = 0;
    preparation.loaded(scene);
    if (demand === 'offline') {
      mounted.prepareSceneWorkers = false;
      assert.equal(preparation.hint(scene, 1, 0), false);
      waitForRead.resolve();
      const image = new HG3(await preparation.read(background));
      assert.equal(preparation.apply(image, image.frames[0]), false);
      assert.deepEqual([...(await image.decode(image.frames[0])).rgba], [...pixels]);
      assert.equal(workerCount, 0);
      assert.deepEqual(calls, ['background']);
      continue;
    }
    assert.equal(preparation.hint(scene, 1, 0), true);
    assert.equal(workerCount, 0);
    assert.deepEqual(calls, []);
    if (demand === 'named') mounted.resourceCache.entries.push({ filename: 'background' });
    mounted.resourceCache.pending = 0;
    waitForCache.resolve();
    if (demand !== 'named') await readStarted.promise;
    assert.equal(workerCount, 0);
    let pending = demand === 'reading' ? preparation.read(background) : null;
    waitForRead.resolve();
    if (demand === 'decoding') {
      await decoding.promise;
      pending = preparation.read(background);
      allowDecode.resolve();
    }
    await stopped.promise;
    if (failWorker) await new Promise(setImmediate);
    const alternate = new HG3(await preparation.read(foreign));
    assert.equal(preparation.apply(alternate, alternate.frames[0]), false);
    const image = new HG3(await (pending ?? preparation.read(background)));
    assert.equal(preparation.apply(image, image.frames[0]), demand === 'ready');
    assert.deepEqual([...(await image.decode(image.frames[0])).rgba], [...pixels]);
    const expected = {
      decoding: ['background'],
      failure: ['background', 'background'],
      named: ['overlay', 'background'],
    }[demand] ?? ['background', 'overlay'];
    assert.deepEqual(calls, expected);
    history.value++;
    const fallback = new HG3(await preparation.read(mounts.get('overlay')));
    assert.equal(preparation.apply(fallback, fallback.frames[0]), false);
    assert.deepEqual(calls, [...expected, 'overlay']);
    preparation.discard(scene);
  }
});

for (const [profile, variable, pixelAt] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x68cd70],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x5638e0],
]) {
  test(
    `${profile} original HG3 parser agrees on every row, split part, selector and metadata field`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        p = engine.process,
        buffers = new NativeDataBuffers(engine),
        frames = authoredHG3Frames(),
        bytes = authoredHG3(frames),
        source = buffers.createPointer(bytes),
        image = new HG3(bytes);
      try {
        for (const original of frames) {
          const wrapper = await buffers.decodeBitmapPointer(source, original.id);
          assert.ok(wrapper);
          try {
            const pointer = p.load(wrapper),
              decoded = await image.decode(image.frame(original.id)),
              nativeMetadata = [4, 8, 28, 32, 36, 40, 48, 52].map(
                (offset) => p.load(pointer + offset) | 0,
              ),
              rgba = [];
            for (let y = 0; y < original.height; y++)
              for (let x = 0; x < original.width; x++) {
                // Query the original image's logical (x,y) accessor. This does
                // not assume its physical allocation's row direction.
                const address = await engine.call(pixelAt, [x, y], pointer),
                  row = p.read(address, 4);
                rgba.push(row[2], row[1], row[0], row[3]);
              }
            assert.deepEqual(nativeMetadata, metadata(original));
            assert.deepEqual(rgba, [...original.rgba]);
            assert.deepEqual([...decoded.rgba], rgba);
          } finally {
            await buffers.releaseBitmapPointer(wrapper);
          }
        }
        assert.equal(await buffers.decodeBitmapPointer(source, 999), 0);
      } finally {
        buffers.releasePointer(source);
        engine.close();
      }
    },
  );

  test(
    `${profile} decodes a full HG3 bitmap within a bounded native call`,
    { skip: !process.env[variable] },
    async () => {
      const width = 512,
        height = 512,
        pitch = width * 4,
        rgba = new Uint8Array(pitch * height),
        bottomUp = new Uint8Array(rgba.length);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const r = (x * 53 + y * 19) & 255,
            g = (x * 7 + y * 29) & 255,
            b = (x * 13 + y * 31) & 255,
            a = 255 - ((x + y) & 127);
          rgba.set([r, g, b, a], y * pitch + x * 4);
          bottomUp.set([b, g, r, a], (height - y - 1) * pitch + x * 4);
        }
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        p = engine.process,
        buffers = new NativeDataBuffers(engine),
        source = buffers.createPointer(hg3(width, height, rgba));
      let bitmap = 0;
      try {
        p.budget = 12000000;
        bitmap = await buffers.decodeBitmapPointer(source, 0);
        assert.ok(bitmap);
        const image = p.load(bitmap);
        assert.deepEqual(
          [4, 8, 20].map((at) => p.load(image + at)),
          [width, height, pitch],
        );
        assert.deepEqual(p.read(p.load(image + 12), bottomUp.length), bottomUp);
      } finally {
        if (bitmap) await buffers.releaseBitmapPointer(bitmap);
        buffers.releasePointer(source);
        await engine.close();
      }
    },
  );
}
