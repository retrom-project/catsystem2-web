// SPDX-License-Identifier: MPL-2.0
// All model/profile/action/lip/inertia execution belongs to the mounted engine
// and driver. This module supplies the browser's task/file/graphics boundaries.
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeEmoteDevice } from '../oracle/m2-device-original.mjs';
import { NativeEmoteBlocks } from '../oracle/m2-driver-blocks-original.mjs';
import { NativeEmoteGraphics } from './m2-graphics-original.mjs';
import { NativeEmoteConfiguration } from './m2-configuration-original.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { NativeEmoteDictionary } from './m2-dictionary-original.mjs';
import { NativeM2Blocks } from './m2-blocks-original.mjs';
import { NativeSDKM2Tasks } from './m2-sdk-task-original.mjs';
import { installNativeFESM2 } from './m2-fes-original.mjs';
import { installNativeTaskMemory } from '../src/native/task-memory.mjs';
import { nativeReply } from '../src/kcs/vm.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { installNativeRasterKernels } from '../src/native/raster-projection.mjs';
export const NATIVE_M2_IDS = Object.freeze([
  ...Array.from({ length: 28 }, (_, i) => 906 + i),
  965,
  966,
  1025,
  1027,
  1028,
  1029,
  1030,
  1047,
  1048,
]);
const byID = Object.freeze({
  906: 0x64d2b0,
  907: 0x64cc40,
  908: 0x64d730,
  909: 0x64cf10,
  910: 0x64ccd0,
  911: 0x64d350,
  912: 0x64d300,
  913: 0x64d390,
  914: 0x64d570,
  915: 0x64d520,
  916: 0x64d5b0,
  917: 0x64d230,
  918: 0x64d280,
  919: 0x64d670,
  920: 0x64d030,
  921: 0x64d450,
  922: 0x64cfd0,
  923: 0x64d210,
  924: 0x64d0f0,
  925: 0x64cf50,
  926: 0x64cd80,
  927: 0x64cc10,
  928: 0x64cc70,
  929: 0x64d120,
  930: 0x64d760,
  931: 0x64cca0,
  932: 0x64cb50,
  933: 0x64cbb0,
  965: 0x64d790,
  966: 0x64d160,
  1025: 0x64d6d0,
  1027: 0x64d080,
  1028: 0x64cf70,
  1029: 0x64ceb0,
  1030: 0x64cdc0,
  1047: 0x64cff0,
  1048: 0x64cb70,
});
export class NativeM2 {
  static async open(engine, world) {
    const owner = new NativeM2(engine, world);
    await owner.load();
    return owner;
  }
  constructor(engine, world) {
    if (nativeABI(engine.profile).plugins.emoteDriver !== 'native')
      throw new Error('This engine profile has no native E-mote driver');
    Object.assign(this, { engine, world, process: engine.process });
    this.tasks = new Map();
    this.sidecars = new Map();
    this.initialized = false;
    this.configuration = new NativeEmoteConfiguration(this);
  }
  get memory() {
    const p = this.process;
    return {
      load: (address) => p.load(address),
      store: (address, value) => p.store(address, value),
      bytes: (address, size) => p.read(address, size),
      string: (address) => p.string(address),
      writeString: (address, text) => this.engine.kernel.writeString(address, text),
    };
  }
  async load() {
    this.rasterAcceleration = installNativeRasterKernels(this.engine);
    this.taskMemory = await this.world.getNativeFeature('task-memory');
    const platform = await this.world.getNativeFeature('graphics-platform');
    const renderer = await this.world.getNativeFeature('renderer');
    const p = this.process,
      world = this.world,
      gpu = world.getNativeGPU();
    if (!gpu) throw new Error('Native M2 requires the shared GPU before initialization');
    this.engine.kernel.registerFiles('m2', {
      read: async (path) => {
        if (path === 'm2setting.xml' || path === '/m2setting.xml')
          return world.storage.read('m2setting.xml');
        if (/^[a-z]:|^\//i.test(path)) return undefined;
        for (const category of ['m2psb', 'm2config']) {
          const resolved = world.game.resolveCategory?.(path, category);
          if (resolved) return world.game.readCategory(path, category);
        }
        return undefined;
      },
      write: async (path, bytes) => {
        if (path !== 'm2setting.xml' && path !== '/m2setting.xml') return undefined;
        await world.storage.write('m2setting.xml', bytes);
        return true;
      },
    });
    const driver = this.engine.module.pe.imports.find(
      (symbol) => symbol.name === '?EmoteCreate@@YAPAVIEmoteDevice@@ABUInitParam@1@@Z',
    );
    if (!driver) throw new Error('Native M2 profile has no driver import');
    this.device = new NativeEmoteDevice(null, {
      process: p,
      services: this.engine.kernel,
      d3d: renderer.d3d,
      width: world.game.width,
      height: world.game.height,
      context: world.graphics.d3dContext,
      recordCommands: false,
      name: driver.dll,
    });
    this.device.d3d.attachGPU(gpu);
    await this.device.load(await world.game.require(driver.dll), { createDevice: false });
    this.engine.linkImports(this.device.module);
    this.graphics = new NativeEmoteGraphics(this, platform);
    this.acceleration = new NativeM2Blocks(p);
    this.driverAcceleration = new NativeEmoteBlocks(this.device);
    for (const [name, count, fn] of [
      [
        'SetRectEmpty',
        1,
        ([out]) => {
          p.zero(out, 16);
          return 1;
        },
      ],
      [
        'MessageBoxW',
        4,
        ([, text, title]) => {
          if (!world.host.nativeMessageBox)
            throw new Error(
              `Native message box: ${p.string(title, true)}: ${p.string(text, true)}`,
            );
          return world.host.nativeMessageBox(p.string(text, true), p.string(title, true));
        },
      ],
    ])
      this.engine.registerWindows('USER32.dll', name, { count, fn });
    this.routeTrap = p.trap('M2 task message router', 7, (args) => this.route(args));
    p.store(0x8d3478 + 16, this.routeTrap);
    this.engine.patch(0x6a7000, 'native debug text window', 2, ([, text]) => {
      world.host.nativeLog?.(p.string(text));
      return 1;
    });
    world.fesConfiguration.m2 = this.configuration;
    this.engine.registerFeature('m2', this);
  }
  async initialize() {
    if (this.initialized) return;
    await this.graphics.platform.ensureRenderer();
    const pointer = this.process.load(0xb9bd94);
    if (!pointer) throw new Error('Original view did not initialize its E-mote manager');
    this.device.pointer = this.process.load(pointer + 60);
    this.initialized = true;
  }
  async route([sender, target, message, w, l, flags, out]) {
    const senderWorldID = this.world.resolveTaskID(sender, this.engine.currentTaskID),
      context = {
        payload: this.memory,
        nativePointer: true,
        nativeResult: out,
        nativeSenderWorldID: senderWorldID,
        fromHost: true,
        flags,
      };
    const reply = await this.world.sendNativeEngine(target, senderWorldID, message, w, l, context);
    if (out && Number.isInteger(reply)) this.process.store(out, reply);
    if ((message === 220 || message === 221) && l) {
      const handle = this.process.load(l);
      if (handle) {
        const bytes = this.world.runtime.handles.get(handle, 'sound-sidecar');
        let pointer = this.sidecars.get(handle);
        if (!pointer) {
          pointer = this.process.allocate(bytes.length);
          this.process.write(pointer, bytes);
          this.sidecars.set(handle, pointer);
        }
        this.process.store(l, pointer);
      }
    }
    return Number(context.nativeRouted);
  }
  async apply(id, args, machine, task) {
    if (!byID[id]) return undefined;
    if (id !== 925) await this.initialize();
    if (this.world.objects.machine(task.id) === machine) this.taskMemory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(
        p,
        machine,
        this.world.objects.machine(task.id) === machine
          ? this.taskMemory.mapMachine(task.id, machine)
          : undefined,
      ),
      host = p.allocate(128, true),
      vtable = p.allocate(20, true),
      parameterBytes =
        machine.nativeArgumentBase === undefined
          ? null
          : machine.bytes(
              machine.nativeArgumentBase,
              machine.memory.length - machine.nativeArgumentBase,
            ),
      parameters = p.allocate(Math.max(4, parameterBytes?.length ?? args.length * 4), true),
      output = p.allocate(4, true);
    let dictionary;
    p.store(host, vtable);
    p.store(
      host + 4,
      task.nativeID ?? this.world.objects.objects.get(task.id)?.nativeID ?? task.id,
    );
    p.store(vtable + 16, this.routeTrap);
    if (parameterBytes) p.write(parameters, parameterBytes);
    else args.forEach((word, i) => p.store(parameters + i * 4, word));
    try {
      if ([913, 916, 921, 966].includes(id) && args[1]) {
        dictionary = new NativeEmoteDictionary(
          p,
          this.world.runtime.handles.get(args[1], 'dictionary'),
        );
        p.store(parameters + 4, dictionary.pointer);
      }
      const control = await this.engine.call(
        byID[id],
        [bridge.pointer, host, parameters, output],
        undefined,
        { task: task.id },
      );
      return nativeReply(control, control === 1 || control === 3 ? p.load(output) : undefined);
    } catch (cause) {
      throw new Error(
        `Original M2 native 0x${id.toString(16)} for task ${task.id}: ${cause.message}`,
        { cause },
      );
    } finally {
      dictionary?.close();
      bridge.close();
      for (const at of [output, parameters, vtable, host]) p.free(at);
    }
  }
  async create(record, { restoring = false, fromHost = false } = {}) {
    const task = new NativeM2Task(this, record);
    this.tasks.set(record.id, task);
    this.world.graphics.tasks.set(record.id, task);
    if (!restoring) await task.construct({ fromHost });
    return task;
  }
  recoverTrap(trap) {
    if (trap.name === 'M2 task message router')
      return { args: 7, real: false, handler: (args) => this.route(args) };
    return this.device.recoverTrap(trap);
  }
  beforeCall() {
    for (const [handle, pointer] of this.sidecars)
      if (!this.world.runtime.handles.records.has(handle)) {
        if (!this.process.free(pointer))
          throw new Error('Native M2 sidecar allocation was already released');
        this.sidecars.delete(handle);
      }
  }
  snapshot() {
    return {
      initialized: this.initialized,
      routeTrap: this.routeTrap,
      device: this.device.snapshot({ includeProcess: false }),
      graphics: this.graphics.snapshot(),
      sidecars: [...this.sidecars],
    };
  }
  restore(state) {
    this.initialized = state.initialized;
    this.routeTrap = state.routeTrap;
    this.device.restore(state.device);
    this.graphics.restore(state.graphics);
    this.sidecars = new Map(state.sidecars);
  }
  async close() {
    if (this.closed) return;
    const errors = [];
    try {
      if (this.initialized && this.process.load(0xb9bd94)) await this.engine.call(0x57cdf0);
    } catch (error) {
      errors.push(error);
    } finally {
      for (const pointer of this.sidecars.values()) this.process.free(pointer);
      this.sidecars.clear();
      for (const resource of [
        this.graphics,
        this.driverAcceleration,
        this.device,
        this.acceleration,
      ])
        try {
          resource.close();
        } catch (error) {
          errors.push(error);
        }
      this.closed = true;
    }
    if (errors.length) throw new AggregateError(errors, 'Native M2 cleanup failed');
  }
}
export class NativeM2Task {
  constructor(owner, record) {
    this.owner = owner;
    this.record = record;
    this.world = owner.world;
    this.plane = owner.graphics.plane(record);
    this.pointer = 0;
    this.base = this.world.base(record);
  }
  get graph() {
    return this.plane.graph;
  }
  get state() {
    return this.plane.state;
  }
  async invoke(address, args = [], { fromHost = false, messageContext } = {}) {
    await this.owner.taskMemory.push();
    this.owner.graphics.sync();
    const fn = fromHost || this.owner.process.asyncEnabled ? 'callFromHost' : 'call';
    try {
      return await this.owner.engine[fn](address, args, this.pointer, {
        task: this.record.id,
        messageContext,
      });
    } finally {
      this.owner.graphics.pull();
    }
  }
  async construct({ fromHost = false } = {}) {
    await this.owner.initialize();
    const p = this.owner.process,
      name = encodeCP932(this.record.name + '\0'),
      at = p.allocate(name.length);
    this.pointer = p.allocate(0x4b8, true);
    this.owner.taskMemory.bind(this.record, this.pointer, { ready: false });
    p.write(at, name);
    try {
      await this.invoke(
        0x637cf0,
        [
          this.record.nativeID ?? this.record.id,
          at,
          this.record.frameRate,
          this.owner.graphics.refs.view,
        ],
        { fromHost },
      );
      await this.owner.taskMemory.ready(this.record);
    } finally {
      p.free(at);
    }
  }
  async message([sender, message, w, l], context = {}) {
    if (!this.pointer) throw new Error('M2 task has no original native instance');
    const p = this.owner.process,
      owned = [],
      outputs = [];
    let resultWrites;
    this.sender = sender;
    try {
      if (!context.nativePointer) {
        const intercepted = new Set([
          3,
          19,
          49,
          50,
          51,
          52,
          55,
          56,
          57,
          58,
          59,
          62,
          63,
          66,
          67,
          ...Array.from({ length: 31 }, (_, i) => 524 + i),
        ]);
        if (!intercepted.has(message)) return this.plane.message([sender, message, w, l], context);
        const source = () => {
          const memory = context.payload || context.machine || this.world.objects.machine(sender);
          if (!memory) throw new Error(`M2 message ${message} needs its sender memory`);
          return memory;
        };
        const copy = (address, size, output = false) => {
          if (!address) return 0;
          const bytes = source().bytes(address, size),
            pointer = p.allocate(size, true);
          p.write(pointer, bytes);
          owned.push(pointer);
          if (output) outputs.push(() => bytes.set(p.read(pointer, size)));
          return pointer;
        };
        const string = (address) => {
          if (!address) return 0;
          const bytes = encodeCP932(source().string(address) + '\0'),
            pointer = p.allocate(bytes.length);
          p.write(pointer, bytes);
          owned.push(pointer);
          return pointer;
        };
        if ([530, 531, 532, 538].includes(message)) w = string(w);
        if ([524, 533, 543, 551].includes(message)) l = string(l);
        else if ([49, 51, 55, 66, 529, 536, 537].includes(message))
          l = copy(l, 12, [529, 537].includes(message));
        else if (message === 62) l = copy(l, 8, true);
        else if (message === 530 || message === 532) l = copy(l, 4);
        else if (message === 547) l = copy(l, 72);
        else if (message === 534 && l) {
          const memory = source();
          let capacity = context.capacity;
          if (capacity === undefined && memory.region) {
            const [bytes, offset] = memory.region(l, 0);
            capacity = bytes.length - offset;
          }
          if (!Number.isInteger(capacity) || capacity < 1)
            throw new Error('M2 string output requires its actual destination capacity');
          l = copy(l, capacity, true);
        }
      }
      const out = context.nativeResult ?? p.allocate(4, true);
      if (context.nativeResult === undefined) owned.push(out);
      resultWrites = p.watchWrites(out, 4);
      const rawSender = this.world.objects.objects.get(sender)?.nativeID ?? sender;
      const handled = await this.invoke(
        0x6384c0,
        [rawSender, message, w, l, context.flags ?? 0, out],
        {
          fromHost: Boolean(context.fromHost),
          ...this.owner.taskMemory.messageOptions(this.record, context),
        },
      );
      context.nativeUnhandled = Boolean(handled);
      for (const write of outputs) write();
      if (message === 3) this.destroyNotified = true;
      if (handled) return this.base.message([sender, message, w, l], context);
      this.plane.sync();
      return resultWrites.written ? p.load(out) : undefined;
    } finally {
      resultWrites?.close();
      for (const at of owned) p.free(at);
      this.sender = undefined;
    }
  }
  async drawTick(frame) {
    if (!this.pointer) return;
    this.owner.device.d3d.commands = [];
    await this.invoke(0x638220, [frame >>> 0]);
  }
  async tick(frame) {
    if (!this.pointer) return;
    const p = this.owner.process,
      out = p.allocate(4, true);
    p.store(this.pointer + 92, this.record.userValue ?? 0);
    try {
      await this.invoke(0x6382f0, [frame >>> 0, out]);
    } finally {
      p.free(out);
    }
  }
  async drawGPU(gpu, { fromHost = false } = {}) {
    if (
      !this.graph ||
      !this.state.shown ||
      this.graph.renderEnabled === false ||
      !new DataView(this.graph.kx2.buffer).getInt32(MOTION_ABI.display, true)
    )
      return;
    if (gpu !== this.owner.device.d3d.gpu)
      throw new Error('M2 task compositor differs from the native device');
    const callback = this.owner.graphics.callbacks.get(this.record.id);
    if (callback)
      await this.world.stageRenderer.withPluginTarget(this.owner.device.d3d, () =>
        this.invoke(callback.callback, [callback.object, 1], { fromHost }),
      );
  }
  snapshot() {
    return {
      pointer: this.pointer,
      destroyNotified: Boolean(this.destroyNotified),
      plane: this.plane.snapshot(),
    };
  }
  restore(state) {
    this.pointer = state.pointer;
    this.destroyNotified = state.destroyNotified;
    this.plane.restore(state.plane);
  }
  async close({ fromHost = false } = {}) {
    if (this.closed) return;
    try {
      if (this.pointer) {
        if (!this.destroyNotified)
          await this.message([this.record.id, 3, 0, 0], { nativePointer: true, fromHost });
        const p = this.owner.process;
        await this.invoke(p.load(p.load(this.pointer)), [1], { fromHost });
      }
    } finally {
      this.owner.tasks.delete(this.record.id);
      this.owner.taskMemory.unbind(this.record.id);
      await this.plane.close();
      this.closed = true;
    }
  }
}
export function installNativeM2(world) {
  installNativeTaskMemory(world);
  if (nativeABI(world.profile).plugins.emoteDriver === 'native') {
    world.registerNativeFeature('m2', (engine) => NativeM2.open(engine, world));
    world.objects.register(54, async (record, _objects, options) =>
      (await world.getNativeFeature('m2')).create(record, options),
    );
    for (const id of NATIVE_M2_IDS)
      world.runtime.register('main', id, async (args, machine, task) =>
        (await world.getNativeFeature('m2')).apply(id, args, machine, task),
      );
  } else if (nativeABI(world.profile).plugins.emoteDriver === 'placeholder') {
    world.registerNativeFeature('m2-task', (engine) => NativeSDKM2Tasks.open(engine, world));
    world.objects.register(54, async (record, _objects, options) =>
      (await world.getNativeFeature('m2-task')).create(record, options),
    );
  } else throw new Error('M2 factory requires a reviewed native profile');
  installNativeFESM2(world);
}
