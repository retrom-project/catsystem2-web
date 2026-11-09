// SPDX-License-Identifier: MPL-2.0
// The original kcXml document and its node storage belong to the guest heap.
import { nativeReply } from '../kcs/vm.mjs';
import { NATIVE_PROFILES } from './catalog.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

const open = 0x24e,
  release = 0x24f,
  readInteger = 0x250,
  readText = 0x251,
  documentSize = 8,
  handleType = 'script-xml';

class NativeScriptXML {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.process = engine.process;
    engine.refs.scriptXML ??= new Set();
    engine.registerFeature('script-xml', this);
  }
  get documents() {
    return this.engine.refs.scriptXML;
  }
  pointer(handle) {
    if (!handle) return 0;
    const { pointer } = this.world.runtime.handles.get(handle, handleType);
    if (!this.documents.has(pointer) || this.process.allocations.get(pointer) !== documentSize)
      throw new Error('Native XML document is not live');
    return pointer;
  }
  call(id, args, task) {
    const engine = this.engine,
      p = this.process,
      table = NATIVE_PROFILES[engine.profile].tables.main.va,
      address = p.load(table + id * 4);
    return p.asyncEnabled
      ? engine.callFromHost(address, args, undefined, { task })
      : engine.call(address, args, undefined, { task });
  }
  async apply(id, args, machine, task) {
    const argc = id === open || id === release ? 1 : 3;
    if (args.length !== argc)
      throw new Error(`KCS XML native 0x${id.toString(16)} expects ${argc} arguments`);
    const pointer = id === open ? 0 : this.pointer(args[0]),
      world = this.world,
      taskMemory =
        world.objects.machine(task.id) === machine
          ? await world.getNativeFeature('task-memory')
          : null;
    if (taskMemory) taskMemory.vmPointer(task.id);
    const p = this.process,
      vm = new NativeKCSMemory(p, machine, taskMemory?.mapMachine(task.id, machine)),
      argv = p.allocate(argc * 4),
      out = p.allocate(4);
    try {
      args.forEach((word, i) => p.store(argv + i * 4, word));
      if (id !== open) p.store(argv, pointer);
      p.store(out, 0xcccccccc);
      const control = await this.call(id, [vm.pointer, 0, argv, out], task.id),
        expected = id === open || id === readInteger ? 1 : 2;
      if (control !== expected)
        throw new Error('Original XML native returned an unexpected control');
      if (id === open) {
        const document = p.load(out);
        if (!document) return nativeReply(1, 0);
        if (p.allocations.get(document) !== documentSize || this.documents.has(document))
          throw new Error('Original XML native returned an invalid owner');
        this.documents.add(document);
        return nativeReply(1, world.runtime.handles.add(handleType, { pointer: document }));
      }
      if (id === release && pointer) {
        if (p.allocations.has(pointer)) throw new Error('Original XML native retained its owner');
        this.documents.delete(pointer);
        world.runtime.handles.release(args[0], handleType);
      }
      return nativeReply(control, control === 1 ? p.load(out) : undefined);
    } finally {
      try {
        vm.close();
      } finally {
        p.free(out);
        p.free(argv);
      }
    }
  }
  snapshot() {
    return {};
  }
  restore() {
    if (!(this.documents instanceof Set)) throw new Error('Invalid native XML owner registry');
  }
  async close() {
    if (!this.documents.size) return;
    const p = this.process,
      argv = p.allocate(4);
    try {
      for (const pointer of this.documents) {
        p.store(argv, pointer);
        if ((await this.call(release, [0, 0, argv, 0])) !== 2 || p.allocations.has(pointer))
          throw new Error('Original XML teardown did not release its owner');
        this.documents.delete(pointer);
      }
    } finally {
      p.free(argv);
    }
  }
}

export function installNativeScriptXML(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('script-xml', async (engine) => {
    await world.getNativeFeature('engine-files');
    return new NativeScriptXML(engine, world);
  });
  for (const id of [open, release, readInteger, readText])
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('script-xml')).apply(id, args, machine, task),
    );
}
