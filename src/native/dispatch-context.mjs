// SPDX-License-Identifier: MPL-2.0
// Explicit execution capabilities. There is deliberately no ambient current
// executor, asynchronous stack emulation, scheduling queue or thread runner.
const executorID = (id) => {
  if (typeof id !== 'string' || !id || id.includes('\0'))
    throw new TypeError('An explicit logical executor ID is required');
  return id;
};
export class NativeDispatchContext {
  #executors = new Map();
  #handles = new WeakMap();
  #entries = new WeakMap();
  #active = 0;
  #closed = false;
  #open() {
    if (this.#closed) throw new Error('Native dispatch context is closed');
  }
  register(id) {
    this.#open();
    executorID(id);
    if (this.#executors.has(id)) throw new Error('Logical executor already exists: ' + id);
    const handle = Object.freeze(Object.create(null));
    this.#executors.set(id, handle);
    this.#handles.set(handle, id);
    return handle;
  }
  executor(id) {
    this.#open();
    executorID(id);
    const handle = this.#executors.get(id);
    if (!handle) throw new Error('Unknown logical executor: ' + id);
    return handle;
  }
  executorID(entry) {
    this.#open();
    const state = entry && this.#entries.get(entry);
    if (!state?.active || this.#executors.get(state.id) !== state.executor)
      throw new Error('A live explicit executor entry is required');
    return state.id;
  }
  run(executor, operation) {
    this.#open();
    const id = executor && this.#handles.get(executor);
    if (!id || this.#executors.get(id) !== executor)
      throw new Error('Unknown logical executor capability');
    if (typeof operation !== 'function')
      throw new TypeError('Executor entry operation is required');
    const entry = Object.freeze(Object.create(null)),
      state = { id, executor, active: true };
    this.#entries.set(entry, state);
    this.#active++;
    const leave = () => {
      if (state.active) {
        state.active = false;
        this.#active--;
      }
    };
    try {
      const result = operation(entry);
      if (result && typeof result.then === 'function')
        return Promise.resolve(result).finally(leave);
      leave();
      return result;
    } catch (error) {
      leave();
      throw error;
    }
  }
  reenter(entry, operation) {
    const id = this.executorID(entry);
    return this.run(this.executor(id), operation);
  }
  assertSettled() {
    this.#open();
    if (this.#active)
      throw new Error('Executor entries must settle before checkpoint/restore/close');
  }
  replaceExecutors(ids) {
    this.assertSettled();
    if (!Array.isArray(ids)) throw new TypeError('Logical executor IDs are required');
    const seen = new Set();
    for (const id of ids) {
      executorID(id);
      if (seen.has(id)) throw new Error('Duplicate logical executor: ' + id);
      seen.add(id);
    }
    this.#executors = new Map();
    this.#handles = new WeakMap();
    this.#entries = new WeakMap();
    for (const id of ids) this.register(id);
  }
  close() {
    this.assertSettled();
    this.#executors.clear();
    this.#handles = new WeakMap();
    this.#entries = new WeakMap();
    this.#closed = true;
  }
}
