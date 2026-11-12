// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeObjects } from '../src/native/objects.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
function graph(events, before = {}) {
  const objects = new NativeObjects();
  objects.register(9001, (record) => ({
    name: record.name,
    message: () => 0,
    ...(before[record.name] ? { beforeDrawChildren: before[record.name] } : {}),
    drawTick(frame, context) {
      events.push(['draw', record.name, frame, context]);
    },
  }));
  return objects;
}
const create = (objects, name, parent = null, options = {}) =>
  objects.create({ kind: 9001, name, parent, ...options });

test('a missing hook adds no await before the original child walk', async () => {
  const events = [],
    objects = graph(events),
    context = {};
  await create(objects, 'root');
  objects.eachChildProvider = () => {
    events.push(['walk']);
  };
  const drawing = objects.drawTick(7, context);
  assert.deepEqual(events, [['walk']]);
  await drawing;
  assert.deepEqual(events, [['walk'], ['draw', 'root', 7, context]]);
  await objects.release(0);
});

test('normal active, pause, detached and destroy/stub qualifications remain unchanged', async () => {
  const events = [],
    before = {};
  for (const name of ['root', 'paused', 'detached', 'destroyed', 'stub', 'stub-child'])
    before[name] = function (frame, context) {
      events.push(['before', this.name, frame, context]);
    };
  const objects = graph(events, before),
    context = { marker: {} };
  try {
    const root = await create(objects, 'root'),
      paused = await create(objects, 'paused', root),
      detached = await create(objects, 'detached', null, { detached: true }),
      destroyed = await create(objects, 'destroyed', null),
      stub = await create(objects, 'stub', null);
    await create(objects, 'stub-child', stub);
    objects.objects.get(paused).userValue = 1;
    await objects.destroy(destroyed);
    objects.objects.get(stub).implementation.runsBaseLogic = false;
    await objects.destroy(stub);
    await objects.drawTick(9, context);
    assert.deepEqual(events, [
      ['before', 'root', 9, context],
      ['before', 'paused', 9, context],
      ['draw', 'paused', 9, context],
      ['draw', 'root', 9, context],
      ['draw', 'stub', 9, context],
    ]);
    assert.equal(objects.objects.get(detached).effectiveFrame, 0);
    assert.equal(objects.objects.get(destroyed).effectiveFrame, 9);
    assert.equal(objects.objects.get(stub).effectiveFrame, 9);
  } finally {
    for (const record of [...objects.objects.values()])
      if (record.parent === null) await objects.release(record.id);
  }
});

for (const profile of profiles) {
  test(`ordinary World ${profile} awaits parent hooks before signed-route children and preserves frame context`, async () => {
    const world = await dataWorld(profile),
      events = [],
      contexts = [],
      entries = [];
    const random = world.random.snapshot(),
      crt = world.effekseer.threads.snapshot();
    try {
      world.objects.register(9001, (record) => ({
        ...world.base(record),
        name: record.name,
        async tick(_frame, context) {
          events.push('logic:' + record.name);
          contexts.push(context);
        },
        async beforeDrawChildren(frame, context) {
          assert.equal(this.name, record.name);
          assert.equal(frame, world.frame);
          assert.equal(world.dispatchContext.executorID(context.executorEntry), 'frame');
          contexts.push(context);
          entries.push(context.executorEntry);
          events.push('before:' + record.name);
          await Promise.resolve();
          assert.equal(world.dispatchContext.executorID(context.executorEntry), 'frame');
        },
        drawTick(_frame, context) {
          events.push('draw:' + record.name);
          contexts.push(context);
        },
        snapshot: () => ({}),
        restore() {},
      }));
      const parent = await world.objects.create({
          kind: 9001,
          parent: world.main.id,
          name: 'parent',
          nativeID: 1000,
        }),
        positive = await world.objects.create({
          kind: 9001,
          parent,
          name: 'positive',
          nativeID: 1001,
        });
      await world.objects.create({ kind: 9001, parent, name: 'negative', nativeID: 0x80000001 });
      await world.objects.create({
        kind: 9001,
        parent: positive,
        name: 'grandchild',
        nativeID: 1002,
      });
      world.objects.objects.get(parent).userValue = 1;
      const baselineFrame = world.frame;
      for (let step = 1; step <= 2; step++) {
        events.length = contexts.length = entries.length = 0;
        await world.tick();
        assert.deepEqual(events, [
          'logic:negative',
          'logic:grandchild',
          'logic:positive',
          'logic:parent',
          'before:parent',
          'before:negative',
          'draw:negative',
          'before:positive',
          'before:grandchild',
          'draw:grandchild',
          'draw:positive',
          'draw:parent',
        ]);
        assert.ok(contexts.every((c) => c === contexts[0]));
        assert.ok(entries.every((entry) => entry === contexts[0].executorEntry));
        assert.equal(world.frame, baselineFrame + step);
        assert.equal(world.objects.objects.get(parent).effectiveFrame, baselineFrame + step);
        assert.throws(() => world.dispatchContext.executorID(entries[0]), /live explicit/);
      }
      assert.deepEqual(world.random.snapshot(), random);
      assert.deepEqual(world.effekseer.threads.snapshot(), crt);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}

test(
  'an awaited hook cannot continue an old record after release and ID reuse',
  { timeout: 2000 },
  async () => {
    const events = [],
      entered = deferred(),
      gate = deferred(),
      context = {};
    const objects = graph(events, {
      old: async function () {
        events.push(['before']);
        entered.resolve();
        await gate.promise;
      },
    });
    let drawing;
    try {
      const old = await create(objects, 'old');
      await create(objects, 'old-child', old);
      drawing = objects.drawTick(3, context);
      await entered.promise;
      await objects.release(old);
      const replacement = await create(objects, 'replacement');
      assert.equal(replacement, old);
      await create(objects, 'new-child', replacement);
      gate.resolve();
      await drawing;
      assert.deepEqual(events, [['before']]);
      await objects.drawTick(4, context);
      assert.deepEqual(events, [
        ['before'],
        ['draw', 'new-child', 4, context],
        ['draw', 'replacement', 4, context],
      ]);
    } finally {
      gate.resolve();
      await drawing;
      await objects.release(0);
    }
  },
);

test('an awaited hook stops while the same record is releasing', { timeout: 2000 }, async () => {
  const events = [],
    entered = deferred(),
    gate = deferred(),
    closeGate = deferred(),
    context = {};
  const objects = graph(events, {
    owner: async function () {
      entered.resolve();
      await gate.promise;
    },
  });
  let drawing, releasing;
  try {
    const owner = await create(objects, 'owner');
    await create(objects, 'child', owner);
    objects.objects.get(owner).implementation.close = () => closeGate.promise;
    drawing = objects.drawTick(5, context);
    await entered.promise;
    releasing = objects.release(owner);
    assert.equal(objects.objects.get(owner).state, 'releasing');
    gate.resolve();
    await drawing;
    assert.deepEqual(events, []);
  } finally {
    gate.resolve();
    closeGate.resolve();
    await drawing;
    await releasing;
  }
});

test(
  'an awaited hook stops children and derived draw after a destroy request',
  { timeout: 2000 },
  async () => {
    const events = [],
      entered = deferred(),
      gate = deferred(),
      context = {};
    const objects = graph(events, {
      owner: async function () {
        entered.resolve();
        await gate.promise;
      },
    });
    let drawing;
    try {
      const owner = await create(objects, 'owner');
      await create(objects, 'child', owner);
      drawing = objects.drawTick(6, context);
      await entered.promise;
      await objects.destroy(owner);
      assert.equal(objects.objects.get(owner).state, 'active');
      assert.equal(objects.objects.get(owner).destroyRequested, true);
      gate.resolve();
      await drawing;
      assert.deepEqual(events, []);
    } finally {
      gate.resolve();
      await drawing;
      await objects.release(0);
    }
  },
);

test(
  'hook rejection propagates while the captured World frameSettled remains a safe point',
  { timeout: 2000 },
  async () => {
    const world = await dataWorld(profiles[1]),
      entered = deferred(),
      gate = deferred(),
      failure = new Error('authored pre-draw rejection'),
      events = [];
    let outcome,
      entry,
      fail = true;
    try {
      world.objects.register(9001, (record) => ({
        ...world.base(record),
        async beforeDrawChildren(_frame, context) {
          entry = context.executorEntry;
          entered.resolve();
          await gate.promise;
          if (fail) throw failure;
        },
        drawTick() {
          events.push('derived');
        },
        snapshot: () => ({}),
        restore() {},
      }));
      const id = await world.objects.create({ kind: 9001, parent: world.main.id });
      const ticking = world.tick();
      outcome = ticking.then(
        () => null,
        (error) => error,
      );
      await entered.promise;
      const captured = world.frameSettled;
      assert.ok(captured instanceof Promise);
      assert.equal(world.running, true);
      assert.equal(world.dispatchContext.executorID(entry), 'frame');
      assert.throws(() => world.snapshot(), /settled frame/);
      await assert.rejects(() => world.tick(), /serialized/);
      await assert.rejects(() => world.close({ flushFiles: false }), /settled frame/);
      gate.resolve();
      await captured;
      assert.equal(world.running, false);
      assert.equal(world.runtime.scheduler.running, false);
      assert.equal(world.frameSettled, null);
      assert.throws(() => world.dispatchContext.executorID(entry), /live explicit/);
      assert.equal(world.snapshot().frame, world.frame);
      assert.equal(await outcome, failure);
      assert.deepEqual(events, []);
      assert.equal(world.objects.objects.get(id).state, 'active');
      fail = false;
      await world.tick();
      assert.deepEqual(events, ['derived']);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      gate.resolve();
      if (outcome) await outcome;
      await world.close({ flushFiles: false });
    }
  },
);

test('actual CatSystem2.render and StageRenderer projection do not enter task hooks', async () => {
  const world = await dataWorld(profiles[1]),
    calls = [],
    frame = { authoredProjection: true };
  let hooks = 0,
    logic = 0,
    draws = 0;
  try {
    world.objects.register(9001, (record) => ({
      ...world.base(record),
      tick() {
        logic++;
      },
      beforeDrawChildren() {
        hooks++;
      },
      drawTick() {
        draws++;
      },
      snapshot: () => ({}),
      restore() {},
    }));
    await world.objects.create({ kind: 9001, parent: world.main.id });
    await world.tick();
    assert.deepEqual([logic, hooks, draws], [1, 1, 1]);
    world.graphics.createLogicalDevice();
    // Authored headless projection providers; the real Engine.render and
    // StageRenderer.render methods run. This is not GPU/pixel evidence.
    const renderer = {
      begin() {
        calls.push('begin');
      },
      present() {
        calls.push('present');
      },
      ctx: {
        reset() {
          calls.push('reset');
        },
        drawImage(value) {
          assert.equal(value, frame);
          calls.push('image');
        },
      },
    };
    world.stageRenderer.renderer = renderer;
    const gpu = {
      graphicsDevice: world.graphics.device,
      get target() {
        return this.activeTarget ?? this.primaryTarget;
      },
      beginFrame() {
        world.graphics.device.requireReady();
        this.drawing = true;
        calls.push('gpu-begin');
      },
      createDepthStencil(width, height, format) {
        calls.push('depth-create');
        return { owner: this, width, height, format, validMask: 0 };
      },
      withRenderTarget(target, callback, { depthStencil } = {}) {
        const previous = this.activeTarget;
        this.activeTarget = target;
        target.depthStencil = depthStencil;
        calls.push('target-enter');
        try {
          return callback();
        } finally {
          this.activeTarget = previous;
          calls.push('target-leave');
        }
      },
      async withRenderTargetAsync(target, callback, { depthStencil } = {}) {
        const previous = this.activeTarget;
        this.activeTarget = target;
        target.depthStencil = depthStencil;
        calls.push('target-enter-async');
        try {
          return await callback();
        } finally {
          this.activeTarget = previous;
          calls.push('target-leave-async');
        }
      },
      clear({ flags, color }) {
        calls.push('clear:' + flags);
        if (flags & 1) {
          this.target.color = color;
          this.target.contentValid = true;
        }
        if (this.target.depthStencil) this.target.depthStencil.validMask |= flags & 6;
      },
      presentTarget(target) {
        assert.equal(target, this.primaryTarget);
        assert.equal(target.contentValid, true);
        assert.equal(target.color, 0xff000000);
        calls.push('gpu-present');
        return frame;
      },
      endNativeFrame() {
        this.drawing = false;
        calls.push('gpu-end');
      },
      destroyDepthStencil(depth) {
        depth.destroyed = true;
      },
      close() {},
    };
    gpu.primaryTarget = {
      owner: gpu,
      width: world.game.width,
      height: world.game.height,
      contentValid: false,
    };
    world.stageRenderer.gpu = gpu;
    const engine = Object.assign(Object.create(CatSystem2.prototype), {
      world,
      stageRenderer: world.stageRenderer,
      renderer,
      nativeFES: new Map(),
      unsupported: new Set(),
      game: world.game,
      nativeProfile: profiles[1],
      onState() {
        calls.push('state');
      },
      audio: { voiceInfo: () => null, context: { state: 'authored' } },
    });
    const before = {
      frame: world.frame,
      clock: world.clock.snapshot(),
      random: world.random.snapshot(),
      crt: world.effekseer.threads.snapshot(),
    };
    await engine.render();
    await engine.render();
    assert.deepEqual([logic, hooks, draws], [1, 1, 1]);
    assert.deepEqual(calls, [
      'gpu-begin',
      'depth-create',
      'target-enter',
      'clear:6',
      'target-leave',
      'target-enter-async',
      'clear:3',
      'reset',
      'gpu-present',
      'image',
      'target-leave-async',
      'gpu-end',
      'present',
      'state',
      'gpu-begin',
      'target-enter-async',
      'clear:3',
      'reset',
      'gpu-present',
      'image',
      'target-leave-async',
      'gpu-end',
      'present',
      'state',
    ]);
    assert.deepEqual(
      {
        frame: world.frame,
        clock: world.clock.snapshot(),
        random: world.random.snapshot(),
        crt: world.effekseer.threads.snapshot(),
      },
      before,
    );
    assert.equal(world.stageRenderer.rendering, false);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world.close({ flushFiles: false });
  }
});
