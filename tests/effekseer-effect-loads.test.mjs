// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EffekseerResources } from '../src/effekseer/resources.mjs';
import { EffekseerEffectLoads } from '../src/effekseer/effect-loads.mjs';
import { EffekseerManagerLifecycle } from '../src/effekseer/manager-lifecycle.mjs';
import { createEffekseerInstanceOperations } from '../src/effekseer/instance-operations.mjs';
import { LogicalCRTThreads } from '../src/effekseer/crt-threads.mjs';
import { PNG } from '../src/formats/png.mjs';
import { authoredEffect } from './fixtures/effekseer/authored-effect.mjs';

const image = await readFile(new URL('./fixtures/effekseer/authored-spark.png', import.meta.url));
async function setup({
  paths = ['spark.png', 'other/spark.png'],
  wait = null,
  failDecode = false,
} = {}) {
  const bytes = authoredEffect({
      colorPaths: paths,
      maxGeneration: 1,
      life: [100, 100],
      interval: 0,
    }),
    counts = { load: 0, decode: 0, release: 0, retain: 0, dispose: 0 },
    resources = new EffekseerResources({
      resolveCategory: (name, category) => category + '/' + name,
      readNative: async (name) => {
        if (wait) await wait;
        return name === 'efk/shared' ? bytes : name === 'efktex/spark.png' ? image : null;
      },
      roundTripCP932: (name) => name,
      identify: (data) => createHash('sha256').update(data).digest('hex'),
      decodeTexture: async (data) => {
        counts.decode++;
        if (failDecode) throw new Error('Authored decoder error');
        const png = new PNG(data);
        return { width: png.width, height: png.height, rgba: await png.decode() };
      },
      disposeTexture: () => counts.dispose++,
    });
  for (const name of ['load', 'release', 'retain']) {
    const operation = resources[name].bind(resources);
    resources[name] = (...args) => {
      counts[name]++;
      return operation(...args);
    };
  }
  const loads = new EffekseerEffectLoads({ resources }),
    threads = new LogicalCRTThreads();
  threads.create('authored.caller');
  const manager = new EffekseerManagerLifecycle({
    resources: loads,
    threads,
    instanceOperations: createEffekseerInstanceOperations(),
  });
  return {
    resources,
    loads,
    threads,
    manager,
    counts,
    close() {
      this.manager.close();
      this.loads.close();
      this.resources.close();
      this.threads.close();
    },
  };
}
const tokens = (load) => load.textures.color.map((binding) => binding.token);

test('each successful FILE load and texture entry has identity independent of one decoded storage', async () => {
  const s = await setup();
  try {
    const a = await s.loads.load('shared'),
      b = await s.loads.load('shared');
    assert.notEqual(a.id, b.id);
    assert.equal(a.sourceID, b.sourceID);
    assert.equal(a.effect, b.effect);
    assert.equal(s.counts.decode, 1);
    assert.equal(new Set([...tokens(a), ...tokens(b)]).size, 4);
    assert.equal(new Set([...a.textures.color, ...b.textures.color].map((t) => t.frame)).size, 1);
    assert.deepEqual(
      tokens(a).map((t) => t.id),
      [1, 2],
    );
    assert.deepEqual(
      tokens(b).map((t) => t.id),
      [3, 4],
    );
    assert.equal(s.resources.get(a.sourceID).references, 2);
  } finally {
    s.close();
  }
});
test('repeated Play retains one logical load and never allocates texture identity again', async () => {
  const s = await setup();
  try {
    const a = await s.loads.load('shared'),
      before = s.loads.snapshot();
    s.manager.play(a.id, [0, 0, 0], 'authored.caller');
    s.manager.play(a.id, [1, 0, 0], 'authored.caller');
    assert.equal(a.references, 3);
    assert.equal(s.loads.nextID, before.nextID);
    assert.equal(s.loads.nextTextureID, before.nextTextureID);
    assert.equal(s.resources.get(a.sourceID).references, 1);
    s.loads.release(a.id);
    assert.equal(a.references, 2);
    s.manager.update('authored.caller');
    s.manager.update('authored.caller');
    let count = 0;
    s.manager.draw({ instance: () => count++ });
    assert.equal(count, 2);
    assert.equal(s.loads.bindingFor(tokens(a)[0]).frame, a.textures.color[0].frame);
  } finally {
    s.close();
  }
});
test('old drawsets keep old FILE identities through stop and the two GC queues', async () => {
  const s = await setup();
  try {
    const a = await s.loads.load('shared'),
      old = tokens(a)[0],
      first = s.manager.play(a.id, [0, 0, 0], 'authored.caller'),
      second = s.manager.play(a.id, [1, 0, 0], 'authored.caller'),
      b = await s.loads.load('shared');
    s.manager.play(b.id, [2, 0, 0], 'authored.caller');
    s.loads.release(a.id);
    s.loads.release(b.id);
    s.manager.stop(first);
    for (let i = 0; i < 3; i++) s.manager.update('authored.caller');
    assert.equal(a.references, 1);
    assert.ok(s.loads.bindingFor(old));
    s.manager.stop(second);
    s.manager.update('authored.caller');
    s.manager.update('authored.caller');
    assert.ok(s.loads.bindingFor(old));
    s.manager.update('authored.caller');
    assert.throws(() => s.loads.get(a.id), /Unknown/);
    assert.throws(() => s.loads.bindingFor(old), /retired/);
    assert.equal(s.resources.get(b.sourceID).references, 1);
    assert.equal(s.counts.dispose, 0);
  } finally {
    s.close();
  }
});
test('missing texture entries retain original NULL instead of allocating a logical token', async () => {
  const s = await setup({ paths: ['absent.png', 'spark.png'] });
  try {
    const a = await s.loads.load('shared');
    assert.deepEqual(
      tokens(a).map((t) => t?.id ?? null),
      [null, 1],
    );
    assert.equal(a.textures.color[0].frame, null);
    assert.equal(s.loads.bindingFor(null), null);
    assert.equal(s.loads.nextTextureID, 2);
    assert.deepEqual(s.loads.snapshot().loads[0].textures.color, [null, 1]);
  } finally {
    s.close();
  }
});
test('an explicit loader-failure NULL result has no texture ID even when its source was present', async () => {
  const cache = () => {
    const physical = {
        id: 1,
        references: 1,
        effect: {},
        textures: { color: [{ missing: false, frame: null }], normal: [], distortion: [] },
      },
      counts = { releases: 0, loads: 0 };
    return {
      counts,
      resources: {
        load() {
          counts.loads++;
          return physical;
        },
        get() {
          return physical;
        },
        release() {
          counts.releases++;
        },
        snapshot() {
          return { assets: [{ id: 1, references: 1 }] };
        },
      },
    };
  };
  const firstCache = cache(),
    secondCache = cache(),
    loads = new EffekseerEffectLoads({ resources: firstCache.resources }),
    fresh = new EffekseerEffectLoads({ resources: secondCache.resources });
  const a = await loads.load('authored-result');
  assert.equal(a.textures.color[0].missing, false);
  assert.equal(a.textures.color[0].token, null);
  assert.equal(a.textures.color[0].frame, null);
  assert.equal(loads.nextTextureID, 1);
  const state = loads.snapshot();
  fresh.restore(state);
  assert.equal(secondCache.counts.loads, 0);
  assert.deepEqual(fresh.snapshot(), state);
  fresh.close();
  loads.close();
  assert.equal(firstCache.counts.releases, 1);
  assert.equal(secondCache.counts.releases, 1);
});
test('missing Effect or a visible decoder failure publishes no invented Effect or texture', async () => {
  const s = await setup({ failDecode: true });
  try {
    assert.equal(await s.loads.load('absent'), null);
    await assert.rejects(s.loads.load('shared'), /Authored decoder error/);
    assert.deepEqual(s.loads.snapshot(), { nextID: 1, nextTextureID: 1, loads: [] });
    assert.equal(s.loads.bindings.size, 0);
    assert.equal(s.resources.assets.size, 0);
  } finally {
    s.close();
  }
});
test('last load reference retires logical IDs and releases shared physical storage exactly once', async () => {
  const s = await setup();
  try {
    const a = await s.loads.load('shared'),
      b = await s.loads.load('shared'),
      old = tokens(a)[0];
    s.loads.release(a.id);
    assert.throws(() => s.loads.bindingFor(old), /retired/);
    assert.equal(s.counts.dispose, 0);
    s.loads.release(b.id);
    assert.equal(s.counts.release, 2);
    assert.equal(s.counts.dispose, 1);
    assert.equal(s.loads.bindings.size, 0);
    assert.equal(s.resources.byID.size, 0);
    assert.deepEqual(s.loads.snapshot(), { nextID: 3, nextTextureID: 5, loads: [] });
  } finally {
    s.close();
  }
});
test('fresh rebind preserves live aliases, IDs and counts without source Load, retain, Play or RNG', async () => {
  const a = await setup();
  let b;
  try {
    const first = await a.loads.load('shared'),
      second = await a.loads.load('shared');
    a.manager.play(first.id, [0, 0, 0], 'authored.caller');
    a.manager.play(first.id, [1, 0, 0], 'authored.caller');
    a.manager.play(second.id, [2, 0, 0], 'authored.caller');
    a.manager.update('authored.caller');
    a.manager.update('authored.caller');
    const saved = structuredClone({
      resources: a.resources.snapshot(),
      loads: a.loads.snapshot(),
      threads: a.threads.snapshot(),
      manager: a.manager.snapshot(),
    });
    b = await setup();
    b.threads.close();
    b.threads = new LogicalCRTThreads();
    b.threads.restore(saved.threads);
    b.manager.close();
    b.manager = new EffekseerManagerLifecycle({
      resources: b.loads,
      threads: b.threads,
      instanceOperations: createEffekseerInstanceOperations(),
    });
    await b.resources.restore(saved.resources);
    const prior = { ...b.counts },
      random = b.threads.snapshot();
    b.loads.restore(saved.loads);
    b.manager.restore(saved.manager);
    assert.deepEqual(b.counts, prior);
    assert.deepEqual(b.threads.snapshot(), random);
    assert.deepEqual(b.loads.snapshot(), saved.loads);
    assert.deepEqual(b.manager.snapshot(), saved.manager);
    assert.equal(b.loads.get(first.id).effect, b.loads.get(second.id).effect);
    assert.equal(
      b.loads.get(first.id).textures.color[0].frame,
      b.loads.get(second.id).textures.color[1].frame,
    );
    assert.notEqual(tokens(b.loads.get(first.id))[0], tokens(first)[0]);
    assert.deepEqual(
      tokens(b.loads.get(first.id)).map((t) => t.id),
      [1, 2],
    );
    const orderA = [],
      orderB = [];
    a.manager.draw({ instance: ({ set }) => orderA.push(set.assetID) });
    b.manager.draw({ instance: ({ set }) => orderB.push(set.assetID) });
    assert.equal(orderA.length, 3);
    assert.deepEqual(orderB, orderA);
    a.manager.update('authored.caller');
    b.manager.update('authored.caller');
    assert.deepEqual(b.manager.snapshot(), a.manager.snapshot());
    assert.deepEqual(b.threads.snapshot(), a.threads.snapshot());
  } finally {
    b?.close();
    a.close();
  }
});
test('invalid identity/null/alias/reference checkpoint fails atomically against restored physical data', async () => {
  const a = await setup();
  try {
    await a.loads.load('shared');
    const source = a.resources.snapshot(),
      state = a.loads.snapshot();
    const mutations = [
      (s) => (s.loads[0].textures.color[0] = null),
      (s) => (s.loads[0].textures.color[1] = s.loads[0].textures.color[0]),
      (s) => s.loads[0].textures.color.push(100),
      (s) => (s.loads[0].sourceID = 100),
      (s) => (s.nextTextureID = 2),
      (s) => (s.loads[0].references = 0),
      (s) => s.loads.push({ ...structuredClone(s.loads[0]), id: 2 }),
    ];
    for (const mutate of mutations) {
      const b = await setup();
      try {
        await b.resources.restore(source);
        const bad = structuredClone(state),
          before = { ...b.counts };
        mutate(bad);
        assert.throws(() => b.loads.restore(bad));
        assert.equal(b.loads.loads.size, 0);
        assert.equal(b.loads.bindings.size, 0);
        assert.deepEqual(b.counts, before);
        b.loads.restore(state);
        assert.deepEqual(b.loads.snapshot(), state);
      } finally {
        b.close();
      }
    }
  } finally {
    a.close();
  }
});
test('pending source loads cannot snapshot, restore or close as a settled owner', async () => {
  let resolve;
  const wait = new Promise((done) => (resolve = done)),
    s = await setup({ wait });
  const pending = s.loads.load('shared');
  assert.throws(() => s.loads.snapshot(), /settled/);
  assert.throws(() => s.loads.restore({ nextID: 1, nextTextureID: 1, loads: [] }), /fresh/);
  assert.throws(() => s.loads.close(), /unsettled/);
  resolve();
  await pending;
  assert.equal(s.loads.snapshot().loads.length, 1);
  s.close();
});
test('logical tokens reject mutation, foreign owners and retired aliases', async () => {
  const a = await setup(),
    b = await setup();
  try {
    const x = await a.loads.load('shared'),
      y = await b.loads.load('shared'),
      token = tokens(x)[0];
    assert.throws(() => (token.id = 99), TypeError);
    assert.throws(() => a.loads.bindingFor(tokens(y)[0]), /Unknown/);
    assert.throws(() => a.loads.bindingFor({ id: token.id }), /Unknown/);
    a.loads.release(x.id);
    assert.throws(() => a.loads.bindingFor(token), /retired/);
    const z = await a.loads.load('shared');
    assert.equal(tokens(z)[0].id, 3);
  } finally {
    a.close();
    b.close();
  }
});
test('restoring a logical NULL over a newly successful physical entry fails explicitly', async () => {
  const a = await setup();
  try {
    await a.loads.load('shared');
    const source = a.resources.snapshot(),
      state = a.loads.snapshot();
    const b = await setup();
    try {
      await b.resources.restore(source);
      state.loads[0].textures.color[0] = null;
      assert.throws(() => b.loads.restore(state), /texture ID/);
      assert.equal(b.loads.loads.size, 0);
    } finally {
      b.close();
    }
  } finally {
    a.close();
  }
});
test('unowned source-cache references are rejected and closed load APIs do not revive a cache', async () => {
  const s = await setup();
  const physical = await s.resources.load('shared');
  assert.throws(() => s.loads.snapshot(), /exclusive load owner/);
  s.resources.release(physical.id);
  s.loads.close();
  await assert.rejects(s.loads.load('shared'), /closed/);
  assert.throws(() => s.loads.get(1), /closed/);
  assert.throws(() => s.loads.snapshot(), /closed/);
  s.close();
});
