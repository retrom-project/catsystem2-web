// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Legacy SKFE algorithms adapted from Effekseer 1.23, commit
// 5239bb1e416cbf55b4d3c8170594cbdc7815f263. See ../../licenses/effekseer-MIT.txt.
const NONE = 0x7ffffffe;
const f = Math.fround;
const NODE_NAMES = new Map([
  [-1, 'root'],
  [0, 'none'],
  [2, 'sprite'],
  [3, 'ribbon'],
  [4, 'ring'],
  [5, 'model'],
  [6, 'track'],
]);
const DEFAULT_LIMITS = Object.freeze({
  bytes: 64 * 1024 * 1024,
  resources: 4096,
  pathUnits: 32768,
  nodes: 65536,
  depth: 128,
  keys: 1048576,
});

export class EffekseerFormatError extends Error {
  constructor(identity, offset, field, reason) {
    super(`${identity}: SKFE +0x${offset.toString(16)} ${field}: ${reason}`);
    this.name = 'EffekseerFormatError';
    Object.assign(this, { identity, offset, field, reason });
  }
}

class Reader {
  constructor(bytes, identity, limits, start = 0, end = bytes.byteLength) {
    Object.assign(this, { bytes, identity, limits, at: start, end });
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  fail(field, reason, offset = this.at) {
    throw new EffekseerFormatError(this.identity, offset, field, reason);
  }
  take(size, field) {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.end - this.at)
      this.fail(field, `requires ${size} bytes; ${this.end - this.at} remain`);
    const at = this.at;
    this.at += size;
    return at;
  }
  i32(field) {
    return this.view.getInt32(this.take(4, field), true);
  }
  u8(field) {
    return this.bytes[this.take(1, field)];
  }
  float(field) {
    const at = this.take(4, field),
      value = this.view.getFloat32(at, true);
    if (!Number.isFinite(value)) this.fail(field, `nonfinite float ${value}`, at);
    return value;
  }
  floats(count, field) {
    return Float32Array.from({ length: count }, (_, i) => this.float(`${field}[${i}]`));
  }
  count(field, maximum, minimumBytes = 0) {
    const at = this.at,
      value = this.i32(field);
    if (
      value < 0 ||
      value > maximum ||
      (minimumBytes && value > Math.floor((this.end - this.at) / minimumBytes))
    )
      this.fail(field, `invalid count ${value}`, at);
    return value;
  }
  choice(field, values) {
    const at = this.at,
      value = this.i32(field);
    if (!values.includes(value)) this.fail(field, `unimplemented value ${value}`, at);
    return value;
  }
  boolean(field) {
    return this.i32(field) !== 0;
  }
  block(field, size, parse) {
    const at = this.at,
      count = this.count(`${field}.bytes`, this.end - this.at);
    if (size !== null && count !== size)
      this.fail(field, `unimplemented layout length ${count}; expected ${size}`, at);
    const start = this.take(count, field),
      child = new Reader(this.bytes, this.identity, this.limits, start, start + count),
      value = parse(child);
    if (child.at !== child.end) child.fail(field, `${child.end - child.at} unparsed bytes`);
    return value;
  }
}
function random(r, components, field, integer = false) {
  if (components === 1)
    return {
      max: integer ? r.i32(`${field}.max`) : r.float(`${field}.max`),
      min: integer ? r.i32(`${field}.min`) : r.float(`${field}.min`),
    };
  return { max: r.floats(components, `${field}.max`), min: r.floats(components, `${field}.min`) };
}
function easing(r, components, field) {
  return {
    start: random(r, components, `${field}.start`),
    end: random(r, components, `${field}.end`),
    coefficients: r.floats(3, `${field}.coefficients`),
  };
}
function curve(r, field, defaultValue) {
  const edgeStart = r.choice(`${field}.edgeStart`, [0, 1, 2]),
    edgeEnd = r.choice(`${field}.edgeEnd`, [0, 1, 2]),
    offsets = random(r, 1, `${field}.offset`),
    offset = r.i32(`${field}.offsetFrame`),
    length = r.i32(`${field}.length`),
    frequency = r.i32(`${field}.frequency`),
    count = r.count(`${field}.keys.count`, r.limits.keys, 4);
  if (length < 0 || (count > 1 && frequency <= 0))
    r.fail(field, `invalid length/frequency ${length}/${frequency}`);
  return {
    edgeStart,
    edgeEnd,
    offsets,
    offset,
    length,
    frequency,
    keys: r.floats(count, `${field}.keys`),
    defaultValue,
  };
}
function curves(r, components, field, defaultValue = 0) {
  return Array.from({ length: components }, (_, i) => curve(r, `${field}[${i}]`, defaultValue));
}
function motion(r, domain, field) {
  const types = domain === 'translation' ? [0, 1, 2, 3, NONE] : [0, 1, 2, 3, 4, 5, NONE],
    type = r.choice(`${field}.type`, types);
  if (type === NONE) return { type: 'none' };
  if (type === 0) {
    const value = r.block(field, 12, (b) => b.floats(3, field));
    // The old reader converts identity fixed transforms to the None variant.
    if (value.every((n) => n === (domain === 'scaling' ? 1 : 0))) return { type: 'none' };
    return { type: 'fixed', value };
  }
  if (type === 1)
    return {
      type: 'pva',
      ...r.block(field, 72, (b) => ({
        position: random(b, 3, `${field}.position`),
        velocity: random(b, 3, `${field}.velocity`),
        acceleration: random(b, 3, `${field}.acceleration`),
      })),
    };
  if (type === 2) return { type: 'easing', ...r.block(field, 60, (b) => easing(b, 3, field)) };
  if ((domain === 'translation' && type === 3) || type === 5)
    return {
      type: 'curve',
      curves: r.block(field, null, (b) => curves(b, 3, field, domain === 'scaling' ? 1 : 0)),
    };
  if (domain === 'rotation') {
    if (type === 3)
      return {
        type: 'axis-pva',
        ...r.block(field, 48, (b) => ({
          axis: random(b, 3, `${field}.axis`),
          position: random(b, 1, `${field}.position`),
          velocity: random(b, 1, `${field}.velocity`),
          acceleration: random(b, 1, `${field}.acceleration`),
        })),
      };
    return {
      type: 'axis-easing',
      ...r.block(field, 52, (b) => ({
        axis: random(b, 3, `${field}.axis`),
        easing: easing(b, 1, field),
      })),
    };
  }
  if (type === 3)
    return {
      type: 'single-pva',
      ...r.block(field, 24, (b) => ({
        position: random(b, 1, `${field}.position`),
        velocity: random(b, 1, `${field}.velocity`),
        acceleration: random(b, 1, `${field}.acceleration`),
      })),
    };
  return { type: 'single-easing', ...r.block(field, 28, (b) => easing(b, 1, field)) };
}
function color(r, field) {
  return Uint8Array.from({ length: 4 }, (_, i) => r.u8(`${field}[${i}]`));
}
function randomColor(r, version, field) {
  let mode = 0;
  if (version >= 4) {
    const at = r.at;
    mode = r.u8(`${field}.mode`);
    r.u8(`${field}.reserved`);
    if (mode !== 0 && mode !== 1) r.fail(field, `unimplemented color mode ${mode}`, at);
  }
  return { mode, max: color(r, `${field}.max`), min: color(r, `${field}.min`) };
}
function standardColor(r, version, field, allowCurve = true) {
  const type = r.choice(`${field}.type`, allowCurve ? [0, 1, 2, 3] : [0, 1, 2]);
  if (type === 0) return { type: 'fixed', value: color(r, field) };
  if (type === 1) return { type: 'random', ...randomColor(r, version, field) };
  if (type === 2)
    return {
      type: 'easing',
      start: randomColor(r, version, `${field}.start`),
      end: randomColor(r, version, `${field}.end`),
      coefficients: r.floats(3, `${field}.coefficients`),
    };
  return { type: 'curve', curves: curves(r, 4, field, 255) };
}
function generation(r, field) {
  const effectsRotation = r.boolean(`${field}.effectsRotation`),
    type = r.choice(`${field}.type`, [0, 1, 2, 3]);
  if (type === 0)
    return { type: 'point', effectsRotation, location: random(r, 3, `${field}.location`) };
  if (type === 1)
    return {
      type: 'sphere',
      effectsRotation,
      radius: random(r, 1, `${field}.radius`),
      rotationX: random(r, 1, `${field}.rotationX`),
      rotationY: random(r, 1, `${field}.rotationY`),
    };
  if (type === 2)
    return {
      type: 'model',
      effectsRotation,
      index: r.i32(`${field}.modelIndex`),
      mode: r.choice(`${field}.modelMode`, [0, 1, 2, 3, 4]),
    };
  return {
    type: 'circle',
    effectsRotation,
    division: r.i32(`${field}.division`),
    radius: random(r, 1, `${field}.radius`),
    angleStart: random(r, 1, `${field}.angleStart`),
    angleEnd: random(r, 1, `${field}.angleEnd`),
    mode: r.choice(`${field}.circleMode`, [0, 1, 2]),
  };
}
function texture(r, version, field) {
  if (version < 3)
    return {
      colorIndex: 0,
      alphaBlend: 0,
      filter: 0,
      wrap: 0,
      zWrite: false,
      zTest: false,
      fadeIn: null,
      fadeOut: null,
      uv: { type: 'default' },
      distortion: false,
      distortionIntensity: 0,
    };
  const result = {
    colorIndex: r.i32(`${field}.colorIndex`),
    alphaBlend: r.choice(`${field}.alphaBlend`, [0, 1, 2, 3, 4]),
    filter: r.choice(`${field}.filter`, [0, 1]),
    wrap: r.choice(`${field}.wrap`, [0, 1]),
    zWrite: false,
    zTest: true,
  };
  if (version >= 5) {
    result.zTest = r.boolean(`${field}.zTest`);
    result.zWrite = r.boolean(`${field}.zWrite`);
  }
  for (const name of ['fadeIn', 'fadeOut']) {
    const type = r.choice(`${field}.${name}.type`, [0, 1]);
    result[name] = type
      ? {
          frames: r.float(`${field}.${name}.frames`),
          coefficients: r.floats(3, `${field}.${name}.coefficients`),
        }
      : null;
  }
  const uv = r.choice(`${field}.uv.type`, [0, 1, 2, 3]);
  result.uv = { type: ['default', 'fixed', 'animation', 'scroll'][uv] };
  if (uv) result.uv.rectangle = r.floats(4, `${field}.uv.rectangle`);
  if (uv === 2)
    Object.assign(result.uv, {
      frameLength: r.i32(`${field}.uv.frameLength`),
      countX: r.i32(`${field}.uv.countX`),
      countY: r.i32(`${field}.uv.countY`),
      loop: r.choice(`${field}.uv.loop`, [0, 1, 2]),
    });
  if (uv === 3) result.uv.speed = r.floats(2, `${field}.uv.speed`);
  result.distortion = version >= 9 && r.i32(`${field}.distortion`) > 0;
  result.distortionIntensity = version >= 9 ? r.float(`${field}.distortionIntensity`) : 0;
  return result;
}
function ringSingle(r, field) {
  const type = r.choice(`${field}.type`, [0, 1, 2]);
  if (type === 0) return { type: 'fixed', value: r.float(field) };
  if (type === 1) return { type: 'random', ...random(r, 1, field) };
  return { type: 'easing', ...easing(r, 1, field) };
}
function ringLocation(r, field) {
  const type = r.choice(`${field}.type`, [0, 1, 2]);
  if (type === 0) return { type: 'fixed', value: r.floats(2, field) };
  if (type === 1)
    return {
      type: 'pva',
      position: random(r, 2, `${field}.position`),
      velocity: random(r, 2, `${field}.velocity`),
      acceleration: random(r, 2, `${field}.acceleration`),
    };
  return { type: 'easing', ...easing(r, 2, field) };
}
function renderer(r, version, kind, common, field) {
  const type = r.i32(`${field}.type`);
  if (type !== kind) r.fail(field, `renderer ${type} differs from node ${kind}`, r.at - 4);
  const result = { type: NODE_NAMES.get(kind) };
  if (kind === 0) return result;
  if (kind === 2 || kind === 4) result.order = r.choice(`${field}.order`, [0, 1]);
  if (kind === 2 || kind === 3 || kind === 4)
    result.alphaBlend =
      version < 3 ? r.choice(`${field}.alphaBlend`, [0, 1, 2, 3, 4]) : common.alphaBlend;
  if (kind === 2 || kind === 4) result.billboard = r.choice(`${field}.billboard`, [0, 1, 2, 3]);
  if (kind === 2 || kind === 3) {
    if (kind === 3) result.viewpointDependent = r.boolean(`${field}.viewpointDependent`);
    result.color = standardColor(r, version, `${field}.color`, kind === 2);
    const vertexColor = r.choice(`${field}.vertexColor.type`, [0, 1]);
    result.vertexColors = vertexColor
      ? Array.from({ length: kind === 2 ? 4 : 2 }, (_, i) => color(r, `${field}.vertexColor[${i}]`))
      : null;
    const position = r.choice(`${field}.position.type`, [0, 1]);
    result.positions =
      position || version >= 8
        ? r.floats(kind === 2 ? 8 : 2, `${field}.positions`)
        : Float32Array.from(
            kind === 2 ? [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5] : [-0.5, 0.5],
          );
  } else if (kind === 4) {
    result.vertexCount = r.i32(`${field}.vertexCount`);
    result.viewingAngle = ringSingle(r, `${field}.viewingAngle`);
    result.outerLocation = ringLocation(r, `${field}.outerLocation`);
    result.innerLocation = ringLocation(r, `${field}.innerLocation`);
    result.centerRatio = ringSingle(r, `${field}.centerRatio`);
    result.colors = ['outer', 'center', 'inner'].map((name) =>
      standardColor(r, version, `${field}.${name}Color`, false),
    );
  } else if (kind === 5) {
    if (version >= 7) result.authoredMagnification = r.float(`${field}.authoredMagnification`);
    result.modelIndex = r.i32(`${field}.modelIndex`);
    result.normalIndex = r.i32(`${field}.normalIndex`);
    result.lighting = r.i32(`${field}.lighting`) > 0;
    result.culling = r.choice(`${field}.culling`, [0, 1, 2]);
    result.color = standardColor(r, version, `${field}.color`);
  } else if (kind === 6) {
    result.sizes = ['front', 'middle', 'back'].map((name) => {
      r.choice(`${field}.${name}Size.type`, [0]);
      return r.float(`${field}.${name}Size`);
    });
    result.colors = ['left', 'leftMiddle', 'center', 'centerMiddle', 'right', 'rightMiddle'].map(
      (name) => standardColor(r, version, `${field}.${name}Color`),
    );
  }
  result.textureIndex =
    version < 3 && (kind === 2 || kind === 3 || kind === 4)
      ? r.i32(`${field}.textureIndex`)
      : common.colorIndex;
  return result;
}
function commonValues(r, version, field) {
  return r.block(field, version >= 9 ? 52 : 44, (b) => {
    const result = {
      maxGeneration: b.i32(`${field}.maxGeneration`),
      translationBind: b.choice(`${field}.translationBind`, [0, 1, 2, 3]),
      rotationBind: b.choice(`${field}.rotationBind`, [0, 1, 2, 3]),
      scalingBind: b.choice(`${field}.scalingBind`, [0, 1, 2, 3]),
      removeOnLife: b.boolean(`${field}.removeOnLife`),
      removeOnParent: b.boolean(`${field}.removeOnParent`),
      removeOnChildren: b.boolean(`${field}.removeOnChildren`),
      life: random(b, 1, `${field}.life`, true),
    };
    if (version >= 9) {
      result.generationTime = random(b, 1, `${field}.generationTime`);
      result.generationOffset = random(b, 1, `${field}.generationOffset`);
    } else {
      const interval = b.float(`${field}.generationTime`),
        offset = b.float(`${field}.generationOffset`);
      result.generationTime = { max: interval, min: interval };
      result.generationOffset = { max: offset, min: offset };
    }
    return result;
  });
}
function sound(r, version, field) {
  if (version < 1 || r.choice(`${field}.type`, [0, 1]) === 0) return null;
  return {
    waveIndex: r.i32(`${field}.waveIndex`),
    volume: random(r, 1, `${field}.volume`),
    pitch: random(r, 1, `${field}.pitch`),
    panType: r.choice(`${field}.panType`, [0, 1]),
    pan: random(r, 1, `${field}.pan`),
    distance: r.float(`${field}.distance`),
    delay: random(r, 1, `${field}.delay`, true),
  };
}
function scaleVector(vector, scale) {
  for (let i = 0; i < vector.length; i++) vector[i] = f(vector[i] * scale);
}
function scaleRandom(value, scale) {
  if (typeof value.max === 'number') {
    value.max = f(value.max * scale);
    value.min = f(value.min * scale);
  } else {
    scaleVector(value.max, scale);
    scaleVector(value.min, scale);
  }
}
function scaleMotion(value, scale) {
  if (value.type === 'fixed') scaleVector(value.value, scale);
  else if (value.type === 'pva')
    for (const key of ['position', 'velocity', 'acceleration']) scaleRandom(value[key], scale);
  else if (value.type === 'easing') {
    scaleRandom(value.start, scale);
    scaleRandom(value.end, scale);
  } else if (value.type === 'curve')
    for (const curve of value.curves) {
      scaleRandom(curve.offsets, scale);
      scaleVector(curve.keys, scale);
    }
}
function magnify(node, version, magnification) {
  node.texture.distortionIntensity = f(node.texture.distortionIntensity * magnification);
  if (version < 8) return;
  scaleMotion(node.translation, magnification);
  if (node.absolute.type === 'gravity') scaleVector(node.absolute.value, magnification);
  if (node.generation.type === 'point') scaleRandom(node.generation.location, magnification);
  if (node.generation.type === 'sphere' || node.generation.type === 'circle')
    scaleRandom(node.generation.radius, magnification);
  const render = node.renderer;
  if (render.type === 'sprite' || render.type === 'ribbon')
    scaleVector(render.positions, magnification);
  if (render.type === 'ring') {
    scaleMotion(render.innerLocation, magnification);
    scaleMotion(render.outerLocation, magnification);
  }
  if (render.type === 'track')
    for (let i = 0; i < render.sizes.length; i++)
      render.sizes[i] = f(render.sizes[i] * magnification);
}
function node(r, version, magnification, nodes, depth = 0, parent = null) {
  if (depth > r.limits.depth || nodes.length >= r.limits.nodes)
    r.fail('node', 'node/depth budget exceeded');
  const offset = r.at,
    kind = r.i32('node.type'),
    name = NODE_NAMES.get(kind);
  if (!name || (parent === null ? kind !== -1 : kind === -1))
    r.fail('node.type', `unimplemented node kind ${kind}`, offset);
  const result = { id: nodes.length, parent, kind, type: name, sourceOffset: offset, children: [] };
  nodes.push(result);
  if (kind !== -1) {
    const field = `node[${result.id}]`;
    result.common = commonValues(r, version, `${field}.common`);
    result.translation = motion(r, 'translation', `${field}.translation`);
    const abs = r.choice(`${field}.absolute.type`, [0, 1, 2]);
    result.absolute =
      abs === 0
        ? r.block(`${field}.absolute`, 0, () => ({ type: 'none' }))
        : abs === 1
          ? {
              type: 'gravity',
              value: r.block(`${field}.absolute`, 12, (b) => b.floats(3, `${field}.gravity`)),
            }
          : {
              type: 'attractive',
              values: r.block(`${field}.absolute`, 16, (b) => b.floats(4, `${field}.attraction`)),
            };
    result.rotation = motion(r, 'rotation', `${field}.rotation`);
    result.scaling = motion(r, 'scaling', `${field}.scaling`);
    result.generation = generation(r, `${field}.generation`);
    result.texture = texture(r, version, `${field}.texture`);
    result.renderer = renderer(r, version, kind, result.texture, `${field}.renderer`);
    result.sound = sound(r, version, `${field}.sound`);
    magnify(result, version, magnification);
  }
  const count = r.count(`node[${result.id}].children.count`, r.limits.nodes - nodes.length, 8);
  for (let i = 0; i < count; i++)
    result.children.push(node(r, version, magnification, nodes, depth + 1, result.id));
  result.sourceEnd = r.at;
  return result.id;
}
function paths(r, field) {
  const count = r.count(`${field}.count`, r.limits.resources, 6),
    result = [];
  for (let i = 0; i < count; i++) {
    const length = r.count(`${field}[${i}].units`, r.limits.pathUnits, 2);
    if (!length) r.fail(field, 'UTF16 path lacks terminator');
    const at = r.take(length * 2, `${field}[${i}]`),
      units = new Uint16Array(length);
    for (let j = 0; j < length; j++) units[j] = r.view.getUint16(at + j * 2, true);
    if (units[length - 1] !== 0) r.fail(field, 'UTF16 path lacks terminator', at);
    const end = units.indexOf(0),
      chunks = [];
    for (let start = 0; start < end; start += 4096)
      chunks.push(String.fromCharCode(...units.subarray(start, Math.min(end, start + 4096))));
    result.push(chunks.join(''));
  }
  return result;
}
export function readEffekseerEffect(
  input,
  { identity = '<effect>', onWarning, limits: suppliedLimits = {}, externalMagnification = 1 } = {},
) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input),
    limits = { ...DEFAULT_LIMITS, ...suppliedLimits };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`Invalid Effekseer reader ${key} budget`);
  if (bytes.byteLength > limits.bytes)
    throw new EffekseerFormatError(identity, 0, 'file', `byte budget ${limits.bytes} exceeded`);
  const r = new Reader(bytes, identity, limits);
  if (r.take(4, 'magic') !== 0 || ![83, 75, 70, 69].every((v, i) => bytes[i] === v))
    r.fail('magic', 'expected SKFE', 0);
  const version = r.i32('version'),
    warnings = [];
  if (version < 0 || version > 9) {
    const warning = {
      component: 'Effekseer/SKFE',
      version,
      identity,
      message: `Unverified Effekseer/SKFE version ${version}; attempting implemented legacy structure`,
    };
    warnings.push(warning);
    onWarning?.(warning);
  }
  const dependencies = {
    color: paths(r, 'color'),
    normal: version >= 9 ? paths(r, 'normal') : [],
    distortion: version >= 9 ? paths(r, 'distortion') : [],
    sound: version >= 1 ? paths(r, 'sound') : [],
    model: version >= 6 ? paths(r, 'model') : [],
  };
  if (!Number.isFinite(externalMagnification))
    throw new RangeError('Effekseer external magnification must be finite');
  const authoredMagnification = version >= 2 ? r.float('magnification') : 1,
    magnification = version >= 2 ? f(authoredMagnification * f(externalMagnification)) : 1;
  const culling = { type: version >= 9 ? r.choice('culling.type', [0, 1]) : 0 };
  if (culling.type === 1) {
    culling.radius = r.float('culling.radius');
    culling.position = r.floats(3, 'culling.position');
  }
  const nodes = [],
    root = node(r, version, magnification, nodes);
  if (r.at !== bytes.length)
    r.fail('file', `${bytes.length - r.at} trailing bytes have an unreadable structure`);
  return {
    format: 'SKFE',
    version,
    identity,
    byteLength: bytes.byteLength,
    authoredMagnification,
    magnification,
    dependencies,
    culling,
    nodes,
    root,
    warnings,
  };
}
