// SPDX-License-Identifier: MPL-2.0
// The original lookup helpers require their static tree even with no files.
const LANGUAGE = {
  'sdk-4.01-engine-2.6.1.74': {
    global: 0xcc2bf8,
    constructHead: 0x47dbb0,
    size: 64,
    load: 0x47e690,
    destroy: 0x98cf90,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    global: 0xbc3880,
    constructHead: 0x5ad7a0,
    size: 28,
    destroy: 0x8c1050,
  },
};

export async function initializeNativeLanguage(engine) {
  const layout = LANGUAGE[engine.profile];
  const p = engine.process;
  if (p.load(layout.global)) throw new Error('Original language table already has an owner');
  // Use the same sentinel constructor as the original static initializer.
  // The engine process owns its teardown instead of registering CRT atexit.
  const head = p.call(layout.constructHead, [], layout.global);
  if (p.allocations.get(head) !== layout.size)
    throw new Error('Original language sentinel was not allocated');
  p.store(layout.global, head);
  // SDK WinMain loads language.txt before constructing the Engine owner.
  const loaded = layout.load ? await p.callAsync(layout.load) : 0;
  if ((loaded !== 0 && loaded !== 1) || p.load(layout.global) !== head)
    throw new Error('Original language loader lost its table');
  engine.refs.startupLanguage = { head, loaded: Boolean(loaded) };
}

export function releaseNativeLanguage(engine) {
  const state = engine.refs.startupLanguage;
  if (!state) return;
  const layout = LANGUAGE[engine.profile],
    p = engine.process;
  if (p.load(layout.global) !== state.head)
    throw new Error('Original language table has inconsistent ownership');
  p.call(layout.destroy);
  if (p.allocations.has(state.head)) throw new Error('Original language table was not released');
  p.store(layout.global, 0);
  delete engine.refs.startupLanguage;
}
