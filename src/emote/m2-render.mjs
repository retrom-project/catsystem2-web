// SPDX-License-Identifier: MPL-2.0
// M2 has a transparent model target and a separate, screen-sized composite.
// Both targets and every upload belong to StageRenderer.
const f = Math.fround;

export class M2Render {
  constructor(stage, width, height) {
    this.stage = stage;
    this.width = width;
    this.height = height;
    this.surface = stage.createSurface(width, height);
    const aspect = f(height / width),
      distance = f(height * 0.5);
    this.matrix = Float32Array.of(
      aspect,
      0,
      0,
      0,
      0,
      -1,
      0,
      0,
      0,
      0,
      1,
      1,
      f(-0.5 * aspect),
      0.5,
      distance,
      distance,
    );
    this.vertices = Array.from({ length: 4 }, (_, i) => ({
      x: (i & 1 ? width : 0) - 0.5,
      y: (i & 2 ? height : 0) - 0.5,
      z: 0.5,
      w: 1,
      color: 0xffffffff,
      u: i & 1 ? 1 : 0,
      v: i & 2 ? 1 : 0,
    }));
    this.quad = [
      { vertices: [this.vertices[0], this.vertices[1], this.vertices[2]] },
      { vertices: [this.vertices[2], this.vertices[1], this.vertices[3]] },
    ];
  }
  draw(
    geometry,
    {
      context,
      color = 0xffffffff,
      tone = [100, 100, 100],
      depth = 0.5,
      view,
      fadeAlpha = 256,
      previous,
    } = {},
  ) {
    let texture = this.stage.drawEmoteSurface(this.surface, geometry, { matrix: this.matrix });
    if (fadeAlpha < 256) {
      this.mixed ??= this.stage.createSurface(this.width, this.height);
      if (previous) {
        this.previous ??= this.stage.createSurface(this.width, this.height);
        this.stage.drawEmoteSurface(this.previous, previous, { matrix: this.matrix });
      }
      texture = this.stage.blendSurfaces(
        this.mixed,
        this.surface,
        previous ? this.previous : null,
        fadeAlpha,
      );
    }
    let packed = color & 0xff000000;
    for (let i = 0; i < 3; i++) {
      const shift = (2 - i) * 8,
        channel = (color >>> shift) & 255,
        level = Math.floor(((tone[i] * 255) >>> 0) / 100);
      packed |= Math.min(255, Math.floor((level * channel) / 255)) << shift;
    }
    const scale = view?.deviceScale ?? 1,
      offset = view?.deviceOffset ?? [0, 0];
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i];
      v.color = packed >>> 0;
      v.z = depth;
      v.x = f(f(f((i & 1 ? this.width : 0) * scale) + offset[0]) - 0.5);
      v.y = f(f(f((i & 2 ? this.height : 0) * scale) + offset[1]) - 0.5);
    }
    this.stage.gpu.drawGeometry(this.quad, texture, {
      context,
      drawType: 0,
      opaqueTarget:
        this.stage.gpu.target === this.stage.gpu.primaryTarget || this.stage.gpu.frameOpaqueTarget,
    });
  }
  close() {
    for (const id of [this.surface, this.mixed, this.previous])
      if (id) this.stage.releaseSurface(id);
  }
}
