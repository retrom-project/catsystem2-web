// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profiles,
  defaultFESWorld,
  loadDefaultFES,
  drawPixels,
} from './fixtures/default-fes-world.mjs';
import { kcsProgram } from './helpers.mjs';

const red = [17, 34, 51, 255],
  redPixels = Uint8ClampedArray.from(Array.from({ length: 4 }, () => red).flat()),
  bytes = (source) => new TextEncoder().encode(source),
  files = (source) => ({
    'screen.fes': bytes(source),
    'dummy.kcs': kcsProgram([[59]]),
    'pcolor.kcs': kcsProgram([[59]]),
  });

for (const profile of profiles) {
  for (const target of ['picture', 'plane']) {
    test(`${profile} ${target} baseimg drains the private FIFO before continuing without a resource pass`, async () => {
      const source = `#DEFINE
CIMAGE picture
PLANE plane
#OBJECT SIZE COLOR POS PRI DISP
picture 2,2 0xff112233 0,${target === 'plane' ? 94 : 0} 60000 1
#OBJECT SIZE VRAM
plane 2,2 0,0
#START
next IDLE
#IDLE
if ($7) call SNAP
#SNAP
plane wipe 3
$5=17
picture color 0xff445566
$5=18
baseimg ${target}
$5=81
picture color 0xff778899
picture disp 0
break
`,
        world = await defaultFESWorld(profile, files(source));
      let fresh;
      try {
        const h = await loadDefaultFES(world);
        await h.task.tick();
        await drawPixels(world, h.surface);
        const picture = h.instance.byKey.get('picture'),
          image = world.graphics.images.get(h.instance.runtime.images.currentBitmap(picture));
        assert.deepEqual(await image.pixels(), redPixels);
        if (target === 'plane') {
          const physical = await world.graphics.images.get(h.draw.state.renderer.bitmap).pixels();
          assert.deepEqual(
            [...physical.slice(0, 8), ...physical.slice(128 * 4, 128 * 4 + 8)],
            [...redPixels],
            'the PLANE rectangle contains the old published pixels in physical bitmap rows',
          );
        }
        const uploads = [],
          send = world.sendEngine.bind(world);
        world.sendEngine = async (id, sender, message, w, l, context) => {
          if (id === h.surface && message === 286) uploads.push([l, h.task.player.globals[5]]);
          return send(id, sender, message, w, l, context);
        };
        if (target === 'plane') {
          h.instance.setGlobal(7, 1);
          await h.task.player.step();
        } else await h.task.player.notify('SNAP');
        assert.deepEqual(uploads, [[1, 18]], 'async return0 does not consume the native queue');
        assert.equal(h.task.player.globals[5], 81, 'continuation runs in the same FES frame');
        assert.equal(h.task.player.frameCount, target === 'plane' ? 2 : 1);
        assert.equal(picture.color >>> 0, 0xff778899);
        assert.deepEqual(await image.pixels(), redPixels, 'commands have not published resources');
        assert.deepEqual(
          await world.graphics.images.get(h.draw.state.baseImage).pixels(),
          redPixels,
        );
        assert.equal(h.instance.runtime.pendingRecords.length, 0);
        assert.equal(h.instance.nativeQueuePending, false);
        const saved = structuredClone(world.snapshot());
        const resources = files(source);
        delete resources['screen.fes'];
        fresh = await defaultFESWorld(profile, resources, { initialize: false });
        await fresh.restore(saved);
        const restored = fresh.graphics.drawTasks.get(h.surface);
        assert.deepEqual(
          await fresh.graphics.images.get(restored.state.baseImage).pixels(),
          redPixels,
        );
        assert.deepEqual(
          fresh.objects.objects.get(h.id).implementation.player.root.runtime.snapshot(),
          h.instance.runtime.snapshot(),
        );
        assert.equal(world.nativeEngine, undefined);
        assert.equal(fresh.nativeEngine, undefined);
      } finally {
        await fresh?.close();
        await world.close();
      }
    });
  }

  test(`${profile} fresh World resumes an owned baseimg queue without replaying image initialization`, async () => {
    const source =
        '#DEFINE\nCIMAGE picture\n#OBJECT SIZE COLOR PRI DISP\npicture 2,2 0xff112233 60000 1\n#START\nnext IDLE\n#IDLE\n',
      world = await defaultFESWorld(profile, files(source));
    let fresh;
    try {
      const h = await loadDefaultFES(world);
      await h.task.tick();
      assert.deepEqual(h.instance.execute('baseimg picture'), { action: 'flush' });
      assert.equal(h.instance.nativeQueuePending, true);
      const saved = structuredClone(world.snapshot());
      fresh = await defaultFESWorld(profile, {}, { initialize: false });
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (!name.endsWith('.kcs'))
          throw new Error('baseimg restore must use already-owned state: ' + name);
        return read(name);
      };
      await fresh.restore(saved);
      const task = fresh.objects.objects.get(h.id).implementation,
        runtime = task.player.root.runtime;
      assert.equal(runtime.pendingRecords.length, 1);
      assert.equal(task.player.root.nativeQueuePending, true);
      await task.player.step();
      assert.equal(runtime.pendingRecords.length, 0);
      assert.equal(task.player.root.nativeQueuePending, false);
      const draw = fresh.graphics.drawTasks.get(h.surface);
      assert.deepEqual(await fresh.graphics.images.get(draw.state.baseImage).pixels(), redPixels);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
}
