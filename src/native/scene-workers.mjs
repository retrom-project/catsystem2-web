// SPDX-License-Identifier: MPL-2.0
import { EMOTE_PREPARATION_LIMITS } from '../emote/document.mjs';

const entryPoints = Object.freeze({
  model: new URL('../emote/psz-worker.mjs', import.meta.url),
  image: new URL('./hg3-prepare-worker.mjs', import.meta.url),
});
const modelEntryPoint = entryPoints.model.href;
const apply = Reflect.apply,
  descriptor = Object.getOwnPropertyDescriptor,
  prototypeOf = Object.getPrototypeOf,
  create = Object.create,
  objectPrototype = Object.prototype,
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
  Bytes = Uint8Array,
  bytesPrototype = Bytes.prototype,
  typedPrototype = prototypeOf(bytesPrototype),
  byteLength = descriptor(typedPrototype, 'byteLength').get,
  byteOffset = descriptor(typedPrototype, 'byteOffset').get,
  byteBuffer = descriptor(typedPrototype, 'buffer').get,
  copyBytes = Bytes.prototype.set,
  bufferLength = descriptor(ArrayBuffer.prototype, 'byteLength').get,
  bufferResizable = descriptor(ArrayBuffer.prototype, 'resizable')?.get,
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

// These identities establish affiliation with this module's initial factory,
// not native implementation or ownership of anything that factory returns.
const initialWorkerPorts =
  typeof WorkerType === 'function' &&
  workerPorts.constructor?.value === WorkerType &&
  typeof workerPorts.postMessage?.value === 'function' &&
  typeof workerPorts.terminate?.value === 'function' &&
  typeof messageData === 'function' &&
  ['onmessage', 'onerror', 'onmessageerror'].every(
    (key) =>
      typeof workerPorts[key]?.get === 'function' && typeof workerPorts[key]?.set === 'function',
  );
function workerPortsCurrent(worker) {
  if (
    !initialWorkerPorts ||
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

function fullByteStorage(bytes) {
  try {
    if (
      descriptor(globalThis, 'Uint8Array')?.value !== Bytes ||
      prototypeOf(bytes) !== bytesPrototype
    )
      return null;
    const length = apply(byteLength, bytes, []),
      buffer = apply(byteBuffer, bytes, []);
    if (
      apply(byteOffset, bytes, []) !== 0 ||
      apply(bufferLength, buffer, []) !== length ||
      (bufferResizable && apply(bufferResizable, buffer, []))
    )
      return null;
    return { length, buffer };
  } catch {
    // Typed-array and ArrayBuffer brand checks reject proxies/shared storage.
    return null;
  }
}

function ownValue(object, key) {
  if (!object || prototypeOf(object) !== objectPrototype) return undefined;
  return descriptor(object, key)?.value;
}

function modelRequestLength(data) {
  const length = ownValue(data, 'length'),
    storage = fullByteStorage(ownValue(data, 'bytes'));
  return Number.isSafeInteger(length) &&
    length >= 0 &&
    length <= EMOTE_PREPARATION_LIMITS.expandedBytes &&
    storage &&
    storage.length <= EMOTE_PREPARATION_LIMITS.packedBytes
    ? length
    : null;
}

function snapshotModelReply(data, length) {
  if (length === null) return null;
  const expanded = ownValue(data, 'expanded'),
    storage = fullByteStorage(expanded);
  if (!storage || storage.length !== length) return null;
  const sourceAtlas = ownValue(data, 'atlas');
  let atlas = null,
    rgba;
  if (sourceAtlas != null && length <= EMOTE_PREPARATION_LIMITS.atlasWorkingBytes) {
    const texture = ownValue(sourceAtlas, 'texture'),
      width = ownValue(texture, 'width'),
      height = ownValue(texture, 'height'),
      pixels = ownValue(texture, 'rgba'),
      pixelStorage = fullByteStorage(pixels),
      name = ownValue(sourceAtlas, 'name'),
      resource = ownValue(sourceAtlas, 'resource'),
      storedWidth = ownValue(sourceAtlas, 'storedWidth'),
      storedHeight = ownValue(sourceAtlas, 'storedHeight');
    if (
      typeof name !== 'string' ||
      !Number.isSafeInteger(resource) ||
      resource < 0 ||
      !Number.isSafeInteger(width) ||
      width < 1 ||
      !Number.isSafeInteger(height) ||
      height < 1 ||
      !Number.isSafeInteger(storedWidth) ||
      storedWidth < width ||
      !Number.isSafeInteger(storedHeight) ||
      storedHeight < height ||
      !pixelStorage ||
      pixelStorage.buffer === storage.buffer ||
      pixelStorage.length !== width * height * 4 ||
      length + pixelStorage.length > EMOTE_PREPARATION_LIMITS.atlasWorkingBytes
    )
      return null;
    rgba = pixels;
    atlas = { name, resource, storedWidth, storedHeight, texture: { width, height, rgba: null } };
  }
  // Only these fresh arrays cross the receipt boundary. The old reply, buffers
  // and metadata remain local to this synchronous copy, even for an initial
  // replacement factory that keeps its reply alive and mutates it later.
  const ownedExpanded = new Bytes(length);
  apply(copyBytes, ownedExpanded, [expanded]);
  if (atlas) {
    const ownedPixels = new Bytes(atlas.texture.width * atlas.texture.height * 4);
    apply(copyBytes, ownedPixels, [rgba]);
    atlas.texture.rgba = ownedPixels;
  }
  const received = create(null);
  received.expanded = ownedExpanded;
  received.atlas = atlas;
  return received;
}

function exchange(worker, data, transfer, signal, channel) {
  if (channel) apply(signalThrow, signal, []);
  else signal.throwIfAborted();
  const Completion = channel ? ChannelPromise : Promise;
  return new Completion((resolve, reject) => {
    const length = channel?.snapshot && data !== 'ready' ? modelRequestLength(data) : null;
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
        if (!channel) finish(resolve, event.data);
        else {
          const reply = apply(messageData, event, []),
            owned = !channel.snapshot
              ? reply
              : data === 'ready'
                ? reply === 'ready'
                  ? reply
                  : null
                : snapshotModelReply(reply, length);
          // Initial factory accessors may reenter during receipt. Do not hand
          // their result to a canceled or replaced lease, even after copying.
          if (!channel.current()) {
            channel.stop();
            finish(resolve, null);
          } else finish(resolve, owned);
        }
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
  #initialChannel;

  constructor(kind, requireOwned = false) {
    const ownedModel = kind === 'model' && workerPortsCurrent();
    this.#initialChannel = ownedModel;
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
  async send(data, transfer, signal, snapshot = false) {
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
              snapshot,
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
        initial: this.#initialChannel,
        send: lease.send,
        receive: (data, transfer, signal) => {
          if (this.#lease !== lease) throw new Error('Scene preparation worker was released');
          return this.send(data, transfer, signal, true);
        },
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
    if (this.#initialChannel) apply(workerPorts.terminate.value, this.#worker, []);
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
  if (!held?.initial) return null;
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
      return held.receive(data, transfer, signal);
    },
    release() {
      if (released) return;
      released = true;
      if (!leaseCurrent(lease, held)) held.stop();
      apply(held.release, lease, []);
    },
  };
}
