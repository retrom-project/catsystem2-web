// SPDX-License-Identifier: MPL-2.0
import { encodeCP932, floatBits } from '../../src/kcs.mjs';

function sourceName(name, wide) {
  if (!wide) return encodeCP932(name + '\0');
  const bytes = new Uint8Array((name.length + 1) * 2),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < name.length; i++) view.setUint16(i * 2, name.charCodeAt(i), true);
  return bytes;
}

function drawWords(pointer, x, alpha = 255, shown = 1) {
  return [pointer, ...[x, 1, 0, 0, 0, 1, 1].map(floatBits), alpha, shown, 0];
}

async function bindBitmapSource(world, pointer, nativeSurface, index = 1) {
  const p = world.nativeEngine.process,
    packet = p.allocate(60, true);
  try {
    p.store(packet, p.load(pointer));
    drawWords(pointer, 4)
      .slice(1)
      .forEach((word, i) => p.store(packet + 16 + i * 4, word));
    await world.sendNativeEngine(nativeSurface, world.main.id, 280, index, packet, {
      nativePointer: true,
      payload: { load: (address) => p.load(address) },
    });
  } finally {
    p.free(packet);
  }
}

async function originalRetainedStates(world, layout, source, updates, assert, remove = false) {
  const engine = world.nativeEngine,
    p = engine.process,
    [receiver, construct, destroy, firstMessage] = layout.wide
      ? [0x5f3f50, 0x742a10, 0x742cf0, 280]
      : [0x4ce6c0, 0x5e3720, 0x5e39e0, 275],
    before = p.read(source, layout.retainedBytes),
    live = p.allocations.size,
    manager = p.allocate(60, true),
    host = p.allocate(160, true),
    packet = p.allocate(60, true),
    output = p.allocate(12),
    sender = world.nativeTaskID(world.main.id),
    states = [];
  let constructed = false;
  try {
    await engine.call(construct, [8, 6, 4, 0], manager);
    constructed = true;
    p.store(host + 108, manager);
    for (const [id, words] of updates) {
      p.store(packet + 8, words[0]);
      words
        .slice(1)
        .forEach((word, i) =>
          p.store(packet + 16 + i * 4, i === 7 ? Math.min(255, word >>> 0) : word),
        );
      p.write(output, new Uint8Array(12).fill(0xa5));
      const message = firstMessage + (id === 0x2c4 ? 2 : 0);
      assert.equal(
        await engine.call(receiver, [sender, message, 0, packet, 0, output + 4], host),
        0,
      );
      assert.deepEqual(p.read(output, 12), new Uint8Array(12).fill(0xa5));
      states.push(p.read(source, layout.retainedBytes));
    }
    if (remove) {
      assert.equal(p.load(source + 188), 2);
      assert.equal(
        await engine.call(receiver, [sender, firstMessage + 1, 0, 0, 0, output + 4], host),
        0,
      );
      assert.equal(
        p.allocations.has(source),
        false,
        'the original single-entry removal destroys it immediately',
      );
    }
  } finally {
    if (constructed) await engine.call(destroy, [], manager);
    for (const address of [output, packet, host, manager]) p.free(address);
  }
  if (!remove) {
    assert.equal(p.allocations.size, live, 'reference manager destroys all of its allocations');
    assert.equal(p.load(source + 188), 1);
    p.write(source, before);
  }
  return states;
}

export async function exerciseRenderSourcesWorld(make, layout, rgba, assert, inspectFrame) {
  const { stride } = layout,
    marker = 0x42424242,
    aliasCount = 4100,
    metadataWords = [0, 0, 3, 2, 7, 8, 4, 2, 1],
    world = make(),
    call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main),
    metadataAt = (machine, address) => metadataWords.map((_, i) => machine.load(address + 4 * i)),
    recordAt = (machine, address) => ({
      tag: machine.load(address),
      pointer: machine.load(address + 4),
    });
  async function drawBorrowedFrame(owner, draw, nativeSurface, wrapper) {
    const process = owner.nativeEngine.process,
      bitmap = process.load(wrapper),
      references = process.load(bitmap + 80),
      wrapperReferences = process.load(wrapper + layout.wrapperBytes - 4),
      index = 3,
      key = owner.nativeTaskID(owner.main.id) | (index << 16),
      retained = await owner.getNativeFeature('retained-draw');
    await bindBitmapSource(owner, wrapper, nativeSurface, index);
    assert.equal(retained.record(draw, key).source, bitmap);
    assert.equal(process.load(bitmap + 80), references + 1);
    assert.deepEqual(
      await owner.graphics.images.get(draw.entry(key).image).pixels(),
      new Uint8ClampedArray(rgba),
      'the original Draw binder reads the borrowed frame pixels',
    );
    await call(owner, 0x102, [nativeSurface, index]);
    assert.equal(process.load(bitmap + 80), references);
    assert.equal(process.load(wrapper + layout.wrapperBytes - 4), wrapperReferences);
  }
  let fresh;
  try {
    await world.initialize('main.kcs');
    const m = world.main.machine,
      p = world.nativeEngine.process,
      memory = await world.getNativeFeature('task-memory'),
      plain = recordAt(m, 0),
      plainBitmap = p.load(plain.pointer);
    assert.equal(m.load(2000), 1, 'actual GCALL returns the number of records');
    assert.equal(plain.tag, 1, 'VM offset zero is a valid destination');
    assert.equal(p.allocations.get(plain.pointer), layout.wrapperBytes);
    assert.equal(p.load(memory.guestAddress(world.main.id, m, 4)), plain.pointer);
    assert.equal(world.nativeEngine.features.get('bitmap-factories')?.refs.contexts.size ?? 0, 0);

    const alias = await world.spawnScript('alias.kcs', { initialExecute: true });
    assert.equal(alias.machine.load(aliasCount), 0);
    assert.equal(
      alias.machine.load(aliasCount + stride),
      marker,
      'the first record clears the live count word before the native loop tests it again',
    );

    const block = m.allocate(stride * 3),
      shared = 0x80000020,
      source = 1024;
    m.bytes(block, stride * 3).fill(0xa5);
    m.writeString('x,1,2.hg3', source);
    // Match the caller-stack input of the authored selector oracle.
    p.zero(p.stackTop - 0x6000, 0x6000);
    assert.deepEqual(await call(world, 0x2bf, [source, block, 1]), { control: 1, value: 2 });
    const records = [recordAt(m, block), recordAt(m, block + stride)],
      sourceBytes = m.bytes(block, stride * 3).slice(),
      [animated, bitmap] = records;
    assert.deepEqual(
      records.map((r) => r.tag),
      [2, 1],
    );
    assert.equal(p.allocations.get(animated.pointer), layout.retainedBytes);
    assert.equal(p.allocations.get(bitmap.pointer), layout.wrapperBytes);
    for (const [i, name] of ['x_1.hg3.hg3', 'x_02.hg3'].entries()) {
      const expected = new Uint8Array(stride - 8).fill(0xa5);
      expected.set(sourceName(name, layout.wide));
      assert.deepEqual(m.bytes(block + stride * i + 8, stride - 8), expected);
    }
    assert.deepEqual(m.bytes(block + stride * 2, stride), new Uint8Array(stride).fill(0xa5));

    m.writeString('alias.hg2', source);
    m.bytes(shared, stride).fill(0xa5);
    assert.deepEqual(await call(world, 0x2bf, [source, shared, 1]), { control: 1, value: 1 });
    const manifest = recordAt(m, shared);
    assert.equal(manifest.tag, 2, 'the initialized original view resolves its first manifest row');
    assert.equal(p.load(manifest.pointer + 188), 1);
    assert.deepEqual(m.bytes(shared + 8, stride - 8), new Uint8Array(stride - 8).fill(0xa5));

    const surface = await world.objects.create({ kind: 15, parent: world.main.id }),
      nativeSurface = world.nativeTaskID(surface),
      draw = world.graphics.drawTasks.get(surface),
      retained = await world.getNativeFeature('retained-draw'),
      key = world.nativeTaskID(world.main.id),
      rawBitmap = p.load(bitmap.pointer);
    await call(world, 0x100, [nativeSurface, 8, 6]);
    await call(world, 0x104, [nativeSurface, 0, 0]);
    const updates = [
      [0x2c3, drawWords(animated.pointer, 0)],
      [0x2c4, drawWords(manifest.pointer, 1, 129, 0)],
      [0x2c3, drawWords(0xffffffff, 0, 0xffffffff)],
      [0x2c4, drawWords(0, 7)],
    ];
    const expectedStates = await originalRetainedStates(
      world,
      layout,
      animated.pointer,
      updates,
      assert,
    );
    for (const [i, [id, words]] of updates.entries()) {
      assert.deepEqual(await call(world, id, [nativeSurface, 0, ...words]), { control: 2 });
      assert.deepEqual(
        p.read(animated.pointer, layout.retainedBytes),
        expectedStates[i],
        'the entire retained record matches the original Draw receiver',
      );
      assert.equal(
        p.load(animated.pointer + 188),
        2,
        'one reference for the array and one for Draw',
      );
      assert.equal(p.load(manifest.pointer + 188), 1, 'the supplied replacement was ignored');
    }
    assert.deepEqual(await call(world, 0x2c3, [0xffffffff, 0, ...drawWords(0xffffffff, 0)]), {
      control: 2,
    });
    const query = await world.spawnScript('metadata.kcs'),
      qm = query.machine,
      queryAddress = layout.wide ? 0x64bc70 : 0x518830;
    qm.store(256, animated.pointer);
    qm.bytes(aliasCount, 40).fill(0xa5);
    let observed = false;
    const detach = p.beforeInstruction(queryAddress, 'observe live retained geometry argv', () => {
      const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
        argv = p.load(sp + 12);
      assert.equal(p.load(argv), animated.pointer);
      assert.equal(p.load(argv + 4), aliasCount);
      assert.equal(argv + 4, p.load(p.load(sp + 4) + 20) + aliasCount);
      observed = true;
    });
    try {
      await world.runtime.scheduler.execute(query);
    } finally {
      detach();
    }
    assert.equal(observed, true);
    assert.equal(qm.load(252), 1);
    assert.deepEqual(metadataAt(qm, aliasCount), metadataWords);
    assert.equal(qm.load(aliasCount + 36), 0xa5a5a5a5);
    assert.equal(p.load(animated.pointer + 188), 2, 'metadata does not acquire a reference');
    const frameTask = await world.spawnScript('frame.kcs');
    frameTask.machine.store(256, animated.pointer);
    await world.runtime.scheduler.execute(frameTask);
    const borrowed = frameTask.machine.load(252),
      firstFrame = p.load(p.load(p.load(animated.pointer + 60)));
    assert.equal(borrowed, p.load(firstFrame + 20), 'GCALL returns the original frame wrapper');
    assert.equal(p.allocations.get(borrowed), layout.wrapperBytes);
    assert.equal(world.runtime.handles.records.has(borrowed), false);
    await drawBorrowedFrame(world, draw, nativeSurface, borrowed);
    const spareRecord = shared + stride;
    for (const original of [true, false]) {
      assert.deepEqual(await call(world, 0x2bf, [source, spareRecord, 1]), {
        control: 1,
        value: 1,
      });
      const spare = recordAt(m, spareRecord);
      assert.equal(spare.tag, 2);
      const words = drawWords(spare.pointer, 0, 255, 0);
      if (original)
        await originalRetainedStates(world, layout, spare.pointer, [[0x2c4, words]], assert, true);
      else {
        await call(world, 0x2c4, [nativeSurface, 2, ...words]);
        assert.equal(retained.record(draw, key | 0x20000).pointer, spare.pointer);
        assert.equal(
          p.load(spare.pointer + 188),
          2,
          'an update to an absent key creates one reference',
        );
        await call(world, 0x102, [nativeSurface, 2]);
        assert.equal(
          p.allocations.has(spare.pointer),
          false,
          'single removal matches the original destruction',
        );
      }
      assert.deepEqual(
        recordAt(m, spareRecord),
        spare,
        'the caller still holds the original raw words',
      );
      // The authored single-remove test deliberately consumes the pointer.
      // Clear its stale caller record before reusing the storage.
      m.store(spareRecord, 0);
      m.store(spareRecord + 4, 0);
    }
    const temporarySurface = await world.objects.create({ kind: 15, parent: world.main.id }),
      temporaryNativeID = world.nativeTaskID(temporarySurface);
    await call(world, 0x100, [temporaryNativeID, 8, 6]);
    const bindingScript = await world.spawnScript('bind.kcs');
    assert.equal(bindingScript.machine.load(shared + 4), manifest.pointer);
    bindingScript.machine.store(256, temporaryNativeID);
    await world.runtime.scheduler.execute(bindingScript);
    assert.equal(p.load(manifest.pointer + 188), 2);
    await world.objects.release(temporarySurface);
    assert.equal(p.allocations.get(manifest.pointer), layout.retainedBytes);
    assert.equal(
      p.load(manifest.pointer + 188),
      1,
      'the complete Draw destructor releases one reference',
    );
    await bindBitmapSource(world, bitmap.pointer, nativeSurface);
    const bitmapEntry = retained.record(draw, key | 0x10000).pointer;
    await call(world, 0x2c4, [nativeSurface, 1, ...drawWords(manifest.pointer, 4)]);
    assert.equal(retained.record(draw, key | 0x10000).pointer, bitmapEntry);
    assert.equal(
      p.load(bitmapEntry + 188),
      1,
      'a deferred bitmap transfers its reference to the manager',
    );
    assert.equal(p.load(manifest.pointer + 188), 1);
    assert.equal(retained.record(draw, key).pointer, animated.pointer);
    assert.equal(retained.record(draw, key | 0x10000).source, rawBitmap);
    for (const entry of draw.state.renderer.items)
      assert.deepEqual(
        await world.graphics.images.get(entry.image).pixels(),
        new Uint8ClampedArray(rgba),
      );
    await call(world, 0x154, [nativeSurface]);
    const pixels = (await world.graphics.images.get(draw.state.renderer.bitmap).pixels()).slice(),
      references = p.load(animated.pointer + 188),
      bitmapReferences = p.load(rawBitmap + 80);
    assert.equal(
      pixels.filter((alpha, i) => i % 4 === 3 && alpha !== 0).length,
      12,
      'two independently positioned source images reach the original draw surface',
    );
    assert.equal(references, 2, 'rasterization does not retain the same object again');
    assert.equal(bitmapReferences, 2, 'the wrapper and Draw each own one bitmap reference');

    m.writeString('sequence.hg3', 256);
    await call(world, 0x270, [nativeSurface, 0, 256]);
    const animation = p.load(animated.pointer + 72),
      variable = animation + 32 + 63 * 4;
    assert.equal(Boolean(animation), true, 'the original render source loaded its ANM script');
    await call(world, 0x370, [nativeSurface, 0, 63, 0xf1234567]);
    assert.equal(p.load(variable), 0xf1234567);
    await call(world, 0x370, [nativeSurface, 1, 63, 42]);
    assert.equal(p.load(variable), 0xf1234567, 'the other Draw key has no effect on the ANM');
    const preview = inspectFrame ? await inspectFrame(world) : null;
    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    const fm = fresh.main.machine,
      fp = fresh.nativeEngine.process,
      restored = fresh.graphics.drawTasks.get(surface),
      fmMemory = await fresh.getNativeFeature('task-memory');
    assert.equal(fp.load(animated.pointer + 72), animation);
    assert.equal(fp.load(variable), 0xf1234567);
    await call(fresh, 0x370, [nativeSurface, 0, 63, 42]);
    assert.equal(fp.load(variable), 42);
    assert.equal(p.load(variable), 0xf1234567, 'the restored ANM has independent memory');
    assert.deepEqual(fm.bytes(block, sourceBytes.length), sourceBytes);
    assert.equal(fp.load(fmMemory.guestAddress(fresh.main.id, fm, block + 4)), animated.pointer);
    assert.equal(fp.load(fmMemory.guestAddress(fresh.main.id, fm, shared + 4)), manifest.pointer);
    assert.deepEqual(await call(fresh, 0x2c0, [0, 1]), { control: 2 });
    assert.equal(fp.allocations.has(plain.pointer), false);
    assert.equal(fp.allocations.has(plainBitmap), false);
    await call(fresh, 0x2c0, [shared, 1]);
    assert.equal(fp.allocations.has(manifest.pointer), false);
    await call(fresh, 0x2c0, [block, 2]);
    assert.equal(fp.allocations.has(bitmap.pointer), false);
    assert.equal(fp.load(rawBitmap + 80), bitmapReferences - 1);
    assert.equal(fp.load(animated.pointer + 188), references - 1);
    const queryDestination = 0x80000180;
    fm.bytes(queryDestination, 40).fill(0xa5);
    assert.deepEqual(await call(fresh, 0x2c2, [animated.pointer, queryDestination]), {
      control: 1,
      value: 1,
    });
    assert.deepEqual(metadataAt(fm, queryDestination), metadataWords);
    assert.equal(fm.load(queryDestination + 36), 0xa5a5a5a5);
    assert.equal(fp.load(animated.pointer + 188), references - 1);
    assert.equal(fresh.runtime.scheduler.tasks.get(frameTask.id).machine.load(252), borrowed);
    assert.deepEqual(await call(fresh, 0x2c5, [animated.pointer, 0]), {
      control: 1,
      value: borrowed,
    });
    await drawBorrowedFrame(fresh, restored, nativeSurface, borrowed);
    const released = sourceBytes.slice();
    released.fill(0, 0, 8);
    released.fill(0, stride, stride + 8);
    assert.deepEqual(fm.bytes(block, released.length), released);
    await call(fresh, 0x154, [nativeSurface]);
    assert.deepEqual(
      await fresh.graphics.images.get(restored.state.renderer.bitmap).pixels(),
      pixels,
    );
    if (inspectFrame) assert.deepEqual(await inspectFrame(fresh), preview);
    await call(fresh, 0x102, [nativeSurface, 0]);
    await call(fresh, 0x102, [nativeSurface, 1]);
    assert.equal(fp.allocations.has(animated.pointer), false);
    assert.equal(fp.allocations.has(borrowed), false);
    assert.equal(p.allocations.get(borrowed), layout.wrapperBytes);
    assert.equal(fp.allocations.has(rawBitmap), false);
    assert.equal(restored.state.renderer.items.length, 0);
    assert.deepEqual(
      m.bytes(block, sourceBytes.length),
      sourceBytes,
      'fresh release is process-local',
    );
    assert.equal(p.load(animated.pointer + 188), references);
    assert.equal(p.load(rawBitmap + 80), bitmapReferences);
    await call(world, 0x2c0, [0, 1]);
    await call(world, 0x2c0, [shared, 1]);
    await call(world, 0x2c0, [block, 2]);
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}

export async function exerciseRenderSourceResize(make, layout, assert, preview) {
  const world = make(),
    source = 768,
    call = (owner, id, args) =>
      owner.runtime.native('main', id, args, owner.main.machine, owner.main),
    reject = async (operation, expected) => {
      try {
        await operation;
      } catch (error) {
        assert.equal(expected.test(error.message), true, error.message);
        return;
      }
      throw new Error('Invalid raw bitmap resize was accepted');
    },
    run = async (owner, name, input) => {
      const task = await owner.spawnScript(name);
      task.machine.store(256, input);
      await owner.runtime.scheduler.execute(task);
      return task;
    };
  let fresh;
  try {
    await world.initialize('main.kcs');
    const m = world.main.machine,
      p = world.nativeEngine.process,
      plain = m.load(4),
      plainBitmap = p.load(plain);
    assert.equal(m.load(0), 1);
    assert.deepEqual(await call(world, 0x7a, [plain, 8, 6]), { control: 2 });
    assert.deepEqual([p.load(plainBitmap + 4), p.load(plainBitmap + 8)], [8, 6]);
    const logical = (await call(world, 0x70, [3, 2])).value;
    await call(world, 0x174, [logical, 3, 2]);
    assert.deepEqual(await call(world, 0x2c1, [logical, 6, 4]), { control: 2 });
    const logicalBitmap = world.graphics.images.get(logical);
    assert.deepEqual([logicalBitmap.width, logicalBitmap.height], [6, 4]);
    await call(world, 0x72, [logical]);
    m.writeString('raw-resize.hg3', 1024);
    assert.deepEqual(await call(world, 0x2bf, [1024, source, 1]), { control: 1, value: 1 });
    assert.equal(m.load(source), 2);
    const script = await run(world, 'raw-resize.kcs', m.load(source + 4)),
      wrapper = script.machine.load(252),
      bitmap = p.load(wrapper),
      surface = await world.objects.create({ kind: 15, parent: world.main.id }),
      nativeSurface = world.nativeTaskID(surface);
    assert.equal(p.allocations.get(wrapper), layout.wrapperBytes);
    assert.equal(world.runtime.handles.records.has(wrapper), false);
    assert.deepEqual([p.load(bitmap + 4), p.load(bitmap + 8)], [6, 4]);

    const clone = p.allocate(layout.wrapperBytes);
    try {
      p.write(clone, p.read(wrapper, layout.wrapperBytes));
      await reject(call(world, 0x2c1, [clone, 3, 2]), /Unknown or released bitmap resize/);
    } finally {
      p.free(clone);
    }

    await call(world, 0x100, [nativeSurface, 64, 48]);
    await call(world, 0x104, [nativeSurface, 0, 0]);
    if (preview) await preview.show(world);
    const bind = async (owner) => {
      await bindBitmapSource(owner, wrapper, nativeSurface);
      await call(owner, 0x154, [nativeSurface]);
    };
    const checkPixels = async (owner, width, height) => {
      const draw = owner.graphics.drawTasks.get(surface),
        offscreen = await owner.graphics.images.get(draw.state.renderer.bitmap).pixels(),
        color = [49, 151, 211, 255],
        expected = new Uint8ClampedArray(64 * 48 * 4),
        positions = [];
      for (let y = 1; y < 1 + height; y++)
        for (let x = 4; x < 4 + width; x++) {
          const pixel = y * 64 + x;
          expected.set(color, ((47 - y) * 64 + x) * 4);
          positions.push(pixel);
        }
      assert.deepEqual(offscreen, expected, 'original Draw output after raw resize');
      if (preview) {
        const pixels = await preview.pixels(owner),
          actual = [];
        for (let i = 0; i < pixels.length; i += 4)
          if (color.every((v, j) => v === pixels[i + j])) actual.push(i / 4);
        assert.deepEqual(actual, positions, 'raw resize pixels reach the original tiled view');
      }
    };
    await bind(world);
    await checkPixels(world, 6, 4);
    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    const engine = fresh.nativeEngine,
      fp = engine.process,
      saved = fresh.runtime.scheduler.tasks.get(script.id).machine.load(252);
    assert.equal(saved, wrapper);
    await checkPixels(fresh, 6, 4);
    await call(fresh, 0x102, [nativeSurface, 1]);
    await run(fresh, 'raw-resize-again.kcs', saved);
    assert.deepEqual([fp.load(bitmap + 4), fp.load(bitmap + 8)], [12, 8]);
    assert.deepEqual([p.load(bitmap + 4), p.load(bitmap + 8)], [6, 4]);
    await bind(fresh);
    await checkPixels(fresh, 12, 8);

    // Queue a resize while the wrapper is still live, but let release run first.
    let resume, rejected;
    const gate = new Promise((resolve) => (resume = resolve)),
      waitQueued = async (count) => {
        for (let i = 0; i < 100 && engine.pendingCalls < count; i++) await Promise.resolve();
        assert.equal(engine.pendingCalls, count, 'resize and release reached the native queue');
      },
      wrapperBytes = fp.read(wrapper, layout.wrapperBytes),
      bitmapBytes = fp.allocations.get(bitmap),
      references = fp.load(bitmap + 80);
    engine.queue = engine.queue.then(() => gate);
    const release = call(fresh, 0x2c0, [source, 1]);
    try {
      await waitQueued(1);
      rejected = reject(call(fresh, 0x7a, [saved, 3, 2]), /released before execution/);
      await waitQueued(2);
    } finally {
      resume();
      await release;
      await rejected;
    }
    assert.equal(fp.allocations.has(saved), false);
    assert.equal(fp.allocations.get(bitmap), bitmapBytes, 'Draw still owns the resized bitmap');
    assert.equal(fp.load(bitmap + 80), references - 1);
    await reject(call(fresh, 0x2c1, [saved, 3, 2]), /Unknown or released bitmap resize/);
    const occupied = [];
    try {
      while (fp.freeBlocks[0]?.address < saved) {
        const { address, size } = fp.freeBlocks[0];
        occupied.push(fp.allocate(Math.min(size, saved - address)));
      }
      const reused = fp.allocate(layout.wrapperBytes);
      occupied.push(reused);
      assert.equal(reused, saved, 'reuse the exact released address and allocation size');
      fp.write(reused, wrapperBytes);
      await reject(call(fresh, 0x7a, [saved, 3, 2]), /Unknown or released bitmap resize/);
    } finally {
      for (const pointer of occupied.reverse()) fp.free(pointer);
    }
    await checkPixels(fresh, 12, 8);
    await call(fresh, 0x2c0, [0, 1]);
    await call(world, 0x2c0, [source, 1]);
    await call(world, 0x2c0, [0, 1]);
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}

export async function exerciseBitmapAlpha(make, assert) {
  const world = make(),
    call = (owner, id, args) =>
      owner.runtime.native('main', id, args, owner.main.machine, owner.main),
    imageColor = async (owner, handle) => [
      ...(await owner.graphics.images.get(handle).pixels()).slice(0, 4),
    ],
    scale = async (owner, input, percentage) => {
      const task = await owner.spawnScript('bitmap-alpha.kcs', { parent: owner.main.id });
      try {
        task.machine.store(256, input);
        task.machine.store(260, percentage);
        await owner.runtime.scheduler.execute(task);
        assert.equal(task.status, 'finished');
        assert.deepEqual([task.machine.load(256), task.machine.load(260)], [input, percentage]);
      } finally {
        await owner.objects.release(task.id);
      }
    },
    expectRejection = async (operation, expected) => {
      try {
        await operation;
      } catch (error) {
        assert.equal(expected.test(error.message), true, error.message);
        return;
      }
      throw new Error('Invalid alpha-scaler bitmap input was accepted');
    };
  let fresh;
  try {
    await world.initialize('main.kcs');
    const p = world.nativeEngine.process,
      m = world.main.machine,
      wrapper = m.load(4),
      bitmap = p.load(wrapper),
      pixel = p.load(bitmap + 12),
      before = p.load(pixel),
      references = p.load(bitmap + 80),
      withAlpha = (value) => ((before & 0xffffff) | (value << 24)) >>> 0,
      alpha = before >>> 24;
    assert.equal(m.load(0), 1);
    assert.equal(p.load(bitmap + 24), 4);
    assert.equal(alpha > 0, true);
    assert.equal(world.runtime.handles.records.has(wrapper), false);
    await scale(world, wrapper, 25);
    assert.equal(p.load(pixel), withAlpha(alpha >>> 2));
    assert.equal(p.load(bitmap + 80), references);

    const handle = (await call(world, 0x70, [3, 2])).value,
      alias = world.graphics.images.alias(handle, world.main.id);
    await world.graphics.images.get(handle).fill(0, 0, 3, 2, 0x89123456);
    await call(world, 0x17a, [handle, 0]);
    await scale(world, alias, 50);
    assert.deepEqual(await imageColor(world, handle), [18, 52, 86, 68]);
    assert.deepEqual(await call(world, 0x179, [alias]), { control: 1, value: 0 });
    assert.deepEqual(await call(world, 0x281, [0]), { control: 2 });

    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    const engine = fresh.nativeEngine,
      rp = engine.process,
      saved = fresh.main.machine.load(4);
    assert.equal(saved, wrapper);
    assert.equal(rp.load(saved), bitmap);
    await scale(fresh, alias, 200);
    await scale(fresh, saved, 200);
    assert.deepEqual(await imageColor(fresh, handle), [18, 52, 86, 136]);
    assert.deepEqual(await imageColor(world, handle), [18, 52, 86, 68]);
    assert.equal(rp.load(pixel), withAlpha((alpha >>> 2) * 2));
    assert.equal(p.load(pixel), withAlpha(alpha >>> 2));
    assert.equal(rp.load(bitmap + 80), references);

    const waitQueued = async (count) => {
      for (let i = 0; i < 100 && engine.pendingCalls < count; i++) await Promise.resolve();
      assert.equal(engine.pendingCalls, count);
    };
    let resume, rejected;
    const gate = new Promise((resolve) => (resume = resolve));
    engine.queue = engine.queue.then(() => gate);
    const release = call(fresh, 0x2c0, [0, 1]);
    try {
      await waitQueued(1);
      rejected = expectRejection(call(fresh, 0x281, [saved, 25]), /released before execution/);
      await waitQueued(2);
    } finally {
      resume();
      await release;
      await rejected;
    }
    await expectRejection(call(fresh, 0x281, [saved, 25]), /Unknown or released bitmap alpha/);
    assert.equal(rp.allocations.has(saved), false);
    assert.equal(p.allocations.has(wrapper), true);
    assert.deepEqual(await call(world, 0x2c0, [0, 1]), { control: 2 });
    assert.equal(p.allocations.has(wrapper), false);
  } finally {
    await fresh?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
}
