// SPDX-License-Identifier: MPL-2.0
// Particle atlases own immutable StageRenderer surfaces, separate from DLLs.
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeParticleNear } from '../ppi/numeric.mjs';

export class NativeParticleTextures {
  constructor(world) {
    this.world = world;
    this.stage = world.stageRenderer;
    this.owned = new Set();
  }
  frame(pointer) {
    if (!this.owned.has(pointer)) throw new Error('Particle atlas has no live JS owner');
    return this.stage.surfaceFrame(pointer);
  }
  release(pointer) {
    if (!this.owned.delete(pointer)) throw new Error('Particle atlas was already released');
    this.stage.releaseSurface(pointer);
  }
  async load({ texture, priority, externalDraw }, previous) {
    const bytes = texture instanceof Uint8Array ? texture : encodeCP932((texture ?? '') + '\0');
    if (bytes.length > 128 || !bytes.includes(0))
      throw new RangeError('Particle texture name does not fit its 128 byte field');
    const atlas = {
      pointer: 0,
      width: previous?.width ?? 0,
      height: previous?.height ?? 0,
      priority: previous?.priority ?? 0,
      near: previous?.near ?? 0,
    };
    if (externalDraw) return atlas;
    atlas.near = nativeParticleNear(priority);
    if (!bytes[0]) return atlas;
    const name = new TextDecoder('shift_jis').decode(bytes.subarray(0, bytes.indexOf(0))),
      images = this.world.graphics.images,
      handle = await images.load(name);
    atlas.width = atlas.height = 256;
    atlas.priority = priority;
    if (!handle) return atlas;
    try {
      const bitmap = images.get(handle),
        input = await bitmap.frame(),
        width = 2 ** Math.ceil(Math.log2(input.width)),
        height = 2 ** Math.ceil(Math.log2(input.height)),
        rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < input.height; y++)
        rgba.set(
          input.rgba.subarray(
            (input.height - 1 - y) * input.width * 4,
            (input.height - y) * input.width * 4,
          ),
          y * width * 4,
        );
      atlas.pointer = this.stage.createSurface(width, height, rgba);
      this.owned.add(atlas.pointer);
      atlas.width = input.width;
      atlas.height = input.height;
      return atlas;
    } finally {
      await images.release(handle);
    }
  }
  snapshot() {
    return { surfaces: this.stage?.snapshotSurfaces(this.owned) ?? [] };
  }
  restore(state) {
    for (const pointer of [...this.owned]) this.release(pointer);
    if (state.surfaces.length) this.stage.restoreSurfaces(state.surfaces);
    this.owned = new Set(state.surfaces.map(([id]) => id));
  }
}
