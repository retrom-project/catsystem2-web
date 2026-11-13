// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { batchEffect, I } from './fixtures/effekseer/batch-authored.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { createEffekseerTask } from '../src/effekseer/task.mjs';
import { lookAtRH } from '../src/effekseer/camera.mjs';
import { createFESTypedObject } from '../src/native/fes-object-factory.mjs';
import { EffekseerManagerLifecycle } from '../src/effekseer/manager-lifecycle.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const PROFILE = 'nekopara-vol3-engine-2.6.1.76';
const SDK = 'sdk-4.01-engine-2.6.1.74';
const png = await readFile(new URL('./fixtures/effekseer-level0/one.png', import.meta.url));
const effect = () =>
  batchEffect({ colorPaths: ['a/one.png', 'b/one.png'], nodes: [{ textureIndex: 0 }] });
const files = () => ({ 'scene.efk': effect(), 'other.efk': effect(), 'one.png': png });
const payload = (values) =>
  new NativeGraphicsPacket(
    values.map((value) => new Uint32Array(new Float32Array([value]).buffer)[0]),
  );
async function setup(options = {}) {
  const world = await dataWorld(
    options.profile ?? PROFILE,
    { ...files(), ...options.files },
    options.world,
  );
  if (options.logical !== false) world.graphics.createLogicalDevice();
  return world;
}
async function create(world) {
  const id = await world.objects.create({ kind: 61, parent: world.main.id, name: 'authored EFK' });
  return world.objects.objects.get(id).implementation;
}
function send(world, task, id, values, executor = world.effekseer.frameExecutor) {
  const context =
    typeof values === 'string'
      ? { payload: { string: () => values } }
      : values
        ? { payload: payload(values) }
        : {};
  return world.withExecutor(executor, (entry) =>
    world.sendEngine(task.record.id, world.main.id, id, 0, 0, { ...context, executorEntry: entry }),
  );
}
function packet(world, task, id, l = 0) {
  const p = [task.record.nativeID, world.main.id, id, 0, l, 0];
  p.senderWorldID = world.main.id;
  return p;
}
const crts = (world) => world.effekseer.threads.snapshot();
const roots = (task) =>
  [...task.manager.sets.values()].map((set) => task.manager.root(set).matrix.slice(9, 12));
const recurrence = (count) => {
  let n = 1n;
  for (let i = 0; i < count; i++) n = (214013n * n + 2531011n) & 0xffffffffn;
  return Number(n);
};

test('default root factory creates real76 kind61;74/raw36/unregistered remain unavailable', async () => {
  const w = await setup();
  const sdk = await setup({ profile: SDK });
  try {
    assert.equal(nativeABI(PROFILE).capabilities.effekseerTask, true);
    assert.equal(nativeABI(SDK).capabilities.effekseerTask, false);
    const names = new NativeGraphicsPacket();
    names.data.set(new TextEncoder().encode('normal root EFK\0'), 4);
    const context = { payload: names };
    await w.sendNativeEngine(0xffffffff, w.main.id, 1, 61, 4, context);
    const task = w.objects.objects.get(context.nativeCreatedTask).implementation;
    assert.ok(task.manager instanceof EffekseerManagerLifecycle);
    assert.equal(task.manager.capacity, 2000);
    assert.equal(task.manager.threads, w.effekseer.threads);
    assert.equal(task.manager.resources, w.effekseer.loads);
    assert.equal(task.manager.freeSlots.length, 2000);
    assert.equal(w.nativeEngine, undefined);
    await assert.rejects(
      sdk.objects.create({ kind: 61, parent: sdk.main.id }),
      /not been implemented/,
    );
    await assert.rejects(createEffekseerTask(sdk, { id: 99 }), /no Effekseer task capability/);
    assert.throws(
      () => nativeABI('unregistered-2.6.1.77'),
      /ABI|profile|Unknown|Unsupported|registered/,
    );
    assert.throws(
      () => createFESTypedObject({ type: 'EFKPLANE', nativeType: 36 }),
      /no registered JavaScript implementation/,
    );
  } finally {
    await w.close({ flushFiles: false });
    await sdk.close({ flushFiles: false });
  }
});

test('realStop/UpdateGC relinquishes drawset ref while currentFILE remains owned', async () => {
  const w = await setup();
  try {
    const task = await create(w);
    await send(w, task, 569, 'scene.efk');
    await send(w, task, 571);
    const load = w.effekseer.loads.get(task.currentEffect);
    await send(w, task, 572);
    for (let i = 0; i < 6; i++) await w.tick();
    assert.equal(task.manager.sets.size, 0);
    assert.deepEqual(
      task.manager.removing.map((m) => m.size),
      [0, 0],
    );
    assert.equal(task.manager.instances.size, 0);
    assert.equal(load.references, 1);
    w.effekseer.validateReferences();
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('pendingFILE blocks unsafeWorld checkpoint/close;direct taskclose retires late load', async () => {
  const w = await setup();
  const gate = Promise.withResolvers(),
    entered = Promise.withResolvers();
  let loading, release;
  try {
    const task = await create(w),
      read = w.game.read.bind(w.game);
    w.game.read = async (name) => {
      if (name === 'scene.efk') {
        entered.resolve();
        await gate.promise;
      }
      return read(name);
    };
    loading = w.sendEngine(task.record.id, w.main.id, 569, 0, 0, {
      payload: { string: () => 'scene.efk' },
    });
    await entered.promise;
    assert.throws(() => w.snapshot(), /settled resource/);
    await assert.rejects(w.close({ flushFiles: false }), /settled resource/);
    assert.equal(w.objects.objects.has(task.record.id), true);
    release = w.objects.release(task.record.id);
    gate.resolve();
    await loading;
    await release;
    assert.equal(task.closed, true);
    assert.equal(w.effekseer.loads.loads.size, 0);
    assert.equal(w.effekseer.loads.resources.textures.size, 0);
    assert.equal(w.effekseer.threads.forThread('frame').calls, 0);
  } finally {
    gate.resolve();
    if (loading) await loading;
    if (release) await release;
    await w.close({ flushFiles: false });
  }
});

test('actual texture release failure remains visible while task/graph/load cleanup continues', async () => {
  const w = await setup(),
    failure = Error('authored texture release failure');
  try {
    const task = await create(w);
    await send(w, task, 569, 'scene.efk');
    await send(w, task, 571);
    let calls = 0;
    // This is an authored host disposal failure, not a replacement resource or manager.
    w.getNativeGPU = () => ({
      releaseTextureFrame() {
        calls++;
        throw failure;
      },
    });
    const contains = (error) =>
      error === failure || (error instanceof AggregateError && error.errors.some(contains));
    await assert.rejects(w.objects.release(task.record.id), contains);
    assert.equal(calls, 1);
    assert.equal(task.closed, true);
    assert.equal(w.graphics.tasks.has(task.record.id), false);
    assert.equal(w.effekseer.loads.loads.size, 0);
    assert.equal(w.effekseer.loads.bindings.size, 0);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('mounted FILE/Play/unload retain old drawsets and distinct load tokens;close/GC retire all refs', async () => {
  const w = await setup();
  try {
    const task = await create(w);
    await send(w, task, 569, 'scene.efk');
    const load = w.effekseer.loads.get(task.currentEffect),
      first = load.textures.color[0],
      second = load.textures.color[1];
    assert.equal(first.frame, second.frame);
    assert.notEqual(first.token, second.token);
    assert.equal(load.references, 1);
    await send(w, task, 571);
    await send(w, task, 571);
    assert.equal(load.references, 3);
    assert.deepEqual([...task.manager.sets.keys()], [0, 1]);
    const tokenCursor = w.effekseer.loads.nextTextureID;
    await send(w, task, 572);
    assert.equal(task.manager.sets.get(0).stop, false);
    assert.equal(task.manager.sets.get(1).stop, true);
    await send(w, task, 570);
    assert.equal(load.references, 2);
    await send(w, task, 572);
    assert.equal(task.manager.sets.get(0).stop, false);
    await send(w, task, 569, 'scene.efk');
    assert.notEqual(task.currentEffect, load.id);
    const replacement = w.effekseer.loads.get(task.currentEffect);
    assert.equal(replacement.textures.color[0].frame, first.frame);
    assert.notEqual(replacement.textures.color[0].token, first.token);
    assert.equal(w.effekseer.loads.nextTextureID, tokenCursor + 2);
    w.effekseer.validateReferences();
    await w.objects.release(task.record.id);
    assert.equal(w.effekseer.loads.loads.size, 0);
    assert.equal(w.effekseer.loads.bindings.size, 0);
    assert.equal(w.effekseer.loads.resources.assets.size, 0);
    assert.equal(w.effekseer.loads.resources.textures.size, 0);
    assert.equal(w.graphics.tasks.has(task.record.id), false);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('569 clears current before missing/invalid replacement;NULL textures get no token', async () => {
  const w = await setup({
    files: {
      'bad.efk': new Uint8Array([1, 2, 3]),
      'missing-texture.efk': batchEffect({ colorPaths: ['absent.png'] }),
    },
  });
  try {
    const task = await create(w);
    await send(w, task, 569, 'scene.efk');
    await send(w, task, 571);
    const old = task.currentEffect;
    await send(w, task, 569, 'absent.efk');
    assert.equal(task.currentEffect, null);
    assert.equal(w.effekseer.loads.get(old).references, 1);
    await assert.rejects(
      send(w, task, 569, 'bad.efk'),
      /Effect|Effekseer|SKFE|header|magic|truncated/i,
    );
    assert.equal(task.currentEffect, null);
    await send(w, task, 569, 'missing-texture.efk');
    assert.equal(w.effekseer.loads.get(task.currentEffect).textures.color[0].token, null);
    await send(w, task, 569, '');
    assert.equal(task.currentEffect, null);
    w.effekseer.validateReferences();
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('two task managers use actual frame/forced entries and actual queue drain,never sender seeds', async () => {
  const w = await setup();
  try {
    const a = await create(w),
      b = await create(w),
      forced = w.effekseer.createExecutor('forced');
    await send(w, a, 569, 'scene.efk');
    await send(w, b, 569, 'scene.efk');
    await send(w, a, 571);
    await send(w, b, 571, undefined, forced);
    const forceCalls = w.effekseer.threads.forThread('forced').calls;
    await w.withExecutor(forced, (entry) =>
      w.objects.send(a.record.id, [w.main.id, 571, 0, 0], { queued: true, executorEntry: entry }),
    );
    await w.tick();
    await w.tick();
    assert.equal(a.manager.sets.size, 2);
    assert.equal(b.manager.sets.size, 1);
    assert.equal(w.effekseer.threads.forThread('forced').calls, forceCalls);
    for (const stream of w.effekseer.threads.threads.values())
      assert.equal(stream.state, recurrence(stream.calls));
    assert.ok(a.manager.instances.size > 2);
    assert.notEqual(a.manager, b.manager);
    const before = crts(w),
      manager = a.manager.snapshot();
    await assert.rejects(w.sendEngine(a.record.id, w.main.id, 571), /live explicit/);
    assert.deepEqual(crts(w), before);
    assert.deepEqual(a.manager.snapshot(), manager);
    w.nativeEngineLoading = Promise.resolve({});
    await assert.rejects(send(w, a, 571), /Mixed native CRT/);
    delete w.nativeEngineLoading;
    assert.deepEqual(crts(w), before);
    assert.equal(w.nativeEngine, undefined);
  } finally {
    delete w.nativeEngineLoading;
    await w.close({ flushFiles: false });
  }
});

test('ctor,51,571 share one position slot;57 updates only camera and child relay remains exact', async () => {
  const w = await setup();
  try {
    const task = await create(w),
      initial = task.position.slice(),
      camera = task.camera.slice();
    assert.notDeepEqual(initial, new Float32Array(3));
    await send(w, task, 569, 'scene.efk');
    await send(w, task, 571);
    await send(w, task, 51, [1, 2, 3]);
    assert.deepEqual(task.camera, camera);
    await send(w, task, 571);
    assert.deepEqual(roots(task), [initial, Float32Array.of(1, 2, 3)]);
    const translated = I.slice();
    translated[12] = 4;
    translated[13] = -2;
    translated[14] = 1;
    const position = task.position;
    await send(w, task, 57, translated);
    const eye = Float32Array.from(initial, (v, i) => Math.fround(v + [4, -2, 1][i]));
    assert.equal(task.position, position);
    assert.deepEqual(task.position, Float32Array.of(1, 2, 3));
    assert.deepEqual(task.camera, lookAtRH(eye, [0, 0, 0], [0, 1, 0]));
    assert.notDeepEqual(task.camera, camera);
    await send(w, task, 571);
    assert.deepEqual(roots(task), [initial, Float32Array.of(1, 2, 3), Float32Array.of(1, 2, 3)]);
    const childID = await w.objects.create({ kind: 2, parent: task.record.id }),
      child = w.graphics.get(childID);
    const seen = [],
      real = child.message.bind(child);
    child.message = async (words, c) => {
      seen.push([words[1], c.executorEntry]);
      return real(words, c);
    };
    const before = task.manager.snapshot(),
      pos = task.position.slice();
    await send(w, task, 55, [0.1, 0.2, 0.3]);
    await send(w, task, 66, [2, 3, 4]);
    assert.deepEqual(
      seen.map(([id]) => id),
      [56, 67],
    );
    assert.ok(seen.every(([, entry]) => entry && Object.getPrototypeOf(entry) === null));
    assert.deepEqual(task.position, pos);
    assert.deepEqual(task.manager.snapshot(), before);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('correct LOST/NOTRESET/pending/ready order precedes real children;render/query never advance', async () => {
  const w = await setup({ logical: false });
  try {
    const task = await create(w),
      seen = [],
      device = w.graphics.device;
    const host = device.attach({ kind: 'logical', validate: () => true, rebuild() {} });
    w.objects.register(9001, (record) => ({
      ...w.base(record),
      message: () => 0,
      drawTick: () => {
        seen.push('child');
      },
      snapshot: () => ({}),
      restore() {},
    }));
    await w.objects.create({ kind: 9001, parent: task.record.id });
    const update = task.manager.update.bind(task.manager),
      lost = task.onLostDevice.bind(task),
      reset = task.onResetDevice.bind(task);
    task.manager.update = (...args) => {
      seen.push(['update', args[0], args[1]]);
      return update(...args);
    };
    task.onLostDevice = () => {
      seen.push('lost');
      lost();
    };
    task.onResetDevice = () => {
      seen.push('reset');
      reset();
    };
    const draw = () =>
      w.withExecutor(w.effekseer.frameExecutor, (entry) =>
        w.objects.drawTick(3, { executorEntry: entry }),
      );
    host.lost();
    await draw();
    assert.deepEqual(seen.splice(0), ['child']);
    host.restored();
    await draw();
    assert.deepEqual(seen.splice(0), ['lost', 'child']);
    assert.equal(task.pendingReset, true);
    await host.rebuild();
    await draw();
    assert.deepEqual(seen.splice(0), ['reset', 'child']);
    await draw();
    assert.deepEqual(seen.splice(0), [['update', 'frame', 1], 'child']);
    await send(w, task, 569, 'scene.efk');
    assert.equal(task.plane.graph.registrationEnabled, false);
    assert.equal(task.plane.drawGPU({}), 0);
    const crt = crts(w),
      snapshot = task.manager.snapshot();
    await w.sendEngine(task.record.id, w.main.id, 47, 0, 1);
    assert.equal(task.queryDraw(), 1);
    assert.throws(() => task.drawGPU(), /current World StageRenderer GPU/);
    assert.throws(() => task.plane.drawGPU({}), /current World StageRenderer GPU/);
    assert.deepEqual(crts(w), crt);
    assert.deepEqual(task.manager.snapshot(), snapshot);
    task.ring.matrix[0] = 17;
    host.lost();
    await draw();
    host.restored();
    await draw();
    await host.rebuild();
    await draw();
    assert.equal(task.ring.matrix[0], 17);
  } finally {
    await w.close({ flushFiles: false });
  }
});

for (const mode of ['throws', 'awaits'])
  test('actual invoke573 writes original output beforeStop even whenStop ' + mode, async () => {
    const w = await setup();
    try {
      const task = await create(w);
      await send(w, task, 569, 'scene.efk');
      await send(w, task, 571);
      const out = { value: 0x12345678 },
        gate = Promise.withResolvers(),
        started = Promise.withResolvers(),
        original = task.manager.stop.bind(task.manager);
      const fail = Error('authored stop failure');
      let entry;
      task.manager.stop = async (handle) => {
        assert.equal(out.value, 0);
        assert.equal(w.dispatchContext.executorID(entry), 'frame');
        started.resolve();
        if (mode === 'throws') throw fail;
        await gate.promise;
        original(handle);
      };
      const call = w.withExecutor(w.effekseer.frameExecutor, async (e) => {
        entry = e;
        const c = { executorEntry: e };
        try {
          return await w.engineMessages.invoke(task.record, packet(w, task, 573), c, out);
        } finally {
          assert.equal(c.executorEntry, e);
          assert.equal(Object.hasOwn(c, 'output'), false);
        }
      });
      if (mode === 'throws') await assert.rejects(call, (e) => e === fail);
      else {
        await started.promise;
        assert.equal(out.value, 0);
        gate.resolve();
        await call;
      }
      assert.equal(out.value, 0);
      assert.equal(Object.values(task).includes(entry), false);
    } finally {
      await w.close({ flushFiles: false });
    }
  });

test('otherkind61 receivers preserve prefilled actual output;direct4word contract unchanged', async () => {
  const w = await setup();
  try {
    const task = await create(w);
    await w.withExecutor(w.effekseer.frameExecutor, async (entry) => {
      for (const id of [569, 571, 572, 19, 51, 55, 66, 57, 59, 63, 570]) {
        const context = {
          executorEntry: entry,
          payload: id === 569 ? { string: () => 'scene.efk' } : payload(id === 57 ? I : [0, 0, 0]),
        };
        const out = { value: 0x12345678 };
        await w.engineMessages.invoke(task.record, packet(w, task, id), context, out);
        assert.equal(out.value, 0x12345678, 'unwritten' + id);
        assert.equal(context.executorEntry, entry);
      }
      assert.equal(
        await w.objects.send(task.record.id, [w.main.id, 573, 0, 0], { executorEntry: entry }),
        0,
      );
    });
    const result = await send(w, task, 571);
    assert.equal(result, NATIVE_UNWRITTEN_WORD);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('true settledWorld fresh adopts aggregate refs/current matrices/RNG withoutPlay orseed replay', async () => {
  const w = await setup();
  let fresh;
  try {
    const task = await create(w);
    await send(w, task, 569, 'scene.efk');
    await send(w, task, 571);
    await send(w, task, 569, 'other.efk');
    await send(w, task, 571);
    await w.tick();
    task.ring.matrix[2] = Math.fround(0.3);
    const saved = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
    fresh = await setup({ world: { initialize: false } });
    await fresh.restore(saved);
    const restored = fresh.objects.objects.get(task.record.id).implementation;
    assert.deepEqual(restored.snapshot(), task.snapshot());
    assert.deepEqual(fresh.effekseer.snapshot(), w.effekseer.snapshot());
    assert.equal(restored.manager.threads, fresh.effekseer.threads);
    assert.equal(restored.manager.resources, fresh.effekseer.loads);
    assert.equal(fresh.nativeEngine, undefined);
    await w.tick();
    await fresh.tick();
    assert.deepEqual(restored.snapshot(), task.snapshot());
    assert.deepEqual(crts(fresh), crts(w));
    assert.equal(
      fresh.withExecutor(fresh.effekseer.frameExecutor, (e) => fresh.effekseer.nextInt(e)),
      w.withExecutor(w.effekseer.frameExecutor, (e) => w.effekseer.nextInt(e)),
    );
  } finally {
    if (fresh) await fresh.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});

test('freshWorld refuses changedEffect and unmatchedlogical refs ratherthanreplaying', async () => {
  const w = await setup();
  let changed, malformed;
  try {
    const task = await create(w);
    await send(w, task, 569, 'scene.efk');
    await send(w, task, 571);
    const saved = w.snapshot();
    changed = await setup({
      files: { 'scene.efk': batchEffect({ nodes: [{ color: [0, 255, 0, 255] }] }) },
      world: { initialize: false },
    });
    await assert.rejects(changed.restore(saved), /identity changed/);
    const bad = structuredClone(saved);
    bad.effekseer.loads.loads[0].references++;
    malformed = await setup({ world: { initialize: false } });
    await assert.rejects(malformed.restore(bad), /reference counts differ/);
  } finally {
    if (changed) await changed.close({ flushFiles: false });
    if (malformed) await malformed.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});
