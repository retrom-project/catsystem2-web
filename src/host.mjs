// SPDX-License-Identifier: MPL-2.0
import { decodeText } from './binary.mjs';
import { CanvasTextGlyphs } from './render/native-text.mjs';
import { pointToRoot } from './emote/draw-list.mjs';
import { BrowserNativeMovie } from './native/movie-browser.mjs';
import { BrowserNativeWindow } from './native/window-browser.mjs';
import { BrowserNativeClipboard } from './native/clipboard-browser.mjs';
export class EngineHost {
  nativeMovie(_name, _owner, world) {
    return new BrowserNativeMovie({
      game: world.game,
      container: this.engine.video?.parentElement ?? this.engine.canvas.parentElement,
      width: world.graphics.view.clientWidth,
      height: world.graphics.view.clientHeight,
      diagnostic: (detail) => this.nativeDiagnostic?.(detail),
    });
  }
  nativeWindowActive() {
    return document.hasFocus();
  }
  nativeTextGlyphs() {
    return new CanvasTextGlyphs({
      family: (name) => this.engine.renderer.fonts.get(name.toLowerCase()) || name,
    });
  }
  constructor(engine) {
    this.engine = engine;
    this.steam = engine.steam;
  }
  postWindowMessage(message) {
    this.engine.world.windowMessages.push({
      message: message.message >>> 0,
      wParam: message.wParam >>> 0,
      lParam: message.lParam >>> 0,
    });
  }
  nativeWindowAction(action, world) {
    this.windowService ??= new BrowserNativeWindow(this.engine);
    return this.windowService.perform(action, world);
  }
  nativeDispose() {
    this.windowService?.close();
    this.clipboardService?.close();
  }
  get nativeClipboard() {
    return (this.clipboardService ??= new BrowserNativeClipboard({
      diagnostic: (detail) => this.nativeDiagnostic(detail),
    }));
  }
  nativeDebugOutput(bytes) {
    this.nativeLog(new TextDecoder('shift_jis').decode(bytes));
  }
  get log() {
    return this.engine.story?.log || [];
  }
  config(name, ex1 = 0, ex2 = 0, context = {}) {
    const service = this.engine.world?.fesConfiguration;
    if (!service) throw new Error('FES configuration requires an initialized native world');
    return context.m2 ? service.getM2(name, context.part) : service.get(name, ex1, ex2);
  }
  setConfig(name, value, ex1 = 0, ex2 = 0, context = {}) {
    const service = this.engine.world?.fesConfiguration;
    if (!service) throw new Error('FES configuration requires an initialized native world');
    return context.m2
      ? service.setM2(name, value, context.part)
      : service.set(name, value, ex1, ex2, context);
  }
  soundConfig(args, context = {}) {
    const service = this.engine.world?.fesSoundConfiguration;
    if (!service) throw new Error('FES sound configuration requires an initialized native world');
    return service.get(args, context);
  }
  soundConfigTokens(line) {
    const service = this.engine.world?.fesSoundConfiguration;
    if (!service) throw new Error('FES sound configuration requires an initialized native world');
    return service.tokens(line);
  }
  setSoundConfig(args, value, context = {}) {
    const service = this.engine.world?.fesSoundConfiguration;
    if (!service) throw new Error('FES sound configuration requires an initialized native world');
    return service.set(args, value, context);
  }
  soundSelector(args, context = {}, write = false) {
    const service = this.engine.world?.fesSoundConfiguration;
    if (!service) throw new Error('FES sound configuration requires an initialized native world');
    return service.selector(args, context, write);
  }
  async sound(sound) {
    await this.engine.audio.play(sound);
    if (sound.channel === 'voice' && sound.file) await this.engine.emote.levels(sound.file);
  }
  async soundCommand(command) {
    const result = await this.engine.audio.command(command);
    if (result.handled && command.group === 'pcm')
      for (const bank of result.banks) if (bank.file) await this.engine.emote.levels(bank.file);
    return result;
  }
  async startKCS(name, owner) {
    const world = this.engine.world,
      runtime = world?.runtime;
    if (!runtime) throw new Error('The native world has not been initialized');
    const previous = runtime.scheduler.tasks.get(owner.kcsTaskID);
    if (previous && !['finished', 'cancelled', 'failed'].includes(previous.status))
      return previous.id;
    let parent = owner;
    while (parent.parent) parent = parent.parent;
    if (!Number.isSafeInteger(parent.runtimeID))
      throw new Error('FES KCS helper has no native parent task');
    const task = await world.spawnScript(name, { parent: parent.runtimeID, initialExecute: true });
    return task.id;
  }
  endKCS(id) {
    const world = this.engine.world;
    if (!world) throw new Error('The native world has not been initialized');
    if (id) return world.objects.destroy(id);
  }
  openGallery(...args) {
    return this.engine.world.galleries.open(...args);
  }
  nativeFESLoaded(record, player, world) {
    if (world !== this.engine.world) return;
    this.engine.nativeFES.set(record.id, player);
  }
  nativeIsWindow() {
    return !document.fullscreenElement;
  }
  nativeTitleChanged(title, world) {
    if (world === this.engine.world) document.title = title;
  }
  async nativeWindowMessage(message, world) {
    if (message.message === 0x467) {
      const mode = message.lParam >>> 0;
      if (mode > 1) return; // Original 53255F accepts only window/fullscreen.
      const surface = this.engine.canvas.closest('#stage') || this.engine.canvas;
      try {
        if (mode && !document.fullscreenElement) await surface.requestFullscreen();
        else if (!mode && document.fullscreenElement) await document.exitFullscreen();
      } catch (error) {
        world.host.nativeDiagnostic?.({ type: 'fullscreen-request', error: error.message });
      }
      this.engine.nativeWindowStateChanged();
    }
    this.engine.onNativeWindowMessage?.(message, world);
  }
  nativeFESClosed(record, world) {
    if (world === this.engine.world) this.engine.nativeFES.delete(record.id);
  }
  bindFESSurface(record, surface) {
    const graphics = this.engine.world.graphics;
    if (!graphics.bindFES) throw new Error('Native FES surface binding has not been implemented');
    graphics.bindFES(surface, record.implementation.player);
    record.implementation.surface = surface;
  }
  imageLoaded(request) {
    this.engine.onImageLoaded?.(request);
  }
  nativeLog(text) {
    this.engine.nativeLog ??= [];
    this.engine.nativeLog.push(text);
  }
  nativeDiagnostic(detail) {
    this.engine.nativeDiagnostics ??= [];
    this.engine.nativeDiagnostics.push(detail);
  }
  nativeCursorChanged(visible, world = this.engine.world) {
    if (world !== this.engine.world) return;
    this.engine.canvas.style.cursor = visible && !world.graphics.cursor.state.image ? '' : 'none';
  }
  async nativeCursorImageChanged(name, x, y, world = this.engine.world) {
    return world.graphics.cursor.setImage(name, x, y);
  }
  nativeMenuChanged(id, enabled) {
    this.engine.onNativeMenuChanged?.(id, enabled);
  }
  soundControl(channel, args) {
    this.engine.audio.control(channel, args);
  }
  soundBusy(channel, bank = null) {
    if (channel === 'voice' || channel === 'se')
      return [...this.engine.audio.channels.values()].some(
        (c) => c.group === channel && (bank === null || c.bank === bank) && c.playing,
      );
    return !!this.engine.audio.channels.get(channel)?.playing;
  }
  actorBusy(group) {
    return (!group || group === 'mpl') && this.engine.emote.busy(this.engine.story.stage.frame);
  }
  finishMotions() {
    this.engine.emote.finish(this.engine.story.stage.frame);
  }
  async waitTag(name, offset) {
    const voice = this.engine.audio.voiceInfo(),
      target = voice.tags?.[name];
    return voice.playing && target !== undefined
      ? { file: voice.file, time: Math.max(0, target - offset / 60) }
      : null;
  }
  tagReady(wait) {
    const voice = this.engine.audio.voiceInfo();
    return !voice.playing || voice.file !== wait.file || voice.time >= wait.time;
  }
  async attribute(bank, number) {
    return this.engine.emote.attribute(this.engine.story.stage, bank, number);
  }
  particle(verb, args) {
    return this.engine.particles.command(verb, args);
  }
  particleBusy(bank) {
    return this.engine.particles.busy(bank);
  }
  message(message) {
    this.engine.message(message);
  }
  async view(shown, theme = 'default') {
    await this.engine.setView(shown, theme);
  }
  showWindow(shown) {
    for (const p of [this.engine.windowFES, this.engine.extraFES])
      p?.root?.invoke('MES_SHOW', [Number(shown)]);
  }
  clearMessage() {
    this.engine.windowFES?.root?.invoke('MES_CLEAR');
  }
  transition(frames, kind = 'rdraw', mask) {
    this.engine.setTransition(frames, kind, mask);
  }
  snapshotBase() {
    this.engine.renderer.snapshotBase();
  }
  returnToTitle() {
    this.engine.pendingTitle = true;
  }
  end() {
    this.engine.pendingTitle = true;
  }
  hint() {}
  unsupported(command) {
    this.engine.unsupported.add(command);
  }
  openFES(name, parameters) {
    return this.engine.openModal(name, parameters);
  }
  closeModal() {
    this.engine.modal = null;
  }
  modalActive() {
    return !!this.engine.modal;
  }
  movie(name) {
    return this.engine.playMovie(name);
  }
  movieActive() {
    return this.engine.video && !this.engine.video.ended && !this.engine.video.paused;
  }
  saveInfo(slot) {
    return this.engine.saves.get(slot);
  }
  newestSave(from, count) {
    return this.engine.saves.newest(from, count);
  }
  captureThumbnail() {
    const e = this.engine,
      thumbnail = document.createElement('canvas');
    thumbnail.width = Number(e.adv.value('save', 'thumbnail', 'width')) || 186;
    thumbnail.height = Number(e.adv.value('save', 'thumbnail', 'height')) || 105;
    thumbnail.getContext('2d').drawImage(e.canvas, 0, 0, thumbnail.width, thumbnail.height);
    return thumbnail.toDataURL('image/jpeg', 0.85);
  }
  async save(slot) {
    const e = this.engine;
    if (!e.story) {
      if (slot >= e.temporarySaveStart) {
        e.persistSettings();
        return;
      }
      throw new Error('No story is running to save');
    }
    const data = await e.snapshot(false);
    await e.saves.put(slot, data, {
      title: e.story.title || e.story.stack.at(-1)?.name || '',
      comment: e.story.currentMessage?.text || '',
      thumbnail: e.modal?.thumbnail || this.captureThumbnail(),
    });
    e.setFlag(
      slot >= e.quickSaveStart ? 'savenew_quick' : 'savenew',
      slot >= e.quickSaveStart ? slot - e.quickSaveStart : slot,
    );
    e.windowFES?.root?.invoke('MES_COMP_QSAVE');
  }
  async deleteSave(slot) {
    await this.engine.saves.delete(slot);
  }
  async copySave(from, to) {
    const record = this.engine.saves.get(from);
    if (record) await this.engine.saves.put(to, record.data, record);
  }
  async playLogVoice(index) {
    const voice = this.log[index]?.voice;
    if (voice) await this.sound({ channel: 'voice', file: voice, group: 'voice' });
  }
  inputText(defaultText) {
    return globalThis.prompt?.('Comment', defaultText) ?? null;
  }
  async systemAction(code) {
    const e = this.engine;
    if (e.world) {
      const instance = e.activeFES()?.root;
      if (!instance) throw new Error('No active native FES task can receive a system action');
      return this.send([0xffff0003, 0, code], instance);
    }
    switch (code) {
      case 3:
        e.story.windowVisible = !e.story.windowVisible;
        this.showWindow(e.story.windowVisible);
        break;
      case 13:
        e.skip = !e.skip;
        break;
      case 14:
        e.auto = !e.auto;
        break;
      case 15:
      case 16:
        await e.openModal(e.theme.value('log', 'script') || 'hist_b');
        break;
      case 17:
        e.pendingTitle = true;
        break;
      case 18:
        await this.playLogVoice(this.log.length - 1);
        break;
      case 19:
      case 20:
      case 24:
      case 25:
        e.setFlag('sltype', code === 19 || code === 24 ? 0 : 1);
        e.setFlag('slmode', 1);
        await e.openModal('saveload');
        break;
      case 21:
      case 26: {
        const count = Number(e.adv.value('save', 'quicksave', 'count')) || 12;
        const previous = e.saves.newest(e.quickSaveStart, count);
        await this.save(
          e.quickSaveStart + (previous < 0 ? 0 : (previous - e.quickSaveStart + 1) % count),
        );
        break;
      }
      case 22:
      case 27: {
        const slot = e.saves.newest(
          e.quickSaveStart,
          Number(e.adv.value('save', 'quicksave', 'count')) || 12,
        );
        if (slot >= 0) e.pendingLoad = e.saves.get(slot).data;
        break;
      }
      case 23:
      case 28:
        await e.openModal('config');
        break;
      case 100:
        e.touchEnabled = true;
        e.pendingTouchEnter = true;
        break;
      default:
        e.unsupported.add(`system action ${code}`);
    }
  }
  async send(values, instance, { target = 'parent' } = {}) {
    const e = this.engine,
      [code, a, b] = values;
    if (e.world) {
      let root = instance;
      while (root.parent) root = root.parent;
      const record = e.world.objects.objects.get(root.runtimeID);
      if (!record) throw new Error('FES message sender has no native task');
      const id = target === 'script' ? instance.kcsTaskID : record.parent;
      if (target !== 'parent' && target !== 'script')
        throw new Error(`Unknown FES message destination ${target}`);
      if (id === null || id === undefined || (target === 'script' && !id)) return 0;
      return (await e.nativeRuntime.scheduler.send(id, [record.id, code >>> 0, a >>> 0, b >>> 0]))
        .result;
    }
    switch (code >>> 0) {
      case 0xfffe0001:
        e.strings[b] = this.log[a]?.speaker || '';
        break;
      case 0x300:
        e.skipAllowed = b !== 0;
        break;
      case 0x400:
        e.sceneHidden = true;
        break;
      case 0x401:
        e.sceneHidden = false;
        break;
      case 0x402:
        e.systemButtons = !!b;
        break;
      case 0x403:
        break;
      case 0x405:
        instance.setLocal(0, Number(!!e.story));
        break;
      case 0x406:
      case 0x407:
        break;
      case 0x600:
        await e.audio.context.suspend();
        break;
      case 0x601:
        await e.audio.context.resume();
        break;
      case 0x503:
        e.renderer.snapshotBase();
        break;
      case 0x504:
        break;
      case 0x700: {
        const p = e.windowFES?.root?.byKey.get('pl');
        if (p) {
          p.x += a;
          p.y += b;
        }
        break;
      }
      case 0x780:
        e.touchEnabled = true;
        e.pendingTouchEnter = true;
        break;
      case 0x781:
        e.touchEnabled = false;
        break;
      case 0x783:
        break;
      case 0x784:
        instance.setLocal(0, Number(!!e.emote.hit(e.story.stage, a, b)));
        break;
      case 0x782: {
        const reaction = e.emote.touch(e.story.stage, a, b);
        if (reaction?.voice)
          await this.sound({ channel: 'voice', file: reaction.voice, group: 'voice' });
        break;
      }
      default:
        e.unsupported.add(`FES send ${(code >>> 0).toString(16)}`);
    }
  }
  async speakerTable() {
    const bytes = await this.engine.game.read('nametable.csv'),
      names = new Map();
    if (bytes)
      for (const line of decodeText(bytes).split(/\r?\n/)) {
        const m = /^\s*(\d+)[\t ]+([^\t]+)/.exec(line);
        if (m) names.set(m[2].trim(), +m[1]);
      }
    return names;
  }
  async drawFace(object, context, at) {
    const e = this.engine,
      drawing = e.emote.drawing(e.story.stage, object.index, e.audio.voiceInfo(), true);
    if (!drawing) return;
    const { list } = drawing,
      head = list.items.find((i) => i.label.includes('輪郭'));
    if (!head) return;
    const centre = pointToRoot(list.nodes, head.node, 0, 0),
      width = object.areaWidth || 185,
      height = object.areaHeight || 104;
    list.nodes[0].transform[4] += at.x + width / 2 - centre[0];
    list.nodes[0].transform[5] += at.y + height / 2 - centre[1];
    context.save();
    context.beginPath();
    context.rect(at.x, at.y, width, height);
    context.clip();
    context.drawImage(e.emote.gpu.render(drawing.model, list, drawing.alpha), 0, 0);
    context.restore();
  }
}
