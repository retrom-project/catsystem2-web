// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { recordEmoteFrames, recordPPIFrames } from '../oracle/plugin-frames.mjs';
import { recordPluginOracle } from '../scripts/record-plugin-oracle.mjs';
import { NativePPI } from '../src/ppi/native.mjs';
import { NativeEmoteDevice } from '../src/emote/native-device.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
import { emotePSBFixture } from './fixtures/emote-psb-fixture.mjs';

test('PPI frame records retain Init/Exec/Stop, float bits, RNG and independent particle bytes', async () => {
  const particle = await NativePPI.open(nativeParticleFixture(), {
    unicornFactory: loadUnicorn,
    name: 'authored.ppi',
    count: 2,
    width: 64,
    height: 64,
    screenWidth: 1280,
    screenHeight: 720,
    now: () => 0,
    epoch: 0,
  });
  try {
    particle.registers[4] = -0;
    particle.registers[5] = Infinity;
    const records = recordPPIFrames(particle, [0, 1]);
    assert.deepEqual(
      records.map((frame) => frame.entry),
      ['Init', 'Exec', 'Exec', 'Stop'],
    );
    assert.equal(records[0].records.length, 2 * 148 * 2);
    assert.equal(records[0].before, 0xffffffff);
    assert.equal(records[1].before, 0xffffffff);
    assert.equal(records[2].before, 0);
    assert.equal(records[2].frame, 1);
    assert.equal(records[3].stopped, true);
    assert.equal(records[3].active, false);
    assert.equal(records[0].registers[4], 0x80000000);
    assert.equal(records[0].registers[5], 0x7f800000);
    const text = JSON.stringify(records);
    particle.process.zero(particle.particleAddress, 2 * 148);
    particle.random.frand();
    assert.equal(JSON.stringify(records), text);
    assert.deepEqual(JSON.parse(text), records);
  } finally {
    particle.close();
  }
});

test('E-mote capture restores the existing draw callback when a DLL call fails', () => {
  const original = () => {},
    d3d = { onDrawRaw: original },
    player = {
      device: { d3d },
      variables: () => [],
      update: () => {
        throw new Error('oracle call failed');
      },
    };
  assert.throws(() => recordEmoteFrames(player, [{ elapsed: 1 }]), /oracle call failed/);
  assert.equal(d3d.onDrawRaw, original);
});

test('the recorder rejects an ambiguous kind before accessing supplied files', async () => {
  await assert.rejects(recordPluginOracle(['--kind', 'engine']), /Usage:/);
});

test(
  'E-mote frame recorder matches existing independent Wine vertices and variable values',
  {
    skip: !process.env.CATSYSTEM2_EMOTE_DLL && 'requires private CATSYSTEM2_EMOTE_DLL',
  },
  async () => {
    const golden = JSON.parse(
        await readFile(new URL('./fixtures/native-emote-golden.json', import.meta.url)),
      ),
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), golden.driverSHA256);
    const device = await NativeEmoteDevice.open(bytes, { width: 256, height: 256 });
    try {
      const player = await device.createPlayer(emotePSBFixture());
      player.show();
      player.setVariable('pose', 0);
      const trace = recordEmoteFrames(
        player,
        [0, 1, 1, 3].map((elapsed, i) => ({
          elapsed,
          ...(i === 0 ? { variables: [{ name: 'pose', value: 10, frames: 10 }] } : {}),
        })),
      );
      assert.deepEqual(trace.variables, golden.variables);
      for (const [i, frame] of trace.frames.entries()) {
        assert.deepEqual(frame.variables, [['pose', golden.frames[i].variableBits]]);
        assert.equal(frame.draws.length, golden.frames[i].draws.length);
        for (const [j, draw] of frame.draws.entries()) {
          const expected = golden.frames[i].draws[j];
          for (const key of ['slot', 'type', 'count', 'stride', 'fvf'])
            assert.equal(draw[key], expected[key]);
          assert.equal(draw.bytes, Buffer.from(expected.bytes, 'base64').toString('hex'));
        }
      }
    } finally {
      device.close();
    }
  },
);
