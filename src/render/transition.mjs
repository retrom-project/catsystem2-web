// SPDX-License-Identifier: MPL-2.0
export class Transition {
  constructor(canvas, frames, start, kind, mask) {
    this.frames = Math.max(1, frames);
    this.start = start;
    this.kind = kind;
    this.old = new OffscreenCanvas(canvas.width, canvas.height);
    this.old.getContext('2d').drawImage(canvas, 0, 0);
    this.mask = mask;
    this.work = new OffscreenCanvas(canvas.width, canvas.height);
  }
  async composite(ctx, frame) {
    const progress = Math.max(0, Math.min(1, (frame - this.start) / this.frames));
    if (progress >= 1) return true;
    if (this.kind === 'rwipe' && this.mask) {
      if (!this.maskData) {
        const mask = await this.mask,
          canvas = new OffscreenCanvas(mask.width, mask.height),
          c = canvas.getContext('2d');
        c.putImageData(
          new ImageData(new Uint8ClampedArray(mask.rgba), mask.width, mask.height),
          0,
          0,
        );
        const scale = new OffscreenCanvas(this.old.width, this.old.height),
          sc = scale.getContext('2d');
        sc.drawImage(canvas, 0, 0, mask.width, mask.height, 0, 0, this.old.width, this.old.height);
        this.maskData = sc.getImageData(0, 0, this.old.width, this.old.height).data;
        this.oldData = this.old
          .getContext('2d')
          .getImageData(0, 0, this.old.width, this.old.height);
      }
      const rgba = this.oldData.data,
        edge = 0.08;
      for (let i = 3; i < rgba.length; i += 4)
        rgba[i] = Math.round(
          255 *
            Math.max(
              0,
              Math.min(1, (this.maskData[i - 3] / 255 - progress * (1 + edge) + edge) / edge),
            ),
        );
      this.work.getContext('2d').putImageData(this.oldData, 0, 0);
      ctx.drawImage(this.work, 0, 0);
    } else {
      if (this.kind === 'rwmos') {
        const size = Math.max(1, Math.round(48 * (1 - progress))),
          small = new OffscreenCanvas(
            Math.ceil(this.old.width / size),
            Math.ceil(this.old.height / size),
          );
        small.getContext('2d').drawImage(ctx.canvas, 0, 0, small.width, small.height);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, this.old.width, this.old.height);
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.drawImage(this.old, 0, 0);
      ctx.restore();
    }
    return false;
  }
}
