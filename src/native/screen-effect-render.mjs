// SPDX-License-Identifier: MPL-2.0
// The original view3D owns screen-effect phases, render-target captures and
// depth passes. Only its graph enumeration crosses to the shared host graphs.
import { bitsFloat } from '../kcs.mjs';

const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    render: 0x675ee0,
    changed: 0x67e370,
    graphs: 0x67bb20,
    state: 0x671df0,
    fvf: 0x673060,
  },
  'sdk-4.01-engine-2.6.1.74': {
    render: 0x54cff0,
    changed: 0x555000,
    graphs: 0x5527c0,
    state: 0x548c10,
    fvf: 0x549e80,
  },
};
const nativeItem = (item) => Boolean(item.p?.nativeGraph || item.type === 'particle');
const compare = (a, b) =>
  a.priority - b.priority || (a.order ?? 0) - (b.order ?? 0) || Number(a.n) - Number(b.n);

export class NativeScreenEffectRenderer {
  constructor(effects) {
    Object.assign(this, {
      effects,
      engine: effects.engine,
      process: effects.process,
      world: effects.world,
      platform: effects.platform,
    });
    this.abi = ABI[this.engine.profile];
    this.frame = null;
    this.engine.patch(
      this.abi.graphs,
      'screen-effect shared graph rendering',
      3,
      (args) => this.graphs(args),
      { calleePops: true },
    );
  }
  get active() {
    const view = this.platform.refs.view3D;
    return Boolean(view && this.process.load(view + 192));
  }
  get device() {
    const renderer = this.engine.features.get('renderer');
    if (!renderer?.initialized)
      throw new Error('Screen-effect rendering requires the original initialized view');
    return renderer.d3d;
  }
  call(address, args = [], pointer) {
    const task = this.engine.currentTaskID;
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, { task })
      : this.engine.call(address, args, pointer, { task });
  }
  currentFrame() {
    if (this.frame) return this.frame;
    // Immediate captures (676050 / 67FED0) occur in script execution before a
    // presented frame. They read the same live graph and particle resources.
    const items = [
      ...Object.entries(this.world.graphics.stage.planes)
        .filter(([, p]) => p.nativeGraph)
        .map(([n, p]) => ({ n, p, priority: p.priority })),
      ...(this.world.particles?.drawItems() ?? []),
    ].sort(compare);
    return {
      items,
      draw: async (item, gpu) => {
        if (item.drawGPU) await item.drawGPU(gpu, { fromHost: true });
        else await this.world.graphics.get(Number(item.n)).drawGPU(gpu, { fromHost: true });
      },
    };
  }
  async graphs([out, minimum, maximum]) {
    const p = this.process,
      lo = bitsFloat(minimum),
      hi = bitsFloat(maximum);
    p.zero(out, 8);
    if (hi <= 0) return out;
    await this.call(this.abi.state, [0, 0, 1], this.platform.refs.renderer);
    await this.call(this.abi.fvf, [324], this.platform.refs.renderer);
    const frame = this.currentFrame();
    await this.device.hostDraw(async (gpu) => {
      for (const item of frame.items)
        if (lo <= item.priority && item.priority < hi) await frame.draw(item, gpu);
    });
    return out;
  }
  async render(items, draw, present) {
    if (this.frame) throw new Error('Screen-effect frame rendering cannot be reentered');
    if (typeof present !== 'function')
      throw new Error('Native effects require their shared presentation target');
    this.frame = { items: items.filter(nativeItem), draw };
    const device = this.device,
      previousPresent = device.onPresent;
    device.onPresent = present;
    this.platform.sync();
    try {
      // The graph list lives on the host. Submitting it invalidates the native
      // manager's client rectangle before the original view applies its dirty,
      // pause, effect, Present and recording gates in their normal order.
      await this.call(this.abi.changed, [0], this.platform.refs.manager);
      await this.call(this.abi.render, [], this.platform.refs.view);
    } finally {
      this.platform.pull();
      device.onPresent = previousPresent;
      this.frame = null;
    }
    return true;
  }
}
