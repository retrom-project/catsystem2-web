// SPDX-License-Identifier: MPL-2.0
// The original view3D owns screen-effect phases, render-target captures and
// depth passes. GraphManager draws original models and merges host callbacks
// through the shared graphics platform.
const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    render: 0x675ee0,
    changed: 0x67e370,
  },
  'sdk-4.01-engine-2.6.1.74': {
    render: 0x54cff0,
    changed: 0x555000,
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
    this.platform.graphRendering.frameProvider = () => this.currentFrame();
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
  close() {
    this.platform.graphRendering.frameProvider = null;
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
      // Host callbacks and original models share the native manager's client
      // rectangle before the original view applies its dirty,
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
