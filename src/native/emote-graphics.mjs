// SPDX-License-Identifier: MPL-2.0
// Platform records shared with the reconstructed graph manager. M2 animation
// and its graph callback remain original executable code.
import { NativeGraphicTask } from './graphics.mjs';
import { advanceD3DContext } from '../ppi/render-state.mjs';
export class NativeEmoteGraphics {
  constructor(owner, platform) {
    this.owner = owner;
    this.engine = owner.engine;
    this.process = owner.process;
    this.world = owner.world;
    this.platform = platform;
    this.callbacks = new Map();
    this.stencils = new Map();
    const p = this.process;
    platform.attachDevice(owner.device.d3d.device);
    this.unsubscribe = platform.onDestroy((id) => this.callbacks.delete(id));
    const patch = (address, name, count, fn) =>
      this.engine.patch(address, name, count, fn, { calleePops: true });
    const resolve = (id) => this.world.resolveTaskID(id, this.engine.currentTaskID);
    patch(0x675440, 'graph create custom plane', 2, ([nativeID, type]) => {
      const id = resolve(nativeID);
      if (type !== 1) throw new Error(`M2 graph type ${type} needs its graph factory`);
      const task = this.owner.tasks.get(id);
      if (!task) throw new Error(`M2 graph ${id} has no task`);
      task.plane.makeGraph({
        type: 1,
        width: this.world.game.width,
        height: this.world.game.height,
        colors: [0xffffffff],
        vram: false,
      });
      return 1;
    });
    patch(0x67e3d0, 'graph set custom callback', 5, ([nativeID, index, callback, object, flag]) => {
      const id = resolve(nativeID);
      if (index || flag) throw new Error('M2 custom graph uses an unsupported primitive slot');
      if (!this.owner.tasks.has(id)) return 0;
      this.callbacks.set(id, { callback, object });
      return 1;
    });
    patch(0x66fe70, 'renderer acquire named stencil surface', 3, ([name, width, height]) =>
      this.acquire(p.string(name), width, height),
    );
    patch(
      0x670620,
      'renderer find named stencil surface',
      1,
      ([name]) => this.stencils.get(p.string(name))?.pointer ?? 0,
    );
    patch(0x671170, 'renderer release named stencil surface', 1, ([name]) =>
      this.release(p.string(name)),
    );
    patch(0x671df0, 'global fixed-function draw state', 3, ([drawType, blendMode, force]) => {
      advanceD3DContext(this.world.graphics.d3dContext, {
        drawType,
        blendMode,
        force: Boolean(force),
      });
      p.store(this.refs.renderer + 340, this.world.graphics.d3dContext.lastDrawType);
      p.store(this.refs.renderer + 344, this.world.graphics.d3dContext.lastBlend);
    });
    this.sync();
  }
  get refs() {
    return this.platform.refs;
  }
  sync() {
    this.platform.sync();
  }
  pull() {
    this.platform.pull();
  }
  plane(record) {
    const plane = new NativeGraphicTask(this.world.graphics, record);
    return plane;
  }
  acquire(name, width, height) {
    let surface = this.stencils.get(name);
    if (surface) {
      surface.references++;
      if (surface.width >= width && surface.height >= height) return 1;
      this.owner.device.d3d.release(this.owner.device.d3d.objects.get(surface.pointer));
    }
    const output = this.process.allocate(4, true);
    try {
      const result = this.owner.device.d3d.createSurface(
        { width, height, format: 75, multisample: 0, quality: 0, discard: 0, usage: 2, pool: 0 },
        output,
      );
      if (result) return 0;
      this.stencils.set(name, {
        width,
        height,
        pointer: this.process.load(output),
        references: surface?.references ?? 1,
      });
      return 1;
    } finally {
      this.process.free(output);
    }
  }
  release(name) {
    const surface = this.stencils.get(name);
    if (!surface) return;
    if (--surface.references <= 0) {
      this.owner.device.d3d.release(this.owner.device.d3d.objects.get(surface.pointer));
      this.stencils.delete(name);
    }
  }
  snapshot() {
    return structuredClone({
      callbacks: [...this.callbacks],
      stencils: [...this.stencils],
    });
  }
  restore(state) {
    this.callbacks = new Map(structuredClone(state.callbacks));
    this.stencils = new Map(structuredClone(state.stencils));
  }
  close() {
    this.unsubscribe();
    for (const [name, surface] of this.stencils) while (surface.references > 0) this.release(name);
  }
}
