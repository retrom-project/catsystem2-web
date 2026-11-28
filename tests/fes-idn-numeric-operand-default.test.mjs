// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESInstance } from '../src/fes/instance.mjs';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  expressions = ['known[1]', 'absent', 'known[(++$10)-2]', ''],
  source = ascii(`#DEFINE
VIEW known[2]
IMAGE hit
IMAGE miss
IMAGE negatives[2]
IMAGE empty
#OBJECT IDN
hit known[1],(++$11)
miss absent
negatives known[(++$10)-2]
empty ,
#OBJECT PRI
hit 7
#START
$60=++$60
next IDLE
#IDLE
break
next IDLE
`);

function observe(t) {
  const operands = [],
    lookups = [],
    strings = [],
    operand = FESInstance.prototype.operandValue,
    lookup = FESInstance.prototype.valueLookup,
    value = FESInstance.prototype.value;
  t.mock.method(FESInstance.prototype, 'operandValue', function (bytes) {
    const current = this.nativeContext.current,
      result = operand.call(this, bytes);
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(this.nativeContext.current, current, 'IDN inherits current without replacing it');
    operands.push({ instance: this, bytes: bytes.slice(), result });
    return result;
  });
  t.mock.method(FESInstance.prototype, 'valueLookup', function (nameBytes, index) {
    const result = lookup.call(this, nameBytes, index);
    lookups.push({ instance: this, nameBytes: nameBytes.slice(), index, result });
    return result;
  });
  t.mock.method(FESInstance.prototype, 'value', function (text, ...args) {
    strings.push({ instance: this, text });
    return value.call(this, text, ...args);
  });
  return { operands, lookups, strings };
}
function selectors(instance) {
  const c = instance.collection;
  return [
    c.lookup('hit', 0).idIndex,
    c.lookup('miss', 0).idIndex,
    c.lookup('negatives', 0).idIndex,
    c.lookup('negatives', 1).idIndex,
    c.lookup('empty', 0).idIndex,
  ];
}
for (const profile of profiles) {
  test(`${profile} normal IDN component0 retains raw numeric lookup through fresh restore`, async (t) => {
    const observed = observe(t),
      world = await defaultFESWorld(profile, { 'screen.fes': source });
    let fresh;
    try {
      let sourceReads = 0;
      const read = world.game.read.bind(world.game);
      world.game.read = (name) => {
        if (name === 'screen.fes') sourceReads++;
        return read(name);
      };
      const h = await loadDefaultFES(world);
      await h.task.tick();
      const root = h.instance,
        c = root.collection,
        known = [c.lookup('known', 0), c.lookup('known', 1)],
        expected = [known[1].handle, 0, 0, 0, 0];
      assert.equal(h.task.player.root, root);
      assert.ok(root.runtime);
      assert.equal(known[0].nativeType, 0);
      assert.notEqual(known[0].handle, known[1].handle);
      assert.equal(c.count(ascii('negatives')), 2);
      assert.deepEqual(selectors(root), expected);
      assert.equal(root.global(10), 1, 'The group row evaluates its signed index once');
      assert.equal(root.global(11), 0, 'IDN component0 never evaluates the comma tail');
      assert.equal(root.global(60), 1);
      assert.deepEqual([c.lookup('hit', 0).renderID, c.lookup('hit', 0).pri], [7, 27]);
      const idn = observed.operands.filter(
        (entry) =>
          entry.instance === root &&
          expressions.some(
            (text) =>
              entry.bytes.length === text.length &&
              entry.bytes.every((byte, i) => byte === text.charCodeAt(i)),
          ),
      );
      assert.deepEqual(
        idn.map((entry) => [...entry.bytes]),
        expressions.map((text) => [...ascii(text)]),
      );
      assert.deepEqual(
        idn.map((entry) => entry.result),
        [known[1].handle, 0, 0, 0],
      );
      assert.deepEqual(
        observed.lookups
          .filter((entry) => entry.instance === root)
          .map(({ nameBytes, index, result }) => [[...nameBytes], index, result]),
        [
          [[...ascii('known')], 1, known[1].handle],
          [[...ascii('absent')], 0, 0],
          [[...ascii('known')], -1, 0],
        ],
      );
      assert.ok(observed.strings.some((entry) => entry.instance === root && entry.text === '7'));
      assert.equal(
        observed.strings.some(
          (entry) => entry.instance === root && expressions.slice(0, 3).includes(entry.text),
        ),
        false,
        'Normal IDN does not use the independent String provider',
      );
      const handles = c.objects.map((object) => object.handle),
        tuple = structuredClone(root.nativeContext),
        propertyCalls = observed.operands.length,
        saved = world.snapshot(),
        nextRandom = [world.random.rand(), world.random.frand()];
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const reads = [],
        readFresh = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        reads.push(name);
        if (name !== 'case.kcs') throw new Error('N1 replayed a FES/resource read: ' + name);
        return readFresh(name);
      };
      await fresh.restore(saved);
      const next = fresh.objects.objects.get(h.id).implementation.player.root;
      assert.notEqual(next, root);
      assert.notEqual(next.collection, c);
      assert.deepEqual(
        next.collection.objects.map((object) => object.handle),
        handles,
      );
      assert.deepEqual(selectors(next), expected);
      assert.deepEqual(next.nativeContext, tuple);
      assert.deepEqual([next.global(10), next.global(11), next.global(60)], [1, 0, 1]);
      assert.equal(observed.operands.length, propertyCalls, 'Restore does not reevaluate IDN');
      assert.deepEqual(fresh.random.snapshot(), saved.random);
      assert.deepEqual([fresh.random.rand(), fresh.random.frand()], nextRandom);
      assert.equal(sourceReads, 1);
      assert.deepEqual(reads, ['case.kcs']);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
