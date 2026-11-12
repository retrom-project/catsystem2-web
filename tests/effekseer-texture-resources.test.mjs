// SPDX-License-Identifier: MPL-2.0
// Real mounted resources + default PNG/level0 decoder. This is not a World/GPU test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { binaryIdentity } from '../src/identity.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { nativeCategoryFilename, readNativeResource } from '../src/native/resource-file.mjs';
import { encodeNativeCP932, decodeNativeCP932 } from '../src/native/cp932.mjs';
import { EffekseerResources } from '../src/effekseer/resources.mjs';
import { EffekseerEffectLoads } from '../src/effekseer/effect-loads.mjs';
import { decodeEffekseerTexture } from '../src/effekseer/texture-decoder.mjs';
import { EFFEKSEER_LEVEL0_PROFILE } from '../src/effekseer/texture-level0.mjs';
import { StageRenderer } from '../src/render/stage.mjs';
import { authoredEffect } from './fixtures/effekseer/authored-effect.mjs';

const fixture = JSON.parse(
    await readFile(new URL('./fixtures/effekseer-level0/native-cpu.json', import.meta.url)),
  ).cases.find((item) => item.name === 'npot-wide'),
  image = await readFile(new URL('./fixtures/effekseer-level0/npot-wide.png', import.meta.url)),
  rgbaHash = await binaryIdentity(Uint8Array.from(fixture.rgba)),
  text = (s) => new TextEncoder().encode(s),
  deferred = () => Promise.withResolvers();

function kif(entries) {
  const bytes = new Uint8Array(
      8 + entries.length * 72 + entries.reduce((n, [, b]) => n + b.length, 0),
    ),
    view = new DataView(bytes.buffer);
  bytes.set(text('KIF\0'));
  view.setUint32(4, entries.length, true);
  let at = 8 + entries.length * 72;
  for (const [i, [name, data]] of entries.entries()) {
    bytes.set(encodeNativeCP932(name), 8 + i * 72);
    view.setUint32(8 + i * 72 + 64, at, true);
    view.setUint32(8 + i * 72 + 68, data.length, true);
    bytes.set(data, at);
    at += data.length;
  }
  return bytes;
}
async function setup({
  missing = false,
  textureBytes = image,
  paths = ['a/火花.png', 'b/火花.png'],
  onPixels = null,
  decoder = null,
  dispose = null,
} = {}) {
  const effect = authoredEffect({ colorPaths: paths }),
    entries = new Map([
      [
        'startup.xml',
        text(
          '<?xml version="1.0" encoding="utf-8"?><document><INT><int00><name>efk</name><int>effects.int</int><ext>efk</ext></int00><int01><name>efktex</name><int>textures.int</int><ext>png</ext></int01></INT></document>',
        ),
      ],
      [
        'effects.int',
        kif([
          ['spark.efk', effect],
          ['other.efk', effect],
        ]),
      ],
      [
        'textures.int',
        kif(
          missing
            ? []
            : [
                ['火花.png', textureBytes],
                ['other.png', textureBytes],
              ],
        ),
      ],
    ]),
    game = new GameFiles(
      new Map([...entries].map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))])),
    );
  await game.open();
  const reads = [],
    hashes = [],
    disposed = [],
    backend = [],
    events = [],
    stage = new StageRenderer();
  // Authored lifecycle recorder at the actual StageRenderer release boundary;
  // no browser context, upload or GPU pixels are asserted here.
  stage.gpu = { releaseTextureFrame: (frame) => backend.push(frame), close() {} };
  let resources;
  const options = {
    resolveCategory: (name, category) => nativeCategoryFilename(game, name, category),
    readNative: (name, mode) => {
      reads.push([name, mode]);
      return readNativeResource({ game }, name, mode);
    },
    roundTripCP932: (name) => decodeNativeCP932(encodeNativeCP932(name)),
    identify: async (bytes) => {
      const pixels = bytes.length === fixture.rgba.length;
      hashes.push(pixels ? 'pixels' : 'source');
      if (pixels && onPixels) {
        const injected = await onPixels(bytes, resources);
        if (injected !== undefined) return injected;
      }
      return binaryIdentity(bytes);
    },
    disposeTexture: (frame) => {
      disposed.push(frame);
      events.push('dispose');
      stage.releaseTextureFrame(frame);
      dispose?.(frame);
    },
  };
  if (decoder) options.decodeTexture = (bytes, options) => decoder(bytes, options, resources);
  resources = new EffekseerResources(options);
  const loads = new EffekseerEffectLoads({ resources });
  return {
    resources,
    loads,
    stage,
    reads,
    hashes,
    disposed,
    backend,
    events,
    close() {
      loads.close();
      try {
        resources.close();
      } finally {
        stage.dispose();
      }
    },
  };
}
const storage = (state) => state.assets[0].textures.color[0].storage;
const tokens = (load) => load.textures.color.map((binding) => binding.token?.id ?? null);

test('EFK mounted default decoder preserves source identities, one physical cache and distinct load tokens', async () => {
  const s = await setup();
  try {
    assert.equal(s.resources.decodeTexture, decodeEffekseerTexture);
    const a = await s.loads.load('spark'),
      b = await s.loads.load('spark'),
      source = s.resources.get(a.sourceID),
      physical = source.textures.color[0],
      frame = physical.frame;
    assert.equal(source.textures.color[1], physical);
    assert.equal(s.resources.textures.size, 1);
    assert.equal(s.hashes.filter((kind) => kind === 'pixels').length, 1);
    assert.deepEqual(s.reads, [
      ['effects.int/spark.efk', 3],
      ['textures.int/火花.png', 3],
      ['textures.int/火花.png', 3],
      ['effects.int/spark.efk', 3],
    ]);
    assert.deepEqual(frame, { width: 4, height: 2, rgba: Uint8Array.from(fixture.rgba) });
    assert.equal(physical.sha256, fixture.sourceSHA256);
    assert.equal(physical.resolved, 'textures.int/火花.png');
    assert.equal(physical.rgbaSHA256, rgbaHash);
    assert.notEqual(physical.rgbaSHA256, physical.sha256);
    assert.equal(Object.hasOwn(physical, 'width'), false);
    assert.equal(Object.hasOwn(physical, 'height'), false);
    assert.equal(Object.hasOwn(physical, 'storage'), false);
    assert.deepEqual(tokens(a), [1, 2]);
    assert.deepEqual(tokens(b), [3, 4]);
    assert.equal(a.textures.color[0].frame, b.textures.color[1].frame);
    assert.notEqual(a.textures.color[0].token, b.textures.color[1].token);
    assert.deepEqual(storage(s.resources.snapshot()), {
      profile: { ...EFFEKSEER_LEVEL0_PROFILE },
      width: frame.width,
      height: frame.height,
      rgbaSHA256: rgbaHash,
    });
    const detached = s.resources.snapshot();
    storage(detached).width = 1024;
    storage(detached).profile.format = 22;
    assert.equal(storage(s.resources.snapshot()).width, 4);
    assert.equal(storage(s.resources.snapshot()).profile.format, 21);
    s.loads.release(a.id);
    assert.equal(s.disposed.length, 0);
    s.loads.release(b.id);
    assert.deepEqual(s.disposed, [frame]);
    assert.deepEqual(s.backend, [frame]);
    assert.equal(s.resources.textures.size, 0);
  } finally {
    s.close();
  }
});

test('EFK current checkpoint recomputes source/storage before restoring logical tokens without another load', async () => {
  const a = await setup(),
    b = await setup();
  try {
    await a.loads.load('spark');
    await a.loads.load('spark');
    const saved = await deserializeCheckpoint(
      await serializeCheckpoint({ resources: a.resources.snapshot(), loads: a.loads.snapshot() }),
    );
    await b.resources.restore(saved.resources);
    const reads = structuredClone(b.reads),
      hashes = [...b.hashes];
    b.loads.restore(saved.loads);
    assert.deepEqual(b.reads, reads);
    assert.deepEqual(b.hashes, hashes);
    assert.deepEqual(b.resources.snapshot(), saved.resources);
    assert.deepEqual(b.loads.snapshot(), saved.loads);
    assert.equal(b.hashes.filter((kind) => kind === 'pixels').length, 1);
    assert.notEqual(b.loads.get(1).textures.color[0].frame, a.loads.get(1).textures.color[0].frame);
    assert.equal(b.loads.get(1).textures.color[0].frame, b.loads.get(2).textures.color[1].frame);
    assert.deepEqual(tokens(b.loads.get(1)), [1, 2]);
    assert.deepEqual(tokens(b.loads.get(2)), [3, 4]);
  } finally {
    b.close();
    a.close();
  }
});

for (const [field, value] of [
  ['width', 8],
  ['height', 4],
  ['rgbaSHA256', '0'.repeat(64)],
])
  test(`EFK fresh restore rejects changed physical ${field} and disposes its decoded frame once`, async () => {
    const a = await setup(),
      b = await setup();
    try {
      await a.loads.load('spark');
      const state = a.resources.snapshot();
      storage(state)[field] = value;
      await assert.rejects(b.resources.restore(state), /texture identity changed/);
      assert.equal(b.resources.closed, true);
      assert.equal(b.disposed.length, 1);
      assert.equal(b.resources.textures.size, 0);
      assert.equal(b.resources.assets.size, 0);
    } finally {
      b.close();
      a.close();
    }
  });

test('EFK storage checkpoint rejects unknown profile/layout before any source I/O', async () => {
  const a = await setup();
  try {
    await a.loads.load('spark');
    const original = a.resources.snapshot();
    for (const mutate of [
      (s) => {
        s.profile.format = 22;
      },
      (s) => {
        s.profile.unknown = 1;
      },
      (s) => {
        s.width = 3;
      },
      (s) => {
        s.rgbaSHA256 = 'invalid';
      },
    ]) {
      const b = await setup();
      try {
        const state = structuredClone(original);
        mutate(storage(state));
        await assert.rejects(b.resources.restore(state), /Invalid Effekseer texture checkpoint/);
        assert.equal(b.reads.length, 0);
        assert.equal(b.disposed.length, 0);
        assert.equal(b.resources.closed, false);
      } finally {
        b.close();
      }
    }
  } finally {
    a.close();
  }
});

test('EFK fresh source identity and newly missing bindings remain explicit independent failures', async () => {
  const a = await setup(),
    b = await setup(),
    missing = await setup({ missing: true });
  try {
    await a.loads.load('spark');
    const state = a.resources.snapshot(),
      changed = structuredClone(state);
    changed.assets[0].sha256 = '0'.repeat(64);
    await assert.rejects(b.resources.restore(changed), /asset identity changed/);
    await assert.rejects(missing.resources.restore(state), /texture identity changed/);
    assert.equal(b.disposed.length, 1);
    assert.equal(missing.disposed.length, 0);
    assert.equal(b.resources.closed, true);
    assert.equal(missing.resources.closed, true);
  } finally {
    missing.close();
    b.close();
    a.close();
  }
});

test('EFK missing textures retain null storage and consume no logical texture ID', async () => {
  const s = await setup({ missing: true });
  try {
    const load = await s.loads.load('spark');
    assert.deepEqual(tokens(load), [null, null]);
    assert.equal(s.loads.nextTextureID, 1);
    assert.equal(storage(s.resources.snapshot()), null);
    assert.equal(s.hashes.includes('pixels'), false);
    assert.equal(s.disposed.length, 0);
  } finally {
    s.close();
  }
});

test('EFK real mounted RGB source is not published by the default decoder', async () => {
  const textureBytes = await readFile(
      new URL('./fixtures/effekseer/public-1.23/LaserMain01.png', import.meta.url),
    ),
    s = await setup({ textureBytes });
  try {
    await assert.rejects(s.loads.load('spark'), /Unsupported Effekseer PNG layout/);
    assert.equal(s.resources.textures.size, 0);
    assert.equal(s.resources.assets.size, 0);
    assert.equal(s.disposed.length, 0);
    assert.deepEqual(s.loads.snapshot(), { nextID: 1, nextTextureID: 1, loads: [] });
  } finally {
    s.close();
  }
});

test('EFK a malformed storage digest fails after real decode and retires the frame once', async () => {
  for (const digest of ['invalid', null]) {
    const s = await setup({ onPixels: () => digest });
    try {
      await assert.rejects(s.loads.load('spark'), /level0 storage identity is not SHA-256/);
      assert.equal(s.disposed.length, 1);
      assert.equal(s.resources.textures.size, 0);
      assert.equal(s.resources.assets.size, 0);
      assert.equal(s.loads.bindings.size, 0);
    } finally {
      s.close();
    }
  }
});

test('EFK concurrent failed storage hashes retire one frame and do not poison a retry', async () => {
  let attempt = 0;
  const s = await setup({
    onPixels: () => {
      if (++attempt === 1) throw new Error('Authored hash failure');
    },
  });
  try {
    const first = await Promise.allSettled([s.loads.load('spark'), s.loads.load('spark')]);
    assert.deepEqual(
      first.map((r) => r.status),
      ['rejected', 'rejected'],
    );
    for (const r of first) assert.match(r.reason.message, /Authored hash failure/);
    assert.equal(s.disposed.length, 1);
    assert.equal(s.resources.textures.size, 0);
    assert.equal(s.resources.assets.size, 0);
    assert.equal(s.resources.byID.size, 0);
    assert.deepEqual(s.loads.snapshot(), { nextID: 1, nextTextureID: 1, loads: [] });
    const next = await s.loads.load('spark');
    assert.deepEqual(tokens(next), [1, 2]);
    assert.equal(attempt, 2);
    assert.notEqual(next.textures.color[0].frame, s.disposed[0]);
    assert.deepEqual(Array.from(next.textures.color[0].frame.rgba), fixture.rgba);
    s.loads.release(next.id);
    assert.equal(s.disposed.length, 2);
  } finally {
    s.close();
  }
});

test('EFK partial Effect failure releases prior physical entries and failed frame once', async () => {
  let count = 0;
  const s = await setup({
    paths: ['火花.png', 'other.png'],
    onPixels: () => {
      if (++count === 2) throw new Error('Second storage hash failed');
    },
  });
  try {
    await assert.rejects(s.loads.load('spark'), /Second storage hash failed/);
    assert.equal(s.disposed.length, 2);
    assert.equal(new Set(s.disposed).size, 2);
    assert.equal(s.resources.textures.size, 0);
    assert.equal(s.resources.assets.size, 0);
    assert.equal(s.loads.loads.size, 0);
    assert.equal(s.loads.bindings.size, 0);
    await s.loads.load('spark');
    assert.equal(count, 4);
  } finally {
    s.close();
  }
  assert.equal(s.disposed.length, 4);
});

test('EFK owner close during decoder await disposes late real pixels without publishing tokens', async () => {
  const entered = deferred(),
    gate = deferred();
  const s = await setup({
    decoder: async (bytes, options) => {
      const frame = await decodeEffekseerTexture(bytes, options);
      entered.resolve(frame);
      await gate.promise;
      return frame;
    },
  });
  const pending = s.loads.load('spark');
  const frame = await entered.promise;
  assert.throws(() => s.resources.snapshot(), /settled/);
  s.resources.close();
  assert.equal(s.disposed.length, 0);
  gate.resolve();
  await assert.rejects(pending, /closed/);
  assert.deepEqual(s.disposed, [frame]);
  assert.deepEqual(s.backend, [frame]);
  assert.equal(s.hashes.includes('pixels'), false);
  assert.equal(s.loads.nextTextureID, 1);
  assert.equal(s.loads.loads.size, 0);
  s.close();
  assert.equal(s.disposed.length, 1);
});

test('EFK owner close during hash await retires stored pixels once across parallel callers', async () => {
  const entered = deferred(),
    gate = deferred();
  const s = await setup({
    onPixels: async () => {
      entered.resolve();
      await gate.promise;
    },
  });
  const pending = [s.loads.load('spark'), s.loads.load('spark')];
  await entered.promise;
  assert.throws(() => s.resources.snapshot(), /settled/);
  s.resources.close();
  assert.equal(s.disposed.length, 1);
  gate.resolve();
  for (const p of pending) await assert.rejects(p, /closed/);
  assert.equal(s.disposed.length, 1);
  assert.equal(s.backend.length, 1);
  assert.equal(s.loads.bindings.size, 0);
  assert.equal(s.loads.nextID, 1);
  s.close();
});

test('EFK synchronous decoder reentry can close owner before returning real decoded pixels', async () => {
  const s = await setup({
    decoder: (bytes, options, resources) => {
      const decoded = decodeEffekseerTexture(bytes, options);
      resources.close();
      return decoded;
    },
  });
  await assert.rejects(s.loads.load('spark'), /closed/);
  assert.equal(s.disposed.length, 1);
  assert.equal(s.hashes.includes('pixels'), false);
  assert.equal(s.loads.loads.size, 0);
  s.close();
});

test('EFK synchronous hash reentry closes after frame ownership and disposes once', async () => {
  const s = await setup({ onPixels: (_bytes, resources) => resources.close() });
  await assert.rejects(s.loads.load('spark'), /closed/);
  assert.equal(s.disposed.length, 1);
  assert.equal(s.backend.length, 1);
  s.close();
});

test('EFK release and close sweep remaining frames even when one disposal reports failure', async () => {
  const s = await setup({
    paths: ['火花.png', 'other.png'],
    dispose: () => {
      throw new Error('Authored release failure');
    },
  });
  const asset = await s.resources.load('spark');
  assert.throws(() => s.resources.release(asset.id), /Effect release cleanup failed/);
  assert.equal(s.disposed.length, 2);
  assert.equal(s.resources.textures.size, 0);
  assert.equal(s.resources.assets.size, 0);
  assert.equal(new Set(s.disposed).size, 2);
  s.close();
  assert.equal(s.disposed.length, 2);
  const b = await setup({
    paths: ['火花.png', 'other.png'],
    dispose: () => {
      throw new Error('Authored close failure');
    },
  });
  await b.resources.load('spark');
  assert.throws(() => b.resources.close(), /resource cleanup failed/);
  assert.equal(b.disposed.length, 2);
  assert.equal(b.resources.textures.size, 0);
  b.close();
  assert.equal(b.disposed.length, 2);
});

test('StageRenderer texture release follows its current GPU and becomes inert after dispose', () => {
  const stage = new StageRenderer(),
    frame = {},
    calls = [];
  stage.releaseTextureFrame(frame);
  stage.gpu = { releaseTextureFrame: () => calls.push('old'), close() {} };
  stage.releaseTextureFrame(frame);
  stage.gpu = {
    releaseTextureFrame: () => calls.push('current'),
    close() {
      calls.push('close');
    },
  };
  stage.releaseTextureFrame(frame);
  stage.dispose();
  stage.releaseTextureFrame(frame);
  assert.deepEqual(calls, ['old', 'current', 'close']);
});
