// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESPlayer (OWCramer).
import { readFES } from '../formats/scene.mjs';
import { includeNames, parseProgram } from './program.mjs';
import { FESInstance } from './instance.mjs';
import { NativeFESSourceArena } from '../native/fes-source.mjs';
import { tokenizeFESLine } from './tokens.mjs';

export class FESPlayer {
  constructor(game, images, host = {}, globals = {}, strings = {}) {
    Object.assign(this, {
      game,
      images,
      host,
      globals,
      strings,
      stringTable: {},
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
      debugLogs: [],
    });
    this.metadata = new Map();
    this.unresolvedTargets = new Set();
    this.localSources = new NativeFESSourceArena();
  }
  get instances() {
    return this.root ? [this.root] : [];
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
  tokens(line) {
    return this.host.fesTokens ? this.host.fesTokens(line) : tokenizeFESLine(line);
  }
  async load(name, options) {
    const source = await readFES(
      this.game.requireCategory
        ? await this.game.requireCategory(name, 'fes')
        : await this.game.require(/\.fes$/i.test(name) ? name : `${name}.fes`),
    );
    const includes = new Map();
    const loadIncludes = async (source) => {
      for (const file of includeNames(source.text, {
        prepared: source.prepared,
        tokens: (line) => this.tokens(line),
      })) {
        if (includes.has(file)) continue;
        const contents = await readFES(
          this.game.requireCategory
            ? await this.game.requireCategory(file, 'fes')
            : await this.game.require(file),
        );
        includes.set(file, contents);
        await loadIncludes(contents);
      }
    };
    await loadIncludes(source);
    const program = parseProgram(source.text, {
      prepared: source.prepared,
      tokens: (line) => this.tokens(line),
      include: (file) => includes.get(file),
    });
    const sources = this.nativeSources || this.localSources;
    program.sourceKey = sources.register(
      this.nativeOwner,
      name.toLowerCase().replace(/\.fes$/, ''),
      program,
    );
    program.source = [source, ...includes.values()].map(({ text }) => text).join('\n');
    const tokens = new Set(this.expand(program.source).match(/[\w%-]+/g) || []);
    const names = [...tokens].filter((t) =>
      this.game.resolveCategory
        ? this.game.resolveCategory(t, 'image') !== null
        : this.game.has(`${t}.hg3`),
    );
    await Promise.all(
      names.map(async (n) => {
        this.metadata.set(n.toLowerCase(), await this.images.load(n));
      }),
    );
    return new FESInstance(name.toLowerCase().replace(/\.fes$/, ''), program, this, options);
  }
  async start(name) {
    this.root = await this.load(name);
    this.focused = null;
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
      if (this.nativeImages)
        for (const object of s.objects)
          if (this.nativeImages.supports(object)) await this.nativeImages.advance(s, object);
      if (this.nativeControls)
        for (const object of s.objects)
          if (this.nativeControls.supports(object)) await this.nativeControls.advance(s, object);
      if (this.nativeEffects)
        for (const object of s.objects)
          if (this.nativeEffects.supports(object)) await this.nativeEffects.advance(s, object);
      if (this.nativePlanes)
        for (const object of s.objects)
          if (this.nativePlanes.supports(object)) await this.nativePlanes.advance(s, object);
      if (this.nativeArea)
        for (const object of s.objects)
          if (this.nativeArea.supports(object)) await this.nativeArea.advance(s, object);
      const tick = async () => {
        if (s.waitSound !== null) {
          const object = s.byKey.get(s.waitSound);
          if (!object)
            throw new Error(`${s.name}: waiting sound object ${s.waitSound} disappeared`);
          if (this.nativeSound) {
            if (await this.nativeSound.busy(s, object)) return;
          } else {
            if (typeof this.host.soundBusy !== 'function')
              throw new Error('FES sound wait requires a sound lifecycle host');
            if (await this.host.soundBusy(object.soundChannel)) return;
          }
          s.waitSound = null;
        }
        s.tick();
      };
      await tick();
      let flushes = 0;
      while (s.decodePending) {
        if (++flushes > 10000) throw new Error(`${s.name}: FES decode instruction budget`);
        s.decodePending = false;
        await this.flush();
        await tick();
      }
      if (!s.keySkipControlOnly || !s.skipControl) s.clickL = 0;
      if (!s.keySkipContinuous && !s.skipControl && !s.keySkipForced) s.skipPressed = false;
      s.clickR = 0;
      s.scrollUp = 0;
      s.scrollDown = 0;
      s.scrollPosition = 0;
      s.pageUp = 0;
      s.pageDown = 0;
      s.pushUp = 0;
      s.pushDown = 0;
      s.pushLeft = 0;
      s.pushRight = 0;
      for (const o of s.objects) o.advance(this.frameCount);
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
  async loadPicture(name) {
    const key = this.expand(name)
      .toLowerCase()
      .replace(/\.hg3$/, '');
    if (!this.metadata.has(key)) this.metadata.set(key, await this.images.load(key));
    return this.metadata.get(key);
  }
  note(text) {
    this.hints.add(text);
  }
  debugLog(entry) {
    this.debugLogs.push(entry);
    this.host.fesDebug?.(entry);
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
    if (owner.childTaskID !== null || owner.kcsTaskID !== null) {
      this.hints.add('execkcs ignored while a child script exists');
      return;
    }
    if (typeof this.host.startKCS !== 'function')
      throw new Error('FES execkcs requires a KCS task host');
    this.enqueue(
      Promise.resolve(this.host.startKCS(name, owner)).then((id) => {
        if (id === null) return;
        if (!Number.isSafeInteger(id) || id < 0)
          throw new Error('KCS task host did not return a handle');
        owner.kcsTaskID = id;
      }),
    );
  }
  endKCS(owner) {
    if (owner.kcsTaskID === null) return;
    if (typeof this.host.endKCS !== 'function')
      throw new Error('FES endkcs requires a KCS task host');
    this.enqueue(
      Promise.resolve(this.host.endKCS(owner.kcsTaskID, owner)).then(() => {
        owner.kcsTaskID = null;
      }),
    );
  }
  requestFES(name, owner, parameters) {
    if (owner.childTaskID !== null || owner.kcsTaskID !== null) {
      this.hints.add('execfes ignored while a child script exists');
      return;
    }
    if (typeof this.host.startFES !== 'function')
      throw new Error('FES execfes requires a native task host');
    this.enqueue(
      Promise.resolve(this.host.startFES(name, owner, parameters)).then((id) => {
        if (id === null) return;
        if (!Number.isSafeInteger(id) || id < 0)
          throw new Error('FES task host did not return a handle');
        owner.childTaskID = id;
      }),
    );
  }
  endFES(owner) {
    if (owner.childTaskID === null) return;
    if (typeof this.host.endFES !== 'function')
      throw new Error('FES endfes requires a native task host');
    this.enqueue(
      Promise.resolve(this.host.endFES(owner.childTaskID, owner)).then(() => {
        owner.childTaskID = null;
      }),
    );
  }
  childExitCode(owner) {
    const id = owner.childTaskID ?? owner.kcsTaskID;
    if (id === null) return owner.exitCode;
    if (typeof this.host.childExitCode !== 'function')
      throw new Error('FES child exit-code task query is unavailable');
    return this.host.childExitCode(id, owner);
  }
  transition(frames, kind, mask) {
    this.host.transition?.(frames, kind, mask);
  }
  snapshotBase(instance, object) {
    if (this.nativeGraphics) this.enqueue(this.nativeGraphics.baseImage(instance, object));
    else if (typeof this.host.snapshotBase === 'function')
      this.enqueue(Promise.resolve(this.host.snapshotBase(object, instance)));
    else throw new Error('FES baseimg requires a native drawing surface or a bitmap host');
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
  nativeEvent(key, event) {
    const instance = this.root,
      object = key == null ? null : instance.byKey.get(key);
    if (key != null && !object) throw new Error(`FES native input refers to missing object ${key}`);
    const fields = {
      PUSH_L: 'clickL',
      PUSH_R: 'clickR',
      SCRL_U: 'scrollUp',
      SCRL_D: 'scrollDown',
      SCRL_P: 'scrollPosition',
      PAGE_U: 'pageUp',
      PAGE_D: 'pageDown',
      PUSH_UP: 'pushUp',
      PUSH_DOWN: 'pushDown',
      PUSH_LEFT: 'pushLeft',
      PUSH_RIGHT: 'pushRight',
      RELEASE_UP: 'releaseUp',
      RELEASE_DOWN: 'releaseDown',
      RELEASE_LEFT: 'releaseLeft',
      RELEASE_RIGHT: 'releaseRight',
      TOUCH: 'touch',
    };
    if (fields[event]) instance[fields[event]] = object?.handle ?? -1;
    if (event === 'RELEASE_L') instance.clickL = 0;
    if (event === 'RELEASE_R') instance.clickR = 0;
    if (event === 'PUSH_L') instance.skipPressed = true;
    if (!object) return false;
    if (
      ![
        'FOCUS',
        'UNFOCUS',
        'PUSH_L',
        'PUSH_R',
        'RELEASE_L',
        'RELEASE_R',
        'SCRL_P',
        'TOUCH',
      ].includes(event)
    )
      return false;
    return instance.dispatchEvent(object, event);
  }
  notify(event, objectName = null, objectIndex = 0) {
    if (!this.root) throw new Error('FES notification requires a loaded script');
    return this.root.notify(event, objectName, objectIndex);
  }
  focusObject(s, o) {
    this.focus({ s, o });
    const r = s.rect(o);
    if (r)
      this.mouse = {
        x: r.x + (o.keyPosition ? o.keyPosition.x : r.w - 1),
        y: r.y + (o.keyPosition ? o.keyPosition.y : r.h - 1),
      };
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
    const target = this.focused?.s === s ? this.focused : null;
    if (s) s.clickR = target?.o.handle || -1;
    if (target) {
      s.event(target.o, 'PUSH_R');
      s.event(target.o, 'RELEASE_R');
    }
  }
  scroll(up) {
    const s = this.instances.at(-1);
    if (s) s[up ? 'scrollUp' : 'scrollDown'] = this.focused?.s === s ? this.focused.o.handle : -1;
  }
  moveFocus(direction) {
    const all = this.candidates();
    if (!all.length) return false;
    const current = all.find((c) => c.o === this.focused?.o);
    if (!current) {
      const first =
        all.find((c) => c.o.key === c.s.defaultButton) ||
        all.toSorted(
          (a, b) => Math.floor(a.rect.y / 24) - Math.floor(b.rect.y / 24) || a.rect.x - b.rect.x,
        )[0];
      this.focusObject(first.s, first.o);
      return true;
    }
    current.s[`push${direction[0].toUpperCase()}${direction.slice(1)}`] = current.o.handle;
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
      current.s.scrollPosition = o.handle;
      return true;
    }
    if (current.o.keyblock && current.s.program.keyblocks.length) {
      const { s, o } = current,
        [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction],
        link = { up: 0, down: 1, left: 2, right: 3 }[direction];
      let { block, x, y } = o.keyblock;
      const seen = new Set();
      for (let i = 0; i < 10000; i++) {
        const area = s.program.keyblocks[block];
        if (!area) return false;
        x += dx;
        y += dy;
        if (x < 0 || y < 0 || x >= area.width || y >= area.height) {
          block = area.links[link];
          const next = s.program.keyblocks[block];
          if (!next) return false;
          x = dx > 0 ? 0 : dx < 0 ? next.width - 1 : Math.min(x, next.width - 1);
          y = dy > 0 ? 0 : dy < 0 ? next.height - 1 : Math.min(y, next.height - 1);
        }
        const position = `${block},${x},${y}`;
        if (seen.has(position)) return false;
        seen.add(position);
        const target = all.find(
          (c) =>
            c.s === s &&
            c.o.keyblock?.block === block &&
            c.o.keyblock.x === x &&
            c.o.keyblock.y === y,
        );
        if (target) {
          this.focusObject(s, target.o);
          return true;
        }
      }
      return false;
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
    this.focusObject(candidates[0].s, candidates[0].o);
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
      s.scrollPosition = o.handle;
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
            ...(this.nativeVariableContext
              ? { nativeVariableContextKey: s.nativeVariableContextKey }
              : { locals: s.locals }),
            exitCode: s.exitCode,
            childTaskID: s.childTaskID,
            kcsTaskID: s.kcsTaskID,
            galleryDescriptor: s.galleryDescriptor,
            finished: s.finished,
            suspended: s.suspended,
            waitFrames: s.waitFrames,
            waitMotion: s.waitMotion,
            waitSound: s.waitSound,
            waitObjects: s.waitObjects,
            frameOrigin: s.frameOrigin,
            defaultButton: s.defaultButton,
            transitionUntil: s.transitionUntil,
            keySkipEnabled: s.keySkipEnabled,
            keySkipControlOnly: s.keySkipControlOnly,
            keySkipContinuous: s.keySkipContinuous,
            keySkipForced: s.keySkipForced,
            skipPressed: s.skipPressed,
            skipControl: s.skipControl,
            inputPropagation: s.inputPropagation,
            forceRedrawPending: s.forceRedrawPending,
            resultValue: s.resultValue,
            commandDelayUntil: s.commandDelayUntil,
            deferredCommandReturn: s.deferredCommandReturn,
            dynamicDefinitions: s.dynamicDefinitions,
            macros: [...s.macros],
            nativeDictionary: s.nativeDictionary.snapshot(),
            objects: s.objects.map((o) => ({ ...o, motionState: o.motionTarget?.snapshot() })),
          }
        : null;
    return structuredClone({
      language: this.language,
      languageMain: this.languageMain,
      frameCount: this.frameCount,
      randomState: this.randomState,
      stringTable: this.stringTable,
      root: instance(this.root),
      sourceArena: this.nativeSources ? null : this.localSources.snapshot(),
    });
  }
  async restore(state) {
    if (!this.nativeSources) this.localSources.restore(state.sourceArena);
    this.language = state.language;
    this.languageMain = state.languageMain;
    this.frameCount = state.frameCount;
    this.randomState = state.randomState;
    this.stringTable = structuredClone(state.stringTable);
    const instance = async (saved) => {
      if (!saved) return null;
      const s = await this.load(saved.name, {
        nativeVariableContextKey: saved.nativeVariableContextKey,
        macros: saved.macros,
      });
      s.nativeDictionary.restore(saved.nativeDictionary);
      for (const definition of saved.dynamicDefinitions)
        s.createObjects(definition.typeIndex, definition.name, definition.count);
      for (const key of [
        'label',
        'locals',
        'exitCode',
        'kcsTaskID',
        'childTaskID',
        'finished',
        'suspended',
        'waitFrames',
        'waitMotion',
        'waitSound',
        'waitObjects',
        'frameOrigin',
        'defaultButton',
        'transitionUntil',
        'keySkipEnabled',
        'keySkipControlOnly',
        'keySkipContinuous',
        'keySkipForced',
        'skipPressed',
        'skipControl',
        'inputPropagation',
        'forceRedrawPending',
        'resultValue',
        'commandDelayUntil',
        'deferredCommandReturn',
      ])
        s[key] = structuredClone(saved[key]);
      if (!s.program.blocks[s.label]) throw new Error('Save refers to missing FES block');
      if (saved.galleryDescriptor) {
        const { file, entry, list } = saved.galleryDescriptor;
        if (typeof this.host.openGallery !== 'function')
          throw new Error('CG gallery storage is unavailable');
        s.galleryDescriptor = structuredClone(saved.galleryDescriptor);
        s.cgGallery = await this.host.openGallery(file, entry, list);
      }
      for (const o of saved.objects) {
        const target = s.byKey.get(o.key);
        if (!target || target.type !== o.type) throw new Error('Save FES object mismatch');
        const { motionState, ...fields } = o;
        Object.assign(target, structuredClone(fields));
        if (motionState) {
          if (!this.motionLibrary) throw new Error('Restoring FES motion requires its MOT library');
          await target.attachMotion(this.motionLibrary).restore(motionState);
        }
      }
      return s;
    };
    this.root = await instance(state.root);
    this.focused = null;
    this.dragging = null;
  }
}
