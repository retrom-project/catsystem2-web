// SPDX-License-Identifier: MPL-2.0
import { KCSMachine, nativeReply } from './vm.mjs';

// Browser I/O is awaited inside the current logical frame. Guest frame yields
// remain distinct, so disk/cache speed cannot become an extra game frame.
export class KCSScheduler {
  get shared() {
    const bytes = this.sharedBinding ? this.sharedBinding.bytes() : this.sharedStorage;
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('KCS scheduler shared backing must provide bytes');
    return bytes;
  }
  set shared(bytes) {
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('KCS scheduler shared backing must be bytes');
    this.sharedBinding = null;
    this.sharedStorage = bytes;
  }
  bindShared(binding) {
    if (typeof binding?.bytes !== 'function' || !(binding.bytes() instanceof Uint8Array))
      throw new TypeError('KCS scheduler shared binding requires a byte-view provider');
    this.sharedBinding = binding;
    this.sharedStorage = null;
  }
  constructor({
    load,
    native,
    diagnostic,
    shared = new Uint8Array(1024 * 1024),
    budget = 5000000,
  }) {
    this.load = load;
    this.dispatch = native;
    this.diagnostic = diagnostic;
    this.shared = shared;
    this.budget = budget;
    this.programs = new Map();
    this.tasks = new Map();
    this.events = [];
    this.frame = 0;
    this.nextID = 1;
    this.nextEvent = 1;
    this.running = false;
  }
  async spawn(name, options) {
    if (!this.programs.has(name)) this.programs.set(name, await this.load(name));
    return this.add(this.programs.get(name), { ...options, name });
  }
  add(
    program,
    { name = program.name, abi, context = {}, parent = null, priority = 0, id = this.nextID } = {},
  ) {
    if (!name || !abi) throw new Error('KCS tasks require an explicit program name and native ABI');
    if (parent !== null && !this.tasks.has(parent))
      throw new Error(`KCS missing parent task ${parent}`);
    if (!Number.isSafeInteger(id) || id < 0 || this.tasks.has(id))
      throw new Error(`Invalid or duplicate KCS task ID ${id}`);
    this.nextID = Math.max(this.nextID, id + 1);
    const task = {
      id,
      name,
      abi,
      context: structuredClone(context),
      parent,
      priority,
      createdFrame: this.frame,
      finishedFrame: null,
      status: 'ready',
      io: null,
      error: null,
      messages: [],
    };
    task.machine = new KCSMachine(
      program,
      {
        native: (nativeID, args, machine) => this.native(task, nativeID, args, machine),
        diagnostic: (detail) => this.diagnostic?.(detail, task),
      },
      this.shared,
    );
    task.defaultSharedBinding = { bytes: () => this.shared };
    task.machine.bindShared(task.defaultSharedBinding);
    this.programs.set(name, program);
    this.tasks.set(id, task);
    return task;
  }
  native(task, id, args, machine) {
    if (task.io) {
      if (task.io.pc !== machine.pc || task.io.native !== id)
        throw new Error(`KCS task ${task.id} resumed at a different I/O call`);
      if (!task.io.ready) throw new Error('KCS I/O resumed before completion');
      const { error, reply } = task.io;
      task.io = null;
      if (error) throw error;
      return reply;
    }
    const reply = this.dispatch(task.abi, id, args, machine, task, this);
    if (!reply || typeof reply.then !== 'function') return reply;
    const io = {
      pc: machine.pc,
      native: id,
      ready: false,
      reply: null,
      error: null,
      promise: null,
    };
    io.promise = Promise.resolve(reply).then(
      (value) => {
        io.reply = value;
        io.ready = true;
      },
      (error) => {
        io.error = error;
        io.ready = true;
      },
    );
    task.io = io;
    return nativeReply(5, undefined, { kind: 'io' });
  }
  emit(type, value, target = null) {
    const event = {
      sequence: this.nextEvent++,
      type,
      value: structuredClone(value),
      target,
      frame: this.frame,
    };
    this.events.push(event);
    return event.sequence;
  }
  ready(task) {
    const wait = task.machine.waiting;
    if (!wait) return true;
    if (wait.kind === 'io') return true;
    if (wait.kind === 'message') return true;
    if (wait.kind === 'frames') return this.frame >= wait.until;
    if (wait.kind === 'task') {
      const child = this.tasks.get(wait.task);
      if (!child) throw new Error(`KCS wait references absent task ${wait.task}`);
      if (child.status === 'failed')
        throw new Error(`KCS child ${child.id} failed: ${child.error}`);
      return child.status === 'finished' || child.status === 'cancelled';
    }
    if (wait.kind === 'event') {
      const index = this.events.findIndex(
        (event) =>
          event.type === wait.type &&
          (event.target === null || event.target === task.id) &&
          event.sequence > (wait.after || 0),
      );
      if (index < 0) return false;
      task.context.event = this.events.splice(index, 1)[0];
      return true;
    }
    throw new Error(`KCS unknown wait kind ${wait.kind}`);
  }
  cancel(id, descendants = true) {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`KCS missing task ${id}`);
    if (descendants)
      for (const child of this.tasks.values()) if (child.parent === id) this.cancel(child.id, true);
    task.status = 'cancelled';
    task.finishedFrame = this.frame;
    task.machine.halted = true;
    task.machine.waiting = null;
  }
  post(id, words) {
    const task = this.tasks.get(id);
    if (!task || ['finished', 'cancelled', 'failed'].includes(task.status)) return false;
    if (
      !Array.isArray(words) ||
      words.length !== 4 ||
      words.some((word) => !Number.isInteger(word))
    )
      throw new Error('KCS task messages require four integer words');
    task.messages.push(words.map((word) => word >>> 0));
    return true;
  }
  async execute(task, budget = this.budget) {
    let used = 0;
    for (;;) {
      if (task.status === 'cancelled') return { status: 'cancelled', executed: used };
      if (task.io?.promise) await task.io.promise;
      if (task.status === 'cancelled') return { status: 'cancelled', executed: used };
      const result = task.machine.run({ budget: budget - used });
      used += result.executed;
      if (task.status === 'cancelled') return { status: 'cancelled', executed: used };
      if (task.machine.waiting?.kind === 'io') {
        await task.io.promise;
        task.machine.resume();
        continue;
      }
      task.status = result.status === 'halted' ? 'finished' : result.status;
      if (task.status === 'finished') task.finishedFrame = this.frame;
      return { ...result, executed: used };
    }
  }
  async send(id, words) {
    const task = this.tasks.get(id);
    if (!task || ['finished', 'cancelled', 'failed'].includes(task.status))
      return { accepted: false, result: 0 };
    const address = task.machine.waiting?.address;
    if (!task.machine.receiveMessage(words)) return { accepted: false, result: 0 };
    const state = await this.execute(task);
    return {
      accepted: true,
      result: Number(state.status !== 'halted'),
      message: Array.from({ length: 4 }, (_, i) => task.machine.load(address + i * 4)),
    };
  }
  async tick() {
    if (this.running) throw new Error('KCS scheduler tick must be serialized');
    this.running = true;
    this.frame++;
    const runnable = [...this.tasks.values()].sort(
      (a, b) => b.priority - a.priority || a.id - b.id,
    );
    let active = null;
    try {
      for (const task of runnable) {
        active = task;
        if (!['ready', 'waiting', 'yielded'].includes(task.status) || !this.ready(task)) continue;
        let used = 0;
        // Native kcTaskScript drains its queued messages before the frame's
        // normal idle execution. An unarmed recipient ignores the message.
        let cursor = 0;
        while (cursor < task.messages.length) {
          const message = task.messages[cursor++];
          if (!task.machine.receiveMessage(message)) continue;
          used += (await this.execute(task, this.budget - used)).executed;
        }
        task.messages.length = 0;
        if (['finished', 'cancelled', 'failed'].includes(task.status)) continue;
        task.machine.idle();
        await this.execute(task, this.budget - used);
      }
    } catch (error) {
      if (active) {
        active.status = 'failed';
        active.error = error.message;
      }
      throw error;
    } finally {
      this.running = false;
    }
  }
  snapshot() {
    if (this.running || [...this.tasks.values()].some((task) => task.io && !task.io.ready))
      throw new Error('KCS checkpoint requires settled, serialized I/O');
    return {
      frame: this.frame,
      nextID: this.nextID,
      nextEvent: this.nextEvent,
      shared: this.shared.slice(),
      events: structuredClone(this.events),
      tasks: [...this.tasks.values()].map((task) => ({
        id: task.id,
        name: task.name,
        abi: task.abi,
        context: structuredClone(task.context),
        parent: task.parent,
        priority: task.priority,
        status: task.status,
        createdFrame: task.createdFrame,
        finishedFrame: task.finishedFrame,
        error: task.error,
        messages: structuredClone(task.messages),
        io: task.io
          ? {
              pc: task.io.pc,
              native: task.io.native,
              ready: true,
              reply: structuredClone(task.io.reply),
              error: task.io.error ? task.io.error.message : null,
            }
          : null,
        machine: task.machine.snapshot(),
      })),
    };
  }
  async restore(state) {
    if (this.running) throw new Error('Cannot restore a running KCS scheduler');
    const next = new KCSScheduler({
      load: this.load,
      native: this.dispatch,
      diagnostic: this.diagnostic,
      shared: state.shared.slice(),
      budget: this.budget,
    });
    next.programs = new Map(this.programs);
    const ids = new Set();
    for (const saved of state.tasks) {
      if (!Number.isSafeInteger(saved.id) || saved.id < 0 || ids.has(saved.id))
        throw new Error('Invalid KCS checkpoint task ID');
      ids.add(saved.id);
      next.nextID = saved.id;
      const task = await next.spawn(saved.name, {
        abi: saved.abi,
        context: saved.context,
        priority: saved.priority,
      });
      task.machine.restore(saved.machine);
      Object.assign(task, saved, {
        machine: task.machine,
        context: structuredClone(saved.context),
      });
      task.messages = structuredClone(saved.messages);
      if (task.io?.error) task.io.error = new Error(task.io.error);
    }
    for (const task of next.tasks.values())
      if (task.parent !== null && !next.tasks.has(task.parent))
        throw new Error('KCS checkpoint parent is absent');
    next.frame = state.frame;
    next.nextID = state.nextID;
    next.nextEvent = state.nextEvent;
    next.events = structuredClone(state.events);
    for (const key of ['shared', 'programs', 'tasks', 'frame', 'nextID', 'nextEvent', 'events'])
      this[key] = next[key];
    // Rebind the dispatch closures after atomically publishing the new state.
    for (const task of this.tasks.values()) {
      if (task.machine.sharedBinding === task.defaultSharedBinding) {
        task.defaultSharedBinding = { bytes: () => this.shared };
        task.machine.bindShared(task.defaultSharedBinding);
      }
      task.machine.host = {
        native: (id, args, machine) => this.native(task, id, args, machine),
        diagnostic: (detail) => this.diagnostic?.(detail, task),
      };
    }
  }
}
