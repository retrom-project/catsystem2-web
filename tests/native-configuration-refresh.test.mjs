// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeABI } from '../src/native/abi/index.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const request = (world, args = []) =>
  world.runtime.native('main', 533, args, world.main.machine, world.main);
const profiles = [
  'bokutomo-engine-2.6.1.67',
  'rebellions-jp-engine-2.6.1.63',
  'grisaia-jp-engine-2.6.1.23',
];
for (const profile of profiles) {
  async function open(t, options) {
    const world = await dataWorld(profile, {}, options);
    t.after(() => world.close({ flushFiles: false }));
    return world;
  }

  test(`${profile} refresh has its own zero-word control-2 contract`, async (t) => {
    const world = await open(t),
      entry = nativeABI(profile).tables.main.entries[533];
    assert.equal(entry.status, 'recovered');
    assert.equal(entry.signature.argumentWords, 0);
    assert.equal(entry.signature.resultWritten, false);
    assert.equal(entry.signature.review, 'reviewed');
    assert.equal((await request(world)).control, 2);
    assert.throws(() => request(world, [0]), /expects no arguments/);
    assert.equal(world.configurationDirty, false);
  });

  test(`${profile} refresh follows Root update and coalesces notifications before redraw`, async (t) => {
    const writes = [],
      world = await open(t, {
        storage: { read: async () => null, write: async (...args) => (writes.push(args), true) },
      }),
      root = world.objects.objects.get(world.root).implementation,
      originalTick = root.tick?.bind(root),
      originalMessage = root.message.bind(root),
      renderer = world.screenEffects.rendering,
      redraw = renderer.requestRedraw.bind(renderer),
      observed = [];
    world.graphics.view.configure({ clientWidth: 643, clientHeight: 479 });
    Object.assign(world.configuration.screen, { currentWidth: 800, currentHeight: 600 });
    root.tick = async (...args) => {
      observed.push(['update', world.configurationRefresh.pending]);
      await originalTick?.(...args);
      await request(world);
    };
    root.message = async (words, ...rest) => {
      if (words[1] === 19) {
        observed.push(['notify', ...words, world.configurationRefresh.pending]);
        await request(world);
      }
      return originalMessage(words, ...rest);
    };
    renderer.requestRedraw = (...args) => {
      observed.push(['redraw', world.configurationRefresh.pending]);
      return redraw(...args);
    };
    await request(world);
    await request(world);
    await world.tick();
    assert.deepEqual(observed, [
      ['update', true],
      ['notify', 0, 19, 0, 0, true],
      ['redraw', true],
    ]);
    assert.equal(world.configurationRefresh.pending, false);
    assert.deepEqual([...renderer.dirtyCurrent], [0, 0, 643, 479]);
    assert.deepEqual(writes, []);
    assert.equal(world.configurationDirty, false);

    observed.length = 0;
    await world.tick();
    assert.deepEqual(observed, [
      ['update', false],
      ['notify', 0, 19, 0, 0, true],
      ['redraw', true],
    ]);
  });

  test(`${profile} pending refresh survives cold restore and waits for an existing Root`, async (t) => {
    const world = await open(t);
    await request(world);
    const snapshot = structuredClone(world.snapshot()),
      fresh = await open(t, { initialize: false });
    await fresh.restore(snapshot);
    assert.equal(fresh.configurationRefresh.pending, true);
    const root = fresh.root;
    fresh.root = undefined;
    assert.equal(await fresh.configurationRefresh.consume(), false);
    assert.equal(fresh.configurationRefresh.pending, true);
    fresh.root = root;
    await fresh.tick();
    assert.equal(fresh.configurationRefresh.pending, false);
    await fresh.tick();
    assert.equal(fresh.configurationRefresh.pending, false);
    assert.throws(() => fresh.configurationRefresh.restore({ pending: 1 }), /refresh checkpoint/);
  });

  test(`${profile} client redraw overwrites the current rectangle only while the renderer is available`, async (t) => {
    const world = await open(t),
      renderer = world.screenEffects.rendering;
    world.graphics.view.configure({ clientWidth: 643, clientHeight: 479 });
    for (const [paused, active] of [
      [true, true],
      [false, false],
      [false, true],
    ]) {
      Object.assign(world.graphics.view, { paused, active });
      renderer.dirtyCurrent.set([11, 22, 33, 44]);
      await request(world);
      assert.equal(await world.configurationRefresh.consume(), true);
      assert.equal(world.configurationRefresh.pending, false);
      assert.deepEqual(
        [...renderer.dirtyCurrent],
        active && !paused ? [0, 0, 643, 479] : [11, 22, 33, 44],
      );
    }
    renderer.requestRedraw([-5, -6, 1, 2]);
    assert.deepEqual([...renderer.dirtyCurrent], [-5, -6, 643, 479]);
  });
}

test('unrecovered profiles retain the Main533 guard and cannot restore a pending request', async (t) => {
  const world = await dataWorld('sdk-4.01-engine-2.6.1.74');
  t.after(() => world.close({ flushFiles: false }));
  assert.throws(() => request(world), /Unsupported.*main native/);
  assert.throws(() => world.configurationRefresh.restore({ pending: true }), /refresh checkpoint/);
});
