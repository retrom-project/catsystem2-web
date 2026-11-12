// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { binaryIdentity } from '../src/identity.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { nativeCategoryFilename, readNativeResource } from '../src/native/resource-file.mjs';
import { encodeNativeCP932, decodeNativeCP932 } from '../src/native/cp932.mjs';
import { PNG } from '../src/formats/png.mjs';
import { EffekseerResources, effekseerTextureBasename } from '../src/effekseer/resources.mjs';
import { authoredEffect } from './fixtures/effekseer/authored-effect.mjs';
const text = (s) => new TextEncoder().encode(s);
function kif(entries) {
  const data = new Uint8Array(
      8 + entries.length * 72 + entries.reduce((n, [, b]) => n + b.length, 0),
    ),
    view = new DataView(data.buffer);
  data.set(text('KIF\0'));
  view.setUint32(4, entries.length, true);
  let at = 8 + entries.length * 72;
  for (const [i, [name, bytes]] of entries.entries()) {
    data.set(encodeNativeCP932(name), 8 + i * 72);
    view.setUint32(8 + i * 72 + 64, at, true);
    view.setUint32(8 + i * 72 + 68, bytes.length, true);
    data.set(bytes, at);
    at += bytes.length;
  }
  return data;
}
const startup =
  '<?xml version="1.0" encoding="utf-8"?><document><INT><int00><name>efk</name><int>effects.int</int><ext>efk</ext></int00><int01><name>efktex</name><int>textures.int</int><ext>png</ext><dir>loose</dir></int01></INT></document>';
async function setup({
  missingTexture = false,
  badVersion = false,
  malformed = false,
  patched = false,
} = {}) {
  const image = await readFile(
    new URL('./fixtures/effekseer/public-1.23/Particle01.png', import.meta.url),
  );
  let effect = authoredEffect({
    encodedVersion: badVersion ? 10 : 9,
    colorPaths: ['Texture/火花.png', 'Other/火花.png'],
    soundPaths: ['Sound/not-installed.wav'],
    modelPaths: ['Model/not-installed.efkmodel'],
  });
  if (malformed) effect = effect.subarray(0, effect.length - 4);
  const entries = new Map([
    ['startup.xml', text(startup)],
    [
      'effects.int',
      kif([
        ['spark.efk', effect],
        ['other.efk', effect],
      ]),
    ],
    ['textures.int', kif(missingTexture ? [] : [['火花.png', image]])],
  ]);
  if (patched) entries.set('update01.int', kif([['火花.png', image]]));
  const game = new GameFiles(
    new Map([...entries].map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))])),
  );
  await game.open();
  const reads = [],
    disposed = [],
    warnings = [],
    world = { game };
  let decodes = 0;
  const service = new EffekseerResources({
    resolveCategory: (name, category) => nativeCategoryFilename(game, name, category),
    readNative: async (name, mode) => {
      reads.push([name, mode]);
      return readNativeResource(world, name, mode);
    },
    roundTripCP932: (name) => decodeNativeCP932(encodeNativeCP932(name)),
    identify: binaryIdentity,
    decodeTexture: async (bytes) => {
      decodes++;
      const png = new PNG(bytes);
      return { width: png.width, height: png.height, rgba: await png.decode() };
    },
    disposeTexture: (frame) => disposed.push(frame),
    onWarning: (warning) => warnings.push(warning),
  });
  return {
    service,
    game,
    reads,
    disposed,
    warnings,
    get decodes() {
      return decodes;
    },
  };
}
test('category names retain explicit png extension and original texture basename rules', async () => {
  const s = await setup(),
    asset = await s.service.load('spark');
  assert.equal(asset.resolved, 'effects.int/spark.efk');
  assert.equal(asset.textures.color[0].resolved, 'textures.int/火花.png');
  assert.deepEqual(s.reads, [
    ['effects.int/spark.efk', 3],
    ['textures.int/火花.png', 3],
    ['textures.int/火花.png', 3],
  ]);
  assert.equal(s.decodes, 1);
  assert.equal(asset.textures.color[0], asset.textures.color[1]);
  assert.ok(asset.textures.color[0].frame.rgba.some((v, i) => i % 4 === 3 && v > 0));
  assert.equal(effekseerTextureBasename('a\\b/c.png'), 'c.png');
  assert.equal(effekseerTextureBasename('/leading.png'), '/leading.png');
  assert.ok(!s.reads.some(([name]) => /not-installed/.test(name)));
  s.service.release(asset.id);
  assert.equal(s.disposed.length, 1);
});
test('actual mounted patch search is delegated rather than rebuilt by EFK', async () => {
  const s = await setup({ patched: true }),
    asset = await s.service.load('effects.int/spark.efk');
  assert.equal(asset.resolved, 'effects.int/spark.efk');
  assert.equal(s.game.nativeCandidates('textures.int/火花.png', 3)[0].archive, 'update01.int');
  assert.ok(asset.textures.color[0].frame.width > 0);
  s.service.release(asset.id);
});
test('shared immutable Effect references outlive a task FILE owner', async () => {
  const s = await setup(),
    a = await s.service.load('spark'),
    b = await s.service.load('spark');
  assert.equal(a, b);
  s.service.retain(a.id);
  s.service.release(a.id);
  s.service.release(a.id);
  assert.equal(s.service.get(a.id).references, 1);
  assert.equal(s.disposed.length, 0);
  s.service.release(a.id);
  assert.equal(s.disposed.length, 1);
  assert.throws(() => s.service.release(a.id), /Unknown Effekseer asset/);
});
test('a missing Effect is null while missing texture remains an explicit missing binding', async () => {
  const s = await setup({ missingTexture: true });
  assert.equal(await s.service.load('absent'), null);
  assert.equal(await s.service.load(''), null);
  const asset = await s.service.load('spark');
  assert.equal(asset.textures.color[0].missing, true);
  assert.equal(asset.textures.color[0].frame, null);
  assert.equal(s.decodes, 0);
  s.service.release(asset.id);
  assert.equal(s.service.assets.size, 0);
});
test('a readable unverified version warns with SHA-bound resource identity', async () => {
  const s = await setup({ badVersion: true }),
    asset = await s.service.load('spark');
  assert.equal(s.warnings.length, 1);
  assert.equal(s.warnings[0].version, 10);
  assert.match(s.warnings[0].identity, /^effects\.int\/spark\.efk@sha256:[a-f0-9]{64}$/);
  s.service.release(asset.id);
});
test('unreadable Effect structure throws and cleans the failed asset', async () => {
  const s = await setup({ malformed: true });
  await assert.rejects(s.service.load('spark'), /SKFE .*requires|SKFE .*invalid count/);
  assert.equal(s.service.assets.size, 0);
  assert.equal(s.service.byID.size, 0);
});
test('resource checkpoint reopens verified assets in a fresh owner without a manager', async () => {
  const before = await setup(),
    asset = await before.service.load('spark');
  before.service.retain(asset.id);
  const state = before.service.snapshot(),
    after = await setup();
  await after.service.restore(structuredClone(state));
  assert.deepEqual(after.service.snapshot(), state);
  assert.equal(after.service.get(asset.id).references, 2);
  assert.equal(after.decodes, 1);
  await assert.rejects(before.service.restore(state), /fresh owner/);
  before.service.release(asset.id);
  before.service.release(asset.id);
  after.service.release(asset.id);
  after.service.release(asset.id);
  assert.equal(before.disposed.length, 1);
  assert.equal(after.disposed.length, 1);
});
test('restore rejects mismatched resource identity and closes its incomplete owner', async () => {
  const before = await setup(),
    asset = await before.service.load('spark'),
    state = before.service.snapshot();
  state.assets[0].sha256 = '0'.repeat(64);
  const after = await setup();
  await assert.rejects(after.service.restore(state), /identity changed/);
  assert.equal(after.service.closed, true);
  assert.equal(after.service.assets.size, 0);
  before.service.release(asset.id);
});
test('fresh restore rejects changed or newly missing texture bindings', async () => {
  const before = await setup(),
    asset = await before.service.load('spark'),
    state = before.service.snapshot();
  const missing = await setup({ missingTexture: true });
  await assert.rejects(missing.service.restore(state), /texture identity changed/);
  assert.equal(missing.service.closed, true);
  const changed = await setup(),
    identify = changed.service.identify;
  changed.service.identify = async (bytes) => {
    const digest = await identify(bytes);
    return bytes[0] === 0x89 ? '0'.repeat(64) : digest;
  };
  await assert.rejects(changed.service.restore(state), /texture identity changed/);
  assert.equal(changed.service.closed, true);
  assert.equal(changed.disposed.length, 1);
  before.service.release(asset.id);
});

test('concurrent loads share one decoded asset with independent owner references', async () => {
  const s = await setup(),
    [a, b] = await Promise.all([s.service.load('spark'), s.service.load('spark')]);
  assert.equal(a, b);
  assert.equal(a.references, 2);
  assert.equal(s.decodes, 1);
  s.service.release(a.id);
  s.service.release(b.id);
  assert.equal(s.service.assets.size, 0);
  assert.equal(s.disposed.length, 1);
});
test('fresh restore preserves live asset IDs after earlier assets were released', async () => {
  const before = await setup(),
    first = await before.service.load('spark'),
    second = await before.service.load('other');
  before.service.release(first.id);
  const replacement = await before.service.load('spark');
  assert.deepEqual([second.id, replacement.id], [2, 3]);
  const state = before.service.snapshot(),
    after = await setup();
  await after.service.restore(state);
  assert.deepEqual(after.service.snapshot(), state);
  assert.equal(after.service.get(second.id).sourceName, 'other');
  assert.equal(after.service.get(replacement.id).sourceName, 'spark');
  before.service.release(second.id);
  before.service.release(replacement.id);
  after.service.release(second.id);
  after.service.release(replacement.id);
});
test('unsupported texture decoding is an operation error rather than missing data', async () => {
  const s = await setup();
  s.service.decodeTexture = async () => {
    throw new Error('Unsupported authored texture structure');
  };
  await assert.rejects(s.service.load('spark'), /Unsupported authored texture structure/);
  assert.equal(s.service.assets.size, 0);
  assert.equal(s.service.textures.size, 0);
});
