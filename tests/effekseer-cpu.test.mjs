// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { binaryIdentity } from '../src/identity.mjs';
import { PNG } from '../src/formats/png.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { nativeCategoryFilename, readNativeResource } from '../src/native/resource-file.mjs';
import { encodeNativeCP932, decodeNativeCP932 } from '../src/native/cp932.mjs';
import { EffekseerResources } from '../src/effekseer/resources.mjs';
import { EffekseerManagerLifecycle } from '../src/effekseer/manager-lifecycle.mjs';
import { LogicalCRTThreads } from '../src/effekseer/crt-threads.mjs';
import {
  createEffekseerInstanceOperations,
  createEffekseerColorVisitor,
} from '../src/effekseer/instance-operations.mjs';

const official = [
  'Laser01',
  'Laser02',
  'Simple_Ribbon_Parent',
  'Simple_Ring_Shape1',
  'Simple_Track1',
  'Simple_Sprite_FixedYAxis',
  'Simple_Distortion',
  'block_simple',
];
const encoder = new TextEncoder();
function kif(entries) {
  const result = new Uint8Array(
      8 + entries.length * 72 + entries.reduce((n, [, b]) => n + b.length, 0),
    ),
    view = new DataView(result.buffer);
  result.set(encoder.encode('KIF\0'));
  view.setUint32(4, entries.length, true);
  let offset = 8 + entries.length * 72;
  for (const [i, [name, bytes]] of entries.entries()) {
    result.set(encodeNativeCP932(name), 8 + i * 72);
    view.setUint32(8 + i * 72 + 64, offset, true);
    view.setUint32(8 + i * 72 + 68, bytes.length, true);
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}
let mountedInputs;
async function inputs() {
  if (mountedInputs) return mountedInputs;
  const manifest = JSON.parse(
      await readFile(new URL('./fixtures/effekseer/public-1.23-manifest.json', import.meta.url)),
    ),
    effects = [],
    textures = [];
  for (const entry of manifest) {
    const name = entry.path.split('/').at(-1);
    if (!/\.(efk|png)$/.test(name)) continue;
    const bytes = await readFile(
      new URL(`./fixtures/effekseer/public-1.23/${name}`, import.meta.url),
    );
    (name.endsWith('.efk') ? effects : textures).push([name, bytes]);
  }
  effects.push([
    'authored.efk',
    await readFile(new URL('./fixtures/effekseer/authored-particles-v9.efk', import.meta.url)),
  ]);
  textures.push([
    'authored-spark.png',
    await readFile(new URL('./fixtures/effekseer/authored-spark.png', import.meta.url)),
  ]);
  const startup =
    '<?xml version="1.0" encoding="utf-8"?><document><INT><int00><name>efk</name><int>effects.int</int><ext>efk</ext></int00><int01><name>efktex</name><int>textures.int</int><ext>png</ext></int01></INT></document>';
  mountedInputs = [
    ['startup.xml', encoder.encode(startup)],
    ['effects.int', kif(effects)],
    ['textures.int', kif(textures)],
  ];
  return mountedInputs;
}
async function setup() {
  const game = new GameFiles(
    new Map((await inputs()).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))])),
  );
  await game.open();
  const world = { game },
    reads = [],
    disposed = [];
  const resources = new EffekseerResources({
      resolveCategory: (name, category) => nativeCategoryFilename(game, name, category),
      readNative: (name, mode) => {
        reads.push(name);
        return readNativeResource(world, name, mode);
      },
      roundTripCP932: (name) => decodeNativeCP932(encodeNativeCP932(name)),
      identify: binaryIdentity,
      decodeTexture: async (bytes) => {
        const png = new PNG(bytes);
        return { width: png.width, height: png.height, rgba: await png.decode() };
      },
      disposeTexture: (frame) => disposed.push(frame),
    }),
    threads = new LogicalCRTThreads();
  threads.create('frame');
  threads.create('forced');
  return { resources, threads, reads, disposed };
}
const managerFor = (s) =>
  new EffekseerManagerLifecycle({
    resources: s.resources,
    threads: s.threads,
    instanceOperations: createEffekseerInstanceOperations(),
  });
function packets(manager) {
  const result = [];
  manager.draw(
    createEffekseerColorVisitor({
      manager,
      onInstance: ({ node, instance, output, unavailable }) => {
        result.push({
          kind: node.type,
          id: instance.id,
          age: instance.age,
          matrix: [...new Uint32Array(instance.matrix.buffer)],
          colors: output.colors.map((color) => [...color]),
          allColor: [...output.allColor],
          uv: [...output.uv],
          unavailable,
        });
      },
    }),
  );
  return result;
}
for (const name of [...official, 'authored'])
  test(`${name}: mounted resources drive nonempty CPU state and color packets without a native backend`, async () => {
    const s = await setup(),
      asset = await s.resources.load(name),
      manager = managerFor(s);
    assert.ok(asset);
    const frames = [];
    manager.play(asset.id, [0, 0, 0], 'forced');
    for (let frame = 0; frame < 12; frame++) {
      manager.update('frame');
      const random = s.threads.snapshot(),
        ages = [...manager.instances.values()].map((instance) => [instance.id, instance.age]);
      frames.push(...packets(manager));
      assert.deepEqual(s.threads.snapshot(), random);
      assert.deepEqual(
        [...manager.instances.values()].map((instance) => [instance.id, instance.age]),
        ages,
      );
    }
    assert.ok(frames.length > 0);
    assert.ok(
      frames.some(
        (packet) => packet.allColor[3] > 0 || packet.colors.some((color) => color[3] > 0),
      ),
    );
    assert.ok(frames.every((packet) => packet.uv.every(Number.isFinite)));
    if (name === 'block_simple')
      assert.ok(frames.every((packet) => packet.unavailable === 'verified-null-model-loader'));
    if (name === 'Simple_Distortion')
      assert.ok(
        frames.some((packet) => packet.unavailable === 'verified-null-distortion-background'),
      );
    assert.ok(!s.reads.some((path) => /\.(wav|efkmodel)$/.test(path)));
    const textureFrames = new Set(
      [...s.resources.textures.values()].map((texture) => texture.frame),
    );
    if (textureFrames.size)
      assert.ok(
        [...textureFrames].some((frame) => frame.rgba.some((v, i) => i % 4 === 3 && v > 0)),
      );
    else {
      // These actual Ring/Track/model samples can be untextured. Nonempty CPU
      // colors above remain required; no decoded blank texture substitutes.
      assert.equal(
        ['color', 'normal', 'distortion'].reduce(
          (n, kind) => n + asset.effect.dependencies[kind].length,
          0,
        ),
        0,
      );
      assert.ok(
        asset.effect.nodes.every((node) => !node.texture || node.texture.colorIndex === -1),
      );
    }
    manager.close();
    s.resources.release(asset.id);
    assert.equal(s.resources.assets.size, 0);
    assert.equal(s.resources.textures.size, 0);
    assert.equal(new Set(s.disposed).size, textureFrames.size);
    assert.equal(s.disposed.length, textureFrames.size);
    s.resources.close();
  });
test('fresh resource/thread/two-manager restore preserves live old instances, pending GC and future packets without replay', async () => {
  const before = await setup(),
    asset = await before.resources.load('authored'),
    a = managerFor(before),
    b = managerFor(before);
  a.play(asset.id, [-0, 1, 2], 'forced');
  a.play(asset.id, [2, 3, 4], 'frame');
  const stopped = b.play(asset.id, [5, 6, 7], 'frame');
  for (let i = 0; i < 3; i++) {
    a.update('frame');
    b.update('frame');
    packets(a);
    packets(b);
  }
  b.stop(stopped);
  a.update('frame');
  b.update('frame');
  packets(a);
  packets(b);
  const saved = await deserializeCheckpoint(
      await serializeCheckpoint({
        resources: before.resources.snapshot(),
        threads: before.threads.snapshot(),
        a: a.snapshot(),
        b: b.snapshot(),
      }),
    ),
    after = await setup();
  await after.resources.restore(saved.resources);
  after.threads = new LogicalCRTThreads();
  after.threads.restore(saved.threads);
  const freshA = managerFor(after),
    freshB = managerFor(after),
    random = after.threads.snapshot();
  freshA.restore(saved.a);
  freshB.restore(saved.b);
  assert.deepEqual(after.threads.snapshot(), random);
  assert.deepEqual(after.resources.snapshot(), saved.resources);
  assert.deepEqual(freshA.snapshot(), saved.a);
  assert.deepEqual(freshB.snapshot(), saved.b);
  for (let i = 0; i < 14; i++) {
    a.update('frame');
    b.update('frame');
    freshA.update('frame');
    freshB.update('frame');
    assert.deepEqual(packets(freshA), packets(a));
    assert.deepEqual(packets(freshB), packets(b));
    assert.deepEqual(freshA.snapshot(), a.snapshot());
    assert.deepEqual(freshB.snapshot(), b.snapshot());
    assert.deepEqual(after.threads.snapshot(), before.threads.snapshot());
    assert.deepEqual(after.resources.snapshot(), before.resources.snapshot());
  }
  a.close();
  b.close();
  freshA.close();
  freshB.close();
  before.resources.release(asset.id);
  after.resources.release(asset.id);
  assert.equal(before.resources.assets.size, 0);
  assert.equal(after.resources.assets.size, 0);
});
test('a retained CPU visitor reuses its typed packet buffers across particles and frames', async () => {
  const s = await setup(),
    asset = await s.resources.load('authored'),
    manager = managerFor(s);
  let first,
    count = 0;
  const visitor = createEffekseerColorVisitor({
    manager,
    onInstance: ({ output }) => {
      if (!first) first = output;
      else {
        assert.equal(output, first);
        assert.equal(output.colors[0], first.colors[0]);
        assert.equal(output.uv, first.uv);
      }
      count++;
    },
  });
  manager.play(asset.id, [0, 0, 0], 'frame');
  for (let i = 0; i < 7; i++) {
    manager.update('frame');
    manager.draw(visitor);
  }
  assert.ok(count > 3);
  manager.close();
  s.resources.release(asset.id);
});
