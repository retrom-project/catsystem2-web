// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EmoteDocument } from '../src/emote/document.mjs';
import { EmoteAnimation } from '../src/emote/animation.mjs';
import { EmoteGeometry } from '../src/emote/geometry.mjs';
import { EmoteMaterials } from '../src/emote/materials.mjs';
import { EmotePatch } from '../src/emote/mesh.mjs';
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

test('mapped patch weights retain the reviewed float32 reduction order', () => {
  const patch = new EmotePatch(),
    points = Float32Array.from({ length: 32 }, (_, i) => (((i % 7) - 2) * 0.943) / (i + 1));
  for (const [u, v, x, y] of [
    [0.19, 0.243, 3201538084, 3154204844],
    [0.821, 0.1428571, 1049393911, 1030776804],
    [-0.158, 1.47373, 1046176852, 1041217283],
    [-0, 0, 3220269171, 3203491955],
  ]) {
    for (const source of [points, [...points]]) {
      const output = patch.mappedEvaluate(source, u, v);
      assert.deepEqual([...new Uint32Array(output.buffer)], [x, y]);
    }
  }
  assert(patch.mappedEvaluate(points, Infinity, 0.2).every(Number.isNaN));
});

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

function channelGeometry(active, mask = 0) {
  const motion = { layer: [{ type: 0, inheritMask: mask, transformOrder: [], frameList: [] }] },
    document = { metadata: { base: { chara: 'body', motion: 'base' } }, motion: () => motion },
    geometry = new EmoteGeometry(document, { bound: new Map() });
  geometry.evaluate = () => active;
  geometry.bindSource = (node) => {
    node.icon = null;
  };
  return geometry;
}

test('inactive geometry copies every live parent channel in its original observable order', () => {
  const geometry = channelGeometry(false),
    reads = [],
    values = {
      flipX: true,
      flipY: false,
      angle: -15,
      scaleX: -0,
      scaleY: 2,
      slantX: 0.3,
      slantY: -0.5,
      x: 3,
      y: -4,
      z: 8,
      opacity: 73,
    },
    parent = new Proxy(values, {
      get: (object, key) => {
        reads.push(key);
        return object[key];
      },
    });
  geometry.updateGroup(geometry.root, 0, parent, Float64Array.of(1, 0, 0, 1), null);
  assert.deepEqual(reads, Object.keys(values));
  for (const [key, value] of Object.entries(values))
    assert(Object.is(geometry.root.nodes[0].state[key], value));
});

test('geometry copies, inherits and normalizes live channels without hoisting accessor reads', () => {
  const geometry = channelGeometry(true, 4 | 32 | 256),
    node = geometry.root.nodes[0],
    trace = [],
    channels = ['flipX', 'flipY', 'angle', 'scaleX', 'scaleY', 'slantX', 'slantY'],
    local = {
      flipX: true,
      flipY: false,
      angle: 15,
      scaleX: 0.75,
      scaleY: 1.25,
      slantX: 0.1,
      slantY: 0.2,
      x: 3,
      y: -4,
      z: 8,
      opacity: 255,
    },
    inherited = { ...local, flipX: false, scaleX: -2, slantY: 0.5 },
    spy = (object, label) =>
      new Proxy(object, {
        get(target, key) {
          if (channels.includes(key)) trace.push(`${label}.get.${key}`);
          return target[key];
        },
        set(target, key, value) {
          if (channels.includes(key)) trace.push(`${label}.set.${key}`);
          target[key] = value;
          return true;
        },
      }),
    transform = spy({}, 'transform');
  node.state = spy({ ...node.state, ...local }, 'state');
  Object.defineProperty(node, 'transformState', {
    get() {
      trace.push('node.transformState');
      return transform;
    },
  });
  geometry.updateGroup(
    geometry.root,
    0,
    spy(inherited, 'parent'),
    Float64Array.of(1, 0, 0, 1),
    null,
  );
  const selected = ['flipX', 'scaleX', 'slantY'];
  assert.deepEqual(trace, [
    ...channels.flatMap((key) => [
      'node.transformState',
      `state.get.${key}`,
      `transform.set.${key}`,
    ]),
    ...selected.flatMap((key) => [`state.get.${key}`, `parent.get.${key}`, `state.set.${key}`]),
    'node.transformState',
    ...selected.flatMap((key) => [`state.get.${key}`, `parent.get.${key}`, `transform.set.${key}`]),
  ]);
  assert.deepEqual(
    [transform.flipX, transform.scaleX, transform.slantY],
    [true, 0.75, 0.19999999999999996],
    'the additive inheritance and subtractive normalization keep their double rounding',
  );
});

test('unchanged poses rewrite publicly held packet bytes and projected vertices on the next update', async () => {
  const input = emoteGeometryCases().find((input) => input.name === 'patch-bent'),
    document = await EmoteDocument.open(emoteGeometryModel(input)),
    animation = new EmoteAnimation(document),
    geometry = new EmoteGeometry(document, animation);
  apply(animation, input.steps[0]);
  geometry.update();
  geometry.project(256, 256);
  const held = geometry.commands.slice(),
    bytes = held.map((packet) => packet.bytes.slice()),
    vertices = held.map((packet) => structuredClone(packet.vertices));
  for (const packet of held) {
    packet.bytes.fill(0xa5);
    packet.vertices[0].x = 9000;
  }
  geometry.update();
  geometry.project(256, 256);
  assert.equal(geometry.commands.length, held.length);
  for (let i = 0; i < held.length; i++) {
    assert.equal(geometry.commands[i], held[i]);
    assert.deepEqual(held[i].bytes, bytes[i]);
    assert.deepEqual(held[i].vertices, vertices[i]);
  }
});
