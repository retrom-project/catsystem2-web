// SPDX-License-Identifier: MPL-2.0
// Screenshots and recording consume the JS compositor's completed framebuffer.
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { formatNativeAt } from '../kcs.mjs';
import { nativeDataArgument } from './data-text.mjs';
export const NATIVE_SCREEN_CAPTURE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x71, words: 0, control: 1 }),
  Object.freeze({ id: 0x1b9, words: 3, control: 2 }),
  Object.freeze({ id: 0x235, words: 0, control: 1 }),
  Object.freeze({ id: 0x236, words: 0, control: 1 }),
]);
export function encodeCaptureBMP(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new RangeError('Capture pixel dimensions differ');
  const bytes = new Uint8Array(54 + rgba.length),
    view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(34, rgba.length, true);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4,
        to = 54 + ((height - 1 - y) * width + x) * 4;
      bytes.set([rgba[from + 2], rgba[from + 1], rgba[from], rgba[from + 3]], to);
    }
  return bytes;
}
export class NativeScreenCapture {
  constructor(world) {
    this.world = world;
    this.state = { recording: 0, counter: 0, prefix: '' };
    this.busy = false;
  }
  frame() {
    const stage = this.world.stageRenderer,
      gpu = stage.gpu;
    if (!gpu) return null;
    const target = gpu.primaryTarget;
    return { width: target.width, height: target.height, rgba: gpu.pixels(target) };
  }
  async screenshot(task) {
    if (!this.world.graphics.view.active) return nativeReply(1, 0);
    const frame = this.frame();
    if (!frame) return nativeReply(1, 0);
    const { width, height, rgba } = frame,
      images = this.world.graphics.images,
      handle = images.create(width, height, task.id),
      bitmap = images.get(handle),
      pixels = await bitmap.pixels(),
      stride = width * 4;
    for (let y = 0; y < height; y++)
      pixels.set(rgba.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
    bitmap.changed();
    return nativeReply(1, handle);
  }
  async writeBitmap(filename) {
    const frame = this.frame();
    if (!frame) return false;
    if (!this.world.storage?.write) throw new Error('Screen capture storage is unavailable');
    return this.world.storage.write(
      filename,
      encodeCaptureBMP(frame.width, frame.height, frame.rgba),
    );
  }
  async menuBitmap() {
    if (!this.world.configuration.authorMode || !this.world.graphics.view.active) return;
    for (let i = 0; i <= 0x7fffffff; i++) {
      const filename = `cap${String(i).padStart(4, '0')}.bmp`;
      if ((await this.world.storage.read(filename)) !== null) continue;
      await this.writeBitmap(filename);
      return;
    }
    throw new RangeError('Screen capture filename sequence is exhausted');
  }
  async afterPresent() {
    if (!this.state.recording) return;
    if (this.busy) throw new Error('Frame recording cannot be reentered');
    this.busy = true;
    try {
      const counter = this.state.counter | 0,
        digits = String(Math.abs(counter)).padStart(counter < 0 ? 9 : 10, '0'),
        filename =
          `${this.state.prefix}/${this.state.prefix}_${counter < 0 ? '-' : ''}${digits}.bmp`.replaceAll(
            '\\',
            '/',
          );
      await this.writeBitmap(filename);
      this.state.counter = (this.state.counter + 1) >>> 0;
    } finally {
      this.busy = false;
    }
  }
  async apply(id, args, machine, task) {
    if (id === 0x71) return this.screenshot(task);
    if (id === 0x235) return nativeReply(1, this.state.recording);
    if (id === 0x236) return nativeReply(1, this.state.counter);
    if (id !== 0x1b9) return undefined;
    const words = Array.from({ length: 3 }, (_, i) => nativeDataArgument(args, machine, i)),
      bytes = (this.world.runtime.services.formatBytes ?? formatNativeAt)(words[1], machine),
      prefix = new TextDecoder('shift_jis').decode(bytes),
      spec = nativeABI(this.world.profile).text.recordingPrefix;
    if ((spec.units === 'bytes' ? bytes.length : prefix.length) >= spec.limit)
      throw new RangeError('Native recording prefix exceeds its original view field');
    this.state = { recording: words[0] >>> 0, counter: words[2] >>> 0, prefix };
    return nativeReply(2);
  }
  snapshot() {
    if (this.busy) throw new Error('Cannot checkpoint an in-flight frame recording');
    return structuredClone(this.state);
  }
  restore(state) {
    this.state = structuredClone(state);
  }
}
export function installNativeScreenCapture(world) {
  const capture = (world.screenCapture = new NativeScreenCapture(world));
  world.registerNativeFeature('screen-capture', (engine) => {
    engine.registerFeature('screen-capture', capture);
    return capture;
  });
  for (const { id } of NATIVE_SCREEN_CAPTURE_CONTRACTS)
    world.runtime.register('main', id, (args, machine, task) =>
      capture.apply(id, args, machine, task),
    );
}
