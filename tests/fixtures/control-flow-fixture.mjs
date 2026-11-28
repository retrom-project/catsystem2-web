// SPDX-License-Identifier: MPL-2.0
export async function exerciseControlFlow(make, assert) {
  const world = await make();
  let failure, restored;
  try {
    await world.initialize('main.kcs');
    const surface = await world.objects.create({
      kind: 15,
      parent: world.root,
      name: 'Authored Surface',
    });
    await world.sendEngine(surface, world.main.id, 279, 128, 96);
    await world.sendEngine(surface, world.main.id, 283, 0, 0);
    const fes = await world.objects.create({
        kind: 34,
        parent: world.main.id,
        name: 'Authored FES',
      }),
      record = world.objects.objects.get(fes);
    await world.sendEngine(fes, world.main.id, 331, 0, world.main.context.variableBank);
    await world.sendEngine(fes, world.main.id, 334, 0, world.nativeTaskID(surface));
    await record.implementation.loadSource('screen');
    for (let i = 0; i < 3; i++) await world.tick();
    const player = record.implementation.player,
      objects = ['slider', 'scroll2', 'scroll'].map((key) => player.root.byKey.get(key));
    assert.deepEqual(
      objects.map((object) => world.objects.objects.get(object.nativeTaskID).kind),
      [42, 41, 40],
    );
    assert.deepEqual(
      objects.map((object) => object.value),
      [25, 30, 10],
    );
    const draw = world.graphics.drawTasks.get(surface);
    assert.ok(draw.state.renderer.items.length >= 7);
    await world.sendEngine(surface, world.main.id, 292);
    const bitmap = world.graphics.images.get(draw.state.renderer.bitmap),
      pixels = await bitmap.pixels();
    assert.ok(pixels.some((value, index) => index % 4 !== 3 && value));
    const slider = objects[0];
    const eventCount = player.root.local(5);
    await world.sendEngine(fes, slider.nativeTaskID, 27, 0, 64);
    assert.equal(slider.value, 64);
    assert.equal(player.root.local(5), eventCount + 1);
    assert.equal(player.globals[7], 64);
    assert.equal(player.root.scrollPosition, slider.handle);
    await world.sendEngine(fes, slider.nativeTaskID, 28, 0, 1);
    assert.equal(player.root.local(6), 1);
    await world.sendEngine(fes, slider.nativeTaskID, 28, 0, 0);
    assert.equal(player.root.local(6), 0);
    await world.tick();
    const input = world.inputFor(fes),
      region = input.regions
        .filter((region) => world.objects.objects.get(region.owner)?.parent === slider.nativeTaskID)
        .sort(
          (a, b) =>
            (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) -
            (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]),
        )[0];
    assert.ok(region, 'the original thumb registers its input region');
    const x = (region.bounds[0] + region.bounds[2]) >> 1,
      y = (region.bounds[1] + region.bounds[3]) >> 1;
    input.pointer(x, y, 1);
    await world.tick();
    input.key(0, true, 2, 1);
    await world.tick();
    restored = await make();
    await restored.restore(structuredClone(world.snapshot()));
    for (const current of [world, restored]) {
      current.inputFor(fes).pointer(x + 20, y, 1);
      await current.tick();
      current.inputFor(fes).key(0, false, 2, 1);
      await current.tick();
      await current.sendEngine(surface, current.main.id, 292);
    }
    const beforeMotion = (await bitmap.pixels()).slice();
    await player.root.notify('MOTION');
    assert.equal(player.globals[8], 1);
    assert.equal(slider.motionBusy, true);
    const pendingMotion = structuredClone(world.snapshot());
    await restored.close();
    restored = await make();
    await restored.restore(pendingMotion);
    for (const current of [world, restored]) {
      await current.tick();
      const currentPlayer = current.objects.objects.get(fes).implementation.player;
      assert.equal(currentPlayer.root.byKey.get('slider').alpha, 64);
      await currentPlayer.root.notify('CHECK');
      assert.equal(currentPlayer.globals[9], 0);
      assert.equal(currentPlayer.root.byKey.get('slider').motionBusy, false);
      await current.sendEngine(surface, current.main.id, 292);
    }
    assert.notDeepEqual(await bitmap.pixels(), beforeMotion);
    const candidate = restored.objects.objects.get(fes).implementation.player;
    assert.ok(slider.value > 64, 'dragging the original thumb changes its value');
    assert.ok(player.root.local(5) > 1, 'the original task delivers SCRL_P through FES27');
    assert.equal(candidate.root.byKey.get('slider').value, slider.value);
    assert.equal(candidate.root.local(5), player.root.local(5));
    assert.deepEqual(
      await restored.graphics.images
        .get(restored.graphics.drawTasks.get(surface).state.renderer.bitmap)
        .pixels(),
      await bitmap.pixels(),
    );
    assert.deepEqual([...player.unsupportedCommands], []);
    await player.root.notify('LOOP');
    assert.equal(player.globals[10], 1);
    await world.tick();
    assert.equal(slider.alpha, 128);
    assert.equal(slider.motionBusy, true);
    await world.sendEngine(fes, world.main.id, 342, 0, 1);
    const buttonIDs = world.objects
      .children(world.objects.objects.get(slider.nativeTaskID))
      .map((child) => child.id);
    assert.ok(buttonIDs.every((id) => !world.inputFor(fes).get(id).enabled));
    assert.equal(slider.disp, true);
    assert.equal(slider.enable, true);
    await world.sendEngine(fes, world.main.id, 342, 0, 0);
    assert.ok(buttonIDs.every((id) => world.inputFor(fes).get(id).enabled));
    await player.root.notify('STOP');
    assert.equal(player.globals[11], 0);
    assert.equal(slider.motionBusy, false);
    const scroll2 = objects[1],
      thumb = input.regions
        .filter(
          (region) => world.objects.objects.get(region.owner)?.parent === scroll2.nativeTaskID,
        )
        .sort(
          (a, b) =>
            (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) -
            (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]),
        )[0],
      verticalX = (thumb.bounds[0] + thumb.bounds[2]) >> 1,
      verticalY = (thumb.bounds[1] + thumb.bounds[3]) >> 1,
      beforeVertical = scroll2.value;
    input.pointer(verticalX, verticalY, 1);
    await world.tick();
    input.key(0, true, 2, 1);
    await world.tick();
    assert.equal(input.captures[0], thumb.owner);
    input.pointer(verticalX, verticalY + 20, 1);
    await world.tick();
    input.key(0, false, 2, 1);
    await world.tick();
    assert.ok(scroll2.value > beforeVertical, 'SCROLL2 uses its original vertical drag arithmetic');
    const scroll = objects[2],
      task = world.objects.objects.get(scroll.nativeTaskID).implementation,
      arrowID = world.resolveTaskID(
        world.nativeEngine.process.load(task.pointer + 107 * 4),
        scroll.nativeTaskID,
      ),
      arrow = input.get(arrowID);
    input.pointer(
      (arrow.bounds[0] + arrow.bounds[2]) >> 1,
      (arrow.bounds[1] + arrow.bounds[3]) >> 1,
      1,
    );
    await world.tick();
    // The original release path quantizes the task position without a SCRL_P notification.
    const beforeRepeat = world.nativeEngine.process.load(task.pointer + 201 * 4);
    input.key(0, true, 2, 1);
    await world.tick();
    assert.equal(input.captures[0], arrowID);
    assert.equal(scroll.value, beforeRepeat + 1);
    for (let i = 0; i < 35; i++) await world.tick();
    assert.ok(scroll.value > beforeRepeat + 1, 'SCROLL holds its own delayed repeat timer');
    input.key(0, false, 2, 1);
    await world.tick();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await restored?.close();
    await closePreservingError(world, failure);
  }
}

async function closePreservingError(world, error) {
  try {
    await world.close();
  } catch (cleanup) {
    if (error) error.cleanup = cleanup;
    else throw cleanup;
  }
}
