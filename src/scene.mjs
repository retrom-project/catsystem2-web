// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit ScenePlayer (OWCramer).
import { readScene, readTranslation } from './formats/scene.mjs';
import { evaluate, assign, condition } from './fes/expression.mjs';
import { Stage, planeNumbers } from './stage.mjs';

// Keep formatting instructions separate from text. The message window owns its
// default font/size/color; relative changes must not assume a fixed pixel size.
export function parseMessage(source) {
  const runs = [],
    unknown = [];
  let buffer = '',
    at = 0;
  const flush = () => {
    if (buffer) runs.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  while (at < source.length) {
    if (source[at] !== '\\') {
      buffer += source[at++];
      continue;
    }
    const rest = source.slice(at);
    let match;
    if (rest.startsWith('\\\\')) {
      buffer += '\\';
      at += 2;
    } else if (/^\\n/i.test(rest)) {
      buffer += '\n';
      at += 2;
    } else if (rest.startsWith('\\_')) {
      buffer += ' ';
      at += 2;
    } else if (rest.startsWith('\\@')) {
      flush();
      runs.push({ kind: 'continue' });
      at += 2;
    } else if ((match = /^\\c([rs]?)(?:0x([a-f\d]{8});)?/i.exec(rest))) {
      flush();
      runs.push({
        kind: 'style',
        property: { '': 'color', r: 'rubyColor', s: 'shadowColor' }[match[1].toLowerCase()],
        operation: match[2] ? 'set' : 'reset',
        value: match[2] ? parseInt(match[2], 16) >>> 0 : null,
      });
      at += match[0].length;
    } else if ((match = /^\\fr(\d+);/i.exec(rest))) {
      flush();
      runs.push({ kind: 'style', property: 'rubySize', operation: 'set', value: Number(match[1]) });
      at += match[0].length;
    } else if ((match = /^\\f([+-]?\d+);/i.exec(rest))) {
      flush();
      runs.push({
        kind: 'style',
        property: 'size',
        operation: /^[+-]/.test(match[1]) ? 'relative' : 'set',
        value: Number(match[1]),
      });
      at += match[0].length;
    } else if ((match = /^\\f(ss|ll|s|n|l)/i.exec(rest))) {
      flush();
      runs.push({
        kind: 'style',
        property: 'size',
        operation: 'keyword',
        value: match[1].toLowerCase(),
      });
      at += match[0].length;
    } else if ((match = /^\\p([lcr])/i.exec(rest))) {
      flush();
      runs.push({
        kind: 'align',
        value: { l: 'left', c: 'center', r: 'right' }[match[1].toLowerCase()],
      });
      at += match[0].length;
    } else if ((match = /^\\w(f?)(\d+);/i.exec(rest))) {
      flush();
      runs.push({
        kind: 'wait',
        unit: match[1] ? 'frames' : 'characters',
        value: Number(match[2]),
      });
      at += match[0].length;
    } else if (/^\\wr/i.test(rest)) {
      flush();
      runs.push({ kind: 'wait-reset' });
      at += 3;
    } else {
      unknown.push(rest.slice(0, 2));
      buffer += source[at++];
    }
  }
  flush();
  return {
    text: runs
      .filter((r) => r.kind === 'text')
      .map((r) => r.text)
      .join(''),
    runs,
    unknown,
  };
}

export function cleanText(text) {
  return parseMessage(text).text.trim();
}

function commandWords(source) {
  const words = [];
  let start = 0,
    depth = 0;
  for (let i = 0; i <= source.length; i++) {
    if (source[i] === '(' || source[i] === '[') depth++;
    if (source[i] === ')' || source[i] === ']') depth--;
    if (depth < 0) throw new Error(`Unbalanced scene parameters: ${source}`);
    if (i === source.length || (!depth && /\s/.test(source[i]))) {
      if (i > start) words.push(source.slice(start, i));
      start = i + 1;
    }
  }
  if (depth) throw new Error(`Unbalanced scene parameters: ${source}`);
  return words;
}
export class ScenePlayer {
  constructor(game, host = {}, globals = {}, strings = {}) {
    Object.assign(this, {
      game,
      host,
      globals,
      strings,
      language: 'en',
      stack: [],
      scripts: new Map(),
      currentMessage: null,
      speaker: null,
      text: '',
      pendingVoice: null,
      pendingVoices: [],
      awaitingInput: false,
      waiting: null,
      finished: false,
      view: true,
      windowVisible: true,
      title: '',
      bgm: null,
      sounds: {},
      voice: null,
      trace: [],
      unsupported: new Set(),
      log: [],
      messageStart: 0,
      sequence: 0,
      keySkip: true,
      messageVisible: true,
      replayMode: false,
      replayFlagBase: 0,
      selectionSequence: 0,
      forcedAuto: null,
      forcedMessageHidden: false,
      autoFace: false,
    });
    this.stage = new Stage(game.width, game.height, (text) => this.value(text));
  }
  global(n) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid scene variable index ${n}`);
    return this.globals[n] || 0;
  }
  setGlobal(n, v) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid scene variable index ${n}`);
    this.globals[n] = v | 0;
  }
  local() {
    throw new Error('CST has no FES local variable domain');
  }
  setLocal() {
    throw new Error('CST has no FES local variable domain');
  }
  value(text) {
    // $ is a hexadecimal prefix in CST, but a global variable prefix in FES.
    return evaluate(text.replace(/\$([\da-f]+)\b/gi, '0x$1'), this);
  }
  expand(text = '') {
    return text.replace(/\$str(\d+)/gi, (_, n) => this.strings[n] ?? '');
  }
  diagnostic(command, detail = '') {
    const frame = this.stack.at(-1);
    const message = `${frame?.name || '<scene>'}:${frame?.line || 0}: ${command}${detail ? `: ${detail}` : ''}`;
    this.unsupported.add(message);
    this.host.unsupported?.(message);
  }
  async service(name, ...parameters) {
    if (typeof this.host[name] !== 'function') {
      this.diagnostic(name, 'host service is not implemented');
      return undefined;
    }
    return this.host[name](...parameters);
  }
  async script(name) {
    name = name.toLowerCase().replace(/\.cst$/, '');
    if (!this.scripts.has(name)) {
      const script = await readScene(await this.game.require(`${name}.cst`)),
        translation = await this.game.read(`${name}.cstl`);
      this.scripts.set(name, {
        ...script,
        translation: translation ? readTranslation(translation) : null,
      });
    }
    return this.scripts.get(name);
  }
  async enter(name) {
    name = name.toLowerCase().replace(/\.cst$/, '');
    await this.script(name);
    if (this.stack.length > 64) throw new Error('Scene call stack exceeded');
    this.stack.push({ name, line: 0, messageIndex: 0, messageLine: null });
  }
  async start(name) {
    this.stack = [];
    this.finished = false;
    this.waiting = null;
    await this.enter(name);
  }
  closeMessage(frame, continues = false) {
    if (!this.text) {
      this.speaker = null;
      return false;
    }
    const script = this.scripts.get(frame.name),
      translated = script.translation?.[this.language]?.[frame.messageIndex];
    const sourceLine = frame.messageLine ?? frame.line - 1;
    const block = script.blocks.findIndex(
      ([start, count]) => sourceLine >= start && sourceLine < start + count,
    );
    const parsed = parseMessage(this.expand(translated?.text ?? this.text));
    const message = {
      scene: frame.name,
      index: frame.messageIndex++,
      sequence: this.sequence++,
      speaker: translated?.speaker || this.speaker,
      originalSpeaker: this.speaker,
      text: parsed.text.trim(),
      original: this.expand(this.text),
      voice: this.pendingVoice,
      voices: [...this.pendingVoices],
      continues,
      line: sourceLine,
      endLine: frame.line - 1,
      block,
      visible: this.messageVisible,
      runs: parsed.runs,
    };
    this.currentMessage = message;
    this.pendingVoice = null;
    this.pendingVoices = [];
    this.speaker = null;
    this.text = '';
    frame.messageLine = null;
    this.messageStart = this.stage.frame;
    this.log.push({ ...message });
    if (parsed.unknown.length)
      this.diagnostic('message escapes', [...new Set(parsed.unknown)].join(', '));
    if (!this.windowVisible && this.view && !this.forcedMessageHidden) {
      this.windowVisible = true;
      this.host.showWindow?.(true, 0);
    }
    this.host.message?.(message);
    return true;
  }
  async tick() {
    if (this.finished) return;
    if (this.waiting) {
      const w = this.waiting;
      if (w.kind === 'input') {
        if (!this.forcedAuto || this.stage.frame < w.autoDue) return;
      }
      if (w.kind === 'selection') return;
      if (w.kind === 'frames' && this.stage.frame < w.due) return;
      if (w.kind === 'motions' && (this.stage.busy(w.group) || this.host.actorBusy?.(w.group)))
        return;
      if (w.kind === 'tag' && !this.host.tagReady?.(w)) return;
      if (w.kind === 'modal' && this.host.modalActive?.()) return;
      if (w.kind === 'movie' && this.host.movieActive?.()) return;
      if (w.kind === 'sound' && this.host.soundBusy?.(w.channel, w.bank)) return;
      if (w.kind === 'particle' && this.host.particleBusy?.(w.bank)) return;
      this.waiting = null;
    }
    let budget = 20000;
    while (!this.waiting && this.stack.length) {
      if (--budget <= 0) throw new Error('Scene instruction budget');
      const frame = this.stack.at(-1),
        script = this.scripts.get(frame.name);
      if (frame.line >= script.lines.length) {
        this.stack.pop();
        continue;
      }
      const line = script.lines[frame.line++];
      if (line.kind === 0x21) this.speaker = this.expand(line.text);
      else if (line.kind === 0x20) {
        frame.messageLine ??= frame.line - 1;
        this.text += line.text;
        if (line.text.endsWith('\\@')) {
          this.closeMessage(frame, true);
          this.awaitingInput = true;
        }
      } else if (line.kind === 2 || line.kind === 3) {
        if (this.awaitingInput && !cleanText(this.text)) {
          this.awaitingInput = false;
          this.speaker = null;
          this.text = '';
          this.waitForInput();
        } else if (this.closeMessage(frame)) {
          this.awaitingInput = false;
          this.waitForInput();
        }
      } else if (line.kind === 0x30) await this.command(line.text);
      else this.diagnostic(`unknown CatScene line kind ${line.kind}`);
    }
    if (!this.stack.length && !this.waiting) {
      this.finished = true;
      this.host.end?.();
    }
  }
  advance() {
    if (this.waiting?.kind === 'input') {
      if (!this.forcedAuto || this.forcedAuto.key) this.waiting = null;
    } else if (this.keySkip && ['motions', 'frames', 'tag'].includes(this.waiting?.kind)) {
      this.stage.finish();
      this.host.finishMotions?.();
      this.waiting = null;
    }
  }
  waitForInput() {
    const autoDue = this.forcedAuto
      ? this.stage.frame +
        Math.ceil(
          this.forcedAuto.base * 6 +
            (this.currentMessage?.text.length || 0) * this.forcedAuto.char * 0.6,
        )
      : undefined;
    this.waiting = { kind: 'input', autoDue };
  }
  async choose(index, sequence = this.waiting?.sequence) {
    const selection = this.waiting;
    if (selection?.kind !== 'selection' || selection.sequence !== sequence)
      throw new Error('No matching scene selection');
    if (!Number.isInteger(index) || !selection.choices[index]?.enabled)
      throw new Error(`Invalid or disabled selection row ${index}`);
    const choice = selection.choices[index];
    if (selection.flag !== null) this.setGlobal(selection.flag, choice.id);
    this.waiting = null;
    this.stack.pop();
    await this.enter(choice.target);
    await this.service('selectionClosed', { ...selection, selected: index });
  }
  async selection(mode, args) {
    const frame = this.stack.at(-1),
      script = this.scripts.get(frame.name),
      choices = [];
    while (frame.line < script.lines.length) {
      const row = script.lines[frame.line];
      if (row.kind !== 0x30) break;
      const match = /^(-?\d+)\s+(\S+)(?:\s+([\s\S]*))?$/.exec(row.text.trim());
      if (!match) break;
      frame.line++;
      const disabled = mode === 'select' && /^[012]$/.test(match[2]);
      choices.push({
        id: Number(match[1]),
        target: this.expand(match[2]),
        text: this.expand(match[3] || ''),
        enabled: !disabled,
        disabledStyle: disabled ? Number(match[2]) : null,
      });
    }
    if (!choices.length) throw new Error(`${mode} has no choice rows`);
    const selection = {
      kind: 'selection',
      mode,
      sequence: ++this.selectionSequence,
      script: mode === 'fselect' ? args[0] || 'select' : null,
      file: mode === 'select2' ? args[0] : null,
      plane: mode === 'select2' ? this.value(args[1]) : null,
      flag: mode === 'select2' && args[2] !== undefined ? this.value(args[2]) : null,
      choices,
    };
    this.waiting = selection;
    await this.service('undoPoint', { reason: 'selection', selection: structuredClone(selection) });
    const selected = await this.service('selection', structuredClone(selection));
    if (Number.isInteger(selected)) await this.choose(selected, selection.sequence);
  }
  async soundCommand(group, args) {
    const parameters = [...args];
    const banks = /^(?:\d+|\[.*\])$/.test(parameters[0] || '')
      ? planeNumbers(parameters.shift())
      : null;
    const controls = new Set([
      'loop',
      'pause',
      'replay',
      'end',
      'vol',
      'fade',
      'base',
      'pos',
      'rot',
      'move',
      'arc',
      'quake',
      'shake',
      'mrot',
    ]);
    const verb = !parameters.length
      ? 'init'
      : controls.has(parameters[0])
        ? parameters.shift()
        : 'play';
    const request = { group, banks, verb, args: parameters };
    const reply = await this.service('soundCommand', request);
    if (reply?.handled !== true) {
      this.diagnostic(`${group} ${verb}`, 'sound command has no successful host acknowledgement');
      return;
    }
    if (verb === 'play' || verb === 'loop') {
      if (group === 'bgm') this.bgm = parameters[0] || null;
      if (group === 'pcm') {
        this.voice = parameters[0] || null;
        this.pendingVoice = this.voice;
        if (this.voice) this.pendingVoices.push(this.voice);
      }
    }
    for (const sound of reply.banks || []) {
      if (group === 'se') {
        if (sound.file) this.sounds[sound.bank] = structuredClone(sound);
        else delete this.sounds[sound.bank];
      }
    }
  }
  async command(source) {
    let line = this.expand(source.trim());
    while (/^if\s*\(/.test(line)) {
      const [expr, rest] = condition(line);
      if (!this.value(expr)) return;
      line = rest;
    }
    if (!line) return;
    if (line.startsWith('(') && !condition(line)[1]) line = condition(line)[0].trim();
    if (/^(?:\+\+|--)?[#\\]/.test(line)) {
      assign(line.replace(/\$([\da-f]+)\b/gi, '0x$1'), this);
      return;
    }
    const [verb, ...rawArgs] = commandWords(line),
      stringArguments = {
        str: [1],
        strcmp: [1, 2],
        next: [0],
        call: [0],
        scene: [0],
        scenetitle: [0],
        fes: [0],
        fesjs: [0],
      },
      args = rawArgs.map((a, i) =>
        !stringArguments[verb]?.includes(i) && /^(?:#|\()/.test(a) && !/^#[^#]+#/.test(a)
          ? String(this.value(a))
          : a,
      ),
      number = (i, fallback = 0) => (args[i] === undefined ? fallback : this.value(args[i]));
    this.trace.push({
      scene: this.stack.at(-1)?.name,
      line: this.stack.at(-1)?.line,
      command: line,
    });
    if (this.trace.length > 256) this.trace.shift();
    switch (verb) {
      case 'next':
        this.stack.pop();
        await this.enter(args[0]);
        break;
      case 'call':
        await this.enter(args[0]);
        break;
      case 'return':
        this.stack.pop();
        break;
      case 'select':
      case 'select2':
      case 'fselect':
        await this.selection(verb, args);
        break;
      case 'str':
        this.strings[number(0)] = args.slice(1).join(' ');
        break;
      case 'strn':
        this.strings[number(0)] = String(number(1));
        break;
      case 'strcmp': {
        const sensitive = number(3) !== 0,
          left = sensitive ? args[1] : args[1].toLowerCase(),
          right = sensitive ? args[2] : args[2].toLowerCase();
        this.setGlobal(number(0), Number(left !== right));
        break;
      }
      case 'max':
      case 'min': {
        const values = args.slice(1).map((a) => this.value(a));
        if (!values.length) throw new Error(`${verb} requires values`);
        const best = (verb === 'max' ? Math.max : Math.min)(...values);
        this.setGlobal(number(0), values.indexOf(best));
        break;
      }
      case 'getfbit': {
        const bit = number(2);
        if (bit < 0 || bit > 31) throw new Error(`Invalid scene bit ${bit}`);
        this.setGlobal(number(0), (number(1) >>> bit) & 1);
        break;
      }
      case 'setfbit':
      case 'clearfbit': {
        const index = number(0);
        let value = this.global(index);
        for (const token of args.slice(1)) {
          const bit = this.value(token);
          if (bit < 0 || bit > 31) throw new Error(`Invalid scene bit ${bit}`);
          value = verb === 'setfbit' ? value | (1 << bit) : value & ~(1 << bit);
        }
        this.setGlobal(index, value);
        break;
      }
      case 'week': {
        const date = new Date(0);
        date.setUTCFullYear(number(1), number(2) - 1, number(3));
        this.setGlobal(number(0), date.getUTCDay());
        break;
      }
      case 'keyskip':
        this.keySkip = args[0] !== 'off' && args[0] !== '0';
        break;
      case 'skipstop':
        await this.service('skipStop');
        break;
      case 'jumpstop':
        await this.service('jumpStop');
        break;
      case 'auto':
        this.forcedAuto =
          args[0] === 'on'
            ? {
                base: number(1, 15),
                char: number(2, 5),
                scrl: number(3, -1),
                key: number(4) !== 0,
              }
            : null;
        await this.service('automaticMode', this.forcedAuto);
        break;
      case 'undo':
        await this.service('undoPoint', { reason: 'command' });
        break;
      case 'title':
        this.stack = [];
        this.finished = true;
        this.host.returnToTitle?.();
        break;
      case 'bg':
      case 'cg':
      case 'eg':
      case 'fg':
      case 'fw':
        await this.stage.pictures(verb, args);
        break;
      case 'pl':
        await this.stage.planeCommand(args);
        break;
      case 'mpl':
      case 'fmpl':
        if (args[1] === 'm2att') {
          const at = await this.host.attribute?.(Number(args[0]), Number(args[2]));
          if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
            this.diagnostic(line, 'host did not provide the requested PPI attribute');
            break;
          }
          this.setGlobal(Number(args[4]), Math.round(at.x));
          this.setGlobal(Number(args[5]), Math.round(at.y));
          if (args[6]) {
            if (Number.isFinite(at.extra)) this.setGlobal(Number(args[6]), at.extra);
            else this.diagnostic(line, 'host did not provide the PPI attribute extra value');
          }
        } else await this.stage.characterCommand(args, verb === 'fmpl');
        break;
      case 'wait':
        if (args[0] === 'tag') {
          const wait = await this.host.waitTag?.(args[1], Number(args[2] || 0));
          if (wait) this.waiting = { kind: 'tag', ...wait };
        } else if (args[0] === 'key') {
          const frame = this.stack.at(-1);
          if (this.text) this.closeMessage(frame, true);
          this.waitForInput();
        } else if (args[0] === 'pcm' || args[0] === 'se') {
          this.waiting = {
            kind: 'sound',
            channel: args[0] === 'pcm' ? 'voice' : 'se',
            bank: args[1] === undefined ? null : number(1),
          };
          if (typeof this.host.soundBusy !== 'function')
            this.diagnostic('wait', 'soundBusy host service is not implemented');
        } else if (args[0] === 'pt') {
          this.waiting = { kind: 'particle', bank: args[1] === undefined ? null : number(1) };
          if (typeof this.host.particleBusy !== 'function')
            this.diagnostic('wait', 'particleBusy host service is not implemented');
        } else if (/^-?\d+$/.test(args[0] || '') && number(0) >= 0) {
          this.waiting = { kind: 'frames', due: this.stage.frame + Math.max(1, number(0)) };
        } else {
          const group = args[0] === '-1' ? '' : args[0] || '';
          if (this.stage.busy(group) || this.host.actorBusy?.(group))
            this.waiting = { kind: 'motions', group };
        }
        break;
      case 'bgm':
      case 'se':
      case 'pcm':
        await this.soundCommand(verb, args);
        break;
      case 'rdraw':
      case 'rwipe':
      case 'rwmos': {
        const frames = Number(verb === 'rwipe' ? args[1] : args[0]) || this.drawFrames || 15;
        this.host.transition?.(frames, verb, args[0]);
        this.waiting = { kind: 'frames', due: this.stage.frame + frames };
        break;
      }
      case 'drawdef':
        this.drawFrames = Number(args[0]) || 15;
        break;
      case 'wipedef':
        this.wipeFrames = Number(args[0]) || 40;
        break;
      case 'frameoff':
        this.windowVisible = false;
        this.host.showWindow?.(false, Number(args[1] || 0));
        break;
      case 'frameon':
        this.windowVisible = true;
        this.host.showWindow?.(true, Number(args[1] || 0));
        break;
      case 'view':
        this.view = Number(args[0] || 0) !== 0;
        this.windowVisible = this.view;
        await this.host.view?.(this.view, args[1]);
        break;
      case 'novel':
        this.novel = Number(args[0] || 0) !== 0;
        break;
      case 'scenetitle':
      case 'scene':
        this.title = args.join(' ').replace(/^#[^#]+#/, '');
        break;
      case 'mesdraw':
        this.messageVisible = number(0, 1) !== 0;
        await this.service('messageVisibility', this.messageVisible);
        break;
      case 'callmestag':
        await this.service('callMessageTag', args[0]);
        break;
      case 'sysbtn':
        await this.service('systemButton', args.length ? number(0) : null, number(1, 1) !== 0);
        break;
      case 'fes':
      case 'fesjs':
        await this.service('openFES', args[0], args.slice(1));
        this.waiting = { kind: 'modal' };
        break;
      case 'fesds':
        await this.service('fesAsync', {
          bank: number(0),
          save: number(1) !== 0,
          il: number(2),
          file: args[3],
          parameters: args.slice(4).map((a) => this.value(a)),
        });
        break;
      case 'movie':
        await this.host.movie?.(args[0]);
        this.waiting = { kind: 'movie' };
        break;
      case 'particle':
      case 'particle2':
      case 'particle3':
        await this.service('particle', verb, args);
        break;
      case 'baseimg':
        this.host.snapshotBase?.();
        break;
      case 'cgflag':
        await this.service('cgFlag', args[0]);
        break;
      case 'cgreg':
        await this.service('cgRegister', args[0]);
        break;
      case 'end_of_kaisou':
        this.setGlobal(this.replayFlagBase + number(0), 1);
        if (this.replayMode) {
          this.stack = [];
          this.finished = true;
          await this.service('replayEnd');
        }
        break;
      case 'cancellabel':
        this.cancelLabel = args[0] || null;
        break;
      case 'forcemesdel':
        this.forcedMessageHidden = number(0) !== 0;
        this.windowVisible = this.view && !this.forcedMessageHidden;
        await this.service('showWindow', this.windowVisible, 0);
        break;
      case 'autoface':
        this.autoFace = args[0] === 'on';
        await this.service('autoFace', this.autoFace);
        break;
      case 'voiceoff':
        await this.service('voiceMuted', args[0] === undefined ? null : number(0), number(1) !== 0);
        break;
      case 'initialize_header':
      case 'thumbnail':
      case 'tonetbl':
      case 'steam':
        this.diagnostic(verb, 'command is not implemented');
        break;
      default:
        this.diagnostic(line);
    }
  }
  snapshot() {
    return structuredClone({
      stack: this.stack,
      speaker: this.speaker,
      text: this.text,
      pendingVoice: this.pendingVoice,
      pendingVoices: this.pendingVoices,
      awaitingInput: this.awaitingInput,
      waiting: this.waiting,
      finished: this.finished,
      currentMessage: this.currentMessage,
      view: this.view,
      windowVisible: this.windowVisible,
      title: this.title,
      bgm: this.bgm,
      sounds: this.sounds,
      voice: this.voice,
      messageStart: this.messageStart,
      sequence: this.sequence,
      language: this.language,
      drawFrames: this.drawFrames,
      wipeFrames: this.wipeFrames,
      keySkip: this.keySkip,
      messageVisible: this.messageVisible,
      replayMode: this.replayMode,
      replayFlagBase: this.replayFlagBase,
      selectionSequence: this.selectionSequence,
      forcedAuto: this.forcedAuto,
      forcedMessageHidden: this.forcedMessageHidden,
      autoFace: this.autoFace,
      stage: this.stage.snapshot(),
      log: this.log.slice(-500),
    });
  }
  async restore(state) {
    for (const pos of state.stack) {
      const s = await this.script(pos.name);
      if (!Number.isInteger(pos.line) || pos.line < 0 || pos.line > s.lines.length)
        throw new Error('Save scene position out of bounds');
    }
    for (const key of [
      'stack',
      'speaker',
      'text',
      'pendingVoice',
      'pendingVoices',
      'awaitingInput',
      'waiting',
      'finished',
      'currentMessage',
      'view',
      'windowVisible',
      'title',
      'bgm',
      'sounds',
      'voice',
      'messageStart',
      'sequence',
      'language',
      'drawFrames',
      'wipeFrames',
      'keySkip',
      'messageVisible',
      'replayMode',
      'replayFlagBase',
      'selectionSequence',
      'forcedAuto',
      'forcedMessageHidden',
      'autoFace',
      'log',
    ])
      this[key] = structuredClone(state[key]);
    await this.stage.restore(state.stage);
  }
}
