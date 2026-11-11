// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PSB } from '../src/formats/psb.mjs';
import { EmoteDocument } from '../src/emote/document.mjs';
import { NativeEmoteDevice } from '../src/emote/native-device.mjs';
import { emotePSBFixture, encodeAuthoredPSB } from './fixtures/emote-psb-fixture.mjs';

const root = () => structuredClone(new PSB(emotePSBFixture()).root);
const pixels = Uint8Array.from([
  0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
]);
const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);

test('PSB3/PSB4 and PSZ preserve motion/controller data and cache canonical textures', async () => {
  for (const version of [3, 4]) {
    const r = root();
    r.metadata.format = 'emote';
    r.metadata.version = 1;
    r.object.body.motion.base.layer[0].frameList[0].easing = [0, 0.2, 1, 0.8];
    const bytes = encodeAuthoredPSB(r, [pixels], { version }),
      compressed = deflateSync(bytes),
      psz = new Uint8Array(16 + compressed.length),
      b = new DataView(psz.buffer);
    psz.set([80, 83, 90, 0]);
    b.setUint32(4, compressed.length, true);
    b.setUint32(8, bytes.length, true);
    psz.set(compressed, 16);
    for (const input of [bytes, psz]) {
      const document = await EmoteDocument.open(input, { name: 'authored' });
      assert.equal(document.containerVersion, version);
      assert.equal(document.motionVersion, Math.fround(3.03));
      assert.equal(document.metadata.version, 1);
      assert.equal(document.variables.get('pose').frameList[1].label, 'target');
      assert.deepEqual(document.motion('body', 'base').layer[0].frameList[0].easing, [
        0,
        Math.fround(0.2),
        1,
        Math.fround(0.8),
      ]);
      assert.deepEqual(document.texture('tex').rgba, rgba);
      assert.equal(document.texture('tex'), document.texture('tex'));
      assert.equal(document.icon('tex', 'dot').texture, document.texture('tex'));
      assert.deepEqual(new PSB(bytes).resource(0), pixels);
    }
  }
});

test('per-icon run-length textures retain origin and decode both literal and repeated runs', () => {
  const r = root();
  delete r.source.tex.texture;
  r.source.tex.icon.dot = {
    width: 4,
    height: 1,
    originX: 2,
    originY: 3,
    type: 'RGBA8',
    compress: 'RL',
    pixel: { resource: 0 },
  };
  const bytes = Uint8Array.from([0, 0, 0, 255, 255, 128, 255, 0, 0, 128]),
    document = new EmoteDocument(new PSB(encodeAuthoredPSB(r, [bytes]))),
    icon = document.icon('tex', 'dot');
  assert.deepEqual(
    icon.texture.rgba,
    Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 128, 0, 0, 255, 128, 0, 0, 255, 128]),
  );
  assert.equal(icon.originX, 2);
  assert.equal(icon.originY, 3);
  assert.equal(icon.left, 0);
});

test('unknown document versions, texture formats and truncated resources fail at their data boundary', () => {
  for (const change of [
    (r) => (r.id = 'unrelated'),
    (r) => (r.version = 3.04),
    (r) => (r.metadata.version = 2),
  ]) {
    const r = root();
    change(r);
    assert.throws(
      () => new EmoteDocument(new PSB(encodeAuthoredPSB(r, [pixels]))),
      /Unsupported E-mote/,
    );
  }
  const r = root();
  r.source.tex.texture.type = 'unknown';
  const unsupported = new EmoteDocument(new PSB(encodeAuthoredPSB(r, [pixels])));
  assert.throws(() => unsupported.texture('tex'), /texture type unknown/);
  r.source.tex.texture.type = 'RGBA8';
  const truncated = new EmoteDocument(new PSB(encodeAuthoredPSB(r, [pixels.subarray(0, 12)])));
  assert.throws(() => truncated.texture('tex'), /size mismatch/);
  const bounds = new EmoteDocument(new PSB(encodeAuthoredPSB(r, [pixels])));
  bounds.sources.get('tex').icon.dot.left = 2;
  assert.throws(() => bounds.icon('tex', 'dot'), /outside its texture/);
  assert.throws(() => bounds.motion('body', 'absent'), /Unknown E-mote motion/);
});

test(
  'authored PSB3 and PSB4 JS texture decoding matches the original DLL upload',
  {
    skip: !process.env.CATSYSTEM2_EMOTE_DLL && 'requires private CATSYSTEM2_EMOTE_DLL',
  },
  async () => {
    const driver = new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
    assert.equal(
      createHash('sha256').update(driver).digest('hex'),
      '85eb459e94e74ab608f649eb7fb440f2526e90aaa1af7276ed01dc10018903ce',
    );
    const device = await NativeEmoteDevice.open(driver);
    try {
      for (const version of [3, 4]) {
        const bytes = encodeAuthoredPSB(root(), [pixels], { version }),
          document = await EmoteDocument.open(bytes),
          player = await device.createPlayer(bytes);
        const texture = [...device.d3d.objects.values()].find(
          (o) => o.kind === 'Texture9' && o.width === 2 && o.height === 2,
        );
        assert.ok(texture);
        assert.deepEqual(document.texture('tex').rgba, device.d3d.frame(texture.pointer).rgba);
        player.close();
      }
    } finally {
      device.close();
    }
  },
);
