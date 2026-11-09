// SPDX-License-Identifier: MPL-2.0
// The guest creates and destroys its CThread objects. At the CRT boundary the
// browser schedules the reviewed callbacks on the shared engine process.
const FIRST_HANDLE = 0x56000000;
const STILL_ACTIVE = 259;
const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    begin: 0x7a00aa,
    trampoline: 0x5db760,
    lockInserted: 0x5db414,
    streamWait: 0x705bfa,
    entries: {
      0x747d40: { kind: 'image' },
      0x705d50: { kind: 'stream', check: 0x705df1, end: 0x705dfe, stop: 368, stopped: 1 },
      0x6fca90: {
        kind: 'completion',
        check: 0x6fcb54,
        end: 0x6fcb61,
        stop: 372,
        stopped: 0,
        poll: { resume: 0x6fca96, query: 0x6fcb17, again: 0x6fcb3c },
      },
    },
  },
  'sdk-4.01-engine-2.6.1.74': {
    begin: 0x638b70,
    trampoline: 0x4b7c20,
    lockInserted: 0x4b78d4,
    streamWait: 0x5bda3a,
    entries: {
      0x5bdb90: { kind: 'stream', check: 0x5bdc31, end: 0x5bdc3e, stop: 368, stopped: 1 },
      0x5bafc0: {
        kind: 'completion',
        check: 0x5bb084,
        end: 0x5bb091,
        stop: 372,
        stopped: 0,
        poll: { resume: 0x5bafc6, query: 0x5bb047, again: 0x5bb06c },
      },
    },
  },
};

class NativeEngineWorkers {
  constructor(engine) {
    this.engine = engine;
    this.process = engine.process;
    this.abi = ABI[engine.profile];
    if (!this.abi) throw new Error('Native worker callbacks require a reviewed engine');
    this.threads = new Map();
    this.nextHandle = FIRST_HANDLE;
    this.running = null;
    const p = this.process;
    this.startTrap = p.trap('native CThread worker creation', 0, () => this.start());
    this.detachers = [
      p.beforeInstruction(this.abi.begin, 'native CThread worker selection', () => {
        const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
        if (p.load(sp + 12) !== this.abi.trampoline) return;
        const thread = p.load(sp + 16);
        if (thread && this.abi.entries[p.load(thread + 16)])
          p.cpu.reg_write_i32(p.uc.X86_REG_EIP, this.startTrap);
      }),
      p.beforeInstruction(this.abi.lockInserted, 'native CThread copied lock', () => {
        // The CThread map inserts a by-value copy of a temporary, unlocked
        // RTL_CRITICAL_SECTION. Transfer the platform identity to the node.
        const frame = p.cpu.reg_read_i32(p.uc.X86_REG_EBP) >>> 0,
          source = frame - 0x2c,
          result = frame - 0x14,
          locks = engine.kernel.locks;
        if (locks.get(source) !== 0)
          throw new Error('Native CThread did not copy an unlocked lock');
        locks.delete(source);
        if (p.load(result + 4) & 255) locks.set(p.load(result) + 20, 0);
      }),
    ];
    for (const [address, entry] of Object.entries(this.abi.entries)) {
      if (!entry.check) continue;
      this.detachers.push(
        p.beforeInstruction(entry.check, `native ${entry.kind} worker loop check`, () => {
          if (this.running?.entry !== Number(address) || this.stopped(this.running)) return;
          // The next iteration only reads the thread and its owner. Execute
          // the original epilogue here and reenter on the next host quantum.
          this.yielded = true;
          p.cpu.reg_write_i32(p.uc.X86_REG_EIP, entry.end);
        }),
      );
      if (entry.poll)
        this.detachers.push(
          p.beforeInstruction(entry.poll.again, 'native movie running-state poll', () => {
            const worker = this.running;
            if (worker?.entry !== Number(address)) return;
            // The only live local in the polling loop is the next
            // GetState output. Park at the original epilogue while running.
            worker.polling = true;
            this.yielded = true;
            p.cpu.reg_write_i32(p.uc.X86_REG_EIP, entry.end);
          }),
          p.beforeInstruction(entry.poll.resume, 'native movie running-state resume', () => {
            const worker = this.running;
            if (worker?.entry !== Number(address) || !worker.polling) return;
            // The original prologue has rebuilt ESP and the owner in ESI.
            // The pending GetState writes its scratch local before use.
            delete worker.polling;
            if (!this.stopped(worker)) p.cpu.reg_write_i32(p.uc.X86_REG_EIP, entry.poll.query);
          }),
        );
    }
    const kernel = engine.kernel,
      closeFile = kernel.overrides.get('kernel32.dll!CloseHandle'),
      register = (name, count, fn) => engine.registerWindows('KERNEL32.dll', name, { count, fn });
    register('Sleep', 1, ([duration]) => this.sleep(duration));
    register('GetExitCodeThread', 2, ([handle, out]) => this.exitCode(handle, out));
    register('CloseHandle', 1, ([handle]) => {
      const worker = this.threads.get(handle);
      if (!worker) return closeFile.fn([handle]);
      if (!worker.open) {
        kernel.lastError = 6;
        return 0;
      }
      worker.open = false;
      if (worker.completed) this.threads.delete(handle);
      return 1;
    });
    engine.registerFeature('engine-workers', this);
  }
  async start() {
    const p = this.process,
      sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0,
      args = Array.from({ length: 6 }, (_, i) => p.load(sp + 4 + i * 4)),
      [security, stackSize, trampoline, thread, flags, out] = args,
      entry = p.load(thread + 16),
      layout = this.abi.entries[entry];
    if (security || stackSize || flags || trampoline !== this.abi.trampoline || !layout)
      throw new Error('Unsupported native CThread creation arguments');
    if (this.nextHandle >= FIRST_HANDLE + 0x1000000)
      throw new Error('Native CThread handle range exhausted');
    const handle = this.nextHandle++,
      worker = {
        handle,
        thread,
        entry,
        kind: layout.kind,
        owner: p.load(thread + 20),
        task: this.engine.currentTaskID,
        completed: false,
        open: true,
      };
    this.threads.set(handle, worker);
    if (out) p.store(out, handle - FIRST_HANDLE + 2);
    try {
      if (layout.kind === 'image') await this.step(handle);
      return handle;
    } catch (error) {
      this.threads.delete(handle);
      throw error;
    }
  }
  stopped(worker) {
    const layout = this.abi.entries[worker.entry];
    return Boolean(this.process.load(worker.owner + layout.stop)) === Boolean(layout.stopped);
  }
  sleep(duration) {
    const p = this.process,
      sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
    if (p.load(sp) === this.abi.streamWait) {
      // The consumer has released the ring lock before sleeping. Give its
      // original producer one iteration so the read can continue.
      const stream = p.cpu.reg_read_i32(p.uc.X86_REG_EDI) >>> 0,
        handle = p.load(p.load(stream + 380));
      return this.step(handle);
    }
    if (duration && this.running?.kind !== 'stream')
      return new Promise((resolve) => setTimeout(resolve, duration));
  }
  async exitCode(handle, out) {
    const worker = this.threads.get(handle);
    if (!worker?.open) {
      this.engine.kernel.lastError = 6;
      return 0;
    }
    if (
      !worker.completed &&
      this.running !== worker &&
      worker.kind !== 'image' &&
      this.stopped(worker)
    )
      await this.step(handle);
    this.process.store(out, worker.completed ? 0 : STILL_ACTIVE);
    return 1;
  }
  async step(handle) {
    const worker = this.threads.get(handle);
    if (!worker) throw new Error('Native worker handle is absent');
    if (worker.completed) return false;
    if (this.running) throw new Error('Native worker callbacks cannot overlap');
    this.running = worker;
    this.yielded = false;
    try {
      const method = this.process.asyncEnabled ? 'callFromHost' : 'call';
      await this.engine[method](worker.entry, [worker.thread, worker.owner], undefined, {
        task: worker.task,
      });
      worker.completed = !this.yielded;
      if (worker.completed && !worker.open) this.threads.delete(handle);
      return !worker.completed;
    } finally {
      this.running = null;
    }
  }
  snapshot() {
    if (this.running) throw new Error('Cannot checkpoint an executing native worker');
    return structuredClone({
      threads: [...this.threads],
      nextHandle: this.nextHandle,
      startTrap: this.startTrap,
    });
  }
  restore(state) {
    const p = this.process,
      threads = new Map(state.threads);
    if (
      threads.size !== state.threads.length ||
      !Number.isInteger(state.nextHandle) ||
      state.nextHandle < FIRST_HANDLE ||
      state.nextHandle > FIRST_HANDLE + 0x1000000 ||
      p.traps.get(state.startTrap)?.name !== 'native CThread worker creation'
    )
      throw new Error('Native CThread checkpoint has invalid identities');
    for (const [handle, worker] of threads) {
      if (
        !Number.isInteger(handle) ||
        handle < FIRST_HANDLE ||
        handle >= state.nextHandle ||
        worker.handle !== handle ||
        this.abi.entries[worker.entry]?.kind !== worker.kind ||
        typeof worker.completed !== 'boolean' ||
        typeof worker.open !== 'boolean' ||
        (worker.polling && (worker.completed || !this.abi.entries[worker.entry].poll)) ||
        (!worker.completed &&
          (!p.allocations.has(worker.thread) ||
            p.load(worker.thread) !== handle ||
            p.load(worker.thread + 16) !== worker.entry ||
            p.load(worker.thread + 20) !== worker.owner))
      )
        throw new Error('Native CThread checkpoint has an invalid worker');
    }
    this.threads = threads;
    this.nextHandle = state.nextHandle;
    this.startTrap = state.startTrap;
  }
  close() {
    for (const detach of this.detachers) detach();
    this.threads.clear();
  }
}

export function installNativeEngineWorkers(engine) {
  return engine.features.get('engine-workers') ?? new NativeEngineWorkers(engine);
}
