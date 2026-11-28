// SPDX-License-Identifier: MPL-2.0
// Domain 7's generic plane/motion record is a consumer of JS-owned text state.
// This layer does not construct a native text parser or execute a text driver.
export class NativeFESTextProjection {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.objects = new Map();
    engine.registerFeature('fes-text-projection', this);
    this.install();
  }
  install() {
    const p = this.process,
      sdk = this.engine.profile === 'sdk-4.01-engine-2.6.1.74',
      patch = (addresses, name, count, fn) => {
        const address = addresses[sdk ? 1 : 0];
        if (!address) return;
        this.engine.patch(
          address,
          `JS text projection: ${name}`,
          count,
          (args) => {
            const pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
            let entry;
            try {
              entry = this.get(pointer);
            } catch (error) {
              error.message += ` (${name}, type=${p.load(pointer + 4)}, known=${[...this.objects.keys()]})`;
              throw error;
            }
            const { instance, object } = entry,
              state = this.world.text.fes.state(object);
            const result = fn(args, state, object, instance, pointer);
            this.sync(object);
            return result ?? 0;
          },
          { calleePops: true },
        );
      };
    const config = ([out], s) => {
      p.write(
        out,
        s.layout.bytes.subarray(
          764,
          764 + this.world.text.fes.layout({ nativeTextState: s }).abi.configBytes,
        ),
      );
      return 1;
    };
    patch([0x74e980, 0x5eed20], 'read STRING configuration', 1, config);
    patch([0x753300, null], 'read STRING8 configuration', 1, config);
    const replace = ([source], s) => {
      s.source = source ? p.stringBytes(source).slice() : new Uint8Array();
      s.oldLength = 0;
      s.pendingClear = s.fullSource = true;
      s.remaining = -1;
      return 0;
    };
    patch([0x74ea00, 0x5eeda0], 'replace STRING source', 1, replace);
    patch([0x753380, null], 'replace STRING8 source', 1, replace);
    const view = ([w, h], s, o, _i, at) => {
      const l = this.world.text.fes.layout(o);
      l.word(44, w);
      l.word(45, h);
      l.word(192, w);
      l.word(193, h);
      s.layout = l.snapshot();
      s.dirty = true;
      o.width = w;
      o.height = h;
      p.store(at + 176, w);
      p.store(at + 180, h);
      return h;
    };
    patch([0x74ec10, 0x5eefb0], 'set STRING view', 2, view);
    patch([0x753590, null], 'set STRING8 view', 2, view);
    const colors = (args, s, o) => {
      const l = this.world.text.fes.layout(o),
        v = args.map((at) => p.load(at));
      l.setWords(194, v);
      l.setWords(l.abi.colors, v);
      s.layout = l.snapshot();
      s.dirty = true;
      return v[2];
    };
    patch([0x74ec40, 0x5eefe0], 'set STRING colors', 3, colors);
    patch([0x7535c0, null], 'set STRING8 colors', 3, colors);
    const page = ([page], s) => {
      s.page = page | 0;
      s.pagePending = true;
      s.remaining = 1;
      return page;
    };
    patch([0x74f180, 0x5ef4f0], 'draw STRING page', 1, page);
    patch([0x753ae0, null], 'draw STRING8 page', 1, page);
    patch([0x753bd0, null], 'consume STRING8 end change', 0, (_args, s) => {
      const value = Number(Boolean(s.endChanged));
      s.endChanged = false;
      return value;
    });
    patch([0x753bb0, null], 'read STRING8 cached end', 2, ([x, y], s) => {
      p.store(x, s.end[0]);
      p.store(y, s.end[1]);
      return y;
    });
    const id = ([key], s, o) => {
      const task = this.world.graphics.get(o.nativeTaskID),
        runtime = this.engine.features.get('text'),
        writer = task && runtime?.writers.get(task.text.writer);
      return new Map(writer?.parser.scanner?.ids ?? []).get(key | 0) ?? 0;
    };
    patch([0x74f760, 0x5efa80], 'read STRING inline ID', 1, id);
    patch([0x754100, null], 'read STRING8 inline ID', 1, id);
  }
  get(pointer) {
    let entry = this.objects.get(pointer);
    if (entry) return entry;
    const players = new Set(this.world.player ? [this.world.player] : []);
    for (const record of this.world.objects.objects.values()) {
      const player = record.implementation?.player;
      if (player) players.add(player);
    }
    for (const map of this.world.graphics.fesSurfaces.values())
      for (const player of map.values()) players.add(player);
    for (const player of players)
      for (const instance of player.instances)
        for (const object of instance.objects)
          if (object.nativeObjectPointer === pointer) {
            entry = { instance, object };
            this.objects.set(pointer, entry);
            return entry;
          }
    throw new Error(`Unknown JS FES text projection ${pointer}`);
  }
  pull(object) {
    if (object.nativeControlledByLog == null) return;
    const p = this.process,
      at = object.nativeObjectPointer,
      v = new DataView(p.read(at + 48, 32).buffer),
      f = (i) => v.getFloat32(i, true);
    [object.x, object.y, object.z] = [f(0), f(4), f(8)];
    [object.baseX, object.baseY, object.baseZ] = [f(16), f(20), f(24)];
    [object.width, object.height] = [p.load(at + 176), p.load(at + 180)];
    object.pri = p.load(at + 184) | 0;
    object.disp = Boolean(p.load(at + 188));
    object.color = p.load(at + 192);
    object.alpha = object.color >>> 24;
    const vr = new DataView(p.read(at + 740, 12).buffer);
    [object.vramX, object.vramY, object.vramZ] = [0, 4, 8].map((i) => vr.getFloat32(i, true));
  }
  bind(instance, object) {
    this.objects.set(object.nativeObjectPointer, { instance, object });
    this.sync(object);
  }
  async construct(runtime, instance, object, pointer, args) {
    // FES Plane owns only common motion/parent/VRAM fields. Its destructor knows
    // those allocations; the text suffix is projected independently below.
    await runtime.constructPlane(instance, object, pointer, args);
    this.objects.set(pointer, { instance, object });
  }
  sync(object) {
    const s = object.nativeTextState;
    if (!s || !object.nativeObjectPointer) return;
    const p = this.process,
      at = object.nativeObjectPointer;
    if (s.nv) p.write(at + 764, s.nv);
    if (s.layout) {
      p.write(
        at + 764,
        s.layout.bytes.subarray(764, 764 + this.world.text.fes.layout(object).abi.configBytes),
      );
      const delta = object.nativeType === 37 ? 17 : 0,
        base = this.engine.profile === 'sdk-4.01-engine-2.6.1.74' ? -8 : 0;
      for (const [index, value] of [
        [320, s.remaining],
        [321, s.remainingPage],
        [330, s.end[0]],
        [331, s.end[1]],
        [345, s.line],
      ])
        p.store(at + (index + delta + base) * 4, value);
    }
  }
  snapshot() {
    return {};
  }
  restore() {
    this.objects.clear();
  }
  async close() {
    this.objects.clear();
  }
}
