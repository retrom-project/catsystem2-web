// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESInstance (OWCramer).
import { evaluate, assign, condition } from './expression.mjs';
import { FESObject, objectCommand, objectVerbs } from './object.mjs';

export class FESInstance {
  constructor(name, program, player, parent = null) {
    Object.assign(this, {
      name,
      program,
      player,
      parent,
      child: null,
      objects: [],
      locals: {},
      label: 'START',
      exitCode: -1,
      finished: null,
      suspended: null,
      waitFrames: 0,
      waitMotion: false,
      waitSound: null,
      transitionUntil: 0,
      eventObject: null,
      clickL: 0,
      clickR: 0,
      scrollUp: 0,
      scrollDown: 0,
      generation: 0,
    });
    this.byKey = new Map();
    this.keyNames = new Set();
    for (const d of program.definitions) {
      if (d.count === null) this.add(d.type, d.name, null);
      else {
        if (d.count > 10000) throw new Error('FES object limit');
        for (let i = 0; i < d.count; i++) this.add(d.type, d.name, i);
      }
    }
    for (const table of program.tables)
      for (const [target, values] of table.rows) {
        if (table.columns.includes('KEYBLOCK')) {
          this.keyNames.add(target.split('[')[0]);
          continue;
        }
        let found = this.elements(target);
        if (!found.length) {
          const m = /^(\w+)(?:\[(\d+)\])?$/.exec(target);
          if (!m) throw new Error(`Invalid FES object target ${target}`);
          found = [this.add('IMAGE', m[1], m[2] === undefined ? null : +m[2])];
        }
        for (const o of found) this.apply(o, table.columns, values);
      }
  }
  add(type, name, index) {
    const o = new FESObject(type, name, index, 0x1001 + this.objects.length);
    this.objects.push(o);
    this.byKey.set(o.key, o);
    return o;
  }
  elements(name) {
    if (name === '@') return this.eventObject ? [this.eventObject] : [];
    if (this.byKey.has(name)) return [this.byKey.get(name)];
    const match = /^(\w+)\[(.*)\]$/.exec(name);
    if (match)
      return this.byKey.has(`${match[1]}[${this.value(match[2])}]`)
        ? [this.byKey.get(`${match[1]}[${this.value(match[2])}]`)]
        : [];
    return this.objects.filter((o) => o.baseName === name);
  }
  global(n) {
    return this.player.globals[n] || 0;
  }
  setGlobal(n, v) {
    this.player.globals[n] = v | 0;
  }
  local(n) {
    return this.locals[n] || 0;
  }
  setLocal(n, v) {
    this.locals[n] = v | 0;
  }
  macro(name) {
    return this.program.macros[name];
  }
  objectHandle(name, index) {
    return this.byKey.get(index === undefined ? name : `${name}[${index}]`)?.handle;
  }
  system(name) {
    return {
      _EXITCODE_: this.exitCode,
      _CLICK_L_: this.clickL,
      _CLICK_R_: this.clickR,
      _SCRL_U_: this.scrollUp,
      _SCRL_D_: this.scrollDown,
      _PAGE_U_: this.scrollUp,
      _PAGE_D_: this.scrollDown,
      _FRAME_: this.player.frameCount,
      _MOUSE_X_: this.player.mouse.x,
      _MOUSE_Y_: this.player.mouse.y,
      '@': this.eventObject?.index || 0,
    }[name];
  }
  value(text) {
    return evaluate(text.replace(/%$/, ''), this);
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
  apply(o, columns, values) {
    for (let i = 0; i < Math.min(columns.length, values.length); i++) {
      const column = columns[i],
        value = values[i],
        pair =
          /^(POS|SIZE|POS2|SIZE2)$/.test(column) && !value.includes(':')
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
          o.width = pair[0] || 0;
          o.height = pair[1] || 0;
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
          o.pri = Number(value);
          break;
        case 'DISP':
          o.disp = value !== '0';
          break;
        case 'ENABLE':
          o.enable = value !== '0';
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
          o.color = parseInt(value.replace(/^0x/, ''), 16) >>> 0;
          break;
        case 'IDN':
          o.idIndex = Math.max(0, Number(value));
          break;
        default:
          if (/^ID\.\d+$/.test(column)) o.ids[+column.slice(3)] = Number(value);
      }
    }
  }
  plane(o) {
    return this.byKey.get(o.plane || o.parent) || this.byKey.get(`${o.plane || o.parent}[0]`);
  }
  placement(o) {
    let x = o.x,
      y = o.y,
      alpha = o.alpha,
      shown = true,
      p = this.plane(o),
      depth = 0;
    while (p) {
      if (++depth > 16) throw new Error('FES plane cycle');
      x += p.x;
      y += p.y;
      alpha *= p.alpha / 255;
      shown &&= p.disp;
      p = this.plane(p);
    }
    return { x, y, alpha, shown };
  }
  rect(o) {
    const at = this.placement(o),
      f = this.player.picture(o.file)?.frame(o.currentID) || this.player.picture(o.file)?.frames[0];
    if (['SLIDER', 'SCROLL2'].includes(o.type))
      return { x: at.x, y: at.y, w: o.areaWidth, h: o.areaHeight };
    if (o.width > 0 && o.height > 0) return { x: at.x, y: at.y, w: o.width, h: o.height };
    return f ? { x: at.x + f.offsetX, y: at.y + f.offsetY, w: f.width, h: f.height } : null;
  }
  tick() {
    if (this.finished !== null) return;
    if (this.waitFrames > 0 && --this.waitFrames > 0) return;
    if (this.waitSound && this.player.host.soundBusy?.(this.waitSound)) return;
    this.waitSound = null;
    if (
      this.waitMotion &&
      (this.objects.some((o) => o.motions.length) || this.player.frameCount < this.transitionUntil)
    )
      return;
    this.waitMotion = false;
    const stack = this.suspended || [[this.label, 0]];
    this.suspended = null;
    this.run(stack);
  }
  event(o, event) {
    if (!this.program.blocks[`${o.baseName}.${event}`] || this.finished !== null) return;
    const saved = this.suspended,
      current = this.eventObject;
    this.suspended = null;
    this.eventObject = o;
    const jumped = this.run([[`${o.baseName}.${event}`, 0]]);
    this.eventObject = current;
    if (!jumped && !this.suspended) this.suspended = saved;
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
        const result = this.execute(lines[pc++], lines, pc);
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
        if (result.action === 'suspend') {
          stack.push([label, pc]);
          this.suspended = stack;
          return jumped;
        }
      }
    }
    return jumped;
  }
  skip(lines, pc, stopAtElse) {
    let depth = 0;
    for (; pc < lines.length; pc++) {
      const line = lines[pc];
      if (/^if\s*\(/.test(line) && !condition(line)[1]) depth++;
      else if (line === 'endif') {
        if (!depth) return pc + 1;
        depth--;
      } else if (line === 'else' && !depth && stopAtElse) return pc + 1;
    }
    return pc;
  }
  execute(line, lines, pc) {
    const words = line.split(/\s+/),
      head = words[0],
      args = words.slice(1),
      p = (i) => this.value(args[i] || '0');
    const store = (i, v) => {
      if (args[i] !== undefined) this.setGlobal(Number(args[i]), v);
    };
    if (/^if\s*\(/.test(line)) {
      const [expr, rest] = condition(line),
        truth = this.value(expr) !== 0;
      return rest
        ? truth
          ? this.execute(rest, lines, pc)
          : {}
        : truth
          ? {}
          : { pc: this.skip(lines, pc, true) };
    }
    if (head === 'else') return { pc: this.skip(lines, pc, false) };
    if (head === 'endif') return {};
    if (head === 'break') return { action: 'return' };
    if (/^[$\\]/.test(head)) {
      assign(line, this);
      return {};
    }
    const host = this.player.host;
    switch (head) {
      case 'next':
        this.label = this.text(args[0]);
        this.waitFrames = 0;
        this.waitMotion = false;
        this.waitSound = null;
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
        if (
          args.length &&
          this.elements(args[0]).some((o) => ['SOUND', 'SNDTABLE'].includes(o.type))
        ) {
          this.waitSound = this.elements(args[0])[0].key;
          return { action: 'suspend' };
        }
        if (args.length && /^[\d$\\(]/.test(args[0]) && p(0) > 0) {
          this.waitFrames = p(0);
          return { action: 'suspend' };
        }
        if (
          !args.length &&
          (this.objects.some((o) => o.motions.length) ||
            this.player.frameCount < this.transitionUntil)
        ) {
          this.waitMotion = true;
          return { action: 'suspend' };
        }
        return {};
      case 'exit':
        this.finished = args.length ? p(0) : 0;
        if (this.parent) {
          this.parent.exitCode = this.finished;
          this.parent.child = null;
        }
        return { action: 'stop' };
      case 'execfes':
        this.startChild(this.text(args[0]));
        break;
      case 'endfes':
        this.child = null;
        this.generation++;
        break;
      case 'execkcs':
        if (this.text(args[0]) === 'call_config') this.startChild('config');
        else {
          this.exitCode = -1;
          this.player.requestKCS(this.text(args[0]), this);
        }
        break;
      case 'endkcs':
        this.player.endKCS?.();
        break;
      case 'baseimg':
        this.player.snapshotBase();
        break;
      case 'rdraw':
      case 'rwipe':
      case 'rwmos': {
        const frames = p(0) || 20;
        this.player.transition(frames, head, args[1] ? this.text(args[1]) : undefined);
        this.transitionUntil = this.player.frameCount + frames;
        break;
      }
      case 'strvar': {
        let i = 2;
        this.player.strings[Number(args[0])] = this.text(args[1]).replace(
          /%(0?\d*)d/g,
          (_, width) =>
            String(p(i++)).padStart(Number(width) || 0, width.startsWith('0') ? '0' : ' '),
        );
        break;
      }
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
      case 'getconf':
        store(0, host.config?.(args[1]) || 0);
        break;
      case 'setconf':
        host.setConfig?.(args[1], p(0));
        break;
      case 'getsndconfex':
        store(0, host.soundConfig?.(args.slice(1).map((a) => this.soundArgument(a))) ?? 100);
        break;
      case 'setsndconfex':
        host.setSoundConfig?.(
          args.slice(1).map((a) => this.soundArgument(a)),
          p(0),
        );
        break;
      case 'm2_getconf':
        this.setLocal(Number(args[1]), host.config?.(`m2_${args[0]}_${args[2]}`) || 0);
        break;
      case 'm2_setconf':
        host.setConfig?.(`m2_${args[0]}_${args[2]}`, p(1));
        break;
      case 'saveexist':
        store(1, host.saveInfo?.(p(0)) ? 1 : 0);
        if (p(0) >= 400) this.setGlobal(880 + (p(0) % 8), p(0));
        break;
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
      case 'rettitle':
        host.returnToTitle?.();
        return { action: 'stop' };
      case 'send': {
        if (p(0) >>> 0 === 0xffff0003) this.player.enqueue(host.systemAction?.(p(2), this));
        else if (p(0) >>> 0 === 0xfffe0002) store(2, host.log?.[p(1)]?.nameID ?? -1);
        else if (p(0) >>> 0 === 0xfffe0000)
          host.playLogVoice?.(this.objects.find((o) => o.type === 'LOGSTRING8')?.lineInfo);
        else if (host.send)
          this.player.enqueue(
            host.send(
              args.map((_, i) => p(i)),
              this,
            ),
          );
        else this.player.unsupported(`FES send ${(p(0) >>> 0).toString(16)}`);
        break;
      }
      case 'steam_isenable':
      case 'steam_isbroadcast':
        store(0, 0);
        break;
      case 'cgreg_t':
        store(0, 0);
        this.player.unsupported(`${this.name}: CG gallery registration query`);
        break;
      case 'cgreg_init':
        this.player.unsupported(`${this.name}: CG gallery initialization`);
        break;
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
      case 'dbgstr':
      case 'dbgstru8':
      case 'debug':
      case 'steam_enablescreenshot':
      case 'steam_achievement':
      case 'wndmenu':
      case 'deletebgbutton':
      case 'automove':
      case 'react':
      case 'saveapend_str':
      case 'basebtnpri':
      case 'sendbtn':
      case 'force_redraw':
      case 'decode':
        this.player.note(`FES host hint ${head}`);
        break;
      default: {
        const objects = this.elements(head);
        if (!objects.length) {
          if (objectVerbs.has(args[0])) this.player.unresolvedTargets.add(`${this.name}: ${line}`);
          else this.player.unsupported(`${this.name}: ${line}`);
        }
        for (const o of objects) objectCommand(this, o, args[0], args.slice(1));
      }
    }
    return {};
  }
  soundArgument(a) {
    return /^[\d$\\(]/.test(a) ? String(this.value(a)) : a;
  }
  startChild(name) {
    const token = ++this.generation;
    this.child = null;
    this.exitCode = -1;
    this.player.enqueue(
      this.player.load(name, this).then((child) => {
        if (token === this.generation) this.child = child;
      }),
    );
  }
}
