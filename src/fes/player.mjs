// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit FESPlayer (OWCramer).
import { readFES } from '../formats/scene.mjs';
import { includeNames, parseProgram } from './program.mjs';
import { FESInstance } from './instance.mjs';
import { NativeFESSourceArena } from '../native/fes-source.mjs';
import { setFESControlValue } from '../native/fes-control-model.mjs';
import { tokenizeFESByteLine, fesSourceBytes, fesByteView } from './tokens.mjs';
import { CGGallery } from '../gallery.mjs';
import { decodeText } from '../binary.mjs';

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
      publicPushPending: new Set(),
      publicPushTail: Promise.resolve(),
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
  get focused() {
    return this.nativeInput ? this.nativeInput.focused : this.focusTarget;
  }
  set focused(target) {
    if (this.nativeInput) this.nativeInput.setFocusTarget(target);
    else this.focusTarget = target;
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
    const bytes = fesSourceBytes(line);
    return this.host.fesTokens ? this.host.fesTokens(bytes) : tokenizeFESByteLine(bytes);
  }
  async load(name, options) {
    const source = await readFES(
      this.game.requireCategory
        ? await this.game.requireCategory(name, 'fes')
        : await this.game.require(/\.fes$/i.test(name) ? name : `${name}.fes`),
    );
    const includes = new Map();
    const loadIncludes = async (source) => {
      for (const file of includeNames(source.bytes, {
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
    const program = parseProgram(source.bytes, {
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
    if (!this.runtimeFactory) {
      const text = program.sources.map(({ bytes }) => decodeText(bytes)).join('\n'),
        tokens = new Set(this.expand(text).match(/[\w%-]+/g) || []);
      const names = [...tokens].filter((t) =>
        this.game.resolveCategory
          ? this.game.resolveCategory(t, 'image') !== null
          : this.game.has(`${t}.hg3`),
      );
      await Promise.all(
        names.map(async (name) =>
          this.metadata.set(name.toLowerCase(), await this.images.load(name)),
        ),
      );
    }
    const instance = new FESInstance(
      name.toLowerCase().replace(/\.fes$/, ''),
      program,
      this,
      options,
    );
    await instance.runtime?.initialize();
    return instance;
  }

  async start(name) {
    this.root = await this.load(name);
    if (!this.nativeInput) this.focused = null;
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
  enqueuePublicPush(operation) {
    this.trackPublicCompletion(
      this.publicPushTail.then(() => {
        if (this.error) throw this.error;
        return operation();
      }),
    );
  }
  trackPublicCompletion(promise) {
    let completion;
    completion = promise
      .catch((error) => {
        this.error = error;
      })
      .finally(() => this.publicPushPending.delete(completion));
    this.publicPushTail = completion;
    this.publicPushPending.add(completion);
  }
  publicEventLive(owner, expectedRuntime, expectedRecord, object = null) {
    return (
      expectedRuntime &&
      this.instances.includes(owner) &&
      owner.runtime === expectedRuntime &&
      !expectedRuntime.closed &&
      expectedRecord?.state !== 'releasing' &&
      expectedRuntime.world.objects.objects.get(owner.runtimeID) === expectedRecord &&
      expectedRecord?.implementation?.player === this &&
      (!object || (!object.deleted && owner.collection.graph.get(object.handle) === object))
    );
  }
  completePublicEvent(instance, object, event) {
    const runtime = instance.runtime,
      record = runtime.world.objects.objects.get(instance.runtimeID),
      reference = instance.collection.reference(object),
      live = () =>
        this.publicEventLive(instance, runtime, record, object) &&
        instance.collection.lookup(reference.nameBytes, reference.index) === object;
    if (!live()) return false;
    if (this.publicPushPending.size) {
      this.enqueuePublicPush(() => live() && instance.dispatchEvent(object, event));
      return true;
    }
    const { handled, completion } = this.publicEventStep(instance, object, event);
    if (completion) this.trackPublicCompletion(completion);
    return handled;
  }
  publicEventStep(instance, object, event) {
    const name = fesByteView(instance.collection.reference(object).nameBytes),
      labels = [object.defaultHandler && `${object.defaultHandler}.${event}`, `${name}.${event}`];
    if (
      instance.finished !== null ||
      !labels.some((label) => label && instance.program.blocks[label])
    )
      return { handled: false, completion: null };
    if (this.error) throw this.error;
    let outcome;
    const promise = instance.dispatchEvent(object, event, (value) => {
      outcome = value;
    });
    if (outcome) {
      if (outcome.failed) {
        const error = outcome.error;
        // This exact rejection has already been delivered synchronously. Keep
        // any different unexpected failure visible through the usual flush.
        promise.catch((reason) => {
          if (reason !== error) this.error = reason;
        });
        throw error;
      }
      return { handled: outcome.handled, completion: null };
    }
    // The H1 observer reports settlement after its sole owner restores the caller.
    // This step never registers or waits on the public tail itself.
    return { handled: true, completion: promise };
  }
  async flush({ commandsOnly = false } = {}) {
    while (this.pending.size || (!commandsOnly && this.publicPushPending.size))
      await Promise.all([...this.pending, ...(commandsOnly ? [] : this.publicPushPending)]);
    if (this.error) throw this.error;
  }
  async step() {
    await this.flush();
    this.frameCount++;
    for (const s of this.instances) {
      await s.flushNativeRecords();
      s.runtime?.beforeStep();
      const tick = async () => {
        if (s.waitSound !== null) {
          const object = s.waitObject(s.waitSound);
          if (!object) {
            const reference = s.runtime
              ? `${fesByteView(s.waitSound.nameBytes)}[${s.waitSound.index}]`
              : s.waitSound;
            throw new Error(`${s.name}: waiting sound object ${reference} disappeared`);
          }
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
        await s.flushNativeRecords();
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
      if (!s.runtime) for (const o of s.objects) o.advance(this.frameCount);
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
      this.expand(
        this.instances
          .flatMap((s) => s.program.sources.map(({ bytes }) => decodeText(bytes)))
          .join('\n'),
      ).match(/[\w%-]+/g) || [],
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
    if (instance.runtime) instance.runtime.queueBaseImage(object);
    else if (this.nativeGraphics) this.enqueue(this.nativeGraphics.baseImage(instance, object));
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
            (!s.keyNames.size ||
              s.keyNames.has(
                s.runtime ? fesByteView(s.collection.reference(o).nameBytes) : o.baseName,
              )) &&
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
      object =
        key == null
          ? null
          : instance.runtime
            ? instance.collection.lookup(key.nameBytes, key.index)
            : instance.byKey.get(key);
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
    if (target.s.runtime && target.o.type === 'BUTTON' && target.o.nativeType === 6)
      return this.completePublicClick(target.s, target.o);
    this.focus(target);
    if (target.o.type === 'BUTTON') this.press();
    else this.slide(target, x, y);
    return true;
  }
  press() {
    const target = this.focused;
    if (!target || !target.o.enable || !this.instances.includes(target.s)) return false;
    if (target.s.runtime) return this.completePublicPress(target.s, target.o);
    target.s.event(target.o, 'PUSH_L');
    target.s.clickL = target.o.handle;
    target.s.event(target.o, 'RELEASE_L');
    return true;
  }
  completePublicClick(instance, object) {
    const complete = this.publicClickOperation(instance, object);
    if (this.publicPushPending.size) this.enqueuePublicPush(() => complete(true));
    else {
      const completion = complete(false);
      if (completion) this.trackPublicCompletion(completion);
    }
    return true;
  }
  publicClickOperation(instance, object) {
    const runtime = instance.runtime,
      record = runtime.world.objects.objects.get(instance.runtimeID),
      reference = instance.collection.reference(object),
      live = () =>
        this.publicEventLive(instance, runtime, record, object) &&
        instance.collection.lookup(reference.nameBytes, reference.index) === object,
      press = (afterBoundary) => {
        const pressed = this.focused;
        if (!pressed || !pressed.o.enable || !this.instances.includes(pressed.s)) return null;
        return this.publicPressOperation(pressed.s, pressed.o)(afterBoundary);
      },
      focus = (afterBoundary) => {
        if (afterBoundary && !live()) return null;
        const completion = live()
          ? this.publicEventStep(instance, object, 'FOCUS').completion
          : null;
        if (completion) return completion.then(() => (live() ? press(true) : null));
        return afterBoundary && !live() ? null : press(afterBoundary);
      };
    return (afterBoundary) => {
      if (afterBoundary && !live()) return null;
      const previous = this.focused;
      if (previous?.o === object) return press(afterBoundary);
      let completion = null;
      if (previous && this.instances.includes(previous.s)) {
        const oldRuntime = previous.s.runtime;
        if (oldRuntime) {
          const oldRecord = oldRuntime.world.objects.objects.get(previous.s.runtimeID),
            oldLive = this.publicEventLive(previous.s, oldRuntime, oldRecord, previous.o),
            oldReference = oldLive ? previous.s.collection.reference(previous.o) : null;
          if (
            oldReference &&
            previous.s.collection.lookup(oldReference.nameBytes, oldReference.index) === previous.o
          )
            completion = this.publicEventStep(previous.s, previous.o, 'UNFOCUS').completion;
        }
      }
      // Commit once after UNFOCUS's synchronous prefix, even when it awaits.
      this.focused = { s: instance, o: object };
      if (completion) return completion.then(() => (live() ? focus(true) : null));
      return focus(afterBoundary);
    };
  }
  completePublicPress(instance, object) {
    const complete = this.publicPressOperation(instance, object);
    if (this.publicPushPending.size) this.enqueuePublicPush(() => complete(true));
    else {
      const completion = complete(false);
      if (completion) this.trackPublicCompletion(completion);
    }
    return true;
  }
  publicPressOperation(instance, object) {
    const runtime = instance.runtime,
      record = runtime.world.objects.objects.get(instance.runtimeID),
      reference = this.publicEventLive(instance, runtime, record, object)
        ? instance.collection.reference(object)
        : null,
      live = () =>
        reference !== null &&
        this.publicEventLive(instance, runtime, record, object) &&
        instance.collection.lookup(reference.nameBytes, reference.index) === object,
      dispatch = (event) =>
        live() ? this.publicEventStep(instance, object, event).completion : null,
      release = () => {
        instance.clickL = object.handle;
        return dispatch('RELEASE_L');
      },
      complete = (queued) => {
        if (queued && !live()) return null;
        const completion = dispatch('PUSH_L');
        if (completion) return completion.then(() => (live() ? release() : null));
        // Preserve the existing inline field write even if a synchronous
        // callback removed its object. Queued/awaited actions use P1 cancellation.
        return queued && !live() ? null : release();
      };
    return complete;
  }
  push(target) {
    for (const s of this.instances.toReversed()) {
      const o =
        target == null
          ? null
          : s.runtime
            ? s.collection.lookup(target.nameBytes, target.index)
            : s.byKey.get(target);
      if (o?.enable && s.placement(o).shown) {
        if (s.runtime) {
          const runtime = s.runtime,
            record = runtime.world.objects.objects.get(s.runtimeID),
            reference = s.collection.reference(o);
          this.enqueuePublicPush(() => this.completePublicPush(s, reference, runtime, record));
          return true;
        }
        this.focus({ s, o });
        return this.press();
      }
    }
    return false;
  }
  async completePublicPush(instance, reference, runtime, record) {
    const live = (...args) => this.publicEventLive(...args);
    if (!live(instance, runtime, record)) return;
    const object = instance.collection.lookup(reference.nameBytes, reference.index);
    if (
      !object?.enable ||
      !live(instance, runtime, record, object) ||
      !instance.placement(object).shown
    )
      return;
    const previous = this.focused;
    if (previous?.o !== object) {
      if (previous && this.instances.includes(previous.s)) {
        const oldRuntime = previous.s.runtime,
          oldRecord = oldRuntime.world.objects.objects.get(previous.s.runtimeID);
        if (!live(previous.s, oldRuntime, oldRecord, previous.o)) return;
        await previous.s.dispatchEvent(previous.o, 'UNFOCUS');
        if (!live(instance, runtime, record, object)) return;
      }
      this.focused = { s: instance, o: object };
      await instance.dispatchEvent(object, 'FOCUS');
      if (!live(instance, runtime, record, object)) return;
    }
    // FOCUS may select another object. Like press(), capture the current target
    // once for PUSH and RELEASE rather than replacing it with the request.
    const pressed = this.focused;
    if (!pressed || !pressed.o.enable || !this.instances.includes(pressed.s)) return;
    const pressedRuntime = pressed.s.runtime,
      pressedRecord = pressedRuntime.world.objects.objects.get(pressed.s.runtimeID),
      stillPressed = () => live(pressed.s, pressedRuntime, pressedRecord, pressed.o);
    if (!stillPressed()) return;
    await pressed.s.dispatchEvent(pressed.o, 'PUSH_L');
    if (!stillPressed()) return;
    pressed.s.clickL = pressed.o.handle;
    await pressed.s.dispatchEvent(pressed.o, 'RELEASE_L');
  }
  rightClick() {
    const s = this.instances.at(-1);
    const target = this.focused?.s === s ? this.focused : null;
    if (s?.runtime) {
      this.completePublicRightClick(s, target?.o ?? null);
      return;
    }
    if (s) s.clickR = target?.o.handle || -1;
    if (target) {
      s.event(target.o, 'PUSH_R');
      s.event(target.o, 'RELEASE_R');
    }
  }
  completePublicRightClick(instance, object) {
    const runtime = instance.runtime,
      record = runtime.world.objects.objects.get(instance.runtimeID),
      reference =
        object && this.publicEventLive(instance, runtime, record, object)
          ? instance.collection.reference(object)
          : null,
      live = () =>
        this.publicEventLive(instance, runtime, record, object) &&
        (!object ||
          (reference !== null &&
            instance.collection.lookup(reference.nameBytes, reference.index) === object)),
      dispatch = (event) =>
        live() ? this.publicEventStep(instance, object, event).completion : null,
      complete = (queued) => {
        if (queued && !live()) return null;
        // Public right click commits before PUSH, including the no-target -1.
        instance.clickR = object?.handle || -1;
        if (!object) return null;
        const completion = dispatch('PUSH_R');
        if (completion) return completion.then(() => dispatch('RELEASE_R'));
        return dispatch('RELEASE_R');
      };
    if (this.publicPushPending.size) this.enqueuePublicPush(() => complete(true));
    else {
      const completion = complete(false);
      if (completion) this.trackPublicCompletion(completion);
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
        all.find((c) =>
          c.s.runtime
            ? c.s.defaultButton &&
              c.s.collection.lookup(c.s.defaultButton.nameBytes, c.s.defaultButton.index) === c.o
            : c.o.key === c.s.defaultButton,
        ) ||
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
    const { s, o } = target;
    if (s.runtime && (o.nativeType === 14 || o.nativeType === 15)) {
      const value = this.nativeControls.projectSlideValue(s, o, x, y);
      if (value !== null && value !== o.value) {
        setFESControlValue(o, value, 0);
        s.event(o, 'SCRL_P');
        s.scrollPosition = o.handle;
      }
      return;
    }
    const at = s.placement(o),
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
    if (this.publicPushPending.size)
      throw new Error('Cannot snapshot FES while a public push is in flight');
    const instance = (s) =>
      s
        ? {
            name: s.name,
            program: s.program,
            runtime: s.runtime?.snapshot() ?? null,
            ...(s.runtime
              ? {
                  nativeContext: {
                    nameBytes: s.nativeContext.nameBytes.slice(),
                    index: s.nativeContext.index,
                    current: s.nativeContext.current,
                  },
                }
              : {}),
            label: s.label,
            ...(this.nativeVariableContext
              ? { nativeVariableContextKey: s.nativeVariableContextKey }
              : { locals: s.locals }),
            exitCode: s.exitCode,
            childTaskID: s.childTaskID,
            kcsTaskID: s.kcsTaskID,
            cgGallery: s.cgGallery?.snapshot() ?? null,
            finished: s.finished,
            suspended: s.suspended,
            waitFrames: s.waitFrames,
            waitMotion: s.waitMotion,
            waitSound: s.waitSound,
            waitObjects: s.waitObjects,
            frameOrigin: s.frameOrigin,
            defaultButton: structuredClone(s.defaultButton),
            transitionUntil: s.transitionUntil,
            keySkipEnabled: s.keySkipEnabled,
            keySkipControlOnly: s.keySkipControlOnly,
            keySkipContinuous: s.keySkipContinuous,
            keySkipForced: s.keySkipForced,
            skipPressed: s.skipPressed,
            skipControl: s.skipControl,
            inputPropagation: s.inputPropagation,
            touch: s.touch ?? 0,
            forceRedrawPending: s.forceRedrawPending,
            resultValue: s.resultValue,
            commandDelayUntil: s.commandDelayUntil,
            deferredCommandReturn: s.deferredCommandReturn,
            decodePending: s.decodePending,
            nativeQueuePending: s.nativeQueuePending,
            dynamicDefinitions: s.dynamicDefinitions,
            keyNames: [...s.keyNames],
            macros: [...s.macros],
            nativeDictionary: s.nativeDictionary.snapshot(),
            objects: s.runtime
              ? null
              : s.objects.map((o) => ({ ...o, motionState: o.motionTarget?.snapshot() })),
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
      let nativeContext;
      if (this.runtimeFactory) {
        const context = saved.nativeContext;
        if (
          !context ||
          !(context.nameBytes instanceof Uint8Array) ||
          context.nameBytes.length > 31 ||
          context.nameBytes.includes(0) ||
          ![context.index, context.current].every(
            (word) => Number.isInteger(word) && word >= -0x80000000 && word <= 0x7fffffff,
          )
        )
          throw new TypeError('Invalid FES native context snapshot');
        nativeContext = {
          nameBytes: context.nameBytes.slice(),
          index: context.index,
          current: context.current,
        };
      }
      if (saved.program.sourceKey)
        (this.nativeSources || this.localSources).validateProgram(
          saved.program.sourceKey,
          saved.program,
        );
      const s = new FESInstance(saved.name, structuredClone(saved.program), this, {
        nativeVariableContextKey: saved.nativeVariableContextKey,
        macros: saved.macros,
        restoring: true,
      });
      if (s.runtime) s.nativeContext = nativeContext;
      if (!Array.isArray(saved.keyNames)) throw new TypeError('Invalid FES keyboard name snapshot');
      for (const name of saved.keyNames) {
        if (typeof name !== 'string' || s.keyNames.has(name))
          throw new TypeError('Invalid FES keyboard name snapshot');
        s.keyNames.add(name);
      }
      s.nativeDictionary.restore(saved.nativeDictionary);
      s.dynamicDefinitions = structuredClone(saved.dynamicDefinitions);
      if (s.runtime) await s.runtime.restore(saved.runtime);
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
        'touch',
        'forceRedrawPending',
        'resultValue',
        'commandDelayUntil',
        'deferredCommandReturn',
        'decodePending',
        'nativeQueuePending',
      ])
        s[key] = structuredClone(saved[key]);
      if (!s.program.blocks[s.label]) throw new Error('Save refers to missing FES block');
      s.cgGallery = saved.cgGallery ? CGGallery.restore(saved.cgGallery) : null;
      if (!s.runtime)
        for (const o of saved.objects) {
          const { motionState, ...fields } = o,
            target = s.add(o.type, o.baseName, o.index);
          Object.assign(target, structuredClone(fields));
          if (motionState) {
            if (!this.motionLibrary)
              throw new Error('Restoring FES motion requires its MOT library');
            await target.attachMotion(this.motionLibrary).restore(motionState);
          }
        }
      return s;
    };
    this.root = await instance(state.root);
    if (!this.nativeInput) this.focused = null;
    this.dragging = null;
  }
}
