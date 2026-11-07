// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESPlayer (OWCramer).
import { readFES } from '../formats/scene.mjs';
import { parseProgram } from './program.mjs';
import { FESInstance } from './instance.mjs';

export class FESPlayer {
  constructor(game, images, host = {}, globals = {}, strings = {}) {
    Object.assign(this, {
      game,
      images,
      host,
      globals,
      strings,
      language: 'en',
      root: null,
      frameCount: 0,
      mouse: { x: 0, y: 0 },
      focused: null,
      dragging: null,
      randomState: 12345,
      transparent: false,
      pending: new Set(),
      error: null,
      unsupportedCommands: new Set(),
      hints: new Set(),
      events: [],
      requestedKCS: null,
    });
    this.metadata = new Map();
    this.unresolvedTargets = new Set();
  }
  get instances() {
    const result = [];
    for (let s = this.root; s; s = s.child) result.push(s);
    return result;
  }
  get stack() {
    return this.instances.map((s) => `${s.name}#${s.label}`);
  }
  expand(s = '') {
    return s
      .replace(/%LANG_M%/g, this.languageMain || this.language)
      .replace(/%LANG%/g, this.language)
      .replace(/\$str(\d+)/g, (_, n) => this.strings[n] || '');
  }
  async load(name, parent = null) {
    const text = await readFES(
        await this.game.require(/\.fes$/i.test(name) ? name : `${name}.fes`),
      ),
      program = parseProgram(text);
    program.source = text;
    const tokens = new Set(this.expand(text).match(/[\w%-]+/g) || []);
    const names = [...tokens].filter((t) => this.game.has(`${t}.hg3`));
    await Promise.all(
      names.map(async (n) => {
        this.metadata.set(n.toLowerCase(), await this.images.load(n));
      }),
    );
    return new FESInstance(name.toLowerCase().replace(/\.fes$/, ''), program, this, parent);
  }
  async start(name) {
    this.root = await this.load(name);
    this.focused = null;
    this.requestedKCS = null;
  }
  enqueue(promise) {
    if (!promise || typeof promise.then !== 'function') return;
    const wrapped = promise
      .catch((e) => {
        this.error = e;
      })
      .finally(() => this.pending.delete(wrapped));
    this.pending.add(wrapped);
  }
  async flush() {
    while (this.pending.size) await Promise.all([...this.pending]);
    if (this.error) throw this.error;
  }
  async step() {
    await this.flush();
    this.frameCount++;
    for (const s of this.instances) {
      s.tick();
      s.clickL = 0;
      s.clickR = 0;
      s.scrollUp = 0;
      s.scrollDown = 0;
      for (const o of s.objects) o.advance();
    }
    if (this.focused && !this.instances.includes(this.focused.s)) this.focused = null;
  }
  picture(name) {
    return name
      ? this.metadata.get(
          this.expand(name)
            .toLowerCase()
            .replace(/\.hg3$/, ''),
        )
      : null;
  }
  async refreshImages() {
    const tokens = new Set(
      this.expand(this.instances.map((s) => s.program.source).join('\n')).match(/[\w%-]+/g) || [],
    );
    await Promise.all(
      [...tokens]
        .filter((t) => this.game.has(`${t}.hg3`))
        .map(async (name) => this.metadata.set(name.toLowerCase(), await this.images.load(name))),
    );
  }
  note(text) {
    this.hints.add(text);
  }
  unsupported(text) {
    this.unsupportedCommands.add(text);
  }
  sound(sound) {
    this.enqueue(
      this.host.sound?.({ ...sound, file: sound.file ? this.expand(sound.file) : null }),
    );
  }
  requestKCS(name, owner) {
    this.requestedKCS = { name, owner };
  }
  transition(frames, kind, mask) {
    this.host.transition?.(frames, kind, mask);
  }
  snapshotBase() {
    if (!this.transparent) this.host.snapshotBase?.();
  }
  random(low, high) {
    this.randomState = (Math.imul(this.randomState, 1103515245) + 12345) >>> 0;
    return low + ((this.randomState >>> 16) % Math.max(1, high - low + 1));
  }
  candidates() {
    for (const s of this.instances.toReversed()) {
      const result = s.objects
        .filter(
          (o) =>
            o.enable &&
            ['BUTTON', 'SLIDER', 'SCROLL2'].includes(o.type) &&
            (!s.keyNames.size || s.keyNames.has(o.baseName)) &&
            s.placement(o).shown,
        )
        .map((o) => ({ s, o, rect: s.rect(o) }))
        .filter(
          (c) =>
            c.rect &&
            c.rect.w > 0 &&
            c.rect.h > 0 &&
            c.rect.x < this.game.width &&
            c.rect.y < this.game.height &&
            c.rect.x + c.rect.w > 0 &&
            c.rect.y + c.rect.h > 0,
        );
      if (result.length) return result;
    }
    return [];
  }
  hit(x, y) {
    // Pointer input can reach every enabled button, including those omitted from keyboard navigation.
    for (const s of this.instances.toReversed()) {
      const objects = s.objects
        .filter(
          (o) =>
            o.enable && ['BUTTON', 'SLIDER', 'SCROLL2'].includes(o.type) && s.placement(o).shown,
        )
        .toSorted((a, b) => b.pri - a.pri);
      for (const o of objects) {
        const r = s.rect(o);
        if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { s, o };
      }
      if (objects.length) return null;
    }
    return null;
  }
  focus(target) {
    if (this.focused?.o === target?.o) return;
    if (this.focused && this.instances.includes(this.focused.s))
      this.focused.s.event(this.focused.o, 'UNFOCUS');
    this.focused = target;
    if (target) target.s.event(target.o, 'FOCUS');
  }
  hover(x, y) {
    if (x === null) {
      this.focus(null);
      return;
    }
    this.mouse = { x, y };
    if (this.dragging) this.slide(this.dragging, x, y);
    else this.focus(this.hit(x, y));
  }
  click(x, y) {
    const target = this.hit(x, y);
    if (!target) {
      const last = this.instances.at(-1);
      if (last) last.clickL = -1;
      return false;
    }
    this.focus(target);
    if (target.o.type === 'BUTTON') this.press();
    else this.slide(target, x, y);
    return true;
  }
  press() {
    const target = this.focused;
    if (!target || !target.o.enable || !this.instances.includes(target.s)) return false;
    target.s.event(target.o, 'PUSH_L');
    target.s.clickL = target.o.handle;
    target.s.event(target.o, 'RELEASE_L');
    return true;
  }
  push(name) {
    for (const s of this.instances.toReversed()) {
      const o = s.byKey.get(name);
      if (o?.enable && s.placement(o).shown) {
        this.focus({ s, o });
        return this.press();
      }
    }
    return false;
  }
  rightClick() {
    const s = this.instances.at(-1);
    if (s) s.clickR = 1;
  }
  scroll(up) {
    const s = this.instances.at(-1);
    if (s) s[up ? 'scrollUp' : 'scrollDown'] = 1;
  }
  moveFocus(direction) {
    const all = this.candidates();
    if (!all.length) return false;
    const current = all.find((c) => c.o === this.focused?.o);
    if (!current) {
      this.focus(
        all.toSorted(
          (a, b) => Math.floor(a.rect.y / 24) - Math.floor(b.rect.y / 24) || a.rect.x - b.rect.x,
        )[0],
      );
      return true;
    }
    if (current.o.type === 'SLIDER' && ['left', 'right'].includes(direction)) {
      const o = current.o;
      o.value = Math.max(
        o.min,
        Math.min(
          o.max,
          o.value + (direction === 'right' ? 1 : -1) * Math.max(1, Math.ceil((o.max - o.min) / 20)),
        ),
      );
      current.s.event(o, 'SCRL_P');
      return true;
    }
    const cx = current.rect.x + current.rect.w / 2,
      cy = current.rect.y + current.rect.h / 2;
    const candidates = all
      .filter((c) => c.o !== current.o)
      .map((c) => {
        const dx = c.rect.x + c.rect.w / 2 - cx,
          dy = c.rect.y + c.rect.h / 2 - cy;
        const [along, across] =
          direction === 'right'
            ? [dx, dy]
            : direction === 'left'
              ? [-dx, dy]
              : direction === 'down'
                ? [dy, dx]
                : [-dy, dx];
        return { ...c, score: along > 4 ? along + Math.abs(across) * 2.5 : Infinity };
      })
      .filter((c) => Number.isFinite(c.score))
      .toSorted((a, b) => a.score - b.score);
    if (!candidates.length) return false;
    this.focus(candidates[0]);
    return true;
  }
  knob(s, o) {
    const at = s.placement(o),
      span = Math.max(1, o.max - o.min - (o.type === 'SCROLL2' ? o.page : 0));
    const t = Math.max(0, Math.min(1, (o.value - o.min) / span));
    if (o.type === 'SCROLL2') {
      const h = Math.max(24, (o.areaHeight * o.page) / Math.max(1, o.max - o.min));
      return { x: at.x + (o.areaWidth - 11) / 2, y: at.y + (o.areaHeight - h) * t, w: 11, h };
    }
    const f = this.picture(o.file)?.frames[0],
      w = f?.width || 25,
      h = f?.height || 25;
    return { x: at.x + (o.areaWidth - w) * t, y: at.y + (o.areaHeight - h) / 2, w, h };
  }
  slide(target, x, y) {
    const { s, o } = target,
      at = s.placement(o),
      k = this.knob(s, o),
      vertical = o.type === 'SCROLL2';
    const span = o.max - o.min - (vertical ? o.page : 0);
    const t = vertical
      ? (y - at.y - k.h / 2) / Math.max(1, o.areaHeight - k.h)
      : (x - at.x - k.w / 2) / Math.max(1, o.areaWidth - k.w);
    const value = o.min + Math.round(Math.max(0, Math.min(1, t)) * Math.max(0, span));
    if (value !== o.value) {
      o.value = value;
      s.event(o, 'SCRL_P');
    }
  }
  beginDrag(x, y) {
    const target = this.hit(x, y);
    if (target && target.o.type !== 'BUTTON') {
      this.dragging = target;
      this.focus(target);
      this.slide(target, x, y);
      return true;
    }
    return false;
  }
  endDrag() {
    this.dragging = null;
  }
  snapshot() {
    const instance = (s) =>
      s
        ? {
            name: s.name,
            label: s.label,
            locals: s.locals,
            exitCode: s.exitCode,
            finished: s.finished,
            suspended: s.suspended,
            waitFrames: s.waitFrames,
            waitMotion: s.waitMotion,
            waitSound: s.waitSound,
            transitionUntil: s.transitionUntil,
            objects: s.objects.map((o) => ({ ...o })),
            child: instance(s.child),
          }
        : null;
    return structuredClone({
      language: this.language,
      languageMain: this.languageMain,
      frameCount: this.frameCount,
      randomState: this.randomState,
      root: instance(this.root),
    });
  }
  async restore(state) {
    this.language = state.language;
    this.languageMain = state.languageMain;
    this.frameCount = state.frameCount;
    this.randomState = state.randomState;
    const instance = async (saved, parent) => {
      if (!saved) return null;
      const s = await this.load(saved.name, parent);
      for (const key of [
        'label',
        'locals',
        'exitCode',
        'finished',
        'suspended',
        'waitFrames',
        'waitMotion',
        'waitSound',
        'transitionUntil',
      ])
        s[key] = structuredClone(saved[key]);
      if (!s.program.blocks[s.label]) throw new Error('Save refers to missing FES block');
      for (const o of saved.objects) {
        const target = s.byKey.get(o.key);
        if (!target || target.type !== o.type) throw new Error('Save FES object mismatch');
        Object.assign(target, structuredClone(o));
      }
      s.child = await instance(saved.child, s);
      return s;
    };
    this.root = await instance(state.root, null);
    this.focused = null;
    this.dragging = null;
    this.requestedKCS = null;
  }
}
