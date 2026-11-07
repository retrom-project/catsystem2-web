// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit ScenePlayer (OWCramer).
import { readScene, readTranslation } from './formats/scene.mjs';
import { evaluate, assign, condition } from './fes/expression.mjs';
import { Stage } from './stage.mjs';

export function cleanText(text) {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\(?:@|fs|fn|fl)/g, '')
    .trim();
}
export class ScenePlayer {
  constructor(game, host = {}, globals = {}) {
    Object.assign(this, {
      game,
      host,
      globals,
      language: 'en',
      stack: [],
      scripts: new Map(),
      currentMessage: null,
      speaker: null,
      text: '',
      pendingVoice: null,
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
    });
    this.stage = new Stage(game.width, game.height, (text) => this.value(text));
  }
  global(n) {
    return this.globals[n] || 0;
  }
  setGlobal(n, v) {
    this.globals[n] = v | 0;
  }
  local() {
    return 0;
  }
  setLocal() {}
  value(text) {
    return evaluate(text, this);
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
    this.stack.push({ name, line: 0, messageIndex: 0 });
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
    const message = {
      scene: frame.name,
      index: frame.messageIndex++,
      sequence: this.sequence++,
      speaker: translated?.speaker || this.speaker,
      originalSpeaker: this.speaker,
      text: cleanText(translated?.text ?? this.text),
      original: this.text,
      voice: this.pendingVoice,
      continues,
    };
    this.currentMessage = message;
    this.pendingVoice = null;
    this.speaker = null;
    this.text = '';
    this.messageStart = this.stage.frame;
    this.log.push({ ...message });
    this.host.message?.(message);
    return true;
  }
  async tick() {
    if (this.finished) return;
    if (this.waiting) {
      const w = this.waiting;
      if (w.kind === 'input') return;
      if (w.kind === 'frames' && this.stage.frame < w.due) return;
      if (w.kind === 'motions' && (this.stage.busy(w.group) || this.host.actorBusy?.(w.group)))
        return;
      if (w.kind === 'tag' && !this.host.tagReady?.(w)) return;
      if (w.kind === 'modal' && this.host.modalActive?.()) return;
      if (w.kind === 'movie' && this.host.movieActive?.()) return;
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
      if (line.kind === 0x21) this.speaker = line.text;
      else if (line.kind === 0x20) {
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
          this.waiting = { kind: 'input' };
        } else if (this.closeMessage(frame)) {
          this.awaitingInput = false;
          this.waiting = { kind: 'input' };
        }
      } else if (line.kind === 0x30) await this.command(line.text);
    }
    if (!this.stack.length && !this.waiting) {
      this.finished = true;
      this.host.end?.();
    }
  }
  advance() {
    if (this.waiting?.kind === 'input') this.waiting = null;
    else if (['motions', 'frames', 'tag'].includes(this.waiting?.kind)) {
      this.stage.finish();
      this.host.finishMotions?.();
      this.waiting = null;
    }
  }
  async command(source) {
    let line = source.trim();
    while (/^if\s*\(/.test(line)) {
      const [expr, rest] = condition(line);
      if (!this.value(expr)) return;
      line = rest;
    }
    if (!line) return;
    if (line.startsWith('#')) {
      assign(line, this);
      return;
    }
    const [verb, ...rawArgs] = line.split(/\s+/),
      args = rawArgs.map((a) =>
        a.includes('#') && !/^#[^#]+#/.test(a) ? String(this.value(a)) : a,
      );
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
        this.stage.pictures(verb, args);
        break;
      case 'pl':
        this.stage.planeCommand(args);
        break;
      case 'mpl':
      case 'fmpl':
        if (args[1] === 'm2att') {
          const at = await this.host.attribute?.(Number(args[0]), Number(args[2]));
          this.setGlobal(Number(args[4]), Math.round(at?.x || 0));
          this.setGlobal(Number(args[5]), Math.round(at?.y || 0));
          if (args[6]) this.setGlobal(Number(args[6]), at?.extra || 3);
        } else this.stage.characterCommand(args, verb === 'fmpl');
        break;
      case 'wait':
        if (args[0] === 'tag') {
          const wait = await this.host.waitTag?.(args[1], Number(args[2] || 0));
          if (wait) this.waiting = { kind: 'tag', ...wait };
        } else if (/^\d+$/.test(args[0] || '')) {
          if (+args[0]) this.waiting = { kind: 'frames', due: this.stage.frame + +args[0] };
        } else if (this.stage.busy(args[0] || '') || this.host.actorBusy?.(args[0] || ''))
          this.waiting = { kind: 'motions', group: args[0] || '' };
        break;
      case 'bgm': {
        let name = args.length >= 2 && /^\d+$/.test(args[0]) ? args[1] : args[0];
        if (!name || name === 'end' || /^\d+$/.test(name)) name = null;
        if (['fade', 'vol'].includes(args[1])) this.host.soundControl?.('bgm', args.slice(1));
        else {
          this.bgm = name;
          await this.host.sound?.({ channel: 'bgm', file: name, loop: true, group: 'bgm' });
        }
        break;
      }
      case 'se': {
        if (!args.length) {
          for (const n of Object.keys(this.sounds))
            this.host.sound?.({ channel: `se${n}`, file: null });
          this.sounds = {};
          break;
        }
        const slot = Number(args[0]),
          sub = args[1];
        if (['end', 'stop'].includes(sub) || args.length < 2) {
          delete this.sounds[slot];
          this.host.sound?.({ channel: `se${slot}`, file: null });
        } else if (sub === 'loop') {
          this.sounds[slot] ||= {};
          this.sounds[slot].loop = Number(args[2] || 0) !== 0;
          this.host.soundControl?.(`se${slot}`, args.slice(1));
        } else if (['vol', 'fade'].includes(sub))
          this.host.soundControl?.(`se${slot}`, args.slice(1));
        else {
          this.sounds[slot] = { file: sub, loop: this.sounds[slot]?.loop || false };
          await this.host.sound?.({ channel: `se${slot}`, ...this.sounds[slot], group: 'se' });
        }
        break;
      }
      case 'pcm':
        this.voice = args[0] || null;
        this.pendingVoice = this.voice;
        await this.host.sound?.({ channel: 'voice', file: this.voice, group: 'voice' });
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
        this.title = args.join(' ').replace(/^#[^#]+#/, '');
        break;
      case 'fesjs':
        await this.host.openFES?.(args[0], args.slice(1));
        this.waiting = { kind: 'modal' };
        break;
      case 'fesds':
        this.host.closeModal?.();
        break;
      case 'movie':
        await this.host.movie?.(args[0]);
        this.waiting = { kind: 'movie' };
        break;
      case 'particle':
      case 'particle2':
      case 'particle3':
        this.host.particle?.(verb, args);
        break;
      case 'baseimg':
        this.host.snapshotBase?.();
        break;
      case 'cgflag':
        this.host.cgFlag?.(args[0]);
        break;
      case 'cancellabel':
        this.cancelLabel = args[0] || null;
        break;
      case 'forcemesdel':
        this.host.clearMessage?.();
        break;
      case 'initialize_header':
      case 'thumbnail':
      case 'tonetbl':
      case 'autoface':
      case 'steam':
        this.host.hint?.(line);
        break;
      default:
        this.unsupported.add(line);
        this.host.unsupported?.(line);
    }
  }
  snapshot() {
    return structuredClone({
      stack: this.stack,
      speaker: this.speaker,
      text: this.text,
      pendingVoice: this.pendingVoice,
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
      'log',
    ])
      this[key] = structuredClone(state[key]);
    this.stage.restore(state.stage);
  }
}
