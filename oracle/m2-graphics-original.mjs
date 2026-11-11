// SPDX-License-Identifier: MPL-2.0
// Platform records shared with the reconstructed graph manager. M2 animation
// and its graph callback remain original executable code.
import { NativeGraphicTask } from '../src/native/graphics.mjs';
import { conditionalNativeGraphicsBoundary } from '../src/native/exe-boundary.mjs';
import { advanceD3DContext } from '../src/ppi/render-state.mjs';
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
    const ownGraph = (nativeID) => {
      const task = owner.tasks.get(this.engine.currentTaskID);
      return task?.record.nativeID === nativeID;
    };
    this.customBoundaries = [
      conditionalNativeGraphicsBoundary(
        this.engine,
        0x675440,
        'M2 create custom plane',
        2,
        ([nativeID]) =>
          ownGraph(nativeID) && p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0 === this.refs.view,
        ([, type]) => {
          if (type !== 1) throw new Error(`M2 graph type ${type} needs its graph factory`);
          owner.tasks.get(this.engine.currentTaskID).plane.makeGraph({
            type: 1,
            width: this.world.game.width,
            height: this.world.game.height,
            colors: [0xffffffff],
            vram: false,
          });
          return 1;
        },
      ),
      conditionalNativeGraphicsBoundary(
        this.engine,
        0x67e3d0,
        'M2 set custom callback',
        5,
        ([nativeID, , , object]) =>
          ownGraph(nativeID) && owner.tasks.get(this.engine.currentTaskID).pointer === object,
        ([, index, callback, object, flag]) => {
          if (index || flag) throw new Error('M2 custom graph uses an unsupported primitive slot');
          this.callbacks.set(this.engine.currentTaskID, { callback, object });
          return 1;
        },
      ),
    ];
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
      customBoundaries: this.customBoundaries.map(({ trap }) => trap),
    });
  }
  restore(state) {
    this.callbacks = new Map(structuredClone(state.callbacks));
    this.stencils = new Map(structuredClone(state.stencils));
    state.customBoundaries.forEach((trap, i) => (this.customBoundaries[i].trap = trap));
  }
  close() {
    for (const boundary of this.customBoundaries) boundary.detach();
    this.unsubscribe();
    for (const [name, surface] of this.stencils) while (surface.references > 0) this.release(name);
  }
}
