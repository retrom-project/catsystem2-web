// SPDX-License-Identifier: MPL-2.0
class OriginalStagePresentation {
  presentNative({ device, source, destination, window, dirty, stageTarget }) {
    if (stageTarget) {
      const ctx = this.renderer.ctx;
      ctx.reset();
      ctx.drawImage(this.gpu.presentTarget(stageTarget), 0, 0);
      return 0;
    }
    const p = device.process,
      ctx = this.renderer.ctx,
      record = device.surfaceData(device.backbuffer),
      target = device.gpuTarget(device.backbuffer),
      rectangle = (pointer, fallback) =>
        pointer ? Array.from({ length: 4 }, (_, i) => p.load(pointer + i * 4) | 0) : fallback;
    if (window && window !== device.presentation[7])
      throw new Error('Native presentation targets an unknown window');
    if (dirty) p.read(dirty, 32);
    const src = rectangle(source, [0, 0, record.width, record.height]),
      dst = rectangle(destination, [0, 0, this.renderer.canvas.width, this.renderer.canvas.height]);
    const canvas = this.gpu.presentTarget(target);
    ctx.reset();
    if (src[2] > src[0] && src[3] > src[1] && dst[2] > dst[0] && dst[3] > dst[1])
      ctx.drawImage(
        canvas,
        src[0],
        src[1],
        src[2] - src[0],
        src[3] - src[1],
        dst[0],
        dst[1],
        dst[2] - dst[0],
        dst[3] - dst[1],
      );
    return 0;
  }
}
export function installOriginalStagePresentation(world) {
  Object.defineProperty(
    world.stageRenderer,
    'originalPresent',
    Object.getOwnPropertyDescriptor(OriginalStagePresentation.prototype, 'presentNative'),
  );
}
