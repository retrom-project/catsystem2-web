// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Fixed1.23 Matrix44 storage/product; original76 initializes and retains this
// renderer-owned cache. See ../../licenses/effekseer-MIT.txt.
import { multiply44 } from './mesh-packet.mjs';

export class EffekseerRingCurrentState {
  constructor() {
    this.matrix = new Float32Array(16);
    this.words = new Uint32Array(this.matrix.buffer);
    for (const index of [0, 5, 10, 15]) this.matrix[index] = 1;
    this.scratch43 = new Float32Array(12);
    this.fresh = true;
    this.closed = false;
  }
  assertOpen() {
    if (this.closed) throw new Error('Effekseer Ring current-state owner is closed');
  }
  updateMatrix43(matrix) {
    this.assertOpen();
    if (!matrix || matrix.length !== 12)
      throw new TypeError('Effekseer Ring current matrix requires twelve float32 components');
    for (let i = 0; i < 12; i++) {
      const value = matrix[i];
      if (typeof value !== 'number' || !Number.isFinite(Math.fround(value)))
        throw new Error('Effekseer Ring current matrix has a nonfinite component');
      this.scratch43[i] = value;
    }
    // The original single Rendering writes twelve components. The fourth
    // column belongs to this persistent Matrix44 and is never reinitialized.
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 3; col++) this.matrix[row * 4 + col] = this.scratch43[row * 3 + col];
    this.fresh = false;
    return this;
  }
  copyMatrix44(out) {
    this.assertOpen();
    if (!(out instanceof Float32Array) || out.length !== 16)
      throw new TypeError('Effekseer Ring matrix output requires sixteen float32 slots');
    new Uint32Array(out.buffer, out.byteOffset, 16).set(this.words);
    return out;
  }
  cameraMatrix(camera, out) {
    this.assertOpen();
    return multiply44(this.matrix, camera, out);
  }
  snapshot() {
    this.assertOpen();
    return { matrixWords: this.words.slice() };
  }
  restore(saved) {
    this.assertOpen();
    if (!this.fresh) throw new Error('Effekseer Ring current-state restore requires a fresh owner');
    if (
      !saved ||
      Object.keys(saved).length !== 1 ||
      !(saved.matrixWords instanceof Uint32Array) ||
      saved.matrixWords.length !== 16
    )
      throw new Error('Invalid Effekseer Ring current-state checkpoint');
    this.words.set(saved.matrixWords);
    this.fresh = false;
    return this;
  }
  close() {
    this.closed = true;
  }
}
