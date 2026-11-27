// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { HTTPFile } from '../src/files.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeSceneData } from '../src/native/scene-data.mjs';
import { M2Owner } from '../src/native/emote-owner.mjs';
import { EmoteDocument, EMOTE_PREPARATION_LIMITS } from '../src/emote/document.mjs';
import { emotePSBFixture } from './fixtures/emote-psb-fixture.mjs';
import { componentChild, runPreparedComponents } from './fixtures/prepared-worker-component.mjs';

if (!componentChild) {
  test('eight prepared-job component groups use an explicit isolated transport stub', (t) =>
    runPreparedComponents(import.meta.url, null, t));
} else {
  const turn = () => new Promise(setImmediate);
  const originalSelf = globalThis.self;
  globalThis.self = {};
  const { buildPreparedEmoteAtlas } = await import('../src/emote/psz-worker.mjs');
  const workerEntry = globalThis.self.onmessage;
  if (originalSelf === undefined) delete globalThis.self;
  else globalThis.self = originalSelf;

  async function workerMessage(data) {
    const before = globalThis.self,
      replies = [];
    globalThis.self = { postMessage: (...args) => replies.push(args) };
    try {
      await workerEntry({ data });
      assert.equal(replies.length, 1);
      return replies[0];
    } finally {
      if (before === undefined) delete globalThis.self;
      else globalThis.self = before;
    }
  }

  function sceneFile(blocks) {
    const text = [],
      offsets = [],
      lines = blocks.flat(),
      table = new Uint32Array(4 + blocks.length * 2 + lines.length);
    for (const line of lines) {
      offsets.push(text.length);
      text.push(1, 0x30, ...encodeCP932(line), 0);
    }
    const body = new Uint8Array(table.byteLength + text.length),
      view = new DataView(body.buffer);
    [body.length - 16, blocks.length, blocks.length * 8, table.byteLength - 16].forEach(
      (value, at) => view.setUint32(at * 4, value, true),
    );
    let start = 0;
    blocks.forEach((block, at) => {
      view.setUint32(16 + at * 8, block.length, true);
      view.setUint32(20 + at * 8, start, true);
      start += block.length;
    });
    offsets.forEach((offset, at) => view.setUint32(16 + blocks.length * 8 + at * 4, offset, true));
    body.set(text, table.byteLength);
    const file = new Uint8Array(16 + body.length);
    file.set(new TextEncoder().encode('CatScene'));
    new DataView(file.buffer).setUint32(12, body.length, true);
    file.set(body, 16);
    return file;
  }

  async function fixture(t, { resident = true, length = 8 * 1024 * 1024 } = {}) {
    const before = globalThis.Worker,
      requests = [],
      sceneBytes = sceneFile([
        ['mpl 4 sample,1,pose'],
        ['mpl 2', 'mpl 4 sample,1,pose'],
        ['mpl 2', 'mpl 4 sample,1,pose', 'mpl 5 sample,2,pose'],
      ]),
      scene = new NativeSceneData(),
      backing = new Uint8Array(1024 * 1024),
      packed = backing.subarray(17, 17 + 16 + 65536),
      files = {
        active: new HTTPFile('http://localhost/scene', sceneBytes.length, 0),
        model: new HTTPFile('http://localhost/model', packed.length, 0),
      },
      reads = [];
    packed.set([80, 83, 90, 0]);
    new DataView(packed.buffer, packed.byteOffset).setUint32(4, 65536, true);
    new DataView(packed.buffer, packed.byteOffset).setUint32(8, length, true);
    globalThis.Worker = class {
      postMessage(data, transfer) {
        requests.push({ worker: this, data: structuredClone(data, { transfer }) });
      }
      terminate() {
        this.terminated = true;
      }
    };
    t.after(() => {
      if (before === undefined) delete globalThis.Worker;
      else globalThis.Worker = before;
    });
    await scene.reader.load(sceneBytes);
    scene.history.appendPath('active', 1);
    const world = {
        profile: 'nekopara-vol3-engine-2.6.1.76',
        fesConfiguration: {},
        stageRenderer: { gpu: null },
        runtime: { handles: { records: new Map([[1, { type: 'scene-data', value: scene }]]) } },
        resourceCache: { pending: 0, entries: [] },
        game: {
          resolveCategory: (name) => name,
          nativeCandidates(name) {
            const file = files[name];
            return file ? [{ hit: { file, offset: 0, size: file.size } }] : [];
          },
          async requireCategory(name, category) {
            reads.push([name, category]);
            return name === 'active' ? sceneBytes : packed;
          },
        },
      },
      owner = new M2Owner(world),
      live = { document: await EmoteDocument.open(emotePSBFixture()) },
      preparation = owner.scenePreparation;
    live.promise = Promise.resolve(live.document);
    owner.initialized = true;
    owner.profiles = {
      profileFiles: { sample: 'profile' },
      profile: () => ({ bodies: { 1: 'model', 2: 'other' } }),
    };
    if (resident) owner.documents.set('model', live);
    t.after(() => preparation.discard());
    const finish = (request = requests.at(-1), result) => {
      const expanded = result ?? new Uint8Array(length);
      if (!result) expanded.set(emotePSBFixture());
      request.worker.onmessage?.({
        data: structuredClone({ expanded }, { transfer: [expanded.buffer] }),
      });
    };
    const consume = (bytes = packed) => {
      const record = { document: null };
      preparation.beginDocument('model', record);
      owner.documents.set('model', record);
      return preparation.take('model', bytes, record);
    };
    return { owner, live, scene, packed, files, requests, reads, preparation, finish, consume };
  }

  test('resident pose hints stay ordinary; an empty-program hint prepares a fresh independent document', async (t) => {
    const f = await fixture(t);
    f.scene.history.path.at(-1).value = 0;
    f.preparation.resume();
    await turn();
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.reads.splice(0), [['active', 'scene']]);
    f.scene.history.path.at(-1).value = 1;
    f.preparation.resume();
    await turn();
    assert.equal(f.requests.length, 1);
    f.finish();
    await turn();
    const input = f.packed.slice();
    f.packed.fill(0);
    f.owner.release({ document: f.live.document, pose: { model: 'model' } });
    assert.equal(f.owner.documents.size, 0);
    let consumerReads = 0;
    f.owner.world.game.requireCategory = async () => {
      consumerReads++;
      return input;
    };
    const oldBytes = f.live.document.psb.b.bytes.slice(),
      first = await f.owner.document('model'),
      fresh = await EmoteDocument.open(emotePSBFixture());
    assert.equal(consumerReads, 1);
    assert.equal(
      f.reads.filter(([name]) => name === 'model').length,
      1,
      'one separate job pre-read',
    );
    assert.notEqual(first, f.live.document);
    assert.deepEqual(first.texture('tex'), fresh.texture('tex'));
    first.psb.b.bytes.fill(0);
    assert.deepEqual(f.live.document.psb.b.bytes, oldBytes);
    assert.deepEqual(fresh.texture('tex').rgba, first.texture('tex').rgba);
    assert.equal(f.preparation.take('model'), null);
    assert.equal(f.requests[0].worker.terminated, true);
  });

  test('generation, map and mounted backing replacement invalidate a completed result', async (t) => {
    const f = await fixture(t);
    for (const change of [
      () => f.owner.documents.set('model', { document: {} }),
      () => (f.owner.documents = new Map()),
      () => (f.files.model.url += '-changed'),
      () => (f.owner.world.resourceCache.pending = 1),
      () => f.owner.world.resourceCache.entries.push({ filename: 'MODEL' }),
    ]) {
      f.owner.documents = new Map([['model', f.live]]);
      f.owner.world.resourceCache.pending = 0;
      f.owner.world.resourceCache.entries.length = 0;
      f.preparation.resume();
      await turn();
      f.finish();
      await turn();
      change();
      assert.equal(f.consume(), null);
    }
    f.owner.documents = new Map([['model', f.live]]);
    f.owner.world.resourceCache.entries.length = 0;
    f.preparation.resume();
    await turn();
    f.finish();
    await turn();
    const consumer = { document: null };
    f.preparation.beginDocument('model', consumer);
    f.owner.documents.set('model', consumer);
    f.owner.documents.set('model', { document: {} });
    assert.equal(f.preparation.take('model', f.packed, consumer), null);
  });

  test('immediate consumption and branch/close cancellation never wait or accept a late worker result', async (t) => {
    const f = await fixture(t);
    f.preparation.resume();
    await turn();
    const first = f.requests[0];
    assert.equal(f.consume(), null);
    f.finish(first);
    await turn();
    assert.equal(first.worker.terminated, true);
    assert.equal(f.consume(), null);
    f.preparation.resume();
    await turn();
    f.scene.history.path = structuredClone(f.scene.history.path);
    f.finish();
    await turn();
    assert.equal(f.consume(), null);
    f.preparation.resume();
    await turn();
    f.owner.world.disposalRequested = true;
    f.preparation.discard();
    f.finish();
    await turn();
    assert.equal(f.consume(), null);
    assert(f.requests.every(({ worker }) => worker.terminated));
  });

  test('ambiguous declarations, foreign Map ports and an oversized header do no model preparation', async (t) => {
    const f = await fixture(t);
    f.scene.history.path.at(-1).value = 2;
    f.preparation.resume();
    await turn();
    assert.equal(f.requests.length, 0);
    f.scene.history.path.at(-1).value = 1;
    let getterCalls = 0;
    Object.defineProperty(f.owner.documents, 'get', {
      configurable: true,
      get() {
        getterCalls++;
        throw new Error('Unknown Map port');
      },
    });
    f.preparation.resume();
    await turn();
    assert.equal(f.requests.length, 0);
    assert.equal(getterCalls, 0);
    delete f.owner.documents.get;
    f.preparation.discard();
    new DataView(f.packed.buffer, f.packed.byteOffset).setUint32(
      8,
      EMOTE_PREPARATION_LIMITS.expandedBytes + 1,
      true,
    );
    f.preparation.resume();
    await turn();
    assert.equal(f.requests.length, 0);
  });

  test('worker enforces declared and actual output budgets with small streams and preserves errors', async (t) => {
    const before = globalThis.DecompressionStream;
    let constructions = 0;
    globalThis.DecompressionStream = class {
      constructor() {
        constructions++;
        return new TransformStream({
          transform(_chunk, controller) {
            controller.enqueue(Uint8Array.of(1, 2, 3));
          },
        });
      }
    };
    t.after(() => (globalThis.DecompressionStream = before));
    for (const length of [-1, EMOTE_PREPARATION_LIMITS.expandedBytes + 1])
      assert.deepEqual(await workerMessage({ bytes: Uint8Array.of(1), length }), [null]);
    assert.equal(constructions, 0);
    assert.deepEqual(await workerMessage({ bytes: Uint8Array.of(1), length: 2 }), [null]);
    assert.equal(constructions, 1);
    assert.deepEqual(await workerMessage({ bytes: Uint8Array.of(1), length: 4 }), [null]);
    const [valid, transfer] = await workerMessage({ bytes: Uint8Array.of(1), length: 3 });
    assert.deepEqual(valid.expanded, Uint8Array.of(1, 2, 3));
    assert.equal(valid.atlas, null);
    assert.deepEqual(transfer, [valid.expanded.buffer]);
  });

  test('worker streams remain exact for abort-independent malformed, trailing and valid PSB inputs', async () => {
    const expanded = emotePSBFixture(),
      compressed = new Uint8Array(deflateSync(expanded));
    for (const input of [compressed.subarray(0, -1), Uint8Array.from([...compressed, 0])])
      assert.deepEqual(await workerMessage({ bytes: input, length: expanded.length }), [null]);
    const [result, transfer] = await workerMessage({ bytes: compressed, length: expanded.length });
    assert.deepEqual(result.expanded, expanded);
    const ordinary = await EmoteDocument.open(expanded);
    assert.deepEqual(result.atlas.texture, ordinary.texture('tex'));
    assert.deepEqual(transfer, [result.expanded.buffer, result.atlas.texture.rgba.buffer]);
  });

  test('expanded-only admission skips PSB/atlas construction above the unchanged atlas budget', () => {
    let reads = 0;
    const expanded = new Proxy(
      {},
      {
        get(_target, key) {
          reads++;
          assert.equal(key, 'length');
          return EMOTE_PREPARATION_LIMITS.atlasWorkingBytes + 1;
        },
      },
    );
    assert.equal(buildPreparedEmoteAtlas(expanded), null);
    assert.equal(reads, 1);
    assert.equal(EMOTE_PREPARATION_LIMITS.expandedBytes, 72 * 1024 * 1024);
    assert.equal(EMOTE_PREPARATION_LIMITS.packedBytes, 8 * 1024 * 1024);
  });

  test('consumer reads retain replacement, thenable, reentry and error semantics; foreign output stays ordinary', async (t) => {
    const f = await fixture(t);
    const game = f.owner.world.game,
      requireCategory = game.requireCategory,
      nativeCandidates = game.nativeCandidates,
      raw = emotePSBFixture(),
      reset = async (result) => {
        f.preparation.discard();
        Object.defineProperty(game, 'requireCategory', {
          value: requireCategory,
          configurable: true,
          enumerable: true,
          writable: true,
        });
        game.nativeCandidates = nativeCandidates;
        f.owner.documents.set('model', f.live);
        f.packed.fill(0);
        f.packed.set([80, 83, 90, 0]);
        const view = new DataView(f.packed.buffer, f.packed.byteOffset);
        view.setUint32(4, 65536, true);
        view.setUint32(8, 8 * 1024 * 1024, true);
        f.preparation.resume();
        await turn();
        f.finish(undefined, result);
        await turn();
        f.owner.release({ document: f.live.document, pose: { model: 'model' } });
      };

    await reset();
    f.packed.fill(0);
    f.packed.set(raw);
    let result = await f.owner.document('model');
    assert.equal(
      result.psb.b.bytes.buffer,
      f.packed.buffer,
      'same backing changed: original parse',
    );

    await reset();
    const failure = new Error('opaque original read failure');
    let reads = 0;
    game.requireCategory = () => {
      reads++;
      throw failure;
    };
    await assert.rejects(f.owner.document('model'), (error) => error === failure);
    assert.equal(reads, 1);
    assert.equal(f.owner.documents.has('model'), false);
    assert.equal(f.preparation.take('model'), null);

    await reset();
    let getters = 0,
      thens = 0,
      reentrant;
    reads = 0;
    const provider = () => {
      reads++;
      return {
        then(resolve) {
          thens++;
          reentrant = f.owner.document('model');
          resolve(raw);
        },
      };
    };
    Object.defineProperty(game, 'requireCategory', {
      configurable: true,
      get() {
        getters++;
        return provider;
      },
    });
    const first = f.owner.document('model'),
      second = f.owner.document('model');
    result = await first;
    assert.equal(await second, result);
    assert.equal(await reentrant, result);
    assert.deepEqual([reads, getters, thens], [1, 2, 1]);

    await reset();
    delete game.requireCategory;
    reads = 0;
    game.require = () => {
      reads++;
      return raw;
    };
    assert.deepEqual((await f.owner.document('model')).texture('tex'), result.texture('tex'));
    assert.equal(reads, 1);

    await reset();
    let unknownReads = 0;
    const opaque = new Proxy(raw, {
      get(target, key) {
        if (key === 'buffer') {
          unknownReads++;
          throw failure;
        }
        return Reflect.get(target, key);
      },
    });
    await assert.rejects(EmoteDocument.open(opaque), (error) => error === failure);
    const expectedReads = unknownReads;
    unknownReads = 0;
    game.requireCategory = () => opaque;
    await assert.rejects(f.owner.document('model'), (error) => error === failure);
    assert.equal(unknownReads, expectedReads);

    await reset();
    game.nativeCandidates = (name, ...args) => {
      if (name === 'model') {
        f.packed.fill(0);
        f.packed.set(raw);
      }
      return nativeCandidates(name, ...args);
    };
    result = await f.owner.document('model');
    assert.equal(
      result.psb.b.bytes.buffer,
      f.packed.buffer,
      'lookup mutation precedes final compare',
    );

    const foreign = new Uint8Array(8 * 1024 * 1024 + 1).subarray(1);
    await reset(foreign);
    f.packed.fill(0);
    f.packed.set(raw);
    result = await f.owner.document('model');
    assert.equal(
      result.psb.b.bytes.buffer,
      f.packed.buffer,
      'foreign expanded backing is discarded',
    );
  });
}
