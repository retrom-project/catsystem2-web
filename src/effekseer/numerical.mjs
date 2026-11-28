// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Algorithms adapted from Effekseer 1.23, commit
// 5239bb1e416cbf55b4d3c8170594cbdc7815f263. See ../../licenses/effekseer-MIT.txt.
// Scope and source identity: ../../docs/effekseer.md.
// All sampled state is plain data; evaluation never draws randomness.
const f = Math.fround;
const add = (a, b) => f(f(a) + f(b));
const sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b));
const div = (a, b) => f(f(a) / f(b));
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

export class EffekseerNumericError extends Error {
  constructor(field, reason) {
    super(`Effekseer 1.23 ${field}: ${reason}`);
    this.name = 'EffekseerNumericError';
    Object.assign(this, { field, reason });
  }
}
function fail(field, reason) {
  throw new EffekseerNumericError(field, reason);
}
function finite(value, field) {
  const result = f(value);
  if (!Number.isFinite(result)) fail(field, `nonfinite float ${value}`);
  return result;
}
function i32(value, field) {
  if (!Number.isInteger(value) || value < I32_MIN || value > I32_MAX)
    fail(field, `unsupported int32 value ${value}`);
  return value === 0 ? 0 : value;
}
export function frameInt32(value) {
  return i32(Math.trunc(finite(value, 'frame')), 'frame');
}
function sequence(value, field, count = null) {
  if (!value || !Number.isSafeInteger(value.length) || (count !== null && value.length !== count))
    fail(field, `requires ${count === null ? 'a' : count + '-component'} sequence`);
  return value;
}
function output(out, count, field, bytes = false) {
  if (out === undefined || out === null)
    return bytes ? new Uint8Array(count) : new Float32Array(count);
  sequence(out, field, count);
  return out;
}
function copyValue(value, out) {
  if (typeof value === 'number') return finite(value, 'value');
  sequence(value, 'value');
  const result = output(out, value.length, 'value.out');
  for (let i = 0; i < value.length; i++) result[i] = finite(value[i], `value[${i}]`);
  return result;
}
function scalarRange(range, field) {
  if (!range || typeof range.min !== 'number' || typeof range.max !== 'number')
    fail(field, 'requires scalar min and max');
}
function nextRatio(rng) {
  if (!rng || typeof rng.nextInt !== 'function') fail('rng', 'requires nextInt()');
  const value = rng.nextInt();
  if (!Number.isInteger(value) || value < 0 || value > 32767)
    fail('rng', `nextInt() returned ${value}; expected 0..32767`);
  return div(value, 32767);
}

// InternalStruct::random_float. Equal and reversed limits retain the draw.
export function sampleFloat(range, rng) {
  scalarRange(range, 'random_float');
  const max = finite(range.max, 'random_float.max');
  const min = finite(range.min, 'random_float.min');
  return finite(add(mul(sub(max, min), nextRatio(rng)), min), 'random_float.result');
}

// Source subtracts signed int32, multiplies in float32, truncates BEFORE adding min.
// Native overflowing subtraction/conversion is not calibrated; reject that domain.
export function sampleInt(range, rng) {
  scalarRange(range, 'random_int');
  const max = i32(range.max, 'random_int.max');
  const min = i32(range.min, 'random_int.min');
  const difference = i32(max - min, 'random_int.max-min');
  const scaled = mul(difference, nextRatio(rng));
  const truncated = i32(Math.trunc(scaled), 'random_int.float-to-int');
  return i32(truncated + min, 'random_int.result');
}

export function sampleVector(range, rng, out) {
  const min = sequence(range?.min, 'random_vector.min');
  const max = sequence(range?.max, 'random_vector.max', min.length);
  const result = output(out, min.length, 'random_vector.out');
  for (let i = 0; i < min.length; i++) result[i] = sampleFloat({ min: min[i], max: max[i] }, rng);
  return result;
}
function sampleShape(range, rng) {
  return typeof range?.min === 'number'
    ? sampleFloat(range, rng)
    : Array.from(sampleVector(range, rng));
}

// InternalStruct::easing_float/easing_vector2d/easing_vector3d. No time clamp.
export function easingFactor(coefficients, time) {
  sequence(coefficients, 'easing.coefficients', 3);
  const a = finite(coefficients[0], 'easing.A');
  const b = finite(coefficients[1], 'easing.B');
  const c = finite(coefficients[2], 'easing.C');
  const t = finite(time, 'easing.time');
  return finite(add(add(mul(mul(mul(a, t), t), t), mul(mul(b, t), t)), mul(c, t)), 'easing.factor');
}
export function evaluateEasing(start, end, coefficients, time, out) {
  const d = easingFactor(coefficients, time);
  if (typeof start === 'number') {
    if (typeof end !== 'number') fail('easing.end', 'scalar/vector mismatch');
    return finite(add(start, mul(d, sub(end, start))), 'easing.result');
  }
  sequence(start, 'easing.start');
  sequence(end, 'easing.end', start.length);
  const result = output(out, start.length, 'easing.out');
  for (let i = 0; i < start.length; i++)
    result[i] = finite(add(start[i], mul(d, sub(end[i], start[i]))), `easing.result[${i}]`);
  return result;
}
export function evaluatePva(position, velocity, acceleration, time, out) {
  const t = finite(time, 'pva.time');
  const evaluate = (p, v, a) =>
    finite(add(add(p, mul(v, t)), mul(mul(mul(a, t), t), 0.5)), 'pva.result');
  if (typeof position === 'number') {
    if (typeof velocity !== 'number' || typeof acceleration !== 'number')
      fail('pva', 'scalar/vector mismatch');
    return evaluate(position, velocity, acceleration);
  }
  sequence(position, 'pva.position');
  sequence(velocity, 'pva.velocity', position.length);
  sequence(acceleration, 'pva.acceleration', position.length);
  const result = output(out, position.length, 'pva.out');
  for (let i = 0; i < position.length; i++)
    result[i] = evaluate(position[i], velocity[i], acceleration[i]);
  return result;
}

export function sampleCurveOffset(curve, rng) {
  return sampleFloat(curve.offsets, rng);
}

// Literal old FCurve::GetValue edge/segment rules, including the asymmetric
// negative-loop endpoint. Missing ind+1 is an explicit error, not a zero/NaN key.
export function evaluateCurve(curve, frame) {
  const keys = sequence(curve?.keys, 'curve.keys');
  if (!keys.length) return finite(curve.defaultValue, 'curve.defaultValue');
  let current = i32(
    i32(frame, 'curve.frame') - i32(curve.offset, 'curve.offset'),
    'curve.frame-offset',
  );
  const length = i32(curve.length, 'curve.length');
  if (length < 0) fail('curve.length', `negative length ${length}`);
  for (const name of ['edgeStart', 'edgeEnd'])
    if (![0, 1, 2].includes(curve[name]))
      fail(`curve.${name}`, `unimplemented edge ${curve[name]}`);
  if (current < 0) {
    if (curve.edgeStart === 0) return finite(keys[0], 'curve.first');
    if (length === 0) fail('curve.edgeStart', 'loop with zero length');
    const negated = i32(-current, 'curve.negatedFrame');
    current = curve.edgeStart === 1 ? length - (negated % length) : negated % length;
  }
  if (length < current) {
    if (curve.edgeEnd === 0) return finite(keys[keys.length - 1], 'curve.last');
    if (length === 0) fail('curve.edgeEnd', 'loop with zero length');
    const difference = i32(current - length, 'curve.frame-length');
    current = curve.edgeEnd === 1 ? difference % length : length - (difference % length);
  }
  const frequency = i32(curve.frequency, 'curve.frequency');
  if (frequency <= 0)
    fail('curve.frequency', `source division requires positive frequency, got ${frequency}`);
  const index = Math.trunc(current / frequency);
  if (current === length) return finite(keys[keys.length - 1], 'curve.last');
  if (index < 0 || index + 1 >= keys.length)
    fail(
      'curve.keys',
      `source requests missing segment ${index}/${index + 1}; ${keys.length} keys`,
    );
  const subFrame = index === keys.length - 1 ? length - index * frequency : frequency;
  if (subFrame <= 0) fail('curve.segment', `unsupported denominator ${subFrame}`);
  const delta = sub(keys[index + 1], keys[index]);
  return finite(
    add(mul(div(delta, subFrame), current - index * frequency), keys[index]),
    'curve.result',
  );
}

// Reader-compatible numeric parameter initialization. Fixed parameters draw zero;
// random/PVA/easing/curve offsets always draw, even with equal limits or no keys.
// Axis scalar values precede XYZ axis values in Instance::Initialize.
export function initializeValue(parameter, rng) {
  const type = parameter?.type;
  const state = { type };
  switch (type) {
    case 'none':
    case 'fixed':
      return state;
    case 'random':
      state.value = sampleShape(parameter, rng);
      return state;
    case 'pva':
    case 'single-pva':
    case 'axis-pva':
      state.position = sampleShape(parameter.position, rng);
      state.velocity = sampleShape(parameter.velocity, rng);
      state.acceleration = sampleShape(parameter.acceleration, rng);
      if (type === 'axis-pva') state.axis = Array.from(sampleVector(parameter.axis, rng));
      return state;
    case 'easing':
    case 'single-easing':
    case 'axis-easing': {
      const easing = type === 'axis-easing' ? parameter.easing : parameter;
      state.start = sampleShape(easing.start, rng);
      state.end = sampleShape(easing.end, rng);
      if (type === 'axis-easing') state.axis = Array.from(sampleVector(parameter.axis, rng));
      return state;
    }
    case 'curve':
      state.offsets = sequence(parameter.curves, 'curves').map((curve) =>
        sampleCurveOffset(curve, rng),
      );
      return state;
    default:
      fail('value.type', `unimplemented type ${type}`);
  }
}

// Returns a scalar for single/axis/ring scalar parameters and a vector otherwise.
// For None the caller supplies identity 0/[0,0,0] or 1/[1,1,1] as appropriate.
// sampledState.axis is the unnormalized stored axis for the axis variants.
export function evaluateValue(parameter, state, livingTime, livedTime, { identity = 0, out } = {}) {
  if (parameter?.type !== state?.type) fail('value.state', 'parameter/state type mismatch');
  switch (parameter.type) {
    case 'none':
      return copyValue(identity, out);
    case 'fixed':
      return copyValue(parameter.value, out);
    case 'random':
      return copyValue(state.value, out);
    case 'pva':
    case 'single-pva':
    case 'axis-pva':
      return evaluatePva(state.position, state.velocity, state.acceleration, livingTime, out);
    case 'easing':
    case 'single-easing':
    case 'axis-easing': {
      const easing = parameter.type === 'axis-easing' ? parameter.easing : parameter;
      return evaluateEasing(
        state.start,
        state.end,
        easing.coefficients,
        div(livingTime, livedTime),
        out,
      );
    }
    case 'curve': {
      const curves = sequence(parameter.curves, 'curves');
      sequence(state.offsets, 'curves.offsets', curves.length);
      const frame = frameInt32(livingTime);
      const result = output(out, curves.length, 'curves.out');
      for (let i = 0; i < curves.length; i++)
        result[i] = finite(
          add(evaluateCurve(curves[i], frame), state.offsets[i]),
          `curves.result[${i}]`,
        );
      return result;
    }
    default:
      fail('value.type', `unimplemented type ${parameter.type}`);
  }
}

function channels(value, field) {
  sequence(value, field, 4);
  for (let i = 0; i < 4; i++)
    if (!Number.isInteger(value[i]) || value[i] < 0 || value[i] > 255)
      fail(field, `channel ${i} outside uint8: ${value[i]}`);
  return value;
}
function colorMode(mode) {
  if (mode !== 0 && mode !== 1) fail('color.mode', `unimplemented mode ${mode}`);
  return mode;
}
function byte(value, field) {
  const truncated = Math.trunc(value);
  if (!Number.isFinite(value) || truncated < 0 || truncated > 255)
    fail(field, `unsupported float-to-uint8 value ${value}`);
  return truncated === 0 ? 0 : truncated;
}
function clampByte(value) {
  return byte(Math.min(255, Math.max(0, finite(value, 'color.channel'))), 'color.channel');
}
function copyColor(value, out) {
  channels(value, 'color');
  const result = output(out, 4, 'color.out', true);
  for (let i = 0; i < 4; i++) result[i] = value[i];
  return result;
}

// InternalStruct::HSVToRGB: H uses 42 units per sector and clamps at 252.
export function hsvaToRgba(hsva, out) {
  channels(hsva, 'hsva');
  const result = output(out, 4, 'rgba.out', true);
  const h = Math.min(252, hsva[0]),
    v = hsva[2];
  const sector = Math.trunc(h / 42);
  const fraction = sub(div(h, 42), sector);
  const saturation = div(hsva[1], 255);
  const p = byte(mul(v, sub(1, saturation)), 'hsva.p');
  const q = byte(mul(v, sub(1, mul(fraction, saturation))), 'hsva.q');
  const t = byte(mul(v, sub(1, mul(sub(1, fraction), saturation))), 'hsva.t');
  switch (sector % 6) {
    case 0:
      result[0] = v;
      result[1] = t;
      result[2] = p;
      break;
    case 1:
      result[0] = q;
      result[1] = v;
      result[2] = p;
      break;
    case 2:
      result[0] = p;
      result[1] = v;
      result[2] = t;
      break;
    case 3:
      result[0] = p;
      result[1] = q;
      result[2] = v;
      break;
    case 4:
      result[0] = t;
      result[1] = p;
      result[2] = v;
      break;
    case 5:
      result[0] = v;
      result[1] = p;
      result[2] = q;
      break;
  }
  result[3] = hsva[3];
  return result;
}
export function sampleColor(range, rng, { direct = false, out } = {}) {
  colorMode(range?.mode);
  channels(range.min, 'color.min');
  channels(range.max, 'color.max');
  const result = output(out, 4, 'color.out', true);
  for (let i = 0; i < 4; i++)
    result[i] = byte(
      sampleFloat({ min: range.min[i], max: range.max[i] }, rng),
      `color.sample[${i}]`,
    );
  return range.mode === 1 && !direct ? hsvaToRgba(result, result) : result;
}
export function initializeColor(parameter, rng) {
  const state = { type: parameter?.type };
  switch (state.type) {
    case 'fixed':
      channels(parameter.value, 'color.fixed');
      return state;
    case 'random':
      state.value = Array.from(sampleColor(parameter, rng));
      return state;
    case 'easing':
      if (colorMode(parameter.start.mode) !== colorMode(parameter.end.mode))
        fail('color.easing.mode', 'start and end modes differ');
      // HSV endpoints remain in HSV until after interpolation.
      state.start = Array.from(sampleColor(parameter.start, rng, { direct: true }));
      state.end = Array.from(sampleColor(parameter.end, rng, { direct: true }));
      return state;
    case 'curve':
      sequence(parameter.curves, 'color.curves', 4);
      state.offsets = parameter.curves.map((curve) => sampleCurveOffset(curve, rng));
      return state;
    default:
      fail('color.type', `unimplemented type ${state.type}`);
  }
}
export function evaluateColor(parameter, state, livingTime, livedTime, out) {
  if (parameter?.type !== state?.type) fail('color.state', 'parameter/state type mismatch');
  switch (parameter.type) {
    case 'fixed':
      return copyColor(parameter.value, out);
    case 'random':
      return copyColor(state.value, out);
    case 'easing': {
      if (colorMode(parameter.start.mode) !== colorMode(parameter.end.mode))
        fail('color.easing.mode', 'start and end modes differ');
      channels(state.start, 'color.start');
      channels(state.end, 'color.end');
      const result = output(out, 4, 'color.out', true);
      const d = easingFactor(parameter.coefficients, div(livingTime, livedTime));
      for (let i = 0; i < 4; i++)
        result[i] = clampByte(add(state.start[i], mul(d, state.end[i] - state.start[i])));
      return parameter.start.mode === 1 ? hsvaToRgba(result, result) : result;
    }
    case 'curve': {
      sequence(parameter.curves, 'color.curves', 4);
      sequence(state.offsets, 'color.offsets', 4);
      const result = output(out, 4, 'color.out', true);
      const frame = frameInt32(livingTime);
      for (let i = 0; i < 4; i++)
        result[i] = clampByte(add(state.offsets[i], evaluateCurve(parameter.curves[i], frame)));
      return result;
    }
    default:
      fail('color.type', `unimplemented type ${parameter.type}`);
  }
}
export function multiplyColors(left, right, out) {
  channels(left, 'color.left');
  channels(right, 'color.right');
  const result = output(out, 4, 'color.out', true);
  for (let i = 0; i < 4; i++) result[i] = byte(div(mul(left[i], right[i]), 255), 'color.mul');
  return result;
}
export function multiplyColorScalar(color, scalar, out) {
  channels(color, 'color');
  scalar = finite(scalar, 'color.scalar');
  const result = output(out, 4, 'color.out', true);
  for (let i = 0; i < 4; i++) result[i] = byte(mul(color[i], scalar), 'color.mulScalar');
  return result;
}
export function fadeColorAlpha(color, fade, out) {
  channels(color, 'color');
  const alpha = byte(mul(color[3], finite(fade, 'color.fade')), 'color.fadeAlpha');
  const result = copyColor(color, out);
  result[3] = alpha;
  return result;
}

// Reader stores [L,LM,C,CM,R,RM]; source initializes [L,C,R,LM,CM,RM].
export const TRACK_COLOR_INITIALIZATION_ORDER = Object.freeze([0, 2, 4, 1, 3, 5]);
export function initializeTrackColors(renderer, rng) {
  sequence(renderer?.colors, 'track.colors', 6);
  const colors = new Array(6);
  for (const index of TRACK_COLOR_INITIALIZATION_ORDER)
    colors[index] = initializeColor(renderer.colors[index], rng);
  return { colors };
}

// Reader ring fields are initialized in this exact order by EffectNodeRing.
export function initializeRingValues(renderer, rng) {
  const viewingAngle = initializeValue(renderer.viewingAngle, rng);
  const outerLocation = initializeValue(renderer.outerLocation, rng);
  const innerLocation = initializeValue(renderer.innerLocation, rng);
  const centerRatio = initializeValue(renderer.centerRatio, rng);
  sequence(renderer.colors, 'ring.colors', 3);
  const colors = renderer.colors.map((color) => initializeColor(color, rng));
  return { viewingAngle, outerLocation, innerLocation, centerRatio, colors };
}
