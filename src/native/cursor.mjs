// SPDX-License-Identifier: MPL-2.0
// kcView cursor state: game 6771F0, software 681E20, D3D 680210/671A50.
export class NativeCursor {
  constructor(graphics, { backend = 'direct3d' } = {}) {
    if (!['software', 'direct3d'].includes(backend))
      throw new TypeError('Invalid native cursor backend');
    this.graphics = graphics;
    this.state = {
      backend,
      allowed: 1,
      visible: true,
      visibleWord: 1,
      filename: '',
      requestedHotspot: [0, 0],
      hotspot: [0, 0],
      image: 0,
      backup: 0,
    };
  }
  get world() {
    return this.graphics.world;
  }
  changed() {
    this.world.host?.nativeCursorChanged?.(this.state.visible, this.world);
  }
  setVisible(visible) {
    if (!this.state.allowed) return 0;
    this.state.visibleWord = Number(visible) >>> 0;
    this.state.visible = Boolean(this.state.visibleWord);
    this.changed();
    return this.state.visibleWord;
  }
  async releaseImage() {
    if (this.state.image) await this.graphics.images.release(this.state.image);
    this.state.image = 0;
  }
  async setImage(filename, x, y) {
    const state = this.state;
    if (!state.allowed) return 0;
    state.filename = filename ?? '';
    state.requestedHotspot = [x | 0, y | 0];
    if (state.backend === 'software' || filename === null) await this.releaseImage();
    if (filename !== null) {
      const next = await this.graphics.images.load(filename),
        bitmap = next ? this.graphics.images.get(next) : null;
      if (
        bitmap &&
        (state.backend === 'software' ||
          (bitmap.state.bpp === 4 && bitmap.width === 32 && bitmap.height === 32))
      ) {
        if (state.backend === 'direct3d' && !state.backup)
          state.backup = this.graphics.images.add(bitmap.clone());
        await this.releaseImage();
        state.image = next;
        state.hotspot = [...state.requestedHotspot];
      } else if (next) await this.graphics.images.release(next);
    }
    this.changed();
    // The view wrapper always returns zero, including successful changes.
    return 0;
  }
  drawItems() {
    if (!this.state.visible || !this.state.image) return [];
    return [
      {
        priority: 0x7fffffff,
        order: 0x7fffffff,
        draw: async (context) => {
          const input = this.world.input,
            bitmap = this.graphics.images.get(this.state.image),
            source = await bitmap.context();
          // Both cursor backends consume the raw bitmap rectangle. Canvas,
          // origin and clipping metadata do not shift or resize the pointer.
          context.drawImage(
            source.canvas,
            input.x - this.state.hotspot[0],
            input.y - this.state.hotspot[1],
          );
        },
      },
    ];
  }
  snapshot() {
    return structuredClone(this.state);
  }
  restore(state) {
    this.state = structuredClone(state);
  }
  async close() {
    await this.releaseImage();
    if (this.state.backup) await this.graphics.images.release(this.state.backup);
    this.state.backup = 0;
    this.changed();
  }
}
