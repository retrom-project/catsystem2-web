// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  fesNotificationMemory,
} from './fixtures/default-fes-world.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  join = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part])),
  aName = Uint8Array.of(0x81),
  bName = Uint8Array.of(0x82),
  knownName = ascii('known'),
  quoteName = ascii('q"v'),
  ref = (nameBytes, index) => ({ nameBytes: nameBytes.slice(), index }),
  source = ascii(`#DEFINE
BUTTON anchor
#OBJECT POS SIZE
anchor 6,8,0 4,4
#START
$60=++$60
lockactive 1
next IDLE
#IDLE
break
next IDLE
#PROBE
anchor pos known[0] known[(++$10)-1] absent
anchor getpos 40 41 42
break
`);

async function rejectExpression(t, h, bytes, diagnostic) {
  const root = h.instance,
    read = root.argumentBytes;
  let getters = 0;
  root.setGlobal(12, 0);
  root.argumentBytes = function (token) {
    if (token === bytes) getters++;
    return read.call(this, token);
  };
  try {
    let caught;
    try {
      await root.runtime.command(
        'pri',
        root.collection.reference(root.collection.lookup('anchor', 0)),
        [bytes],
      );
    } catch (error) {
      caught = error;
    }
    if (!caught)
      t.diagnostic(
        JSON.stringify({
          unexpectedAcceptedOperand: [...bytes],
          expressionMutation: root.global(12),
          priority: root.collection.lookup('anchor', 0).pri,
        }),
      );
    assert.match(caught?.message ?? '', diagnostic);
    assert.equal(getters, 1, 'This argument uses the existing raw getter once');
    assert.equal(root.global(12), 0, 'No AST mutation from the rejected expression executes');
  } finally {
    root.argumentBytes = read;
  }
}
function observe(t, root) {
  const values = [],
    lookups = [],
    run = root.operandValue,
    lookup = root.valueLookup;
  assert.equal(typeof run, 'function');
  assert.equal(typeof lookup, 'function');
  t.mock.method(root, 'operandValue', function (bytes) {
    assert.ok(bytes instanceof Uint8Array);
    const result = run.call(this, bytes);
    values.push({ bytes: bytes.slice(), result });
    return result;
  });
  t.mock.method(root, 'valueLookup', function (nameBytes, index) {
    assert.ok(nameBytes instanceof Uint8Array, 'Object lookup never receives presentation Strings');
    lookups.push(ref(nameBytes, index));
    return lookup.call(this, nameBytes, index);
  });
  return { values, lookups };
}
async function number(root, observed, bytes) {
  const before = observed.values.length;
  await root.runtime.command(
    'pri',
    root.collection.reference(root.collection.lookup('anchor', 0)),
    [bytes],
  );
  assert.equal(observed.values.length, before + 1);
  assert.deepEqual(observed.values.at(-1).bytes, bytes);
  return observed.values.at(-1).result;
}
async function probe(world, id) {
  const memory = fesNotificationMemory(ascii('PROBE'));
  await world.sendEngine(id, world.main.id, 337, 0, 0, { payload: memory });
  assert.equal(memory.stringReads, 0);
}
for (const profile of profiles) {
  test(
    'common numeric operands retain raw lookup and bounded literal domains through fresh restore: ' +
      profile,
    async (t) => {
      const world = await defaultFESWorld(profile, { 'screen.fes': source });
      let fresh;
      world.ensureNativeEngine = () => {
        throw new Error('N0 must stay JavaScript');
      };
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
          known = c.create('VIEW', knownName, 2, { enqueue: false }),
          a = c.create('VIEW', aName, 1, { enqueue: false })[0],
          b = c.create('VIEW', bName, 1, { enqueue: false })[0],
          decoy = c.create('VIEW', ascii('?'), 1, { enqueue: false })[0],
          quoted = c.create('VIEW', quoteName, 1, { enqueue: false })[0];
        assert.equal(a.baseName, b.baseName);
        assert.notEqual(a.handle, b.handle);
        assert.notEqual(a.handle, decoy.handle);
        assert.deepEqual(c.reference(a), ref(aName, 0));
        assert.deepEqual(c.reference(b), ref(bName, 0));
        // These are actual collection owner data, not DEFINE or extra native-factory admission.
        for (const raw of [aName, bName])
          await rejectExpression(
            t,
            h,
            join(ascii('(++$12)+'), raw),
            /Unsupported FES numeric name byte/,
          );
        for (const raw of [aName, Uint8Array.of(0x81, 0x5c)])
          await rejectExpression(
            t,
            h,
            join(ascii('(++$12)+"'), raw, ascii('"')),
            /Unproved FES double-quote literal domain/,
          );
        const observed = observe(t, root);
        assert.equal(root.macro, undefined, 'Normal instances have no expression macro callback');
        assert.equal(await number(root, observed, ascii('known[0]')), known[0].handle);
        assert.equal(await number(root, observed, ascii('known[1]')), known[1].handle);
        root.setGlobal(11, 0);
        assert.equal(await number(root, observed, ascii('known[(++$11)-2]')), 0);
        assert.equal(root.global(11), 1);
        assert.deepEqual(observed.lookups.at(-1), ref(knownName, -1));
        assert.equal(await number(root, observed, ascii('known[-2147483648]')), 0);
        assert.deepEqual(observed.lookups.at(-1), ref(knownName, -0x80000000));
        assert.equal(await number(root, observed, ascii('absent')), 0);
        assert.equal(
          await number(root, observed, join(ascii('q'), Uint8Array.of(92, 34), ascii('v[0]'))),
          quoted.handle,
        );
        const beforeLiteralLookups = observed.lookups.length;
        for (const [bytes, expected] of [
          [ascii("''"), 0],
          [ascii("'A'"), 0x4100],
          [ascii("'AB'"), 0x4200],
          [Uint8Array.of(39, 0x81, 39), 0x8100],
          [Uint8Array.of(39, 92, 39, 39), 0x2700],
          [Uint8Array.of(39, 92, 92, 39), 0x5c00],
          [ascii('"known"'), 0],
          [Uint8Array.of(34, 97, 92, 34, 98, 34), 0],
        ])
          assert.equal(await number(root, observed, bytes), expected);
        assert.equal(
          observed.lookups.length,
          beforeLiteralLookups,
          'Literal values never become object lookups',
        );
        const context = structuredClone(root.nativeContext);
        assert.equal(await number(root, observed, ascii('@+2')), (context.current + 2) | 0);
        assert.deepEqual(root.nativeContext, context, 'N0 does not replace H1 current ownership');
        assert.equal(await number(root, observed, ascii('7%3')), 1);
        assert.equal(
          root.value('@+5%', 10),
          15,
          'Prepared property/String percent semantics stay independent',
        );
        const from = observed.lookups.length;
        root.setGlobal(10, 0);
        await probe(world, h.id);
        assert.deepEqual(
          [root.global(40), root.global(41), root.global(42)],
          [known[0].handle, known[0].handle, 0],
        );
        assert.equal(root.global(10), 1);
        assert.deepEqual(observed.lookups.slice(from), [
          ref(knownName, 0),
          ref(knownName, 0),
          ref(ascii('absent'), 0),
        ]);
        const handles = c.objects.map((o) => o.handle),
          tuple = structuredClone(root.nativeContext),
          saved = world.snapshot();
        fresh = await defaultFESWorld(profile, {}, { initialize: false });
        fresh.ensureNativeEngine = () => {
          throw new Error('N0 restore must stay JavaScript');
        };
        const reads = [],
          readFresh = fresh.game.read.bind(fresh.game);
        fresh.game.read = (name) => {
          reads.push(name);
          if (name !== 'case.kcs') throw new Error('N0 source replayed ' + name);
          return readFresh(name);
        };
        await fresh.restore(saved);
        const next = fresh.objects.objects.get(h.id).implementation.player.root,
          nextObserved = observe(t, next);
        assert.deepEqual(
          next.collection.objects.map((o) => o.handle),
          handles,
        );
        assert.deepEqual(next.nativeContext, tuple);
        assert.deepEqual(
          next.collection.reference(next.collection.lookup(aName, 0)),
          ref(aName, 0),
        );
        assert.deepEqual(
          next.collection.reference(next.collection.lookup(bName, 0)),
          ref(bName, 0),
        );
        assert.equal(await number(next, nextObserved, ascii('known[1]')), known[1].handle);
        next.setGlobal(10, 0);
        await probe(fresh, h.id);
        assert.deepEqual(
          [next.global(40), next.global(41), next.global(42)],
          [known[0].handle, known[0].handle, 0],
        );
        assert.equal(next.global(10), 1);
        assert.equal(next.global(60), 1);
        assert.equal(sourceReads, 1);
        assert.deepEqual(reads, ['case.kcs']);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await world.close();
      }
    },
  );
}
