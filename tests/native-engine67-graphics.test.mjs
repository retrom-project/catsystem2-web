// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { floatBits } from '../src/kcs.mjs';
import { MOTION_ABI, motionVector, setMotionVector } from '../src/motion/abi.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67',
  target = [0x13, 80];

function planeProgram(calls) {
  return kcsProgram([
    [37, 0x72394ca1],
    ...calls.flatMap(([id, args]) => [...args.map((arg) => [37, arg]), [43, id, args.length * 4]]),
    [59],
  ]);
}

test('2.6.1.67 plane GCALLs create a textured region and preserve its transform selectors', async (t) => {
  const size = [4.5, 3.25].map(floatBits);
  const world = await dataWorld(profile, {
    'shape.kcs': planeProgram([
      [78, [0, ...size]],
      [78, [target, ...size]],
    ]),
    'transform.kcs': planeProgram([
      [84, [target, ...[6, 7, 8].map(floatBits), 0]],
      [85, [target, ...[3, 5].map(floatBits), 0]],
      [93, [target, ...[-5, 10, 15].map(floatBits), 0]],
      [101, [target, ...[2, 3, 4].map(floatBits), 1]],
      [94, [target, -1]],
    ]),
    'opaque.kcs': planeProgram([[94, [target, 256]]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const owner = world.main.id;
  const id = await world.objects.create({ kind: 2, parent: owner });
  const plane = world.graphics.get(id);
  const execute = async (name) => {
    const task = await world.spawnScript(name, { parent: owner, initialExecute: false });
    const { machine } = task;
    const floor = machine.sp;
    machine.store(80, world.nativeTaskID(id));
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0x72394ca1);
  };
  await execute('shape.kcs');
  assert.deepEqual(plane.state.shapeWords, [0, 0, 0, ...size, 32, 1, 0xffffffff]);
  assert.equal(plane.graph.width, 4.5);
  assert.equal(plane.graph.height, 3.25);
  assert.equal(plane.graph.vram, true);
  setMotionVector(plane.graph.kx2, MOTION_ABI.base, [0, 0, 61]);
  await execute('transform.kcs');
  assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.pos), [6, 7, 8]);
  assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.base), [3, 5, 61]);
  assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.rotation), [-5, 10, 15]);
  assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.scale), [2, 3, 4]);
  const view = new DataView(plane.graph.kx2.buffer);
  assert.equal(view.getUint32(MOTION_ABI.color, true), 0x00ffffff);
  await execute('opaque.kcs');
  assert.equal(view.getUint32(MOTION_ABI.color, true), 0xffffffff);
});

test('2.6.1.67 plane GCALLs set coordinates on a loaded graph and expand divided mesh vertices', async (t) => {
  const source = [0x23, 120],
    triangles = [
      [3, [0, 2, 0], [0, 0, 2], [1, 2, 3], [0, 1, 0], [0, 0, 1]],
      [7, [-4, 6, 0], [1, 0, -7], [0, 1, 3], [0, 0, 1], [1, 0, 0]],
    ];
  const world = await dataWorld(profile, {
    'mode-before.kcs': planeProgram([
      [466, [0, 128]],
      [466, [target, 128]],
    ]),
    'mesh.kcs': planeProgram([
      [467, [0, 0, -1]],
      [467, [target, source, triangles.length]],
    ]),
    'mode-after.kcs': planeProgram([[466, [target, 128]]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const parent = world.main.id,
    id = await world.objects.create({ kind: 2, parent }),
    plane = world.graphics.get(id);
  const run = async (name) => {
    const task = await world.spawnScript(name, { parent, initialExecute: false }),
      { machine } = task,
      floor = machine.sp;
    machine.store(80, world.nativeTaskID(id));
    triangles.forEach(([texture, ...columns], index) => {
      const at = 120 + index * 64;
      machine.store(at, texture);
      columns.flat().forEach((value, word) => machine.store(at + 4 + word * 4, floatBits(value)));
    });
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0x72394ca1);
  };
  await run('mode-before.kcs');
  assert.equal(plane.graph, null);
  assert.equal(plane.state.coordMode, 0);
  await run('mesh.kcs');
  assert.equal(plane.graph.type, 3);
  assert.equal(plane.graph.style.coordMode, 0);
  assert.deepEqual(
    plane.graph.mesh,
    triangles.map(([textureID, x, y, z, u, v], id) => ({
      id,
      textureID,
      vertices: x.map((value, vertex) => ({
        x: value,
        y: y[vertex],
        z: z[vertex],
        u: u[vertex],
        v: v[vertex],
        color: 0,
      })),
    })),
  );
  assert.deepEqual(plane.graph.bounds, { minimum: [-4, -7, 0], maximum: [6, 2, 3] });
  await run('mode-after.kcs');
  assert.equal(plane.graph.style.coordMode, 128);
});
