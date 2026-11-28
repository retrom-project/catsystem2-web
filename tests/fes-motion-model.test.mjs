// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOTION_ABI, initialMotionObject } from '../src/motion/abi.mjs';
import { fesMotionState, applyFESMotionState } from '../src/native/fes-motion-model.mjs';
import { buildNativeFESMotion } from '../src/native/fes-motion.mjs';
const oracle = JSON.parse(
  await readFile(new URL('./fixtures/fes-motion-model.json', import.meta.url), 'utf8'),
);
function fixture(state) {
  const object = structuredClone(state);
  if (object.motionMatrix) object.motionMatrix = new Float32Array(object.motionMatrix);
  object.key = 'subject';
  return { object, instance: { objects: [object], byKey: new Map([['subject', object]]) } };
}
function observed(object, fields) {
  return Object.fromEntries(
    Object.keys(fields).map((key) => [
      key,
      ArrayBuffer.isView(object[key]) ? [...object[key]] : object[key],
    ]),
  );
}
test('typed FES MOT snapshots match all 144 original bytes and authored output application for both engines', () => {
  for (const profile of oracle.profiles)
    for (const sample of profile.samples) {
      const { object, instance } = fixture(sample.before),
        bytes = fesMotionState(object);
      assert.deepEqual(
        [...new Uint32Array(bytes.buffer, bytes.byteOffset, 36)],
        sample.snapshot,
        `${profile.profile}/${sample.name}/snapshot`,
      );
      assert.strictEqual(fesMotionState(object), bytes, 'snapshot buffer is reused');
      applyFESMotionState(
        instance,
        object,
        new Uint8Array(new Uint32Array(sample.appliedPacket).buffer),
      );
      assert.deepEqual(
        observed(object, sample.after),
        sample.after,
        `${profile.profile}/${sample.name}/application`,
      );
      const restored = fixture(object);
      assert.deepEqual([...fesMotionState(restored.object)], [...fesMotionState(object)]);
    }
});

test('plane matrix words retain NaN payloads and signed zeros without replacing the owned buffer', () => {
  const sample = oracle.profiles[0].samples.find((s) => s.name === 'plane'),
    { object, instance } = fixture(sample.before),
    matrix = object.motionMatrix,
    packet = new Uint8Array(new Uint32Array(sample.appliedPacket).buffer),
    view = new DataView(packet.buffer);
  view.setUint32(MOTION_ABI.matrix, 0x7fc12345, true);
  view.setUint32(MOTION_ABI.matrix + 4, 0x80000000, true);
  applyFESMotionState(instance, object, packet);
  assert.strictEqual(object.motionMatrix, matrix);
  const output = new DataView(fesMotionState(object).buffer);
  assert.equal(output.getUint32(MOTION_ABI.matrix, true), 0x7fc12345);
  assert.equal(output.getUint32(MOTION_ABI.matrix + 4, true), 0x80000000);
  const unaligned = new Uint8Array(145);
  unaligned.set(packet, 1);
  applyFESMotionState(instance, object, unaligned.subarray(1));
  assert.strictEqual(object.motionMatrix, matrix);
});

test('known Base virtual methods preserve the manager base and execute no object-state projection', () => {
  for (const nativeType of [0, 7, 8, 24, 26, 27, 30, 31, 32, 34, 35, 38]) {
    const object = { nativeType, key: 'base', motionDelay: -3 },
      instance = { objects: [object], byKey: new Map([['base', object]]) },
      before = structuredClone(object),
      managerBase = initialMotionObject();
    assert.equal(
      fesMotionState(object),
      null,
      'empty snapshot must not overwrite the existing manager base',
    );
    applyFESMotionState(instance, object, managerBase);
    assert.deepEqual(object, before);
  }
  assert.throws(() => fesMotionState({ nativeType: 99 }), /Unrecovered FES motion state/);
  assert.throws(
    () => applyFESMotionState({}, { nativeType: 99 }, initialMotionObject()),
    /Unrecovered FES motion output/,
  );
});

test('PARTICLE uses only the alpha byte and propagates dirty even for unchanged alpha', () => {
  const object = { nativeType: 23, key: 'particle', alpha: 137 },
    instance = { objects: [object], byKey: new Map([['particle', object]]) },
    state = fesMotionState(object);
  assert.equal(new DataView(state.buffer).getUint32(MOTION_ABI.color, true), 0x89000000);
  applyFESMotionState(instance, object, state);
  assert.equal(object.alpha, 137);
  assert.equal(object.dirty, true);
  assert.equal(object.alphaPending, undefined);
});

test('blend preserves plane RGB but uses the world-owned command address for other supported types', () => {
  const bytes = initialMotionObject(),
    view = new DataView(bytes.buffer);
  view.setUint32(MOTION_ABI.color, 0x11223344, true);
  const args = ['-3'];
  assert.deepEqual(
    buildNativeFESMotion('blend', args, bytes, Number, { plane: true }).registers,
    [-3, 34, 51, 68],
  );
  assert.deepEqual(
    buildNativeFESMotion('blend', args, bytes, Number, { commandPointer: 0x306789ab }).registers,
    [-3, 103, 137, 171],
  );
  assert.throws(() => buildNativeFESMotion('blend', args, bytes, Number), /command-source address/);
});

test('MOT vector equality preserves negative-zero words until another component requires a full write', () => {
  const image = fixture({
      nativeType: 2,
      x: -0,
      y: 0,
      baseX: -0,
      baseY: 0,
      scaleX: -0,
      scaleY: 1,
      rotation: -0,
      alpha: 255,
      pri: 20,
      displayValue: 0,
    }),
    bytes = fesMotionState(image.object),
    view = new DataView(bytes.buffer);
  for (const offset of [MOTION_ABI.pos, MOTION_ABI.base, MOTION_ABI.scale, MOTION_ABI.rotation + 8])
    view.setFloat32(offset, 0, true);
  applyFESMotionState(image.instance, image.object, bytes);
  for (const key of ['x', 'baseX', 'scaleX', 'rotation'])
    assert.ok(Object.is(image.object[key], -0), key);
  assert.equal(image.object.dirty, undefined);
  view.setFloat32(MOTION_ABI.pos + 4, 1, true);
  applyFESMotionState(image.instance, image.object, bytes);
  assert.ok(Object.is(image.object.x, 0));
  assert.ok(Object.is(image.object.baseX, -0));

  const sample = oracle.profiles[0].samples.find((s) => s.name === 'plane'),
    plane = fixture({
      ...sample.before,
      x: -0,
      y: 0,
      z: 0,
      positionW: -0,
      baseX: -0,
      baseY: 0,
      baseZ: 0,
      baseW: -0,
      pri: 0,
      scaleX: -0,
      scaleY: 1,
      scaleZ: 1,
      scaleW: -0,
    }),
    packet = fesMotionState(plane.object),
    packetView = new DataView(packet.buffer);
  for (const offset of [MOTION_ABI.pos, MOTION_ABI.base, MOTION_ABI.scale])
    packetView.setFloat32(offset, 0, true);
  applyFESMotionState(plane.instance, plane.object, packet);
  for (const key of ['x', 'positionW', 'baseX', 'baseW', 'scaleX', 'scaleW'])
    assert.ok(Object.is(plane.object[key], -0), key);
  packetView.setFloat32(MOTION_ABI.pos + 4, 1, true);
  applyFESMotionState(plane.instance, plane.object, packet);
  assert.ok(Object.is(plane.object.x, 0));
  assert.ok(Object.is(plane.object.positionW, 0));
});
