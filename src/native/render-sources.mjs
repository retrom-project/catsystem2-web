// SPDX-License-Identifier: MPL-2.0
// Original render-source arrays stay in KCS memory with their PE pointers.
import { NATIVE_RESULT_SENTINEL, nativeReply } from '../kcs/vm.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

export const NATIVE_RENDER_SOURCE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x2bf, words: 3, control: 1, handlers: [0x64c520, 0x519040] }),
  Object.freeze({ id: 0x2c0, words: 2, control: 2, handlers: [0x64b860, 0x518420] }),
]);

export class NativeRenderSources {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.sdk = engine.profile === 'sdk-4.01-engine-2.6.1.74';
    if (!this.sdk && engine.profile !== 'nekopara-vol3-engine-2.6.1.76')
      throw new Error('Native render sources require a reviewed engine profile');
    engine.registerFeature('render-sources', this);
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
      bridge = new NativeKCSMemory(p, machine, mapping);
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
      const params = [bridge.pointer, host, argv, out],
        address = spec.handlers[Number(this.sdk)],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, params, undefined, options)
          : await this.engine.call(address, params, undefined, options),
        value = p.load(out);
      if (control !== spec.control || (!load && value !== NATIVE_RESULT_SENTINEL))
        throw new Error('Original render-source wrapper changed its output contract');
      return nativeReply(control, load ? value : undefined);
    } finally {
      try {
        bridge?.close();
      } finally {
        for (const address of [out, temporaryArgs, temporaryHost]) if (address) p.free(address);
      }
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
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
