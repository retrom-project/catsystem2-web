// SPDX-License-Identifier: MPL-2.0
// Stage placement and pixel effects adapted from CatSystemKit StageLayout (OWCramer).
function boxBlur(pixels, width, height, radius, horizontal) {
  const count = horizontal ? width : height,
    lines = horizontal ? height : width,
    step = horizontal ? 4 : width * 4,
    span = radius * 2 + 1;
  for (let l = 0; l < lines; l++) {
    const start = horizontal ? l * width * 4 : l * 4,
      line = new Uint8Array(count * 4),
      sum = [0, 0, 0, 0];
    for (let i = 0; i < count; i++)
      for (let c = 0; c < 4; c++) line[i * 4 + c] = pixels[start + i * step + c];
    for (let k = -radius; k <= radius; k++)
      for (let c = 0; c < 4; c++) sum[c] += line[Math.max(0, Math.min(count - 1, k)) * 4 + c];
    for (let i = 0; i < count; i++)
      for (let c = 0; c < 4; c++) {
        pixels[start + i * step + c] = Math.floor(sum[c] / span);
        sum[c] +=
          line[Math.min(count - 1, i + radius + 1) * 4 + c] - line[Math.max(0, i - radius) * 4 + c];
      }
  }
}
export class StageRenderer {
  constructor(renderer, emote) {
    this.renderer = renderer;
    this.emote = emote;
    this.effects = new WeakMap();
    this.plane = new OffscreenCanvas(renderer.canvas.width, renderer.canvas.height);
    this.mask = new OffscreenCanvas(renderer.canvas.width, renderer.canvas.height);
  }
  effect(frame, picture) {
    if (!picture.mode?.length && !picture.tone?.length && !picture.blur?.length)
      return this.renderer.frameCanvas(frame);
    const key = JSON.stringify([picture.mode, picture.tone, picture.blur]);
    let cache = this.effects.get(frame);
    if (!cache) this.effects.set(frame, (cache = new Map()));
    if (cache.has(key)) return cache.get(key);
    const rgba = new Uint8ClampedArray(frame.rgba),
      tone = (picture.tone || [100, 100, 100]).map(Number),
      blur = (picture.blur || [0, 0]).map(Number);
    for (let pass = 0; pass < 2; pass++) {
      if (blur[0] > 0) boxBlur(rgba, frame.width, frame.height, Math.floor(blur[0] / 2), true);
      if ((blur[1] || blur[0]) > 0)
        boxBlur(rgba, frame.width, frame.height, Math.floor((blur[1] || blur[0]) / 2), false);
    }
    for (let i = 0; i < rgba.length; i += 4) {
      const grey = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      for (let c = 0; c < 3; c++)
        rgba[i + c] = Math.round(
          ((picture.mode?.[0] === 'sepia' ? grey * [1.07, 0.89, 0.66][c] : rgba[i + c]) *
            (tone[c] ?? 100)) /
            100,
        );
    }
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    canvas.getContext('2d').putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
    if (cache.size > 8) cache.clear();
    cache.set(key, canvas);
    return canvas;
  }
  transform(ctx, plane) {
    ctx.translate(plane.x, plane.y);
    if (plane.rotation) ctx.rotate((plane.rotation * Math.PI) / 180);
    ctx.scale(plane.scaleX / 100, plane.scaleY / 100);
    ctx.translate(-plane.baseX, -plane.baseY);
  }
  async picture(stage, plane, picture, context) {
    const p = stage.place(picture),
      ctx = context;
    ctx.save();
    this.transform(ctx, plane);
    ctx.globalAlpha *= p.alpha / 255;
    ctx.translate(p.x, p.y);
    ctx.scale(((p.flipX ? -1 : 1) * p.scaleX) / 100, ((p.flipY ? -1 : 1) * p.scaleY) / 100);
    if (p.color !== null && p.color !== undefined) {
      ctx.fillStyle = `rgba(${(p.color >>> 16) & 255},${(p.color >>> 8) & 255},${p.color & 255},${(p.color >>> 24) / 255})`;
      ctx.fillRect(0, 0, stage.width, stage.height);
    } else if (p.file) {
      const f = await this.renderer.images.frame(p.file, p.frameID);
      ctx.drawImage(this.effect(f, p), f.offsetX - f.baseX, f.offsetY - f.baseY);
    }
    ctx.restore();
  }
  async render(stage, voice) {
    const r = this.renderer,
      ctx = r.ctx;
    r.begin();
    await this.emote.prepare(stage);
    const ordered = [
      ...Object.entries(stage.planes).map(([n, p]) => ({
        type: 'plane',
        n,
        p,
        priority: p.priority,
      })),
      ...Object.entries(stage.actors).map(([n, p]) => ({
        type: 'actor',
        n,
        p,
        priority: p.priority,
      })),
    ].sort(
      (a, b) =>
        a.priority - b.priority ||
        Number(a.type === 'actor') - Number(b.type === 'actor') ||
        Number(a.n) - Number(b.n),
    );
    for (const item of ordered) {
      const p = stage.place(item.p);
      if (!p.visible || p.alpha < 0.5) continue;
      if (item.type === 'actor') {
        const d = this.emote.drawing(stage, item.n, voice);
        if (d) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.drawImage(this.emote.gpu.render(d.model, d.list, d.alpha), 0, 0);
          ctx.restore();
        }
        continue;
      }
      const off = this.plane.getContext('2d');
      off.reset();
      if (p.color !== undefined) {
        off.fillStyle = `rgb(${(p.color >>> 16) & 255},${(p.color >>> 8) & 255},${p.color & 255})`;
        off.fillRect(0, 0, stage.width, stage.height);
      }
      const pictures = p.pictures.toSorted(
        (a, b) =>
          ['bg', 'cg', 'fg', 'fw', 'eg'].indexOf(a.kind) -
            ['bg', 'cg', 'fg', 'fw', 'eg'].indexOf(b.kind) || a.slot - b.slot,
      );
      for (const picture of pictures.filter((p) => !p.mask))
        await this.picture(stage, p, picture, off);
      const mask = pictures.find((p) => p.mask);
      if (mask) {
        const m = this.mask.getContext('2d');
        m.reset();
        await this.picture(stage, p, mask, m);
        off.save();
        off.globalCompositeOperation = 'destination-in';
        off.drawImage(this.mask, 0, 0);
        off.restore();
      }
      ctx.save();
      ctx.globalAlpha = p.alpha / 255;
      if (p.blendMode === 1) ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.plane, 0, 0);
      ctx.restore();
    }
  }
}
