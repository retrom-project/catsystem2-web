// SPDX-License-Identifier: MPL-2.0
// Typed FES text orchestration. D5 owns writers, parsing, glyphs and rendering.
import { nativeABI } from './abi/index.mjs';
import { fesSourceBytes, fesNarrowText } from '../fes/tokens.mjs';
import {
  NativeFESTextLayout,
  fesConfigurationFontBytes,
  fesNativeFontFace,
} from './fes-text-layout.mjs';
import { textConfig, textPacket } from './text-config.mjs';
import { initializeFESPlane } from './fes-object-factory.mjs';
import { markFESObjectDirty } from './fes-common-model.mjs';
import { fesDefinitionResourceReference } from './fes-definitions.mjs';
import { fesPlaneRenderingState } from './fes-plane-driver.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { floatBits } from '../kcs.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';
const f = Math.fround;
export const FES_TEXT_VERBS = new Set(
  'str apend apendmark clear draw isdraw isdrawmark skip reset layout linecnt endpos userfontobj userfont insert getdiv name'.split(
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
export function initializeFESString(object, { profile, configuration }) {
  if (![21, 29, 37].includes(object.nativeType))
    throw new TypeError('Expected STRING, NVSTRING or STRING8');
  if (object.nativeType === 37 && !nativeABI(profile).capabilities.utf8Text)
    throw new Error('The registered ABI has no STRING8 task implementation');
  initializeFESPlane(object);
  Object.assign(object, { vramX: 0, vramY: 0, vramZ: 0, vramW: 1 });
  object.nativeTextState = createTextState(object, profile, configuration);
  object.sizeDirty = true;
  object.dirty = true;
  return object;
}
function nvConfiguration(profile, configuration) {
  const cores = nativeABI(profile).layouts.textCores,
    bytes = textPacket(profile, 'nv', configuration).slice(4, 4 + cores.nv.configSize),
    view = new DataView(bytes.buffer);
  for (const offset of [24, 24 + cores.cp932.configSize + 16])
    view.setUint32(offset + 124, configuration.fields.font.prop, true);
  return bytes;
}
function createTextState(object, profile, configuration) {
  const mode = object.nativeType === 37 ? 'utf8' : 'cp932',
    layout =
      object.nativeType === 29
        ? null
        : new NativeFESTextLayout({ profile: profile, type: object.nativeType });
  if (layout) {
    layout.bytes.set(textConfig(profile, mode, configuration, { fes: true }), 764);
    layout.word(layout.abi.colors, -1);
    layout.word(layout.abi.colors + 1, 0xff000000);
    layout.word(layout.abi.colors + 2, -1);
    layout.word(layout.abi.flags - 1, 1);
    layout.word(layout.abi.flags, 1);
    layout.word(layout.abi.flags + 1, 1);
    layout.word(layout.abi.flags + 2, 1);
  }
  return {
    layout: layout?.snapshot(),
    nv: object.nativeType === 29 ? nvConfiguration(profile, configuration) : null,
    source: new Uint8Array(),
    secondary: new Uint8Array(),
    secondaryPending: false,
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
    endKnown: false,
    fontDirty: false,
    fontSource: null,
    fontMap: [],
    ...(object.nativeType === 29 ? { nvFontDefault: true } : {}),
    section: false,
    redraw: false,
    division: 0,
    speed: 10,
    revision: -1,
  };
}
export class FESStringDriver {
  constructor(world, { cacheFor, lookup, imageDataFor } = {}) {
    if (
      typeof cacheFor !== 'function' ||
      typeof lookup !== 'function' ||
      typeof imageDataFor !== 'function'
    )
      throw new TypeError('FES text requires canonical cache, lookup and held IMAGE data services');
    Object.assign(this, { world, cacheFor, lookup, imageDataFor });
    this.scratch = new WeakMap();
  }
  supports(object) {
    return [21, 29, 37].includes(object.nativeType);
  }
  state(object) {
    if (!this.supports(object) || !object.nativeTextState)
      throw new Error('FES text requires its pure typed initializer');
    return object.nativeTextState;
  }
  workspace(object) {
    let s = this.scratch.get(object);
    if (!s) {
      s = {
        packet: new NativeGraphicsPacket(),
        metadata: new Uint8Array(36),
        rectangle: new Int32Array(4),
        cursor: new Int32Array(2),
        cursorWritten: 0,
        layout: null,
        layoutState: null,
      };
      s.view = new DataView(s.metadata.buffer);
      s.cursorMemory = {
        store: (address, value) => {
          if (address !== 0 && address !== 4)
            throw new RangeError('FES cursor output exceeds its two initialized words');
          const index = address / 4;
          s.cursor[index] = value | 0;
          s.cursorWritten |= 1 << index;
        },
      };
      this.scratch.set(object, s);
    }
    return s;
  }
  layout(object) {
    const state = this.state(object),
      s = this.workspace(object);
    if (!state.layout) return null;
    if (s.layoutState !== state.layout) {
      s.layout = new NativeFESTextLayout(state.layout);
      s.layoutState = state.layout;
    }
    return s.layout;
  }
  saveLayout(object, layout) {
    const state = this.state(object),
      scratch = this.workspace(object);
    state.layout = layout.snapshot();
    scratch.layout = layout;
    scratch.layoutState = state.layout;
  }
  setFont(object, value, index) {
    const state = this.state(object),
      layout = this.layout(object);
    if (layout) {
      layout.setFont(value, index);
      layout.word(layout.abi.dirty, 1);
      this.saveLayout(object, layout);
    } else {
      const abi = nativeABI(this.world.profile),
        size = abi.layouts.textCores.cp932.configSize,
        offsets = [24, 24 + size + 16],
        view = new DataView(state.nv.buffer);
      if (abi.text.fesNVFontWritesName) {
        const face = fesNativeFontFace(this.world.profile, value);
        if (face.length > abi.text.fesLayouts[21].fontBytes)
          throw new RangeError('FES font name exceeds the native font record');
        for (const offset of offsets) state.nv.set(face, offset + 128);
      } else if (fesSourceBytes(value).length >= 1024)
        throw new RangeError('FES font name exceeds the original temporary');
      for (const offset of offsets) view.setInt32(offset + size - 4, index | 0, true);
      state.nvFontDefault = false;
    }
    state.dirty = true;
  }
  validate(instance, object) {
    this.state(object);
    if (object.nativeType === 37 && !nativeABI(this.world.profile).capabilities.utf8Text)
      throw new Error('The registered ABI has no STRING8 task implementation');
    const child = this.world.objects.objects.get(object.nativeTaskID),
      kind = object.nativeType === 29 ? 49 : object.nativeType === 37 ? 63 : 48;
    if (!child || child.kind !== kind || child.parent !== instance.runtimeID)
      throw new Error('FES STRING has no live owned World text task');
    return child.implementation;
  }
  async initialize(instance, object, { restoring = false } = {}) {
    if (restoring) {
      this.state(object);
      return object.nativeTaskID == null ? undefined : this.validate(instance, object);
    }
    this.state(object);
    if (object.deleted) return this.close(object);
    if (object.nativeType === 37 && !nativeABI(this.world.profile).capabilities.utf8Text)
      throw new Error('The registered ABI has no STRING8 task implementation');
    if (object.nativeTaskID == null)
      object.nativeTaskID = await this.world.objects.create({
        kind: object.nativeType === 29 ? 49 : object.nativeType === 37 ? 63 : 48,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name: object.nativeType === 37 ? 'FE string UTF8' : 'FE string',
      });
    return this.validate(instance, object);
  }
  async update(instance, object, options = {}) {
    if (options.restoring) {
      this.state(object);
      return object.nativeTaskID == null ? undefined : this.validate(instance, object);
    }
    if (object.deleted) return this.close(object);
    await this.initialize(instance, object);
    await this.drive(instance, object, options);
  }
  input(instance, _object, args, context) {
    if (context.inputBytes instanceof Uint8Array) return context.inputBytes.slice();
    const source = fesSourceBytes(context.rawTail ?? args.map(fesNarrowText).join(' '));
    if (!source.length) return new Uint8Array();
    if (typeof instance.argumentBytes === 'function') return instance.argumentBytes(source).slice();
    let bytes = source.slice();
    const expand = instance.player.host?.nativeFESStringBytes;
    if (expand) bytes = expand(bytes);
    return this.world.configuration?.scriptReplacements?.apply(bytes) ?? bytes;
  }
  async stringID(instance, object, id) {
    if (object.nativeType !== 21 && object.nativeType !== 37)
      throw new TypeError('FES strid requires STRING or STRING8');
    if (object.nativeTaskID == null) return 0;
    const writer = await this.validate(instance, object).writer(),
      entry = writer?.parser.scanner?.ids.find(([key]) => (key | 0) === (id | 0));
    return entry?.[1] ?? 0;
  }
  async command(instance, object, verb, args = [], context = {}) {
    const target = object,
      evaluated = new Map();
    const value = (i, fallback = 0) => {
        if (args[i] === undefined) return fallback;
        if (!evaluated.has(i))
          evaluated.set(
            i,
            typeof args[i] === 'number'
              ? args[i]
              : context.argument
                ? context.argument(i)
                : instance.value(args[i]),
          );
        return evaluated.get(i);
      },
      evaluate = (token) =>
        typeof token === 'number'
          ? token
          : context.evaluate
            ? context.evaluate(token)
            : instance.value(token);
    const s = this.state(target),
      layout = this.layout(target);
    switch (verb) {
      case 'str':
        s.source = this.input(instance, target, args, context);
        s.pendingClear = s.fullSource = true;
        s.oldLength = 0;
        s.remaining = -1;
        break;
      case 'name':
        if (target.nativeType === 29) {
          s.secondary = this.input(instance, target, args, context);
          s.secondaryPending = true;
        }
        break;
      case 'apend':
        if (args.length || context.rawTail?.length) {
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
        if (args.length >= 2) this.setFontMapping(target, value(0), value(1));
        break;
      case 'userfontobj':
        if (args.length) {
          const ref = context.reference;
          if (!ref || typeof ref !== 'object')
            throw new Error('FES userfontobj requires its once-parsed canonical reference');
          this.setFontSource(target, this.lookup(instance, ref));
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
          for (let at = -1; at <= 2; at++) layout.word(layout.abi.flags + at, 1);
          this.saveLayout(target, layout);
        } else {
          s.nv = nvConfiguration(this.world.profile, this.world.configuration);
          s.nvFontDefault = true;
        }
        s.dirty = true;
        break;
      case 'layout':
        if (!args.length) break;
        args = [
          context.layoutMode ?? (context.text ? context.text(0) : fesNarrowText(args[0])),
          ...args.slice(1),
        ];
        if (layout) {
          const out = layout.apply(args[0], args.slice(1), evaluate, {
            fontBytes: () =>
              fesConfigurationFontBytes(this.world.profile, this.world.configuration),
            weight: this.world.configuration?.fields?.font?.weight ? 700 : 400,
            frame: this.world.configuration?.blocks?.[1]
              ? new DataView(this.world.configuration.blocks[1].buffer).getUint32(0, true)
              : 0,
          });
          if (out.applied && args[0] === 'view') {
            target.width = layout.word(44) | 0;
            target.height = layout.word(45) | 0;
          }
          this.saveLayout(target, layout);
        } else this.nvLayout(instance, target, args, context);
        break;
      default:
        throw new Error(`Unknown text command ${verb}`);
    }
    return 0;
  }
  nvLayout(instance, object, args, context = {}) {
    const s = this.state(object),
      v = new DataView(s.nv.buffer),
      size = nativeABI(this.world.profile).layouts.textCores.cp932.configSize,
      sub = 24 + size + 16,
      evaluated = new Map(),
      p = (i, f = 0) => {
        if (args[i] === undefined) return f;
        if (!evaluated.has(i))
          evaluated.set(
            i,
            typeof args[i] === 'number'
              ? args[i]
              : context.argument
                ? context.argument(i)
                : instance.value(args[i]),
          );
        return evaluated.get(i);
      },
      set = (at, n) => v.setInt32(at, n | 0, true),
      both = (at, n) => {
        set(24 + at, n);
        set(sub + at, n);
      };
    switch (args[0]) {
      case 'view': {
        const w = p(1, 800),
          h = p(2, 600);
        object.width = w;
        object.height = h;
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
      case 'fontind': {
        const index = args[0] === 'fontind' ? p(1) : 0;
        let face = args[args[0] === 'fontind' ? 2 : 1];
        if (face === undefined)
          face = fesConfigurationFontBytes(this.world.profile, this.world.configuration);
        this.setFont(object, face, index);
        break;
      }
      default:
        return { recognized: false, applied: false };
    }
    s.dirty = true;
    return { recognized: true, applied: true };
  }
  setFontMapping(object, char, selector) {
    const s = this.state(object);
    char &= 65535;
    selector &= 65535;
    const previous = s.fontMap.find((entry) => entry[0] === char);
    if (previous) previous[1] = selector;
    else s.fontMap.push([char, selector]);
    s.fontDirty = true;
  }
  setProfile(object, mode, index, bytes) {
    const layout = this.layout(object);
    if (!layout) return { recognized: true, applied: false };
    const result = layout.apply(mode, bytes === undefined ? [index] : [index, bytes], Number);
    this.saveLayout(object, layout);
    return result;
  }
  setFontSource(object, source) {
    if (source && source.nativeType !== 2)
      throw new Error('FES userfontobj requires an IMAGE source');
    const s = this.state(object);
    s.fontSource = source?.handle ?? null;
    s.fontDirty = true;
  }
  async reference(instance, reference, owner = reference) {
    const cache = this.cacheFor(instance);
    if (!cache?.data) throw new Error('FES text requires its owning encoded-byte cache');
    const scratch = this.workspace(owner),
      name = instance.player.expand ? instance.player.expand(reference.name) : reference.name,
      pointer = await cache.data(name);
    if (!pointer) return null;
    scratch.metadata.fill(0);
    if (
      !nativeImageMetadata(
        this.world.runtime.imageDataBuffers.data(pointer),
        reference.index,
        false,
        scratch.metadata,
      ).success
    )
      return null;
    for (let index = 0; index < 4; index++)
      scratch.rectangle[index] = scratch.view.getInt32(index * 4, true);
    return scratch.rectangle;
  }
  setView(object, width, height) {
    object.width = width | 0;
    object.height = height | 0;
    const s = this.state(object),
      layout = this.layout(object);
    if (layout) {
      layout.word(44, width);
      layout.word(45, height);
      layout.word(192, width);
      layout.word(193, height);
      this.saveLayout(object, layout);
    } else this.nvLayout({ value: Number }, object, ['view', width, height]);
    s.dirty = true;
  }
  setDivision(object, division) {
    const s = this.state(object),
      v = new DataView(s.nv.buffer, s.nv.byteOffset, s.nv.byteLength),
      size = nativeABI(this.world.profile).layouts.textCores.cp932.configSize,
      sub = 24 + size;
    s.division = division | 0;
    [division, 0, (v.getInt32(0, true) - division) | 0, v.getInt32(4, true)].forEach((value, i) =>
      v.setInt32(8 + i * 4, value, true),
    );
    [0, 0, division, v.getInt32(4, true)].forEach((value, i) =>
      v.setInt32(sub + i * 4, value, true),
    );
    s.dirty = true;
  }
  applyDefinition(instance, object, record) {
    if (!this.supports(object)) return false;
    this.state(object);
    const fields = record.fields,
      has = (name) => fields.has(name),
      get = (name) => fields.get(name);
    if (has('VRAM')) {
      const value = get('VRAM');
      object.vramX = f(value[0] ?? 0);
      object.vramY = f(value[1] ?? 0);
      object.vramZ = 0;
      markFESObjectDirty(instance, object);
    }
    if (has('POS') && get('POS').some((value) => value !== undefined)) {
      const value = get('POS');
      object.x = f(value[0] ?? 0);
      object.y = f(value[1] ?? 0);
      object.z = f(value[2] ?? 0);
      markFESObjectDirty(instance, object);
    }
    if (has('SIZE')) {
      const value = get('SIZE');
      this.setView(object, value[0], value[1] ?? 0);
    }
    if (has('POS2')) {
      object.positionReference = fesDefinitionResourceReference(get('POS2'));
      object.positionPending = true;
    }
    if (has('SIZE2')) {
      object.sizeReference = fesDefinitionResourceReference(get('SIZE2'));
      object.sizePending = true;
    }
    if (has('PRI')) {
      object.pri = get('PRI') | 0;
      markFESObjectDirty(instance, object);
    }
    if (has('BASE')) {
      const value = get('BASE');
      object.baseX = f(value[0] ?? 0);
      object.baseY = f(value[1] ?? 0);
      object.baseZ = f(value[2] ?? 0);
      object.baseW = 0;
      markFESObjectDirty(instance, object);
    }
    if (has('DISP')) {
      object.displayValue = get('DISP') | 0;
      object.disp = object.displayValue !== 0;
      markFESObjectDirty(instance, object);
    }
    if (has('COLOR')) {
      object.color = get('COLOR') >>> 0;
      object.alpha = object.color >>> 24;
      markFESObjectDirty(instance, object);
    }
    if (has('BLEND')) {
      object.color = ((object.color & 0xffffff) | (get('BLEND') << 24)) >>> 0;
      object.alpha = object.color >>> 24;
      markFESObjectDirty(instance, object);
    }
    if (object.nativeType === 29 && has('DIV')) this.setDivision(object, get('DIV'));
    return true;
  }
  async drive(instance, object, { configurationDirty = false } = {}) {
    const s = this.state(object),
      task = this.validate(instance, object);
    const runtime = await this.world.text.runtime(),
      mode = object.nativeType === 29 ? 'nv' : object.nativeType === 37 ? 'utf8' : 'cp932',
      first = mode === 'nv' ? 489 : mode === 'utf8' ? 469 : 449,
      scratch = this.workspace(object);
    let cursorMask = 0;
    if (s.first && object.sizePending) {
      const rect = await this.reference(instance, object.sizeReference, object);
      this.setView(object, rect?.[2] ?? 0, rect?.[3] ?? 0);
      scratch.cursor[0] = rect?.[mode === 'nv' ? 2 : 3] ?? 0;
      scratch.cursor[1] = rect?.[mode === 'nv' ? 3 : 2] ?? 0;
      cursorMask = 3;
    }
    if (object.sizeDirty) {
      this.setView(object, object.width, object.height);
      object.sizeDirty = false;
    }
    let layout = this.layout(object);
    if (configurationDirty && layout) {
      const defaults = textConfig(this.world.profile, mode, this.world.configuration, {
          fes: true,
        }),
        cfg = layout.config();
      cfg.set(defaults.subarray(128), 128);
      layout.bytes.set(cfg, 764);
      this.saveLayout(object, layout);
      s.dirty = true;
    }
    if (layout && layout.revision !== s.revision) {
      s.dirty = true;
      s.revision = layout.revision;
    }
    const send = (op, w = 0, l = 0, bytes = null, context = null) =>
        task.message([instance.runtimeID, first + op, w, l], {
          ...context,
          ...(bytes ? { payload: payload(bytes), nativeSenderWorldID: instance.runtimeID } : {}),
        }),
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
    if (s.fontDirty) {
      let bytes = null;
      if (s.fontSource !== null) {
        const source = instance.collection.graph.get(s.fontSource);
        if (!source || source.deleted || source.nativeType !== 2)
          throw new Error('FES image-font source is no longer a live IMAGE');
        bytes = this.imageDataFor(instance, source);
        if (bytes !== null && !(bytes instanceof Uint8Array))
          throw new TypeError('FES image-font service must return held bytes or null');
      }
      await send(mode === 'nv' ? 10 : 9, 0, 0, null, { resourceBytes: bytes });
      for (const [char, selector] of s.fontMap) {
        if (mode === 'nv') {
          scratch.cursor[0] = char;
          scratch.cursor[1] = selector;
          cursorMask = 3;
        } else {
          scratch.cursor[0] = selector;
          cursorMask |= 1;
        }
        await send(mode === 'nv' ? 11 : 10, char, selector);
      }
      s.fontDirty = false;
    }
    if (s.dirty) {
      await send(2, 0, 0, packet());
      s.dirty = false;
    }
    if (layout) {
      let layoutChanged = false;
      const abi = layout.abi;
      if (layout.word(abi.shift + 1)) {
        await send(15, 0, layout.word(abi.shift));
        layout.word(abi.shift + 1, 0);
        layoutChanged = true;
      }
      if (nativeABI(this.world.profile).text.resourceMessages.clearCategory)
        for (let i = 0; i < 4; i++)
          if (layout.word(abi.category + i)) {
            await send(19, i);
            layout.word(abi.category + i, 0);
            layoutChanged = true;
          }
      for (const kind of ['d_prof', 'prof'])
        if (layout.profiles[kind]) {
          const entry = layout.profiles[kind];
          await send(
            kind === 'prof' ? 16 : 13,
            entry.index,
            0,
            join(entry.bytes, Uint8Array.of(0)),
          );
          delete layout.profiles[kind];
          layoutChanged = true;
        }
      if (layoutChanged) this.saveLayout(object, layout);
    }
    if (mode === 'nv' && s.redraw) {
      await send(17);
      s.redraw = false;
    }
    if (mode === 'nv' && s.section) {
      await send(14);
      s.section = false;
    }
    if (object.positionPending) {
      object.positionPending = false;
      const rectangle = await this.reference(instance, object.positionReference, object);
      object.x = f(rectangle?.[0] ?? 0);
      object.y = f(rectangle?.[1] ?? 0);
      object.z = 0;
      scratch.cursor[0] = rectangle?.[1] ?? 0;
      scratch.cursor[1] = rectangle?.[0] ?? 0;
      cursorMask = 3;
      markFESObjectDirty(instance, object);
    }
    if (mode === 'nv' && s.secondaryPending) {
      s.secondaryPending = false;
      if (s.secondary.length) await send(4, 0, 0, join(s.secondary, Uint8Array.of(0)));
      s.oldSecondaryLength = s.secondary.length;
    }
    if (s.fullSource) {
      await send(mode === 'nv' ? 5 : 4);
      if (s.source.length) await send(3, 0, 0, join(s.source, Uint8Array.of(0)));
      s.oldLength = s.source.length;
      s.fullSource = false;
      if (mode !== 'nv') s.line = await send(14);
    } else if (s.oldLength !== s.source.length) {
      await send(3, 0, 0, join(s.source.subarray(s.oldLength), Uint8Array.of(0)));
      s.oldLength = s.source.length;
      if (mode !== 'nv') s.line = await send(14);
    }

    if (object.dirty) {
      await this.graphics(instance, object);
      await send(mode === 'nv' ? 13 : 12, 0, s.speed);
      object.dirty = false;
    } else {
      const sleeping = !!instance.player.nativeInput?.state.sleeping;
      if (object.textSleepMask !== sleeping)
        await task.message([instance.runtimeID, 47, 0, Number(object.disp && !sleeping)]);
      object.textSleepMask = sleeping;
    }
    if (s.pagePending) {
      await send(mode === 'nv' ? 9 : 8, 0, s.page);
      s.pagePending = false;
    }
    if (s.remaining !== 0) {
      s.remaining = await send(mode === 'nv' ? 6 : 5);
      if (mode !== 'nv') s.remainingPage = await send(17);
    }
    scratch.cursorWritten = 0;
    await send(mode === 'nv' ? 12 : 11, 0, 4, null, { payload: scratch.cursorMemory });
    if (scratch.cursorWritten === 3 || (scratch.cursorWritten === 0 && cursorMask === 3)) {
      for (let i = 0; i < 2; i++) {
        if (scratch.cursor[i] !== s.end[i]) s.endChanged = true;
        s.end[i] = scratch.cursor[i];
      }
      s.endKnown = scratch.cursorWritten === 3;
    } else if (scratch.cursorWritten !== 0 || cursorMask !== 0 || !s.endKnown)
      throw new Error('FES text cursor query left outputs unwritten without a complete known end');
    if (s.finish) {
      await send(mode === 'nv' ? 7 : 6);
      s.finish = false;
    }
  }
  async graphics(instance, object) {
    const state = fesPlaneRenderingState(instance, object),
      packet = this.workspace(object).packet,
      send = (message, values, w = 0, l = 0) => {
        if (values) {
          packet.data.fill(0);
          values.forEach((value, index) => packet.store(index * 4, value));
        }
        return this.world.graphics.send(
          object.nativeTaskID,
          instance.runtimeID,
          message,
          w,
          l,
          values ? packet : null,
          1,
        );
      };
    await send(51, [...state.position].map(floatBits));
    await send(49, [floatBits(state.base[0]), floatBits(state.base[1]), floatBits(f(object.pri))]);
    await send(
      51,
      [
        floatBits(f(truncateFloat32(object.vramX))),
        floatBits(f(truncateFloat32(object.vramY))),
        floatBits(f(object.vramZ)),
      ],
      1,
    );
    await send(66, [...state.scale].map(floatBits));
    await send(57, [...state.matrix].map(floatBits));
    await send(59, null, 1, object.color);
    const sleeping = !!instance.player.nativeInput?.state.sleeping;
    await send(47, null, 0, Number(object.disp && !sleeping));
    object.textSleepMask = sleeping;
    if (object.resourcePending) {
      object.resourcePending = false;
      await send(86);
    }
  }
  async close(object) {
    if (object.nativeTaskID != null) {
      if (this.world.objects.objects.has(object.nativeTaskID))
        await this.world.objects.destroy(object.nativeTaskID);
      object.nativeTaskID = null;
    }
  }
}
