// SPDX-License-Identifier: MPL-2.0
// Original UTF-8/UTF-16 conversion, percent escaping and CRT logging execute
// unchanged. Only the wrapper's private OS calls cross to browser services.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

export const NATIVE_UNICODE_OUTPUT_IDS = Object.freeze([0x40f, 0x410]);
const PROFILE = 'nekopara-vol3-engine-2.6.1.76';
const HANDLERS = Object.freeze({ 0x40f: 0x64fc70, 0x410: 0x650ad0 });
const LOG_GLOBALS = [0xb8f188, 0xb8f194, 0xb8f18c];
// Every boundary is one CALL [IAT] instruction inside the reviewed handler.
const BOUNDARIES = [
  ['open', 0x64fd01, 0x8c6538, 1],
  ['empty', 0x64fd0b, 0x8c6544, 0],
  ['allocate', 0x64fd3d, 0x8c62d8, 2],
  ['lock', 0x64fd4a, 0x8c62dc, 1],
  ['unlock', 0x64fd5d, 0x8c62e0, 1],
  ['write', 0x64fd66, 0x8c6540, 2],
  ['close', 0x64fd6c, 0x8c653c, 0],
  ['log', 0x5cad98, 0x8c6434, 4],
];
const boolean = (value, label) => {
  if (value !== true && value !== false && value !== 0 && value !== 1)
    throw new TypeError(`Native clipboard ${label} must report success or failure`);
  return Number(Boolean(value));
};

export class NativeUnicodeOutput {
  constructor(engine, world) {
    if (engine.profile !== PROFILE)
      throw new Error('Unicode output requires its reviewed game profile');
    Object.assign(this, { engine, world, process: engine.process });
    this.globalAllocations = new Map();
    this.traps = [];
    const p = this.process;
    for (const [name, site, iat, count] of BOUNDARIES) {
      const source = p.read(site, 6);
      if (
        source[0] !== 0xff ||
        source[1] !== 0x15 ||
        new DataView(source.buffer).getUint32(2, true) !== iat
      )
        throw new Error(`Original Unicode output ${name} call has changed`);
      const trap = p.trap(`native Unicode output ${name}`, count, (args) =>
          this.dispatch(name, args),
        ),
        jump = new Uint8Array([0xe8, 0, 0, 0, 0, 0x90]);
      new DataView(jump.buffer).setInt32(1, trap - site - 5, true);
      p.write(site, jump);
      this.traps.push(trap);
    }
    engine.registerFeature('unicode-output', this);
  }
  context() {
    const context = this.engine.currentMessageContext?.unicodeOutput;
    if (context?.feature !== this) throw new Error('Native Unicode output has no active caller');
    return context;
  }
  prepare(context) {
    if (context.id !== 0x410 || context.previousGlobals) return;
    context.previousGlobals = LOG_GLOBALS.map((address) => this.process.load(address));
    // Browser Diagnostics supplies the otherwise optional Win32 debug window.
    // This is a temporary platform projection, not GUI initialization.
    for (const address of LOG_GLOBALS) this.process.store(address, 1);
  }
  restoreGlobals(context) {
    if (!context.previousGlobals) return;
    LOG_GLOBALS.forEach((address, i) => this.process.store(address, context.previousGlobals[i]));
    context.previousGlobals = null;
  }
  beforeCall() {
    const context = this.engine.currentMessageContext?.unicodeOutput;
    if (context?.feature === this) this.prepare(context);
  }
  afterCall() {
    const context = this.engine.currentMessageContext?.unicodeOutput;
    if (context?.feature === this) this.restoreGlobals(context);
  }
  async dispatch(name, args) {
    const context = this.context(),
      p = this.process,
      clipboard = context.services.nativeClipboard;
    switch (name) {
      case 'open': {
        const result = boolean(await clipboard.open(args[0]), 'open');
        context.clipboardOpen = Boolean(result);
        return result;
      }
      case 'empty':
        return boolean(await clipboard.empty(), 'empty');
      case 'allocate': {
        const [flags, size] = args;
        if (flags !== 0x42) throw new Error('Unicode clipboard allocation flags changed');
        try {
          const pointer = p.allocate(size, true);
          this.globalAllocations.set(pointer, size);
          return pointer;
        } catch {
          // GlobalAlloc reports allocation failure as NULL. The preceding
          // EmptyClipboard has already occurred in the original wrapper.
          return 0;
        }
      }
      case 'lock':
        return this.globalAllocations.has(args[0]) ? args[0] : 0;
      case 'unlock':
        return 0;
      case 'write': {
        const [format, handle] = args;
        if (format !== 13 || !this.globalAllocations.has(handle))
          throw new Error('Unicode clipboard submitted an invalid global object');
        const copied = boolean(await clipboard.write(p.string(handle, true)), 'write');
        if (copied) {
          // The external clipboard takes ownership of the copied UTF-16 text.
          p.free(handle);
          this.globalAllocations.delete(handle);
        }
        return copied ? handle : 0;
      }
      case 'close': {
        const result = boolean(await clipboard.close(), 'close');
        context.clipboardOpen = false;
        return result;
      }
      case 'log': {
        const [window, message, w, text] = args;
        if (window !== 1 || message !== 0x401 || w !== 0)
          throw new Error('Native Unicode logger changed its debug-window message');
        await context.services.nativeDebugOutput(p.stringBytes(text).slice());
        return 0;
      }
      default:
        throw new Error(`Unrecognized Unicode output boundary ${name}`);
    }
  }
  async invoke(id, args, machine, task) {
    if (!NATIVE_UNICODE_OUTPUT_IDS.includes(id)) return undefined;
    if (args.length !== 1)
      throw new Error(`Unicode output 0x${id.toString(16)} expects one argument`);
    const services = this.world.runtime.services;
    if (id === 0x410 && typeof services.nativeDebugOutput !== 'function')
      throw new Error('Native Unicode output requires its debug-window service');
    if (id === 0x40f) {
      for (const name of ['open', 'empty', 'write', 'close'])
        if (typeof services.nativeClipboard?.[name] !== 'function')
          throw new Error(`Native Unicode clipboard requires ${name}`);
      if (typeof services.nativeWindowHandle !== 'function')
        throw new Error('Native Unicode clipboard requires its caller window handle');
    }
    const p = this.process,
      taskMemory =
        this.world.objects.machine(task.id) === machine
          ? await this.world.getNativeFeature('task-memory')
          : null;
    if (taskMemory) taskMemory.vmPointer(task.id);
    const bridge = new NativeKCSMemory(p, machine, taskMemory?.mapMachine(task.id, machine)),
      argv = p.allocate(4),
      out = p.allocate(4),
      caller = id === 0x40f ? p.allocate(124, true) : 0,
      context = { feature: this, id, services, clipboardOpen: false },
      options = { task: task.id, messageContext: { unicodeOutput: context } };
    try {
      if (caller) {
        const owner = services.nativeWindowHandle(task.id);
        if (!Number.isInteger(owner) || owner < 0 || owner > 0xffffffff)
          throw new TypeError('Native clipboard window handle must be a DWORD');
        p.store(caller + 120, owner);
      }
      p.store(argv, args[0]);
      p.store(out, 0xcccccccc);
      let control;
      if (p.asyncEnabled) {
        this.prepare(context);
        try {
          control = await this.engine.callFromHost(
            HANDLERS[id],
            [bridge.pointer, caller, argv, out],
            undefined,
            options,
          );
        } finally {
          this.restoreGlobals(context);
        }
      } else
        control = await this.engine.call(
          HANDLERS[id],
          [bridge.pointer, caller, argv, out],
          undefined,
          options,
        );
      return nativeReply(control);
    } finally {
      try {
        if (context.clipboardOpen) await services.nativeClipboard.close();
      } finally {
        try {
          bridge.close();
        } finally {
          if (caller) p.free(caller);
          p.free(out);
          p.free(argv);
        }
      }
    }
  }
  recoverTrap(trap) {
    if (!trap.name.startsWith('native Unicode output ')) return null;
    const name = trap.name.replace(/^native Unicode output /, ''),
      boundary = BOUNDARIES.find(([key]) => key === name);
    return boundary
      ? { args: boundary[3], real: false, handler: (args) => this.dispatch(name, args) }
      : null;
  }
  snapshot() {
    return { traps: [...this.traps], globalAllocations: [...this.globalAllocations] };
  }
  restore(state) {
    this.traps = [...state.traps];
    this.globalAllocations = new Map(state.globalAllocations);
  }
  close() {
    for (const pointer of this.globalAllocations.keys()) this.process.free(pointer);
    this.globalAllocations.clear();
  }
}

export function installNativeUnicodeOutput(world) {
  if (world.profile !== PROFILE) return;
  world.registerNativeFeature('unicode-output', (engine) => new NativeUnicodeOutput(engine, world));
  for (const id of NATIVE_UNICODE_OUTPUT_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('unicode-output')).invoke(id, args, machine, task),
    );
}
