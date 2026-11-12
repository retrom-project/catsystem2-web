// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readEffekseerEffect, EffekseerFormatError } from '../src/effekseer/effect-reader.mjs';
import { PNG } from '../src/formats/png.mjs';
import { authoredEffect } from './fixtures/effekseer/authored-effect.mjs';
const upstream = new URL('./fixtures/effekseer/public-1.23/', import.meta.url);
test('public fixture identities match the fixed official CC0 source manifest', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('./fixtures/effekseer/public-1.23-manifest.json', import.meta.url)),
  );
  assert.equal(manifest.length, 19);
  for (const entry of manifest) {
    assert.equal(entry.license, 'CC0-1.0');
    assert.match(entry.url, /\/5239bb1e416cbf55b4d3c8170594cbdc7815f263\//);
    assert.ok(entry.path.startsWith('public-1.23/'));
    const bytes = await readFile(new URL(`./fixtures/effekseer/${entry.path}`, import.meta.url));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
});
test('authored on-disk Effect is reproducible and its texture has opaque colored pixels', async () => {
  const bytes = await readFile(
      new URL('./fixtures/effekseer/authored-particles-v9.efk', import.meta.url),
    ),
    expected = authoredEffect({ colorPaths: ['Texture/authored-spark.png'] });
  assert.deepEqual(new Uint8Array(bytes), expected);
  const effect = readEffekseerEffect(bytes),
    png = new PNG(
      await readFile(new URL('./fixtures/effekseer/authored-spark.png', import.meta.url)),
    );
  assert.equal(effect.nodes[1].common.maxGeneration, 3);
  assert.equal(effect.nodes[1].translation.type, 'pva');
  assert.deepEqual([png.width, png.height], [2, 2]);
  assert.deepEqual(
    [...(await png.decode())],
    [255, 64, 0, 255, 255, 128, 0, 255, 255, 192, 0, 255, 255, 255, 0, 255],
  );
});
const expected = [
  ['Laser01', 1, ['root', 'sprite', 'sprite', 'sprite', 'sprite', 'sprite']],
  [
    'Laser02',
    7,
    [
      'root',
      'sprite',
      'none',
      'ribbon',
      'none',
      'ribbon',
      'none',
      'ribbon',
      'none',
      'ribbon',
      'none',
      'none',
      'ribbon',
      'sprite',
      'sprite',
      'sprite',
    ],
  ],
  ['Simple_Ribbon_Parent', 7, ['root', 'sprite', 'ribbon']],
  [
    'Simple_Ring_Shape1',
    7,
    ['root', 'ring', 'ring', 'ring', 'ring', 'ring', 'ring', 'ring', 'ring'],
  ],
  ['Simple_Track1', 7, ['root', 'none', 'track', 'track', 'track', 'track']],
  ['Simple_Sprite_FixedYAxis', 7, ['root', 'sprite']],
  ['Simple_Distortion', 9, ['root', 'ring', 'none', 'sprite', 'ring', 'ring']],
  ['block_simple', 8, ['root', 'model']],
];
for (const [name, version, types] of expected)
  test(`fixed official 1.23 ${name} fully decodes`, async () => {
    const bytes = await readFile(new URL(`${name}.efk`, upstream)),
      result = readEffekseerEffect(bytes, { identity: name });
    assert.equal(result.version, version);
    assert.deepEqual(
      result.nodes.map((n) => n.type),
      types,
    );
    assert.equal(result.nodes[0].sourceEnd, bytes.length);
    assert.equal(result.warnings.length, 0);
    for (const node of result.nodes)
      for (const child of node.children) assert.equal(result.nodes[child].parent, node.id);
    if (name === 'Laser01') {
      assert.equal(result.nodes[1].common.maxGeneration, 40);
      assert.equal(result.nodes[1].common.life.min, 20);
      assert.equal(result.nodes[1].renderer.alphaBlend, 2);
      assert.deepEqual(result.dependencies.sound, ['Sound/Laser.wav']);
    }
    if (name === 'Simple_Sprite_FixedYAxis') {
      assert.equal(result.nodes[1].renderer.billboard, 1);
      assert.deepEqual([...result.nodes[1].translation.position.max], [5, 0, 5]);
      assert.deepEqual([...result.nodes[1].scaling.value], [1, 16, 1]);
    }
    if (name === 'Simple_Track1') assert.deepEqual(result.nodes[1].children, [2, 3, 4, 5]);
    if (name === 'Simple_Distortion') {
      assert.deepEqual(result.dependencies.distortion, ['Texture/Cloud01.png']);
      assert.ok(result.nodes.some((n) => n.texture?.distortion));
    }
    if (name === 'block_simple') {
      assert.deepEqual(result.dependencies.model, ['Model/block.efkmodel']);
      assert.equal(result.nodes[1].renderer.modelIndex, 0);
    }
  });
test('authored nonempty sprite preserves UTF16 dependency names and sound parameters', () => {
  const effect = readEffekseerEffect(
    authoredEffect({
      colorPaths: ['Texture/火花.png'],
      soundPaths: ['Sound/ignored.wav'],
      withSound: true,
    }),
  );
  assert.deepEqual(effect.dependencies.color, ['Texture/火花.png']);
  assert.equal(effect.nodes[1].common.maxGeneration, 3);
  assert.deepEqual(effect.nodes[1].sound.delay, { max: 3, min: 1 });
  assert.deepEqual([...effect.nodes[1].renderer.color.value], [255, 64, 0, 255]);
  assert.deepEqual([...effect.nodes[1].renderer.positions], [-1, -1, 1, -1, -1, 1, 1, 1]);
});
test('all old motion parameter alternatives retain typed fields and curve keys', () => {
  const cases = [
    ['translation', 0, 'fixed'],
    ['translation', 1, 'pva'],
    ['translation', 2, 'easing'],
    ['translation', 3, 'curve'],
    ['rotation', 3, 'axis-pva'],
    ['rotation', 4, 'axis-easing'],
    ['rotation', 5, 'curve'],
    ['scaling', 3, 'single-pva'],
    ['scaling', 4, 'single-easing'],
    ['scaling', 5, 'curve'],
  ];
  for (const [domain, type, name] of cases) {
    const result = readEffekseerEffect(authoredEffect({ [domain]: type })).nodes[1][domain];
    assert.equal(result.type, name, `${domain}/${type}`);
    if (name === 'curve') assert.deepEqual([...result.curves[2].keys], [2, 3, 4]);
  }
});
test('old point/sphere/model/circle and every UV/color alternative fully decode', () => {
  for (let type = 0; type < 4; type++) {
    const e = readEffekseerEffect(authoredEffect({ generation: type, uv: type, color: type }));
    assert.equal(e.nodes[1].generation.type, ['point', 'sphere', 'model', 'circle'][type]);
    assert.equal(e.nodes[1].texture.uv.type, ['default', 'fixed', 'animation', 'scroll'][type]);
    assert.equal(e.nodes[1].renderer.color.type, ['fixed', 'random', 'easing', 'curve'][type]);
  }
});
test('magnification follows old version threshold and leaves rotation/scaling untouched', () => {
  const modern = readEffekseerEffect(
    authoredEffect({ magnification: 2, translation: 0, rotation: 0, scaling: 0 }),
    { externalMagnification: 3 },
  );
  assert.equal(modern.magnification, 6);
  assert.deepEqual([...modern.nodes[1].translation.value], [6, 12, 18]);
  assert.deepEqual([...modern.nodes[1].rotation.value], [1, 2, 3]);
  assert.deepEqual([...modern.nodes[1].scaling.value], [2, 3, 4]);
  assert.deepEqual([...modern.nodes[1].renderer.positions], [-6, -6, 6, -6, -6, 6, 6, 6]);
  const old = readEffekseerEffect(authoredEffect({ version: 7, magnification: 2, translation: 0 }));
  assert.deepEqual([...old.nodes[1].translation.value], [1, 2, 3]);
});
test('unverified component version warns with identity and attempts known structure', () => {
  const warnings = [],
    effect = readEffekseerEffect(authoredEffect({ encodedVersion: 10 }), {
      identity: 'fixture.efk@sha256:authored',
      onWarning: (w) => warnings.push(w),
    });
  assert.equal(effect.nodes.length, 2);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].version, 10);
  assert.equal(warnings[0].identity, 'fixture.efk@sha256:authored');
});
test('unverified identity is warned before unreadable parameter layout fails', () => {
  const warnings = [];
  assert.throws(
    () =>
      readEffekseerEffect(authoredEffect({ encodedVersion: 10, commonSize: 56 }), {
        identity: 'new-format',
        onWarning: (w) => warnings.push(w),
      }),
    /unimplemented layout length 56/,
  );
  assert.equal(warnings.length, 1);
});
test('every truncation of a real small Effect fails with a bounded located error', async () => {
  const bytes = await readFile(new URL('block_simple.efk', upstream));
  for (let end = 0; end < bytes.length; end++)
    assert.throws(
      () => readEffekseerEffect(bytes.subarray(0, end), { identity: 'cut' }),
      (e) =>
        e instanceof EffekseerFormatError && e.identity === 'cut' && Number.isInteger(e.offset),
    );
});
test('unknown nodes/layouts, excessive counts and trailing structures are explicit errors', () => {
  const bytes = authoredEffect();
  const mutate = (at, value) => {
    const b = bytes.slice();
    new DataView(b.buffer).setInt32(at, value, true);
    return b;
  };
  assert.throws(() => readEffekseerEffect(mutate(8, 0x7fffffff)), /invalid count/);
  const parsed = readEffekseerEffect(bytes);
  assert.throws(
    () => readEffekseerEffect(mutate(parsed.nodes[1].sourceOffset, 123)),
    /unimplemented node kind 123/,
  );
  assert.throws(
    () => readEffekseerEffect(new Uint8Array([...bytes, 1, 2, 3, 4])),
    /trailing bytes have an unreadable structure/,
  );
  assert.throws(
    () => readEffekseerEffect(bytes, { limits: { nodes: 1 } }),
    /invalid count|budget exceeded/,
  );
});
