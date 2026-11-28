// SPDX-License-Identifier: MPL-2.0
// The mounted allocator and presenter own the surfaces handed to the guest.
// VMR9 negotiates those surfaces with the renderer's existing D3D device.
const IUNKNOWN = [0, 0, 0xc0, 0x46000000];
const NOTIFY = [0xdca3f5df, 0x4d03bb3a, 0x618481bd, 0x0cfafb4b];
const PRESENTER = [0x69188c61, 0x40f012a3, 0x2e34fc8f, 0xd73f437b];
const E_POINTER = 0x80004003;
const E_NOINTERFACE = 0x80004002;
const E_INVALIDARG = 0x80070057;
const E_NOTIMPL = 0x80004001;
const VFW_E_NOT_IN_GRAPH = 0x8004025f;
const VFW_E_WRONG_STATE = 0x80040227;
const D3DERR_NOTAVAILABLE = 0x8876086a;
const D3DERR_INVALIDCALL = 0x8876086c;
const D3DERR_OUTOFVIDEOMEMORY = 0x8876017c;
const RENDER_TARGET = 1;
const TEXTURE = 4;
const OFFSCREEN = 8;
const FAILED = (result) => (result | 0) < 0;

const METHODS = [
  ['queryInterface', 2],
  ['addRef', 0],
  ['release', 0],
  ['advise', 2],
  ['setDevice', 2],
  ['changeDevice', 2],
  ['allocateSurfaces', 3],
  ['notifyEvent', 3],
];

export class NativeVMR9 {
  constructor(engine) {
    this.engine = engine;
    this.process = engine.process;
    this.records = new Map();
    const p = this.process;
    this.table = p.allocate(METHODS.length * 4, true);
    METHODS.forEach(([name, count], index) => {
      const definition = this.definition(name, count);
      p.store(
        this.table + index * 4,
        p.trap(`VMR9 allocator notify ${name}`, definition.args, definition.handler),
      );
    });
    engine.registerFeature('vmr9', this);
  }
  get device() {
    const renderer = this.engine.features.get('renderer');
    if (!renderer?.initialized) throw new Error('VMR9 requires its initialized shared renderer');
    return renderer.d3d;
  }
  definition(name, count) {
    return {
      args: count + 1,
      real: false,
      handler: ([pointer, ...args]) => this[name](this.record(pointer), ...args),
    };
  }
  recoverTrap(trap) {
    const contract = METHODS.find(([name]) => trap.name === `VMR9 allocator notify ${name}`);
    return contract ? this.definition(...contract) : null;
  }
  call(pointer, slot, ...args) {
    const p = this.process;
    const address = p.load(p.load(pointer) + slot * 4),
      invoke = p.asyncEnabled ? 'callFromHost' : 'call';
    return this.engine[invoke](address, [pointer, ...args]);
  }
  create() {
    const p = this.process,
      pointer = p.allocate(4, true);
    p.store(pointer, this.table);
    this.records.set(pointer, {
      pointer,
      references: 1,
      cookie: 0,
      allocator: 0,
      presenter: 0,
      device: 0,
      monitor: 0,
      eventSink: 0,
      allocation: null,
      surfaces: [],
      presenting: false,
    });
    return pointer;
  }
  record(pointer) {
    const record = this.records.get(pointer);
    if (!record) throw new Error('VMR9 allocator notify reference is absent');
    return record;
  }
  queryInterface(record, iid, output) {
    const p = this.process;
    if (!output) return E_POINTER;
    p.store(output, 0);
    if (!iid) return E_POINTER;
    if (
      ![IUNKNOWN, NOTIFY].some((guid) =>
        guid.every((word, index) => p.load(iid + index * 4) === word),
      )
    )
      return E_NOINTERFACE;
    this.addRef(record);
    p.store(output, record.pointer);
    return 0;
  }
  addRef(record) {
    return ++record.references;
  }
  async release(record) {
    const remaining = record.references - 1;
    if (!remaining) {
      await this.disconnect(record.pointer);
      this.records.delete(record.pointer);
      this.process.free(record.pointer);
    }
    record.references = remaining;
    return remaining;
  }
  async advise(record, cookie, allocator) {
    if (!allocator) return E_POINTER;
    if (record.allocation) return VFW_E_WRONG_STATE;
    const p = this.process,
      args = p.allocate(20, true);
    try {
      PRESENTER.forEach((word, index) => p.store(args + index * 4, word));
      const result = await this.call(allocator, 0, args, args + 16);
      if (FAILED(result)) return result;
      const presenter = p.load(args + 16);
      if (!presenter) throw new Error('VMR9 allocator returned no presenter interface');
      await this.call(allocator, 1);
      if (record.presenter) await this.call(record.presenter, 2);
      if (record.allocator) await this.call(record.allocator, 2);
      Object.assign(record, { allocator, presenter, cookie });
      return 0;
    } finally {
      p.free(args);
    }
  }
  setDevice(record, pointer, monitor) {
    if (!pointer) return E_POINTER;
    const device = this.device;
    if (pointer !== device.device || monitor !== device.monitor) return E_INVALIDARG;
    if (!record.device) device.retain(device.objects.get(pointer));
    Object.assign(record, { device: pointer, monitor });
    return 0;
  }
  async changeDevice(record, pointer, monitor) {
    const status = this.setDevice(record, pointer, monitor);
    if (status || !record.allocation) return status;
    const allocation = record.allocation,
      presenting = record.presenting;
    const terminated = await this.terminate(record.pointer);
    if (FAILED(terminated)) return terminated;
    const result = await this.initialize(record.pointer, allocation);
    return !FAILED(result) && presenting ? this.start(record.pointer) : result;
  }
  bindEventSink(pointer, sink) {
    // The containing filter owns the graph relationship and clears it on detach.
    this.record(pointer).eventSink = sink;
  }
  notifyEvent(record, code, param1, param2) {
    return record.eventSink
      ? this.call(record.eventSink, 3, code, param1, param2)
      : VFW_E_NOT_IN_GRAPH;
  }
  async makeSurface(device, flags, width, height, format, pool, output) {
    if (flags === OFFSCREEN) return this.call(device, 36, width, height, format, pool, output, 0);
    if (flags === RENDER_TARGET)
      return this.call(device, 28, width, height, format, 0, 0, 0, output, 0);
    const result = await this.call(device, 23, width, height, 1, 0x200, format, pool, output, 0);
    if (FAILED(result)) return result;
    const texture = this.process.load(output);
    try {
      return await this.call(texture, 18, 0, output);
    } finally {
      await this.call(texture, 2);
    }
  }
  async allocateSurfaces(record, info, buffers, output) {
    if (!info || !buffers || !output) return E_POINTER;
    if (!record.device) return VFW_E_WRONG_STATE;
    const p = this.process,
      device = this.device,
      [flags, width, height, requestedFormat, pool, minimum] = Array.from(
        { length: 6 },
        (_, index) => p.load(info + index * 4),
      ),
      count = p.load(buffers);
    if (flags & TEXTURE && flags & OFFSCREEN) return E_INVALIDARG;
    if (![RENDER_TARGET, TEXTURE, OFFSCREEN].includes(flags)) return E_NOTIMPL;
    if (!count || count < minimum || count > 0x10000) return E_INVALIDARG;
    const format = requestedFormat || device.surfaceData(device.backbuffer).format;
    if (!requestedFormat) p.store(info + 12, format);
    if (
      (flags === TEXTURE && pool !== 0 && pool !== 2) ||
      (flags === OFFSCREEN && ![0, 2, 3].includes(pool))
    ) {
      p.store(buffers, 0);
      return D3DERR_INVALIDCALL;
    }
    const temporary = p.allocate(4, true),
      surfaces = [];
    let remaining = flags === RENDER_TARGET || !pool ? device.availableTextureMemory() : Infinity;
    let failure = D3DERR_OUTOFVIDEOMEMORY;
    try {
      for (let index = 0; index < count; index++) {
        let status;
        try {
          status = await this.makeSurface(
            record.device,
            flags,
            width,
            height,
            format,
            pool,
            temporary,
          );
        } catch (error) {
          if (error.message !== 'PE32 heap exhausted') throw error;
          status = D3DERR_OUTOFVIDEOMEMORY;
        }
        if (FAILED(status)) {
          failure = status;
          break;
        }
        const surface = p.load(temporary),
          data = device.surfaceData(surface),
          size = data.pitch * data.height;
        if (size > remaining) {
          await this.call(surface, 2);
          break;
        }
        surfaces.push(surface);
        remaining -= size;
      }
      if (surfaces.length < minimum) {
        p.store(buffers, 0);
        return failure;
      }
      const words = new Uint32Array(surfaces);
      if (words.length) p.write(output, new Uint8Array(words.buffer));
      p.store(buffers, surfaces.length);
      surfaces.length = 0;
      return 0;
    } finally {
      for (const surface of surfaces) await this.call(surface, 2);
      p.free(temporary);
    }
  }
  async initialize(pointer, options) {
    const record = this.record(pointer),
      p = this.process;
    if (!record.allocator || !record.device || record.allocation) return VFW_E_WRONG_STATE;
    const {
      width,
      height,
      aspectWidth = width,
      aspectHeight = height,
      count = 1,
      minimum = 1,
      flags = 0,
      format = 22,
    } = options;
    const words = [
      flags,
      width,
      height,
      format,
      0,
      minimum,
      aspectWidth,
      aspectHeight,
      width,
      height,
    ];
    if (
      words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffffffff) ||
      !width ||
      !height ||
      !aspectWidth ||
      !aspectHeight ||
      !count ||
      !minimum ||
      !Number.isSafeInteger(count) ||
      count < minimum ||
      count > 0x10000
    )
      return E_INVALIDARG;
    if (width > this.device.maximumTextureSize || height > this.device.maximumTextureSize)
      return D3DERR_NOTAVAILABLE;
    const input = p.allocate(48, true),
      buffers = input + 40,
      output = input + 44,
      surfaces = [];
    let ready = false;
    try {
      words.forEach((word, index) => p.store(input + index * 4, word));
      p.store(buffers, count);
      const result = await this.call(record.allocator, 3, record.cookie, input, buffers);
      if (FAILED(result)) return result;
      const actual = p.load(buffers);
      if (actual < minimum || actual > count)
        throw new Error('Original VMR9 allocator returned an invalid buffer count');
      for (let index = 0; index < actual; index++) {
        const status = await this.call(record.allocator, 5, record.cookie, index, 0, output);
        if (FAILED(status)) return status;
        const surface = p.load(output);
        if (!this.device.surfaceData(surface)) throw new Error('Original VMR9 surface is absent');
        surfaces.push(surface);
      }
      Object.assign(record, {
        surfaces,
        allocation: { width, height, aspectWidth, aspectHeight, count, minimum, flags, format },
      });
      ready = true;
      return result;
    } finally {
      try {
        if (!ready) {
          for (const surface of surfaces) await this.call(surface, 2);
          await this.call(record.allocator, 4, record.cookie);
        }
      } finally {
        p.free(input);
      }
    }
  }
  async start(pointer) {
    const record = this.record(pointer);
    if (!record.allocation || record.presenting) return VFW_E_WRONG_STATE;
    const result = await this.call(record.presenter, 3, record.cookie);
    if (!FAILED(result)) record.presenting = true;
    return result;
  }
  async present(pointer, index, info) {
    const record = this.record(pointer),
      surface = record.surfaces[index];
    if (!record.presenting || !surface) return VFW_E_WRONG_STATE;
    if (!info) return E_POINTER;
    this.process.store(info + 4, surface);
    return this.call(record.presenter, 5, record.cookie, info);
  }
  async stop(pointer) {
    const record = this.record(pointer);
    if (!record.presenting) return VFW_E_WRONG_STATE;
    const result = await this.call(record.presenter, 4, record.cookie);
    if (!FAILED(result)) record.presenting = false;
    return result;
  }
  async terminate(pointer) {
    const record = this.record(pointer);
    if (!record.allocation) return VFW_E_WRONG_STATE;
    if (record.presenting) {
      const status = await this.stop(pointer);
      if (FAILED(status)) return status;
    }
    for (const surface of record.surfaces) await this.call(surface, 2);
    record.surfaces = [];
    record.allocation = null;
    return this.call(record.allocator, 4, record.cookie);
  }
  async disconnect(pointer) {
    const record = this.record(pointer);
    if (record.allocation) {
      const result = await this.terminate(pointer);
      if (FAILED(result))
        throw new Error(`Original VMR9 termination failed: ${result.toString(16)}`);
    }
    if (record.presenter) await this.call(record.presenter, 2);
    if (record.allocator) await this.call(record.allocator, 2);
    if (record.device) this.device.release(this.device.objects.get(record.device));
    Object.assign(record, { presenter: 0, allocator: 0, device: 0, monitor: 0, eventSink: 0 });
  }
  snapshot() {
    return structuredClone({ table: this.table, records: [...this.records] });
  }
  restore(state) {
    const p = this.process,
      records = new Map(structuredClone(state.records));
    if (
      p.allocations.get(state.table) !== METHODS.length * 4 ||
      METHODS.some(
        ([name], index) =>
          p.traps.get(p.load(state.table + index * 4))?.name !== `VMR9 allocator notify ${name}`,
      ) ||
      records.size !== state.records.length
    )
      throw new Error('Invalid VMR9 allocator notify checkpoint table');
    for (const [pointer, record] of records)
      if (
        record.pointer !== pointer ||
        p.allocations.get(pointer) !== 4 ||
        p.load(pointer) !== state.table ||
        !Number.isInteger(record.references) ||
        record.references <= 0 ||
        (record.device && record.device !== this.device.device) ||
        (record.allocation &&
          (!record.allocator || !record.presenter || !record.surfaces.length)) ||
        (!record.allocation && (record.presenting || record.surfaces.length)) ||
        record.surfaces.some((surface) => !this.device.surfaceData(surface))
      )
        throw new Error('Invalid VMR9 allocator notify checkpoint object');
    this.table = state.table;
    this.records = records;
  }
  async close() {
    for (const pointer of this.records.keys()) {
      await this.disconnect(pointer);
      this.process.free(pointer);
    }
    this.records.clear();
    this.process.free(this.table);
  }
}
