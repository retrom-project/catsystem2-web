// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Fixed1.23 StandardRenderer byte-cache/state/lock flow. See
// ../../licenses/effekseer-MIT.txt. The unsafe fixed-IB boundary is an explicit
// host safety policy, not an emulation of out-of-storage driver behaviour.
export const EFFEKSEER_VERTEX_BUFFER_BYTES = 320000;
export const EFFEKSEER_INDEX_BUFFER_INDICES = 12000;
const MAX_BYTES = EFFEKSEER_VERTEX_BUFFER_BYTES;
const KEYS = [
  'depthTest',
  'depthWrite',
  'distortion',
  'distortionIntensity',
  'alphaBlend',
  'culling',
  'filter',
  'wrap',
  'texture',
];
const defaults = () => ({
  depthTest: false,
  depthWrite: false,
  distortion: false,
  distortionIntensity: 1,
  alphaBlend: 1,
  culling: 0,
  filter: 0,
  wrap: 0,
  texture: null,
});
const boolean = (v, k) => {
  if (typeof v !== 'boolean') throw new TypeError('Effekseer batch ' + k + ' requires a boolean');
  return v;
};
const integer = (v, max, k) => {
  if (!Number.isSafeInteger(v) || v < 0 || v > max)
    throw new RangeError('Effekseer batch ' + k + ' outside implemented range');
  return v;
};
const matrix = (input, out, k) => {
  if (!input || input.length !== 16)
    throw new TypeError('Effekseer batch ' + k + ' requires16 components');
  for (let i = 0; i < 16; i++) {
    if (typeof input[i] !== 'number' || !Number.isFinite(Math.fround(input[i])))
      throw new Error('Effekseer batch ' + k + ' has nonfinite component');
    out[i] = input[i];
  }
};
export class EffekseerUnsafeIndexDomainError extends Error {
  constructor(vertexCount) {
    super(
      'Effekseer normal batch requires ' +
        (vertexCount / 4) * 6 +
        ' indices, beyond its fixed12000-index buffer; unsupported/unsafe input domain',
    );
    this.name = 'EffekseerUnsafeIndexDomainError';
    this.code = 'EFFEKSEER_UNSAFE_INDEX_DOMAIN';
    this.vertexCount = vertexCount;
    this.indexCount = (vertexCount / 4) * 6;
  }
}
export class EffekseerStandardBatch {
  constructor({
    prepare,
    draw,
    finish,
    camera,
    projection,
    trace = null,
    maxReservationBytes = 48 * 1048576,
  } = {}) {
    for (const [name, operation] of Object.entries({ prepare, draw, finish, camera, projection }))
      if (typeof operation !== 'function')
        throw new TypeError('Effekseer batch ' + name + ' operation is required');
    if (trace !== null && typeof trace !== 'function')
      throw new TypeError('Effekseer batch trace must be a function');
    integer(maxReservationBytes, 0x7fffffff, 'CPU byte budget');
    if (maxReservationBytes < MAX_BYTES)
      throw new RangeError('Effekseer CPU byte budget is below fixedVB size');
    Object.assign(this, {
      prepare,
      draw,
      finish,
      getCamera: camera,
      getProjection: projection,
      trace,
      maxReservationBytes,
    });
    this.bytes = new Uint8Array(MAX_BYTES);
    this.byteLength = 0;
    this.cursor = 0;
    this.state = defaults();
    this.nextState = defaults();
    this.stateInvalid = true;
    this.camera = new Float32Array(16);
    this.projection = new Float32Array(16);
    this.reservation = { buffer: this.bytes, offset: 0, byteLength: 0, stride: 24 };
    this.packet = {
      bytes: this.bytes,
      byteLength: 0,
      vertexCount: 0,
      indexCount: 0,
      vertexOffset: 0,
      lockOffset: 0,
      lockSize: 0,
      lockFlags: 0,
      state: this.state,
      camera: this.camera,
      projection: this.projection,
    };
    this.active = false;
    this.rendering = false;
    this.fresh = true;
    this.closed = false;
    this.bufferGrowths = 0;
  }
  assertOpen() {
    if (this.closed) throw new Error('Effekseer batch is closed');
  }
  assertActive() {
    this.assertOpen();
    if (!this.active || this.rendering)
      throw new Error('Effekseer batch requires an active nonrecursive pass');
  }
  event(kind, values) {
    if (this.trace) this.trace(kind, values);
  }
  sync(operation, packet) {
    const result = operation(packet);
    if (typeof result?.then === 'function')
      throw new Error('Effekseer batch submissions must be synchronous');
    return result;
  }
  begin() {
    this.assertOpen();
    if (this.active || this.byteLength) throw new Error('Effekseer batch pass is not settled');
    this.active = true;
    this.fresh = false;
    this.reset();
    return this;
  }
  updateState(input) {
    this.assertActive();
    const next = this.nextState;
    next.depthTest = boolean(input?.depthTest, 'depthTest');
    next.depthWrite = boolean(input?.depthWrite, 'depthWrite');
    next.distortion = boolean(input?.distortion, 'distortion');
    if (
      typeof input?.distortionIntensity !== 'number' ||
      !Number.isFinite(Math.fround(input.distortionIntensity))
    )
      throw new Error('Effekseer batch distortionIntensity is not finite');
    next.distortionIntensity = Math.fround(input.distortionIntensity);
    next.alphaBlend = integer(input.alphaBlend, 4, 'alphaBlend');
    next.culling = integer(input.culling, 2, 'culling');
    next.filter = integer(input.filter, 1, 'filter');
    next.wrap = integer(input.wrap, 1, 'wrap');
    const texture = input.texture;
    if (texture === 0 || texture === null) next.texture = null;
    else if (typeof texture === 'object' && texture !== null && typeof texture.then !== 'function')
      next.texture = texture;
    else if (typeof texture === 'string' && texture) next.texture = texture;
    else if (
      typeof texture === 'number' &&
      Number.isInteger(texture) &&
      texture > 0 &&
      texture <= 0xffffffff
    )
      next.texture = texture;
    else throw new TypeError('Effekseer batch texture requires an explicit settled binding');
    let changed = this.stateInvalid;
    for (const key of KEYS) if (this.state[key] !== next[key]) changed = true;
    if (changed) this.flush();
    for (const key of KEYS) this.state[key] = next[key];
    this.stateInvalid = false;
    return this;
  }
  ensure(length) {
    if (length <= this.bytes.length) return;
    let capacity = this.bytes.length;
    while (capacity < length)
      capacity = Math.min(this.maxReservationBytes, Math.max(length, capacity * 2));
    const next = new Uint8Array(capacity);
    next.set(this.bytes.subarray(0, this.byteLength));
    this.bytes = next;
    this.reservation.buffer = next;
    this.packet.bytes = next;
    this.bufferGrowths++;
  }
  reserve(vertices) {
    this.assertActive();
    if (this.stateInvalid)
      throw new Error('Effekseer batch requires the current node material before reserve');
    integer(vertices, 0x7fffffff, 'vertex reservation');
    if (vertices % 4) throw new RangeError('Effekseer batch requires whole-quad reservations');
    const stride = this.state.distortion ? 48 : 24,
      size = vertices * stride;
    if (!Number.isSafeInteger(size) || size > 0x7fffffff)
      throw new RangeError('Effekseer batch byte reservation overflow');
    if (this.byteLength + size > MAX_BYTES) this.flush();
    const length = this.byteLength + size;
    if (length > this.maxReservationBytes)
      throw new RangeError('Effekseer batch CPU byte budget exceeded after flushing old batch');
    this.ensure(length);
    const old = this.byteLength;
    this.bytes.fill(0, old, length);
    this.byteLength = length;
    this.reservation.offset = old;
    this.reservation.byteLength = size;
    this.reservation.stride = stride;
    return this.reservation;
  }
  flush(camera, projection) {
    this.assertActive();
    const size = this.byteLength;
    if (!size) return false;
    if (this.state.distortion) {
      this.byteLength = 0;
      this.event('no-background', []);
      return false;
    }
    // Preserve the original software precheck before the separate fixed-IB policy.
    if (size > MAX_BYTES) {
      this.byteLength = 0;
      this.event('lock-false', [size]);
      return false;
    }
    const offset = this.cursor + size <= MAX_BYTES ? this.cursor : 0,
      wrap = this.cursor + size > MAX_BYTES;
    this.cursor = offset + size;
    this.event('lock', [offset, wrap ? 0 : size, wrap ? 8192 : 4096]);
    this.event('unlock', []);
    const packet = this.packet;
    packet.byteLength = size;
    packet.vertexCount = size / 24;
    packet.indexCount = (packet.vertexCount / 4) * 6;
    packet.vertexOffset = offset / 24;
    packet.lockOffset = offset;
    packet.lockSize = wrap ? 0 : size;
    packet.lockFlags = wrap ? 8192 : 4096;
    this.byteLength = 0;
    matrix(camera ?? this.getCamera(), this.camera, 'camera');
    matrix(projection ?? this.getProjection(), this.projection, 'projection');
    let prepared = false;
    this.rendering = true;
    try {
      this.sync(this.prepare, packet);
      prepared = true;
      if (packet.indexCount > EFFEKSEER_INDEX_BUFFER_INDICES)
        throw new EffekseerUnsafeIndexDomainError(packet.vertexCount);
      this.sync(this.draw, packet);
      return true;
    } finally {
      try {
        if (prepared) this.sync(this.finish, packet);
      } finally {
        this.rendering = false;
      }
    }
  }
  reset() {
    this.assertActive();
    try {
      return this.flush();
    } finally {
      this.stateInvalid = true;
    }
  }
  end() {
    this.assertActive();
    try {
      return this.reset();
    } finally {
      this.active = false;
    }
  }
  snapshot() {
    this.assertOpen();
    if (this.active || this.byteLength || !this.stateInvalid)
      throw new Error('Effekseer batch checkpoint requires a settled renderer boundary');
    return { ringCursor: this.cursor };
  }
  restore(saved) {
    this.assertOpen();
    if (!this.fresh || this.active || this.byteLength)
      throw new Error('Effekseer batch restore requires a fresh owner');
    if (!saved || Object.keys(saved).length !== 1)
      throw new Error('Invalid Effekseer batch checkpoint');
    integer(saved.ringCursor, MAX_BYTES, 'ring cursor');
    if (saved.ringCursor % 96) throw new Error('Effekseer batch ring cursor is not quad-aligned');
    this.cursor = saved.ringCursor;
    this.fresh = false;
    return this;
  }
  close() {
    if (this.closed) return;
    if (this.active) throw new Error('Cannot close an active Effekseer batch');
    this.byteLength = 0;
    this.closed = true;
  }
}
