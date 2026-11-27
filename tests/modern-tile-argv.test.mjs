// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { replayModernTile } from './fixtures/modern-tile-replay.mjs';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-tile-argv-golden.json', import.meta.url)),
);
async function frame(
  world,
  id,
  args,
  { declaredCount = args.length, base = 4100, initialize = [] } = {},
) {
  const caller = world.main;
  const machine = (caller.machine = new KCSMachine(
    await readKCS(kcsProgram([[43, id, declaredCount * 4], [59]])),
    { native: (number, words, vm) => world.runtime.scheduler.native(caller, number, words, vm) },
    world.runtime.scheduler.shared,
  ));
  machine.memory.fill(0xa5);
  for (const [at, words] of initialize) words.forEach((word, i) => machine.store(at + 4 * i, word));
  args.forEach((word, i) => machine.store(base + i * 4, word));
  machine.sp = base + declaredCount * 4;
  caller.status = 'ready';
  caller.io = null;
  caller.waiting = null;
  await world.runtime.scheduler.execute(caller);
  return machine;
}
for (const build of golden.builds) {
  test(`${build.version} Tile fixed mapped frames and ordinary aliases match own GCALL; native address integers stay protected`, async (t) => {
    let checked = false;
    await replayModernTile(t, build, {
      afterRow: async (world, contexts, row) => {
        if (row.id !== 473 || row.result !== 20051) return;
        assert.equal(checked, false);
        checked = true;
        const state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        const model = world.tileGame.snapshot(),
          handle = contexts.get('context1');
        const reset = async () => {
          await world.close({ flushFiles: false });
          world = await modernParticleMessageWorld(build.profile, {}, { initialize: false });
          await world.restore(state);
        };
        try {
          await assert.rejects(frame(world, 503, [handle, 4100]), /opaque context pointer bytes/);
          assert.deepEqual(world.tileGame.snapshot(), model, 'guard has no payment/model mutation');
          await reset();
          await assert.rejects(
            frame(world, 505, [handle, 10009, 4, 4100]),
            /opaque context pointer bytes/,
          );
          assert.deepEqual(world.tileGame.snapshot(), model);
          await reset();
          const amounts = [handle, 10, -10, -handle];
          assert.equal(
            (await frame(world, 503, [handle, 544], { initialize: [[544, amounts]] })).load(4100),
            1,
          );
          const output = await frame(world, 502, [handle, 512]);
          assert.deepEqual(
            amounts.map((_, i) => output.load(512 + 4 * i)),
            amounts.map((word) => word >>> 0),
          );
          await reset();
          return world;
        } catch (error) {
          await world.close({ flushFiles: false });
          throw error;
        }
      },
    });
    assert.equal(checked, true);
  });
  test(`${build.version} Tile null owner skips unused frame words and actual missing words or data stay diagnostic`, async () => {
    const world = await modernParticleMessageWorld(build.profile);
    try {
      const empty = await frame(world, 494, [0], { declaredCount: 0, base: 8188 });
      assert.equal(empty.sp, 8188);
      assert.equal(empty.load(8188), 0);
      const handle = (await frame(world, 470, [])).load(4100);
      const before = world.tileGame.snapshot();
      assert.equal(
        (await frame(world, 503, [handle, 4100])).load(4100),
        0,
        'inactive payment copies but does not consume its words',
      );
      assert.equal(
        (await frame(world, 505, [handle, 10015, 0, 4100])).load(4100),
        1,
        'empty ignored input is not guarded',
      );
      assert.deepEqual(world.tileGame.snapshot(), before);
      await assert.rejects(
        frame(world, 494, [handle], { declaredCount: 0, base: 8188 }),
        /KCS memory/,
      );
      await assert.rejects(
        frame(world, 482, [handle, 0x030507, 0x40000000, 512, 516]),
        /KCS memory/,
      );
      assert.equal(world.main.machine.load(512), 0xa5a5a5a5);
      await assert.rejects(frame(world, 503, [handle, 0x40000000]), /KCS memory/);
      // Direct authoring calls retain explicit words after a previous GCALL.
      assert.equal(
        (await world.runtime.native('main', 475, [0], world.main.machine, world.main)).value,
        0,
      );
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
