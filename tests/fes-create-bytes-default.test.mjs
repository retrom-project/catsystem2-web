// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld } from './fixtures/default-fes-world.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from '../src/fes/types.mjs';
import { createNativeFESTask } from '../src/native/fes-task.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { FESObjectCollection } from '../src/native/fes-object-collection.mjs';
import { createFESTypedObject } from '../src/native/fes-object-factory.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  join = (...parts) => {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let at = 0;
    for (const part of parts) {
      result.set(part, at);
      at += part.length;
    }
    return result;
  },
  aName = Uint8Array.of(114, 0x81),
  bName = Uint8Array.of(114, 0x82),
  literalName = join(aName, ascii('[1]')),
  ref = (nameBytes, index) => ({ nameBytes: nameBytes.slice(), index }),
  expectedRequests = [
    ref(aName, 0),
    ref(aName, 1),
    ref(bName, 0),
    ref(bName, 1),
    ref(literalName, 0),
    ref(aName, 0),
  ];

function source() {
  const parts = [
    ascii(
      '#DEFINE\nBUTTON anchor\n#OBJECT SIZE POS\nanchor 6,4 0,0,0\n#START\n$60=++$60\nlockactive 1\nnext IDLE\n#IDLE\nbreak\nnext IDLE\n',
    ),
  ];
  for (const [name, value] of [
    [aName, 100],
    [bName, 200],
    [literalName, 300],
  ])
    parts.push(ascii('#'), name, ascii('.FOCUS\n$40=' + value + '+@\n$41=++$41\nbreak\n'));
  return join(...parts);
}
function packet(name, count, base = 7) {
  const bytes = new Uint8Array(base + 36),
    view = new DataView(bytes.buffer),
    reads = [];
  let strings = 0;
  bytes.set(name, base);
  view.setUint32(base + 32, count, true);
  const memory = {
    load(address) {
      reads.push(['load', address]);
      return view.getUint32(address, true);
    },
    bytes(address, length) {
      if (address < base || address + length > bytes.length)
        throw new RangeError('338 fixture read is outside its owned packet');
      reads.push(['bytes', address, length]);
      return bytes.subarray(address, address + length);
    },
    string(address) {
      strings++;
      reads.push(['string', address]);
      return new TextDecoder('shift_jis').decode(
        bytes.subarray(address, bytes.indexOf(0, address)),
      );
    },
  };
  return { bytes, memory, reads, base, stringReads: () => strings };
}
const pendingRefs = (collection) =>
  collection.pending.slice(collection.pendingHead).map(({ name, index }) => ref(name.bytes, index));
async function declare(h, name, count, type = 'BUTTON') {
  const data = packet(name, count);
  await h.world.sendEngine(
    h.id,
    h.world.main.id,
    338,
    data.base,
    FES_OBJECT_DEFINITION_ORDER.indexOf(type),
    { payload: data.memory },
  );
  return data;
}
async function open(profile) {
  const world = await defaultFESWorld(profile, { 'screen.fes': source() });
  world.ensureNativeEngine = () => {
    throw new Error('338 bytes must stay JavaScript');
  };
  try {
    const owner = world.main.id,
      parent = world.objects.objects.get(owner),
      id = await world.objects.create({ kind: 34, parent: owner }),
      surface = await world.objects.create({ kind: 15, parent: owner });
    world.runtime.variableBank(parent).initialize(64);
    world.runtime.stringBank(parent);
    await world.sendEngine(surface, owner, 279, 128, 96);
    await world.sendEngine(surface, owner, 283);
    await world.sendEngine(id, owner, 331, 0, parent.context.variableBank);
    await world.sendEngine(id, owner, 334, 0, world.nativeTaskID(surface));
    let sourceReads = 0;
    const read = world.game.read.bind(world.game);
    world.game.read = (name) => {
      if (name === 'screen.fes') sourceReads++;
      return read(name);
    };
    await world.sendEngine(id, owner, 332, 0, 0, { payload: { string: () => 'screen' } });
    await world.sendEngine(id, owner, 333);
    const task = world.objects.objects.get(id).implementation,
      instance = task.player.root;
    return { world, id, task, instance, runtime: instance.runtime, sourceReads: () => sourceReads };
  } catch (error) {
    await world.close();
    throw error;
  }
}

for (const profile of profiles) {
  test(
    '338 raw positive-count names keep independent owners and pending restore: ' + profile,
    async () => {
      const h = await open(profile);
      let fresh;
      try {
        const c = h.instance.collection,
          resourceBase = h.runtime.resources.entries.length,
          packets = [
            await declare(h, aName, 2),
            await declare(h, bName, 2),
            await declare(h, literalName, 1),
            await declare(h, aName, 1),
          ];
        assert.equal(
          c.count(aName),
          2,
          '338 retains the first raw name rather than a decoded alias',
        );
        assert.equal(c.count(bName), 2);
        assert.equal(
          c.count(literalName),
          1,
          'The literal bracket suffix is not parsed as an index',
        );
        const objects = [
            c.lookup(aName, 0),
            c.lookup(aName, 1),
            c.lookup(bName, 0),
            c.lookup(bName, 1),
            c.lookup(literalName, 0),
          ],
          handles = objects.map((o) => o.handle);
        assert.equal(new Set(handles).size, 5);
        assert.equal(objects[0].baseName, objects[2].baseName);
        assert.deepEqual(
          objects.map((o) => c.reference(o)),
          expectedRequests.slice(0, 5),
        );
        assert.deepEqual(pendingRefs(c), expectedRequests);
        assert.equal(
          h.runtime.resources.entries.length,
          resourceBase,
          '338 only queues requested initialization',
        );
        for (const p of packets) {
          assert.deepEqual(p.reads[0], ['load', p.base + 32]);
          assert.equal(p.stringReads(), 0);
          p.bytes[p.base] = 122;
        }
        assert.equal(c.count(aName), 2, 'The collection owns its name bytes');
        objects.forEach((object, index) =>
          Object.assign(object, {
            width: 6,
            height: 4,
            x: 10 + index * 15,
            y: 20,
            z: 0,
            disp: true,
            displayValue: 1,
            dirty: true,
            sizeDirty: true,
          }),
        );
        await h.runtime.initializeResources();
        await h.runtime.resources.traverse();
        assert.deepEqual(
          h.runtime.resources.entries
            .slice(resourceBase)
            .map((entry) => ref(entry.nameBytes, entry.index)),
          expectedRequests,
        );
        assert.deepEqual(pendingRefs(c), []);
        for (const object of objects) {
          const child = h.world.objects.objects.get(object.nativeInputTaskID);
          assert.equal(child.kind, 6);
          assert.equal(child.parent, h.id);
        }
        await declare(h, aName, 1);
        const expectedPending = [ref(aName, 0)];
        assert.deepEqual(pendingRefs(c), expectedPending);
        const savedResources = h.runtime.resources.entries.length,
          savedWorldObjects = h.world.objects.objects.size,
          savedSemanticObjects = c.objects.length,
          saved = h.world.snapshot();
        fresh = await defaultFESWorld(profile, {}, { initialize: false });
        fresh.ensureNativeEngine = () => {
          throw new Error('338 restore must stay JavaScript');
        };
        const reads = [],
          read = fresh.game.read.bind(fresh.game);
        fresh.game.read = (name) => {
          reads.push(name);
          if (name !== 'case.kcs') throw new Error('338 source replayed ' + name);
          return read(name);
        };
        await fresh.restore(saved);
        const task = fresh.objects.objects.get(h.id).implementation,
          next = task.player.root,
          runtime = next.runtime,
          restored = next.collection,
          restoredObjects = expectedRequests
            .slice(0, 5)
            .map((r) => restored.lookup(r.nameBytes, r.index));
        assert.equal(runtime.resources.entries.length, savedResources);
        assert.equal(
          fresh.objects.objects.size,
          savedWorldObjects,
          'Restore does not allocate pending children',
        );
        assert.equal(restored.objects.length, savedSemanticObjects);
        assert.deepEqual(
          restoredObjects.map((object) => object.handle),
          handles,
        );
        assert.deepEqual(pendingRefs(restored), expectedPending);
        assert.deepEqual(
          [restored.count(aName), restored.count(bName), restored.count(literalName)],
          [2, 2, 1],
        );
        assert.deepEqual(reads, ['case.kcs']);
        assert.equal(next.global(60), 1);
        await fresh.sendEngine(h.id, fresh.main.id, 333);
        assert.deepEqual(pendingRefs(restored), []);
        assert.equal(runtime.resources.entries.length, savedResources + 1);
        assert.equal(
          fresh.objects.objects.size,
          savedWorldObjects + 1,
          'One pending request makes one real child',
        );
        assert.equal(restored.objects.length, savedSemanticObjects);
        for (const [at, value, index] of [
          [1, 100, 1],
          [2, 200, 0],
          [4, 300, 0],
        ]) {
          const object = restoredObjects[at],
            child = fresh.objects.objects.get(object.nativeInputTaskID);
          assert.equal(child.kind, 6);
          assert.equal(child.parent, h.id);
          await fresh.sendEngine(h.id, fresh.main.id, 64, fresh.nativeTaskID(child.id), 1);
          assert.equal(
            next.global(40),
            value + index,
            'Raw own label and actual current index remain separate',
          );
        }
        assert.deepEqual(reads, ['case.kcs']);
        assert.equal(next.global(60), 1);
        assert.equal(h.sourceReads(), 1);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await h.world.close();
      }
    },
  );
}

test('338 reads the count slot before raw NUL names with zero-base sender memory', async () => {
  const collection = new FESObjectCollection({
      create: (identity) => createFESTypedObject(identity),
    }),
    record = { id: 7, parent: null, context: {} },
    world = { base: () => ({ message: async () => NATIVE_UNWRITTEN_WORD }) },
    task = createNativeFESTask(world, record),
    runtime = { collection };
  task.player = {
    root: {
      createObjects: (...args) => FESCoordinator.prototype.createObjects.call(runtime, ...args),
    },
  };
  const name = new Uint8Array(31).fill(120),
    data = packet(name, 2, 0);
  assert.equal(await task.message([1, 338, 0, 5], { payload: data.memory }), NATIVE_UNWRITTEN_WORD);
  assert.deepEqual(
    data.reads[0],
    ['load', 32],
    'The original fixed count slot is read before the NUL name',
  );
  assert.equal(data.stringReads(), 0);
  assert.deepEqual(
    data.reads.slice(1),
    Array.from({ length: 32 }, (_, at) => ['bytes', at, 1]),
  );
  assert.equal(collection.count(name), 2);
  assert.deepEqual(collection.reference(collection.lookup(name, 1)), ref(name, 1));
  const before = collection.objects.length;
  await assert.rejects(task.message([1, 338, 0, 999], { payload: data.memory }), /factory index/);
  assert.equal(collection.objects.length, before);
  data.bytes[31] = 120;
  await assert.rejects(
    task.message([1, 338, 0, 5], { payload: data.memory }),
    /31-byte CP932 boundary/,
  );
  assert.equal(collection.objects.length, before);
  assert.equal(data.stringReads(), 0);
});
