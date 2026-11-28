// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Algorithms adapted from Effekseer 1.23, commit
// 5239bb1e416cbf55b4d3c8170594cbdc7815f263. See ../../licenses/effekseer-MIT.txt.
// Circle endpoint behavior additionally verified statically in fixed game76
// The endpoint decrements the denominator, retaining the sampled target.
import { EffekseerNumericError, sampleFloat, sampleInt, sampleVector } from './numerical.mjs';
import {
  floatBits,
  identity43,
  translation43,
  rotationX43,
  rotationY43,
  rotationZ43,
  multiply43,
} from './math43.mjs';

const f = Math.fround;
const add = (a, b) => f(f(a) + f(b));
const sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b));
const div = (a, b) => f(f(a) / f(b));
const SCHEMA = Object.freeze({
  point: { floats: [], vectors: ['position'], integers: [], strings: [] },
  sphere: { floats: ['rotationX', 'rotationY', 'radius'], vectors: [], integers: [], strings: [] },
  circle: {
    floats: ['radius', 'angleStart', 'angleEnd', 'angle'],
    vectors: [],
    integers: ['mode', 'division', 'divisionClamped', 'divisionUsed', 'target'],
    strings: [],
  },
  model: { floats: [], vectors: [], integers: ['index', 'mode'], strings: ['modelUnavailable'] },
});

export class EffekseerGenerationError extends EffekseerNumericError {
  constructor(field, reason, sampledState = null) {
    super(`generation.${field}`, reason);
    this.name = 'EffekseerGenerationError';
    if (sampledState !== null) this.sampledState = sampledState;
  }
}
function fail(field, reason, state) {
  throw new EffekseerGenerationError(field, reason, state);
}
function integer(value, field) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
    fail(field, `requires signed int32, got ${value}`);
  return value === 0 ? 0 : value;
}
function float(value, field) {
  const result = f(value);
  if (!Number.isFinite(result)) fail(field, `nonfinite float ${value}`);
  return result;
}
function exactStoredFloat(value, field) {
  const result = float(value, field);
  if (!Object.is(result, value)) fail(field, 'stored state requires an exact float32 value');
  return result;
}
function sequence(value, length, field) {
  if (!value || value.length !== length) fail(field, `requires ${length} components`);
  return value;
}
function typeSchema(type) {
  if (!Object.hasOwn(SCHEMA, type)) fail('type', `unimplemented type ${type}`);
  return SCHEMA[type];
}
function choice(value, values, field) {
  if (!values.includes(value)) fail(field, `unimplemented operation ${value}`);
  return value;
}

// Scratch buffers are transient arithmetic workspace, not authoritative instance
// state. The owning World may reuse one set across sequential initializations.
export function createGenerationScratch() {
  return {
    a: new Float32Array(12),
    b: new Float32Array(12),
    c: new Float32Array(12),
    d: new Float32Array(12),
    trig: new Float32Array(2),
  };
}
function validateScratch(scratch) {
  for (const name of ['a', 'b', 'c', 'd']) sequence(scratch?.[name], 12, `scratch.${name}`);
  sequence(scratch.trig, 2, 'scratch.trig');
  // The source calculations require distinct matrices; aliasing would clobber
  // rotations before they are multiplied. Reject shared storage explicitly.
  const arrays = [scratch.a, scratch.b, scratch.c, scratch.d, scratch.trig];
  for (let i = 0; i < arrays.length; i++) {
    for (let j = i + 1; j < arrays.length; j++) {
      if (
        arrays[i] === arrays[j] ||
        (ArrayBuffer.isView(arrays[i]) &&
          ArrayBuffer.isView(arrays[j]) &&
          arrays[i].buffer === arrays[j].buffer &&
          arrays[i].byteOffset < arrays[j].byteOffset + arrays[j].byteLength &&
          arrays[j].byteOffset < arrays[i].byteOffset + arrays[i].byteLength)
      )
        fail('scratch', 'overlapping arithmetic buffers');
    }
  }
  return scratch;
}

// Matches src/effekseer/effect-reader.mjs parameter fields. RNG is supplied by
// the caller's shared logical-thread stream; this module never seeds it.
// A non-null resolved model is deliberately unsupported. The actual game76
// wrapper has no ModelLoader, so all nonnegative model references resolve null.
export function initializeGeneration(
  parameter,
  instanceNumber,
  rng,
  { model = null, scratch } = {},
) {
  typeSchema(parameter?.type);
  if (typeof parameter.effectsRotation !== 'boolean')
    fail('effectsRotation', 'requires reader boolean');
  instanceNumber = integer(instanceNumber, 'instanceNumber');
  const work = validateScratch(scratch ?? createGenerationScratch());
  const state = {
    type: parameter.type,
    effectsRotation: parameter.effectsRotation,
    instanceNumber,
    randomDraws: 0,
  };
  let matrix;
  switch (parameter.type) {
    case 'point':
      state.position = Array.from(sampleVector(parameter.location, rng));
      sequence(state.position, 3, 'point.location');
      state.randomDraws = 3;
      matrix = translation43(state.position[0], state.position[1], state.position[2], work.a);
      break;
    case 'sphere':
      // Source order is X, Y, radius, despite the reader's radius-first object.
      state.rotationX = sampleFloat(parameter.rotationX, rng);
      rotationX43(state.rotationX, work.a, work.trig);
      state.rotationY = sampleFloat(parameter.rotationY, rng);
      rotationY43(state.rotationY, work.b, work.trig);
      state.radius = sampleFloat(parameter.radius, rng);
      state.randomDraws = 3;
      translation43(0, state.radius, 0, work.c);
      multiply43(work.c, work.a, work.d);
      matrix = multiply43(work.d, work.b, work.c);
      break;
    case 'circle': {
      state.mode = choice(parameter.mode, [0, 1, 2], 'circle.mode');
      state.division = integer(parameter.division, 'circle.division');
      state.radius = sampleFloat(parameter.radius, rng);
      state.angleStart = sampleFloat(parameter.angleStart, rng);
      state.angleEnd = sampleFloat(parameter.angleEnd, rng);
      state.randomDraws = 3;
      state.divisionClamped = Math.max(state.division, 1);
      state.divisionUsed = state.divisionClamped;
      if (state.mode === 1) state.target = instanceNumber % state.divisionClamped;
      else if (state.mode === 2)
        state.target = state.divisionClamped - 1 - (instanceNumber % state.divisionClamped);
      else {
        // Native CVTTSS2SI after float32 ratio*division. The injected CRT-domain
        // sampler also rejects uncalibrated float-to-int overflow explicitly.
        state.target = sampleInt({ min: 0, max: state.divisionClamped }, rng);
        state.randomDraws = 4;
        // At the inclusive random endpoint the old implementation decrements the denominator.
        if (state.target === state.divisionClamped) state.divisionUsed -= 1;
      }
      state.target = integer(state.target, 'circle.target');
      if (state.divisionUsed === 0)
        fail(
          'circle.division',
          'circle endpoint branch reduced division 1 to 0; resulting nonfinite angle is unsupported',
          state,
        );
      state.angle = float(
        add(
          mul(sub(state.angleEnd, state.angleStart), div(state.target, state.divisionUsed)),
          state.angleStart,
        ),
        'circle.angle',
      );
      rotationZ43(state.angle, work.a, work.trig);
      translation43(0, state.radius, 0, work.b);
      matrix = multiply43(work.b, work.a, work.c);
      break;
    }
    case 'model':
      state.index = integer(parameter.index, 'model.index');
      state.mode = choice(parameter.mode, [0, 1, 2, 3, 4], 'model.mode');
      if (state.index >= 0 && model !== null)
        fail(
          'model',
          'non-null model emission is unimplemented; this helper only implements the verified null ModelLoader branch',
        );
      state.modelUnavailable = state.index < 0 ? 'negative-index' : 'null-model';
      matrix = identity43(work.a);
      break;
  }
  state.matrix = Array.from(matrix);
  validateGenerationState(state);
  return state;
}

// Generation matrices are cached at initialization. effectsRotation=false makes
// Instance add only their translation to its local position; true makes it
// multiply the entire matrix after local SRT and before the parent matrix.
// This helper does not advance time or compose those separate lifecycle values.
export function copyGenerationMatrix(state, out = new Float32Array(12)) {
  validateGenerationState(state);
  sequence(out, 12, 'matrix.out');
  for (let i = 0; i < 12; i++) out[i] = state.matrix[i];
  return out;
}
export function validateGenerationState(state) {
  const schema = typeSchema(state?.type);
  if (typeof state.effectsRotation !== 'boolean') fail('state.effectsRotation', 'requires boolean');
  integer(state.instanceNumber, 'state.instanceNumber');
  const expectedDraws =
    state.type === 'model' ? 0 : state.type === 'circle' && state.mode === 0 ? 4 : 3;
  if (state.randomDraws !== expectedDraws) fail('state.randomDraws', `expected ${expectedDraws}`);
  sequence(state.matrix, 12, 'state.matrix');
  for (let i = 0; i < 12; i++) exactStoredFloat(state.matrix[i], `state.matrix[${i}]`);
  for (const name of schema.floats) exactStoredFloat(state[name], `state.${name}`);
  for (const name of schema.vectors) {
    sequence(state[name], 3, `state.${name}`);
    for (let i = 0; i < 3; i++) exactStoredFloat(state[name][i], `state.${name}[${i}]`);
  }
  for (const name of schema.integers) integer(state[name], `state.${name}`);
  if (state.type === 'circle') {
    choice(state.mode, [0, 1, 2], 'state.circle.mode');
    if (state.divisionClamped !== Math.max(state.division, 1))
      fail('state.circle.divisionClamped', 'does not match source clamp');
    const expectedDivision =
      state.mode === 0 && state.target === state.divisionClamped
        ? state.divisionClamped - 1
        : state.divisionClamped;
    if (state.divisionUsed !== expectedDivision || state.divisionUsed <= 0)
      fail('state.circle.divisionUsed', 'does not match verified endpoint branch');
  }
  if (state.type === 'model') {
    choice(state.mode, [0, 1, 2, 3, 4], 'state.model.mode');
    if (state.modelUnavailable !== (state.index < 0 ? 'negative-index' : 'null-model'))
      fail('state.modelUnavailable', 'inconsistent null-model branch');
  }
  return state;
}

// Snapshot float fields as uint32 bits so plain JSON also retains signed zero.
// The saved matrix is authoritative: restore never replays RNG or recomputes it.
export function snapshotGeneration(state) {
  validateGenerationState(state);
  const schema = SCHEMA[state.type],
    floatBitsByName = {},
    selection = {};
  for (const name of schema.floats) floatBitsByName[name] = floatBits(state[name]);
  for (const name of schema.vectors) floatBitsByName[name] = state[name].map(floatBits);
  for (const name of [...schema.integers, ...schema.strings]) selection[name] = state[name];
  return {
    type: state.type,
    effectsRotation: state.effectsRotation,
    instanceNumber: state.instanceNumber,
    randomDraws: state.randomDraws,
    matrixBits: state.matrix.map(floatBits),
    floatBitsByName,
    selection,
  };
}
function readFloatBits(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    fail(field, 'requires uint32 float bits');
  const bytes = new ArrayBuffer(4),
    view = new DataView(bytes);
  view.setUint32(0, value, true);
  return float(view.getFloat32(0, true), field);
}
function exactKeys(object, names, field) {
  if (!object || typeof object !== 'object' || Array.isArray(object))
    fail(field, 'requires object');
  const keys = Object.keys(object).sort(),
    expected = [...names].sort();
  if (keys.length !== expected.length || keys.some((name, i) => name !== expected[i]))
    fail(field, 'unimplemented or missing saved fields');
}
export function restoreGeneration(snapshot) {
  const schema = typeSchema(snapshot?.type);
  exactKeys(
    snapshot,
    [
      'type',
      'effectsRotation',
      'instanceNumber',
      'randomDraws',
      'matrixBits',
      'floatBitsByName',
      'selection',
    ],
    'snapshot',
  );
  exactKeys(
    snapshot.floatBitsByName,
    [...schema.floats, ...schema.vectors],
    'snapshot.floatBitsByName',
  );
  exactKeys(snapshot.selection, [...schema.integers, ...schema.strings], 'snapshot.selection');
  sequence(snapshot.matrixBits, 12, 'snapshot.matrixBits');
  const state = {
    type: snapshot.type,
    effectsRotation: snapshot.effectsRotation,
    instanceNumber: snapshot.instanceNumber,
    randomDraws: snapshot.randomDraws,
    matrix: Array.from(snapshot.matrixBits, (value, i) =>
      readFloatBits(value, `snapshot.matrixBits[${i}]`),
    ),
  };
  for (const name of schema.floats)
    state[name] = readFloatBits(snapshot.floatBitsByName[name], `snapshot.${name}`);
  for (const name of schema.vectors) {
    sequence(snapshot.floatBitsByName[name], 3, `snapshot.${name}`);
    state[name] = Array.from(snapshot.floatBitsByName[name], (value) =>
      readFloatBits(value, `snapshot.${name}`),
    );
  }
  for (const name of [...schema.integers, ...schema.strings])
    state[name] = snapshot.selection[name];
  return validateGenerationState(state);
}
