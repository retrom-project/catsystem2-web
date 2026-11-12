// SPDX-License-Identifier: MPL-2.0
import { NativeGraphicTask } from './graphics.mjs';
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { nativeDataArgument, nativeDataCString } from './data-text.mjs';
import { nativeTextUnits } from './text-scanner.mjs';
import { LegacyTextState } from './legacy-text-state.mjs';
import { rasterTextGlyph, compositeTextGlyph } from './text-raster.mjs';
import { MOTION_ABI, setMotionVector } from '../motion/abi.mjs';
export const NATIVE_LEGACY_TEXT_IDS = Object.freeze([
  ...Array.from({ length: 17 }, (_, i) => 0x7b + i),
  0x187,
  0x1a2,
  0x1c8,
  0x22d,
]);
const vmMemory = (machine) => {
  if (machine.bytes && machine.load) return machine;
  const bytes = machine.memory,
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    ...machine,
    bytes: (at, n) => bytes.subarray(at, at + n),
    load: (at, size = 4) => (size === 1 ? v.getUint8(at) : v.getUint32(at, true)),
    store: (at, n) => v.setUint32(at, n >>> 0, true),
  };
};
const payload = (bytes) => {
  const v = new DataView(bytes.buffer);
  return {
    load: (at) => v.getUint32(at, true),
    store: (at, n) => v.setUint32(at, n >>> 0, true),
    bytes: (at, n) => bytes.subarray(at, at + n),
    write: (at, b) => bytes.set(b, at),
  };
};
export class NativeLegacyTextRuntime {
  static async open(engine, world) {
    return new NativeLegacyTextRuntime(engine, world);
  }
  constructor(engine, world) {
    Object.assign(this, { engine, world });
    this.tasks = new Map();
    engine.registerFeature('legacy-text', this);
  }
  async create(record) {
    const task = new NativeLegacyTextTask(this, record);
    this.tasks.set(record.id, task);
    this.world.graphics.tasks.set(record.id, task);
    return task;
  }
  async apply(id, args, machine, task) {
    machine = vmMemory(machine);
    const arg = (i) => nativeDataArgument(args, machine, i),
      target = arg(0),
      send = (message, w = 0, l = 0, bytes = null) =>
        this.world.sendNativeEngine
          ? this.world.sendNativeEngine(
              target,
              task.id,
              message,
              w,
              l,
              bytes ? { payload: payload(bytes) } : {},
            )
          : this.world.sendEngine
            ? this.world.sendEngine(
                this.world.resolveTaskID ? this.world.resolveTaskID(target, task.id) : target,
                task.id,
                message,
                w,
                l,
                bytes ? { payload: payload(bytes) } : {},
              )
            : this.world.graphics
                .get(target)
                ?.message([task.id, message, w, l], bytes ? { payload: payload(bytes) } : {});
    if (id === 0x7b || id === 0x1a2) {
      const bytes = new Uint8Array(1116),
        v = new DataView(bytes.buffer);
      bytes.set(machine.bytes(arg(1), 96));
      for (const [at, index] of [[96, 2], ...(id === 0x1a2 ? [[612, 3]] : [])]) {
        const units = nativeTextUnits(nativeDataCString(machine, arg(index))).map((c) =>
          c >= 128 && c <= 255 ? c | 0xff00 : c,
        );
        if (units.length > 255)
          throw new RangeError('Legacy text line-break profile exceeds 255 units');
        v.setUint32(at, units.length, true);
        units.forEach((c, i) => v.setUint16(at + 4 + i * 2, c, true));
      }
      await send(101, 0, 0, bytes);
      return nativeReply(2);
    }
    if (id === 0x7c) {
      const service = this.world.runtime.services,
        bytes = service?.formatBytes
          ? service.formatBytes(arg(1), machine)
          : nativeDataCString(machine, arg(1));
      await send(103, 0, 0, Uint8Array.from([...bytes, 0]));
      return nativeReply(2);
    }
    if (id === 0x86) {
      const units = nativeTextUnits(nativeDataCString(machine, arg(2))),
        bytes = new Uint8Array((units.length + 1) * 2),
        view = new DataView(bytes.buffer);
      units.forEach((code, i) =>
        view.setUint16(i * 2, code >= 128 && code <= 255 ? code | 0xff00 : code, true),
      );
      await send(114, arg(1), 0, bytes);
      return nativeReply(2);
    }
    if (id === 0x89) {
      const bytes = new Uint8Array(20),
        v = new DataView(bytes.buffer);
      for (let i = 0; i < 5; i++) v.setUint32(i * 4, arg(i + 1), true);
      await send(117, 0, 0, bytes);
      return nativeReply(2);
    }
    if (id === 0x88) {
      if (arg(1)) await send(116, 0, arg(1));
      return nativeReply(2);
    }
    if (id === 0x187) {
      const bytes = new Uint8Array(4);
      await send(119, 0, 0, bytes);
      return nativeReply(1, new DataView(bytes.buffer).getUint32(0, true));
    }
    const messages = {
        0x7d: 104,
        0x7e: 106,
        0x7f: 107,
        0x80: 105,
        0x81: 108,
        0x82: 109,
        0x83: 110,
        0x84: 112,
        0x85: 113,
        0x87: 115,
        0x8a: 118,
        0x8b: 111,
        0x1c8: 120,
        0x22d: 121,
      },
      message = messages[id];
    if (message === undefined) return undefined;
    const pair = id === 0x7e || id === 0x8a,
      result = await send(
        message,
        pair ? arg(1) : 0,
        [0x7d, 0x81, 0x82, 0x84].includes(id) ? 0 : arg(pair ? 2 : 1),
      );
    return nativeReply(
      id === 0x81 ? 1 : 2,
      id === 0x81 ? (result ?? NATIVE_RESULT_SENTINEL) : undefined,
    );
  }
  snapshot() {
    return {};
  }
  restore() {}
  async close() {
    this.tasks.clear();
  }
}
export class NativeLegacyTextTask {
  constructor(owner, record) {
    Object.assign(this, { owner, world: owner.world, record });
    this.plane = new NativeGraphicTask(this.world.graphics, record);
    this.text = new LegacyTextState();
    this.bitmap = 0;
    this.imageFont = null;
    this.glyphMap = new Map();
  }
  get graph() {
    return this.plane.graph;
  }
  get state() {
    return this.plane.state;
  }
  sync() {
    return this.plane.sync();
  }
  drawGPU(gpu) {
    return this.plane.drawGPU(gpu);
  }
  memory(sender, context) {
    if (context.payload || context.machine) return context.payload ?? context.machine;
    if (context.nativePointer) {
      const p = this.owner.engine.process;
      return {
        load: (at) => p.load(at),
        store: (at, n) => p.store(at, n),
        bytes: (at, n) => p.read(at, n),
      };
    }
    return this.world.objects.machine(context.nativeSenderWorldID ?? sender);
  }
  read(memory, at) {
    const bytes = [];
    for (let i = 0; i < 1024 * 1024; i++) {
      const n = memory.bytes(at + i, 1)[0];
      if (!n) return Uint8Array.from(bytes);
      bytes.push(n);
    }
    throw new RangeError('Legacy text source exceeds memory');
  }
  now() {
    return ((this.record.effectiveFrame ?? 0) - (this.record.pausedFrames ?? 0)) >>> 0;
  }
  async configure(bytes) {
    this.text.configure(bytes);
    if (this.bitmap) await this.world.graphics.images.release(this.bitmap);
    this.bitmap = this.world.graphics.images.create(this.text.w(179), this.text.w(180));
    this.plane.makeGraph({
      type: 1,
      width: this.text.w(179),
      height: this.text.w(180),
      vram: true,
    });
    setMotionVector(this.graph.textureTransform, MOTION_ABI.pos, [
      this.text.w(177),
      this.text.w(178),
      0,
    ]);
    this.sync();
    await this.output();
  }
  async raster(count) {
    const t = this.text,
      bitmap = this.world.graphics.images.get(this.bitmap),
      pixels = { width: bitmap.width, height: bitmap.height, rgba: await bitmap.pixels() },
      runtime = await this.world.text.runtime();
    for (let i = 0; i < Math.min(count >>> 0, t.rows.length); i++) {
      const r = t.rows[i];
      if (!r[0] || r[0] === 65535 || r[9]) continue;
      const row = new Int32Array(22);
      row[1] = r[0];
      row[2] = r[1];
      row[3] = t.w(470);
      row[6] = r[4];
      row[7] = r[5] - 2;
      row[13] = t.w(466);
      row[14] = t.w(467);
      const parser = {
        glyphs: runtime.glyphs,
        character: (record) =>
          new TextDecoder('shift_jis').decode(
            Uint8Array.from(record[1] > 255 ? [record[1] >> 8, record[1] & 255] : [record[1]]),
          ),
        font: () => ({
          face: this.font ?? this.world.configuration?.fields?.font?.name ?? '',
          height: -row[7],
          weight: r[6] ? 700 : 400,
          fixed: 0,
          escapement: 0,
          orientation: 0,
        }),
      };
      const rect = this.glyphMap.get(r[0]),
        image = rect && this.imageFont?.bpp === 4 ? this.imageFont : null;
      if (rect && !image) row[1] = 0x8140;
      const shape = rasterTextGlyph(parser, row, {
        image,
        sourceRect: rect ? { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } : null,
        padding: 2,
      });
      compositeTextGlyph(pixels, shape, r[2], r[3]);
      r[9] = 1;
    }
    bitmap.state.rgba = pixels.rgba;
    await bitmap.changed();
  }
  async output() {
    if (!this.bitmap || !this.text.w(182)) return;
    await this.world.graphics.output(this.world.graphics.images.get(this.bitmap), [
      this.text.w(177),
      this.text.w(178),
    ]);
  }
  async restart() {
    const t = this.text;
    if (!this.state.shown) {
      t.w(463, 0);
      return;
    }
    t.schedule(this.now(), this.record.frameRate ?? 60);
    if (t.w(194) === 0) {
      await this.raster(0xffffffff);
      await this.output();
    } else if (t.w(194) === 1) {
      await this.raster(t.w(461));
      await this.output();
      t.w(463, 1);
    }
  }
  async message(words, context = {}) {
    const [sender, message, w, l] = words,
      t = this.text,
      m = this.memory(sender, context);
    switch (message) {
      case 101:
        if (m) {
          const bytes = m.bytes(l, 1116).slice();
          if (new DataView(bytes.buffer).getUint32(60, true)) await this.configure(bytes);
        }
        return 0;
      case 103:
        if (!this.bitmap) return 0;
        if (t.append(this.read(m, l)) && t.w(194) !== 1) {
          await this.raster(0xffffffff);
          await this.output();
        }
        return 0;
      case 104:
        if (this.bitmap) {
          const b = this.world.graphics.images.get(this.bitmap);
          b.state.rgba.fill(0);
          await b.changed();
        }
        t.clear();
        return 0;
      case 105:
        t.w(197, l);
        return 0;
      case 106:
        t.w(194, w);
        t.w(195, l);
        t.w(461, 0);
        return 0;
      case 107:
        t.w(186, l);
        return 0;
      case 108:
        return Number(t.w(463) === 0);
      case 109: {
        if (!this.bitmap || !this.state.shown) return 0;
        let i = t.w(461) >>> 0;
        for (; i < t.rows.length; i++) {
          if (t.rows[i][0] !== 65535) await this.raster(i + 1);
          else {
            if (t.w(465) !== -1 && t.w(465)) t.w(465, t.w(465) - 1);
            if (!t.w(465)) {
              i++;
              break;
            }
          }
        }
        await this.output();
        t.w(463, 0);
        t.w(461, i);
        return 0;
      }
      case 110:
        t.w(183, l);
        return 0;
      case 111:
        t.w(196, l);
        t.vertical(l);
        return 0;
      case 112:
        t.mark();
        return 0;
      case 113:
        if (t.w(465) !== -1) t.w(465, t.w(465) + l);
        await this.restart();
        return 0;
      case 116:
        if (l) {
          this.imageFont = structuredClone(this.world.graphics.images.get(l).state);
        } else this.imageFont = null;
        return 0;
      case 117:
        if (m) {
          const bytes = m.bytes(l, 20),
            v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          this.glyphMap.set(
            v.getUint16(0, true),
            Array.from({ length: 4 }, (_, i) => v.getInt32(4 + i * 4, true)),
          );
        }
        return 0;
      case 118:
        t.w(459, w);
        t.w(460, l);
        return 0;
      case 119:
        if (m && (l || context.payload)) m.store(l, this.bitmap);
        return 0;
      case 120:
        t.w(469, l);
        return 0;
      case 121:
        t.w(470, l);
        return 0;
      case 122:
        t.w(46, l);
        t.w(193, l);
        return 0;
      case 123:
        if (m) for (let i = 0; i < 5; i++) t.w(471 + i, m.load(l + i * 4));
        return 0;
      case 14:
        this.font = new TextDecoder('shift_jis').decode(this.read(m, l));
        return 0;
      case 47: {
        if (t.w(182)) await this.plane.message(words, context);
        if (l) await this.restart();
        return 0;
      }
      default:
        return this.plane.message(words, context);
    }
  }
  async tick(frame) {
    const t = this.text;
    if (!t.w(463) || t.w(194) !== 1 || !this.bitmap) return;
    let i = t.w(461) >>> 0;
    for (; i < t.rows.length; i++) {
      const r = t.rows[i];
      if (r[0] !== 65535) {
        if (r[8] >>> 0 > frame >>> 0) break;
        await this.raster(i + 1);
      } else {
        if (t.w(465) !== -1 && t.w(465)) t.w(465, t.w(465) - 1);
        if (!t.w(465)) {
          i++;
          t.w(463, 0);
          break;
        }
      }
    }
    await this.output();
    if (i === t.rows.length) t.w(463, 0);
    t.w(461, i);
  }
  characters() {
    return this.text.bytes();
  }
  snapshot() {
    return {
      text: this.text.snapshot(),
      bitmap: this.bitmap,
      plane: this.plane.snapshot(),
      font: this.font,
      imageFont: this.imageFont,
      glyphMap: [...this.glyphMap],
    };
  }
  async restore(s) {
    this.text.restore(s.text);
    this.bitmap = s.bitmap;
    await this.plane.restore(s.plane);
    this.font = s.font;
    this.imageFont = s.imageFont;
    this.glyphMap = new Map(s.glyphMap);
  }
  async close() {
    if (this.bitmap) await this.world.graphics.images.release(this.bitmap);
    await this.plane.close();
    this.owner.tasks.delete(this.record.id);
  }
}
export function installNativeLegacyText(world) {
  world.registerNativeFeature('legacy-text', (engine) =>
    NativeLegacyTextRuntime.open(engine, world),
  );
  world.objects.register(8, async (record) =>
    (await world.getNativeFeature('legacy-text')).create(record),
  );
  for (const id of NATIVE_LEGACY_TEXT_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      world
        .getNativeFeature('legacy-text')
        .then((runtime) => runtime.apply(id, args, machine, task)),
    );
}
