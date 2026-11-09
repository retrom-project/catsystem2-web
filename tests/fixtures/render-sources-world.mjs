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

async function bindBitmapSource(world, pointer, nativeSurface) {
  const p = world.nativeEngine.process,
    packet = p.allocate(60, true);
  try {
    p.store(packet, p.load(pointer));
    drawWords(pointer, 4)
      .slice(1)
      .forEach((word, i) => p.store(packet + 16 + i * 4, word));
    await world.sendNativeEngine(nativeSurface, world.main.id, 280, 1, packet, {
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
    world = make(),
    call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main),
    recordAt = (machine, address) => ({
      tag: machine.load(address),
      pointer: machine.load(address + 4),
    });
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

    const preview = inspectFrame ? await inspectFrame(world) : null;
    fresh = make();
    await fresh.restore(structuredClone(world.snapshot()));
    const fm = fresh.main.machine,
      fp = fresh.nativeEngine.process,
      restored = fresh.graphics.drawTasks.get(surface),
      fmMemory = await fresh.getNativeFeature('task-memory');
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
