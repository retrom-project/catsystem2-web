// SPDX-License-Identifier: MPL-2.0
// The SDK's kind 55 is a Base-derived task with an original V8 isolate.
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NATIVE_PROFILES } from './catalog.mjs';
import { canonicalMessage } from './control-task.mjs';
import { NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { NativeSDKJavaScriptBanks } from './sdk-javascript-banks.mjs';

const SDK = 'sdk-4.01-engine-2.6.1.74',
  VTABLE = 0x9984c0,
  SIZE = 0x264,
  ROUTER = 'native SDK JavaScript task message router',
  COMMANDS = new Map([
    [0x3ce, [0x51a010, 2]],
    [0x3cf, [0x51a060, 2]],
    [0x3d0, [0x519e30, 4]],
    [0x3ee, [0x51a100, 2]],
  ]);

class NativeSDKJavaScriptTasks {
  constructor(engine, world, taskMemory, platform) {
    Object.assign(this, { engine, world, taskMemory, platform, process: engine.process });
    if (!engine.refs.sdkJavaScript)
      throw new Error('Original SDK JavaScript tasks require their initialized platform');
    const p = this.process;
    this.routeTrap = p.trap(ROUTER, 7, (args) => this.route(args));
    p.store(VTABLE + 16, this.routeTrap);
    this.commandVtable = p.allocate(20, true);
    p.store(this.commandVtable + 16, this.routeTrap);
    this.banks = new NativeSDKJavaScriptBanks(engine, world);
    engine.registerWindows('USER32.dll', 'SetRectEmpty', {
      count: 1,
      fn: ([at]) => {
        p.zero(at, 16);
        return 1;
      },
    });
    engine.registerFeature('sdk-javascript-tasks', this);
  }
  async create(record, { restoring = false } = {}) {
    const task = new NativeSDKJavaScriptTask(this, record);
    if (!restoring) await task.construct();
    return task;
  }
  call(address, args, pointer, options) {
    return this.engine[this.process.asyncEnabled ? 'callFromHost' : 'call'](
      address,
      args,
      pointer,
      options,
    );
  }
  async route([sender, target, raw, w, l, flags, out]) {
    const { world, engine, process: p } = this,
      current = world.objects.objects.get(engine.currentTaskID),
      origin = current?.nativeID === sender ? current.id : world.resolveTaskID(sender, current?.id);
    if (origin == null) throw new Error('Original JavaScript task sender has no Top namespace');
    const targetWorldID = raw === 1 ? null : world.resolveTaskID(target, origin),
      kind = world.objects.objects.get(targetWorldID)?.kind,
      context = {
        payload: this.platform.memory,
        nativePointer: true,
        nativeResult: out,
        nativeSenderWorldID: origin,
        fromHost: true,
        flags,
      },
      value = await world.sendNativeEngine(
        target,
        origin,
        canonicalMessage(SDK, kind, raw),
        w,
        l,
        context,
      );
    if (raw !== 1 && out && Number.isInteger(value)) p.store(out, value);
    return Number(Boolean(context.nativeRouted));
  }
  async command(id, args, machine, task) {
    const [handler, count] = COMMANDS.get(id),
      p = this.process,
      memory = this.taskMemory;
    memory.vmPointer(task.id);
    const source = await memory.pointer(task.id),
      bridge = new NativeKCSMemory(p, machine, memory.mapMachine(task.id, machine)),
      caller = p.allocate(184),
      words = p.allocate(count * 4 + 4),
      result = words + count * 4;
    let bank = 0;
    try {
      p.write(caller, p.read(source, 184));
      p.store(caller, this.commandVtable);
      for (let i = 0; i < count; i++) p.store(words + i * 4, args[i] ?? machine.nativeArgument(i));
      const link =
        id === 0x3ce
          ? this.world.objects.objects.get(this.world.resolveTaskID(p.load(words), task.id))
          : null;
      if (link?.kind === 55 || id === 0x3d0) {
        bank = this.banks.create(task);
        p.store(caller + 180, bank);
        if (link) p.store(caller + 104, this.banks.interpreter(bank));
      }
      p.store(result, NATIVE_RESULT_SENTINEL);
      const slot = NATIVE_PROFILES[SDK].tables.main.va + 4 * id,
        control = await this.call(handler, [bridge.pointer, caller, words, result], slot, {
          task: task.id,
        });
      if (control !== 2 || p.load(result) !== NATIVE_RESULT_SENTINEL)
        throw new Error('Original SDK JavaScript command changed its return contract');
      if (link?.kind === 55 && p.load(link.implementation.pointer + 172) === bank) {
        this.banks.attach(link.id, bank);
        bank = 0;
      }
      return nativeReply(control);
    } finally {
      try {
        this.banks.release(bank);
        bridge.close();
      } finally {
        p.free(words);
        p.free(caller);
      }
    }
  }
  recoverTrap(trap) {
    return trap.name === ROUTER
      ? { args: 7, real: false, handler: (args) => this.route(args) }
      : this.banks.recoverTrap(trap);
  }
  snapshot() {
    return {
      routeTrap: this.routeTrap,
      commandVtable: this.commandVtable,
      banks: this.banks.snapshot(),
    };
  }
  restore({ routeTrap, commandVtable, banks }) {
    const p = this.process;
    if (
      p.traps.get(routeTrap)?.name !== ROUTER ||
      p.load(VTABLE + 16) !== routeTrap ||
      p.allocations.get(commandVtable) !== 20 ||
      p.load(commandVtable + 16) !== routeTrap
    )
      throw new Error('Invalid original JavaScript task transport checkpoint');
    Object.assign(this, { routeTrap, commandVtable });
    this.banks.restore(banks);
  }
  close() {
    this.banks.close();
    this.process.free(this.commandVtable);
  }
}

class NativeSDKJavaScriptTask {
  constructor(owner, record) {
    Object.assign(this, { owner, record, pointer: 0 });
  }
  invoke(offset, args, context) {
    const { process: p, taskMemory } = this.owner,
      address = p.load(p.load(this.pointer) + offset),
      options =
        context === undefined
          ? { task: this.record.id }
          : taskMemory.messageOptions(this.record, context);
    return this.owner.call(address, args, this.pointer, options);
  }
  async construct() {
    const { world, process: p, taskMemory, platform } = this.owner,
      { record } = this,
      name = encodeCP932(record.name + '\0'),
      creator = world.runtime.scheduler.tasks.get(record.creator),
      context = encodeCP932((creator?.context?.contextName ?? '') + '\0');
    if (name.length > 32 || context.length > 260)
      throw new RangeError('Original JavaScript task name or context exceeds its native field');
    const text = p.allocate(name.length + context.length);
    this.pointer = p.allocate(SIZE, true);
    taskMemory.bind(record, this.pointer, { ready: false });
    p.write(text, name);
    p.write(text + name.length, context);
    try {
      const result = await this.owner.call(
        0x50e4b0,
        [
          record.nativeID,
          text,
          record.frameRate,
          platform.refs.view,
          world.window.handle,
          text + name.length,
        ],
        this.pointer,
        { task: record.id },
      );
      if (result !== this.pointer || p.load(this.pointer) !== VTABLE)
        throw new Error('Original JavaScript task constructor changed its identity');
      await taskMemory.ready(record);
    } catch (error) {
      taskMemory.unbind(record.id);
      throw error;
    } finally {
      p.free(text);
    }
  }
  async message([sender, message, w, l], context = {}) {
    const { process: p, taskMemory } = this.owner,
      raw = message >= 39 ? message - 2 : message,
      packet = p.allocate(28, true),
      out = context.nativeResult || packet + 24,
      writes = p.watchWrites(out, 4);
    try {
      if (message === 2 && context.nativeNewTask !== undefined)
        l = await taskMemory.pointer(context.nativeNewTask);
      const words = [this.record.nativeID, sender, raw, w, l, context.flags ?? 0];
      for (let i = 0; i < words.length; i++) p.store(packet + i * 4, words[i]);
      const unhandled = await this.invoke(24, [packet, out], context);
      context.nativeUnhandled = Boolean(unhandled);
      return writes.written ? p.load(out) : NATIVE_UNWRITTEN_WORD;
    } finally {
      writes.close();
      p.free(packet);
    }
  }
  async tick(frame) {
    const p = this.owner.process,
      out = p.allocate(4, true);
    try {
      await this.invoke(8, [frame >>> 0, out]);
      this.record.exitCode = p.load(this.pointer + 80) | 0;
    } finally {
      p.free(out);
    }
  }
  drawTick(frame) {
    return this.invoke(12, [frame >>> 0]);
  }
  snapshot() {
    return { pointer: this.pointer };
  }
  restore({ pointer }) {
    const p = this.owner.process;
    if (
      p.allocations.get(pointer) !== SIZE ||
      p.load(pointer) !== VTABLE ||
      p.load(pointer + 4) !== this.record.nativeID
    )
      throw new Error('Invalid original JavaScript task checkpoint');
    this.pointer = pointer;
  }
  async close() {
    if (!this.pointer) return;
    await this.invoke(0, [1]);
    this.owner.banks.detach(this.record.id);
    this.owner.taskMemory.unbind(this.record.id);
    this.pointer = 0;
  }
}

export function installNativeSDKJavaScriptTasks(world) {
  if (world.profile !== SDK) return;
  world.registerNativeFeature('sdk-javascript-tasks', async (engine) => {
    const tasks = await world.getNativeFeature('task-memory'),
      platform = await world.getNativeFeature('graphics-platform');
    await world.getNativeFeature('engine-files');
    return new NativeSDKJavaScriptTasks(engine, world, tasks, platform);
  });
  world.objects.register(55, async (record, _objects, options) =>
    (await world.getNativeFeature('sdk-javascript-tasks')).create(record, options),
  );
  for (const id of COMMANDS.keys())
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('sdk-javascript-tasks')).command(id, args, machine, task),
    );
}
