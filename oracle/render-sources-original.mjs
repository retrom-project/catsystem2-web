// SPDX-License-Identifier: MPL-2.0
// Original render-source arrays stay in KCS memory with their PE pointers.
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_RESULT_SENTINEL, nativeReply } from '../src/kcs/vm.mjs';
import { installNativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';

export const NATIVE_RENDER_SOURCE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x2bf, words: 3, control: 1, handlers: [0x64c520, 0x519040] }),
  Object.freeze({ id: 0x2c0, words: 2, control: 2, handlers: [0x64b860, 0x518420] }),
  Object.freeze({ id: 0x2c2, words: 2, control: 1, handlers: [0x64bc70, 0x518830] }),
  Object.freeze({ id: 0x2c5, words: 2, control: 1, handlers: [0x644480, 0x51cb30] }),
]);

const wrapperLayouts = [
  { arrayResult: 0x64c5c1, frameResult: 0x644492 },
  { arrayResult: 0x5190c9, frameResult: 0x51cb42 },
];

export class NativeRenderSources {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.sdk = engine.profile === 'sdk-4.01-engine-2.6.1.74';
    if (!this.sdk && engine.profile !== 'nekopara-vol3-engine-2.6.1.76')
      throw new Error('Native render sources require a reviewed engine profile');
    const p = engine.process,
      { stride, bytes } = nativeABI(engine.profile).graphics.renderSources,
      { arrayResult, frameResult } = wrapperLayouts[Number(this.sdk)],
      eax = () => p.cpu.reg_read_i32(p.uc.X86_REG_EAX) >>> 0;
    this.wrapperBytes = bytes;
    this.wrappers = new Map();
    this.detach = [
      p.observeFree((pointer) => this.wrappers.delete(pointer)),
      // The original loader still holds its translated destination in EDI.
      p.beforeInstruction(arrayResult, 'observe original 2BF image wrappers', () => {
        const count = eax(),
          destination = p.cpu.reg_read_i32(p.uc.X86_REG_EDI) >>> 0;
        for (let i = 0; i < count; i++) {
          const record = destination + i * stride;
          if (p.load(record) === 1) this.rememberWrapper(p.load(record + 4));
        }
      }),
      p.beforeInstruction(frameResult, 'observe original 2C5 image wrapper', () => {
        this.rememberWrapper(eax());
      }),
    ];
    engine.registerFeature('render-sources', this);
  }
  rememberWrapper(pointer) {
    if (
      this.engine.process.allocations.get(pointer) === this.wrapperBytes &&
      !this.wrappers.has(pointer)
    )
      this.wrappers.set(pointer, Symbol());
  }
  bitmapWrapperIdentity(pointer) {
    const identity = this.wrappers.get(pointer),
      p = this.engine.process;
    if (identity && p.allocations.get(p.load(pointer)) >= 92) return identity;
  }
  async withBitmapOperation(pointer, operation, name) {
    const engine = this.engine,
      identity = this.bitmapWrapperIdentity(pointer);
    if (!identity) throw new Error('Unknown or released bitmap ' + name + ' input ' + pointer);
    const execute = async () => {
      const images = this.world.graphics.images,
        memory = await this.world.getNativeFeature('bitmap-memory');
      if (identity !== this.bitmapWrapperIdentity(pointer))
        throw new Error('Native bitmap ' + name + ' wrapper was released before execution');
      const handle = images.create(0, 0),
        preparing = memory.preparingCall;
      memory.preparingCall = true;
      try {
        memory.borrow(handle, engine.process.load(pointer));
        return await operation(images.get(handle));
      } finally {
        try {
          await images.release(handle);
        } finally {
          memory.preparingCall = preparing;
        }
      }
    };
    if (engine.process.asyncEnabled) return execute();
    engine.pendingCalls++;
    const result = engine.queue.then(execute).finally(() => {
      engine.pendingCalls--;
    });
    engine.queue = result.catch(() => {});
    return result;
  }
  async apply(id, args, machine, task) {
    const spec = NATIVE_RENDER_SOURCE_CONTRACTS.find((entry) => entry.id === id);
    if (!spec) return undefined;
    const world = this.world,
      p = this.engine.process,
      taskMemory =
        world.objects.machine(task.id) === machine
          ? await world.getNativeFeature('task-memory')
          : null,
      load = id === 0x2bf,
      returnsWord = spec.control === 1,
      platform = load ? await world.getNativeFeature('graphics-platform') : null;
    if (platform) await platform.ensureRenderer();
    if (taskMemory) taskMemory.vmPointer(task.id);
    let bridge,
      temporaryHost = 0,
      temporaryArgs = 0,
      out = 0;
    try {
      let host = 0;
      if (platform) {
        host = taskMemory
          ? await taskMemory.pointer(task.id)
          : (temporaryHost = p.allocate(120, true));
        if (temporaryHost) p.store(host + 116, platform.refs.view);
        if (!platform.refs.view || p.load(host + 116) !== platform.refs.view)
          throw new Error("Native render-source factory requires its caller's initialized kcView");
      }
      const mapping = taskMemory?.mapMachine(task.id, machine);
      if (id !== 0x2c5) bridge = new NativeKCSMemory(p, machine, mapping);
      let argv;
      if (mapping && task.io?.native === id && task.io.pc === machine.pc) {
        // GCALL passes the actual argument span. 2C0 reloads the count word
        // after each record, so a destination can alias that stack word.
        argv = mapping.memory.pointer + machine.nativeArgumentBase;
      } else {
        argv = temporaryArgs = p.allocate(spec.words * 4);
        for (let i = 0; i < spec.words; i++)
          p.store(argv + i * 4, i < args.length ? args[i] : machine.nativeArgument(i));
      }
      out = p.allocate(4);
      p.store(out, NATIVE_RESULT_SENTINEL);
      const params = [bridge?.pointer ?? 0, host, argv, out],
        address = spec.handlers[Number(this.sdk)],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, params, undefined, options)
          : await this.engine.call(address, params, undefined, options),
        value = p.load(out);
      if (control !== spec.control || (!returnsWord && value !== NATIVE_RESULT_SENTINEL))
        throw new Error('Original render-source wrapper changed its output contract');
      return nativeReply(control, returnsWord ? value : undefined);
    } finally {
      try {
        bridge?.close();
      } finally {
        for (const address of [out, temporaryArgs, temporaryHost]) if (address) p.free(address);
      }
    }
  }
  snapshot() {
    return { wrappers: [...this.wrappers.keys()] };
  }
  restore(state) {
    this.wrappers.clear();
    for (const pointer of state.wrappers) this.rememberWrapper(pointer);
    if (this.wrappers.size !== state.wrappers.length)
      throw new Error('Invalid native render-source wrapper identities');
  }
  close() {
    for (const detach of this.detach.reverse()) detach();
    this.wrappers.clear();
  }
}

export function installNativeRenderSources(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('render-sources', async (engine) => {
    await world.getNativeFeature('engine-files');
    await world.getNativeFeature('data-buffers');
    await world.getNativeFeature('retained-draw');
    return new NativeRenderSources(engine, world);
  });
  for (const { id } of NATIVE_RENDER_SOURCE_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('render-sources')).apply(id, args, machine, task),
    );
}
