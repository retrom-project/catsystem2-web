// SPDX-License-Identifier: MPL-2.0
// Original view screenshot/recording state, backed by the shared actual device.
import { nativeABI } from '../src/native/abi/index.mjs';
import { nativeReply } from '../src/kcs/vm.mjs';
import { formatNativeAt } from '../src/kcs.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NATIVE_STARTUP_BLOCKS } from '../src/native/engine-startup-block.mjs';

export const NATIVE_SCREEN_CAPTURE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x71, words: 0, control: 1, handlers: [0x64b690, 0x518290] }),
  Object.freeze({ id: 0x1b9, words: 3, control: 2, handlers: [0x64fad0, 0x51b2e0] }),
  Object.freeze({ id: 0x235, words: 0, control: 1, handlers: [0x650500, 0x51bb40] }),
  Object.freeze({ id: 0x236, words: 0, control: 1, handlers: [0x64ff40, 0x51b5b0] }),
]);
export const NATIVE_SCREEN_CAPTURE_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    capture: 0x6758e0,
    recording: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.screenCapture.recording,
    counter: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.screenCapture.counter,
    prefix: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.screenCapture.prefix,
    menuHandler: 0x530200,
    menuCapture: 0x5305ef,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    capture: 0x54ca70,
    recording: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.screenCapture.recording,
    counter: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.screenCapture.counter,
    prefix: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.screenCapture.prefix,
    menuHandler: 0x442080,
    menuCapture: 0x44240a,
  }),
});
const byID = new Map(NATIVE_SCREEN_CAPTURE_CONTRACTS.map((spec) => [spec.id, spec]));
export class NativeScreenCapture {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.layout = NATIVE_SCREEN_CAPTURE_LAYOUTS[engine.profile];
    if (!this.layout) throw new Error('Screen capture requires a reviewed engine');
    this.sdk = engine.profile.startsWith('sdk-');
    engine.registerFeature('screen-capture', this);
  }
  call(address, args, pointer, task) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, { task })
      : this.engine.call(address, args, pointer, { task });
  }
  async screenshot(task) {
    const platform = await this.world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    const wrapper = await this.call(this.layout.capture, [], platform.refs.view, task.id);
    if (!wrapper) return nativeReply(1, 0);
    const images = this.world.graphics.images,
      buffers = await this.world.getNativeFeature('data-buffers'),
      memory = await this.world.getNativeFeature('bitmap-memory');
    let handle = 0;
    try {
      // The original screenshot owns a 536-byte image wrapper. Transfer its
      // original bitmap into the canonical Script-owned image list; KCS sees
      // a typed bitmap handle and the raw pixel allocation is never copied.
      handle = images.create(0, 0, task.id);
      await memory.adopt(handle, this.process.load(wrapper));
      return nativeReply(1, handle);
    } catch (error) {
      if (handle) await images.release(handle);
      throw error;
    } finally {
      await buffers.releaseBitmapPointer(wrapper);
    }
  }
  async menuBitmap() {
    const { engine, world, process: p, layout } = this,
      owner = p.load(NATIVE_STARTUP_BLOCKS[engine.profile] + 36),
      view = engine.features.get('graphics-platform')?.refs.view;
    if (!owner || !view || !world.configuration.authorMode) return;
    const buffers = await world.getNativeFeature('data-buffers'),
      bitmap = await this.call(layout.capture, [], view);
    if (!bitmap) return;
    let detach;
    try {
      // The desktop requests the same capture from its render worker. The
      // browser already serializes frames, so return the worker result at
      // that call site and leave the name search, row copy and encoder intact.
      detach = p.beforeInstruction(layout.menuCapture, 'screen capture worker result', () => {
        p.cpu.reg_write_i32(p.uc.X86_REG_EAX, bitmap);
        p.cpu.reg_write_i32(p.uc.X86_REG_EIP, layout.menuCapture + 5);
      });
      await this.call(layout.menuHandler, [world.window.handle, 0x111, 40030, 0, 0], owner);
    } finally {
      detach?.();
      await buffers.releaseBitmapPointer(bitmap);
    }
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    if (id === 0x71) return this.screenshot(task);
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    if (id === 0x1b9) {
      const bytes = (this.world.runtime.services.formatBytes ?? formatNativeAt)(words[1], machine);
      if (
        (nativeABI(this.engine.profile).text.recordingPrefix.units === 'bytes'
          ? bytes.length
          : new TextDecoder('shift_jis').decode(bytes).length) >=
        nativeABI(this.engine.profile).text.recordingPrefix.limit
      )
        throw new RangeError('Native recording prefix exceeds its original view field');
    }
    const platform = await this.world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    if (id === 0x235 || id === 0x236)
      return nativeReply(
        1,
        this.process.load(
          platform.refs.view + (id === 0x235 ? this.layout.recording : this.layout.counter),
        ),
      );
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(Math.max(4, words.length * 4)),
      out = p.allocate(4),
      host = p.allocate(120, true);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      p.store(host + 116, platform.refs.view);
      const control = await this.call(
        spec.handlers[Number(this.sdk)],
        [bridge.pointer, host, argv, out],
        undefined,
        task.id,
      );
      if (control !== spec.control)
        throw new Error('Native screen-capture wrapper changed its control');
      return nativeReply(control, control === 1 ? p.load(out) : undefined);
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(host);
        p.free(out);
        p.free(argv);
      }
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeScreenCapture(world) {
  world.registerNativeFeature('screen-capture', (engine) => new NativeScreenCapture(engine, world));
  for (const { id } of NATIVE_SCREEN_CAPTURE_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('screen-capture')).apply(id, args, machine, task),
    );
}
