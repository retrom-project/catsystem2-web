// SPDX-License-Identifier: MPL-2.0
// Browser event/Win32 device boundary. Each InputTask keeps its own timers and
// captures; all Top tasks attached to one browser window read the same device.
import { nativeInputBitmapMask } from './input.mjs';
export function createNativeInputBrowserServices(world, record, input, options = {}) {
  const bindings = () => world.inputBindings,
    primary = () => world.input ?? input,
    foreground = () =>
      options.foreground?.() ?? (typeof document === 'undefined' || document.hasFocus()),
    dimensions = () => world.graphics?.view?.virtualSize() ?? [world.game.width, world.game.height];
  return {
    poll: async () => {
      const pending = bindings()?.touchEvents;
      if (pending?.length) {
        const device = await world.getNativeFeature('input-device');
        while (pending.length) await device.touch([pending.shift()]);
      }
      await world.nativeEngine?.features.get('input-device')?.poll();
      bindings()?.sync(input);
      input.foreground = foreground();
    },
    pointer: () => {
      const source = primary(),
        [width, height] = dimensions(),
        inside = source.x >= 0 && source.x < width && source.y >= 0 && source.y < height,
        device = bindings();
      // 710C30 retains its last inside flag while focused outside the client;
      // only a point inside or an unfocused outside sample changes that flag.
      let value = device ? device.inside : input.cursorBlocked;
      if (inside) value = 1;
      else if (!foreground()) value = 0;
      if (device) device.inside = value;
      return { x: source.x, y: source.y, blocked: value };
    },
    // Engine.hover/pointerButton already receive virtual coordinates from the
    // canvas. A second view conversion here would scale those points twice.
    screenToVirtual: (x, y) => [x, y],
    virtualToScreen: (x, y) => {
      const [width, height] = dimensions();
      return x >= 0 && x < width && y >= 0 && y < height ? [x, y] : null;
    },
    warp: (x, y) => {
      primary().pointer(x, y);
      world.host.nativePointerWarped?.(x, y);
    },
    queryKey: (index, slot) => {
      const device = bindings();
      if (device) return device.query(index, slot);
      if (input.pulses[index]) {
        input.pulses[index]--;
        return 1;
      }
      const at = index * 4 + slot;
      return input.keys[at] ? input.sources[at] : 0;
    },
    repeat: (index, slot) => bindings()?.repeat[index] ?? input.repeatEnabled[index * 4 + slot],
    setPulse: (index, count) => {
      const device = bindings();
      if (device) device.setPulse(index, count);
      else input.pulses[index] = count;
    },
    clearKeys: async () => {
      const device = bindings();
      if (device) device.clearKeys();
      else {
        input.keys.fill(0);
        input.sources.fill(0);
      }
      await world.nativeEngine?.features.get('input-device')?.control('clear');
    },
    finishFrame: async () => {
      await world.nativeEngine?.features.get('input-device')?.finishFrame();
      bindings()?.finishFrame();
    },
    mouseState: () => {
      const state = bindings()?.mouseState;
      return state
        ? new Uint8Array(state.buffer, state.byteOffset, state.byteLength)
        : input.mouseState;
    },
    takePointerActivation: () => {
      const device = bindings();
      if (!device) return false;
      const value = device.pointerActivation;
      device.pointerActivation = false;
      return value;
    },
    joypad: async (enabled) => {
      bindings()?.setJoypad(enabled);
      await world.nativeEngine?.features.get('input-device')?.control('joypad', enabled);
    },
    killTouch: async () => {
      const device = await world.getNativeFeature('input-device');
      await device.control('touchReset');
      if (bindings()) bindings().touchActive = false;
    },
    touchHold: async (enabled) => {
      const device = await world.getNativeFeature('input-device');
      await device.control('touchEnable', enabled);
      if (bindings())
        bindings().touchHoldEnabled = enabled
          ? world.configuration.getField('application.touch')
          : 0;
    },
    cancelWheel: async () => {
      const device = await world.getNativeFeature('input-device');
      await device.control('wheelCancel');
      bindings()?.cancelWheel();
    },
    notifyCursor: (visible) =>
      world.sendNativeEngine(0, record.id, 11, 0, 4, {
        payload: {
          load: (address) =>
            [0, 0, world.nativeTaskID(record.id), 22, 0, visible, 0][address / 4] >>> 0,
        },
      }),
    alphaMask: async (bitmap, context) => {
      if (context.nativePointer) {
        const engine = await world.ensureNativeEngine(),
          p = engine.process,
          output = p.allocate(12, true),
          sdk = world.profile.startsWith('sdk-'),
          call =
            context.fromHost || engine.process.awaitingHost
              ? engine.callFromHost.bind(engine)
              : engine.call.bind(engine);
        try {
          await call(sdk ? 0x4c2fa0 : 0x5e6ce0, [bitmap, output]);
          const bytes = p.load(output),
            width = p.load(output + 4),
            height = p.load(output + 8);
          if (!bytes) return null;
          const alpha = {
            width,
            height,
            bytes: p.read(bytes, Math.ceil(width / 8) * height).slice(),
          };
          await call(sdk ? 0x575e10 : 0x6a4b00, [bytes]);
          return alpha;
        } finally {
          p.free(output);
        }
      }
      return nativeInputBitmapMask(world.graphics.images.get(bitmap));
    },
    cursorEnabled: () => world.graphics.cursor.state.visibleWord,
    cursorImage: async (name, x, y) => {
      if (!world.host.nativeCursorImageChanged)
        throw new Error('Browser renderer has no native cursor-image plane');
      return world.host.nativeCursorImageChanged(name, x, y, world);
    },
    devicePointer: async () => {
      if (options.devicePointer) return options.devicePointer();
      return (await world.getNativeFeature('input-device')).pointer();
    },
  };
}
