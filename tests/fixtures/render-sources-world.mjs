// SPDX-License-Identifier: MPL-2.0
import { encodeCP932, floatBits } from '../../src/kcs.mjs';

function sourceName(name, wide) {
  if (!wide) return encodeCP932(name + '\0');
  const bytes = new Uint8Array((name.length + 1) * 2),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < name.length; i++) view.setUint16(i * 2, name.charCodeAt(i), true);
  return bytes;
}

async function bindSources(world, records, nativeSurface) {
  const p = world.nativeEngine.process,
    packet = p.allocate(60, true);
  try {
    for (const [index, { tag, pointer }] of records.entries()) {
      const fields = [
        tag === 1 ? p.load(pointer) : 0,
        0,
        tag === 2 ? pointer : 0,
        0,
        ...[index * 4, 1, 0, 0, 0, 1, 1].map(floatBits),
        255,
        1,
        0,
      ];
      fields.forEach((word, i) => p.store(packet + i * 4, word));
      await world.sendNativeEngine(nativeSurface, world.main.id, 280, index, packet, {
        nativePointer: true,
        payload: { load: (address) => p.load(address) },
      });
    }
  } finally {
    p.free(packet);
  }
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
    await bindSources(world, records, nativeSurface);
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
    assert.ok(references > 1 && bitmapReferences > 1);

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
