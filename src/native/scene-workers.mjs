// SPDX-License-Identifier: MPL-2.0
const entryPoints = Object.freeze({
  model: new URL('../emote/psz-worker.mjs', import.meta.url),
  image: new URL('./hg3-prepare-worker.mjs', import.meta.url),
});
const modelEntryPoint = entryPoints.model.href;
const apply = Reflect.apply,
  descriptor = Object.getOwnPropertyDescriptor,
  prototypeOf = Object.getPrototypeOf,
  objectPrototype = Object.prototype,
  functionText = Function.prototype.toString,
  WorkerType = descriptor(globalThis, 'Worker')?.value,
  workerPrototype = WorkerType?.prototype,
  workerParent = workerPrototype && prototypeOf(workerPrototype),
  MessageType = descriptor(globalThis, 'MessageEvent')?.value,
  messageData = MessageType && descriptor(MessageType.prototype, 'data')?.get,
  mapPrototype = Map.prototype,
  PrivateMap = Map,
  mapGet = Map.prototype.get,
  mapSet = Map.prototype.set,
  mapValues = Map.prototype.values,
  mapClear = Map.prototype.clear,
  mapNext = Object.getPrototypeOf(new Map().values()).next,
  weakGet = WeakMap.prototype.get,
  weakSet = WeakMap.prototype.set,
  Controller = AbortController,
  controllerSignal = descriptor(AbortController.prototype, 'signal').get,
  controllerAbort = AbortController.prototype.abort,
  signalAborted = descriptor(AbortSignal.prototype, 'aborted').get,
  signalReason = descriptor(AbortSignal.prototype, 'reason').get,
  signalThrow = AbortSignal.prototype.throwIfAborted,
  signalAny = AbortSignal.any,
  addListener = EventTarget.prototype.addEventListener,
  removeListener = EventTarget.prototype.removeEventListener,
  preventDefault = Event.prototype.preventDefault,
  ChannelPromise = Promise,
  workerPortNames = [
    'constructor',
    'postMessage',
    'terminate',
    'onmessage',
    'onerror',
    'onmessageerror',
  ],
  workerPorts = Object.fromEntries(
    workerPortNames.map((key) => [key, workerPrototype && descriptor(workerPrototype, key)]),
  ),
  poolBrands = new WeakMap(),
  leaseBrands = new WeakMap();

const nativeFunction = (value) =>
  typeof value === 'function' && /\{\s*\[native code\]\s*\}/.test(apply(functionText, value, []));
const nativeWorkerPorts =
  nativeFunction(WorkerType) &&
  workerPorts.constructor?.value === WorkerType &&
  nativeFunction(workerPorts.postMessage?.value) &&
  nativeFunction(workerPorts.terminate?.value) &&
  nativeFunction(messageData) &&
  ['onmessage', 'onerror', 'onmessageerror'].every(
    (key) => nativeFunction(workerPorts[key]?.get) && nativeFunction(workerPorts[key]?.set),
  );
function workerPortsCurrent(worker) {
  if (
    !nativeWorkerPorts ||
    descriptor(globalThis, 'Worker')?.value !== WorkerType ||
    descriptor(WorkerType, 'prototype')?.value !== workerPrototype ||
    descriptor(globalThis, 'MessageEvent')?.value !== MessageType ||
    descriptor(MessageType.prototype, 'data')?.get !== messageData ||
    prototypeOf(workerPrototype) !== workerParent
  )
    return false;
  for (let at = 0; at < workerPortNames.length; at++) {
    const key = workerPortNames[at],
      original = workerPorts[key];
    const current = descriptor(workerPrototype, key);
    if (
      !original ||
      current?.value !== original.value ||
      current?.get !== original.get ||
      current?.set !== original.set ||
      (worker && descriptor(worker, key))
    )
      return false;
  }
  return !worker || prototypeOf(worker) === workerPrototype;
}

function leaseFieldsCurrent(lease, held) {
  return (
    !!held &&
    prototypeOf(lease) === objectPrototype &&
    descriptor(lease, 'send')?.value === held.send &&
    descriptor(lease, 'release')?.value === held.release
  );
}

const leaseCurrent = (lease, held) => leaseFieldsCurrent(lease, held) && held.current();

function exchange(worker, data, transfer, signal, channel) {
  if (channel) apply(signalThrow, signal, []);
  else signal.throwIfAborted();
  const Completion = channel ? ChannelPromise : Promise;
  return new Completion((resolve, reject) => {
    let settled = false;
    const finish = (complete, value) => {
      if (settled) return;
      settled = true;
      if (channel) apply(removeListener, signal, ['abort', abort]);
      else signal.removeEventListener('abort', abort);
      if (channel) {
        for (let at = 3; at < workerPortNames.length; at++) channel.set(workerPortNames[at], null);
      } else worker.onmessage = worker.onerror = worker.onmessageerror = null;
      complete(value);
    };
    const abort = () => finish(reject, channel ? apply(signalReason, signal, []) : signal.reason);
    if (channel) apply(addListener, signal, ['abort', abort, { once: true }]);
    else signal.addEventListener('abort', abort, { once: true });
    const onmessage = (event) => {
      if (channel && !channel.current()) {
        channel.stop();
        finish(resolve, null);
        return;
      }
      try {
        finish(resolve, channel ? apply(messageData, event, []) : event.data);
      } catch (error) {
        finish(reject, error);
      }
    };
    const onerror = (event) => {
      if (channel) apply(preventDefault, event, []);
      else event.preventDefault();
      finish(reject, new Error('Scene preparation worker stopped'));
    };
    const onmessageerror = () => finish(reject, new Error('Scene worker reply could not be read'));
    try {
      if (channel) {
        channel.set('onmessage', onmessage);
        channel.set('onerror', onerror);
        channel.set('onmessageerror', onmessageerror);
      } else {
        worker.onmessage = onmessage;
        worker.onerror = onerror;
        worker.onmessageerror = onmessageerror;
      }
      if (channel) {
        if (!channel.current()) {
          channel.stop();
          finish(resolve, null);
        } else apply(workerPorts.postMessage.value, worker, [data, transfer]);
      } else worker.postMessage(data, transfer);
    } catch (error) {
      finish(reject, error);
    }
  });
}

class SceneWorker {
  #worker;
  #stopped = new Controller();
  #lease = null;
  #sending = false;
  #owned;
  #nativeChannel;

  constructor(kind, requireOwned = false) {
    const ownedModel = kind === 'model' && workerPortsCurrent();
    this.#nativeChannel = ownedModel;
    if (requireOwned && !ownedModel) throw new Error('Scene worker channel was replaced');
    this.#worker = ownedModel
      ? new WorkerType(modelEntryPoint, { type: 'module' })
      : new Worker(entryPoints[kind], { type: 'module' });
    this.#owned = ownedModel && workerPortsCurrent(this.#worker);
  }
  get enabled() {
    return !apply(signalAborted, apply(controllerSignal, this.#stopped, []), []);
  }
  owned() {
    return this.#owned && this.enabled && workerPortsCurrent(this.#worker);
  }
  async send(data, transfer, signal) {
    if (this.#sending) throw new Error('A scene preparation worker request is already active');
    this.#sending = true;
    const stopped = apply(controllerSignal, this.#stopped, []);
    try {
      return await exchange(
        this.#worker,
        data,
        transfer,
        signal ? apply(signalAny, AbortSignal, [[signal, stopped]]) : stopped,
        this.#owned
          ? {
              current: () =>
                this.enabled &&
                workerPortsCurrent(this.#worker) &&
                (!this.#lease ||
                  leaseFieldsCurrent(this.#lease, apply(weakGet, leaseBrands, [this.#lease]))),
              stop: () => this.close(),
              set: (key, value) => apply(workerPorts[key].set, this.#worker, [value]),
            }
          : null,
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
    apply(weakSet, leaseBrands, [
      lease,
      {
        native: this.#nativeChannel,
        send: lease.send,
        release: lease.release,
        current: () =>
          this.#owned && this.#lease === lease && this.enabled && workerPortsCurrent(this.#worker),
        stop: () => this.close(),
      },
    ]);
    return lease;
  }
  close() {
    if (!this.enabled) return;
    apply(controllerAbort, this.#stopped, []);
    if (this.#nativeChannel) apply(workerPorts.terminate.value, this.#worker, []);
    else this.#worker.terminate();
  }
}

class PreparedSceneWorkers {
  #workers = new PrivateMap();
  #signal;
  #abort = () => this.close();

  constructor(signal) {
    this.#signal = signal;
    apply(weakSet, poolBrands, [
      this,
      {
        enabled: poolMethods.enabled,
        acquire: poolMethods.acquire,
        close: poolMethods.close,
        ownedEnabled: (kind) => apply(mapGet, this.#workers, [kind])?.owned() ?? false,
        current: () => {
          try {
            apply(mapGet, this.#workers, [null]);
            return (
              prototypeOf(this.#workers) === mapPrototype &&
              !descriptor(this.#workers, 'get') &&
              descriptor(mapPrototype, 'get')?.value === mapGet
            );
          } catch {
            return false;
          }
        },
      },
    ]);
    signal?.addEventListener('abort', this.#abort, { once: true });
  }
  async prepare() {
    if (typeof Worker !== 'function') return;
    const timeout = AbortSignal.timeout?.(5000);
    await Promise.all(
      Object.keys(entryPoints).map(async (kind) => {
        try {
          const worker = new SceneWorker(kind);
          apply(mapSet, this.#workers, [kind, worker]);
          if ((await worker.send('ready', [], timeout)) !== 'ready') worker.close();
        } catch {
          // Without this worker, the scene uses its ordinary resource decoder.
        }
      }),
    );
  }
  enabled(kind) {
    return apply(mapGet, this.#workers, [kind])?.enabled ?? false;
  }
  acquire(kind) {
    return apply(mapGet, this.#workers, [kind])?.acquire(true) ?? null;
  }
  close() {
    this.#signal?.removeEventListener('abort', this.#abort);
    const iterator = apply(mapValues, this.#workers, []);
    for (;;) {
      const { done, value } = apply(mapNext, iterator, []);
      if (done) break;
      value.close();
    }
    apply(mapClear, this.#workers, []);
  }
}

const poolMethods = {
  enabled: PreparedSceneWorkers.prototype.enabled,
  acquire: PreparedSceneWorkers.prototype.acquire,
  close: PreparedSceneWorkers.prototype.close,
};

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

function ownedPool(world) {
  const source = descriptor(world, 'sceneWorkers');
  if (!source || !('value' in source)) return false;
  const pool = source.value;
  if (pool == null) return null;
  const held = apply(weakGet, poolBrands, [pool]);
  if (!held || prototypeOf(pool) !== PreparedSceneWorkers.prototype || !held.current())
    return false;
  const names = ['enabled', 'acquire', 'close'];
  for (let at = 0; at < names.length; at++) {
    const key = names[at];
    if (
      descriptor(pool, key) ||
      descriptor(PreparedSceneWorkers.prototype, key)?.value !== held[key]
    )
      return false;
  }
  return { pool, held };
}

export function canPrepareOwnedSceneWorker(world, kind) {
  if (!workerPortsCurrent()) return false;
  const source = ownedPool(world);
  if (source === false) return false;
  if (source) return source.held.ownedEnabled(kind);
  return descriptor(world, 'prepareSceneWorkers')?.value === true;
}

export function acquireOwnedSceneWorker(world, kind) {
  if (!canPrepareOwnedSceneWorker(world, kind)) return null;
  const source = ownedPool(world),
    lease = source
      ? apply(source.held.acquire, source.pool, [kind])
      : new SceneWorker(kind, true).acquire(false);
  return ownedSceneWorkerLease(lease);
}

export function ownedSceneWorkerLease(lease) {
  const held = lease && apply(weakGet, leaseBrands, [lease]);
  if (!held?.native) return null;
  if (!leaseCurrent(lease, held)) {
    held?.stop();
    if (held) apply(held.release, lease, []);
    return null;
  }
  let released = false;
  return {
    send(data, transfer, signal) {
      if (released) return null;
      if (!leaseCurrent(lease, held)) {
        held.stop();
        return null;
      }
      return apply(held.send, lease, [data, transfer, signal]);
    },
    release() {
      if (released) return;
      released = true;
      if (!leaseCurrent(lease, held)) held.stop();
      apply(held.release, lease, []);
    },
  };
}
