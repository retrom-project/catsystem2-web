// SPDX-License-Identifier: MPL-2.0
import { decodeText } from './binary.mjs';
import { pointToRoot } from './emote/draw-list.mjs';
export class EngineHost {
  constructor(engine) {
    this.engine = engine;
  }
  get log() {
    return this.engine.story?.log || [];
  }
  config(name) {
    if (this.engine.settings[name] !== undefined) return this.engine.settings[name];
    if (name === 'wndcolor') {
      const node = this.engine.startup.node('GAME', 'wndcolor');
      return (
        ((Number(node?.value('a')) || 80) << 24) |
        (Number(node?.value('r')) << 16) |
        (Number(node?.value('g')) << 8) |
        Number(node?.value('b')) |
        0
      );
    }
    return (
      {
        lang_ui: 0,
        lang_text_main: 0,
        lang_text_sub: -1,
        messpd: 2,
        messize: 2,
        wndalpha: 100,
        wndframe: 1,
        m2_iner_lv_bust: 100,
      }[name] ?? 0
    );
  }
  setConfig(name, value) {
    this.engine.settings[name] = value;
    this.engine.persistSettings();
    if (name.startsWith('lang_')) {
      this.engine.updateLanguage();
      for (const p of [
        this.engine.titleFES,
        this.engine.windowFES,
        this.engine.extraFES,
        this.engine.modal?.player,
      ])
        if (p) p.enqueue(p.refreshImages());
    }
  }
  soundConfig(args) {
    return this.engine.settings[`sound:${args.join(':')}`] ?? 80;
  }
  setSoundConfig(args, value) {
    this.engine.settings[`sound:${args.join(':')}`] = value;
    if (args[0] === 'volume') this.engine.audio.setGroup(args[1], value);
    this.engine.persistSettings();
  }
  async sound(sound) {
    await this.engine.audio.play(sound);
    if (sound.channel === 'voice' && sound.file) await this.engine.emote.levels(sound.file);
  }
  soundControl(channel, args) {
    this.engine.audio.control(channel, args);
  }
  soundBusy(channel) {
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
    this.engine.particles.command(verb, args);
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
    return globalThis.prompt?.('Comment', defaultText) ?? '';
  }
  async systemAction(code) {
    const e = this.engine;
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
  async send(values, instance) {
    const e = this.engine,
      [code, a, b] = values;
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
