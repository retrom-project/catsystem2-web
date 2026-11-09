// SPDX-License-Identifier: MPL-2.0
// The original view owns its view3D, graph manager, D3D core and GDI bitmap.
// The browser owns one COM device and the Windows services those objects use.
import { EmoteD3D9 } from '../emote/native-d3d.mjs';
import { NativeGraphicsPlatform } from './graphics-process.mjs';
import { installNativeDirectSound } from './windows-directsound.mjs';

export const NATIVE_RENDERER_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    viewConstruct: 0x673bb0,
    viewDestroy: 0x6741f0,
    coreGlobal: 0xb90778,
    capsConstruct: 0x5c62e0,
    capsDestroy: 0x5c63f0,
    capsGlobal: 0xb8f074,
    bitmap: 148,
    bits: 152,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    viewConstruct: 0x54ad10,
    viewDestroy: 0x54b2b0,
    coreGlobal: 0xc95180,
    capsConstruct: 0x4a30e0,
    capsDestroy: 0x4a31f0,
    capsGlobal: 0xc93b94,
    bitmap: 116,
    bits: 120,
  }),
});

export class NativeRenderer {
  static async open(engine, world) {
    // Share the existing GDI/DC/font/DIB namespace, and the original IFile
    // adapter. Neither dependency initializes a view or a graphics device.
    await world.getNativeFeature('text');
    await world.getNativeFeature('engine-files');
    await world.getNativeFeature('bitmap-memory');
    const platform =
      engine.features.get('graphics-platform') ?? new NativeGraphicsPlatform(engine, world);
    return new NativeRenderer(engine, world, platform);
  }
  constructor(engine, world, platform) {
    Object.assign(this, { engine, world, platform, process: engine.process });
    this.layout = NATIVE_RENDERER_LAYOUTS[engine.profile];
    if (!this.layout) throw new Error('Native renderer requires a reviewed engine image');
    if (engine.refs.renderer) throw new Error('Native renderer already has an owner');
    engine.refs.renderer = { initialized: false, viewStarted: false, caps: 0 };
    const view = world.graphics.view;
    this.d3d = new EmoteD3D9(this.process, {
      width: view.clientWidth,
      height: view.clientHeight,
      context: world.graphics.d3dContext,
      recordCommands: false,
    });
    const gpu = world.getNativeGPU?.();
    if (gpu) this.d3d.attachGPU(gpu);
    this.installWindows();
    engine.registerFeature('renderer', this);
  }
  get refs() {
    return this.engine.refs.renderer;
  }
  get initialized() {
    return this.refs.initialized;
  }
  get view() {
    return this.platform.refs.view;
  }
  get view3D() {
    return this.platform.refs.view3D;
  }
  get core() {
    return this.platform.refs.renderer;
  }
  call(address, args = [], pointer) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer)
      : this.engine.call(address, args, pointer);
  }
  installWindows() {
    const p = this.process,
      kernel = this.engine.kernel,
      world = this.world,
      register = (dll, name, count, fn) => this.engine.registerWindows(dll, name, { count, fn }),
      hwnd = world.window?.handle ?? 1;
    this.engine.features.get('text').windows.windowPixelSources.set(hwnd, () => {
      const target = world.stageRenderer?.renderer,
        canvas = target?.canvas;
      if (!canvas || !target.ctx)
        throw new Error('Native GDI window capture requires its presented browser canvas');
      return {
        width: canvas.width,
        height: canvas.height,
        rgba: target.ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      };
    });
    register('D3D9.dll', 'Direct3DCreate9', 1, ([version]) => {
      if (version !== 32) return 0;
      this.d3d.retain(this.d3d.objects.get(this.d3d.d3d));
      return this.d3d.d3d;
    });
    kernel.registerHostModule('d3d9.dll', {
      Direct3DCreate9: kernel.resolve({ dll: 'D3D9.dll', name: 'Direct3DCreate9' }),
    });
    installNativeDirectSound(this.engine, () => Boolean(world.audio));
    register('USER32.dll', 'IsWindow', 1, ([handle]) => Number(handle === hwnd));
    register('USER32.dll', 'IsIconic', 1, ([handle]) =>
      Number(handle === hwnd && Boolean(world.host.nativeWindowMinimized?.())),
    );
    for (const name of ['GetClientRect', 'GetWindowRect'])
      register('USER32.dll', name, 2, ([handle, out]) => {
        if (handle !== hwnd) return 0;
        const view = world.graphics.view;
        [0, 0, view.clientWidth, view.clientHeight].forEach((n, i) => p.store(out + i * 4, n));
        return 1;
      });
  }
  initialize() {
    if (this.initialized) return Promise.resolve(this);
    if (!this.initializing) this.initializing = this.initializeView();
    return this.initializing;
  }
  initializeCapabilities() {
    if (this.initializingCaps) return this.initializingCaps;
    if (this.refs.caps) return Promise.resolve(this.refs.caps);
    this.initializingCaps = this.constructCapabilities().finally(() => {
      this.initializingCaps = null;
    });
    return this.initializingCaps;
  }
  async constructCapabilities() {
    const { process: p, layout } = this;
    if (p.load(layout.capsGlobal))
      throw new Error('Native display capabilities already have an owner');
    this.refs.caps = p.allocate(0x6cc, true);
    const mode = Number(Boolean(this.world.bootstrapOwner));
    if (
      (await this.call(layout.capsConstruct, [mode], this.refs.caps)) !== this.refs.caps ||
      p.load(layout.capsGlobal) !== this.refs.caps
    )
      throw new Error('Original display-capability initialization did not bind its owner');
    return this.refs.caps;
  }
  async initializeView() {
    const p = this.process,
      layout = this.layout,
      world = this.world;
    // The game view constructor enters its original M2 manager initializer.
    // Load the driver/platform imports first; initialize that manager only
    // once, as part of the original view constructor below.
    if (!this.engine.profile.startsWith('sdk-')) await world.getNativeFeature('m2');
    await this.initializeCapabilities();
    const previous = { renderer: this.platform.refs.renderer, manager: this.platform.refs.manager };
    p.store(layout.coreGlobal, 0);
    this.refs.viewStarted = true;
    await this.call(layout.viewConstruct, [world.window?.handle ?? 1, 1, 0], this.view);
    const view3D = p.load(this.view + 4),
      manager = p.load(this.view + 8),
      renderer = p.load(layout.coreGlobal);
    if (!view3D || !manager || !renderer || p.load(renderer + 308) !== this.d3d.device)
      throw new Error('Original native view/renderer initialization failed');
    if (p.load(view3D + 4) !== manager)
      throw new Error('Original native view and graph manager disagree');
    Object.assign(this.platform.refs, { view3D, manager, renderer });
    for (const pointer of Object.values(previous)) {
      if (!this.platform.owned.has(pointer) || !p.free(pointer))
        throw new Error('Temporary graphics records have no single owner');
      this.platform.owned.delete(pointer);
    }
    this.refs.initialized = true;
    this.platform.sync();
    return this;
  }
  snapshot() {
    return { state: structuredClone(this.refs), d3d: this.d3d.snapshot() };
  }
  restore(state) {
    Object.assign(this.refs, structuredClone(state.state));
    this.d3d.restore(state.d3d);
    this.initializing = this.initialized ? Promise.resolve(this) : undefined;
  }
  recoverTrap(trap) {
    return this.d3d.recoverTrap(trap);
  }
  async close() {
    try {
      if (this.refs.viewStarted) {
        await this.call(this.layout.viewDestroy, [], this.view);
        this.refs.viewStarted = false;
      }
      if (this.refs.caps) {
        await this.call(this.layout.capsDestroy, [], this.refs.caps);
        this.process.free(this.refs.caps);
        this.process.store(this.layout.capsGlobal, 0);
        this.refs.caps = 0;
      }
    } finally {
      this.refs.initialized = false;
      this.engine.features
        .get('text')
        ?.windows.windowPixelSources.delete(this.world.window?.handle ?? 1);
      this.d3d.close();
    }
  }
}
