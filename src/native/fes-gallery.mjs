// SPDX-License-Identifier: MPL-2.0
// The original loadlist commands read a kcCGList from the FES interpreter.
// Bind the current instance's list and registration bytes for that call.
const layouts = {
  'sdk-4.01-engine-2.6.1.74': [1740, 0x628d80, 0x628e10, 0x629080, 0x629050],
  'nekopara-vol3-engine-2.6.1.76': [2000, 0x790ba0, 0x790c30, 0x790ea0, 0x790e70],
};

export async function withNativeFESGallery(runtime, instance, execute) {
  const [offset, construct, destroy, readList, readSeen] = layouts[runtime.engine.profile],
    p = runtime.process,
    slot = runtime.interpreter + offset,
    previous = p.load(slot),
    gallery = instance.cgGallery,
    bytes = gallery?.listBytes;
  if (!bytes?.length) {
    p.store(slot, 0);
    try {
      return await execute();
    } finally {
      p.store(slot, previous);
    }
  }
  const seen = gallery.registry.write(),
    pointer = p.allocate(16, true),
    call = (address, args = []) => runtime.call(address, args, pointer, instance.runtimeID);
  let constructed = false;
  async function transfer(address, data) {
    if (!data.length) return;
    const source = p.allocate(data.length);
    try {
      p.write(source, data);
      await call(address, [source, data.length]);
    } finally {
      p.free(source);
    }
  }
  try {
    if ((await call(construct)) !== pointer)
      throw new Error('Original FES gallery did not construct its list owner');
    constructed = true;
    await transfer(readList, bytes);
    await transfer(readSeen, seen);
    p.store(slot, pointer);
    return await execute();
  } finally {
    p.store(slot, previous);
    try {
      if (constructed) await call(destroy);
    } finally {
      p.free(pointer);
    }
  }
}
