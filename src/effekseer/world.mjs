// SPDX-License-Identifier: MPL-2.0
import { LogicalCRTThreads } from './crt-threads.mjs';

export const EFFEKSEER_FRAME_EXECUTOR = 'frame';

// W1 owns only a pure-JS CRT gateway. Resources, kind61 factories, device
// lifecycle, task managers and the mixed native PTD view are separate steps.
export class EffekseerWorld {
  #threads = new LogicalCRTThreads();
  #dispatch;
  #hasNativeProcess;
  #closed = false;
  constructor({ dispatch, hasNativeProcess = () => false } = {}) {
    if (!dispatch || typeof hasNativeProcess !== 'function')
      throw new TypeError('Effekseer World requires explicit dispatch and native-process gate');
    this.#dispatch = dispatch;
    this.#hasNativeProcess = hasNativeProcess;
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
  snapshot() {
    this.#open();
    this.#dispatch.assertSettled();
    // Executor capabilities, entries, stacks and Promises are transient.
    // Thread IDs and advancing words live only in this existing CRT state.
    return { crt: this.#threads.snapshot() };
  }
  restore(saved) {
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
  }
  close() {
    if (this.#closed) return;
    this.#dispatch.assertSettled();
    this.#threads.close();
    this.#closed = true;
  }
}
