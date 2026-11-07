// SPDX-License-Identifier: MPL-2.0
import { decodeText } from './binary.mjs';
import { ImageStore } from './formats/hg3.mjs';
import { BootHost, KCSMachine, readKCS } from './kcs.mjs';
import { FESPlayer } from './fes/player.mjs';
import { ScenePlayer, cleanText } from './scene.mjs';
import { EmoteProfiles } from './emote/profiles.mjs';
import { EmoteRuntime } from './emote/runtime.mjs';
import { EmoteGL } from './render/emote-gl.mjs';
import { CanvasRenderer } from './render/canvas.mjs';
import { StageRenderer } from './render/stage.mjs';
import { AudioMixer } from './audio.mjs';
import { SaveStore } from './saves.mjs';
import { parseXML, XMLNode } from './xml.mjs';
import { EngineHost } from './host.mjs';
import { Particles } from './particles.mjs';
import { Transition } from './render/transition.mjs';

export class CatSystem2 {
  constructor({ game, canvas, audioContext, video, onState = () => {} }) {
    Object.assign(this, {
      game,
      canvas,
      video,
      onState,
      globals: {},
      strings: {},
      unsupported: new Set(),
      story: null,
      modal: null,
      windowFES: null,
      titleFES: null,
      skip: false,
      auto: false,
      skipAllowed: true,
      settings: {},
      pendingTitle: false,
      pendingLoad: null,
      sceneHidden: false,
      themeName: null,
      mode: 'loading',
      vmEvidence: [],
      disposed: false,
      lastWait: false,
      frame: 0,
    });
    this.history = new Map();
    canvas.width = game.width;
    canvas.height = game.height;
    this.images = new ImageStore(game);
    this.renderer = new CanvasRenderer(canvas, this.images);
    this.audio = new AudioMixer(game, audioContext);
    this.host = new EngineHost(this);
  }
  async initialize() {
    const xml = async (name) => {
      const bytes = await this.game.read(name);
      return bytes ? parseXML(decodeText(bytes)) : new XMLNode('document');
    };
    [this.startup, this.adv, this.profiles] = await Promise.all([
      xml('startup.xml'),
      xml('adv.xml'),
      EmoteProfiles.load(this.game),
    ]);
    this.languages = (this.startup.node('language')?.children || [])
      .filter((n) => /^L\d+$/i.test(n.name))
      .map((n) => ({ code: n.value('prefix'), name: n.value('lang') }));
    if (!this.languages.length) this.languages = [{ code: 'jp', name: 'Japanese' }];
    this.identity = await this.game.fingerprint();
    try {
      this.settings = JSON.parse(
        localStorage.getItem(`catsystem2:${this.identity}:settings`) || '{}',
      );
    } catch {
      this.settings = {};
    }
    this.saves = new SaveStore(this.identity);
    await this.saves.open();
    this.quickSaveStart = Number(this.adv.value('save', 'quicksave', 'start')) || 5000;
    this.temporarySaveStart = Number(this.adv.value('save', 'autoerase', 'start')) || 7000;
    this.emote = new EmoteRuntime(
      this.game,
      this.profiles,
      new EmoteGL(this.game.width, this.game.height),
    );
    this.stageRenderer = new StageRenderer(this.renderer, this.emote);
    this.names = await this.host.speakerTable();
    await this.renderer.loadFonts(this.game);
    const main = this.startup.value('SCRIPT', 'start').split('/').pop() || 'main.kcs';
    const event = await this.runKCS(main, new Set([0x1bf]));
    if (!event?.text) throw new Error('Boot KCS did not start a FES script');
    this.flowName = event.text;
    await this.startTitle();
    this.mode = 'title';
    this.onState(this.status());
  }
  fes() {
    const p = new FESPlayer(this.game, this.images, this.host, this.globals, this.strings);
    p.language = this.language('lang_ui');
    p.languageMain = this.language('lang_text_main');
    return p;
  }
  language(setting) {
    return this.languages[this.host.config(setting)]?.code || this.languages[0].code;
  }
  updateLanguage() {
    for (const p of [this.titleFES, this.windowFES, this.extraFES, this.modal?.player])
      if (p) {
        p.language = this.language('lang_ui');
        p.languageMain = this.language('lang_text_main');
      }
    if (this.story) {
      this.story.language = this.language('lang_text_main');
      const message = this.story.currentMessage,
        translated = message
          ? this.story.scripts.get(message.scene)?.translation?.[this.story.language]?.[
              message.index
            ]
          : null;
      if (
        translated &&
        (message.text !== cleanText(translated.text) || message.speaker !== translated.speaker)
      ) {
        message.text = cleanText(translated.text);
        message.speaker = translated.speaker;
        this.message(message);
        Object.assign(this.story.log.at(-1), message);
      }
    }
  }
  persistSettings() {
    localStorage.setItem(`catsystem2:${this.identity}:settings`, JSON.stringify(this.settings));
  }
  setFlag(name, value) {
    const n = Number(this.adv.value('sysflag', name));
    if (Number.isInteger(n) && this.adv.value('sysflag', name)) this.globals[n] = value;
  }
  flag(name) {
    const n = Number(this.adv.value('sysflag', name));
    return this.globals[n] || 0;
  }
  async runKCS(name, stopAt = new Set([0x145])) {
    const host = new BootHost(this.globals, this.strings);
    host.stopAt = stopAt;
    const machine = new KCSMachine(
      await readKCS(await this.game.require(name)),
      host,
      this.sharedMemory,
    );
    machine.run(5000000, () => host.stopped !== null);
    this.sharedMemory = machine.shared;
    this.vmEvidence.push({
      script: name,
      steps: machine.steps,
      event: host.stopped?.id,
      nativeCalls: Object.fromEntries([...host.calls].map(([id, n]) => [id.toString(16), n])),
      unimplementedNatives: Object.fromEntries(
        [...host.unimplemented].map(([id, n]) => [id.toString(16), n]),
      ),
    });
    return host.stopped;
  }
  async startTitle() {
    this.audio.stopAll();
    this.story = null;
    this.modal = null;
    this.windowFES = null;
    this.extraFES = null;
    this.touchEnabled = false;
    this.themeName = null;
    this.sceneHidden = false;
    this.renderer.clearBase();
    this.titleFES = this.fes();
    await this.titleFES.start(this.flowName);
    this.mode = 'title';
    this.skip = false;
    this.auto = false;
  }
  async startStory(name) {
    this.titleFES = null;
    this.modal = null;
    this.windowFES = null;
    this.extraFES = null;
    this.touchEnabled = false;
    this.lastWait = false;
    this.renderer.clearBase();
    this.themeName = null;
    this.story = new ScenePlayer(this.game, this.host, this.globals);
    this.story.language = this.language('lang_text_main');
    this.particles = new Particles(this.story.stage);
    await this.story.start(name);
    this.mode = 'story';
    this.history.clear();
    this.historyMessage = -1;
  }
  async setView(shown, name = 'default') {
    if (!shown) {
      this.host.showWindow(false);
      return;
    }
    if (this.themeName === name && this.windowFES) {
      this.host.showWindow(true);
      return;
    }
    const themeFile = this.adv.value('etc', 'defwnd') || this.strings[800];
    if (!themeFile) throw new Error('No message window theme configured');
    const xml = parseXML(decodeText(await this.game.require(themeFile)));
    this.theme = xml.node(name) || xml.node('default');
    if (!this.theme) throw new Error(`Missing message window theme ${name}`);
    for (let i = 0; i < 4; i++)
      this.strings[900 + i] = this.theme.value('mes', `img0${i}`).replace(/\.hg3$/i, '');
    this.windowFES = this.fes();
    this.windowFES.transparent = true;
    await this.windowFES.start(this.theme.value('mes', 'script'));
    for (let i = 0; i < 6; i++) await this.windowFES.step();
    this.windowFES.root.invoke('MES_SETSTATE', Array(12).fill(1));
    this.windowFES.root.invoke('MES_SHIFT', [0]);
    this.windowFES.root.invoke('MES_SHOW', [1]);
    this.extraFES = null;
    this.lastTouchAvailable = null;
    const extra = this.theme.value('ex0', 'script');
    if (extra && this.game.has(extra)) {
      this.extraFES = this.fes();
      this.extraFES.transparent = true;
      await this.extraFES.start(extra);
      for (let i = 0; i < 3; i++) await this.extraFES.step();
    }
    this.themeName = name;
  }
  message(message) {
    const p = this.windowFES,
      root = p?.root;
    message.nameID = this.names.get(message.originalSpeaker) ?? -1;
    if (this.story.log.at(-1)) this.story.log.at(-1).nameID = message.nameID;
    if (!root) return;
    root.invoke('MES_CLEAR');
    this.strings[1000] = message.text;
    this.strings[1001] = message.speaker || '';
    const secondary = this.languages[this.host.config('lang_text_sub')]?.code;
    this.strings[1002] = secondary
      ? this.story.scripts.get(message.scene)?.translation?.[secondary]?.[message.index]?.text || ''
      : '';
    root.invoke('MES_SETNAME', [message.nameID]);
    root.invoke('MES_SETSTRING');
    root.invoke('MES_DRAW', [0]);
    root.invoke('MES_WAITINPUT', [Number(!message.continues)]);
    this.lastWait = !message.continues;
  }
  async openModal(name, parameters = []) {
    if (this.modal) return;
    const thumbnail = this.story ? this.host.captureThumbnail() : null;
    const player = this.fes();
    player.transparent = true;
    await player.start(name);
    parameters.forEach((v, i) => player.root.setLocal(i, Number(v) || 0));
    this.modal = { name: name.toLowerCase().replace(/\.fes$/, ''), player, thumbnail };
  }
  async processKCS(player) {
    const request = player?.requestedKCS;
    if (!request) return;
    player.requestedKCS = null;
    const slot = this.flag('boot'),
      saved = slot >= 0 ? this.saves.get(slot) : null;
    if (saved?.data?.scene) {
      await this.restore(saved.data);
      return;
    }
    const event = await this.runKCS(
      /\.kcs$/i.test(request.name) ? request.name : `${request.name}.kcs`,
    );
    if (event?.id === 0x145 && event.text) await this.startStory(event.text);
    else throw new Error(`KCS ${request.name} did not load a scene`);
  }
  activeFES() {
    return (
      this.modal?.player ||
      (this.touchEnabled ? this.extraFES : null) ||
      this.windowFES ||
      this.titleFES
    );
  }
  pointerPlayers() {
    return this.modal
      ? [this.modal.player]
      : this.touchEnabled
        ? [this.extraFES]
        : [this.titleFES, this.windowFES, this.extraFES].filter(Boolean).reverse();
  }
  hover(x, y) {
    const players = this.pointerPlayers(),
      hit = x === null ? null : players.find((p) => p.hit(x, y));
    for (const p of players) p.hover(p === hit ? x : null, p === hit ? y : null);
  }
  beginDrag(x, y) {
    for (const p of this.pointerPlayers()) if (p.beginDrag(x, y)) return true;
    return false;
  }
  endDrag() {
    for (const p of this.pointerPlayers()) p.endDrag();
  }
  get dragging() {
    return this.pointerPlayers().some((p) => p.dragging);
  }
  async step(count = 1) {
    for (let i = 0; i < count && !this.disposed; i++) {
      this.frame++;
      if (this.story) {
        if (!this.modal && !this.host.movieActive()) {
          this.story.stage.frame++;
          if (
            this.skip &&
            this.skipAllowed &&
            ['input', 'frames', 'motions', 'tag'].includes(this.story.waiting?.kind)
          ) {
            this.windowFES?.root?.invoke('MES_SKIP');
            this.story.advance();
          } else if (
            this.auto &&
            this.frame - (this.lastAdvance || 0) > 240 &&
            !this.audio.voiceInfo().playing &&
            this.story.waiting?.kind === 'input'
          )
            this.advance();
          if (!this.touchEnabled) await this.story.tick();
          if (this.story.waiting?.kind === 'input' && !this.lastWait) {
            this.windowFES?.root?.invoke('MES_WAITINPUT', [1]);
            this.lastWait = true;
          }
        }
        if (this.windowFES) {
          await this.windowFES.step();
          await this.processKCS(this.windowFES);
        }
        if (this.extraFES) {
          await this.extraFES.step();
          const enabled = Number(
            this.story.windowVisible &&
              Object.values(this.story.stage.actors).some((c) => c.model && c.touch),
          );
          if (enabled !== this.lastTouchAvailable) {
            this.extraFES.root.invoke('MES_TOUCH_ENABLE', [enabled]);
            this.lastTouchAvailable = enabled;
          }
        }
        if (this.pendingTouchEnter) {
          this.pendingTouchEnter = false;
          this.extraFES?.root?.invoke('MES_ENTER_EX_OSAWARI');
        }
      } else if (this.titleFES) {
        await this.titleFES.step();
        await this.processKCS(this.titleFES);
      }
      if (this.modal) {
        const modal = this.modal;
        await modal.player.step();
        if (modal.player.root.finished !== null) {
          const code = modal.player.root.finished;
          this.modal = null;
          this.sceneHidden = false;
          if (modal.name === 'saveload' && code >= 0) {
            const saved = this.saves.get(code);
            if (!saved) throw new Error(`Save ${code} is missing`);
            this.pendingLoad = saved.data;
          } else if (modal.name.startsWith('hist') && code === -2)
            this.rollback(this.flag('logret_pathindex'));
        }
      }
      if (this.pendingLoad) {
        const saved = this.pendingLoad;
        this.pendingLoad = null;
        await this.restore(saved);
      }
      if (this.pendingTitle) {
        this.pendingTitle = false;
        this.setFlag('rettitle', 1);
        await this.startTitle();
      }
      if (this.story && this.story.currentMessage?.sequence !== this.historyMessage)
        this.recordHistory();
    }
  }
  async render() {
    for (const p of [this.titleFES, this.windowFES, this.extraFES, this.modal?.player])
      if (p) await p.flush();
    if (this.story && !this.sceneHidden) {
      await this.stageRenderer.render(this.story.stage, this.audio.voiceInfo());
      await this.particles.render(this.renderer);
      if (this.windowFES && this.story.view) await this.renderer.fes(this.windowFES, true);
      if (this.extraFES && this.story.view) await this.renderer.fes(this.extraFES, true);
    } else if (this.titleFES) await this.renderer.fes(this.titleFES);
    if (this.modal) await this.renderer.fes(this.modal.player, true);
    if (this.transitionState) {
      if (await this.transitionState.composite(this.renderer.ctx, this.frame))
        this.transitionState = null;
    }
    this.renderer.present();
    this.onState(this.status());
  }
  setTransition(frames, kind, mask) {
    const pixels = kind === 'rwipe' && mask ? this.images.frame(mask) : null;
    this.transitionState = new Transition(this.canvas, frames, this.frame, kind, pixels);
  }
  advance() {
    if (!this.story || this.modal || this.touchEnabled) return;
    const text = this.windowFES?.root?.objects.find((o) => o.type === 'STRING8' && o.key === 'str');
    if (text && text.reveal(this.windowFES.frameCount) < text.text.length)
      this.windowFES.root.invoke('MES_SKIP');
    else {
      this.story.advance();
      this.lastAdvance = this.frame;
      this.lastWait = false;
      this.windowFES?.root?.invoke('MES_WAITINPUT', [0]);
    }
  }
  confirm() {
    if (!this.activeFES()?.press()) this.advance();
  }
  cancel() {
    if (this.video && !this.video.paused) {
      this.video.pause();
      this.video.hidden = true;
    } else if (this.touchEnabled || this.modal || !this.story) this.activeFES()?.rightClick();
    else this.host.systemAction(23).catch((e) => this.onError?.(e));
  }
  click(x, y) {
    const player = this.pointerPlayers().find((p) => p.hit(x, y));
    if (player) player.click(x, y);
    else {
      this.activeFES()?.click(x, y);
      this.advance();
    }
  }
  async playMovie(name) {
    if (!this.video) throw new Error('Movie playback needs a video element');
    this.audio.stop('voice');
    const media = this.game.media?.[name.toLowerCase()],
      file = this.game.resolve(name, ['mp4', 'webm']);
    if (media) this.video.src = media;
    else if (file) {
      this.movieURL = URL.createObjectURL(new Blob([await this.game.require(file)]));
      this.video.src = this.movieURL;
    } else
      throw new Error(
        `Movie ${name} needs browser-compatible media; run npm run prepare:media -- <game-directory>`,
      );
    this.video.hidden = false;
    this.video.onended = () => {
      this.video.hidden = true;
      if (this.movieURL) {
        URL.revokeObjectURL(this.movieURL);
        this.movieURL = null;
      }
    };
    await this.video.play();
  }
  async snapshot(includeUI = true) {
    if (!this.story) throw new Error('A story must be running to create a checkpoint');
    if (this.host.movieActive()) throw new Error('Finish or skip the movie before saving');
    if (this.story.currentMessage?.sequence !== this.historyMessage) this.recordHistory();
    return {
      format: 'catsystem2-web',
      sourceIdentity: this.identity,
      globals: { ...this.globals },
      strings: { ...this.strings },
      settings: { ...this.settings },
      history: [...this.history],
      scene: this.story.snapshot(),
      emote: this.emote.snapshot(),
      audio: this.audio.snapshot(),
      themeName: this.themeName,
      ui: includeUI
        ? {
            window: this.windowFES?.snapshot(),
            extra: this.extraFES?.snapshot(),
            touchEnabled: !!this.touchEnabled,
            modal: this.modal
              ? {
                  name: this.modal.name,
                  state: this.modal.player.snapshot(),
                  thumbnail: this.modal.thumbnail,
                }
              : null,
          }
        : null,
    };
  }
  async restore(saved) {
    if (
      !saved ||
      saved.format !== 'catsystem2-web' ||
      saved.sourceIdentity !== this.identity ||
      !saved.scene?.stack?.length ||
      JSON.stringify(saved).length > 16 * 1024 * 1024
    )
      throw new Error('Checkpoint does not match the current game or format');
    this.globals = { ...saved.globals };
    this.strings = { ...saved.strings };
    this.settings = { ...saved.settings };
    await this.startStory(saved.scene.stack[0].name);
    await this.story.restore(saved.scene);
    this.emote.restore(saved.emote);
    await this.emote.prepare(this.story.stage);
    this.updateLanguage();
    this.history = new Map(saved.history);
    this.historyMessage = this.story.currentMessage?.sequence;
    await this.setView(true, saved.themeName || 'default');
    if (saved.ui?.window) await this.windowFES.restore(saved.ui.window);
    else if (this.story.currentMessage) this.message(this.story.currentMessage);
    if (saved.ui?.extra && this.extraFES) await this.extraFES.restore(saved.ui.extra);
    this.touchEnabled = !!saved.ui?.touchEnabled;
    if (saved.ui?.modal) {
      await this.openModal(saved.ui.modal.name);
      await this.modal.player.restore(saved.ui.modal.state);
      this.modal.thumbnail = saved.ui.modal.thumbnail;
    }
    await this.audio.restore(saved.audio);
    if (this.story.voice) await this.emote.levels(this.story.voice);
    this.renderer.clearBase();
    this.transitionState = null;
    this.sceneHidden = false;
    this.mode = 'story';
  }
  recordHistory() {
    const message = this.story.currentMessage;
    if (!message) return;
    const scene = this.story.snapshot();
    scene.log = [];
    this.history.set(message.sequence, {
      scene,
      globals: { ...this.globals },
      strings: { ...this.strings },
      themeName: this.themeName,
      audio: this.audio
        .snapshot()
        .filter((c) => c.channel === 'voice' || c.channel === 'bgm' || /^se\d+$/.test(c.channel)),
    });
    this.historyMessage = message.sequence;
    while (this.history.size > 200) this.history.delete(this.history.keys().next().value);
  }
  rollback(index) {
    const entry = this.story.log[index],
      saved = this.history.get(entry?.sequence);
    if (!saved)
      throw new Error('This backlog entry is outside the retained rollback window (200 messages)');
    this.pendingLoad = {
      ...saved,
      scene: { ...saved.scene, log: this.story.log.slice(0, index + 1) },
      format: 'catsystem2-web',
      sourceIdentity: this.identity,
      settings: { ...this.settings },
      history: [...this.history].filter(([sequence]) => sequence <= entry.sequence),
      emote: { states: {}, randomState: this.emote.randomState },
      ui: null,
    };
  }
  status() {
    return {
      mode: this.mode,
      sourceIdentity: this.identity,
      stack: this.activeFES()?.stack || [],
      story: this.story?.stack.at(-1),
      message: this.story?.currentMessage,
      waiting: this.story?.waiting?.kind,
      actors: this.story ? Object.keys(this.story.stage.actors).length : 0,
      unsupported: [
        ...new Set([
          ...this.unsupported,
          ...(this.titleFES?.unsupportedCommands || []),
          ...(this.windowFES?.unsupportedCommands || []),
          ...(this.extraFES?.unsupportedCommands || []),
          ...(this.modal?.player.unsupportedCommands || []),
          ...(this.story?.unsupported || []),
          ...(this.story?.stage.unsupported || []),
          ...(this.particles?.unsupported || []),
        ]),
      ],
      audio: this.audio.context.state,
    };
  }
  diagnostics() {
    return {
      ...this.status(),
      warnings: [
        ...new Set(
          [this.titleFES, this.windowFES, this.extraFES, this.modal?.player]
            .filter(Boolean)
            .flatMap((p) => [...p.unresolvedTargets])
            .concat([...this.audio.warnings]),
        ),
      ],
      nativeCalls: this.vmEvidence,
      hostHints: [
        ...new Set(
          [this.titleFES, this.windowFES, this.extraFES, this.modal?.player]
            .filter(Boolean)
            .flatMap((p) => [...p.hints]),
        ),
      ],
      trace: this.story?.trace || [],
      bootHost:
        'Boot-only native services; story and system screen services execute in the browser host',
      renderer: 'WebGL2 E-mote / Canvas2D stage',
      resources: this.game.index.size,
    };
  }
  async dispose() {
    this.disposed = true;
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    if (this.movieURL) URL.revokeObjectURL(this.movieURL);
    this.emote?.dispose();
    this.saves?.close();
    await this.audio.dispose();
  }
}
