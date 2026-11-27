// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { modernParticleMessageWorld } from './modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../../src/checkpoint.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const token = (name) => 0xf0000000 + Number(name.slice(7));
function contextState(context) {
  return Object.fromEntries(
    ['eventWords', 'choices', 'results', 'lastEvent', 'pendingEvent', 'pendingWords'].map((key) => [
      key,
      Array.isArray(context[key]) ? context[key].map((word) => word >>> 0) : context[key],
    ]),
  );
}
export async function replayModernTile(t, build) {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'UTC';
  t.mock.method(Date, 'now', () => build.utcMs);
  let world;
  try {
    world = await modernParticleMessageWorld(build.profile);
    const random = world.tileGame.model.random;
    assert.equal(random.index, build.initialRandom.index);
    assert.deepEqual([...random.words], build.initialRandom.words, 'actual local-clock seed');
    const contexts = new Map();
    for (const row of build.rows) {
      const caller = world.main;
      let reply;
      const machine = (caller.machine = new KCSMachine(
        await readKCS(
          kcsProgram([
            [43, row.id, row.args.length * 4],
            ...Array.from({ length: 32 }, () => [59]),
          ]),
        ),
        {
          native: (id, args, vm) => {
            const result = world.runtime.scheduler.native(caller, id, args, vm);
            return result && typeof result.then === 'function'
              ? result.then((value) => (reply = value))
              : (reply = result);
          },
        },
        world.runtime.scheduler.shared,
      ));
      machine.memory.fill(0xa5);
      for (const [at, words] of row.initialize)
        words.forEach((word, i) => machine.store(at + i * 4, word));
      machine.store(4096, 0xa17a29c5);
      row.args.forEach((arg, i) =>
        machine.store(4100 + i * 4, typeof arg === 'string' ? contexts.get(arg) : arg),
      );
      machine.sp = 4100 + row.args.length * 4;
      caller.status = 'ready';
      caller.io = null;
      caller.waiting = null;
      await world.runtime.scheduler.execute(caller);
      if (row.created) contexts.set(row.created, machine.load(4100));
      if (row.id === 471 && typeof row.args[0] === 'string') contexts.delete(row.args[0]);
      assert.equal(reply.control, row.control, row.label + ' control');
      const actual = new Uint8Array(machine.memory),
        view = new DataView(actual.buffer);
      row.args.forEach((arg, i) => {
        if (typeof arg === 'string' && (i !== 0 || row.control === 2))
          view.setUint32(4100 + i * 4, token(arg), true);
      });
      if (row.created) view.setUint32(4100, token(row.created), true);
      const expected = new Uint8Array(8192).fill(0xa5);
      for (const [at, bytes] of row.memory) expected.set(Buffer.from(bytes, 'base64'), at);
      assert.deepEqual(actual, expected, row.label + ' all local bytes');
      for (const key of ['pc', 'sp', 'fp'])
        assert.equal(machine[key], row[key], row.label + ' ' + key);
      for (const [name, expectedContext] of Object.entries(row.contexts)) {
        const { extraWord, ...fields } = expectedContext;
        assert.equal(extraWord, 0, 'native spare owner word');
        assert.deepEqual(
          contextState(world.runtime.handles.get(contexts.get(name), 'tile-game')),
          fields,
          row.label + ' ' + name,
        );
      }
      assert.equal(world.tileGame.model.random.index, row.random.index, row.label + ' RNG index');
      assert.equal(
        hash(world.tileGame.model.random.words),
        row.random.wordsSha256,
        row.label + ' full RNG bank',
      );
      if (
        [
          'start-four-players',
          'cache-event',
          'poll-2',
          'release-first',
          'cache-winning-choices',
          'cache-winning-event',
          'decode-nonempty-result-0',
          'explicit-valid-payment',
        ].includes(row.label)
      ) {
        const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        const model = world.tileGame.snapshot();
        await world.close({ flushFiles: false });
        world = await modernParticleMessageWorld(build.profile, {}, { initialize: false });
        await world.restore(state);
        assert.deepEqual(world.tileGame.snapshot(), model, row.label + ' independent cold model');
      }
    }
    assert.equal(world.tileGame.model.random.index, build.finalRandom.index);
    assert.deepEqual([...world.tileGame.model.random.words], build.finalRandom.words);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    await world?.close({ flushFiles: false });
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
}
