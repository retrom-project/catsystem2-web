// SPDX-License-Identifier: MPL-2.0
// Keep GraphManager's model lookup, stable list, transforms and draw branches
// in the mounted executable. Only host callbacks join that traversal.
import { bitsFloat } from '../src/kcs.mjs';
import { conditionalNativeGraphicsBoundary } from './graphics-task-original.mjs';

const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    draw: 0x67bb20,
    inserted: 0x67933d,
    removed: 0x67b87c,
    beforeGraph: 0x67bc02,
    beforeBackground: 0x67c379,
    state: 0x671df0,
    fvf: 0x673060,
    texture: 0x672f60,
    shader: 0x671cd0,
  },
  'sdk-4.01-engine-2.6.1.74': {
    draw: 0x5527c0,
    inserted: 0x55008d,
    removed: 0x55251c,
    beforeGraph: 0x5528a2,
    beforeBackground: 0x553019,
    state: 0x548c10,
    fvf: 0x549e80,
    texture: 0x549d80,
    shader: 0x548af0,
  },
};
const order = (item) => item.nativeRenderOrder ?? item.p?.nativeGraph?.renderOrder ?? Infinity;

export class NativeGraphRendering {
  constructor(platform) {
    Object.assign(this, {
      platform,
      engine: platform.engine,
      process: platform.process,
      world: platform.world,
      abi: ABI[platform.engine.profile],
      forwardOriginalEntry: false,
      frame: null,
      frameProvider: null,
    });
    const p = this.process,
      currentManager = (register) =>
        p.cpu.reg_read_i32(p.uc[register]) >>> 0 === this.platform.refs.manager;
    this.detachers = [
      p.beforeInstruction(this.abi.inserted, 'original graph insertion order', () => {
        if (!currentManager('X86_REG_EBX')) return;
        const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
          descriptor = p.load(sp + 24);
        this.world.graphics.nativeRenderOrder.set(
          descriptor,
          this.world.graphics.allocateRenderOrder(),
        );
      }),
      p.beforeInstruction(this.abi.removed, 'original graph removal order', () => {
        const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
        if (p.load(sp + 16) !== this.platform.refs.manager) return;
        const descriptor = p.cpu.reg_read_i32(p.uc.X86_REG_EDI) >>> 0;
        this.world.graphics.nativeRenderOrder.delete(descriptor);
      }),
      p.beforeInstruction(this.abi.beforeGraph, 'original graph host callback position', () => {
        if (!this.frame || !currentManager('X86_REG_EBP')) return;
        const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
          priority = bitsFloat(p.load(sp + 0x30)),
          node = p.cpu.reg_read_i32(p.uc.X86_REG_ESI) >>> 0,
          descriptor = p.load(node + 8),
          pendingBackground =
            !p.load(sp + 0x10) &&
            p.load(this.platform.refs.manager + 240) &&
            !p.load(this.platform.refs.manager + 540) &&
            priority > 55000;
        return this.flush(
          pendingBackground ? 55000 : priority,
          pendingBackground
            ? Infinity
            : (this.world.graphics.nativeRenderOrder.get(descriptor) ?? 0),
          sp,
        );
      }),
      p.beforeInstruction(this.abi.beforeBackground, 'original final background callbacks', () => {
        if (
          !this.frame ||
          !currentManager('X86_REG_EBP') ||
          !p.load(this.platform.refs.manager + 240) ||
          p.load(this.platform.refs.manager + 540)
        )
          return;
        return this.flush(55000, Infinity);
      }),
    ];
    this.boundary = conditionalNativeGraphicsBoundary(
      this.engine,
      this.abi.draw,
      'shared original graph and host draw traversal',
      3,
      () => {
        if (!currentManager('X86_REG_ECX')) return false;
        if (this.forwardOriginalEntry) {
          this.forwardOriginalEntry = false;
          return false;
        }
        return Boolean(this.frameProvider);
      },
      (args) => this.draw(args),
    );
  }
  get device() {
    const renderer = this.engine.features.get('renderer');
    if (!renderer?.initialized)
      throw new Error('Original model rendering requires its initialized native renderer');
    return renderer.d3d;
  }
  call(address, args, pointer) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer)
      : this.engine.call(address, args, pointer);
  }
  async flush(priority, beforeOrder, stack = null) {
    const frame = this.frame;
    if (!frame) return;
    const before = (item) =>
        item.priority < priority ||
        (item.priority === priority && (beforeOrder === Infinity || order(item) < beforeOrder)),
      next = frame.items[frame.index];
    if (!next || !before(next)) return;
    const p = this.process,
      core = this.platform.refs.renderer,
      context = this.world.graphics.d3dContext;
    context.lastDrawType = p.load(core + 340);
    context.lastBlend = p.load(core + 344);
    await this.device.hostDraw(async (gpu) => {
      while (frame.index < frame.items.length) {
        const item = frame.items[frame.index];
        if (!before(item)) break;
        frame.index++;
        await frame.draw(item, gpu);
      }
    });
    p.store(core + 340, context.lastDrawType ?? 0xffffffff);
    p.store(core + 344, context.lastBlend ?? 0xffffffff);
    // Match the original custom-model callback's postamble. Its caller keeps
    // the FVF choice both in EBX and a stack local while traversing models.
    await this.call(this.abi.state, [0, 0, 0], core);
    await this.call(this.abi.fvf, [324], core);
    await this.call(this.abi.texture, [0, 0], core);
    await this.call(this.abi.shader, [0], core);
    if (stack !== null) {
      p.cpu.reg_write_i32(p.uc.X86_REG_EBX, 1);
      p.store(stack + 0x14, 1);
    }
  }
  async draw([out, minimum, maximum]) {
    const previous = this.frame,
      lo = bitsFloat(minimum),
      hi = bitsFloat(maximum),
      source = this.frameProvider(),
      items = source.items
        .filter((item) => lo <= item.priority && item.priority < hi)
        .map((item, index) => ({ ...item, nativeFrameIndex: index }))
        .sort(
          (a, b) =>
            a.priority - b.priority ||
            order(a) - order(b) ||
            a.nativeFrameIndex - b.nativeFrameIndex,
        );
    this.frame = { items, index: 0, draw: source.draw };
    try {
      this.forwardOriginalEntry = true;
      await this.call(this.abi.draw, [out, minimum, maximum], this.platform.refs.manager);
      await this.flush(Infinity, Infinity);
      return out;
    } finally {
      this.forwardOriginalEntry = false;
      this.frame = previous;
    }
  }
  snapshot() {
    if (this.frame) throw new Error('Cannot checkpoint an in-flight native graph traversal');
    return { trap: this.boundary.trap };
  }
  restore(state) {
    this.boundary.trap = state.trap;
  }
  recoverTrap(trap) {
    return trap.name === 'shared original graph and host draw traversal'
      ? { args: 3, real: false, handler: (args) => this.draw(args) }
      : null;
  }
  close() {
    this.boundary.detach();
    for (const detach of this.detachers) detach();
    this.frameProvider = null;
  }
}
