// SPDX-License-Identifier: MPL-2.0
import { bitsFloat } from '../../src/kcs.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';

export const planeFES = `#DEFINE
CPLANE parent
PLANE child
#OBJECT SIZE POS BASE PRI DISP COLOR
parent 8,6 4,5,6 1,2 50 1 0x80403020
child 12,7 3,4,5 2,3 60 1 0xff112233
#OBJECT PARENT VRAM
child parent 7,8
#SUBCOMMAND
oneshot scale authored-scale.kcs SX[1] SY[1] SZ[1] : [0] [1] [2]
#START
parent size 10 8
parent pos 6 7 8
child scale 200% 300% 100%
next WAIT
#WAIT
`;

export async function exercisePlaneFlow(make, assert) {
  const world = await make();
  let fresh;
  try {
    await world.initialize('main.kcs');
    const send = (owner, id, message, w = 0, l = 0, payload) =>
        owner.sendEngine(id, owner.main.id, message, w, l, { payload }),
      surface = await world.objects.create({ kind: 15, parent: world.main.id }),
      owner = await world.objects.create({ kind: 34, parent: world.main.id }),
      task = world.objects.objects.get(owner).implementation;
    await send(world, surface, 279, 64, 48);
    await send(world, surface, 283, 11, 13);
    task.surface = surface;
    await task.load('planes', world.main);
    const instance = task.player.root,
      parent = instance.byKey.get('parent'),
      child = instance.byKey.get('child'),
      engine = world.nativeEngine,
      p = engine.process,
      platform = await world.getNativeFeature('graphics-platform'),
      sdk = world.profile.startsWith('sdk-');
    assert.equal(parent.nativeTaskID, undefined);
    assert.equal(child.nativeTaskID, undefined);
    assert.equal(p.load(child.nativeObjectPointer + 12), parent.nativeObjectPointer);
    await task.tick();
    const size = async (id) => {
        const packet = new NativeGraphicsPacket();
        await send(world, id, 75, 0, 4, packet);
        return [0, 4].map((at) => bitsFloat(packet.load(at)));
      },
      attachment = (current, id) => current.graphics.attachment(current.nativeTaskID(id)),
      query = async (address, id, count) => {
        const output = p.allocate(16, true);
        try {
          assert.equal(
            await engine.call(
              address,
              [world.nativeTaskID(id), output, output + 12],
              platform.refs.view,
            ),
            1,
          );
          return Array.from({ length: count }, (_, i) => p.load(output + i * 4));
        } finally {
          p.free(output);
        }
      };
    assert.deepEqual(await size(parent.nativeTaskID), [10, 8]);
    assert.equal((await query(sdk ? 0x54d380 : 0x6762f0, parent.nativeTaskID, 1))[0], 0x80403020);
    assert.deepEqual(await size(child.nativeTaskID), [12, 7]);
    assert.deepEqual(attachment(world, child.nativeTaskID).pos, [9, 11, 13]);
    assert.deepEqual(attachment(world, child.nativeTaskID).base, [2, 3, 60]);
    const scale = p.allocate(16, true);
    try {
      assert.equal(
        await engine.call(
          sdk ? 0x54d810 : 0x676730,
          [world.nativeTaskID(child.nativeTaskID), scale, 0],
          platform.refs.view,
        ),
        1,
      );
      assert.deepEqual(
        [0, 4, 8].map((at) => bitsFloat(p.load(scale + at))),
        [2, 3, 1],
      );
    } finally {
      p.free(scale);
    }
    const texture = new NativeGraphicsPacket();
    await send(world, child.nativeTaskID, 62, 1, 0, texture);
    assert.deepEqual(
      [0, 4, 8].map((at) => bitsFloat(texture.load(at))),
      [18, 21, 0],
    );

    const draw = world.graphics.drawTasks.get(surface),
      base = draw.state.basePlane;
    assert.deepEqual(await size(base), [64, 48]);
    assert.deepEqual(attachment(world, base).base, [0, 0, 1000]);
    assert.equal(attachment(world, base).display, false);
    const handle = world.graphics.images.create(2, 2, owner);
    await world.graphics.images.get(handle).fill(0, 0, 2, 2, 0xffa2296a);
    await send(world, surface, 296, 0, handle);
    await send(world, surface, 297, 0, 2000);
    await send(world, surface, 292);
    assert.deepEqual(attachment(world, base).base, [0, 0, 2000]);
    assert.equal(attachment(world, base).display, true);
    const pixels = async (current) => {
      if (!current.stageRenderer?.renderer) return null;
      await current.stageRenderer.render(
        current.graphics.stage,
        null,
        current.particles.drawItems(),
      );
      return current.stageRenderer.renderer.ctx.getImageData(0, 0, 64, 48).data;
    };
    const visible = await pixels(world),
      at = (13 * 64 + 11) * 4;
    if (visible) assert.deepEqual([...visible.slice(at, at + 4)], [162, 41, 106, 255]);
    fresh = await make();
    await fresh.restore(world.snapshot());
    assert.deepEqual(await pixels(fresh), visible);
    assert.deepEqual(attachment(fresh, child.nativeTaskID), attachment(world, child.nativeTaskID));
    const restored = fresh.objects.objects.get(owner).implementation,
      restoredChild = restored.player.root.byKey.get('child');
    await fresh.planesFES.command(restored.player.root, restoredChild, 'disp', ['0']);
    await fresh.graphics.syncFES(fresh.objects.objects.get(owner), restored.player);
    assert.equal(attachment(fresh, child.nativeTaskID).display, false);
    await send(fresh, surface, 296, 0, 0);
    assert.equal(attachment(fresh, base).display, false);
    assert.equal(attachment(world, base).display, true);
    if (visible)
      assert.notDeepEqual(
        [...(await pixels(fresh)).slice(at, at + 4)],
        [...visible.slice(at, at + 4)],
      );
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
