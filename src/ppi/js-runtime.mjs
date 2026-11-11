// SPDX-License-Identifier: MPL-2.0
import { ParticleRandom } from './random.mjs';
import { PPIParticleRecords } from './records.mjs';
import { PPIHost } from './host.mjs';
import { PPIRegistry, describePPI } from './plugin-identity.mjs';
import { PPI_IMPLEMENTATIONS } from './plugins/index.mjs';

const f = Math.fround;
export class JSPluginInstance {
  constructor(runtime, module, identity, options, { restoring = false } = {}) {
    this.runtime = runtime;
    this.module = module;
    this.identity = identity.sha256;
    this.pluginIdentity = identity;
    this.version = identity.version;
    this.options = options;
    this.id = runtime.nextID++;
    this.count = options.count;
    this.random = runtime.random;
    this.storage = new PPIParticleRecords(this.count, options.width, options.height);
    this.registers = new Float32Array(32);
    this.setRegisters(options.registers ?? []);
    this.parameters = { count: this.count, values: new Float32Array(32) };
    for (const name of ['width', 'height', 'screenWidth', 'screenHeight'])
      this.parameters[name] = f(options[name]);
    this.zShifts = new Float32Array(this.count);
    this.blendMode = 0;
    this.attachPlane = options.attachPlane ?? -1;
    this.attachBase = new Float32Array(3);
    this.attachPos = new Float32Array(3);
    this.attachDisp = 0;
    this.renderStates = new Map();
    this.samplerStates = new Map();
    this.calls = new Map();
    this.active = false;
    this.stopped = true;
    this.frame = 0;
    this.before = 0xffffffff;
    this.hasFrame = false;
    this.state = {};
    this.host = new PPIHost(this, module.implementation.apiVersion);
    if (!restoring) this.invoke('construct');
  }
  invoke(entry) {
    return this.runtime.invoke(this, entry);
  }
  particle(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new RangeError('PPI particle index is outside its record array');
    return this.storage.particles[index];
  }
  records() {
    return this.storage.bytes;
  }
  particles() {
    return this.storage.particles;
  }
  setRegisters(values) {
    if (values.length > 32) throw new RangeError('PPI accepts 32 parameters');
    this.registers.fill(0);
    this.registers.set(values);
  }
  prepareCallback() {
    this.parameters.values.set(this.registers);
    if (this.attachPlane === -1) {
      this.attachBase.fill(0);
      this.attachPos.fill(0);
      this.attachDisp = 0;
    } else {
      const attachment = this.options.attachment?.(this.attachPlane);
      // Unresolved native graphs retain their preceding attachment fields.
      if (attachment) {
        this.attachBase.set(attachment.base ?? [0, 0, 0]);
        this.attachPos.set(attachment.pos ?? [0, 0, 0]);
        this.attachDisp = attachment.disp ?? 0;
      }
    }
  }
  start() {
    this.active = true;
    this.stopped = false;
    this.frame = 0;
    this.before = 0xffffffff;
    this.hasFrame = false;
    this.prepareCallback();
    this.invoke('init');
  }
  exec(before, frame) {
    if (!this.active) return;
    this.before = before >>> 0;
    this.frame = frame >>> 0;
    this.prepareCallback();
    this.invoke('exec');
    this.hasFrame = true;
  }
  update(frame) {
    this.exec(this.hasFrame ? this.frame : 0xffffffff, frame);
  }
  stop() {
    this.prepareCallback();
    this.invoke('stop');
    this.active = false;
    this.stopped = true;
  }
  saveState() {
    return {
      id: this.id,
      pluginIdentity: { ...this.pluginIdentity },
      moduleKey: this.module.key,
      options: Object.fromEntries(
        ['name', 'count', 'width', 'height', 'screenWidth', 'screenHeight'].map((key) => [
          key,
          this.options[key],
        ]),
      ),
      records: this.records().slice(),
      registers: this.registers.slice(),
      zShifts: this.zShifts.slice(),
      attachPlane: this.attachPlane,
      attachBase: this.attachBase.slice(),
      attachPos: this.attachPos.slice(),
      attachDisp: this.attachDisp,
      state: structuredClone(this.state),
      blendMode: this.blendMode,
      renderStates: [...this.renderStates],
      samplerStates: [...this.samplerStates],
      calls: [...this.calls],
      active: this.active,
      stopped: this.stopped,
      frame: this.frame,
      before: this.before,
      hasFrame: this.hasFrame,
    };
  }
  loadState(saved) {
    for (const [target, source] of [
      [this.records(), saved.records],
      [this.registers, saved.registers],
      [this.zShifts, saved.zShifts],
      [this.attachBase, saved.attachBase],
      [this.attachPos, saved.attachPos],
    ]) {
      if (target.length !== source.length)
        throw new RangeError('PPI checkpoint record/vector length differs');
      target.set(source);
    }
    this.state = structuredClone(saved.state);
    this.renderStates = new Map(saved.renderStates);
    this.samplerStates = new Map(saved.samplerStates);
    this.calls = new Map(saved.calls);
    for (const key of [
      'id',
      'attachPlane',
      'attachDisp',
      'blendMode',
      'active',
      'stopped',
      'frame',
      'before',
      'hasFrame',
    ])
      this[key] = saved[key];
  }
  close({ stop = true } = {}) {
    if (this.closed) return;
    if (stop && !this.stopped) this.stop();
    this.invoke('destruct');
    this.runtime.instances.delete(this.id);
    if (--this.module.references === 0) this.runtime.modules.delete(this.module.key);
    this.closed = true;
    this.active = false;
  }
}

// One host owns module statics and the engine's independent integer/real MT
// streams. The product Particles owner selects this JS host.
export class JSPluginRuntime {
  static async open(options = {}) {
    return new JSPluginRuntime(options);
  }
  constructor({
    registry = new PPIRegistry({ implementations: PPI_IMPLEMENTATIONS }),
    random = new ParticleRandom(),
    ...options
  } = {}) {
    this.registry = registry;
    this.random = random;
    this.options = options;
    this.instances = new Map();
    this.modules = new Map();
    this.nextID = 1;
  }
  async create(bytes, options) {
    if (this.closed) throw new Error('PPI runtime is closed');
    if (this.current) throw new Error('PPI host cannot create an instance during a callback');
    const { identity, implementation } = await this.registry.resolve(
        bytes,
        options.name,
        this.options.warn,
      ),
      key = identity.name;
    if (this.closed) throw new Error('PPI runtime is closed');
    if (![0x20001, 0x20002].includes(implementation.apiVersion))
      throw new Error('JS PPI implementation requires host API 2.1 or 2.2');
    let module = this.modules.get(key);
    if (!module)
      this.modules.set(key, (module = { key, implementation, shared: {}, references: 0 }));
    module.references++;
    let instance;
    try {
      instance = new JSPluginInstance(this, module, identity, { ...this.options, ...options });
      this.instances.set(instance.id, instance);
      if (options.autoStart !== false) instance.start();
      return instance;
    } catch (error) {
      if (instance) {
        this.instances.delete(instance.id);
        instance.closed = true;
      }
      if (--module.references === 0) this.modules.delete(key);
      throw error;
    }
  }
  tickCount() {
    return (
      this.options.clock?.tickCount() ?? Math.trunc(this.options.now?.() ?? performance.now()) >>> 0
    );
  }
  invoke(instance, entry) {
    if (this.current) throw new Error('PPI host cannot reenter a plugin callback');
    if (instance.closed) throw new Error('PPI instance is closed');
    this.current = instance;
    try {
      const result = instance.module.implementation[entry]?.(instance);
      if (result?.then) throw new Error('JS PPI callbacks must be synchronous');
      return result;
    } catch (cause) {
      const error = new Error(
        `PPI ${describePPI(instance.pluginIdentity)} ${entry}: ${cause.message}`,
        { cause },
      );
      error.code = 'CATSYSTEM2_PPI_JS';
      error.plugin = { ...instance.pluginIdentity };
      error.entry = entry;
      throw error;
    } finally {
      this.current = null;
    }
  }
  snapshot() {
    if (this.current) throw new Error('Cannot save PPI state during a callback');
    return {
      nextID: this.nextID,
      random: this.random.snapshot(),
      modules: [...this.modules.values()].map(({ key, shared }) => ({
        key,
        shared: structuredClone(shared),
      })),
      instances: [...this.instances.values()].map((instance) => instance.saveState()),
    };
  }
  static async fromSnapshot(saved, options) {
    const runtime = new JSPluginRuntime(options);
    runtime.restore(saved);
    return runtime;
  }
  restore(saved) {
    if (this.current) throw new Error('Cannot restore PPI state during a callback');
    for (const instance of this.instances.values()) {
      instance.closed = true;
      instance.active = false;
    }
    this.instances.clear();
    this.modules.clear();
    for (const state of saved.instances) {
      const identity = state.pluginIdentity,
        { implementation } = this.registry.select(identity, this.options.warn),
        key = state.moduleKey;
      let module = this.modules.get(key);
      if (!module)
        this.modules.set(
          key,
          (module = {
            key,
            implementation,
            shared: structuredClone(saved.modules.find((item) => item.key === key).shared),
            references: 0,
          }),
        );
      module.references++;
      const instance = new JSPluginInstance(
        this,
        module,
        identity,
        {
          ...this.options,
          ...state.options,
          ...this.options.instanceOptions?.(state),
        },
        { restoring: true },
      );
      instance.loadState(state);
      this.instances.set(instance.id, instance);
    }
    this.random.restore(saved.random);
    this.nextID = saved.nextID;
    this.closed = false;
  }
  close() {
    if (this.closed) return;
    for (const instance of [...this.instances.values()]) instance.close({ stop: false });
    this.closed = true;
  }
}
