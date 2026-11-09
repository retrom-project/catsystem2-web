// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
// The SDK embeds V8 3.26.16. Execute its original static initializers and the
// JavaScript portion of WinMain's platform setup in the virtual x86 process.
const MOTION_CACHE = 0xc967ec,
  DEFAULT_MUTEX = 0xc981e4,
  DEFAULT_ISOLATE = 0xc981cc,
  ALLOCATOR = 0xc73b60,
  ALLOCATOR_VTABLE = 0x98e758,
  FLAGS =
    '--noconcurrent_sweeping --noparallel_sweeping --noconcurrent_recompilation --nouse_idle_notification';

export async function initializeSDKJavaScript(engine) {
  const p = engine.process;
  if (!nativeABI(engine.profile).capabilities.embeddedJavaScript)
    throw new Error('No original JavaScript platform for this profile');
  if (
    engine.refs.sdkJavaScript ||
    p.load(MOTION_CACHE) ||
    p.load(DEFAULT_ISOLATE) ||
    p.load(ALLOCATOR)
  )
    throw new Error('The original SDK JavaScript platform cannot be initialized twice');
  // The original static cache also belongs to plain JavaScript objects, even
  // when they never load a motion or create any FES object.
  const motionCache = await p.callAsync(0x622ad0, [0, 0]);
  if (
    p.allocations.get(motionCache) !== 0x114 ||
    p.load(motionCache) !== motionCache ||
    p.load(motionCache + 4) !== motionCache
  )
    throw new Error('The original SDK motion cache did not construct an empty list');
  p.store(MOTION_CACHE, motionCache);
  // Own the original static destructors instead of registering desktop CRT atexit.
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
  engine.refs.sdkJavaScript = { isolate, allocator, motionCache };
}

export async function releaseSDKJavaScript(engine) {
  const state = engine.refs.sdkJavaScript;
  if (!state) return;
  const p = engine.process,
    { isolate, allocator, motionCache } = state;
  if (
    !nativeABI(engine.profile).capabilities.embeddedJavaScript ||
    p.load(MOTION_CACHE) !== motionCache ||
    p.allocations.get(motionCache) !== 0x114 ||
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
  await p.callAsync(0x98d1a0);
  if (p.allocations.has(motionCache))
    throw new Error('The original SDK motion cache did not release its list');
  p.store(MOTION_CACHE, 0);
  delete engine.refs.sdkJavaScript;
}
