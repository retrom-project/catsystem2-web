// SPDX-License-Identifier: MPL-2.0
// The transitional view projects records consumed by remaining EXE features.
// StageRenderer owns texture/surface bytes, exposed through bounded DLL locks.
import { nativeABI } from '../src/native/abi/index.mjs';
import { EmoteD3D9 } from '../src/emote/native-d3d.mjs';
import { createD3DContext } from '../src/render/particles-gl.mjs';
import { NativeGraphicsPlatform } from './graphics-consumer-projection.mjs';
import { installNativeDirectSound } from '../src/native/windows-directsound.mjs';

export const NATIVE_RENDERER_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    viewConstruct: 0x673bb0,
    view3DConstruct: 0x67f630,
    viewDestroy: 0x6741f0,
    coreGlobal: 0xb90778,
    capsConstruct: 0x5c62e0,
    capsDestroy: 0x5c63f0,
    capsGlobal: 0xb8f074,
    bitmap: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.renderer.bitmap,
    bits: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.renderer.bits,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    viewConstruct: 0x54ad10,
    viewDestroy: 0x54b2b0,
    coreGlobal: 0xc95180,
    capsConstruct: 0x4a30e0,
    capsDestroy: 0x4a31f0,
    capsGlobal: 0xc93b94,
    bitmap: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.renderer.bitmap,
    bits: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.renderer.bits,
  }),
});

// DLL locks borrow a fully committed RW span. General Win32 VirtualAlloc
// models reserve/commit one page at a time; changing thousands of page
// protections from a live COM callback can stall the CPU backend. This
// renderer-owned projection maps its final permissions in one operation.
// The ordinary virtual-region registry keeps current checkpoint identities.
export function nativeRendererPixelMemory(engine) {
  const p = engine.process,
    kernel = engine.kernel;
  const fail = (error) => {
    kernel.lastError = error;
    return 0;
  };
  return {
    allocate(size) {
      if (!Number.isSafeInteger(size) || size < 1 || size > 128 * 1024 * 1024) return fail(87);
      const length = Math.ceil(size / 4096) * 4096;
      let address = 0x40000000;
      for (const region of [...p.regions].sort((a, b) => a.address - b.address)) {
        if (region.address + region.size <= address) continue;
        if (address + length <= region.address) break;
        address = Math.ceil((region.address + region.size) / 65536) * 65536;
      }
      if (address + length >= 0x7ffe0000) return fail(8);
      try {
        // PE32Process.map supplies fresh zeroed RAM, independently of the heap.
        p.map(address, length, 'virtual', p.uc.PROT_READ | p.uc.PROT_WRITE);
      } catch {
        return fail(487);
      }
      kernel.virtual.set(address, {
        address,
        size: length,
        rendererPixels: true,
        committed: new Map(
          Array.from({ length: length / 4096 }, (_, i) => [address + i * 4096, 4]),
        ),
      });
      return address;
    },
    free(pointer) {
      if (!kernel.virtual.get(pointer)?.rendererPixels)
        throw new Error('Renderer pixel projection has no live owner');
      return kernel.virtualFree(pointer, 0, 0x8000);
    },
  };
}

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
    const view = world.graphics.view,
      stage = world.stageRenderer;
    // Creating the transitional device starts with the old D3D defaults.
    // A view may then apply configured filters. Inheriting an earlier JS
    // draw's point sampler changes Game movie boundary pixels.
    Object.assign(world.graphics.d3dContext, createD3DContext({ depthStencilEnabled: true }));
    this.d3d = new EmoteD3D9(this.process, {
      width: view.clientWidth,
      height: view.clientHeight,
      context: world.graphics.d3dContext,
      recordCommands: false,
      surfaces: stage.surfaces,
      // D7/D9 consumers lock a PE projection. Pixel authority stays in JS.
      pixelMemory: nativeRendererPixelMemory(engine),
      onPresent: stage && ((request) => stage.presentNative(request)),
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
    await this.initializeCapabilities();
    p.store(layout.coreGlobal, 0);
    this.refs.viewStarted = true;
    // This view serves remaining PE consumers, not a second VRAM store.
    // All uploads/clears route to JS pages. Construct an empty native page
    // table while retaining its view/manager/device metadata for consumers.
    const areas = world.configuration.fields.texture.areas.map((area) => area.slice());
    try {
      for (const area of world.configuration.fields.texture.areas) area.fill(0xffffffff);
      const window = world.window?.handle ?? 1;
      // Keep the D7/D8 window/DIB/cache prefix. Mode zero avoids creating
      // the old M2 manager; construct only the shared D3D consumer view.
      await this.call(layout.viewConstruct, [window, layout.view3DConstruct ? 0 : 1, 0], this.view);
      if (layout.view3DConstruct) {
        const view3D = p.allocate(0xc8, true);
        p.store(this.view + 4, view3D);
        await this.call(layout.view3DConstruct, [window, 1], view3D);
        p.store(this.view + 8, p.load(view3D + 4));
      }
    } finally {
      world.configuration.fields.texture.areas.forEach((area, i) => area.set(areas[i]));
      this.engine.configurationMemory?.push();
    }
    return this.bindView(this.view);
  }
  bindView(view) {
    const { process: p, layout, platform } = this,
      view3D = p.load(view + 4),
      manager = p.load(view + 8),
      renderer = p.load(layout.coreGlobal);
    if (!view3D || !manager || !renderer || p.load(renderer + 308) !== this.d3d.device)
      throw new Error('Original native view/renderer initialization failed');
    if (p.load(view3D + 4) !== manager)
      throw new Error('Original native view and graph manager disagree');
    const temporary = [platform.refs.renderer, platform.refs.manager];
    if (view !== this.view) temporary.push(this.view);
    for (const pointer of temporary) {
      if (!platform.owned.has(pointer) || !p.free(pointer))
        throw new Error('Temporary graphics records have no single owner');
      platform.owned.delete(pointer);
    }
    Object.assign(platform.refs, { view, view3D, manager, renderer });
    this.refs.initialized = true;
    // The producer's CreateDevice decision initializes the JS depth state.
    // Subsequent draw and clear passes share this single context.
    this.world.graphics.d3dContext.depthStencilEnabled = Boolean(this.d3d.presentation[9]);
    this.world.stageRenderer.depthFormat = this.d3d.presentation[10];
    // Preserve the game profile's initial linear sampling without creating
    // a DLL device. The SDK's consumer view uses its configured filters.
    this.world.graphics.d3dContext.magFilter = layout.view3DConstruct ? 2 : p.load(renderer + 348);
    this.world.graphics.d3dContext.minFilter = layout.view3DConstruct ? 2 : p.load(renderer + 352);
    platform.sync();
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
