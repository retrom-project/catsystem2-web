// SPDX-License-Identifier: MPL-2.0
// D8 decoder/COM ownership until the media migration. JS owns Plane geometry
// and submission. The old movie model is only a decoded-texture producer.
import { encodeCP932 } from '../src/kcs/strings.mjs';
const layouts = {
  'nekopara-vol3-engine-2.6.1.76': {
    create: [0x675d00, 0x675d70],
    query: [0x67ca00, 0x67ca10],
    destroy: 0x675ea0,
  },
  'sdk-4.01-engine-2.6.1.74': {
    create: [0x54ce10, 0x54ce80],
    query: [0x5536a0, 0x5536b0],
    destroy: 0x54cfb0,
  },
};
export class NativePlaneMovieProjection {
  constructor(engine, world) {
    Object.assign(this, {
      engine,
      world,
      process: engine.process,
      layout: layouts[engine.profile],
    });
    this.sources = new Map();
    engine.registerFeature('plane-movie-projection', this);
  }
  call(address, words, pointer, task) {
    return this.engine[this.process.asyncEnabled ? 'callFromHost' : 'call'](
      address,
      words,
      pointer,
      { task },
    );
  }
  get platform() {
    return this.engine.features.get('graphics-platform');
  }
  get direct() {
    return this.engine.features.get('directshow');
  }
  get device() {
    return this.engine.features.get('renderer').d3d;
  }
  async load(task, mode, position, filename) {
    await this.platform.ensureRenderer();
    await this.release(task);
    const nativeID = task.record.nativeID,
      bytes = encodeCP932(filename + '\0'),
      name = this.process.allocate(bytes.length, true);
    this.process.write(name, bytes);
    try {
      if (
        !(await this.call(
          this.layout.create[mode],
          [nativeID, ...position, name, task.state.vramType],
          this.platform.refs.view,
          task.record.id,
        ))
      )
        return null;
      const pointer = await this.call(
          this.layout.query[mode],
          [nativeID],
          this.platform.refs.manager,
          task.record.id,
        ),
        record = [...this.direct.objects.values()].find((record) => record.movie === pointer);
      if (!pointer) throw new Error('Plane movie factory did not publish its owned video object');
      const source = { nativeID, pointer, mode };
      this.sources.set(nativeID, source);
      return { ...source, width: record?.video?.width ?? 0, height: record?.video?.height ?? 0 };
    } finally {
      this.process.free(name);
    }
  }
  frame(source) {
    const record = [...this.direct.objects.values()].find(
      (record) => record.movie === source.pointer,
    );
    if (!record) throw new Error('Plane lost its decoded movie source');
    const p = this.process,
      filter = this.direct.objects.get(record.filter),
      allocator = filter && this.direct.vmr.record(filter.notify)?.allocator,
      wrapper = allocator
        ? p.load(allocator + 16)
        : record.textureFilter
          ? p.load(record.textureFilter - 12 + 388)
          : 0,
      texture = wrapper && p.load(wrapper + 20);
    if (!texture) throw new Error('Plane movie decoder has no presented texture');
    const target = this.device.gpuTargets.get(texture);
    if (target) return { width: target.width, height: target.height, nativeTarget: target };
    return this.device.frame(texture);
  }
  async release(task) {
    const nativeID = typeof task === 'number' ? task : task.record.nativeID;
    if (!this.sources.has(nativeID)) return;
    await this.call(
      this.layout.destroy,
      [nativeID],
      this.platform.refs.view,
      typeof task === 'number' ? undefined : task.record.id,
    );
    this.sources.delete(nativeID);
  }
  snapshot() {
    return { sources: [...this.sources] };
  }
  restore(state) {
    this.sources = new Map(structuredClone(state.sources));
  }
  async close() {
    for (const nativeID of [...this.sources.keys()]) await this.release(nativeID);
  }
}
