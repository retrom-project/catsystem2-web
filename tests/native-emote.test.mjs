// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { emotePSBFixture } from './fixtures/emote-psb-fixture.mjs';
import { PSB } from '../src/formats/psb.mjs';
import { NativeEmoteDevice } from '../src/emote/native-device.mjs';
import { EmoteD3D9 } from '../src/emote/native-d3d.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { floatBits } from '../src/kcs.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-emote-golden.json', import.meta.url), 'utf8'),
);
const decode = (draw) => ({
  ...draw,
  ...(draw.indices ? { indices: new Uint8Array(Buffer.from(draw.indices, 'base64')) } : {}),
  bytes: new Uint8Array(Buffer.from(draw.bytes, 'base64')),
});
test('the authored PSB fixture has a complete native model schema and reproducible identity', () => {
  const bytes = emotePSBFixture(),
    psb = new PSB(bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), golden.modelSHA256);
  assert.equal(psb.version, 3);
  assert.equal(psb.root.id, 'motion');
  assert.equal(psb.root.spec, 'win');
  assert.equal(psb.root.metadata.variableList[0].label, 'pose');
  assert.equal(psb.resource(0).length, 16);
});
test('D3D BGRA surface transfers preserve full rows, subrectangles and XRGB alpha', async () => {
  const p = new PE32Process(await loadUnicorn()),
    d3d = new EmoteD3D9(p, { width: 8, height: 8 }),
    out = p.allocate(32, true);
  try {
    for (const format of [21, 22]) {
      assert.equal(d3d.createSurface({ width: 11, height: 7, format, usage: 0, pool: 2 }, out), 0);
      assert.equal(
        d3d.createSurface({ width: 11, height: 7, format, usage: 0, pool: 0 }, out + 4),
        0,
      );
      const a = d3d.objects.get(p.load(out)),
        b = d3d.objects.get(p.load(out + 4)),
        input = Uint8Array.from({ length: a.pitch * a.height }, (_, i) => (i * 197) & 255);
      p.write(a.pixels, input);
      assert.equal(d3d.updateSurface(a.pointer, 0, b.pointer, 0), 0);
      assert.deepEqual(p.read(b.pixels, input.length), input);
      p.zero(b.pixels, input.length);
      [2, 1, 9, 5, 1, 2].forEach((word, i) => p.store(out + 8 + i * 4, word));
      assert.equal(d3d.updateSurface(a.pointer, out + 8, b.pointer, out + 24), 0);
      const expected = new Uint8Array(input.length);
      for (let row = 0; row < 4; row++)
        expected.set(
          input.subarray((row + 1) * a.pitch + 8, (row + 1) * a.pitch + 36),
          (row + 2) * b.pitch + 4,
        );
      assert.deepEqual(p.read(b.pixels, expected.length), expected);
      const rgba = d3d.frame(b.pointer).rgba;
      for (let i = 0; i < expected.length; i += 4)
        assert.deepEqual(
          rgba.subarray(i, i + 4),
          Uint8Array.of(
            expected[i + 2],
            expected[i + 1],
            expected[i],
            format === 22 ? 255 : expected[i + 3],
          ),
        );
    }
  } finally {
    p.close();
  }
});
test(
  'the original E-mote DLL rejects a failed texture with a stale interface output',
  { skip: !process.env.CATSYSTEM2_EMOTE_DLL },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), golden.driverSHA256);
    const device = await NativeEmoteDevice.open(bytes, { width: 256, height: 256 }),
      p = device.process,
      create = device.d3d.contracts('Device9')[23][2],
      table = p.load(device.d3d.device);
    let calls = 0;
    const failure = p.trap('authored texture allocation failure', 9, ([pointer, ...args]) => {
      calls++;
      p.store(args[6], 0x12345678);
      const allocate = p.allocate;
      p.allocate = () => {
        throw new Error('PE32 heap exhausted');
      };
      try {
        return create(device.d3d.objects.get(pointer), args);
      } finally {
        p.allocate = allocate;
      }
    });
    p.store(table + 23 * 4, failure);
    try {
      await assert.rejects(device.createPlayer(emotePSBFixture()), {
        message: 'E-mote driver rejected its model',
      });
      assert.equal(calls, 1);
    } finally {
      device.close();
    }
  },
);
test(
  'the original E-mote DLL matches Wine DrawUP bytes, variable timing and a fresh process checkpoint',
  { skip: !process.env.CATSYSTEM2_EMOTE_DLL },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
      draws = [];
    assert.equal(createHash('sha256').update(bytes).digest('hex'), golden.driverSHA256);
    const device = await NativeEmoteDevice.open(bytes, {
      width: 256,
      height: 256,
      now: () => 0,
      epoch: 0,
      onDrawRaw: (draw) => draws.push(draw),
    });
    let restored;
    try {
      const player = await device.createPlayer(emotePSBFixture());
      assert.deepEqual(player.variables(), golden.variables);
      assert.equal(player.hidden, true);
      player.show();
      assert.equal(player.hidden, false);
      player.setVariable('pose', 0);
      player.setVariable('pose', 10, 10);
      for (let i = 0; i < golden.frames.length; i++) {
        draws.length = 0;
        player.update(i === 0 ? 0 : i === 3 ? 3 : 1);
        player.collectDraw();
        assert.equal(floatBits(player.variable('pose')), golden.frames[i].variableBits);
        assert.deepEqual(draws, golden.frames[i].draws.map(decode));
      }
      const checkpoint = device.snapshot();
      player.update(2);
      const expected = player.collectDraw();
      restored = await NativeEmoteDevice.fromSnapshot(checkpoint, {
        readDriver: () => bytes,
        now: () => 0,
        epoch: 0,
      });
      const copy = restored.players.get(player.pointer);
      copy.update(2);
      assert.deepEqual(copy.collectDraw(), expected);
      assert.equal(copy.variable('pose'), player.variable('pose'));
      copy.hide();
      assert.equal(copy.hidden, true);
    } finally {
      restored?.close();
      device.close();
    }
  },
);
