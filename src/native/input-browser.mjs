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
      bindings()?.pollTouch();
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
    },
    finishFrame: async () => {
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
    },
    killTouch: async () => {
      bindings()?.killTouch();
    },
    touchHold: async (enabled) => {
      bindings()?.touchHold(enabled);
    },
    cancelWheel: async () => {
      bindings()?.cancelWheel();
    },
    notifyCursor: (visible) =>
      world.sendNativeEngine(0, record.id, 11, 0, 4, {
        payload: {
          load: (address) =>
            [0, 0, world.nativeTaskID(record.id), 22, 0, visible, 0][address / 4] >>> 0,
        },
      }),
    alphaMask: async (bitmap, context = {}) => {
      if (context.nativePointer)
        throw new Error('Physical input bitmap pointers require the explicit oracle Input service');
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
      throw new Error(
        'A physical Input device pointer requires explicit original-engine ownership',
      );
    },
  };
}
