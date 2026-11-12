// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_ROUTE_AUDIT, reviewRenderIndirect } from '../scripts/render-route-audit.mjs';
import { NATIVE_ABIS } from '../src/native/abi/index.mjs';
import { NATIVE_GRAPHICS_IDS, installNativeGraphics } from '../src/native/graphics.mjs';
import { NATIVE_DRAW_IDS } from '../src/native/draw-task.mjs';
import { NATIVE_MESH_IDS } from '../src/native/mesh.mjs';
import { NativeHandles } from '../src/native/handles.mjs';

for (const profile of Object.keys(NATIVE_ABIS))
  test(profile + ' render inventory agrees with the installed wrapper messages', async () => {
    const handlers = new Map(),
      factories = new Map(),
      messages = [];
    const world = {
      profile,
      game: { width: 64, height: 64 },
      objects: { register: (kind, factory) => factories.set(kind, factory) },
      runtime: {
        handles: new NativeHandles(),
        register: (_table, id, handler) => handlers.set(id, handler),
      },
      sendNativeEngine(_target, _sender, message) {
        messages.push(message);
        return 0;
      },
    };
    installNativeGraphics(world);
    world.graphics.initializeTextures = () => {};
    world.graphics.texturePages = {
      releaseRectangle() {},
      allocateMissing() {},
    };
    world.configuration = { fields: { texture: {} } };
    assert.deepEqual(
      [...new Set(RENDER_ROUTE_AUDIT.map((r) => r.id))].sort((a, b) => a - b),
      [...NATIVE_GRAPHICS_IDS, ...NATIVE_DRAW_IDS, ...NATIVE_MESH_IDS].sort((a, b) => a - b),
    );
    assert.ok([2, 6, 15].every((kind) => factories.has(kind)));
    const machine = { load: () => 0, store() {}, bytes: (_at, count) => new Uint8Array(count) };
    for (const row of RENDER_ROUTE_AUDIT) {
      messages.length = 0;
      const count =
        {
          [0x21d]: 4,
          [0x21e]: 0,
          [0x159]: 5,
          [0x157]: 3,
          [0x158]: 3,
          [0x192]: 2,
          [0x1d0]: 2,
          [0x1d2]: 2,
          [0x1d3]: 3,
        }[row.id] ?? 13;
      const args = new Array(count).fill(0);
      if (count) args[0] = 17;
      const reply = await handlers.get(row.id)(args, machine, { id: 9 });
      assert.deepEqual(messages, row.messages, row.semanticName);
      assert.ok([1, 2].includes(reply.control), row.semanticName);
      if (row.id === 0x108)
        assert.deepEqual(reply, { control: 2 }, 'original count is deliberately discarded');
    }
  });

test('foreign receivers and new indirect sites remain explicit in the render audit', () => {
  const m2 = RENDER_ROUTE_AUDIT.filter((r) => r.consumerRoutes.some((c) => c.domain === 9));
  assert.deepEqual(
    m2.map((r) => r.id).sort((a, b) => a - b),
    [],
  );
  for (const row of RENDER_ROUTE_AUDIT) {
    assert.equal(
      row.consumerRoutes.some((c) => c.domain === 7),
      false,
    );
    assert.equal(
      row.consumerRoutes.some((c) => c.domain === 8),
      Boolean(row.messages.length),
    );
    for (const consumer of row.consumerRoutes) {
      assert.ok(consumer.condition && consumer.module && consumer.removePhase === consumer.domain);
      assert.equal(consumer.implementation, 'original-handler');
    }
  }
  assert.equal(
    reviewRenderIndirect('src/native/graphics.mjs', {
      method: 'getNativeFeature',
      feature: 'unreviewed-code',
    }),
    null,
  );
  assert.equal(
    reviewRenderIndirect('src/native/graphics.mjs', { method: 'ensureNativeEngine' }),
    null,
  );
});

// Actual JS M2 common-message and native packets are covered by emote-world's
// frozen task-oracle cases; no original M2 receiver branch remains in this audit.
