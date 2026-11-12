// SPDX-License-Identifier: MPL-2.0
import { LogicalCRTThreads } from './crt-threads.mjs';
import { EffekseerResources } from './resources.mjs';
import { EffekseerEffectLoads } from './effect-loads.mjs';

export const EFFEKSEER_FRAME_EXECUTOR = 'frame';

// W1 owns only a pure-JS CRT gateway. Resources, kind61 factories, device
// lifecycle, task managers and the mixed native PTD view are separate steps.
export class EffekseerWorld {
  #threads = new LogicalCRTThreads();
  #dispatch;
  #hasNativeProcess;
  #closed = false;
  #resourceServices;
  #resources = null;
  #loads = null;
  #tasks = new Set();
  constructor({ dispatch, hasNativeProcess = () => false, resourceServices } = {}) {
    if (!dispatch || typeof hasNativeProcess !== 'function')
      throw new TypeError('Effekseer World requires explicit dispatch and native-process gate');
    this.#dispatch = dispatch;
    this.#hasNativeProcess = hasNativeProcess;
    this.#resourceServices = resourceServices;
    // Exactly one logical frame-thread birth per fresh World. This says
    // nothing about a title's first Play or native initial PTD ownership.
    this.createExecutor(EFFEKSEER_FRAME_EXECUTOR);
  }
  get threads() {
    return this.#threads;
  }
  get frameExecutor() {
    return this.#dispatch.executor(EFFEKSEER_FRAME_EXECUTOR);
  }
  get loads() {
    this.#open();
    if (!this.#loads) {
      if (typeof this.#resourceServices !== 'function')
        throw new Error('Effekseer World mounted resource services are unavailable');
      this.#resources = new EffekseerResources(this.#resourceServices());
      this.#loads = new EffekseerEffectLoads({ resources: this.#resources });
    }
    return this.#loads;
  }
  registerTask(task) {
    this.#open();
    if (this.#tasks.has(task)) throw new Error('Effekseer task already registered');
    this.#tasks.add(task);
  }
  releaseTask(task) {
    this.#tasks.delete(task);
  }
  validateReferences() {
    const expected = new Map();
    for (const task of this.#tasks)
      for (const id of task.references()) expected.set(id, (expected.get(id) ?? 0) + 1);
    if (expected.size !== (this.#loads?.loads.size ?? 0))
      throw new Error('Effekseer World has unowned logical loads');
    for (const [id, count] of expected)
      if (this.#loads.get(id).references !== count)
        throw new Error('Effekseer task/load reference counts differ');
  }
  #open() {
    if (this.#closed) throw new Error('Effekseer World is closed');
  }
  #pure() {
    this.#open();
    if (this.#hasNativeProcess())
      throw new Error(
        'Mixed native CRT executor binding is unimplemented; no separate JS sampling',
      );
  }
  createExecutor(id) {
    this.#pure();
    // The dispatch identity is a view of this registry's IDs, never a seed
    // cache or a guess based on message sender/task/frame/initial PTD.
    const executor = this.#dispatch.register(id);
    this.#threads.create(id);
    return executor;
  }
  executor(id) {
    this.#open();
    return this.#dispatch.executor(id);
  }
  #thread(entry) {
    this.#pure();
    const id = this.#dispatch.executorID(entry);
    this.#threads.forThread(id); // Validate before invoking any manager callback.
    return id;
  }
  #manager(entry, manager, method) {
    const id = this.#thread(entry);
    if (manager?.threads !== this.#threads || typeof manager[method] !== 'function')
      throw new Error('Effekseer manager must borrow this World CRT registry');
    return id;
  }
  play(entry, manager, assetID, position) {
    const id = this.#manager(entry, manager, 'play');
    return manager.play(assetID, position, id);
  }
  update(entry, manager, delta = 1) {
    const id = this.#manager(entry, manager, 'update');
    return manager.update(id, delta);
  }
  nextInt(entry) {
    return this.#threads.forThread(this.#thread(entry)).nextInt();
  }
  seed(entry, value) {
    return this.#threads.forThread(this.#thread(entry)).seed(value);
  }
  assertSettled() {
    this.#open();
    this.#dispatch.assertSettled();
    if (this.#loads?.pending || [...this.#tasks].some((task) => task.pending))
      throw new Error('Effekseer World requires settled resource operations');
  }
  snapshot() {
    this.assertSettled();
    // Executor capabilities, entries, stacks and Promises are transient.
    // Thread IDs and advancing words live only in this existing CRT state.
    this.validateReferences();
    return {
      crt: this.#threads.snapshot(),
      resources: this.#resources?.snapshot() ?? null,
      loads: this.#loads?.snapshot() ?? null,
    };
  }
  async restore(saved) {
    this.#open();
    this.#dispatch.assertSettled();
    const initial = this.#threads.snapshot().threads;
    if (
      initial.length !== 1 ||
      initial[0].id !== EFFEKSEER_FRAME_EXECUTOR ||
      initial[0].state !== 1 ||
      initial[0].calls !== 0 ||
      initial[0].seedCalls !== 0
    )
      throw new Error('Effekseer CRT restore requires a fresh World owner');
    const next = new LogicalCRTThreads();
    next.restore(saved?.crt);
    next.forThread(EFFEKSEER_FRAME_EXECUTOR);
    this.#dispatch.replaceExecutors([...next.threads.keys()]);
    this.#threads.close();
    this.#threads = next;
    if (!saved || (saved.resources === null) !== (saved.loads === null))
      throw new Error('Effekseer checkpoint source/load owners differ');
    if (saved.resources !== null) {
      const loads = this.loads;
      await this.#resources.restore(saved.resources);
      loads.restore(saved.loads);
    }
  }
  close() {
    if (this.#closed) return;
    this.assertSettled();
    if (this.#tasks.size) throw new Error('Effekseer tasks must close before their World');
    const errors = [];
    for (const owner of [this.#loads, this.#resources])
      try {
        owner?.close();
      } catch (error) {
        errors.push(error);
      }
    this.#threads.close();
    this.#closed = true;
    if (errors.length) throw new AggregateError(errors, 'Effekseer World cleanup failed');
  }
}
