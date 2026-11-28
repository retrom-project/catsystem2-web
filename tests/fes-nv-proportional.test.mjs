// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { profiles, defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';

function proportional(profile, bytes) {
  const size = nativeABI(profile).layouts.textCores.cp932.configSize,
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [24, 24 + size + 16].map((offset) => view.getUint32(offset + 124, true));
}
async function check(world, task, value) {
  const object = task.player.root.collection.lookup('text', 0);
  assert.deepEqual(proportional(world.profile, object.nativeTextState.nv), [value, value]);
  await task.syncObjects();
  const writer = await world.graphics.get(object.nativeTaskID).writer();
  assert.deepEqual(proportional(world.profile, writer.config), [value, value]);
}
for (const profile of profiles)
  test(`${profile}: FES NV constructor/reset copy the current raw proportional DWORD into both configs and D5 through fresh restore`, async () => {
    const world = await defaultFESWorld(profile, {
      'screen.fes': new TextEncoder().encode(
        '#DEFINE\nNVSTRING text\n#OBJECT SIZE\ntext 24,16\n#START\nnext IDLE\n#IDLE\n#RESET\ntext reset\nbreak\n',
      ),
    });
    let fresh;
    try {
      world.configuration.fields.font.prop = 3;
      const h = await loadDefaultFES(world);
      await check(world, h.task, 3);
      world.configuration.fields.font.prop = 5;
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (name !== 'case.kcs') throw new Error(`NV proportional restore read ${name}`);
        return read(name);
      };
      await fresh.restore(world.snapshot());
      assert.equal(fresh.configuration.fields.font.prop, 5);
      const task = fresh.objects.objects.get(h.id).implementation;
      await check(fresh, task, 3);
      for (const value of [7, 0]) {
        world.configuration.fields.font.prop = fresh.configuration.fields.font.prop = value;
        await h.task.player.notify('RESET');
        await task.player.notify('RESET');
        await check(world, h.task, value);
        await check(fresh, task, value);
      }
      assert.equal(world.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
