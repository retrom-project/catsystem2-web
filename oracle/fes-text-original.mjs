// SPDX-License-Identifier: MPL-2.0
import { NativeFESTextProjection } from './fes-text-projection.mjs';
// Script text commands and their deferred frame driver are owned by JS.
import { nativeABI } from '../src/native/abi/index.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { fesNarrowText } from '../src/fes/tokens.mjs';
import { NativeFESTextLayout, fesConfigurationFontBytes } from '../src/native/fes-text-layout.mjs';
import { textConfig, textPacket } from '../src/native/text-config.mjs';
import { planeState } from './fes-plane-state-original.mjs';
import { MOTION_ABI, setMotionVector } from '../src/motion/abi.mjs';
export const FES_TEXT_VERBS = new Set(
  'str apend apendmark clear draw isdraw isdrawmark skip reset layout linecnt endpos userfontobj userfont insert getdiv'.split(
    ' ',
  ),
);
const join = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};
const payload = (bytes) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    load: (at) => v.getUint32(at, true),
    store: (at, n) => v.setUint32(at, n >>> 0, true),
    bytes: (at, n) => bytes.subarray(at, at + n),
    write: (at, b) => bytes.set(b, at),
  };
};
export class NativeFESText {
  constructor(service) {
    this.service = service;
    this.world = service.world;
  }
  supports(object) {
    return [21, 29, 37].includes(object.nativeType);
  }
  runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  state(object) {
    if (!object.nativeTextState) {
      const mode = object.nativeType === 37 ? 'utf8' : 'cp932',
        layout =
          object.nativeType === 29
            ? null
            : new NativeFESTextLayout({ profile: this.world.profile, type: object.nativeType });
      if (layout) {
        layout.bytes.set(
          textConfig(this.world.profile, mode, this.world.configuration, { fes: true }),
          764,
        );
        layout.word(layout.abi.colors, -1);
        layout.word(layout.abi.colors + 1, 0xff000000);
        layout.word(layout.abi.colors + 2, -1);
        layout.word(layout.abi.flags - 1, 1);
        layout.word(layout.abi.flags, 1);
        layout.word(layout.abi.flags + 1, 1);
        layout.word(layout.abi.flags + 2, 1);
      }
      object.nativeTextState = {
        layout: layout?.snapshot(),
        nv:
          object.nativeType === 29
            ? textPacket(this.world.profile, 'nv', this.world.configuration).slice(
                4,
                4 + nativeABI(this.world.profile).layouts.textCores.nv.configSize,
              )
            : null,
        source: new Uint8Array(),
        secondary: new Uint8Array(),
        oldLength: 0,
        oldSecondaryLength: 0,
        first: true,
        dirty: true,
        pendingClear: false,
        fullSource: false,
        pagePending: false,
        page: -1,
        finish: false,
        remaining: 0,
        remainingPage: 0,
        line: 0,
        end: [0, 0],
        fontDirty: false,
        fontSource: null,
        fontMap: [],
        section: false,
        division: 0,
        speed: 10,
        revision: -1,
      };
    }
    return object.nativeTextState;
  }
  layout(object) {
    const state = this.state(object);
    return state.layout ? new NativeFESTextLayout(state.layout) : null;
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(object);
    const runtime = await this.runtime();
    await runtime.create(instance, object);
    runtime.engine.features.get('fes-text-projection')?.bind(instance, object);
    this.state(object);
    if (object.nativeTaskID == null)
      object.nativeTaskID = await this.world.objects.create({
        kind: object.nativeType === 29 ? 49 : object.nativeType === 37 ? 63 : 48,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name: object.nativeType === 37 ? 'FE string UTF8' : 'FE string',
      });
    runtime.process.store(
      object.nativeObjectPointer +
        nativeABI(this.world.profile).fes.textTaskWords[object.nativeType] * 4,
      this.world.nativeTaskID ? this.world.nativeTaskID(object.nativeTaskID) : object.nativeTaskID,
    );
    return runtime;
  }
  async update(instance, object, options) {
    if (object.deleted) return this.close(object);
    const runtime = await this.initialize(instance, object);
    await runtime.runDriver(instance, object, options);
  }
  input(instance, object, args, context) {
    const text = context.rawTail ?? args.join(' ');
    let bytes =
      text instanceof Uint8Array
        ? text.slice()
        : object.nativeType === 37
          ? new TextEncoder().encode(text)
          : encodeCP932(text);
    const expand = instance.player.host.nativeFESStringBytes;
    if (expand) bytes = expand(bytes);
    return this.world.configuration?.scriptReplacements?.apply(bytes) ?? bytes;
  }
  async command(instance, object, verb, args = [], context = {}) {
    args = args.map(fesNarrowText);
    const group = instance.objects.filter((o) => o.baseName === object.baseName),
      index = group.length === 1 ? 0 : (context.index ?? object.index ?? 0);
    if (index === -1 && object !== group.find((o) => !o.deleted)) return;
    const targets = index === -1 ? group.filter((o) => !o.deleted) : [object];
    for (const target of targets) {
      const s = this.state(target),
        layout = this.layout(target),
        value = (i, fallback = 0) => (args[i] === undefined ? fallback : instance.value(args[i]));
      switch (verb) {
        case 'str':
          s.source = this.input(instance, target, args, context);
          s.pendingClear = s.fullSource = true;
          s.oldLength = 0;
          s.remaining = -1;
          break;
        case 'apend':
          if (args.length) {
            s.source = join(s.source, this.input(instance, target, args, context));
            s.remaining = -1;
          }
          break;
        case 'clear':
          s.source = new Uint8Array();
          s.pendingClear = s.fullSource = true;
          s.oldLength = 0;
          s.remaining = -1;
          break;
        case 'apendmark':
          s.source = join(
            s.source,
            target.nativeType === 37 ? new TextEncoder().encode('\uffff') : Uint8Array.of(255),
          );
          if (target.nativeType === 37) s.remaining = -1;
          break;
        case 'draw':
          s.page = value(0, -1) | 0;
          s.pagePending = true;
          s.remaining = 1;
          break;
        case 'skip':
          s.finish = true;
          break;
        case 'isdraw':
          instance.setLocal(0, s.remaining);
          break;
        case 'isdrawmark':
          instance.setLocal(0, s.remainingPage);
          break;
        case 'linecnt':
          if (args.length && target.nativeType !== 29) instance.setGlobal(value(0), s.line);
          break;
        case 'endpos':
          for (let i = 0; i < 2; i++)
            if (args[i] !== undefined && value(i) !== -1) instance.setGlobal(value(i), s.end[i]);
          break;
        case 'getdiv':
          instance.setLocal(0, target.nativeType === 29 ? s.division : 0);
          break;
        case 'insert':
          if (target.nativeType === 29) s.section = true;
          break;
        case 'userfont':
          if (args.length >= 2) {
            const char = value(0) & 65535,
              selector = value(1) & 65535,
              previous = s.fontMap.find((r) => r[0] === char);
            if (previous) previous[1] = selector;
            else s.fontMap.push([char, selector]);
            s.fontDirty = true;
          }
          break;
        case 'userfontobj':
          if (args.length) {
            const ref = args[0],
              source = instance.byKey.get(ref) ?? instance.byKey.get(ref + '[0]');
            if (source && source.nativeType !== 2)
              throw new Error(`FES userfontobj requires an IMAGE source: ${ref}`);
            s.fontSource = source?.key ?? null;
            s.fontDirty = true;
          }
          break;
        case 'reset':
          if (layout) {
            const cfg = textConfig(
              this.world.profile,
              target.nativeType === 37 ? 'utf8' : 'cp932',
              this.world.configuration,
              { fes: true },
            );
            layout.bytes.set(cfg, 764);
            s.layout = layout.snapshot();
          } else
            s.nv = textPacket(this.world.profile, 'nv', this.world.configuration).slice(
              4,
              4 + nativeABI(this.world.profile).layouts.textCores.nv.configSize,
            );
          s.dirty = true;
          break;
        case 'layout':
          if (!args.length) break;
          if (layout) {
            const before = layout.profiles[args[0]],
              out = layout.apply(args[0], args.slice(1), (n) => instance.value(n), {
                fontBytes: () =>
                  fesConfigurationFontBytes(this.world.profile, this.world.configuration),
                weight: this.world.configuration?.fields?.font?.weight ? 700 : 400,
                frame: this.world.configuration?.blocks?.[1]
                  ? new DataView(this.world.configuration.blocks[1].buffer).getUint32(0, true)
                  : 0,
              });
            if (out.applied && ['d_prof', 'prof'].includes(args[0]) && before) {
              layout.profiles[args[0]].text = before.text + layout.profiles[args[0]].text;
            }
            s.layout = layout.snapshot();
          } else this.nvLayout(instance, target, args);
          break;
        default:
          throw new Error(`Unknown text command ${verb}`);
      }
    }
    const bridge = await this.runtime();
    for (const target of targets) bridge.engine.features.get('fes-text-projection')?.sync(target);
    return 0;
  }
  nvLayout(instance, object, args) {
    const s = this.state(object),
      v = new DataView(s.nv.buffer),
      size = nativeABI(this.world.profile).layouts.textCores.cp932.configSize,
      sub = 24 + size + 16,
      p = (i, f = 0) => (args[i] === undefined ? f : instance.value(args[i])),
      set = (at, n) => v.setInt32(at, n | 0, true),
      both = (at, n) => {
        set(24 + at, n);
        set(sub + at, n);
      };
    switch (args[0]) {
      case 'view': {
        const w = p(1, 800),
          h = p(2, 600);
        set(0, w);
        set(4, h);
        for (const [at, x, width] of [
          [8, s.division, w - s.division],
          [24 + size, 0, s.division],
        ]) {
          set(at, x);
          set(at + 4, 0);
          set(at + 8, width);
          set(at + 12, h);
        }
        set(28, w - s.division);
        set(32, h);
        set(sub + 4, s.division);
        set(sub + 8, h);
        break;
      }
      case 'size':
      case 'rsize':
        for (let i = 0; i < 5; i++)
          both(
            (args[0] === 'size' ? 24 : 44) + i * 4,
            p(i + 1, p(1, args[0] === 'size' ? 20 : 10)),
          );
        break;
      case 'margin':
        for (let i = 0; i < 4; i++) both(64 + i * 4, p(i + 1));
        break;
      case 'move':
        both(80, p(1));
        both(84, p(2));
        break;
      case 'ruby':
        both(88, p(1));
        break;
      case 'frame':
        set(24 + 112, p(1, 0));
        set(24 + 116, p(1, 0));
        set(sub + 112, 0);
        set(sub + 116, 0);
        break;
      case 'indent':
        both(108, p(1));
        break;
      case 'color':
        for (let i = 0; i < 3; i++)
          both(
            12 + i * 4,
            0xff000000 |
              ((p(i * 3 + 3) & 255) << 16) |
              ((p(i * 3 + 2) & 255) << 8) |
              (p(i * 3 + 1) & 255),
          );
        break;
      case 'shadow':
        both(size - 20, p(1));
        both(size - 16, p(2));
        break;
      case 'weight':
        both(
          size - 24,
          p(1, -1) === -1 ? (this.world.configuration?.fields?.font?.weight ? 700 : 400) : p(1),
        );
        return;
      case 'font':
      case 'fontind':
        s.fontIndex = args[0] === 'fontind' ? p(1) : 0;
        both(size - 4, s.fontIndex);
        break;
      default:
        return;
    }
    s.dirty = true;
  }
  async definition(runtime, instance, object, pointer, record) {
    const p = runtime.process,
      flags = p.load(record),
      s = this.state(object),
      v = p.load(record + 4),
      layout = this.layout(object);
    const writeFloat = (at, value) => {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setFloat32(0, value, true);
      p.write(pointer + at, bytes);
    };
    if (flags & 14)
      for (let i = 0; i < 3; i++) {
        const value = p.load(record + (44 + i) * 4) | 0;
        writeFloat(48 + i * 4, value);
        object[['x', 'y', 'z'][i]] = value;
      }
    if (flags & 128)
      for (let i = 0; i < 3; i++) {
        const value = p.load(record + (47 + i) * 4) | 0;
        writeFloat(64 + i * 4, value);
        object[['baseX', 'baseY', 'baseZ'][i]] = value;
      }
    if (flags & 512)
      for (let i = 0; i < 3; i++) {
        const value = i < 2 ? p.load(record + (71 + i) * 4) | 0 : 0;
        writeFloat(740 + i * 4, value);
        object[['vramX', 'vramY', 'vramZ'][i]] = value;
      }
    if (flags & 2048) {
      object.pri = p.load(record + 73 * 4) | 0;
      p.store(pointer + 184, object.pri);
    }
    if (flags & 4096) {
      object.disp = Boolean(p.load(record + 75 * 4));
      p.store(pointer + 188, Number(object.disp));
    }
    let color = p.load(pointer + 192);
    if (flags & 32768) color = p.load(record + 85 * 4);
    if (flags & 32) color = ((color & 0xffffff) | (p.load(record + 59 * 4) << 24)) >>> 0;
    if (flags & (32768 | 32)) {
      object.color = color;
      object.alpha = color >>> 24;
      p.store(pointer + 192, color);
    }
    if (flags & 256) {
      const w = p.load(record + 276),
        h = p.load(record + 280);
      object.width = w;
      object.height = h;
      p.store(pointer + 176, w);
      p.store(pointer + 180, h);
      if (layout) {
        layout.word(44, w);
        layout.word(45, h);
        layout.word(192, w);
        layout.word(193, h);
        s.layout = layout.snapshot();
      } else this.nvLayout({ value: Number }, object, ['view', w, h]);
    }
    if (flags & 0x400000 /* exe-address-check: non-address - FES definition POS2 flag bit 22 */) {
      const bytes = p.read(record + 352, 128);
      s.positionSource = new TextDecoder('shift_jis').decode(bytes.subarray(0, bytes.indexOf(0)));
    }
    if (flags & 0x800000 /* exe-address-check: non-address - FES definition SIZE2 flag bit 23 */) {
      const bytes = p.read(record + 480, 128);
      s.sizeSource = new TextDecoder('shift_jis').decode(bytes.subarray(0, bytes.indexOf(0)));
    }
    if (object.nativeType === 29 && v & 2) s.division = p.load(record + 884) | 0;
    s.dirty = true;
    runtime.engine.features.get('fes-text-projection')?.sync(object);
  }
  async reference(instance, text) {
    const match = /^(.*):([+-]?\d+)$/.exec(instance.player.expand(text)),
      file = match ? match[1] : text,
      id = match ? Number(match[2]) >>> 0 : 0,
      images = this.world.graphics.images,
      handle = await images.load(file, id);
    if (!handle) return null;
    try {
      const bitmap = images.get(handle),
        rgba = await bitmap.pixels(),
        w = bitmap.width,
        h = bitmap.height;
      let left = w,
        top = h,
        right = 0,
        bottom = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (rgba[(y * w + x) * 4 + 3]) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + 1);
            bottom = Math.max(bottom, y + 1);
          }
      return left === w ? [0, 0, 0, 0] : [left, top, right - left, bottom - top];
    } finally {
      await images.release(handle);
    }
  }
  async drive(instance, object, { configurationDirty = false } = {}) {
    this.world.nativeEngine?.features.get('fes-text-projection')?.pull(object);
    const s = this.state(object),
      task = this.world.graphics.get(object.nativeTaskID);
    if (!task) return;
    const runtime = await this.service.runtime(),
      mode = object.nativeType === 29 ? 'nv' : object.nativeType === 37 ? 'utf8' : 'cp932',
      first = mode === 'nv' ? 489 : mode === 'utf8' ? 469 : 449;
    if (s.sizeSource && (s.first || s.dirty)) {
      const rect = await this.reference(instance, s.sizeSource);
      if (rect) {
        object.width = rect[2];
        object.height = rect[3];
        if (object.nativeType === 29)
          this.nvLayout({ value: Number }, object, ['view', ...rect.slice(2)]);
        else {
          const l = this.layout(object);
          l.word(44, rect[2]);
          l.word(45, rect[3]);
          l.word(192, rect[2]);
          l.word(193, rect[3]);
          s.layout = l.snapshot();
        }
      }
    }
    if (s.positionSource) {
      const rect = await this.reference(instance, s.positionSource);
      if (rect) {
        object.x = rect[0];
        object.y = rect[1];
        object.z = 0;
      }
    }
    let layout = this.layout(object);
    if (configurationDirty && layout) {
      const defaults = textConfig(this.world.profile, mode, this.world.configuration, {
          fes: true,
        }),
        cfg = layout.config();
      cfg.set(defaults.subarray(128), 128);
      layout.bytes.set(cfg, 764);
      s.layout = layout.snapshot();
      s.dirty = true;
    }
    if (layout && layout.revision !== s.revision) {
      s.dirty = true;
      s.revision = layout.revision;
    }
    const send = (op, w = 0, l = 0, bytes = null) =>
        task.message(
          [instance.runtimeID, first + op, w, l],
          bytes ? { payload: payload(bytes), nativeSenderWorldID: instance.runtimeID } : {},
        ),
      packet = () => {
        const cfg = layout ? layout.config() : s.nv,
          b = new Uint8Array(mode === 'nv' ? runtime.bindings(mode).packetSize : cfg.length + 16),
          v = new DataView(b.buffer);
        v.setUint32(0, b.length, true);
        b.set(cfg, 4);
        const at = 4 + cfg.length;
        v.setInt32(at, Math.trunc(object.vramX), true);
        v.setInt32(at + 4, Math.trunc(object.vramY), true);
        v.setUint32(at + 8, layout ? layout.word(layout.abi.flags - 1) : 1, true);
        return b;
      };
    if (s.first) {
      await send(1, 0, 0, packet());
      s.first = false;
      s.dirty = false;
    }
    if (s.pendingClear) {
      await send(mode === 'nv' ? 5 : 4);
      s.line = 0;
      s.pendingClear = false;
    }
    const writer = await task.writer();
    if (s.fontDirty) {
      let bytes = null;
      if (s.fontSource) {
        const source = instance.byKey.get(s.fontSource);
        if (source?.file) {
          const file = instance.player.expand(source.file);
          bytes = this.world.game.readCategory
            ? await this.world.game.readCategory(file, 'image')
            : this.world.game.requireCategory
              ? await this.world.game.requireCategory(file, 'image')
              : await this.world.game.require(file);
        }
      }
      await writer.userFont(bytes);
      for (const [char, selector] of s.fontMap) await writer.resourceMessage(10, char, selector);
      s.fontDirty = false;
    }
    if (s.dirty) {
      await send(2, 0, 0, packet());
      s.dirty = false;
    }
    if (layout) {
      const abi = layout.abi;
      if (layout.word(abi.shift + 1)) {
        await writer.shift(layout.word(abi.shift));
        layout.word(abi.shift + 1, 0);
      }
      for (let i = 0; i < 4; i++)
        if (layout.word(abi.category + i)) {
          await writer.resourceMessage(19, i, 0);
          layout.word(abi.category + i, 0);
        }
      for (const kind of ['d_prof', 'prof'])
        if (layout.profiles[kind]) {
          const entry = layout.profiles[kind];
          if (kind === 'prof') await writer.profile(entry.index, entry.text);
          else await writer.category(entry.index, encodeCP932(entry.text));
          delete layout.profiles[kind];
        }
      s.layout = layout.snapshot();
    }
    if (mode === 'nv' && s.section) {
      await send(14);
      s.section = false;
    }
    if (s.fullSource) {
      await send(mode === 'nv' ? 5 : 4);
      if (s.source.length) await send(3, 0, 0, join(s.source, Uint8Array.of(0)));
      s.oldLength = s.source.length;
      s.fullSource = false;
      if (mode !== 'nv') s.line = await writer.lineCount();
    } else if (s.oldLength !== s.source.length) {
      await send(3, 0, 0, join(s.source.subarray(s.oldLength), Uint8Array.of(0)));
      s.oldLength = s.source.length;
      if (mode !== 'nv') s.line = await writer.lineCount();
    }

    if (task.graph) {
      task.graph.kx2 = planeState(instance, object);
      task.graph.matrixExplicit = true;
      setMotionVector(task.graph.textureTransform, MOTION_ABI.pos, [
        Math.trunc(object.vramX),
        Math.trunc(object.vramY),
        object.vramZ,
      ]);
      task.state.shown = object.disp && !instance.player.nativeInput?.state.sleeping;
      task.state.colorOverride = true;
      task.sync();
    }
    await writer.speed(s.speed);
    if (s.pagePending) {
      await send(mode === 'nv' ? 9 : 8, 0, s.page);
      s.pagePending = false;
    }
    if (s.remaining !== 0) {
      s.remaining = await writer.remaining();
      if (mode !== 'nv') s.remainingPage = await writer.remaining(task.text.pageLimit);
    }
    const end = await writer.endPosition();
    if (end.some((n, i) => n !== s.end[i])) s.endChanged = true;
    s.end = end;
    this.world.nativeEngine?.features.get('fes-text-projection')?.sync(object);
    if (s.finish) {
      await send(mode === 'nv' ? 7 : 6);
      s.finish = false;
    }
  }
  async close(object) {
    if (object.nativeTaskID != null) {
      if (this.world.objects.objects.has(object.nativeTaskID))
        await this.world.objects.destroy(object.nativeTaskID);
      object.nativeTaskID = null;
    }
    if (object.nativeObjectPointer != null) {
      await (await this.runtime()).destroy(object.nativeObjectPointer);
      object.nativeObjectPointer = null;
    }
  }
}
export function nativeFESTextAdapter(bridge, _type) {
  const fes = bridge.world.text.fes;
  return {
    construct: async (runtime, instance, object, pointer, args) => {
      const projection =
        runtime.engine.features.get('fes-text-projection') ??
        new NativeFESTextProjection(runtime.engine, runtime.world);
      await projection.construct(runtime, instance, object, pointer, args);
    },
    driver: async (_runtime, instance, object, options) => fes.drive(instance, object, options),
    configurationChanged: async () => {},
    verbs: FES_TEXT_VERBS,
    vramOffset: 740,
    definitionApply: (runtime, instance, object, pointer, record) =>
      fes.definition(runtime, instance, object, pointer, record),
    async initialize(runtime, instance, object, pointer) {
      fes.state(object);
      await runtime.applyDefinition(instance, object, pointer, this.definitionApply);
    },
  };
}
