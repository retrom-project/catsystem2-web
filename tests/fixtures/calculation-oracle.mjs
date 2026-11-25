// SPDX-License-Identifier: MPL-2.0
// Only the private lane imports this PE layout. Every projected byte is also
// observed as independent domain state; all other PE writes remain exact.
import assert from 'node:assert/strict';
import { captureFloatingPoint, restoreFloatingPoint } from '../../oracle/ppi-floating-point.mjs';
const freshFloatingPoint = new WeakMap();
const matrixLayouts = {
  'sdk-4.01-engine-2.6.1.74': {
    index: 0xc95190,
    matrices: 0xc95198,
    crtCPU: 0x639b60,
    isa: 0xc96f74,
    d3dx: 0x418172,
    featureIAT: 0x98e2c0,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    index: 0xb90788,
    matrices: 0xb90790,
    crtCPU: 0x7a10a0,
    isa: 0xb925e4,
    d3dx: 0x4e6aea,
    featureIAT: 0x8c6384,
  },
};
export const calculationOracle = {
  prepare(engine, fixture) {
    const p = engine.process,
      layout = matrixLayouts[fixture.profile],
      address = layout.matrices;
    // Every authored input starts in a fresh process's complete FP state.
    // FSINCOS outside |x|<2^63 can otherwise expose popped register residue.
    if (!freshFloatingPoint.has(engine)) {
      // Execute the own initialization. The isolated feature service describes
      // the supported IA32/SSE2 host, with the obsolete feature7 path absent.
      p.store(
        layout.featureIAT,
        p.trap('calculation processor feature service', 1, ([feature]) =>
          Number([3, 6, 8, 10].includes(feature)),
        ),
      );
      p.call(layout.crtCPU, []);
      assert.equal(p.load(layout.isa), 2, 'own CRT selects SSE2');
      assert.equal(p.call(layout.d3dx, [0]), 0xffff);
      assert.equal(p.call(layout.d3dx, [1]), 2);
      freshFloatingPoint.set(engine, captureFloatingPoint(p));
    }
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
