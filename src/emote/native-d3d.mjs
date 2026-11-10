// SPDX-License-Identifier: MPL-2.0
// Browser D3D9 services for the driver's software vertex-processing path.
// COM slot/argument facts: IDirect3D9, IDirect3DDevice9 and IDirect3DTexture9.
import { identity, multiply, transform } from '../motion/matrix.mjs';
import { d3d9AdapterContracts, writeD3D9Caps } from './native-adapter.mjs';
import {
  createD3DContext,
  snapshotD3DContext,
  restoreD3DContext,
} from '../render/particles-gl.mjs';
const NOT_AVAILABLE = 0x8876086a;
const INVALID_CALL = 0x8876086c;
const SURFACE_BUSY = 0x887601ae;
const NO_INTERFACE = 0x80004002;
const NULL_POINTER = 0x80004003;
const OUT_OF_MEMORY = 0x8007000e;
const interfaceWords = {
  IUnknown: [0, 0, 0xc0, 0x46000000],
  Direct3D9: [0x81bdcbca, 0x426d64d4, 0x01ad8dae, 0x5c27f447],
  Device9: [0xd0223b96, 0x43fdbf7a, 0x3ba4bd92, 0xebb9820d],
  Resource9: [0x05eec05d, 0x43628f7d, 0xbad199b9, 0x04c757f3],
  BaseTexture9: [0x580ca87e, 0x4d541d3c, 0xd3b71d99, 0xce98c2e3],
  Texture9: [0x85c31227, 0x4f003de5, 0x1af13a9b, 0xb5188cc3],
  Surface9: [0x0cfbaf3a, 0x429a9ff6, 0x79a2b399, 0x9bb8f86a],
  SwapChain9: [0x794950f2, 0x458aadfc, 0xa1105e90, 0x3b500b0b],
};
const formats = new Map([
  [21, 4],
  [22, 4],
  [23, 2],
  [25, 2],
  [26, 2],
  [28, 1],
  [50, 1],
  [51, 2],
]);

function isInterface(process, iid, name) {
  return interfaceWords[name].every((word, index) => process.load(iid + index * 4) === word);
}

function surfaceBounds(process, surface, pointer) {
  const bounds = pointer
    ? Array.from({ length: 4 }, (_, index) => process.load(pointer + index * 4) | 0)
    : [0, 0, surface.width, surface.height];
  const [left, top, right, bottom] = bounds;
  if (
    left < 0 ||
    top < 0 ||
    right <= left ||
    bottom <= top ||
    right > surface.width ||
    bottom > surface.height
  )
    return null;
  return bounds;
}

function linearSurfaceColor(pixels, stride, width, height, x, y) {
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  const left = Math.floor(x),
    top = Math.floor(y),
    right = Math.min(left + 1, width - 1),
    bottom = Math.min(top + 1, height - 1),
    fx = x - left,
    fy = y - top,
    tl = pixels[top * stride + left],
    tr = pixels[top * stride + right],
    bl = pixels[bottom * stride + left],
    br = pixels[bottom * stride + right];
  let color = 0;
  for (let shift = 0; shift < 32; shift += 8) {
    const leftTop = (tl >>> shift) & 255,
      leftBottom = (bl >>> shift) & 255,
      upper = leftTop + (((tr >>> shift) & 255) - leftTop) * fx,
      lower = leftBottom + (((br >>> shift) & 255) - leftBottom) * fx;
    color |= Math.round(upper * (1 - fy) + lower * fy) << shift;
  }
  return color;
}

export class EmoteD3D9 {
  constructor(
    process,
    {
      width,
      height,
      onDraw,
      onDrawRaw,
      context,
      recordCommands = true,
      displayModes,
      refreshRate = 60,
      monitor = 1,
      onPresent,
      textureMemoryBudget = 64 * 1024 * 1024,
    } = {},
  ) {
    Object.assign(this, { process, width, height, onDraw, onDrawRaw, recordCommands });
    this.monitor = monitor;
    this.onPresent = onPresent;
    this.textureMemoryBudget = textureMemoryBudget;
    this.displayMode = { width, height, refreshRate, format: 22 };
    this.displayModes = displayModes ?? [this.displayMode];
    this.creation = [0, 1, 1, 0x20];
    this.deviceCreated = false;
    this.presentation = [width, height, 21, 1, 0, 0, 1, 1, 1, 1, 75, 0, 0, 0];
    this.objects = new Map();
    this.tables = new Map();
    this.calls = new Map();
    this.context = context ?? createD3DContext({ depthStencilEnabled: true });
    this.transforms = new Map([
      [2, identity()],
      [3, identity()],
      [256, identity()],
    ]);
    this.viewport = [0, 0, width, height, 0, 0x3f800000];
    this.scissor = [0, 0, width, height];
    this.samplerStages = new Map([[0, this.context.samplers]]);
    this.textures = new Map();
    this.commands = [];
    this.frames = new Map();
    this.gpuTargets = new Map();
    this.gpuDepth = new Map();
    this.fvf = 0;
    this.d3d = this.object('Direct3D9');
    this.device = this.object('Device9');
    this.backbuffer = this.object('Surface9', { width, height, usage: 1, format: 21, pool: 0 });
    this.backDepth = this.object('Surface9', {
      width,
      height,
      usage: 2,
      format: 75,
      pool: 0,
      backDepth: true,
    });
    this.renderTargets = new Map([[0, this.backbuffer]]);
    this.depthStencil = this.backDepth;
    this.scene = false;
  }
  get maximumTextureSize() {
    return this.gpu ? Math.min(4096, this.gpu.gl.getParameter(this.gpu.gl.MAX_TEXTURE_SIZE)) : 4096;
  }
  presentationParameters(address) {
    if (!address) return { error: INVALID_CALL };
    const p = this.process,
      words = Array.from({ length: 14 }, (_, i) => p.load(address + i * 4));
    let [
      width,
      height,
      format,
      count,
      multisample,
      quality,
      swap,
      window,
      windowed,
      autoDepth,
      depth,
      flags,
      refresh,
      interval,
    ] = words;
    if (!width) width = windowed ? this.width : 0;
    if (!height) height = windowed ? this.height : 0;
    if (!format && windowed) format = this.displayMode.format;
    if (!count) count = 1;
    if (!width || !height || width > this.maximumTextureSize || height > this.maximumTextureSize)
      return { error: INVALID_CALL };
    if (![21, 22].includes(format) || multisample || quality) return { error: NOT_AVAILABLE };
    if (count > 1) {
      p.store(address + 12, 1);
      return { error: NOT_AVAILABLE };
    }
    if (![1, 3].includes(swap) || flags & ~3 || ![0, 1, 0x80000000].includes(interval))
      return { error: INVALID_CALL };
    if (windowed && refresh) return { error: INVALID_CALL };
    if (
      !windowed &&
      !this.displayModes.some(
        (mode) =>
          mode.width === width &&
          mode.height === height &&
          (!refresh || mode.refreshRate === refresh),
      )
    )
      return { error: NOT_AVAILABLE };
    if (autoDepth && ![75, 77, 80].includes(depth)) return { error: NOT_AVAILABLE };
    words.splice(
      0,
      14,
      width,
      height,
      format,
      count,
      multisample,
      quality,
      swap,
      window,
      windowed,
      autoDepth,
      depth,
      flags,
      refresh,
      interval,
    );
    return { words };
  }
  createDevice(adapter, type, window, behavior, presentation, output) {
    if (!output) return INVALID_CALL;
    this.process.store(output, 0);
    if (adapter || type !== 1 || !window || !presentation) return INVALID_CALL;
    if ((behavior & 0xe0) !== 0x20 || behavior & 0x210) return NOT_AVAILABLE;
    if (this.deviceCreated && this.objects.get(this.device).references) return NOT_AVAILABLE;
    const { error, words } = this.presentationParameters(presentation);
    if (error) return error;
    this.deviceCreated = true;
    this.creation = [adapter, type, window, behavior];
    this.configurePresentation(words);
    words.forEach((word, index) => this.process.store(presentation + index * 4, word));
    this.objects.get(this.device).references = 1;
    this.process.store(output, this.device);
    if (!(behavior & 2)) {
      const cpu = this.process.cpu,
        register = this.process.uc.X86_REG_FPCW,
        current = cpu.reg_read_i32(register) & 0xffff;
      // Device creation masks exceptions and selects single/nearest while
      // retaining the other control bits, including the legacy infinity bit.
      cpu.reg_write_i32(register, (current & 0xf0c0) | 0x3f);
    }
    return 0;
  }
  configurePresentation(words) {
    this.endSceneBatch();
    this.presentation = [...words];
    [this.width, this.height] = words;
    this.viewport = [0, 0, this.width, this.height, 0, 0x3f800000];
    this.scissor = [0, 0, this.width, this.height];
    const backbuffer = this.objects.get(this.backbuffer),
      depth = this.objects.get(this.backDepth);
    if (backbuffer.pixels) this.process.free(backbuffer.pixels);
    for (const pointer of [this.backbuffer, this.backDepth]) {
      const target = this.gpuTargets.get(pointer),
        depthTarget = this.gpuDepth.get(pointer);
      if (target) this.gpu.destroyRenderTarget(target);
      if (depthTarget) this.gpu.destroyDepthStencil(depthTarget);
      this.gpuTargets.delete(pointer);
      this.gpuDepth.delete(pointer);
    }
    Object.assign(backbuffer, {
      width: this.width,
      height: this.height,
      format: words[2],
      pitch: this.width * 4,
      pixels: this.process.allocate(this.width * this.height * 4, true),
      lockable: Boolean(words[11] & 1),
      locked: false,
      revision: 0,
      dirty: false,
    });
    Object.assign(depth, { width: this.width, height: this.height, format: words[10] });
    this.renderTargets = new Map([[0, this.backbuffer]]);
    this.depthStencil = words[9] ? this.backDepth : 0;
    if (this.gpu && words[2] === 22)
      this.gpu.withRenderTarget(this.gpuTarget(this.backbuffer), () =>
        this.gpu.clear({ color: 0xff000000, flags: 1 }),
      );
  }
  table(kind) {
    const p = this.process;
    if (!this.tables.has(kind)) {
      const contracts = this.contracts(kind),
        table = p.allocate(contracts.length * 4, true);
      this.tables.set(kind, table);
      contracts.forEach((contract, slot) => {
        const definition = this.trapDefinition(kind, slot, contract);
        p.store(table + slot * 4, p.trap(definition.name, definition.args, definition.handler));
      });
    }
    return this.tables.get(kind);
  }
  trapDefinition(kind, slot, contract = this.contracts(kind)[slot]) {
    const [name, count, method] = contract ?? [`slot${slot}`, 0];
    return {
      name: `Emote D3D ${kind}.${name}`,
      args: count + 1,
      real: false,
      handler: ([pointer, ...args]) => {
        const object = this.objects.get(pointer);
        if (!object || object.kind !== kind)
          throw new Error(`D3D ${kind} method on an invalid object`);
        this.calls.set(`${kind}.${name}`, (this.calls.get(`${kind}.${name}`) ?? 0) + 1);
        if (!method) throw new Error(`Unimplemented Emote D3D ${kind}.${name}`);
        return method(object, args);
      },
    };
  }
  recoverTrap(trap) {
    const match = /^Emote D3D (\w+)\.(\w+)$/.exec(trap.name);
    if (!match) return null;
    const [, kind, name] = match,
      contracts = this.contracts(kind),
      slot = name.startsWith('slot')
        ? Number(name.substring(4))
        : contracts.findIndex((contract) => contract?.[0] === name);
    return slot < 0 ? null : this.trapDefinition(kind, slot, contracts[slot]);
  }
  object(kind, data = {}) {
    const p = this.process,
      table = this.table(kind),
      pointer = p.allocate(4, true);
    p.store(pointer, table);
    this.objects.set(pointer, { kind, pointer, references: 1, ...data });
    return pointer;
  }
  contracts(kind) {
    const p = this.process,
      methods = Array(
        kind === 'Direct3D9' ? 17 : kind === 'Device9' ? 119 : kind === 'Surface9' ? 17 : 22,
      ).fill(null);
    methods[0] = [
      'QueryInterface',
      2,
      (object, [iid, output]) => this.queryInterface(object, iid, output),
    ];
    methods[1] = ['AddRef', 0, (object) => this.retain(object)];
    methods[2] = ['Release', 0, (object) => this.release(object)];
    if (kind === 'Direct3D9') {
      for (const [slot, contract] of d3d9AdapterContracts(this)) methods[slot] = contract;
    } else if (kind === 'Device9') {
      methods[3] = ['TestCooperativeLevel', 0, () => 0];
      methods[4] = ['GetAvailableTextureMem', 0, () => this.availableTextureMemory()];
      methods[5] = [
        'EvictManagedResources',
        0,
        () => {
          for (const [pointer, cached] of this.frames)
            if (this.objects.get(pointer)?.pool === 1) this.gpu?.releaseTextureFrame(cached.frame);
          return 0;
        },
      ];
      methods[6] = [
        'GetDirect3D',
        1,
        (_, [output]) => {
          p.store(output, this.d3d);
          ++this.objects.get(this.d3d).references;
          return 0;
        },
      ];
      methods[7] = [
        'GetDeviceCaps',
        1,
        (_, [output]) => writeD3D9Caps(this, this.creation[0], this.creation[1], output),
      ];
      methods[8] = [
        'GetDisplayMode',
        2,
        (_, [index, output]) =>
          index ? INVALID_CALL : d3d9AdapterContracts(this).get(8)[2](null, [0, output]),
      ];
      methods[9] = [
        'GetCreationParameters',
        1,
        (_, [output]) => {
          if (!output) return INVALID_CALL;
          this.creation.forEach((word, index) => p.store(output + index * 4, word));
          return 0;
        },
      ];
      methods[15] = ['GetNumberOfSwapChains', 0, () => 1];
      methods[16] = [
        'Reset',
        1,
        (_, [presentation]) => {
          if (this.scene) return INVALID_CALL;
          const { error, words } = this.presentationParameters(presentation);
          if (error) return error;
          this.configurePresentation(words);
          words.forEach((word, index) => p.store(presentation + index * 4, word));
          return 0;
        },
      ];
      methods[17] = [
        'Present',
        4,
        (_, args) => {
          if (this.scene) return INVALID_CALL;
          if (!this.onPresent)
            throw new Error(
              'Native Direct3D Present requires its shared renderer presentation callback',
            );
          return this.onPresent({
            device: this,
            source: args[0],
            destination: args[1],
            window: args[2],
            dirty: args[3],
          });
        },
      ];
      methods[18] = [
        'GetBackBuffer',
        4,
        (_, [chain, index, type, output]) => {
          if (chain || index || type || !output) return INVALID_CALL;
          this.retain(this.objects.get(this.backbuffer));
          p.store(output, this.backbuffer);
          return 0;
        },
      ];
      methods[23] = [
        'CreateTexture',
        8,
        (_, [width, height, levels, usage, format, pool, output, shared]) => {
          if (
            !width ||
            !height ||
            width > this.maximumTextureSize ||
            height > this.maximumTextureSize ||
            levels > 1 ||
            shared ||
            !output
          )
            return INVALID_CALL;
          if (!formats.has(format) || (usage & 1 && ![21, 22].includes(format)) || usage & 2)
            return NOT_AVAILABLE;
          const pitch = (width * formats.get(format) + 3) & ~3;
          let pixels = 0,
            pointer = 0;
          try {
            pixels = p.allocate(pitch * height, true);
            pointer = this.object('Texture9', {
              width,
              height,
              levels: 1,
              usage,
              format,
              pool,
              pitch,
              pixels,
              locked: false,
              revision: 0,
              dirtyRectangle: [0, 0, width, height],
            });
            p.store(output, pointer);
            return 0;
          } catch (error) {
            if (pointer) {
              this.objects.delete(pointer);
              p.free(pointer);
            }
            if (pixels) p.free(pixels);
            // The original driver also inspects the output on failure.
            // Return a null interface along with the resource HRESULT.
            if (error.message === 'PE32 heap exhausted') {
              p.store(output, 0);
              return OUT_OF_MEMORY;
            }
            throw error;
          }
        },
      ];
      methods[28] = [
        'CreateRenderTarget',
        8,
        (_, [width, height, format, multisample, quality, lockable, output, shared]) =>
          shared
            ? INVALID_CALL
            : this.createSurface(
                { width, height, format, multisample, quality, lockable, usage: 1, pool: 0 },
                output,
              ),
      ];
      methods[29] = [
        'CreateDepthStencilSurface',
        8,
        (_, [width, height, format, multisample, quality, discard, output, shared]) =>
          shared
            ? INVALID_CALL
            : this.createSurface(
                { width, height, format, multisample, quality, discard, usage: 2, pool: 0 },
                output,
              ),
      ];
      methods[30] = [
        'UpdateSurface',
        4,
        (_, [source, rectangle, destination, point]) =>
          this.updateSurface(source, rectangle, destination, point),
      ];
      methods[32] = [
        'GetRenderTargetData',
        2,
        (_, [source, destination]) => this.readSurface(source, destination),
      ];
      methods[34] = ['StretchRect', 5, (_, args) => this.stretchRect(...args)];
      methods[36] = [
        'CreateOffscreenPlainSurface',
        6,
        (_, [width, height, format, pool, output, shared]) =>
          shared
            ? INVALID_CALL
            : this.createSurface({ width, height, format, pool, usage: 0 }, output),
      ];
      methods[37] = [
        'SetRenderTarget',
        2,
        (_, [index, pointer]) => {
          if (
            index > 3 ||
            (!pointer && !index) ||
            (pointer && this.objects.get(pointer)?.kind !== 'Surface9')
          )
            return INVALID_CALL;
          if (index && pointer)
            throw new Error('Multiple native render targets require the MRT raster backend');
          if (pointer) this.retain(this.objects.get(pointer));
          const previous = this.renderTargets.get(index);
          if (previous) this.release(this.objects.get(previous));
          this.renderTargets.set(index, pointer);
          if (pointer) {
            const surface = this.objects.get(pointer);
            this.viewport = [0, 0, surface.width, surface.height, 0, 0x3f800000];
          }
          return 0;
        },
      ];
      methods[38] = [
        'GetRenderTarget',
        2,
        (_, [index, output]) => {
          const pointer = this.renderTargets.get(index);
          if (!pointer) return 0x88760866;
          p.store(output, pointer);
          this.retain(this.objects.get(pointer));
          return 0;
        },
      ];
      methods[39] = [
        'SetDepthStencilSurface',
        1,
        (_, [pointer]) => {
          if (pointer && this.objects.get(pointer)?.usage !== 2) return INVALID_CALL;
          if (pointer) this.retain(this.objects.get(pointer));
          if (this.depthStencil) this.release(this.objects.get(this.depthStencil));
          this.depthStencil = pointer;
          return 0;
        },
      ];
      methods[40] = [
        'GetDepthStencilSurface',
        1,
        (_, [output]) => {
          if (!this.depthStencil) {
            p.store(output, 0);
            return 0x88760866;
          }
          p.store(output, this.depthStencil);
          this.objects.get(this.depthStencil).references++;
          return 0;
        },
      ];
      methods[41] = [
        'BeginScene',
        0,
        () => {
          if (this.scene) return INVALID_CALL;
          if (this.gpu) this.sceneBatch = this.gpu.beginNativeBatch();
          this.scene = true;
          return 0;
        },
      ];
      methods[42] = [
        'EndScene',
        0,
        () => {
          if (!this.scene) return INVALID_CALL;
          this.scene = false;
          this.endSceneBatch();
          return 0;
        },
      ];
      methods[43] = [
        'Clear',
        6,
        (_, [count, rectangles, flags, color, depth, stencil]) => {
          const areas = Array.from({ length: count }, (_, i) =>
            Array.from({ length: 4 }, (_, j) => p.load(rectangles + i * 16 + j * 4) | 0),
          );
          this.command({ type: 'clear', flags, color, depth, stencil, rectangles: areas });
          return 0;
        },
      ];
      methods[44] = [
        'SetTransform',
        2,
        (_, [type, input]) => {
          this.transforms.set(type, this.floats(input, 16));
          return 0;
        },
      ];
      methods[45] = [
        'GetTransform',
        2,
        (_, [type, output]) => {
          const matrix = this.transforms.get(type);
          if (!matrix) return INVALID_CALL;
          this.writeFloats(output, matrix);
          return 0;
        },
      ];
      methods[47] = [
        'SetViewport',
        1,
        (_, [input]) => {
          this.viewport = Array.from({ length: 6 }, (_, i) => p.load(input + i * 4));
          return 0;
        },
      ];
      methods[48] = [
        'GetViewport',
        1,
        (_, [output]) => {
          this.viewport.forEach((value, i) => p.store(output + i * 4, value));
          return 0;
        },
      ];
      methods[57] = [
        'SetRenderState',
        2,
        (_, [id, value]) => {
          if (!this.context.states.has(id)) throw new Error(`Unsupported D3D render-state ${id}`);
          this.context.states.set(id, value);
          return 0;
        },
      ];
      methods[58] = [
        'GetRenderState',
        2,
        (_, [id, output]) => {
          if (!this.context.states.has(id)) return INVALID_CALL;
          p.store(output, this.context.states.get(id));
          return 0;
        },
      ];
      methods[64] = [
        'GetTexture',
        2,
        (_, [stage, output]) => {
          const pointer = this.textures.get(stage) ?? 0;
          p.store(output, pointer);
          if (pointer) ++this.objects.get(pointer).references;
          return 0;
        },
      ];
      methods[65] = [
        'SetTexture',
        2,
        (_, [stage, pointer]) => {
          if (pointer && this.objects.get(pointer)?.kind !== 'Texture9') return INVALID_CALL;
          if (pointer) this.retain(this.objects.get(pointer));
          const previous = this.textures.get(stage);
          if (previous) this.release(this.objects.get(previous));
          this.textures.set(stage, pointer);
          return 0;
        },
      ];
      const stageDefaults = new Map([
        [1, 4],
        [2, 2],
        [3, 1],
        [4, 2],
        [5, 2],
        [6, 1],
        [7, 0],
        [8, 0],
        [9, 0],
        [10, 0],
        [11, 0],
        [22, 0],
        [23, 0],
        [24, 0],
        [26, 0],
        [27, 0],
        [28, 0],
        [32, 0xffffffff],
      ]);
      methods[66] = [
        'GetTextureStageState',
        3,
        (_, [stage, id, output]) => {
          const value =
            this.context.stages.get(stage)?.get(id) ??
            (stage && id === 1 ? 1 : stageDefaults.get(id));
          if (value === undefined) return INVALID_CALL;
          p.store(output, value);
          return 0;
        },
      ];
      methods[67] = [
        'SetTextureStageState',
        3,
        (_, [stage, id, value]) => {
          if (!this.context.stages.has(stage)) this.context.stages.set(stage, new Map());
          this.context.stages.get(stage).set(id, value);
          return 0;
        },
      ];
      const samplerDefaults = new Map([
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 0],
        [5, 1],
        [6, 1],
        [7, 0],
        [8, 0],
        [9, 0],
        [10, 1],
        [11, 0],
        [12, 0],
        [13, 0],
      ]);
      methods[68] = [
        'GetSamplerState',
        3,
        (_, [stage, id, output]) => {
          const value = this.samplerStages.get(stage)?.get(id) ?? samplerDefaults.get(id);
          if (value === undefined) return INVALID_CALL;
          p.store(output, value);
          return 0;
        },
      ];
      methods[69] = [
        'SetSamplerState',
        3,
        (_, [stage, id, value]) => {
          if (!this.samplerStages.has(stage))
            this.samplerStages.set(stage, new Map(samplerDefaults));
          this.samplerStages.get(stage).set(id, value);
          return 0;
        },
      ];
      methods[75] = [
        'SetScissorRect',
        1,
        (_, [input]) => {
          this.scissor = Array.from({ length: 4 }, (_, i) => p.load(input + i * 4) | 0);
          return 0;
        },
      ];
      methods[76] = [
        'GetScissorRect',
        1,
        (_, [output]) => {
          this.scissor.forEach((value, i) => p.store(output + i * 4, value));
          return 0;
        },
      ];
      methods[83] = [
        'DrawPrimitiveUP',
        4,
        (_, [type, count, vertices, stride]) => {
          this.draw(type, count, vertices, stride);
          return 0;
        },
      ];
      methods[84] = [
        'DrawIndexedPrimitiveUP',
        8,
        (_, [type, minimum, vertices, count, indices, format, data, stride]) => {
          if (![101, 102].includes(format)) return INVALID_CALL;
          const width = format === 101 ? 2 : 4,
            n = this.vertexCount(type, count),
            raw = p.read(indices, n * width),
            v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength),
            order = Array.from({ length: n }, (_, i) =>
              width === 2 ? v.getUint16(i * width, true) : v.getUint32(i * width, true),
            );
          if (order.some((index) => index < minimum || index >= minimum + vertices))
            return INVALID_CALL;
          this.draw(type, count, data, stride, order, { minimum, vertices, format, indices: raw });
          return 0;
        },
      ];
      methods[89] = [
        'SetFVF',
        1,
        (_, [value]) => {
          this.fvf = value;
          return 0;
        },
      ];
      methods[90] = [
        'GetFVF',
        1,
        (_, [output]) => {
          p.store(output, this.fvf);
          return 0;
        },
      ];
      for (const [set, get, name] of [
        [92, 93, 'VertexShader'],
        [107, 108, 'PixelShader'],
      ]) {
        methods[set] = [`Set${name}`, 1, (_, [shader]) => (shader ? INVALID_CALL : 0)];
        methods[get] = [
          `Get${name}`,
          1,
          (_, [output]) => {
            if (!output) return INVALID_CALL;
            p.store(output, 0);
            return 0;
          },
        ];
      }
    } else if (kind === 'Surface9') {
      methods[3] = [
        'GetDevice',
        1,
        (_, [output]) => {
          if (!output) return INVALID_CALL;
          this.retain(this.objects.get(this.device));
          p.store(output, this.device);
          return 0;
        },
      ];
      methods[11] = [
        'GetContainer',
        2,
        (surface, [iid, output]) => this.getContainer(surface, iid, output),
      ];
      methods[12] = [
        'GetDesc',
        1,
        (surface, [output]) => {
          [
            surface.format,
            1,
            surface.usage,
            surface.pool,
            0,
            0,
            surface.width,
            surface.height,
          ].forEach((value, i) => p.store(output + i * 4, value));
          return 0;
        },
      ];
      methods[13] = [
        'LockRect',
        3,
        (surface, [output, rectangle, flags]) =>
          this.lockSurface(surface, output, rectangle, flags),
      ];
      methods[14] = ['UnlockRect', 0, (surface) => this.unlockSurface(surface)];
    } else if (kind === 'Texture9') {
      methods[3] = [
        'GetDevice',
        1,
        (_, [output]) => {
          p.store(output, this.device);
          ++this.objects.get(this.device).references;
          return 0;
        },
      ];
      methods[10] = ['GetType', 0, () => 3];
      methods[13] = ['GetLevelCount', 0, (texture) => texture.levels];
      methods[17] = [
        'GetLevelDesc',
        2,
        (texture, [level, output]) => {
          if (level || !output) return INVALID_CALL;
          [
            texture.format,
            1,
            texture.usage,
            texture.pool,
            0,
            0,
            texture.width,
            texture.height,
          ].forEach((value, i) => p.store(output + i * 4, value));
          return 0;
        },
      ];
      methods[18] = [
        'GetSurfaceLevel',
        2,
        (texture, [level, output]) => {
          if (level || !output) return INVALID_CALL;
          if (!texture.surface)
            texture.surface = this.object('Surface9', {
              width: texture.width,
              height: texture.height,
              usage: texture.usage,
              format: texture.format,
              pool: texture.pool,
              texture: texture.pointer,
              references: 0,
            });
          const surface = this.objects.get(texture.surface);
          this.retain(surface);
          p.store(output, texture.surface);
          return 0;
        },
      ];
      methods[19] = [
        'LockRect',
        4,
        (texture, [level, output, rectangle, flags]) => {
          if (level || !output || texture.locked) return INVALID_CALL;
          let x = 0,
            y = 0;
          if (rectangle) {
            [x, y] = [p.load(rectangle), p.load(rectangle + 4)];
            const right = p.load(rectangle + 8),
              bottom = p.load(rectangle + 12);
            if (x > right || y > bottom || right > texture.width || bottom > texture.height)
              return INVALID_CALL;
          }
          p.store(output, texture.pitch);
          p.store(output + 4, texture.pixels + y * texture.pitch + x * formats.get(texture.format));
          if (!(flags & (0x10 | 0x8000))) this.addDirtyRectangle(texture, rectangle);
          texture.locked = { flags };
          return 0;
        },
      ];
      methods[20] = [
        'UnlockRect',
        1,
        (texture, [level]) => {
          if (level || !texture.locked) return INVALID_CALL;
          if (!(texture.locked.flags & 16)) texture.revision++;
          texture.locked = false;
          return 0;
        },
      ];
      methods[21] = [
        'AddDirtyRect',
        1,
        (texture, [rectangle]) => this.addDirtyRectangle(texture, rectangle),
      ];
    }
    return methods;
  }
  floats(address, count) {
    const bytes = this.process.read(address, count * 4);
    return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, count));
  }
  retain(object) {
    if (object.texture && !object.references) this.retain(this.objects.get(object.texture));
    return ++object.references;
  }
  availableTextureMemory() {
    let used = 0;
    for (const object of this.objects.values())
      if (
        ['Texture9', 'Surface9'].includes(object.kind) &&
        !object.texture &&
        object.pool !== 2 &&
        object.pool !== 3
      )
        used +=
          object.width *
          object.height *
          (object.format === 80 ? 2 : (formats.get(object.format) ?? 4));
    return Math.max(0, this.textureMemoryBudget - used) >>> 0;
  }
  queryInterface(object, iid, output) {
    if (!output) return NULL_POINTER;
    const p = this.process;
    p.store(output, 0);
    if (!iid) return NULL_POINTER;
    const names = ['IUnknown', object.kind];
    if (object.kind === 'Texture9') names.push('BaseTexture9', 'Resource9');
    else if (object.kind === 'Surface9') names.push('Resource9');
    if (!names.some((name) => isInterface(p, iid, name))) return NO_INTERFACE;
    this.retain(object);
    p.store(output, object.pointer);
    return 0;
  }
  getContainer(surface, iid, output) {
    if (surface.pointer !== this.backbuffer)
      return this.queryInterface(this.objects.get(surface.texture || this.device), iid, output);
    if (!output) return NULL_POINTER;
    if (
      iid &&
      (isInterface(this.process, iid, 'IUnknown') || isInterface(this.process, iid, 'SwapChain9'))
    )
      throw new Error('Native back-buffer container requires its implicit swap chain');
    this.process.store(output, 0);
    return iid ? NO_INTERFACE : NULL_POINTER;
  }
  release(object) {
    if (!object.references) throw new Error('D3D object released twice');
    const remaining = --object.references;
    if (remaining) return remaining;
    if (object.texture) {
      this.release(this.objects.get(object.texture));
      return 0;
    }
    if ([this.d3d, this.device, this.backbuffer, this.backDepth].includes(object.pointer)) return 0;
    if (object.surface) {
      const surface = this.objects.get(object.surface);
      if (surface?.references) throw new Error('Native texture was freed with a live surface');
      if (surface) {
        this.objects.delete(surface.pointer);
        this.process.free(surface.pointer);
      }
    }
    const target = this.gpuTargets.get(object.pointer);
    if (target) {
      this.gpu.destroyRenderTarget(target);
      this.gpuTargets.delete(object.pointer);
    }
    const depth = this.gpuDepth.get(object.pointer);
    if (depth) {
      this.gpu.destroyDepthStencil(depth);
      this.gpuDepth.delete(object.pointer);
    }
    if (object.pixels) this.process.free(object.pixels);
    const frame = this.frames.get(object.pointer)?.frame;
    if (frame) this.gpu?.releaseTextureFrame(frame);
    this.frames.delete(object.pointer);
    this.objects.delete(object.pointer);
    this.process.free(object.pointer);
    return 0;
  }
  createSurface(data, output) {
    if (
      !output ||
      !data.width ||
      !data.height ||
      data.width > this.maximumTextureSize ||
      data.height > this.maximumTextureSize ||
      data.multisample ||
      data.quality
    )
      return INVALID_CALL;
    if (
      data.usage === 2
        ? ![75, 77, 80].includes(data.format)
        : !formats.has(data.format) || (data.usage & 1 && ![21, 22].includes(data.format))
    )
      return NOT_AVAILABLE;
    const pitch = (data.width * (formats.get(data.format) ?? 4) + 3) & ~3,
      pointer = this.object('Surface9', {
        ...data,
        pitch,
        pixels: this.process.allocate(pitch * data.height, true),
        revision: 0,
      });
    this.process.store(output, pointer);
    return 0;
  }
  surfaceData(pointer) {
    const surface = this.objects.get(pointer);
    return surface?.kind === 'Surface9'
      ? surface.texture
        ? this.objects.get(surface.texture)
        : surface
      : null;
  }
  textureData(pointer) {
    const texture = this.objects.get(pointer);
    return texture?.kind === 'Texture9' ? texture : null;
  }
  addDirtyRectangle(texture, pointer) {
    const rectangle = pointer
      ? Array.from({ length: 4 }, (_, i) => this.process.load(pointer + i * 4) | 0)
      : [0, 0, texture.width, texture.height];
    const [left, top, right, bottom] = rectangle;
    if (
      left < 0 ||
      top < 0 ||
      right < left ||
      bottom < top ||
      right > texture.width ||
      bottom > texture.height
    )
      return INVALID_CALL;
    if (left === right || top === bottom) return 0;
    const previous = texture.dirtyRectangle;
    texture.dirtyRectangle = previous
      ? [
          Math.min(left, previous[0]),
          Math.min(top, previous[1]),
          Math.max(right, previous[2]),
          Math.max(bottom, previous[3]),
        ]
      : rectangle;
    // Invalidate decoded host frames as well as recording the native update
    // region; the pixels themselves continue to live at the same guest address.
    texture.revision++;
    return 0;
  }
  lockSurface(surface, output, rectangle, flags) {
    const pointer = surface.pointer;
    surface = this.surfaceData(pointer);
    if (
      !surface ||
      !output ||
      !surface.pixels ||
      surface.locked ||
      flags & ~0xe810 ||
      (rectangle && flags & 0x2000)
    )
      return INVALID_CALL;
    if (surface.usage & 2 || (surface.usage & 1 && !surface.lockable)) return INVALID_CALL;
    const p = this.process,
      area = surfaceBounds(p, surface, rectangle);
    if (!area) return INVALID_CALL;
    this.syncSurface(pointer, surface);
    p.store(output, surface.pitch);
    p.store(
      output + 4,
      surface.pixels + area[1] * surface.pitch + area[0] * formats.get(surface.format),
    );
    surface.locked = { flags, area };
    return 0;
  }
  unlockSurface(surface) {
    surface = this.surfaceData(surface.pointer);
    if (!surface?.locked) return INVALID_CALL;
    const { flags, area } = surface.locked;
    surface.locked = false;
    if (!(flags & 16)) {
      surface.revision++;
      if (surface.usage & 1)
        this.command({
          type: 'upload',
          target: surface.pointer,
          rectangle: [area[0], area[1], area[2] - area[0], area[3] - area[1]],
          frame: this.frame(surface.pointer),
        });
    }
    return 0;
  }
  updateSurface(source, rectangle, destination, point) {
    const p = this.process,
      a = this.surfaceData(source),
      b = this.surfaceData(destination);
    if (!a || !b || a.format !== b.format || !a.pixels || !b.pixels || a.locked || b.locked)
      return INVALID_CALL;
    const area = rectangle
        ? Array.from({ length: 4 }, (_, i) => p.load(rectangle + i * 4) | 0)
        : [0, 0, a.width, a.height],
      at = point ? [p.load(point) | 0, p.load(point + 4) | 0] : [0, 0],
      width = area[2] - area[0],
      height = area[3] - area[1],
      size = formats.get(a.format);
    if (
      area.some((n) => n < 0) ||
      area[2] > a.width ||
      area[3] > a.height ||
      width < 0 ||
      height < 0 ||
      at.some((n) => n < 0) ||
      at[0] + width > b.width ||
      at[1] + height > b.height
    )
      return INVALID_CALL;
    const sourceAddress = a.pixels + area[1] * a.pitch + area[0] * size,
      destinationAddress = b.pixels + at[1] * b.pitch + at[0] * size,
      length = height * width * size;
    if (
      a.pitch === width * size &&
      b.pitch === width * size &&
      !(destinationAddress > sourceAddress && destinationAddress < sourceAddress + length)
    )
      p.write(destinationAddress, p.read(sourceAddress, length));
    else
      for (let y = 0; y < height; y++)
        p.write(
          destinationAddress + y * b.pitch,
          p.read(sourceAddress + y * a.pitch, width * size),
        );
    b.revision++;
    this.command({
      type: 'upload',
      target: destination,
      rectangle: [at[0], at[1], width, height],
      frame: this.frame(b.pointer),
    });
    return 0;
  }
  readSurface(source, destination) {
    const a = this.surfaceData(source),
      b = this.surfaceData(destination);
    if (
      !a ||
      !b ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.format !== b.format ||
      !a.pixels ||
      !b.pixels ||
      a.locked ||
      b.locked
    )
      return INVALID_CALL;
    this.syncSurface(source, a);
    const p = this.process,
      size = a.width * formats.get(a.format);
    for (let y = 0; y < a.height; y++)
      p.write(b.pixels + y * b.pitch, p.read(a.pixels + y * a.pitch, size));
    b.revision++;
    return 0;
  }
  syncSurface(pointer, surface) {
    if (!surface.dirty) return;
    if (!this.gpu) throw new Error('Native D3D render-target readback requires its shared GPU');
    this.storePixels(surface, this.gpu.pixels(this.gpuTarget(pointer)));
    surface.dirty = false;
  }
  stretchRect(source, sourceRect, destination, destinationRect, filter) {
    const p = this.process,
      a = this.surfaceData(source),
      b = this.surfaceData(destination);
    if (
      !a?.pixels ||
      !b?.pixels ||
      a.pool !== 0 ||
      b.pool !== 0 ||
      ![21, 22].includes(a.format) ||
      ![21, 22].includes(b.format) ||
      ![0, 1, 2].includes(filter) ||
      (!(b.usage & 1) && (a.usage & 1 || a.kind === 'Texture9' || b.kind === 'Texture9'))
    )
      return INVALID_CALL;
    if (a.locked || b.locked) return SURFACE_BUSY;
    const from = surfaceBounds(p, a, sourceRect),
      to = surfaceBounds(p, b, destinationRect);
    if (!from || !to) return INVALID_CALL;
    const [sx, sy, sr, sb] = from,
      [dx, dy, dr, db] = to,
      width = dr - dx,
      height = db - dy,
      scaleX = (sr - sx) / width,
      scaleY = (sb - sy) / height,
      sameSize = scaleX === 1 && scaleY === 1;
    if (a === b) {
      if (!sameSize) return INVALID_CALL;
      if (sx === dx && sy === dy) return 0;
    }
    this.syncSurface(source, a);
    if (dx || dy || dr !== b.width || db !== b.height) this.syncSurface(destination, b);
    // Read once so overlapping, unscaled rectangles see the original source.
    const bytes = p.read(a.pixels, a.pitch * a.height),
      pixels = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
      stride = a.pitch / 4,
      result = new Uint32Array(width * height),
      alpha = a.format === 22 || b.format === 22 ? 0xff000000 : 0;
    for (let y = 0; y < height; y++) {
      if (sameSize && !alpha) {
        const start = (sy + y) * stride + sx;
        result.set(pixels.subarray(start, start + width), y * width);
        continue;
      }
      const fy = sy + (y + 0.5) * scaleY;
      for (let x = 0; x < width; x++) {
        const fx = sx + (x + 0.5) * scaleX;
        const color =
          filter === 2 && !sameSize
            ? linearSurfaceColor(pixels, stride, a.width, a.height, fx - 0.5, fy - 0.5)
            : pixels[Math.floor(fy) * stride + Math.floor(fx)];
        result[y * width + x] = color | alpha;
      }
    }
    const output = new Uint8Array(result.buffer),
      offset = b.pixels + dy * b.pitch + dx * 4;
    if (width * 4 === b.pitch) p.write(offset, output);
    else
      for (let y = 0; y < height; y++)
        p.write(offset + y * b.pitch, output.subarray(y * width * 4, (y + 1) * width * 4));
    b.revision++;
    b.dirty = false;
    if (b.usage & 1)
      this.command({
        type: 'upload',
        target: destination,
        rectangle: [dx, dy, width, height],
        frame: this.frame(b.pointer),
      });
    return 0;
  }
  writeFloats(address, values) {
    this.process.write(address, new Uint8Array(Float32Array.from(values).buffer));
  }
  attachGPU(gpu) {
    if (this.gpu && this.gpu !== gpu)
      throw new Error('Native D3D device already has a graphics backend');
    this.gpu = gpu;
    if (this.scene && !this.sceneBatch) this.sceneBatch = gpu.beginNativeBatch();
    return this;
  }
  endSceneBatch() {
    const close = this.sceneBatch;
    this.sceneBatch = null;
    close?.();
  }
  async hostDraw(callback) {
    if (!this.gpu || this.closed)
      throw new Error('Native host drawing requires an active shared GPU');
    const pointer = this.renderTargets.get(0),
      surface = this.surfaceData(pointer),
      target = this.gpuTarget(pointer),
      depth = this.depthTarget(this.depthStencil),
      previousContext = this.gpu.frameContext,
      previousOpaque = this.gpu.frameOpaqueTarget;
    surface.dirty = true;
    surface.revision = (surface.revision ?? 0) + 1;
    this.gpu.frameContext = this.context;
    this.gpu.frameOpaqueTarget = surface.format === 22;
    try {
      return await this.gpu.withRenderTargetAsync(
        target,
        () =>
          callback(this.gpu, {
            target: pointer,
            depthStencil: this.depthStencil,
            context: this.context,
          }),
        { depthStencil: depth },
      );
    } finally {
      this.gpu.frameContext = previousContext;
      this.gpu.frameOpaqueTarget = previousOpaque;
    }
  }
  gpuTarget(pointer) {
    const object = this.surfaceData(pointer);
    if (!object) throw new Error('Native render target is invalid');
    if (
      object.pointer === this.backbuffer &&
      object.width === this.gpu.primaryTarget.width &&
      object.height === this.gpu.primaryTarget.height
    )
      return this.gpu.primaryTarget;
    let target = this.gpuTargets.get(object.pointer);
    if (!target) {
      target = this.gpu.createRenderTarget(
        object.width,
        object.height,
        this.frame(object.pointer).rgba,
      );
      this.gpuTargets.set(object.pointer, target);
    }
    return target;
  }
  depthTarget(pointer) {
    if (!pointer) return null;
    if (
      pointer === this.backDepth &&
      this.objects.get(pointer).format === 75 &&
      this.objects.get(pointer).width === this.gpu.primaryTarget.width &&
      this.objects.get(pointer).height === this.gpu.primaryTarget.height
    )
      return this.gpu.primaryDepthStencil;
    let depth = this.gpuDepth.get(pointer);
    if (!depth) {
      const object = this.objects.get(pointer);
      if (!object || object.usage !== 2) throw new Error('Native depth/stencil surface is invalid');
      depth = this.gpu.createDepthStencil(object.width, object.height, object.format);
      this.gpuDepth.set(pointer, depth);
    }
    return depth;
  }
  storePixels(texture, rgba) {
    if (![21, 22].includes(texture.format))
      throw new Error(
        `Native render-target readback format ${texture.format} requires its packed conversion`,
      );
    const bytes = new Uint8Array(texture.pitch * texture.height);
    for (let y = 0; y < texture.height; y++)
      for (let x = 0; x < texture.width; x++) {
        const a = (y * texture.width + x) * 4,
          b = y * texture.pitch + x * 4;
        bytes[b] = rgba[a + 2];
        bytes[b + 1] = rgba[a + 1];
        bytes[b + 2] = rgba[a];
        bytes[b + 3] = texture.format === 22 ? 255 : rgba[a + 3];
      }
    this.process.write(texture.pixels, bytes);
    texture.revision++;
  }
  command(command) {
    command.target ??= this.renderTargets.get(0);
    command.depthStencil = this.depthStencil;
    command.viewport = [...this.viewport];
    if (command.type !== 'upload') {
      const target = this.surfaceData(command.target);
      if (target) target.dirty = true;
    }
    if (this.recordCommands) this.commands.push(command);
    if (this.gpu) this.execute(command);
    this.onDraw?.(command);
  }
  execute(command) {
    const gpu = this.gpu,
      target = this.gpuTarget(command.target);
    if (command.type === 'upload') {
      gpu.uploadRenderTarget(target, command.frame, command.rectangle);
      return;
    }
    gpu.withRenderTarget(
      target,
      () => {
        if (command.type === 'clear') {
          gpu.clear({ ...command, opaqueTarget: this.surfaceData(command.target).format === 22 });
          return;
        }
        const source = this.gpuTargets.get(command.texture),
          frame = source
            ? { width: source.width, height: source.height, nativeTarget: source }
            : this.frame(command.texture);
        gpu.drawGeometry(
          (command.lines ?? command.triangles).map((vertices) => ({ vertices })),
          frame,
          {
            lineViewport: command.type === 'lines' ? command.viewport : null,
            state: command.state,
            scissor: command.scissor,
            opaqueTarget: this.surfaceData(command.target).format === 22,
          },
        );
      },
      { depthStencil: this.depthTarget(command.depthStencil) },
    );
  }
  vertexCount(type, count) {
    if (type === 1) return count;
    if (type === 2) return count * 2;
    if (type === 3) return count + 1;
    if (type === 4) return count * 3;
    if (type === 5 || type === 6) return count + 2;
    throw new Error(`Unsupported D3D primitive type ${type}`);
  }
  draw(type, count, address, stride, indices, indexed) {
    const p = this.process,
      n = this.vertexCount(type, count),
      position = this.fvf & 14,
      line = type === 2 || type === 3;
    if (![2, 4].includes(position) || this.fvf & ~0x146)
      throw new Error(`Unsupported E-mote fixed-function vertex format 0x${this.fvf.toString(16)}`);
    if (line && (position !== 4 || this.fvf & 0xf00))
      throw new Error(
        'Native D3D lines require pretransformed vertices without texture coordinates',
      );
    const rawVertices = p.read(
        address,
        (indexed ? indexed.minimum + indexed.vertices : n) * stride,
      ),
      vertexData = new DataView(rawVertices.buffer, rawVertices.byteOffset, rawVertices.byteLength);
    this.onDrawRaw?.({
      slot: indexed ? 84 : 83,
      type,
      count,
      stride,
      fvf: this.fvf,
      ...indexed,
      bytes: rawVertices,
    });
    const matrix = multiply(
      multiply(this.transforms.get(256), this.transforms.get(2)),
      this.transforms.get(3),
    );
    const viewport = new DataView(Uint32Array.from(this.viewport).buffer),
      minZ = viewport.getFloat32(16, true),
      maxZ = viewport.getFloat32(20, true),
      f = Math.fround;
    const vertices = Array.from({ length: n }, (_, i) => {
      const offset = (indices?.[i] ?? i) * stride,
        b = vertexData;
      let at = offset + (position === 4 ? 16 : 12);
      let [x, y, z, w] = [
        b.getFloat32(offset, true),
        b.getFloat32(offset + 4, true),
        b.getFloat32(offset + 8, true),
        position === 4 ? b.getFloat32(offset + 12, true) : 1,
      ];
      if (position === 2) {
        const clip = transform([x, y, z, 1], matrix);
        w = f(1 / clip[3]);
        x = f(f(f(clip[0] * w) + 1) * f(this.viewport[2] * 0.5) + this.viewport[0]);
        y = f(f(1 - f(clip[1] * w)) * f(this.viewport[3] * 0.5) + this.viewport[1]);
        z = f(f(clip[2] * w) * f(maxZ - minZ) + minZ);
      }
      const color = this.fvf & 64 ? b.getUint32(at, true) : 0xffffffff;
      if (this.fvf & 64) at += 4;
      const u = this.fvf & 0xf00 ? b.getFloat32(at, true) : 0,
        v = this.fvf & 0xf00 ? b.getFloat32(at + 4, true) : 0;
      return { x, y, z, w, color, u, v };
    });
    const lines = [],
      triangles = [];
    if (type === 2) for (let i = 0; i < n; i += 2) lines.push(vertices.slice(i, i + 2));
    else if (type === 3) for (let i = 0; i < n - 1; i++) lines.push(vertices.slice(i, i + 2));
    else if (type === 4) for (let i = 0; i < n; i += 3) triangles.push(vertices.slice(i, i + 3));
    else if (type === 5)
      for (let i = 0; i < n - 2; i++)
        triangles.push(
          i & 1 ? [vertices[i + 1], vertices[i], vertices[i + 2]] : vertices.slice(i, i + 3),
        );
    else if (type === 6)
      for (let i = 1; i < n - 1; i++) triangles.push([vertices[0], vertices[i], vertices[i + 1]]);
    else throw new Error(`E-mote raster primitive ${type} requires its point backend`);
    this.command({
      ...(line ? { type: 'lines', lines } : { type: 'triangles', triangles }),
      texture: this.textures.get(0) ?? 0,
      state: {
        states:
          this.recordCommands || this.onDraw ? new Map(this.context.states) : this.context.states,
        samplers:
          this.recordCommands || this.onDraw
            ? new Map(this.samplerStages.get(0))
            : this.samplerStages.get(0),
        stages:
          this.recordCommands || this.onDraw
            ? new Map([...this.context.stages].map(([stage, states]) => [stage, new Map(states)]))
            : this.context.stages,
      },
      scissor: [...this.scissor],
    });
  }
  frame(pointer) {
    if (!pointer) {
      if (!this.white)
        this.white = { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
      return this.white;
    }
    let texture = this.objects.get(pointer);
    if (texture?.kind === 'Surface9' && texture.texture)
      texture = this.objects.get(texture.texture);
    if (!texture || !['Texture9', 'Surface9'].includes(texture.kind) || !texture.pixels)
      throw new Error('E-mote references an invalid texture');
    const cached = this.frames.get(pointer);
    if (cached?.revision === texture.revision) return cached.frame;
    if (cached) this.gpu?.releaseTextureFrame(cached.frame);
    const source = this.process.read(texture.pixels, texture.pitch * texture.height),
      view = new DataView(source.buffer, source.byteOffset, source.byteLength),
      rgba = new Uint8Array(texture.width * texture.height * 4),
      size = formats.get(texture.format);
    const expand = (value, bits) => Math.round((value * 255) / ((1 << bits) - 1));
    for (let y = 0; y < texture.height; y++)
      for (let x = 0; x < texture.width; x++) {
        const at = y * texture.pitch + x * size,
          d = (y * texture.width + x) * 4,
          n = size === 2 ? view.getUint16(at, true) : 0;
        let color;
        if (texture.format === 21 || texture.format === 22) {
          rgba[d] = source[at + 2];
          rgba[d + 1] = source[at + 1];
          rgba[d + 2] = source[at];
          rgba[d + 3] = texture.format === 21 ? source[at + 3] : 255;
          continue;
        } else if (texture.format === 23)
          color = [expand(n >>> 11, 5), expand((n >>> 5) & 63, 6), expand(n & 31, 5), 255];
        else if (texture.format === 25)
          color = [
            expand((n >>> 10) & 31, 5),
            expand((n >>> 5) & 31, 5),
            expand(n & 31, 5),
            n & 0x8000 ? 255 : 0,
          ];
        else if (texture.format === 26)
          color = [
            expand((n >>> 8) & 15, 4),
            expand((n >>> 4) & 15, 4),
            expand(n & 15, 4),
            expand(n >>> 12, 4),
          ];
        else if (texture.format === 28) color = [255, 255, 255, source[at]];
        else
          color = [
            source[at],
            source[at],
            source[at],
            texture.format === 51 ? source[at + 1] : 255,
          ];
        rgba.set(color, d);
      }
    const frame = { width: texture.width, height: texture.height, rgba };
    this.frames.set(pointer, { revision: texture.revision, frame });
    return frame;
  }
  replay(gpu, commands = this.commands) {
    for (const command of commands) {
      if (command.type === 'clear') {
        gpu.clear(command);
        continue;
      }
      gpu.drawGeometry(
        (command.lines ?? command.triangles).map((vertices) => ({ vertices })),
        this.frame(command.texture),
        {
          lineViewport: command.type === 'lines' ? command.viewport : null,
          state: command.state,
          scissor: command.scissor,
        },
      );
    }
  }
  close() {
    if (this.closed) return;
    this.endSceneBatch();
    for (const target of this.gpuTargets.values()) this.gpu.destroyRenderTarget(target);
    for (const depth of this.gpuDepth.values()) this.gpu.destroyDepthStencil(depth);
    for (const { frame } of this.frames.values()) this.gpu?.releaseTextureFrame(frame);
    const pixels = new Set(
      [...this.objects.values()].map((object) => object.pixels).filter(Boolean),
    );
    for (const pointer of pixels) this.process.free(pointer);
    for (const pointer of this.objects.keys()) this.process.free(pointer);
    for (const pointer of this.tables.values()) this.process.free(pointer);
    this.gpuTargets.clear();
    this.gpuDepth.clear();
    this.frames.clear();
    this.objects.clear();
    this.tables.clear();
    this.closed = true;
  }
  snapshot() {
    return structuredClone({
      width: this.width,
      height: this.height,
      displayMode: this.displayMode,
      displayModes: this.displayModes,
      monitor: this.monitor,
      textureMemoryBudget: this.textureMemoryBudget,
      creation: this.creation,
      deviceCreated: this.deviceCreated,
      presentation: this.presentation,
      d3d: this.d3d,
      device: this.device,
      backbuffer: this.backbuffer,
      backDepth: this.backDepth,
      tables: [...this.tables],
      objects: [...this.objects],
      context: snapshotD3DContext(this.context),
      transforms: [...this.transforms],
      viewport: this.viewport,
      scissor: this.scissor,
      samplerStages: [...this.samplerStages].map(([stage, states]) => [stage, [...states]]),
      textures: [...this.textures],
      renderTargets: [...this.renderTargets],
      depthStencil: this.depthStencil,
      scene: this.scene,
      fvf: this.fvf,
      gpu: this.gpu
        ? {
            primary: {
              bytes: this.gpu.pixels(this.gpu.primaryTarget),
              depth: this.gpu.snapshotDepthStencil(this.gpu.primaryDepthStencil),
            },
            targets: [...this.gpuTargets].map(([pointer, target]) => [
              pointer,
              { width: target.width, height: target.height, bytes: this.gpu.pixels(target) },
            ]),
            depth: [...this.gpuDepth].map(([pointer, depth]) => [
              pointer,
              this.gpu.snapshotDepthStencil(depth),
            ]),
          }
        : null,
    });
  }
  restore(state) {
    this.endSceneBatch();
    this.width = state.width;
    this.height = state.height;
    this.displayMode = structuredClone(state.displayMode);
    this.displayModes = structuredClone(state.displayModes);
    this.monitor = state.monitor;
    this.textureMemoryBudget = state.textureMemoryBudget;
    this.creation = [...state.creation];
    this.deviceCreated = state.deviceCreated;
    this.presentation = [...state.presentation];
    this.d3d = state.d3d;
    this.device = state.device;
    this.backbuffer = state.backbuffer;
    this.backDepth = state.backDepth;
    this.tables = new Map(state.tables);
    this.objects = new Map(structuredClone(state.objects));
    Object.assign(this.context, restoreD3DContext(state.context));
    this.transforms = new Map(structuredClone(state.transforms));
    this.viewport = [...state.viewport];
    this.scissor = [...state.scissor];
    this.samplerStages = new Map(
      state.samplerStages.map(([stage, states]) => [stage, new Map(states)]),
    );
    this.samplerStages.set(0, this.context.samplers);
    this.textures = new Map(state.textures);
    this.renderTargets = new Map(state.renderTargets ?? [[0, this.backbuffer]]);
    this.depthStencil = state.depthStencil ?? 0;
    this.scene = state.scene ?? false;
    this.fvf = state.fvf;
    this.frames.clear();
    this.commands = [];
    if (state.gpu) {
      if (!this.gpu) throw new Error('Native render-target checkpoint requires its shared GPU');
      for (const target of this.gpuTargets.values()) this.gpu.destroyRenderTarget(target);
      for (const depth of this.gpuDepth.values()) this.gpu.destroyDepthStencil(depth);
      this.gpuTargets.clear();
      this.gpuDepth.clear();
      this.gpu.uploadRenderTarget(this.gpu.primaryTarget, {
        width: this.gpu.primaryTarget.width,
        height: this.gpu.primaryTarget.height,
        rgba: state.gpu.primary.bytes,
      });
      this.gpu.restoreDepthStencil(this.gpu.primaryDepthStencil, state.gpu.primary.depth);
      for (const [pointer, target] of state.gpu.targets)
        this.gpuTargets.set(
          pointer,
          this.gpu.createRenderTarget(target.width, target.height, target.bytes),
        );
      for (const [pointer, saved] of state.gpu.depth)
        this.gpu.restoreDepthStencil(this.depthTarget(pointer), saved);
    }
    if (this.scene && this.gpu) this.sceneBatch = this.gpu.beginNativeBatch();
  }
}
