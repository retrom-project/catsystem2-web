// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Instance transform/state algorithms adapted from official Effekseer 1.23,
// 5239bb1e416cbf55b4d3c8170594cbdc7815f263. Required-operation CPU state seam.
// Full upstream grant: ../../licenses/effekseer-MIT.txt.
import { EffekseerNumericError, initializeValue, evaluateValue, sampleInt } from './numerical.mjs';
import {
  identity43,
  getScale43,
  getRotation43,
  setSRT43,
  scaling43,
  rotationZXY43,
  rotationAxis43,
  translation43,
  multiply43,
} from './math43.mjs';
import {
  initializeGeneration,
  createGenerationScratch,
  copyGenerationMatrix,
} from './generation.mjs';

const f = Math.fround;
const ZERO = Object.freeze([0, 0, 0]),
  ONE = Object.freeze([1, 1, 1]);
const finite = (value, field) => {
  const result = f(value);
  if (!Number.isFinite(result))
    throw new EffekseerNumericError(field, 'nonfinite instance transform');
  return result;
};
const add = (a, b) => finite(f(a) + f(b), 'instance.add');
const sub = (a, b) => finite(f(a) - f(b), 'instance.sub');
const mul = (a, b) => finite(f(a) * f(b), 'instance.mul');
const div = (a, b) => finite(f(a) / f(b), 'instance.div');
const vector = () => new Float32Array(3);
const matrix = () => new Float32Array(12);
const length = (v) =>
  finite(Math.sqrt(add(add(mul(v[0], v[0]), mul(v[1], v[1])), mul(v[2], v[2]))), 'instance.length');

function initializeParentMatrix(node, parent) {
  const target = identity43(),
    common = node.common;
  if (common.translationBind === 1)
    for (let i = 0; i < 3; i++) target[9 + i] = parent.matrix[9 + i];
  if (common.rotationBind === 1 && common.scalingBind === 1) {
    for (let i = 0; i < 9; i++) target[i] = parent.matrix[i];
  } else if (common.rotationBind === 1) {
    const rotation = getRotation43(parent.matrix);
    for (let i = 0; i < 9; i++) target[i] = rotation[i];
  } else if (common.scalingBind === 1) {
    const scale = getScale43(parent.matrix);
    for (let i = 0; i < 3; i++) target[i * 3 + i] = scale[i];
  }
  return target;
}
function updateParentMatrix(node, state, parent, root, scratch) {
  if (!parent) return;
  const common = node.common,
    binds = [common.translationBind, common.rotationBind, common.scalingBind];
  if (binds.every((value) => value === 2)) {
    state.parentMatrix.set(parent.matrix);
    return;
  }
  if (binds.every((value) => value === 3)) {
    if (!root)
      throw new EffekseerNumericError('instance.rootBind', 'source root instance is absent');
    state.parentMatrix.set(root.matrix);
    return;
  }
  const scale = getScale43(state.parentMatrix, scratch.parentScale),
    rotation = getRotation43(state.parentMatrix, scratch.parentRotation, scratch.auxScale),
    position = scratch.parentPosition;
  for (let i = 0; i < 3; i++) position[i] = state.parentMatrix[9 + i];
  const translationSource = binds[0] === 2 ? parent : binds[0] === 3 ? root : null;
  if (translationSource) for (let i = 0; i < 3; i++) position[i] = translationSource.matrix[9 + i];
  const rotationSource = binds[1] === 2 ? parent : binds[1] === 3 ? root : null;
  if (rotationSource) getRotation43(rotationSource.matrix, rotation, scratch.auxScale);
  const scalingSource = binds[2] === 2 ? parent : binds[2] === 3 ? root : null;
  if (scalingSource) getScale43(scalingSource.matrix, scale);
  setSRT43(scale, rotation, position, state.parentMatrix, scratch.scaleMatrix);
}
function absoluteForce(node, state, output, age, delta, target, scratch) {
  const absolute = node.absolute;
  if (absolute.type === 'none') return;
  if (absolute.type === 'gravity') {
    for (let i = 0; i < 3; i++)
      state.revisionLocation[i] = mul(mul(mul(absolute.value[i], age), age), 0.5);
  } else if (absolute.type === 'attractive') {
    let [force, control, minRange, maxRange] = absolute.values;
    const difference = scratch.targetDifference,
      direction = scratch.targetDirection;
    for (let i = 0; i < 3; i++)
      difference[i] = sub(
        target[i],
        add(sub(state.globalPosition[i], state.globalVelocity[i]), state.revisionLocation[i]),
      );
    const distance = length(difference);
    if (distance > 0) {
      for (let i = 0; i < 3; i++) direction[i] = div(difference[i], distance);
      if (minRange > 0 || maxRange > 0) {
        if (distance >= maxRange) force = 0;
        else if (distance > minRange)
          force = mul(force, sub(1, div(sub(distance, minRange), sub(maxRange, minRange))));
      }
      for (let i = 0; i < 3; i++)
        state.revisionVelocity[i] = add(
          state.revisionVelocity[i],
          mul(mul(direction[i], force), delta),
        );
      const speed = length(state.revisionVelocity);
      // Preserve the source arithmetic domain. Do not skip a zero velocity or
      // invent a direction to turn its uncalibrated 0/0 into a working force.
      for (let i = 0; i < 3; i++) {
        const currentDirection = div(state.revisionVelocity[i], speed);
        state.revisionVelocity[i] = mul(
          add(mul(direction[i], control), mul(currentDirection, sub(1, control))),
          speed,
        );
        state.revisionLocation[i] = add(
          state.revisionLocation[i],
          mul(state.revisionVelocity[i], delta),
        );
      }
    }
  } else
    throw new EffekseerNumericError('instance.absolute', `unimplemented type ${absolute.type}`);
  translation43(...state.revisionLocation, scratch.temporaryMatrix);
  multiply43(output, scratch.temporaryMatrix, output);
}
export function createInstanceTransformScratch() {
  return {
    generation: createGenerationScratch(),
    generationMatrix: matrix(),
    parentScale: vector(),
    parentRotation: matrix(),
    parentPosition: vector(),
    auxScale: vector(),
    localPosition: vector(),
    localAngle: vector(),
    localScale: vector(),
    temporaryMatrix: matrix(),
    scaleMatrix: matrix(),
    targetDifference: vector(),
    targetDirection: vector(),
  };
}
export function initializeInstanceTransform({
  node,
  instance,
  parent,
  random,
  initializeRendered,
  scratch = createInstanceTransformScratch(),
}) {
  if (!parent || typeof initializeRendered !== 'function')
    throw new TypeError('Instance transform requires its parent and rendered-state initializer');
  const state = {
    parentMatrix: initializeParentMatrix(node, parent),
    globalPosition: Float32Array.from(parent.matrix.slice(9, 12)),
    globalVelocity: vector(),
    velocityReady: false,
    revisionLocation: vector(),
    revisionVelocity: vector(),
    translation: null,
    rotation: null,
    scaling: null,
    generation: null,
    soundDelay: null,
    rendered: null,
  };
  state.translation = initializeValue(node.translation, random);
  state.rotation = initializeValue(node.rotation, random);
  state.scaling = initializeValue(node.scaling, random);
  // The verified 76 wrapper installs no ModelLoader. Model generation takes
  // that real null branch; it does not fabricate an emitter or consume draws.
  state.generation = initializeGeneration(node.generation, instance.number, random, {
    model: null,
    scratch: scratch.generation,
  });
  state.soundDelay = node.sound ? sampleInt(node.sound.delay, random) : null;
  state.rendered = initializeRendered({ node, instance, random });
  return state;
}
export function calculateInstanceTransform({
  node,
  instance,
  parent,
  root,
  set,
  delta,
  updateRendered,
  scratch = createInstanceTransformScratch(),
}) {
  if (typeof updateRendered !== 'function')
    throw new TypeError('Instance rendered-state updater is required');
  const state = instance.values;
  updateParentMatrix(node, state, parent, root, scratch);
  const position = evaluateValue(node.translation, state.translation, instance.age, instance.life, {
      identity: ZERO,
      out: scratch.localPosition,
    }),
    generation = copyGenerationMatrix(state.generation, scratch.generationMatrix);
  if (!state.generation.effectsRotation)
    for (let i = 0; i < 3; i++) position[i] = add(position[i], generation[9 + i]);
  const angle = evaluateValue(node.rotation, state.rotation, instance.age, instance.life, {
      identity: ZERO,
      out: scratch.localAngle,
    }),
    scaleValue = evaluateValue(node.scaling, state.scaling, instance.age, instance.life, {
      identity: ONE,
      out: scratch.localScale,
    }),
    scale = typeof scaleValue === 'number' ? scratch.localScale.fill(scaleValue) : scaleValue;
  updateRendered({ node, instance, state: state.rendered });
  const output = scaling43(scale[0], scale[1], scale[2], instance.matrix);
  if (node.rotation.type === 'axis-pva' || node.rotation.type === 'axis-easing') {
    rotationAxis43(state.rotation.axis, angle, scratch.temporaryMatrix);
    multiply43(output, scratch.temporaryMatrix, output);
  } else if (node.rotation.type !== 'none') {
    rotationZXY43(angle[2], angle[0], angle[1], scratch.temporaryMatrix);
    multiply43(output, scratch.temporaryMatrix, output);
  }
  if (position.some((n) => n !== 0)) {
    translation43(...position, scratch.temporaryMatrix);
    multiply43(output, scratch.temporaryMatrix, output);
  }
  if (state.generation.effectsRotation) multiply43(output, generation, output);
  multiply43(output, state.parentMatrix, output);
  for (let i = 0; i < 3; i++) {
    state.globalVelocity[i] = sub(output[9 + i], state.globalPosition[i]);
    state.globalPosition[i] = output[9 + i];
  }
  state.velocityReady = true;
  absoluteForce(node, state, output, instance.age, f(delta), set.global.targetLocation, scratch);
  return output;
}
