// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Adapted from Effekseer 1.23, commit 5239bb1e416cbf55b4d3c8170594cbdc7815f263.
// See ../../licenses/effekseer-MIT.txt. CPU parameter/cache state only.
import {
  EffekseerNumericError,
  initializeColor,
  evaluateColor,
  evaluateValue,
  initializeRingValues,
  initializeTrackColors,
  evaluateEasing,
  multiplyColors,
  fadeColorAlpha,
  frameInt32,
  TRACK_COLOR_INITIALIZATION_ORDER,
} from './numerical.mjs';

const f = Math.fround;
const add = (a, b) => f(f(a) + f(b));
const sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b));
const div = (a, b) => f(f(a) / f(b));
const KINDS = ['sprite', 'ribbon', 'ring', 'model', 'track'];
export class EffekseerRenderStateError extends EffekseerNumericError {
  constructor(field, reason) {
    super(`renderer.${field}`, reason);
    this.name = 'EffekseerRenderStateError';
  }
}
function fail(field, reason) {
  throw new EffekseerRenderStateError(field, reason);
}
function kindOf(node) {
  const kind = node?.renderer?.type;
  if (!KINDS.includes(kind)) fail('type', `unimplemented renderer ${kind}`);
  return kind;
}
function float(value, field) {
  value = f(value);
  if (!Number.isFinite(value)) fail(field, `nonfinite float ${value}`);
  return value;
}
function integer(value, field) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
    fail(field, `unsupported int32 ${value}`);
  return value === 0 ? 0 : value;
}
function sequence(value, count, field) {
  if (!value || value.length !== count) fail(field, `requires ${count} components`);
  return value;
}
function color(value, field = 'color') {
  sequence(value, 4, field);
  return Array.from(value, (x) => {
    if (!Number.isInteger(x) || x < 0 || x > 255) fail(field, `invalid uint8 ${x}`);
    return x;
  });
}
function copyFloats(value, count, field) {
  sequence(value, count, field);
  return Array.from(value, (x) => float(x, field));
}
function sequenceBits(value) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 0xffffffff)
    fail('sequence', 'invalid sequence bits');
  return value >>> 0;
}
function context(value) {
  return {
    livingTime: float(value?.livingTime, 'livingTime'),
    livedTime: float(value?.livedTime, 'livedTime'),
    sequence: value.sequence == null ? null : sequenceBits(value.sequence),
  };
}
function sampledColor(parameter, rng) {
  const state = initializeColor(parameter, rng);
  if (parameter.type === 'fixed') state.value = color(parameter.value);
  return state;
}
function colorAt(parameter, sampled, time, life, out) {
  // Fixed group color is a stored copy, not a later read through effect params.
  if (sampled.type === 'fixed') {
    const value = color(sampled.value);
    if (out) {
      out.set(value);
      return out;
    }
    return value;
  }
  return evaluateColor(parameter, sampled, time, life, out);
}
function initialNumeric(parameter, sampled) {
  if (parameter.type === 'fixed')
    return typeof parameter.value === 'number'
      ? float(parameter.value, 'ring.fixed')
      : copyFloats(parameter.value, 2, 'ring.fixed');
  if (parameter.type === 'random') return sampled.value;
  if (parameter.type === 'easing')
    return Array.isArray(sampled.start) ? [...sampled.start] : sampled.start;
  if (parameter.type === 'pva') return [...sampled.position];
  fail('ring.numeric', `unimplemented type ${parameter.type}`);
}
function initialRingColor(parameter, sampled) {
  if (parameter.type === 'easing') return color(sampled.start); // Deliberately unconverted HSV start.
  if (parameter.type === 'fixed' || parameter.type === 'random') return color(sampled.value);
  fail('ring.color', `unimplemented type ${parameter.type}`);
}
function checkState(state, scope, kind) {
  if (!state || state.scope !== scope || state.kind !== kind)
    fail('state', `${scope}/${kind} state mismatch`);
}

export function initializeGroup(node, rng) {
  const kind = kindOf(node),
    state = { scope: 'group', kind, draw: null };
  if (kind === 'track') {
    const sampled = initializeTrackColors(node.renderer, rng);
    for (let i = 0; i < 6; i++)
      if (sampled.colors[i].type === 'fixed')
        sampled.colors[i].value = color(node.renderer.colors[i].value);
    state.colors = sampled.colors;
    state.sizes = copyFloats(node.renderer.sizes, 3, 'track.sizes'); // reader order: front,middle,back.
  }
  return state;
}

// Called at the source InitializeRenderedInstance boundary, after lifetime and
// transform/generation/sound-delay sampling. It does not initialize those parts.
export function initializeInstance(node, rng, initialContext) {
  const kind = kindOf(node),
    at = context(initialContext);
  const state = {
    scope: 'instance',
    kind,
    sampled: null,
    current: null,
    ready: true,
    cachedAt: null,
  };
  if (kind === 'track') return state; // Track's per-instance init/update are no-ops.
  if (kind === 'ring') {
    const r = node.renderer;
    for (const p of r.colors)
      if (!['fixed', 'random', 'easing'].includes(p.type))
        fail('ring.color', `unimplemented type ${p.type}`);
    state.sampled = initializeRingValues(r, rng);
    for (let i = 0; i < 3; i++)
      if (state.sampled.colors[i].type === 'fixed')
        state.sampled.colors[i].value = color(r.colors[i].value);
    state.current = {
      viewingAngle: initialNumeric(r.viewingAngle, state.sampled.viewingAngle),
      outerLocation: initialNumeric(r.outerLocation, state.sampled.outerLocation),
      innerLocation: initialNumeric(r.innerLocation, state.sampled.innerLocation),
      centerRatio: initialNumeric(r.centerRatio, state.sampled.centerRatio),
      colors: r.colors.map((p, i) => initialRingColor(p, state.sampled.colors[i])),
    };
  } else {
    const parameter = node.renderer.color;
    if (kind === 'ribbon' && !['fixed', 'random', 'easing'].includes(parameter.type))
      fail('ribbon.color', `unimplemented type ${parameter.type}`);
    state.sampled = sampledColor(parameter, rng);
    if (kind === 'ribbon' && parameter.type === 'easing') {
      // Original 7DE8C0 stores endpoints at+184/+188 but leaves current+180
      // untouched. Never synthesize a zero/stale pooled/current color here.
      state.ready = false;
      state.pendingReason = 'ribbon-easing-awaits-CalculateMatrix';
      return state;
    }
    state.current = color(colorAt(parameter, state.sampled, at.livingTime, at.livedTime));
  }
  state.cachedAt = at;
  return state;
}

// Source CalculateMatrix calls this before age increments. A draw-only lazy
// CalculateMatrix(0) may call it as well. The caller owns sequence gating/age;
// no random generator is accepted and no time is advanced by this helper.
export function updateCachedState(node, state, calculationContext) {
  const kind = kindOf(node);
  checkState(state, 'instance', kind);
  const at = context(calculationContext);
  if (kind === 'track') return state;
  if (kind === 'ring') {
    const r = node.renderer;
    for (const name of ['viewingAngle', 'outerLocation', 'innerLocation', 'centerRatio']) {
      if (['pva', 'easing'].includes(r[name].type)) {
        const value = evaluateValue(r[name], state.sampled[name], at.livingTime, at.livedTime);
        state.current[name] = typeof value === 'number' ? value : Array.from(value);
      } else if (!['fixed', 'random'].includes(r[name].type))
        fail(`ring.${name}`, `unimplemented type ${r[name].type}`);
    }
    for (let i = 0; i < 3; i++) {
      if (r.colors[i].type === 'easing')
        state.current.colors[i] = color(
          colorAt(r.colors[i], state.sampled.colors[i], at.livingTime, at.livedTime),
        );
      else if (!['fixed', 'random'].includes(r.colors[i].type))
        fail('ring.color', `unimplemented type ${r.colors[i].type}`);
    }
  } else {
    const p = node.renderer.color;
    if (p.type === 'easing' || (p.type === 'curve' && kind !== 'ribbon'))
      state.current = color(colorAt(p, state.sampled, at.livingTime, at.livedTime));
    else if (!['fixed', 'random'].includes(p.type)) fail('color', `unimplemented type ${p.type}`);
  }
  state.ready = true;
  delete state.pendingReason;
  state.cachedAt = at;
  return state;
}

// EffectNodeImplemented::GetFadeAlpha; no time/alpha clamp is added.
export function evaluateFade(texture, renderContext) {
  const at = context(renderContext);
  let alpha = 1;
  if (texture.fadeIn && at.livingTime < texture.fadeIn.frames)
    alpha = mul(
      alpha,
      evaluateEasing(0, 1, texture.fadeIn.coefficients, div(at.livingTime, texture.fadeIn.frames)),
    );
  if (texture.fadeOut && add(at.livingTime, texture.fadeOut.frames) > at.livedTime)
    alpha = mul(
      alpha,
      evaluateEasing(
        1,
        0,
        texture.fadeOut.coefficients,
        div(sub(add(at.livingTime, texture.fadeOut.frames), at.livedTime), texture.fadeOut.frames),
      ),
    );
  return float(alpha, 'fadeAlpha');
}

// Instance::GetUV at current age, independent of cached color/matrix age.
export function evaluateUV(uv, livingTime, out = new Float32Array(4)) {
  sequence(out, 4, 'uv.out');
  const time = float(livingTime, 'uv.time');
  if (!['default', 'fixed', 'scroll', 'animation'].includes(uv?.type))
    fail('uv.type', `unimplemented type ${uv?.type}`);
  if (uv?.type === 'default') {
    out.set([0, 0, 1, 1]);
    return out;
  }
  const rectangle = copyFloats(uv?.rectangle, 4, 'uv.rectangle');
  if (uv.type === 'fixed') {
    out.set(rectangle);
    return out;
  }
  if (uv.type === 'scroll') {
    sequence(uv.speed, 2, 'uv.speed');
    out[0] = float(add(rectangle[0], mul(uv.speed[0], time)), 'uv.scroll.x');
    out[1] = float(add(rectangle[1], mul(uv.speed[1], time)), 'uv.scroll.y');
    out[2] = rectangle[2];
    out[3] = rectangle[3];
    return out;
  }
  if (uv.type !== 'animation') fail('uv.type', `unimplemented type ${uv.type}`);
  const frameLength = integer(uv.frameLength, 'uv.frameLength'),
    x = integer(uv.countX, 'uv.countX'),
    y = integer(uv.countY, 'uv.countY');
  if (frameLength === 0 || x <= 0 || y <= 0)
    fail('uv.animation', 'zero frame length or nonpositive grid has no supported source division');
  const count = integer(x * y, 'uv.frameCount');
  let frame = frameInt32(div(time, frameLength));
  if (uv.loop === 0) {
    if (frame >= count) frame = count - 1;
  } else if (uv.loop === 1) frame %= count;
  else if (uv.loop === 2) {
    const reverse = Math.trunc(frame / count) % 2 === 1;
    frame %= count;
    if (reverse) frame = count - 1 - frame;
  } else fail('uv.loop', `unimplemented operation ${uv.loop}`);
  out[0] = float(add(rectangle[0], mul(rectangle[2], frame % x)), 'uv.animation.x');
  out[1] = float(add(rectangle[1], mul(rectangle[3], Math.trunc(frame / x))), 'uv.animation.y');
  out[2] = rectangle[2];
  out[3] = rectangle[3];
  return out;
}

// Source Ribbon/Track BeginRenderingGroup caches the FIRST list instance's UV,
// before that instance's lazy Draw calculation. It must not use each later age.
export function beginRenderingGroup(node, group, { instanceCount, firstContext = null }) {
  const kind = kindOf(node);
  checkState(group, 'group', kind);
  if (kind !== 'ribbon' && kind !== 'track') return group;
  instanceCount = integer(instanceCount, 'group.instanceCount');
  if (instanceCount < 0 || (instanceCount > 0 && firstContext === null))
    fail('group', 'nonempty group requires original GetFirst context');
  group.draw = {
    instanceCount,
    instanceIndex: 0,
    uv:
      firstContext === null
        ? null
        : Array.from(evaluateUV(node.texture.uv, firstContext.livingTime)),
  };
  if (kind === 'track') {
    group.draw.colors = cloneData(group.colors);
    group.draw.sizes = [...group.sizes];
  }
  return group;
}
export function advanceRenderingGroup(group) {
  if (!group?.draw || !['ribbon', 'track'].includes(group.kind))
    fail('group.draw', 'BeginRenderingGroup is required');
  if (group.draw.instanceIndex >= group.draw.instanceCount)
    fail('group.draw', 'instance index exceeds source group count');
  group.draw.instanceIndex += 1;
  return group;
}

export function createRenderOutput(kind) {
  if (!KINDS.includes(kind)) fail('type', `unimplemented renderer ${kind}`);
  const count = { sprite: 4, ribbon: 2, ring: 3, model: 0, track: 6 }[kind];
  const out = {
    kind,
    allColor: new Uint8Array(4),
    colors: Array.from({ length: count }, () => new Uint8Array(4)),
    uv: new Float32Array(4),
    fadeAlpha: 1,
  };
  if (kind === 'sprite' || kind === 'ribbon')
    out.positions = new Float32Array(kind === 'sprite' ? 8 : 2);
  if (kind === 'ring') {
    out.outerLocation = new Float32Array(2);
    out.innerLocation = new Float32Array(2);
    out.viewingAngle = 0;
    out.centerRatio = 0;
  }
  if (kind === 'track') out.sizes = new Float32Array(3);
  return out;
}

// Pure color/UV/fade evaluation from cached current state and CURRENT render
// time. It neither fixes a pending cache nor increments a group render index.
// Old 76/1.23 has no parent color-inheritance parameter or multiplication here.
export function renderColorEvaluation(
  node,
  state,
  renderContext,
  { group = null, out = createRenderOutput(kindOf(node)) } = {},
) {
  const kind = kindOf(node);
  checkState(state, 'instance', kind);
  const at = context(renderContext);
  if (out.kind !== kind) fail('out', 'renderer type mismatch');
  if (!state.ready)
    fail(
      'pending-current',
      `${state.pendingReason}; caller must perform the zero-delta cache calculation before reading current`,
    );
  if (kind === 'ribbon' || kind === 'track') {
    checkState(group, 'group', kind);
    if (!group.draw?.uv || group.draw.instanceIndex >= group.draw.instanceCount)
      fail('group.draw', 'nonempty BeginRenderingGroup state is required');
    out.uv.set(group.draw.uv);
    out.instanceIndex = group.draw.instanceIndex;
    out.instanceCount = group.draw.instanceCount;
  } else evaluateUV(node.texture.uv, at.livingTime, out.uv);
  if (kind === 'track') {
    const time = frameInt32(at.livingTime),
      life = frameInt32(at.livedTime);
    for (const i of TRACK_COLOR_INITIALIZATION_ORDER)
      colorAt(node.renderer.colors[i], group.draw.colors[i], time, life, out.colors[i]);
    out.sizes.set(group.draw.sizes);
    out.fadeAlpha = 1;
    return out; // Track does NOT call ordinary GetFadeAlpha.
  }
  out.fadeAlpha = evaluateFade(node.texture, at);
  if (kind === 'ring') {
    out.viewingAngle = state.current.viewingAngle;
    out.centerRatio = state.current.centerRatio;
    out.outerLocation.set(state.current.outerLocation);
    out.innerLocation.set(state.current.innerLocation);
    for (let i = 0; i < 3; i++)
      fadeColorAlpha(state.current.colors[i], out.fadeAlpha, out.colors[i]);
    return out;
  }
  out.allColor.set(state.current);
  if (kind === 'model') {
    fadeColorAlpha(state.current, out.fadeAlpha, out.allColor);
    return out;
  }
  out.positions.set(node.renderer.positions);
  for (let i = 0; i < out.colors.length; i++) {
    if (node.renderer.vertexColors)
      multiplyColors(state.current, node.renderer.vertexColors[i], out.colors[i]);
    else out.colors[i].set(state.current);
    fadeColorAlpha(out.colors[i], out.fadeAlpha, out.colors[i]);
  }
  return out;
}

// Snapshot helpers retain finite current data. Persistence uses the existing
// project checkpoint serializer, preserving signed zero without a second codec.
function cloneData(value) {
  if (value === null || ['boolean', 'string'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(cloneData);
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)]));
  fail('state', 'state must contain only plain finite data');
}
function validateColorSample(value) {
  if (value?.type === 'fixed' || value?.type === 'random') color(value.value, 'snapshot.color');
  else if (value?.type === 'easing') {
    color(value.start, 'snapshot.start');
    color(value.end, 'snapshot.end');
  } else if (value?.type === 'curve') copyFloats(value.offsets, 4, 'snapshot.offsets');
  else fail('snapshot', `unimplemented color sample ${value?.type}`);
}
function validateSavedState(state) {
  if (!['group', 'instance'].includes(state?.scope) || !KINDS.includes(state.kind))
    fail('snapshot', 'unimplemented renderer state');
  if (state.scope === 'group') {
    if (state.kind === 'track') {
      sequence(state.colors, 6, 'snapshot.track.colors');
      state.colors.forEach(validateColorSample);
      copyFloats(state.sizes, 3, 'snapshot.track.sizes');
    }
    if (state.draw !== null) {
      if (!['ribbon', 'track'].includes(state.kind))
        fail('snapshot', 'unexpected ordinary group draw cache');
      const count = integer(state.draw?.instanceCount, 'snapshot.instanceCount'),
        index = integer(state.draw?.instanceIndex, 'snapshot.instanceIndex');
      if (count < 0 || index < 0 || index > count) fail('snapshot', 'invalid group draw position');
      if (state.draw.uv !== null) copyFloats(state.draw.uv, 4, 'snapshot.uv');
      else if (count > 0) fail('snapshot', 'nonempty group missing first UV');
      if (state.kind === 'track') {
        sequence(state.draw.colors, 6, 'snapshot.draw.colors');
        state.draw.colors.forEach(validateColorSample);
        copyFloats(state.draw.sizes, 3, 'snapshot.draw.sizes');
      }
    }
    return state;
  }
  if (typeof state.ready !== 'boolean') fail('snapshot', 'missing current readiness');
  if (
    !state.ready &&
    !(
      state.kind === 'ribbon' &&
      state.current === null &&
      state.pendingReason === 'ribbon-easing-awaits-CalculateMatrix'
    )
  )
    fail('snapshot', 'unimplemented pending cache');
  if (state.kind === 'track') {
    if (!state.ready || state.current !== null || state.sampled !== null)
      fail('snapshot', 'Track instance must use group samples');
    return state;
  }
  if (state.kind === 'ring') {
    sequence(state.sampled?.colors, 3, 'snapshot.ring.samples');
    state.sampled.colors.forEach(validateColorSample);
    for (const name of ['viewingAngle', 'outerLocation', 'innerLocation', 'centerRatio']) {
      const sample = state.sampled[name],
        count = name.includes('Location') ? 2 : null;
      const value = (x) =>
        count === null
          ? float(x, 'snapshot.ring.scalar')
          : copyFloats(x, count, 'snapshot.ring.vector');
      if (sample?.type === 'random') value(sample.value);
      else if (sample?.type === 'easing') {
        value(sample.start);
        value(sample.end);
      } else if (sample?.type === 'pva') {
        value(sample.position);
        value(sample.velocity);
        value(sample.acceleration);
      } else if (sample?.type !== 'fixed')
        fail('snapshot', `unimplemented ring sample ${sample?.type}`);
    }
    float(state.current?.viewingAngle, 'snapshot.viewingAngle');
    float(state.current?.centerRatio, 'snapshot.centerRatio');
    copyFloats(state.current?.outerLocation, 2, 'snapshot.outerLocation');
    copyFloats(state.current?.innerLocation, 2, 'snapshot.innerLocation');
    sequence(state.current?.colors, 3, 'snapshot.ring.current');
    state.current.colors.forEach((c) => color(c));
  } else {
    validateColorSample(state.sampled);
    if (state.ready) color(state.current, 'snapshot.current');
  }
  if (state.cachedAt !== null) {
    context(state.cachedAt);
    const sequenceNumber = state.cachedAt.sequence;
    if (
      sequenceNumber !== null &&
      (!Number.isInteger(sequenceNumber) || sequenceNumber < 0 || sequenceNumber > 0xffffffff)
    )
      fail('snapshot', 'invalid sequence number');
  }
  return state;
}
export function snapshotRendererState(state) {
  validateSavedState(state);
  return cloneData(state);
}
export function restoreRendererState(saved) {
  const state = cloneData(saved);
  return validateSavedState(state);
}
