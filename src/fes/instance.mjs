// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESInstance (OWCramer).
import { evaluate, assign, condition } from './expression.mjs';
import { FESObject, objectCommand, objectVerbs } from './object.mjs';
import { FES_OBJECT_DEFINITION_ORDER } from './types.mjs';
import { NativeDictionary } from '../native/dictionary.mjs';
import { expandNativeFESSoundConfigurationToken } from '../native/fes-sound-config.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NATIVE_FES_SAVE_COMMANDS } from '../native/save-slots.mjs';
import { replaceFESMacros, fesRawTail } from './source.mjs';
import { tokenizeFESLine } from './tokens.mjs';
const nativeArgumentDecoder = new TextDecoder('shift_jis');

export class FESInstance {
  constructor(
    name,
    program,
    player,
    { nativeVariableContextKey = null, macros = null, restoring = false } = {},
  ) {
    Object.assign(this, {
      name,
      program,
      player,
      childTaskID: null,
      kcsTaskID: null,
      objects: [],
      locals: {},
      nativeVariableContextKey,
      label: 'START',
      exitCode: -1,
      finished: null,
      suspended: null,
      waitFrames: 0,
      waitMotion: false,
      waitSound: null,
      waitObjects: null,
      transitionUntil: 0,
      eventObject: null,
      clickL: 0,
      clickR: 0,
      scrollUp: 0,
      scrollDown: 0,
      scrollPosition: 0,
      pageUp: 0,
      pageDown: 0,
      pushUp: 0,
      pushDown: 0,
      pushLeft: 0,
      pushRight: 0,
      frameOrigin: player.frameCount,
      defaultButton: null,
      keySkipEnabled: true,
      keySkipControlOnly: false,
      keySkipContinuous: false,
      keySkipForced: false,
      skipPressed: false,
      skipControl: false,
      inputPropagation: 1,
      forceRedrawPending: false,
      resultValue: 0,
      commandDelayUntil: null,
      deferredCommandReturn: null,
      decodePending: false,
      nativeQueuePending: false,
      dynamicDefinitions: [],
      declaredGroups: Object.create(null),
    });
    this.byKey = new Map();
    this.macros = new Map(
      macros ??
        program.macros.map(([name, value]) => [
          this.soundArgument(name),
          this.soundArgument(value),
        ]),
    );
    this.nativeDictionary = new NativeDictionary();
    this.keyNames = new Set();
    if (player.runtimeFactory) this.runtime = player.runtimeFactory(this);
    if (restoring || this.runtime) return;
    for (const d of program.definitions) {
      this.declaredGroups[d.name] = d.count ?? 1;
      if (player.nativeObjectAllocates?.(d.type) === false) continue;
      if (d.count === null) this.add(d.type, d.name, null);
      else {
        if (d.count > 10000) throw new Error('FES object limit');
        for (let i = 0; i < d.count; i++) this.add(d.type, d.name, i);
      }
    }
    for (const table of program.tables)
      for (const { target: token, values, source } of table.rows) {
        const target = this.soundArgument(token),
          found = this.elements(target);
        if (!found.length && !Object.hasOwn(this.declaredGroups, target.replace(/\[.*$/, ''))) {
          this.player.unresolvedTargets.add(`${this.name}: undeclared #OBJECT target ${target}`);
        }
        for (const o of found)
          this.apply(o, table.columns, values, { header: table.header, source });
      }
  }
  add(type, name, index) {
    const o = new FESObject(type, name, index, 0x1001 + this.objects.length);
    this.objects.push(o);
    this.byKey.set(o.key, o);
    return o;
  }
  createObjects(typeIndex, name, count) {
    if (this.runtime) return this.runtime.createObjects(typeIndex, name, count);
    const type = FES_OBJECT_DEFINITION_ORDER[typeIndex];
    if (!type)
      throw new Error(`FES ${this.name}: unknown native object factory index ${typeIndex}`);
    if (!/^\w+$/.test(name) || !Number.isInteger(count) || count < 0 || count > 10000)
      throw new Error(`FES ${this.name}: invalid dynamic object declaration ${name}[${count}]`);
    if (this.objects.some((object) => object.baseName === name && !object.deleted))
      throw new Error(
        `FES ${this.name}: replacing a live dynamic object group requires its native ownership contract`,
      );
    this.dynamicDefinitions.push({ typeIndex, name, count });
    this.declaredGroups[name] = count;
    if (this.player.nativeObjectAllocates?.(type) === false) return true;
    for (let index = 0; index < count; index++) this.add(type, name, index);
    return true;
  }
  applyObjects(columnHeader, row) {
    if (this.runtime) {
      const [target, ...values] = this.tokens(row);
      return this.runtime.definitions.row(this.tokens(columnHeader).slice(1), target, values);
    }
    const columns = this.tokens(columnHeader).slice(1),
      [target, ...values] = this.tokens(row),
      objects = this.elements(this.soundArgument(target));
    if (!columns.length || !objects.length) return false;
    for (const object of objects)
      this.apply(object, columns, values, { header: columnHeader, source: row });
    return true;
  }
  diagnostic(message) {
    this.player.unsupported(
      `${this.name}#${this.executingLabel || this.label}:${this.executingLine || 0}: ${message}`,
    );
  }
  elements(name) {
    if (this.runtime) return this.runtime.elements(name);
    if (name === '@') return this.eventObject ? [this.eventObject] : [];
    if (this.byKey.has(name)) return this.byKey.get(name).deleted ? [] : [this.byKey.get(name)];
    const match = /^(\w+)\[(.*)\]$/.exec(name);
    if (match) {
      const index = this.value(match[2]),
        object =
          this.byKey.get(`${match[1]}[${index}]`) ??
          (index === 0 ? this.byKey.get(match[1]) : null);
      return object && !object.deleted ? [object] : [];
    }
    return this.objects.filter((o) => !o.deleted && o.baseName === name);
  }
  selectionIndex(name) {
    if (this.runtime) return this.runtime.reference(name).index;
    if (name === '@') return this.eventIndex ?? this.eventObject?.index ?? 0;
    const match = /^(\w+)\[(.*)\]$/.exec(name);
    return match ? this.value(match[2]) : -1;
  }
  global(n) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid FES global index ${n}`);
    return this.player.globals[n] || 0;
  }
  setGlobal(n, v) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid FES global index ${n}`);
    this.player.globals[n] = v | 0;
  }
  local(n) {
    if (!Number.isInteger(n)) throw new Error(`Invalid FES local index ${n}`);
    if (n >>> 0 > 511) return 0;
    n >>>= 0;
    if (this.player.nativeVariableContext)
      return this.player.nativeVariableContext(this)?.words[n] | 0;
    return this.locals[n] || 0;
  }
  setLocal(n, v) {
    if (!Number.isInteger(n)) throw new Error(`Invalid FES local index ${n}`);
    if (n >>> 0 > 511) return;
    n >>>= 0;
    if (this.player.nativeVariableContext) {
      const words = this.player.nativeVariableContext(this)?.words;
      if (words) words[n] = v >>> 0;
      return;
    }
    this.locals[n] = v | 0;
  }
  tokens(line) {
    return this.player.tokens ? this.player.tokens(line) : tokenizeFESLine(line);
  }
  expandMacros(line) {
    return replaceFESMacros(line, this.macros, this.player.host.fesMacroLiterals?.());
  }
  objectHandle(name, index) {
    if (this.runtime) return this.collection.lookup(name, index ?? 0)?.handle;
    return (
      this.byKey.get(index === undefined ? name : `${name}[${index}]`)?.handle ??
      (index === 0 ? this.byKey.get(name)?.handle : undefined)
    );
  }
  system(name) {
    if (name === '_EXITCODE_') return this.player.childExitCode(this);
    return {
      _CLICK_L_: this.clickL,
      _CLICK_R_: this.clickR,
      _SCRL_U_: this.scrollUp,
      _SCRL_D_: this.scrollDown,
      _SCRL_P_: this.scrollPosition,
      _PAGE_U_: this.pageUp,
      _PAGE_D_: this.pageDown,
      _PUSH_UP_: this.pushUp,
      _PUSH_DOWN_: this.pushDown,
      _PUSH_LEFT_: this.pushLeft,
      _PUSH_RIGHT_: this.pushRight,
      _RELEASE_UP_: this.releaseUp ?? 0,
      _RELEASE_DOWN_: this.releaseDown ?? 0,
      _RELEASE_LEFT_: this.releaseLeft ?? 0,
      _RELEASE_RIGHT_: this.releaseRight ?? 0,
      _TOUCH_: this.touch ?? 0,
      _FRAME_: this.player.frameCount - this.frameOrigin,
      _SAVEOBJ_: this.player.saveObject ?? this.player.host.saveObject?.handle,
      _MOUSE_X_: this.player.mouse.x,
      _MOUSE_Y_: this.player.mouse.y,
      '@': this.currentValue ?? this.eventIndex ?? this.eventObject?.index ?? 0,
    }[name];
  }
  value(text, currentValue) {
    const context =
      currentValue === undefined ? this : Object.assign(Object.create(this), { currentValue });
    return evaluate(text.replace(/%$/, ''), context);
  }
  text(token = '') {
    return token
      .replace(/\$str(\d+)/g, (_, n) => this.player.strings[n] || '')
      .replace(/\\_/g, ' ')
      .replace(/\\n/g, '\n');
  }
  frameReference(token) {
    const m = /^(.*):(-?\d+)$/.exec(token || '');
    if (!m) return null;
    const file = this.text(m[1]),
      id = +m[2];
    return { file, id, frame: this.player.picture(file)?.frame(id) };
  }
  apply(
    o,
    columns,
    values,
    { header = '#OBJECT ' + columns.join(' '), source = o.key + ' ' + values.join(' ') } = {},
  ) {
    (o.nativeDefinitions ||= []).push({
      columns: [...columns],
      values: [...values],
      header,
      source,
    });
    columns = columns.map((value) => this.soundArgument(value));
    values = values.map((value) => this.soundArgument(value));
    {
      o.nativeDefinition ||= {};
      for (let i = 0; i < Math.min(columns.length, values.length); i++)
        o.nativeDefinition[columns[i]] = values[i];
    }
    for (let i = 0; i < Math.min(columns.length, values.length); i++) {
      const column = columns[i],
        value = values[i],
        pair =
          /^(POS|SIZE|POS2|SIZE2|BASE|VRAM|KEYBLOCK)$/.test(column) && !value.includes(':')
            ? value.split(',').map((v) => this.value(v))
            : [],
        ref = /^(POS2|SIZE2)$/.test(column) ? this.frameReference(value) : null;
      switch (column) {
        case 'FILE':
          o.file = this.text(value);
          break;
        case 'POS':
          o.x = pair[0] || 0;
          o.y = pair[1] || 0;
          o.z = pair[2] || 0;
          break;
        case 'BASE':
          [o.baseX, o.baseY, o.baseZ] = [pair[0] || 0, pair[1] || 0, pair[2] || 0];
          break;
        case 'VRAM':
          [o.vramX, o.vramY, o.vramZ] = [pair[0] || 0, pair[1] || 0, pair[2] || 0];
          break;
        case 'KEYBLOCK':
          if (pair.length !== 3)
            throw new Error(`${this.name}: invalid KEYBLOCK assignment ${value}`);
          o.keyblock = { block: pair[0], x: pair[1], y: pair[2] };
          this.keyNames.add(o.baseName);
          break;
        case 'DEFAULT':
          o.defaultHandler = value;
          break;
        case 'POS2':
          if (ref) {
            o.x = ref.frame?.offsetX || 0;
            o.y = ref.frame?.offsetY || 0;
            o.areaWidth = ref.frame?.width || 0;
            o.areaHeight = ref.frame?.height || 0;
            o.areaFile = ref.file;
            o.areaID = ref.id;
          } else {
            o.x = pair[0] || 0;
            o.y = pair[1] || 0;
          }
          break;
        case 'SIZE':
          if (o.type === 'SNDTABLE') o.soundCapacity = pair[0] || 0;
          else {
            o.width = pair[0] || 0;
            o.height = pair[1] || 0;
            o.depth = pair[2] || 0;
          }
          break;
        case 'SIZE2':
          if (ref) {
            o.areaWidth = ref.frame?.width || 0;
            o.areaHeight = ref.frame?.height || 0;
            if (!o.isPlane && o.type !== 'STRING8') {
              o.width = o.areaWidth;
              o.height = o.areaHeight;
            }
          } else {
            o.width = pair[0] || 0;
            o.height = pair[1] || 0;
          }
          break;
        case 'PRI':
          o.pri = this.value(value);
          break;
        case 'DISP':
          o.disp = this.value(value) !== 0;
          break;
        case 'ENABLE':
          o.enable = this.value(value) !== 0;
          break;
        case 'BLEND':
          if (['SOUND', 'SNDTABLE'].includes(o.type)) o.soundBypassVolume = this.value(value);
          else o.alpha = this.value(value);
          break;
        case 'TYPE':
          o.hitTransparent = this.value(value) !== 0;
          break;
        case 'CHANNEL':
          o.channel = this.value(value);
          break;
        case 'DIV':
          o.div = this.value(value);
          break;
        case 'STYPE':
          o.soundType = this.value(value);
          break;
        case 'PL':
          o.plane = value;
          break;
        case 'PARENT':
          o.parent = value;
          break;
        case 'GROUP':
          o.group = value;
          break;
        case 'COUNT':
          o.count = Number(value);
          break;
        case 'COLOR':
          o.color = this.value(value) >>> 0;
          break;
        case 'IDN':
          o.idIndex = this.value(value);
          break;
        default:
          if (/^ID\.\d+$/.test(column)) o.ids[+column.slice(3)] = Number(value);
          else if (
            !(
              this.player.nativeControls?.supports(o) ||
              this.player.nativeImages?.supports(o) ||
              this.player.nativeData?.supports(o) ||
              this.player.nativeEffects?.supports(o) ||
              this.player.nativePlanes?.supports(o) ||
              this.player.nativeArea?.supports(o) ||
              this.player.nativeText?.supports(o) ||
              this.player.nativeLog?.supports(o)
            )
          )
            this.diagnostic(`unsupported #OBJECT column ${column} for ${o.type} ${o.key}`);
      }
    }
    if (['SOUND', 'SNDTABLE'].includes(o.type) && this.player.nativeSound) {
      if (typeof this.player.nativeSound.initialize !== 'function')
        throw new Error('Native FES sound initialization adapter is unavailable');
      this.player.nativeSound.initialize(this, o, columns);
    }
  }
  plane(o) {
    return this.byKey.get(o.plane || o.parent) || this.byKey.get(`${o.plane || o.parent}[0]`);
  }
  placement(o) {
    let x = o.x,
      y = o.y,
      z = o.z,
      alpha = o.alpha,
      shown = true,
      p = this.plane(o),
      depth = 0;
    while (p) {
      if (++depth > 16) throw new Error('FES plane cycle');
      x += p.x;
      y += p.y;
      z += p.z;
      alpha *= p.alpha / 255;
      shown &&= p.disp;
      p = this.plane(p);
    }
    return { x, y, z, alpha, shown };
  }
  rect(o) {
    const bounds = this.player.nativeImages?.supports(o)
      ? this.player.nativeInput?.bounds?.(o)
      : null;
    if (bounds)
      return { x: bounds[0], y: bounds[1], w: bounds[2] - bounds[0], h: bounds[3] - bounds[1] };
    if (o.lockedRect) return o.lockedRect;
    const at = this.placement(o),
      f =
        this.player.picture(o.file)?.frame(o.currentID) ||
        this.player.picture(o.file)?.frames[0] ||
        o.nativeImageMetrics;
    if (['SLIDER', 'SCROLL2'].includes(o.type))
      return { x: at.x, y: at.y, w: o.areaWidth, h: o.areaHeight };
    if (o.width > 0 && o.height > 0) return { x: at.x, y: at.y, w: o.width, h: o.height };
    return f ? { x: at.x + f.offsetX, y: at.y + f.offsetY, w: f.width, h: f.height } : null;
  }
  tick() {
    if (this.finished !== null) return;
    if (this.deferredCommandReturn !== null) {
      const value = this.deferredCommandReturn;
      this.deferredCommandReturn = null;
      const { action } = this.nativeCommandReturn(value);
      if (action === 'suspend') return;
      if (action === 'flush') {
        this.decodePending = true;
        return;
      }
    }
    if (
      (this.waitFrames > 0 ||
        this.waitMotion ||
        this.waitObjects ||
        this.commandDelayUntil !== null) &&
      this.consumeWaitSkip()
    ) {
      this.waitFrames = 0;
      this.commandDelayUntil = null;
      for (const object of this.objects) {
        if (object.motionTarget) object.motionTarget.manager.skip();
        if (object.motions.length) object.finish();
      }
      this.transitionUntil = this.player.frameCount;
    }
    if (this.commandDelayUntil !== null) {
      if (this.player.frameCount >>> 0 < this.commandDelayUntil) return;
      this.commandDelayUntil = null;
    }
    if (this.waitFrames > 0 && --this.waitFrames > 0) return;
    if (this.waitObjects?.some((key) => this.byKey.get(key)?.motionBusy)) return;
    this.waitObjects = null;
    if (
      this.waitMotion &&
      (this.objects.some((o) => o.motionBusy) || this.player.frameCount < this.transitionUntil)
    )
      return;
    this.waitMotion = false;
    const stack = this.suspended || [[this.label, 0]];
    this.suspended = null;
    this.run(stack);
  }
  consumeWaitSkip() {
    if (
      !this.keySkipEnabled ||
      (!this.skipControl && !this.keySkipForced && (!this.skipPressed || this.keySkipControlOnly))
    )
      return false;
    if (!this.keySkipContinuous && !this.skipControl && !this.keySkipForced)
      this.skipPressed = false;
    return true;
  }
  event(o, event) {
    const labels = [
      o.defaultHandler && `${o.defaultHandler}.${event}`,
      `${o.baseName}.${event}`,
    ].filter((label) => label && this.program.blocks[label]);
    if (!labels.length || this.finished !== null) return false;
    const saved = this.suspended,
      current = this.eventObject;
    this.suspended = null;
    this.eventObject = o;
    let jumped = false;
    for (const label of labels) {
      jumped = this.run([[label, 0]]) || jumped;
      if (jumped || this.finished !== null) break;
    }
    this.eventObject = current;
    if (!jumped && !this.suspended) this.suspended = saved;
    return true;
  }
  async invokeEventLabels(labels, object, index) {
    if (this.finished !== null) return false;
    const saved = {
      suspended: this.suspended,
      decodePending: this.decodePending,
      object: this.eventObject,
      index: this.eventIndex,
      executingLabel: this.executingLabel,
      executingLine: this.executingLine,
      waits: Object.fromEntries(
        [
          'waitFrames',
          'waitMotion',
          'waitSound',
          'waitObjects',
          'transitionUntil',
          'commandDelayUntil',
          'deferredCommandReturn',
        ].map((key) => [key, this[key]]),
      ),
    };
    this.suspended = null;
    this.decodePending = false;
    this.eventObject = object;
    this.eventIndex = index;
    let jumped = false,
      handled = false;
    try {
      for (const label of labels) {
        if (!this.program.blocks[label]) continue;
        handled = true;
        jumped = this.run([[label, 0]]) || jumped;
        let flushes = 0;
        while (this.decodePending) {
          if (++flushes > 10000) throw new Error(`${this.name}: FES notification decode budget`);
          const continuation = this.suspended;
          this.decodePending = false;
          this.suspended = null;
          await this.player.flush();
          if (this.deferredCommandReturn !== null) {
            const value = this.deferredCommandReturn;
            this.deferredCommandReturn = null;
            if (this.nativeCommandReturn(value).action === 'suspend') break;
          }
          await this.flushNativeRecords();
          jumped = this.run(continuation) || jumped;
        }
        if (jumped || this.finished !== null) break;
      }
    } finally {
      this.eventObject = saved.object;
      this.eventIndex = saved.index;
      this.executingLabel = saved.executingLabel;
      this.executingLine = saved.executingLine;
      if (!jumped && this.finished === null) {
        this.suspended = saved.suspended;
        this.decodePending = saved.decodePending;
        Object.assign(this, saved.waits);
      }
    }
    return handled;
  }
  dispatchEvent(object, event) {
    const labels = [
      object.defaultHandler && `${object.defaultHandler}.${event}`,
      `${object.baseName}.${event}`,
    ].filter(Boolean);
    return this.invokeEventLabels(labels, object, object.index ?? 0);
  }
  notify(event, name = null, index = 0) {
    const object = name == null ? null : this.elements(`${name}[${index}]`)[0] || null;
    return this.invokeEventLabels([name == null ? event : `${name}.${event}`], object, index);
  }
  nativeCommandReturn(value) {
    const word = value >>> 0,
      signed = word | 0;
    if (!word) return {};
    if (signed === -3) {
      this.nativeQueuePending = true;
      return { action: 'flush' };
    }
    if (signed === -1) {
      this.waitMotion = true;
      return { action: 'suspend' };
    }
    if ([-2, -4, -5, -6, -7].includes(signed))
      throw new Error(
        `Native FES return state ${signed} requires its command-specific wait context`,
      );
    this.commandDelayUntil = (this.player.frameCount + word) >>> 0;
    return { action: 'suspend' };
  }
  async flushNativeRecords() {
    if (!this.nativeQueuePending) return;
    await this.runtime?.flushRecords();
    this.nativeQueuePending = false;
  }
  invoke(label, parameters = []) {
    if (!this.program.blocks[label]) return false;
    parameters.forEach((v, i) => this.setLocal(i, v));
    const saved = this.suspended;
    this.suspended = null;
    const jumped = this.run([[label, 0]]);
    if (!jumped && !this.suspended) this.suspended = saved;
    return true;
  }
  run(stack) {
    let budget = 20000;
    let jumped = false;
    while (stack.length) {
      const [label, offset] = stack.pop(),
        lines = this.program.blocks[label];
      if (!lines) throw new Error(`${this.name}: no FES block ${label}`);
      for (let pc = offset; pc < lines.length; ) {
        if (--budget <= 0) throw new Error(`${this.name}#${label}: FES instruction budget`);
        this.executingLabel = label;
        this.executingLine = pc + 1;
        let result;
        try {
          result = this.execute(lines[pc++], lines, pc);
        } catch (error) {
          error.message = `${this.name}#${label}:${pc}: ${error.message}`;
          throw error;
        }
        pc = result.pc ?? pc;
        if (result.action === 'call') {
          stack.push([label, pc], [result.target, 0]);
          break;
        }
        if (result.action === 'return') break;
        if (result.action === 'next') {
          jumped = true;
          stack.length = 0;
          stack.push([result.target, 0]);
          break;
        }
        if (result.action === 'stop') return true;
        if (result.action === 'suspend' || result.action === 'flush') {
          stack.push([label, pc]);
          this.suspended = stack;
          this.decodePending = result.action === 'flush';
          return jumped;
        }
      }
    }
    return jumped;
  }
  skip(lines, pc, stopAtElse) {
    let depth = 0;
    for (; pc < lines.length; pc++) {
      const line = this.expandMacros(lines[pc]);
      if (/^if\s*\(/.test(line) && !condition(line)[1]) depth++;
      else if (line === 'endif') {
        if (!depth) return pc + 1;
        depth--;
      } else if (line === 'else' && !depth && stopAtElse) return pc + 1;
    }
    return pc;
  }
  execute(line, lines, pc, execution) {
    if (!execution) {
      line = this.expandMacros(line);
      execution = { text: line, offset: 0 };
    }
    const words = this.tokens(line),
      head = words[0],
      args = words.slice(1),
      p = (i) => this.value(this.soundArgument(args[i] || '0'));
    const store = (i, v) => {
      if (args[i] !== undefined) this.setGlobal(p(i), v);
    };
    if (/^if\s*\(/.test(line)) {
      const [expr, rest] = condition(line),
        truth = this.value(expr) !== 0;
      return rest
        ? truth
          ? this.execute(rest, lines, pc, {
              text: execution.text,
              offset: execution.offset + line.length - rest.length,
            })
          : {}
        : truth
          ? {}
          : { pc: this.skip(lines, pc, true) };
    }
    if (head === 'else') return { pc: this.skip(lines, pc, false) };
    if (head === 'endif') return {};
    if (head === 'break') return { action: 'return' };
    if (/^(?:\+\+|--)?[$\\]/.test(head)) {
      assign(line, this);
      return {};
    }
    const host = this.player.host;
    if (this.runtime && ['rdraw', 'rwipe', 'wbreak', 'rwmos', 'rfmos'].includes(head)) {
      this.player.enqueue(
        this.runtime.screenCommand(head, args).then((value) => {
          this.deferredCommandReturn = value;
        }),
      );
      return { action: 'flush' };
    }
    if (NATIVE_FES_SAVE_COMMANDS.includes(head) && typeof host.nativeSaveCommand === 'function') {
      this.player.enqueue(Promise.resolve(host.nativeSaveCommand(head, line, this)));
      return { action: 'flush' };
    }
    if (this.player.nativeEffects?.commands.has(head)) {
      this.player.enqueue(
        this.player.nativeEffects.commandLine(head, line, this).then((value) => {
          this.deferredCommandReturn = value;
        }),
      );
      return { action: 'flush' };
    }
    switch (head) {
      case 'next':
        this.label = this.text(args[0]);
        this.waitFrames = 0;
        this.waitMotion = false;
        this.waitSound = null;
        this.waitObjects = null;
        return { action: 'next', target: this.label };
      case 'call': {
        const target = this.text(args[0]);
        if (!this.program.blocks[target]) {
          this.player.unresolvedTargets.add(`${this.name}: missing call ${target}`);
          break;
        }
        return { action: 'call', target };
      }
      case 'wait':
        if (this.executingLabel?.includes('.')) {
          this.diagnostic('wait is not permitted in an event handler');
          return {};
        }
        if (
          args.length &&
          this.elements(args[0]).some((o) => ['SOUND', 'SNDTABLE'].includes(o.type))
        ) {
          this.waitSound = this.elements(args[0])[0].key;
          return { action: 'suspend' };
        }
        if (args.length && this.elements(args[0]).length) {
          this.waitObjects = this.elements(args[0]).map((o) => o.key);
          return this.waitObjects.some((key) => this.byKey.get(key).motionBusy)
            ? { action: 'suspend' }
            : {};
        }
        if (args.length) {
          if (this.consumeWaitSkip()) return {};
          this.waitFrames = Math.max(1, p(0));
          return { action: 'suspend' };
        }
        if (
          !args.length &&
          (this.objects.some((o) => o.motionBusy) || this.player.frameCount < this.transitionUntil)
        ) {
          this.waitMotion = true;
          return { action: 'suspend' };
        }
        return {};
      case 'decode':
        return this.player.pending.size ? { action: 'flush' } : {};
      case 'reset_frame':
        this.frameOrigin = this.player.frameCount;
        break;
      case 'randtbl': {
        const values = Array.from({ length: Math.max(0, p(3) - p(2) + 1) }, (_, i) => p(2) + i);
        for (let i = values.length - 1; i > 0; i--) {
          const j = this.player.random(0, i);
          [values[i], values[j]] = [values[j], values[i]];
        }
        if (p(1) - p(0) + 1 !== values.length) {
          this.diagnostic('randtbl requires matching source and destination range sizes');
          break;
        }
        values.forEach((v, i) => this.setGlobal(p(0) + i, v));
        break;
      }
      case 'automove': {
        const object = this.elements(args[0])[0];
        if (object && host.config?.('automove') !== 0) this.player.focusObject(this, object);
        break;
      }
      case 'react': {
        const focused = this.player.focused;
        if (focused) focused.s.event(focused.o, 'FOCUS');
        break;
      }
      case 'exit':
        this.finished = args.length ? p(0) : 0;
        return { action: 'stop' };
      case 'result':
        this.resultValue = args.length ? p(0) : 0;
        return { action: 'flush' };
      case 'execfes':
        this.player.requestFES(
          this.text(args[0]),
          this,
          Array.from({ length: 16 }, (_, i) => (args[i + 1] === undefined ? 0 : p(i + 1))),
        );
        return { action: 'flush' };
      case 'endfes':
        this.player.endFES(this);
        return { action: 'flush' };
      case 'execkcs':
        this.exitCode = -1;
        this.player.requestKCS(this.text(args[0]), this);
        return { action: 'flush' };
      case 'endkcs':
        this.exitCode = -1;
        this.player.endKCS(this);
        return { action: 'flush' };
      case 'baseimg': {
        const object = args.length ? this.elements(args[0])[0] : null;
        if (args.length && !object) return {};
        this.player.snapshotBase(this, object);
        if (this.runtime) return this.nativeCommandReturn(-3);
        return { action: 'flush' };
      }
      case 'rdraw':
      case 'rwipe':
      case 'rwmos': {
        const frames = p(0) || 20;
        this.player.transition(frames, head, args[1] ? this.text(args[1]) : undefined);
        this.transitionUntil = this.player.frameCount + frames;
        break;
      }
      case 'strvar': {
        // SDK 4.01 select.fes uses indexed string copying, rather than printf.
        if (args[0] === 'get') {
          this.player.strings[p(1)] = this.player.strings[p(2)] ?? '';
          break;
        }
        let i = 2;
        this.player.strings[p(0)] = this.text(args[1]).replace(/%%|%(0?\d*)d/g, (match, width) => {
          if (match === '%%') return '%';
          const value = p(i++),
            digits = String(Math.abs(value)),
            negative = value < 0;
          if (width.startsWith('0'))
            return `${negative ? '-' : ''}${digits.padStart(Math.max(0, Number(width) - Number(negative)), '0')}`;
          return String(value).padStart(Number(width) || 0, ' ');
        });
        break;
      }
      case 'setstbl':
        this.player.stringTable[p(0)] = this.text(args[1]);
        break;
      case 'getstbl':
        this.player.strings[p(1)] = this.player.stringTable[p(0)] ?? '';
        break;
      case 'strcmp':
        store(
          0,
          args.length > 2
            ? Number(this.text(args[1]) !== this.text(args[2]))
            : Number(!!this.text(args[1])),
        );
        break;
      case 'rand':
        store(0, this.player.random(p(1), p(2)));
        break;
      case 'fileexist':
        store(1, Number(this.player.game.has(this.text(args[0]).split('/').pop())));
        break;
      case 'config': {
        if (!args.length) break;
        const index = p(0);
        if (args.length < 2) break;
        const value = host.config?.(this.text(args[1]), 0, 0, {
          instance: this,
          legacyVolume: true,
        });
        if (value !== undefined) this.setGlobal(index, value);
        break;
      }
      case 'getconf': {
        if (args.length < 2) break;
        const value = host.config?.(this.text(args[1]), p(2), p(3), { instance: this });
        if (value !== undefined) {
          if (typeof value === 'string') this.player.strings[p(0)] = value;
          else store(0, value);
        }
        break;
      }
      case 'setconf':
        if (args.length >= 2)
          this.player.enqueue(
            host.setConfig?.(this.text(args[1]), p(0), p(2), p(3), {
              strings: this.player.strings,
              instance: this,
            }),
          );
        break;
      case 'getsndconfex': {
        if (typeof host.soundConfigTokens !== 'function')
          throw new Error('FES getsndconfex requires its native sound configuration token service');
        const tokens = host.soundConfigTokens(line).slice(1);
        if (!tokens.length) break;
        const index = this.value(this.soundArgument(tokens[0]));
        if (tokens[1] === undefined) break;
        if (typeof host.soundConfig !== 'function')
          throw new Error('FES getsndconfex requires its native sound configuration service');
        const value = host.soundConfig(tokens.slice(1), {
          instance: this,
          text: (token) => this.soundArgument(token),
          evaluate: (token) => this.value(token),
        });
        if (value !== undefined) this.setGlobal(index, value);
        break;
      }
      case 'setsndconfex': {
        if (typeof host.soundConfigTokens !== 'function')
          throw new Error('FES setsndconfex requires its native sound configuration token service');
        const tokens = host.soundConfigTokens(line).slice(1);
        if (!tokens.length) break;
        const value = this.value(this.soundArgument(tokens[0]));
        if (tokens[1] === undefined) break;
        if (typeof host.setSoundConfig !== 'function')
          throw new Error('FES setsndconfex requires its native sound configuration service');
        this.player.enqueue(
          host.setSoundConfig(tokens.slice(1), value, {
            instance: this,
            text: (token) => this.soundArgument(token),
            evaluate: (token) => this.value(token),
          }),
        );
        break;
      }
      case 'm2_getconf': {
        if (args.length < 2) break;
        const value = host.config?.(this.text(args[0]), 0, 0, {
          m2: true,
          part: args[2] === undefined ? undefined : this.text(args[2]),
          instance: this,
        });
        if (value !== undefined && p(1) >>> 0 <= 511) this.setLocal(p(1), value);
        break;
      }
      case 'm2_setconf':
        if (args.length)
          this.player.enqueue(
            host.setConfig?.(this.text(args[0]), args[1] === undefined ? undefined : p(1), 0, 0, {
              m2: true,
              part: args[2] === undefined ? undefined : this.text(args[2]),
              instance: this,
            }),
          );
        break;
      case 'saveexist': {
        const info = host.saveInfo?.(p(0));
        store(1, Number(!!info && (args.length < 3 || info.version === p(2))));
        if (args.length > 2 && info && info.version === undefined)
          this.diagnostic('saveexist version comparison requires saved data version metadata');
        break;
      }
      case 'newsave':
        store(0, host.newestSave?.(p(1), p(2)) ?? -1);
        break;
      case 'datasave':
        this.player.enqueue(host.save?.(p(0)));
        break;
      case 'savedelete':
        this.player.enqueue(host.deleteSave?.(p(0)));
        break;
      case 'savecopy':
        this.player.enqueue(host.copySave?.(p(0), p(1)));
        break;
      case 'gettime': {
        const d = new Date();
        [
          d.getFullYear(),
          d.getMonth() + 1,
          d.getDate(),
          d.getDay(),
          d.getHours(),
          d.getMinutes(),
          d.getSeconds(),
        ].forEach((v, i) => store(i, v));
        break;
      }
      case 'getweek': {
        const date = new Date(0);
        date.setUTCFullYear(p(1), p(2) - 1, p(3));
        store(0, date.getUTCDay());
        break;
      }
      case 'messagebox': {
        if (typeof host.messageBox !== 'function')
          throw new Error('FES messagebox requires its browser dialog service');
        const tokens = host.soundConfigTokens ? host.soundConfigTokens(line).slice(1) : args;
        if (tokens.length < 4)
          throw new Error('FES messagebox requires a variable, type, title and text');
        const index = this.value(this.soundArgument(tokens[0])),
          type = this.value(this.soundArgument(tokens[1])),
          text = (token) =>
            nativeArgumentDecoder
              .decode(this.argumentBytes(token))
              .split('\0', 1)[0]
              .replace(/\\_/g, ' ')
              .replace(/\\n/g, '\n');
        // FES sends the ANSI packet in both profiles. Only IDOK and IDYES
        // map to one; -1 suppresses the variable-bank write altogether.
        this.player.enqueue(
          Promise.resolve(
            host.messageBox({
              buttons: type === 1 ? 1 : type === 2 ? 4 : 0,
              caption: text(tokens[2]),
              message: text(tokens[3]),
            }),
          ).then((result) => {
            if (index !== -1) this.setGlobal(index >>> 0, Number(result === 1 || result === 6));
          }),
        );
        return { action: 'flush' };
      }
      case 'rettitle':
        if (typeof host.postWindowMessage !== 'function')
          throw new Error('FES rettitle requires the native window message host');
        this.player.enqueue(
          Promise.resolve(host.postWindowMessage({ message: 0x468, wParam: 0, lParam: 0 }, this)),
        );
        return { action: 'flush' };
      case 'send':
      case 'sendscript': {
        if (typeof host.send !== 'function')
          throw new Error(`FES ${head} message routing is unavailable`);
        this.player.enqueue(
          host.send(
            args.map((_, i) => p(i)),
            this,
            { target: head === 'send' ? 'parent' : 'script' },
          ),
        );
        return { action: 'flush' };
      }
      case 'steam_init': {
        const initialize =
          typeof host.initializeSteam === 'function'
            ? () => host.initializeSteam()
            : typeof host.steam?.initialize === 'function'
              ? () => host.steam.initialize()
              : null;
        if (!initialize) throw new Error('FES Steam initialization service is unavailable');
        this.player.enqueue(Promise.resolve(initialize()));
        return { action: 'flush' };
      }
      case 'steam_isenable': {
        const tokens =
          typeof host.soundConfigTokens === 'function' ? host.soundConfigTokens(line) : words;
        if (tokens[1] !== undefined)
          this.setGlobal(
            this.value(this.soundArgument(tokens[1])),
            Number(Boolean(host.steam?.enabled)),
          );
        break;
      }
      case 'steam_isbroadcast': {
        const tokens =
          typeof host.soundConfigTokens === 'function' ? host.soundConfigTokens(line) : words;
        if (tokens[1] === undefined) break;
        if (typeof host.nativeSteamBroadcast !== 'function')
          throw new Error('FES broadcast query requires the native application flag service');
        const index = this.value(this.soundArgument(tokens[1]));
        this.player.enqueue(
          Promise.resolve(host.nativeSteamBroadcast()).then((value) => {
            if (!Number.isInteger(value))
              throw new Error('FES native broadcast query did not return a word');
            this.setGlobal(index, value >>> 0);
          }),
        );
        return { action: 'flush' };
      }
      case 'cgreg_init': {
        if (typeof host.openGallery !== 'function')
          throw new Error('CG gallery storage is unavailable');
        this.cgGallery = null;
        const descriptor = {
          file: this.text(args[0]),
          entry: p(1),
          list: this.text(args[2]),
        };
        const { file, entry, list } = descriptor;
        this.player.enqueue(
          Promise.resolve(host.openGallery(file, entry, list)).then((gallery) => {
            this.cgGallery = gallery;
          }),
        );
        return { action: 'flush' };
      }
      case 'cgreg':
        store(0, Number(this.cgGallery?.registry.hasReference(this.text(args[1]), true) ?? false));
        break;
      case 'cgreg_t': {
        const block = /^[\\$\\\\0-9]/.test(args[1]) ? p(1) : this.text(args[1]);
        store(0, Number(this.cgGallery?.seen(block, p(2)) ?? false));
        break;
      }
      case 'cgregnum':
      case 'cgregmax': {
        const block = /^[\\$\\\\0-9]/.test(args[0]) ? p(0) : this.text(args[0]);
        store(1, this.cgGallery?.variants(block, p(2), head === 'cgregnum').length ?? 0);
        break;
      }
      case 'cgregtbl':
        store(1, this.cgGallery?.index(this.text(args[0])) ?? 0);
        break;
      case 'cgreg_getlist': {
        if (!this.cgGallery || p(0) === -1) break;
        const block = /^[$0-9]/.test(args[2]) ? p(2) : this.text(args[2]);
        this.player.strings[p(0)] = this.cgGallery.get(block, p(3), p(4));
        break;
      }
      case 'input_text':
        this.player.enqueue(
          Promise.resolve(host.inputText?.(this.text(args[1])) || '').then((v) => {
            this.player.strings[p(0)] = v;
          }),
        );
        break;
      case 'xchgcursor':
        this.player.cursorOverButton = args[0] === 'btndown';
        break;
      case 'keyskip':
        this.keySkipEnabled = true;
        this.keySkipControlOnly = false;
        this.keySkipContinuous = false;
        for (let i = 0; i < args.length; i++) {
          const option = args[i].toLowerCase();
          if (option === 'on') this.keySkipEnabled = true;
          else if (option === 'off') this.keySkipEnabled = false;
          else if (option === 'ctrl') this.keySkipControlOnly = true;
          else if (option === 'cont') this.keySkipContinuous = true;
          else if (option === 'force') {
            this.keySkipForced = args[i + 1] !== undefined ? Boolean(p(++i)) : false;
            if (this.keySkipForced) this.clickL = -1;
          } else this.keySkipEnabled = Boolean(p(i));
        }
        break;
      case 'dbgstr':
      case 'dbgstru8':
      case 'debug':
        this.player.debugLog({
          kind: head,
          value: head === 'debug' ? p(0) : this.text(args[0] || ''),
          expression: args[0] || '',
          file: this.name,
          label: this.executingLabel || this.label,
          line: this.executingLine || 0,
        });
        break;
      case 'basebtnpri':
        if (!this.player.nativeInput)
          throw new Error('FES basebtnpri requires the native input task adapter');
        this.player.enqueue(this.player.nativeInput.priority(args.length ? p(0) : -1));
        return { action: 'flush' };
      case 'deletebgbutton':
        if (!this.player.nativeInput)
          throw new Error('FES deletebgbutton requires the native input task adapter');
        this.player.enqueue(this.player.nativeInput.deleteLowButton());
        return { action: 'flush' };
      case 'sendbtn':
        this.inputPropagation = args.length ? p(0) : 1;
        break;
      case 'force_redraw':
        this.forceRedrawPending = true;
        break;
      case 'wndmenu':
        if (args.length) {
          const parameter =
            typeof host.soundConfigTokens === 'function'
              ? host.soundConfigTokens(line)[1]
              : args[0];
          if (typeof this.player.host.postWindowMessage !== 'function')
            throw new Error('FES wndmenu requires the native window message host');
          this.player.enqueue(
            Promise.resolve(
              this.player.host.postWindowMessage(
                {
                  message: 0x46c,
                  wParam: 0,
                  lParam: this.value(this.soundArgument(parameter)) >>> 0,
                },
                this,
              ),
            ),
          );
          return { action: 'flush' };
        }
        break;
      case 'steam_achievement': {
        const tokens =
          typeof host.soundConfigTokens === 'function' ? host.soundConfigTokens(line) : words;
        if (
          tokens[1] !== undefined &&
          this.player.host.steam !== null &&
          this.player.host.steam !== undefined
        ) {
          if (typeof this.player.host.steam.achievement !== 'function')
            throw new Error('FES Steam provider has no achievement operation');
          this.player.enqueue(
            Promise.resolve(this.player.host.steam.achievement(this.argumentBytes(tokens[1]))),
          );
          return { action: 'flush' };
        }
        break;
      }
      case 'steam_achievement_reset':
        if (host.steam !== null && host.steam !== undefined) {
          if (typeof host.steam.resetAllStats !== 'function')
            throw new Error('FES Steam provider has no stats reset operation');
          this.player.enqueue(Promise.resolve(host.steam.resetAllStats()));
          return { action: 'flush' };
        }
        break;
      case 'steam_enablescreenshot': {
        const tokens =
          typeof host.soundConfigTokens === 'function' ? host.soundConfigTokens(line) : words;
        if (this.player.host.steam !== null && this.player.host.steam !== undefined) {
          if (typeof this.player.host.steam.enableScreenshot !== 'function')
            throw new Error('FES Steam provider has no screenshot operation');
          this.player.enqueue(
            Promise.resolve(
              this.player.host.steam.enableScreenshot(
                tokens[1] !== undefined ? this.value(this.soundArgument(tokens[1])) : 1,
              ),
            ),
          );
          return { action: 'flush' };
        }
        break;
      }
      case 'saveapend_str':
        this.diagnostic(`unimplemented FES command ${head}`);
        break;
      default: {
        if (this.runtime) {
          const selection = this.runtime.reference(head);
          const source = this.program.sourceKey
            ? (this.player.nativeSources || this.player.localSources).context(
                this.program.sourceKey,
                this.executingLabel || this.label,
                (this.executingLine || pc) - 1,
                { ...execution, name: selection.name },
              )
            : {};
          this.player.enqueue(
            this.runtime
              .command(args[0], selection, args.slice(1), {
                ...source,
                rawTail: fesRawTail(line, 2),
              })
              .then((value) => {
                this.deferredCommandReturn = value;
              }),
          );
          return { action: 'flush' };
        }
        const objects = this.elements(head);
        if (!objects.length) {
          if (
            this.player.nativeObjectAllocates &&
            Object.hasOwn(this.declaredGroups, head.replace(/\[.*$/, ''))
          )
            return {};
          if (objectVerbs.has(args[0])) this.player.unresolvedTargets.add(`${this.name}: ${line}`);
          else this.diagnostic(`unsupported command ${line}`);
        }
        const source = this.program.sourceKey
          ? (this.player.nativeSources || this.player.localSources).context(
              this.program.sourceKey,
              this.executingLabel || this.label,
              (this.executingLine || pc) - 1,
              { ...execution, name: objects[0]?.baseName || head },
            )
          : {};
        const selectedIndex = this.selectionIndex(head),
          groupCount = objects.length
            ? this.objects.filter((o) => o.baseName === objects[0].baseName).length
            : 0,
          index = groupCount === 1 ? 0 : selectedIndex;
        const results = objects.map((o) =>
          objectCommand(this, o, args[0], args.slice(1), {
            ...source,
            index,
            rawTail: fesRawTail(line, 2),
          }),
        );
        if (results.some((result) => result && typeof result.then === 'function')) {
          this.player.enqueue(
            Promise.all(results).then((values) => {
              const reply = values.find((value) => value && Object.hasOwn(value, 'nativeReturn'));
              this.deferredCommandReturn = reply?.nativeReturn ?? null;
            }),
          );
          return { action: 'flush' };
        }
        const reply = results.find((value) => value && Object.hasOwn(value, 'nativeReturn'));
        if (reply) return this.nativeCommandReturn(reply.nativeReturn);
      }
    }
    return {};
  }
  soundArgument(a) {
    if (typeof this.player.host.nativeFESArgumentBytes === 'function')
      return nativeArgumentDecoder.decode(this.argumentBytes(a));
    return expandNativeFESSoundConfigurationToken(a, {
      string: (index) => this.player.strings[index],
      replace: (value) => {
        if (typeof this.player.host.nativeScriptReplace === 'function') {
          const result = this.player.host.nativeScriptReplace(value, this);
          if (typeof result !== 'string')
            throw new Error('FES SCRIPT replacement must return text synchronously');
          return result;
        }
        return value
          .replace(/%LANG_M%/g, this.player.languageMain || this.player.language)
          .replace(/%LANG%/g, this.player.language);
      },
    });
  }
  argumentBytes(a) {
    if (typeof this.player.host.nativeFESArgumentBytes === 'function') {
      const result = this.player.host.nativeFESArgumentBytes(a, this);
      if (!(result instanceof Uint8Array))
        throw new Error('FES native argument service must return bytes synchronously');
      return result;
    }
    return encodeCP932(this.soundArgument(a));
  }
}
