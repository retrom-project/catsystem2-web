// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESInstance } from '../src/fes/instance.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { parseProgram } from '../src/fes/program.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  fesNotificationMemory,
} from './fixtures/default-fes-world.mjs';

const ascii = (value) => new TextEncoder().encode(value),
  alias = Uint8Array.of(0x81),
  source = Uint8Array.from([
    ...ascii(`#DEFINE
BUTTON choice[2]
CPLANE probe
#OBJECT SIZE COLOR DEFAULT
choice 2,2 0xff112233 DefaultOnly
#START
wait 2
$39=77
break
#NULL
$40=@
break
#.EMPTY
$41=@
probe getid 46
$42=@
break
#NEST
$43=@
break
#DefaultOnly.FOCUS
$44=@
probe getid 47
$45=@
break
#choice.FOCUS
$48=@
break
#`),
    ...alias,
    ...ascii(`.MISSING
$49=@
probe getid 50
$51=@
break
#BUILTIN
probe m2att
$52=99
break
`),
  ]);

const tuple = (context) =>
  context
    ? {
        nameBytes: context.nameBytes.slice(),
        index: context.index,
        current: context.current,
      }
    : null;
const expected = (nameBytes, index) => ({ nameBytes, index, current: index });

async function notify(world, id, label, name = null, index = 0, memory) {
  const packet = memory ?? fesNotificationMemory(label, name, index);
  await world.sendEngine(id, world.main.id, 337, name === null ? 0 : 64, 0, {
    payload: packet,
  });
  assert.equal(packet.stringReads, 0);
  return packet;
}

for (const profile of profiles) {
  test(`normal events own raw context through nested notifications and fresh wait: ${profile}`, async (t) => {
    const world = await defaultFESWorld(profile, { 'screen.fes': source });
    let fresh,
      restoring = false,
      sourceReads = 0;
    try {
      const read = world.game.read;
      t.mock.method(world.game, 'read', function (file, ...args) {
        if (file === 'screen.fes') sourceReads++;
        return read.call(this, file, ...args);
      });
      const { id, instance: root } = await loadDefaultFES(world),
        words = world.runtime.variableBank(world.main, false),
        initial = root.nativeContext,
        system = root.system,
        observed = [],
        command = root.runtime.command,
        asyncContexts = [],
        overrides = [],
        missing = fesNotificationMemory(ascii('MISSING'), alias, -1);
      let phase = '',
        nested = false;
      t.mock.method(root, 'system', function (name) {
        if (name === '@')
          observed.push({ label: root.executingLabel, context: tuple(root.nativeContext) });
        return system.call(this, name);
      });
      t.mock.method(root.runtime, 'command', async function (...args) {
        if (args[0] === 'getid') {
          const entry = root.nativeContext;
          asyncContexts.push([phase, 'before', tuple(entry)]);
          if (phase === 'empty' && !nested) {
            nested = true;
            overrides.push([root.value('@', 0), root.value('@', 19), root.value('@%')]);
            await notify(world, id, ascii('NEST'));
            assert.strictEqual(root.nativeContext, entry);
          }
          if (phase === 'missing') {
            // Mutating the actual packet after its byte read cannot rename the entry.
            missing.bytes(64, 1)[0] = 0x82;
            assert.deepEqual(root.nativeContext.nameBytes, alias);
          }
          const result = await command.apply(this, args);
          assert.strictEqual(root.nativeContext, entry);
          asyncContexts.push([phase, 'after', tuple(root.nativeContext)]);
          return result;
        }
        return command.apply(this, args);
      });

      await world.sendEngine(id, world.main.id, 333);
      const suspended = structuredClone(root.suspended),
        waitFrames = root.waitFrames,
        frame = root.player.frameCount;
      assert.deepEqual(suspended, [['START', 1]]);
      assert.equal(waitFrames, 2);
      await notify(world, id, ascii('NULL'));
      // This is a real NULL-name receiver/handler observation, not a constructor shape test.
      assert.deepEqual(observed, [{ label: 'NULL', context: expected(new Uint8Array(), 0) }]);
      assert.equal(words.get(40), 0);
      assert.deepEqual(tuple(root.nativeContext), expected(new Uint8Array(), 0));
      assert.strictEqual(root.nativeContext, initial);

      observed.length = 0;
      phase = 'empty';
      await notify(world, id, ascii('EMPTY'), new Uint8Array(), -7);
      assert.equal(words.get(41), 0xfffffff9);
      assert.equal(words.get(42), 0xfffffff9);
      assert.equal(words.get(43), 0);
      assert.deepEqual(overrides, [[0, 19, -7]]);
      assert.deepEqual(
        observed.filter(({ label }) => label === 'NEST').map(({ context }) => context),
        [expected(new Uint8Array(), 0)],
      );
      const emptyContexts = observed.filter(({ label }) => label === '.EMPTY');
      assert.equal(emptyContexts.length, 5);
      for (const { context } of emptyContexts)
        assert.deepEqual(context, expected(new Uint8Array(), -7));

      phase = 'ordinary';
      const choice = root.collection.lookup('choice', 1);
      await root.dispatchEvent(choice, 'FOCUS');
      assert.equal(words.get(44), 1);
      assert.equal(words.get(45), 1);
      assert.equal(words.get(48), 1);
      for (const { label, context } of observed.filter(({ label }) =>
        ['DefaultOnly.FOCUS', 'choice.FOCUS'].includes(label),
      )) {
        assert.deepEqual(context, expected(ascii('choice'), 1), label);
      }

      phase = 'missing';
      assert.equal(root.collection.lookup(alias, -1), null);
      await notify(world, id, ascii('MISSING'), alias, -1, missing);
      assert.equal(words.get(49), 0xffffffff);
      assert.equal(words.get(51), 0xffffffff);
      assert.equal(missing.bytes(64, 1)[0], 0x82);
      assert.deepEqual(asyncContexts, [
        ['empty', 'before', expected(new Uint8Array(), -7)],
        ['empty', 'after', expected(new Uint8Array(), -7)],
        ['ordinary', 'before', expected(ascii('choice'), 1)],
        ['ordinary', 'after', expected(ascii('choice'), 1)],
        ['missing', 'before', expected(alias, -1)],
        ['missing', 'after', expected(alias, -1)],
      ]);
      assert.deepEqual(root.suspended, suspended);
      assert.equal(root.waitFrames, waitFrames);
      assert.equal(root.player.frameCount, frame);
      assert.strictEqual(root.nativeContext, initial);
      assert.equal(root.decodePending, false);
      assert.equal(root.player.pending.size, 0);
      assert.equal(sourceReads, 1);

      const bare = new FESInstance(
        'bare-current',
        parseProgram('#START\nbreak\n'),
        new FESPlayer(),
      );
      bare.eventIndex = 13;
      bare.eventObject = { index: 99 };
      assert.equal(bare.value('@'), 13);
      assert.equal(bare.value('@', 0), 0);
      assert.equal(bare.value('@%', 19), 19);

      // Awaited notifications have completed; the outer frame is at its existing wait.
      const savedPlayer = root.player.snapshot(),
        checkpoint = structuredClone(world.snapshot()),
        sources = world.fesSources.snapshot(),
        identities = [...world.objects.objects.values()].map(({ id, kind, parent, creator }) => ({
          id,
          kind,
          parent,
          creator,
        }));
      assert.deepEqual(savedPlayer.root.nativeContext, expected(new Uint8Array(), 0));
      assert.notStrictEqual(savedPlayer.root.nativeContext.nameBytes, initial.nameBytes);
      for (const [prototype, method] of [
        [FESInstance.prototype, 'execute'],
        [FESInstance.prototype, 'expandMacros'],
        [FESCoordinator.prototype, 'initialize'],
      ]) {
        const original = prototype[method];
        t.mock.method(prototype, method, function (...args) {
          assert.equal(restoring, false, 'fresh context must not replay ' + method);
          return original.apply(this, args);
        });
      }
      fresh = await defaultFESWorld(profile, { 'screen.fes': source }, { initialize: false });
      const freshRead = fresh.game.read;
      t.mock.method(fresh.game, 'read', function (file, ...args) {
        assert.notEqual(file, 'screen.fes', 'fresh context must not reopen its source');
        return freshRead.call(this, file, ...args);
      });
      restoring = true;
      await fresh.restore(checkpoint);
      restoring = false;
      const next = fresh.objects.objects.get(id).implementation.player.root;
      assert.deepEqual(tuple(next.nativeContext), expected(new Uint8Array(), 0));
      assert.notStrictEqual(next.nativeContext.nameBytes, savedPlayer.root.nativeContext.nameBytes);
      assert.deepEqual(next.suspended, suspended);
      assert.equal(next.waitFrames, waitFrames);
      assert.deepEqual(fresh.fesSources.snapshot(), sources);
      assert.deepEqual(
        [...fresh.objects.objects.values()].map(({ id, kind, parent, creator }) => ({
          id,
          kind,
          parent,
          creator,
        })),
        identities,
      );
      assert.equal(fresh.runtime.variableBank(fresh.main, false).get(39), 0);
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);

      const invalid = next.player.snapshot();
      delete invalid.root.nativeContext;
      await assert.rejects(next.player.restore(invalid), /Invalid FES native context snapshot/);
      assert.strictEqual(next.player.root, next);
      await assert.rejects(
        notify(fresh, id, ascii('BUILTIN')),
        /Unimplemented FES raw3 command m2att/,
      );
      assert.equal(fresh.runtime.variableBank(fresh.main, false).get(52), 0);
      assert.deepEqual([...next.player.unsupportedCommands], []);
    } finally {
      restoring = false;
      await fresh?.close();
      await world.close();
    }
  });
}
