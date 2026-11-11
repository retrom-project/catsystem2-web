// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EmoteDocument } from '../src/emote/document.mjs';
import { EmoteAnimation } from '../src/emote/animation.mjs';
import { EmoteGeometry } from '../src/emote/geometry.mjs';
import { EmoteMaterials } from '../src/emote/materials.mjs';
import { emoteControllerCases, emoteControllerModel } from './fixtures/emote-controller-cases.mjs';
import { emoteGeometryCases, emoteGeometryModel } from './fixtures/emote-geometry-cases.mjs';
import { apply } from './fixtures/emote-js-steps.mjs';
const controllers = JSON.parse(
    await readFile(new URL('./fixtures/emote-controller-golden.json', import.meta.url)),
  ),
  golden = JSON.parse(
    await readFile(new URL('./fixtures/emote-geometry-golden.json', import.meta.url)),
  );

function comparePackets(commands, draws, name) {
  assert.equal(commands.length, draws.length, `${name}: draw count`);
  commands.forEach((packet, index) => {
    const expected = draws[index],
      bytes = Buffer.from(expected.bytes, 'hex');
    for (const field of ['type', 'count', 'stride', 'fvf'])
      assert.equal(packet[field], expected[field], `${name}: packet ${index} ${field}`);
    assert.equal(packet.bytes.length, bytes.length, `${name}: packet ${index} byte length`);
    for (let at = 0; at < bytes.length; at += 4)
      assert.equal(
        packet.view.getUint32(at, true),
        bytes.readUInt32LE(at),
        `${name}: packet ${index} word ${at}`,
      );
  });
}

test('animated mesh strips match every original controller fixture vertex byte', async () => {
  for (const [n, input] of emoteControllerCases().entries()) {
    const document = await EmoteDocument.open(emoteControllerModel(input.category, input.settings)),
      animation = new EmoteAnimation(document),
      geometry = new EmoteGeometry(document, animation);
    for (const [i, step] of input.steps.entries()) {
      apply(animation, step);
      comparePackets(geometry.update(), controllers.cases[n].frames[i].draws, `${input.name}/${i}`);
    }
  }
});

test('authored transforms, child motions, gradients, Bezier inheritance and mask strips match original bytes', async () => {
  for (const [n, input] of emoteGeometryCases().entries()) {
    const model = emoteGeometryModel(input),
      expected = golden.cases[n];
    assert.equal(input.name, expected.name);
    assert.equal(createHash('sha256').update(model).digest('hex'), expected.modelSHA256);
    const document = await EmoteDocument.open(model),
      animation = new EmoteAnimation(document),
      geometry = new EmoteGeometry(document, animation);
    for (const [i, step] of input.steps.entries()) {
      apply(animation, step);
      comparePackets(geometry.update(), expected.frames[i].draws, `${input.name}/${i}`);
    }
  }
});

test('materials retain the recorded active device states and texture-stage operations', async () => {
  const materials = new EmoteMaterials();
  for (const [n, input] of emoteGeometryCases().entries()) {
    const document = await EmoteDocument.open(emoteGeometryModel(input)),
      animation = new EmoteAnimation(document),
      geometry = new EmoteGeometry(document, animation);
    apply(animation, input.steps[0]);
    for (const [i, command] of geometry.update().entries()) {
      const actual = materials.get(command.blend, command.stencil, command.maskWrite),
        expected = golden.cases[n].frames[0].draws[i].state,
        states = new Map(expected.states);
      for (const [id, value] of states) {
        // D3D retains inactive comparison/ref values from earlier draws. Those
        // values cannot affect a draw while their depth/stencil test is off.
        if (!states.get(7) && id === 23) continue;
        if (!states.get(52) && [53, 54, 55, 56, 57, 58, 59].includes(id)) continue;
        assert.equal(actual.states.get(id), value, `${input.name}/${i}: state ${id}`);
      }
      assert.deepEqual(actual.samplers, new Map(expected.samplers), `${input.name}: samplers`);
      assert.deepEqual(
        actual.stages,
        new Map(expected.stages.map(([stage, values]) => [stage, new Map(values)])),
        `${input.name}: stages`,
      );
      assert.equal(materials.get(command.blend, command.stencil, command.maskWrite), actual);
    }
  }
  assert.throws(() => materials.get(7), /Unsupported E-mote blend/);
});

test('instances reuse mesh, projected vertices and topology buffers across poses and fresh controller restore', async () => {
  const input = emoteGeometryCases().find((input) => input.name === 'inactive-patch'),
    document = await EmoteDocument.open(emoteGeometryModel(input)),
    frozen = JSON.stringify(document.root),
    animation = new EmoteAnimation(document),
    geometry = new EmoteGeometry(document, animation),
    seen = new Map();
  for (let iteration = 0; iteration < 3; iteration++)
    for (const step of input.steps) {
      apply(animation, step);
      geometry.update();
      geometry.project(256, 256);
      for (const command of geometry.commands) {
        const key = `${command.row}/${command.vertices.length}`;
        if (seen.has(key)) assert.equal(command.bytes, seen.get(key));
        else seen.set(key, command.bytes);
      }
    }
  const restored = new EmoteAnimation(document);
  restored.restore(animation.snapshot());
  const fresh = new EmoteGeometry(document, restored);
  fresh.update();
  assert.deepEqual(
    fresh.commands.map((command) => command.bytes),
    geometry.commands.map((command) => command.bytes),
  );
  assert.equal(JSON.stringify(document.root), frozen);
});
