// SPDX-License-Identifier: MPL-2.0
// Temporary model callback data bridge. Phase6.6 removes this bridge with
// the old Plane traversal. It installs no executable instruction hooks.
import { bitsFloat, floatBits } from '../src/kcs.mjs';
export class NativeAreaGeometryProjection {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.callbacks = new Map();
    engine.registerFeature('area-geometry-projection', this);
  }
  callback(id, [, count, address, triangle]) {
    const p = this.process,
      vertices = Array.from({ length: count }, (_, i) => {
        const at = address + i * 16;
        return Object.fromEntries(
          ['x', 'y', 'z', 'w'].map((key, j) => [key, bitsFloat(p.load(at + j * 4))]),
        );
      }),
      effect = this.world.areaEffects.tasks.get(id);
    if (!effect) throw new Error('Area model callback lost its JS owner');
    const result = effect.vertices(vertices, triangle);
    result.forEach((vertex, i) =>
      ['x', 'y', 'z', 'w'].forEach((key, j) =>
        p.store(address + i * 16 + j * 4, floatBits(vertex[key])),
      ),
    );
    return 1;
  }
  model(nativeID) {
    const platform = this.engine.features.get('graphics-platform'),
      descriptor = platform?.descriptor(nativeID),
      p = this.process;
    if (!descriptor) return null;
    const color = p.load(descriptor + 12),
      model = [16, 20, 24, 12, 8].map((at) => p.load(descriptor + at)).find(Boolean);
    if (!model) return null;
    return {
      triangles() {
        const count = color ? Math.floor(p.load(color + 344) / 3) : 0,
          data = color && p.load(color + 336);
        if (!data || !count) return [];
        return Array.from({ length: count }, (_, i) =>
          Array.from({ length: 3 }, (_, j) =>
            Array.from({ length: 4 }, (_, k) => bitsFloat(p.load(data + i * 48 + j * 16 + k * 4))),
          ),
        );
      },
      bind: (effect) => {
        let callback = this.callbacks.get(effect.record.id);
        if (!callback) {
          const id = effect.record.id;
          callback = p.trap('JS area model callback ' + id, 4, (args) => this.callback(id, args));
          this.callbacks.set(id, callback);
        }
        p.store(model + 236, callback);
        p.store(model + 240, 0);
        p.store(model + 244, 0);
      },
      unbind() {
        p.store(model + 236, 0);
        p.store(model + 240, 0);
        p.store(model + 244, 0);
      },
    };
  }
  snapshot() {
    return { callbacks: [...this.callbacks] };
  }
  restore(state) {
    this.callbacks = new Map(state.callbacks);
  }
  recoverTrap(trap) {
    const match = /^JS area model callback (\d+)$/.exec(trap.name);
    return match
      ? { args: 4, real: false, handler: (args) => this.callback(Number(match[1]), args) }
      : null;
  }
}
