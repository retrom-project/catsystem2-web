// SPDX-License-Identifier: MPL-2.0
const entryPoints = {
  model: new URL('../emote/psz-worker.mjs', import.meta.url),
  image: new URL('./hg3-prepare-worker.mjs', import.meta.url),
};

function exchange(worker, data, transfer, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = (complete, value) => {
      signal.removeEventListener('abort', abort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      complete(value);
    };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => finish(resolve, data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish(reject, new Error('Scene preparation worker stopped'));
    };
    worker.onmessageerror = () => finish(reject, new Error('Scene worker reply could not be read'));
    try {
      worker.postMessage(data, transfer);
    } catch (error) {
      finish(reject, error);
    }
  });
}

class SceneWorker {
  #worker;
  #stopped = new AbortController();
  #lease = null;
  #sending = false;

  constructor(kind) {
    this.#worker = new Worker(entryPoints[kind], { type: 'module' });
  }
  get enabled() {
    return !this.#stopped.signal.aborted;
  }
  async send(data, transfer, signal) {
    if (this.#sending) throw new Error('A scene preparation worker request is already active');
    this.#sending = true;
    const stopped = this.#stopped.signal;
    try {
      return await exchange(
        this.#worker,
        data,
        transfer,
        signal ? AbortSignal.any([signal, stopped]) : stopped,
      );
    } catch (error) {
      // A failed or canceled request cannot return a late message to another lease.
      this.close();
      throw error;
    } finally {
      this.#sending = false;
    }
  }
  acquire(retain) {
    if (!this.enabled || this.#lease || this.#sending) return null;
    const lease = {
      send: (data, transfer, signal) => {
        if (this.#lease !== lease) throw new Error('Scene preparation worker was released');
        return this.send(data, transfer, signal);
      },
      release: () => {
        if (this.#lease !== lease) return;
        this.#lease = null;
        if (!retain || this.#sending) this.close();
      },
    };
    this.#lease = lease;
    return lease;
  }
  close() {
    if (!this.enabled) return;
    this.#stopped.abort();
    this.#worker.terminate();
  }
}

class PreparedSceneWorkers {
  #workers = new Map();
  #signal;
  #abort = () => this.close();

  constructor(signal) {
    this.#signal = signal;
    signal?.addEventListener('abort', this.#abort, { once: true });
  }
  async prepare() {
    if (typeof Worker !== 'function') return;
    const timeout = AbortSignal.timeout?.(5000);
    await Promise.all(
      Object.keys(entryPoints).map(async (kind) => {
        try {
          const worker = new SceneWorker(kind);
          this.#workers.set(kind, worker);
          if ((await worker.send('ready', [], timeout)) !== 'ready') worker.close();
        } catch {
          // Without this worker, the scene uses its ordinary resource decoder.
        }
      }),
    );
  }
  enabled(kind) {
    return this.#workers.get(kind)?.enabled ?? false;
  }
  acquire(kind) {
    return this.#workers.get(kind)?.acquire(true) ?? null;
  }
  close() {
    this.#signal?.removeEventListener('abort', this.#abort);
    for (const worker of this.#workers.values()) worker.close();
    this.#workers.clear();
  }
}

export async function prepareSceneWorkerPool(signal) {
  signal?.throwIfAborted();
  const workers = new PreparedSceneWorkers(signal);
  try {
    await workers.prepare();
    signal?.throwIfAborted();
    return workers;
  } catch (error) {
    workers.close();
    throw error;
  }
}

export function canPrepareSceneWorker(world, kind) {
  return (
    world.sceneWorkers?.enabled(kind) ??
    (world.prepareSceneWorkers !== false && typeof Worker === 'function')
  );
}

export function acquireSceneWorker(world, kind) {
  if (world.sceneWorkers) return world.sceneWorkers.acquire(kind);
  return canPrepareSceneWorker(world, kind) ? new SceneWorker(kind).acquire(false) : null;
}
