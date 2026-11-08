// SPDX-License-Identifier: MPL-2.0
// Legacy binary gallery-name/variant tables use their original native parsers.
// Bytes and heap references belong to the shared engine, not to handle copies.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

export const NATIVE_GALLERY_TABLE_IDS = Object.freeze(
  Array.from({ length: 12 }, (_, i) => 0x195 + i),
);
export const NATIVE_GALLERY_TABLE_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    handlers: [
      0x650bb0, 0x650ce0, 0x650d10, 0x650e00, 0x650d40, 0x650d70, 0x650da0, 0x652350, 0x652490,
      0x6524c0, 0x6524f0, 0x652530,
    ],
    path: 0xb8fb50,
    category: 0x5d39e0,
    file: 0x5d50f0,
    variantCtor: 0x78e330,
    variantParse: 0x78e350,
    nameCtor: 0x78ce10,
    nameParse: 0x78ce30,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    handlers: [
      0x51c0d0, 0x51c1c0, 0x51c1f0, 0x51c2e0, 0x51c220, 0x51c250, 0x51c280, 0x51dec0, 0x51dfc0,
      0x51dff0, 0x51e020, 0x51e060,
    ],
    path: 0xc94678,
    category: 0x4b0830,
    file: 0x4b1ca0,
    variantCtor: 0x6264a0,
    variantParse: 0x6264c0,
    nameCtor: 0x624f70,
    nameParse: 0x624f90,
  }),
});
export const nativeGalleryTableCodec = Object.freeze({
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
});
const word = (value) => nativeReply(1, value >>> 0);
const done = () => nativeReply(2);

async function load(id, args, machine, services, heap, layout) {
  try {
    machine.region(args[0] >>> 0, 1);
  } catch {
    throw new Error('Native gallery-table formatting reads an unmapped source');
  }
  const p = heap.process,
    variants = id === 0x195,
    formatted = services.formatBytes(args[0], machine).slice(),
    end = formatted.indexOf(0),
    name = end < 0 ? formatted : formatted.subarray(0, end),
    input = p.allocate(name.length + 1, true),
    category = p.allocate(4, true);
  let source = 0,
    pointer = 0,
    retainSource = false;
  try {
    p.write(input, name);
    p.write(category, Uint8Array.of(102, 101, 115, 0));
    // The original formatter reports success for an empty mapped string too.
    await heap.call(layout.category, [layout.path, input, category]);
    const size = await heap.call(layout.file, [layout.path, 0, 3]);
    if (!size && !variants) {
      services.diagnostic?.({ type: 'gallery-table-missing', resource: p.string(layout.path) });
      return word(0);
    }
    source = heap.allocateData(size);
    const read = await heap.call(layout.file, [layout.path, source, 3]);
    pointer = p.allocate(4, true);
    await heap.call(variants ? layout.variantCtor : layout.nameCtor, [], pointer);
    await heap.call(variants ? layout.variantParse : layout.nameParse, [source, read], pointer);
    // The original 19C wrapper retains its temporary input allocation. Keep
    // that same guest allocation until process teardown, rather than freeing
    // a pointer which the original heap would still regard as live.
    retainSource = !variants;
    const handle = services.handles.add('gallery-table', {
      kind: variants ? 'variants' : 'names',
      pointer,
    });
    pointer = 0;
    return word(handle);
  } finally {
    if (pointer) {
      const data = p.load(pointer);
      if (data) heap.releaseData(data);
      p.free(pointer);
    }
    if (source && !retainSource) heap.releaseData(source);
    p.free(category);
    p.free(input);
  }
}
async function query(id, args, machine, services, heap, layout) {
  const record = services.handles.get(args[0], 'gallery-table'),
    variants = id <= 0x19b;
  if (record.kind !== (variants ? 'variants' : 'names'))
    throw new Error('Native gallery table has a different binary layout');
  const world = services.world,
    taskMemory =
      world?.objects.machine(services.owner) === machine
        ? await world.getNativeFeature('task-memory')
        : null;
  if (taskMemory) taskMemory.vmPointer(services.owner);
  const p = heap.process,
    bridge = new NativeKCSMemory(p, machine, taskMemory?.mapMachine(services.owner, machine)),
    counts = [1, 1, 1, 2, 3, 3, 6, 1, 1, 1, 4, 3],
    count = counts[id - 0x195],
    argv = p.allocate(count * 4),
    out = p.allocate(4);
  try {
    for (let i = 0; i < count; i++)
      p.store(
        argv + i * 4,
        !i ? record.pointer : i < args.length ? args[i] : machine.nativeArgument(i),
      );
    p.store(out, 0xcccccccc);
    const control = await heap.call(layout.handlers[id - 0x195], [bridge.pointer, 0, argv, out]);
    if (id === 0x196 || id === 0x19d) services.handles.release(args[0], 'gallery-table');
    return nativeReply(control, control === 1 ? p.load(out) : undefined);
  } finally {
    try {
      bridge.close();
    } finally {
      p.free(out);
      p.free(argv);
    }
  }
}
export function nativeGalleryTable(id, args, machine, services = {}) {
  if (!NATIVE_GALLERY_TABLE_IDS.includes(id)) return undefined;
  const isLoad = id === 0x195 || id === 0x19c;
  if (!isLoad && !args[0]) return id === 0x196 || id === 0x19d ? done() : word(0);
  if (!services.handles || typeof services.dataBuffers !== 'function') return undefined;
  if (isLoad && typeof services.formatBytes !== 'function') return undefined;
  return (async () => {
    const heap = await services.dataBuffers(),
      layout = NATIVE_GALLERY_TABLE_LAYOUTS[heap.engine.profile];
    if (!layout) throw new Error('Native gallery tables require a reviewed engine profile');
    if (isLoad && services.world) await services.world.getNativeFeature('engine-files');
    return isLoad
      ? load(id, args, machine, services, heap, layout)
      : query(id, args, machine, services, heap, layout);
  })();
}
