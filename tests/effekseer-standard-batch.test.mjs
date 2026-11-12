// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EffekseerStandardBatch,
  EffekseerUnsafeIndexDomainError,
} from '../src/effekseer/standard-batch.mjs';
import {
  EFFEKSEER_RESTORED_STATES,
  EFFEKSEER_RESTORED_BINDINGS,
} from '../src/effekseer/materials.mjs';
import { setup, material } from './fixtures/effekseer/gpu-seam.mjs';
const cases = JSON.parse(
    await readFile(new URL('./fixtures/effekseer/batch-cases.json', import.meta.url)),
  ),
  reference = JSON.parse(
    await readFile(new URL('./fixtures/effekseer/batch-source-reference.json', import.meta.url)),
  ).cases;
const zero = new Float32Array(16),
  normal = {
    depthTest: false,
    depthWrite: false,
    distortion: false,
    distortionIntensity: 1,
    alphaBlend: 1,
    culling: 2,
    filter: 0,
    wrap: 0,
    texture: null,
  };
function recordFixture(extra = {}) {
  const events = [],
    draws = [],
    reserveOffsets = [];
  const event = (kind, values) => {
    if (kind !== 'no-background') events.push({ kind, values });
  };
  const batch = new EffekseerStandardBatch({
    camera: () => zero,
    projection: () => zero,
    trace: event,
    prepare: (p) => {
      event('push', []);
      event('begin-shader', []);
      event('textures', [1, p.state.texture ?? 0]);
      event('constants', []);
      const s = p.state;
      event('material', [
        +s.depthTest,
        +s.depthWrite,
        s.culling,
        s.alphaBlend,
        s.filter,
        s.wrap,
        0,
      ]);
      event('vertex-buffer', [24]);
      event('index-buffer', []);
      event('layout', []);
    },
    draw: (p) => {
      let hash = 2166136261,
        nonzero = 0;
      for (let i = 0; i < p.byteLength; i++) {
        hash = Math.imul(hash ^ p.bytes[i], 16777619) >>> 0;
        nonzero += p.bytes[i] !== 0;
      }
      draws.push({
        quads: p.vertexCount / 4,
        offset: p.vertexOffset,
        bytes: p.byteLength,
        hashFNV32: hash,
        nonzeroBytes: nonzero,
        firstBytes: Array.from(p.bytes.subarray(0, Math.min(16, p.byteLength))),
      });
      event('draw', [p.vertexCount / 4, p.vertexOffset]);
    },
    finish: () => {
      event('end-shader', []);
      event('pop', []);
    },
    ...extra,
  });
  return { batch, events, draws, reserveOffsets };
}
for (const input of cases)
  test('whole public StandardRenderer byte/state reference: ' + input.name, () => {
    const f = recordFixture(),
      b = f.batch,
      expected = reference.find((c) => c.name === input.name);
    let reservation, error;
    b.begin();
    try {
      for (const op of input.ops)
        switch (op.op) {
          case 'state':
            b.updateState(op.value);
            break;
          case 'reserve':
            reservation = b.reserve(op.vertices);
            f.reserveOffsets.push(reservation.offset);
            break;
          case 'fill':
            assert.ok(op.start + op.length <= reservation.byteLength);
            reservation.buffer.fill(
              op.value,
              reservation.offset + op.start,
              reservation.offset + op.start + op.length,
            );
            break;
          case 'flush':
            b.flush();
            break;
          case 'reset':
            b.reset();
            break;
          default:
            assert.fail('Unknown fixture op');
        }
    } catch (e) {
      error = e;
    } finally {
      b.end();
    }
    if (input.policy) {
      assert.ok(error instanceof EffekseerUnsafeIndexDomainError);
      assert.equal(error.code, 'EFFEKSEER_UNSAFE_INDEX_DOMAIN');
      assert.ok(error.indexCount > 12000);
    } else assert.equal(error, undefined);
    assert.deepEqual(f.reserveOffsets, expected.reserveOffsets);
    const definedEvents = expected.events.filter(
        (e) => !(input.policy && e.kind === 'draw' && e.values[0] > 2000),
      ),
      definedDraws = expected.draws.filter((d) => !(input.policy && d.quads > 2000));
    assert.deepEqual(f.events, definedEvents);
    assert.deepEqual(f.draws, definedDraws);
    assert.equal(b.byteLength, 0);
    assert.equal(b.snapshot().ringCursor, expected.finalCursor);
  });
test('unsafe draw applies known material and restores exactly12states/5bindings in finally', () => {
  const s = setup(),
    states = EFFEKSEER_RESTORED_STATES.map((k) => s.view.getState(k)),
    bindings = EFFEKSEER_RESTORED_BINDINGS.map((k) => s.view.getBinding(k));
  let finished = 0,
    drawn = 0;
  const b = new EffekseerStandardBatch({
    camera: () => zero,
    projection: () => zero,
    prepare: (p) => {
      s.view.setBinding('vertexShader', 'efk');
      s.view.setBinding('pixelShader', 'plain');
      s.scope.applyNormalMaterial(material(p.state.alphaBlend, p.state.filter, p.state.wrap));
    },
    draw: () => {
      drawn++;
    },
    finish: () => {
      finished++;
      s.view.setBinding('vertexShader', null);
      s.view.setBinding('pixelShader', null);
    },
  });
  s.scope.begin();
  b.begin();
  try {
    b.updateState({ ...normal, alphaBlend: 3, filter: 1, wrap: 0 });
    b.reserve(8004);
    assert.throws(() => b.flush(), EffekseerUnsafeIndexDomainError);
  } finally {
    try {
      b.end();
    } finally {
      s.scope.end();
    }
  }
  assert.equal(finished, 1);
  assert.equal(drawn, 0);
  assert.equal(b.snapshot().ringCursor, 192096);
  assert.deepEqual(
    EFFEKSEER_RESTORED_STATES.map((k) => s.view.getState(k)),
    states,
  );
  assert.deepEqual(
    EFFEKSEER_RESTORED_BINDINGS.map((k) => s.view.getBinding(k)),
    bindings,
  );
  assert.equal(s.context.samplers.get(5), 2);
  assert.equal(s.context.samplers.get(6), 2);
  assert.equal(s.context.samplers.get(1), 1);
  assert.equal(s.context.samplers.get(2), 1);
});
test('3334 preserves source VB-false/clear ahead of the IB safety guard and does not prepare a draw', () => {
  let prepared = 0,
    drawn = 0;
  const f = recordFixture({
    prepare: () => {
      prepared++;
    },
    draw: () => {
      drawn++;
    },
  });
  f.batch.begin();
  f.batch.updateState(normal);
  f.batch.reserve(13336);
  assert.equal(f.batch.flush(), false);
  f.batch.end();
  assert.equal(prepared, 0);
  assert.equal(drawn, 0);
  assert.equal(f.batch.snapshot().ringCursor, 0);
  assert.ok(f.events.some((e) => e.kind === 'lock-false' && e.values[0] === 320064));
});
test('CPU budget failure still flushes the already valid old batch first', () => {
  const f = recordFixture({ maxReservationBytes: 320000 }),
    b = f.batch;
  b.begin();
  b.updateState(normal);
  b.reserve(4);
  assert.throws(() => b.reserve(13336), /CPU byte budget/);
  assert.equal(f.draws.length, 1);
  assert.equal(f.draws[0].quads, 1);
  b.end();
  assert.equal(b.snapshot().ringCursor, 96);
});
test('settled snapshots retain cursor only; fresh restore consumes no draw or temporary vertex history', () => {
  const f = recordFixture(),
    b = f.batch;
  b.begin();
  b.updateState(normal);
  b.reserve(4);
  assert.throws(() => b.snapshot(), /settled/);
  b.end();
  const saved = b.snapshot();
  assert.deepEqual(saved, { ringCursor: 96 });
  const fresh = recordFixture();
  fresh.batch.restore(saved);
  assert.equal(fresh.draws.length, 0);
  fresh.batch.begin();
  fresh.batch.updateState(normal);
  fresh.batch.reserve(4);
  fresh.batch.end();
  assert.equal(fresh.draws[0].offset, 4);
  assert.equal(fresh.batch.snapshot().ringCursor, 192);
});
test('reservation storage and record are reused and a later zero reservation clears old data', () => {
  const f = recordFixture(),
    b = f.batch;
  b.begin();
  b.updateState(normal);
  const a = b.reserve(4),
    storage = a.buffer;
  a.buffer.fill(255, a.offset, a.offset + a.byteLength);
  b.flush();
  const next = b.reserve(4);
  assert.equal(a, next);
  assert.equal(next.buffer, storage);
  assert.ok(next.buffer.subarray(next.offset, next.offset + next.byteLength).every((x) => x === 0));
  b.end();
  assert.equal(b.bufferGrowths, 0);
});
test('normal2000 emits one draw callback with8000vertices/12000indices', () => {
  const f = recordFixture(),
    b = f.batch;
  b.begin();
  b.updateState(normal);
  const r = b.reserve(8000);
  r.buffer.fill(1, 0, r.byteLength);
  b.end();
  assert.equal(f.draws.length, 1);
  assert.equal(f.draws[0].quads, 2000);
  assert.equal(f.draws[0].bytes, 192000);
  assert.equal(f.draws[0].nonzeroBytes, 192000);
});
test('source no-background branch clears distortion without locks, shader work or ring cursor changes', () => {
  const f = recordFixture(),
    b = f.batch;
  b.begin();
  b.updateState({ ...normal, distortion: true });
  const r = b.reserve(13336);
  assert.equal(r.stride, 48);
  assert.equal(b.flush(), false);
  b.end();
  assert.equal(f.events.length, 0);
  assert.equal(f.draws.length, 0);
  assert.equal(b.snapshot().ringCursor, 0);
});
test('required synchronous operations reject an async draw and still finish/end the pass', () => {
  let finish = 0;
  const f = recordFixture({
      draw: () => Promise.resolve(),
      finish: () => {
        finish++;
      },
    }),
    b = f.batch;
  b.begin();
  b.updateState(normal);
  b.reserve(4);
  assert.throws(() => b.flush(), /synchronous/);
  b.end();
  assert.equal(finish, 1);
  assert.equal(b.active, false);
  assert.equal(b.byteLength, 0);
});
test('invalid lifecycle/material/checkpoint never becomes an implicit default submission', () => {
  assert.throws(() => new EffekseerStandardBatch(), /required/);
  const f = recordFixture(),
    b = f.batch;
  assert.throws(() => b.reserve(4), /active/);
  b.begin();
  assert.throws(() => b.reserve(4), /material/);
  assert.throws(() => b.updateState({}), /boolean/);
  b.updateState(normal);
  assert.throws(() => b.reserve(1), /whole-quad/);
  b.end();
  assert.throws(() => b.restore({ ringCursor: 0 }), /fresh/);
  const g = recordFixture();
  assert.throws(() => g.batch.restore({ ringCursor: 1 }), /aligned/);
  assert.throws(() => g.batch.restore({ ringCursor: 0, vertices: [] }), /checkpoint/);
  b.close();
  b.close();
  assert.throws(() => b.begin(), /closed/);
});
