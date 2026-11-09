// SPDX-License-Identifier: MPL-2.0
// Only the private lane imports this PE layout. Every projected byte is also
// observed as independent domain state; all other PE writes remain exact.
import assert from 'node:assert/strict';
import { captureFloatingPoint, restoreFloatingPoint } from '../../src/ppi/floating-point.mjs';
const freshFloatingPoint = new WeakMap();
const matrixLayouts = {
  'sdk-4.01-engine-2.6.1.74': { index: 0xc95190, matrices: 0xc95198 },
  'nekopara-vol3-engine-2.6.1.76': { index: 0xb90788, matrices: 0xb90790 },
};
export const calculationOracle = {
  prepare(engine, fixture) {
    const p = engine.process,
      layout = matrixLayouts[fixture.profile],
      address = layout.matrices;
    // Every authored input starts in a fresh process's complete FP state.
    // FSINCOS outside |x|<2^63 can otherwise expose popped register residue.
    if (!freshFloatingPoint.has(engine)) freshFloatingPoint.set(engine, captureFloatingPoint(p));
    restoreFloatingPoint(p, freshFloatingPoint.get(engine));
    p.store(layout.index, 0);
    const bytes = new Uint8Array(64),
      view = new DataView(bytes.buffer);
    fixture.initial?.matrixWords?.forEach((word, i) => view.setUint32(i * 4, word, true));
    p.write(address, bytes);
    return {
      projectedRanges: [{ address, bytes: 64 }],
      memory() {
        assert.equal(p.load(layout.index), 0, 'matrix handlers do not change stack selection');
        return { 'state:current-matrix': p.read(address, 64).slice() };
      },
    };
  },
};
