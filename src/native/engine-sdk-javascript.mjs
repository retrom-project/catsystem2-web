// SPDX-License-Identifier: MPL-2.0
// The SDK embeds V8 3.26.16. Execute its original static initializers and the
// JavaScript portion of WinMain's platform setup in the virtual x86 process.
const SDK = 'sdk-4.01-engine-2.6.1.74',
  DEFAULT_MUTEX = 0xc981e4,
  DEFAULT_ISOLATE = 0xc981cc,
  ALLOCATOR = 0xc73b60,
  ALLOCATOR_VTABLE = 0x98e758,
  FLAGS =
    '--noconcurrent_sweeping --noparallel_sweeping --noconcurrent_recompilation --nouse_idle_notification';

export async function initializeSDKJavaScript(engine) {
  const p = engine.process;
  if (engine.profile !== SDK) throw new Error('No original JavaScript platform for this profile');
  if (engine.refs.sdkJavaScript || p.load(DEFAULT_ISOLATE) || p.load(ALLOCATOR))
    throw new Error('The original SDK JavaScript platform cannot be initialized twice');
  // Run the constructor from the first static initializer and own its
  // teardown explicitly, in place of registering the desktop CRT atexit.
  await p.callAsync(0x743660, [], DEFAULT_MUTEX);
  await p.callAsync(0x433ac0);
  await p.callAsync(0x433ad0);
  const flags = p.allocate(FLAGS.length + 1, true);
  try {
    engine.kernel.writeString(flags, FLAGS);
    // Use original V8 settings for one guest CPU and a clock that advances
    // between game frames. Allocation-triggered collection remains native.
    if ((await p.callAsync(0x665d70, [flags, FLAGS.length])) !== 0)
      throw new Error('The original SDK JavaScript platform rejected the thread settings');
    if ((await p.callAsync(0x49f9d7)) !== 1)
      throw new Error('The original SDK JavaScript platform did not initialize');
  } finally {
    p.free(flags);
  }
  const isolate = p.load(DEFAULT_ISOLATE),
    allocator = p.load(ALLOCATOR);
  if (
    p.allocations.get(isolate) !== 0x59a0 ||
    p.load(isolate + 0x1a50) !== 1 ||
    p.allocations.get(allocator) !== 4 ||
    p.load(allocator) !== ALLOCATOR_VTABLE ||
    p.load(0xc98210) !== allocator
  )
    throw new Error('The original SDK JavaScript platform lost its owners');
  engine.refs.sdkJavaScript = { isolate, allocator };
}

export async function releaseSDKJavaScript(engine) {
  const state = engine.refs.sdkJavaScript;
  if (!state) return;
  const p = engine.process,
    { isolate, allocator } = state;
  if (
    engine.profile !== SDK ||
    p.load(DEFAULT_ISOLATE) !== isolate ||
    p.load(ALLOCATOR) !== allocator ||
    p.load(allocator) !== ALLOCATOR_VTABLE
  )
    throw new Error('The original SDK JavaScript platform ownership changed');
  if (((await p.callAsync(0x65bcc0)) & 0xff) !== 1 || p.allocations.has(isolate))
    throw new Error('The original SDK JavaScript platform did not dispose its isolate');
  await p.callAsync(p.load(ALLOCATOR_VTABLE), [1], allocator);
  if (p.allocations.has(allocator))
    throw new Error('The original SDK JavaScript platform did not dispose its allocator');
  p.store(ALLOCATOR, 0);
  await p.callAsync(0x98d270);
  delete engine.refs.sdkJavaScript;
}
