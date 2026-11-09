// SPDX-License-Identifier: MPL-2.0
// SDK WinMain loads the optional ANSI catalogue before constructing Engine.
const SDK_LANGUAGE = {
  profile: 'sdk-4.01-engine-2.6.1.74',
  global: 0xcc2bf8,
  constructHead: 0x47dbb0,
  load: 0x47e690,
  destroy: 0x98cf90,
};

export async function initializeSDKLanguage(engine) {
  const layout = SDK_LANGUAGE;
  if (engine.profile !== layout.profile) return;
  const p = engine.process;
  if (p.load(layout.global)) throw new Error('Original SDK language table already has an owner');
  // Use the same sentinel constructor as the original static initializer.
  // The engine process owns its teardown instead of registering CRT atexit.
  const head = p.call(layout.constructHead, [], layout.global);
  if (p.allocations.get(head) !== 64)
    throw new Error('Original SDK language sentinel was not allocated');
  p.store(layout.global, head);
  const loaded = await p.callAsync(layout.load);
  if ((loaded !== 0 && loaded !== 1) || p.load(layout.global) !== head)
    throw new Error('Original SDK language loader lost its table');
  engine.refs.startupLanguage = { head, loaded: Boolean(loaded) };
}

export function releaseSDKLanguage(engine) {
  const state = engine.refs.startupLanguage;
  if (!state) return;
  const layout = SDK_LANGUAGE,
    p = engine.process;
  if (engine.profile !== layout.profile || p.load(layout.global) !== state.head)
    throw new Error('Original SDK language table has inconsistent ownership');
  p.call(layout.destroy);
  if (p.allocations.has(state.head))
    throw new Error('Original SDK language table was not released');
  p.store(layout.global, 0);
  delete engine.refs.startupLanguage;
}
