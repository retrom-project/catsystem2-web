// SPDX-License-Identifier: MPL-2.0
// One shared live device authority; attachment handles/promises are not checkpoints.
const ownedDeviceReaders = new WeakMap(),
  deviceListenerCount = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;

// The intrinsic renderer has no callback during requireReady(). Public device
// observers, subclasses and replaced lifecycle ports keep the ordinary path.
export function nativeGraphicsDeviceReadOwned(device, source) {
  return Boolean(
    ownedDeviceReaders.has(device) &&
      Object.getPrototypeOf(device) === NativeGraphicsDevice.prototype &&
      deviceReadMethods.every(([key, descriptor]) => {
        const current = Object.getOwnPropertyDescriptor(NativeGraphicsDevice.prototype, key);
        return (
          !Object.hasOwn(device, key) &&
          current?.value === descriptor.value &&
          current?.get === descriptor.get
        );
      }) &&
      ownedDeviceReaders.get(device)(source),
  );
}
export class NativeGraphicsDevice {
  #status = 'detached';
  #generation = 0;
  #source = null;
  #revision = 0;
  #pending = null;
  #error = null;
  #listeners = new Set();
  constructor() {
    ownedDeviceReaders.set(
      this,
      (source) =>
        !!source &&
        this.#status !== 'closed' &&
        this.#source === source &&
        Reflect.apply(deviceListenerCount, this.#listeners, []) === 0,
    );
  }
  get status() {
    return this.#status;
  }
  get generation() {
    return this.#generation;
  }
  get ready() {
    return this.#status === 'ready';
  }
  get attachment() {
    return this.#source?.kind ?? null;
  }
  get error() {
    return this.#error;
  }
  observe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Device observer must be a function');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #publish(status) {
    this.#status = status;
    for (const listener of this.#listeners) listener(this);
  }
  attach(source) {
    if (this.#status === 'closed') throw new Error('Graphics device is closed');
    if (
      !source ||
      !['logical', 'webgl'].includes(source.kind) ||
      typeof source.validate !== 'function' ||
      typeof source.rebuild !== 'function'
    )
      throw new TypeError('Graphics attachment requires an explicit lifecycle endpoint');
    if (this.#source) throw new Error('Graphics device already has an attachment');
    this.#source = source;
    const revision = ++this.#revision;
    this.#error = null;
    this.#publish('not-reset');
    if (
      this.#source === source &&
      this.#status === 'not-reset' &&
      source.validate() &&
      this.#source === source &&
      this.#revision === revision
    ) {
      this.#generation++;
      this.#publish('ready');
    }
    const current = () => this.#source === source && this.#status !== 'closed';
    return Object.freeze({
      current,
      lost: () => {
        if (!current()) return;
        this.#revision++;
        this.#publish('lost');
      },
      restored: () => {
        if (!current()) return;
        this.#revision++;
        this.#publish('not-reset');
      },
      rebuild: () => (current() ? this.rebuild() : Promise.resolve(false)),
      retire: () => {
        if (!current()) return;
        this.#source = null;
        this.#revision++;
        this.#publish('detached');
      },
    });
  }
  createLogical() {
    if (this.#source) throw new Error('Graphics device already has an attachment');
    return this.attach({ kind: 'logical', validate: () => true, rebuild: () => {} });
  }
  rebuild() {
    if (this.#pending) return this.#pending;
    if (this.#status !== 'not-reset')
      return Promise.reject(new Error('Graphics device is not awaiting resource reconstruction'));
    const pending = Promise.resolve().then(async () => {
      while (this.#source && this.#status === 'not-reset') {
        const source = this.#source,
          revision = this.#revision;
        this.#publish('rebuilding');
        if (source !== this.#source || revision !== this.#revision) continue;
        try {
          await source.rebuild();
          if (source !== this.#source || revision !== this.#revision) continue;
          const valid = source.validate();
          if (source !== this.#source || revision !== this.#revision) continue;
          if (!valid) throw new Error('Graphics resources are not reconstructed');
        } catch (error) {
          if (source !== this.#source || revision !== this.#revision) continue;
          this.#error = error;
          this.#publish('not-reset');
          throw error;
        }
        this.#error = null;
        this.#generation++;
        this.#publish('ready');
        return true;
      }
      return false;
    });
    this.#pending = pending;
    const clear = () => {
      if (this.#pending === pending) this.#pending = null;
    };
    pending.then(clear, clear);
    return pending;
  }
  settled() {
    return this.#pending ?? Promise.resolve(this.ready);
  }
  requireReady() {
    if (!this.ready) throw new Error('Graphics device is ' + this.#status);
  }
  close() {
    if (this.#status === 'closed') return;
    this.#source = null;
    this.#revision++;
    this.#publish('closed');
  }
}
const deviceReadMethods = Reflect.ownKeys(NativeGraphicsDevice.prototype)
  .filter((key) => key !== 'constructor')
  .map((key) => [key, Object.getOwnPropertyDescriptor(NativeGraphicsDevice.prototype, key)]);
