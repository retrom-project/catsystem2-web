// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { floatBits } from '../src/kcs.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const red = Uint8Array.of(200, 10, 20, 255),
  green = Uint8Array.of(6, 170, 19, 255);
function anm() {
  const commands = [
      [0, 2, 2, 2],
      [0, 0, 2, 2],
    ],
    bytes = new Uint8Array(32 + commands.length * 68),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x4d4e41, true);
  view.setUint32(8, commands.length, true);
  commands.forEach(([op, ...operands], i) => {
    const at = 32 + i * 68;
    view.setUint32(at, op, true);
    operands.forEach((word, j) => view.setUint32(at + 8 + j * 8, word, true));
  });
  return bytes;
}
async function bitmap(world, pixels) {
  const handle = world.graphics.images.create(1, 1),
    image = world.graphics.images.get(handle);
  (await image.pixels()).set(pixels);
  await image.changed();
  return handle;
}
async function make(profile, initialize = true) {
  const world = await dataWorld(profile, {}, { initialize });
  world.game.width = 8;
  world.game.height = 6;
  return world;
}
async function owner(world) {
  const record = {
    owner: world.main.id,
    bitmap: 0,
    info: Array(11).fill(0),
    layers: [
      {
        bitmap: 0,
        program: anm(),
        animation: {
          selected: 0,
          frames: [
            { key: 0, bitmap: await bitmap(world, red) },
            { key: 2, bitmap: await bitmap(world, green) },
          ],
          bounds: {
            width: 1,
            height: 1,
            canvasWidth: 1,
            canvasHeight: 1,
            offsetX: 0,
            offsetY: 0,
            baseX: 0,
            baseY: 0,
          },
        },
      },
    ],
  };
  await world.imageOwners.rebuild(record);
  return world.runtime.handles.add('image-owner', record);
}
function fields(source) {
  return [0, 0, source, 0, ...[1, 2, 0, 0, 0, 1, 1].map(floatBits), 255, 1, 0, 0];
}
function expected(pixel) {
  const bytes = new Uint8ClampedArray(8 * 6 * 4);
  bytes.set(pixel, ((6 - 2 - 1) * 8 + 1) * 4);
  return bytes;
}
async function output(world, draw) {
  await draw.render();
  return (await world.graphics.images.get(draw.state.renderer.bitmap).pixels()).slice();
}
for (const profile of profiles)
  test(`${profile} enabling an owner ANM layer immediately composites its selected frame and restores every exact frame`, async (t) => {
    const world = await make(profile);
    let fresh;
    try {
      const surface = await world.objects.create({
        kind: 15,
        parent: world.main.id,
        name: 'ANM selected frame',
      });
      await world.sendEngine(surface, world.main.id, 279, 8, 6);
      await world.sendEngine(surface, world.main.id, 283, 0, 0);
      const draw = world.graphics.drawTasks.get(surface),
        input = await owner(world),
        source = world.retainedDraw.fromOwner(input);
      await world.retainedDraw.bind(draw, 7, fields(source));
      const root = world.renderSources.get(source),
        child = world.renderSources.get(root.children[0]),
        before = root.revision;
      assert.equal(root.refs, 2);
      assert.equal(child.refs, 1);
      assert.equal(root.groupDirty, false);
      assert.equal(child.selected, 0);
      await world.imageOwners.release(input);
      await world.retainedDraw.enable(draw, 7, 1);
      assert.equal(child.selected, 2, 'the existing ANM controller selected key2 at enable');
      t.diagnostic(
        JSON.stringify({
          frame: 0,
          selected: child.selected,
          rootDirty: root.groupDirty,
          rootRevision: root.revision,
          before,
          rootRefs: root.refs,
        }),
      );
      assert.deepEqual(
        await output(world, draw),
        expected(green),
        'enable must render the already-selected green frame',
      );
      assert.ok(root.revision > before, 'the child preadvance reaches its parent revision');
      assert.equal(root.groupDirty, false, 'pull consumed the parent composite dirty flag');
      for (let frame = 1; frame <= 2; frame++) {
        await world.objects.drawTick(frame);
        assert.equal(child.selected, 2);
        assert.deepEqual(await output(world, draw), expected(green));
      }
      fresh = await make(profile, false);
      await fresh.restore(structuredClone(world.snapshot()));
      const restoredDraw = fresh.graphics.drawTasks.get(surface),
        restoredRoot = fresh.renderSources.get(source),
        restoredChild = fresh.renderSources.get(restoredRoot.children[0]);
      assert.equal(restoredRoot.refs, 2);
      assert.equal(restoredChild.selected, 2);
      assert.equal(restoredChild.animation.baseFrame, child.animation.baseFrame);
      for (let frame = 3; frame <= 6; frame++) {
        await world.objects.drawTick(frame);
        await fresh.objects.drawTick(frame);
        assert.equal(child.selected, 0);
        assert.equal(restoredChild.selected, 0);
        assert.deepEqual(await output(world, draw), expected(red));
        assert.deepEqual(await output(fresh, restoredDraw), expected(red));
        t.diagnostic(
          JSON.stringify({
            frame,
            selected: restoredChild.selected,
            baseFrame: restoredChild.animation.baseFrame,
            pc: restoredChild.animation.pc,
            rootRefs: restoredRoot.refs,
          }),
        );
      }
      for (const [w, d] of [
        [world, draw],
        [fresh, restoredDraw],
      ]) {
        const ids = [source, ...w.renderSources.get(source).children];
        await d.remove(7);
        assert.equal(w.renderSources.get(source).refs, 1);
        await w.renderSources.release(source);
        for (const id of ids)
          assert.equal(
            w.runtime.handles.records.has(id),
            false,
            'last owner releases all layer/controller sources',
          );
        assert.ok(!w.nativeEngine);
      }
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
