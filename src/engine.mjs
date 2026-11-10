// SPDX-License-Identifier: MPL-2.0
import { decodeText } from './binary.mjs';
import { ImageStore } from './formats/hg3.mjs';
import { FESPlayer } from './fes/player.mjs';
import { ScenePlayer, parseMessage } from './scene.mjs';
import { EmoteProfiles } from './emote/profiles.mjs';
import { EmoteRuntime } from './emote/runtime.mjs';
import { EmoteGL } from './render/emote-gl.mjs';
import { CanvasRenderer } from './render/canvas.mjs';
import { CanvasTextGlyphs } from './render/native-text.mjs';
import { StageRenderer } from './render/stage.mjs';
import { AudioMixer } from './audio.mjs';
import { SaveStore } from './saves.mjs';
import { parseXML, XMLNode } from './xml.mjs';
import { EngineHost } from './host.mjs';
import { Particles } from './particles.mjs';
import { Transition } from './render/transition.mjs';
import { selectNativeProfile } from './native/profile.mjs';
import { MotionLibrary } from './motion/library.mjs';
import { ParticleRandom } from './ppi/random.mjs';
import { checkpointBytes } from './checkpoint.mjs';
import { NativeWorld } from './native/world.mjs';
import { NativeConfiguration } from './native/config.mjs';
import { NativeFileStorage } from './native/storage.mjs';
import { parseNativeXML } from './native/xml.mjs';
import { nativeABI } from './native/abi/index.mjs';
import { NativeInputBindings } from './native/input-bindings.mjs';
import { browserWindowsLanguageID } from './native/windows-language-ids.mjs';
import { NativeSteam } from './native/steam.mjs';

export class CatSystem2 {
  constructor({
    game,
    canvas,
    audioContext,
    video,
    nativeProfile,
    uiLanguage,
    steam = null,
    randomSeed,
    transitionalExe = null,
    onState = () => {},
    onClosed = () => {},
  }) {
    Object.assign(this, {
      game,
      canvas,
      video,
      onState,
      onClosed,
      requestedNativeProfile: nativeProfile,
      requestedUILanguage: uiLanguage,
      randomSeed,
      transitionalExe,
      steam,
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
    this.steam = steam ? (steam instanceof NativeSteam ? steam : new NativeSteam(steam)) : null;
    this.history = new Map();
    canvas.width = game.width;
    canvas.hidden = false;
    canvas.height = game.height;
    this.images = new ImageStore(game);
    this.renderer = new CanvasRenderer(canvas, this.images);
    this.audio = new AudioMixer(game, audioContext);
    this.host = new EngineHost(this);
    this.random = new ParticleRandom(randomSeed);
  }
  async initialize({ checkpoint } = {}) {
    this.nativeProfile = await selectNativeProfile(this.game, this.requestedNativeProfile);
    this.motionLibrary = new MotionLibrary(this.game, {
      profile: this.nativeProfile,
      random: this.random,
    });
    const xml = async (name) => {
      const bytes = await this.game.read(name);
      return bytes ? parseXML(decodeText(bytes)) : new XMLNode('document');
    };
    [this.startup, this.adv, this.vram, this.profiles] = await Promise.all([
      xml('startup.xml'),
      xml('adv.xml'),
      xml('vram.xml'),
      EmoteProfiles.load(this.game),
    ]);
    this.languages = (this.startup.node('language')?.children || [])
      .filter((n) => /^L\d+$/i.test(n.name))
      .map((n) => ({ code: n.value('prefix'), name: n.value('lang') }));
    if (!this.languages.length) this.languages = [{ code: 'jp', name: 'Japanese' }];
    this.identity = await this.game.fingerprint();
    this.saves = new SaveStore(this.identity);
    await this.saves.open();
    this.quickSaveStart = Number(this.adv.value('save', 'quicksave', 'start')) || 5000;
    this.temporarySaveStart = Number(this.adv.value('save', 'autoerase', 'start')) || 7000;
    this.emote = new EmoteRuntime(
      this.game,
      this.profiles,
      new EmoteGL(this.game.width, this.game.height),
    );
    this.names = await this.host.speakerTable();
    await this.renderer.loadFonts(this.game);
    const nativeXML = async (name, mounted = false) => {
      const bytes = await (mounted && this.game.readNative
        ? this.game.readNative(name, 3)
        : this.game.read(name));
      return bytes ? parseNativeXML(bytes, nativeABI(this.nativeProfile).xmlEncoding) : undefined;
    };
    const [startup, gamedef] = await Promise.all([
      nativeXML('startup.xml'),
      nativeXML('config.int/gamedef.xml', true),
    ]);
    this.nativeDocuments = { startup, gamedef };
    this.nativeStorage = new NativeFileStorage(this.game, this.identity);
    await this.nativeStorage.open();
    this.nativeFES = new Map();
    this.world = this.createNativeWorld();
    if (checkpoint) {
      await this.restore(checkpoint);
      this.onState(this.status());
      return;
    }
    this.bindNativeBanks();
    const main = this.startup.value('SCRIPT', 'start') || 'main.kcs';
    await this.world.initialize(main);
    this.bindNativeBanks();
    this.mode = 'running';
    this.onState(this.status());
  }
  createNativeWorld({ audio = this.audio } = {}) {
    const { startup, gamedef } = this.nativeDocuments,
      game = Object.create(this.game),
      uiLanguage = this.requestedUILanguage ?? browserWindowsLanguageID(),
      random = new ParticleRandom(this.randomSeed);
    if (this.game.nativeResources) game.nativeResources = Object.create(this.game.nativeResources);
    audio.game = game;
    const world = new NativeWorld({
      transitionalExe: this.transitionalExe,
      game,
      images: this.images,
      host: this.host,
      profile: this.nativeProfile,
      bootstrapOwner: {
        executableResources: true,
        embeddedJavaScript: nativeABI(this.nativeProfile).capabilities.embeddedJavaScript,
        seedFromClock: this.randomSeed === undefined,
        glyphs: new CanvasTextGlyphs({
          family: (name) => this.renderer.fonts.get(name.toLowerCase()),
        }),
        fontFamilies: () => this.renderer.nativeFontFamilies(uiLanguage),
      },
      configuration: new NativeConfiguration({
        profile: this.nativeProfile,
        startup,
        gamedef,
        fontAvailability: (name) => this.renderer.fontAvailable(name),
        uiLanguage,
      }),
      storage: this.nativeStorage,
      audio,
      random,
      motionLibrary: new MotionLibrary(game, { profile: this.nativeProfile, random }),
      sceneLanguages: this.languages.map((language) => language.code),
      steam: this.steam,
    });
    world.stageRenderer = new StageRenderer(this.renderer, this.emote);
    world.inputBindings = new NativeInputBindings(world.input, world.configuration);
    return world;
  }
  bindNativeBanks() {
    this.world.refreshTitle();
    this.world.graphics.cursor.changed();
    this.world.movies.activate();
    this.nativeRuntime = this.world.runtime;
    this.nativeConfiguration = this.world.configuration;
    this.nativeSoundConfiguration = this.world.soundConfiguration;
    this.motionLibrary = this.world.motionLibrary;
    this.random = this.world.random;
    this.audio = this.world.audio;
    this.stageRenderer = this.world.stageRenderer;
    this.inputBindings = this.world.inputBindings;
    const task = this.world.main;
    if (!task) return;
    const bank = this.nativeRuntime.variableBank(task, false);
    this.nativeRuntime.stringBank(task);
    this.globals = bank ? this.nativeRuntime.bankView(task.context.variableBank) : {};
    this.strings = this.nativeRuntime.bankView(task.context.stringBank, 'string-bank');
  }
  nativeWindowStateChanged() {
    if (!this.world) return;
    const screen = this.world.configuration.screen,
      fullscreen = Number(!this.host.nativeIsWindow());
    if (screen.fullscreen !== fullscreen) this.world.markConfigurationDirty();
    screen.fullscreen = fullscreen;
    screen.currentWidth = fullscreen ? screen.fullWidth : screen.width;
    screen.currentHeight = fullscreen ? screen.fullHeight : screen.height;
    this.world.graphics.view.configure({
      clientWidth: screen.currentWidth,
      clientHeight: screen.currentHeight,
    });
  }
  fes() {
    const p = new FESPlayer(this.game, this.images, this.host, this.globals, this.strings);
    p.language = this.language('lang_ui');
    p.languageMain = this.language('lang_text_main');
    p.motionLibrary = this.motionLibrary;
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
      const translated = (entry) => {
        const script = this.story.scripts.get(entry.scene);
        if (!script) return null;
        const text = script.translation?.[this.story.language]?.[entry.index];
        const parsed = parseMessage(text?.text ?? entry.original);
        return {
          text: parsed.text.trim(),
          runs: parsed.runs,
          speaker: text?.speaker || entry.originalSpeaker || null,
        };
      };
      for (const entry of this.story.log) {
        const text = translated(entry);
        if (text) Object.assign(entry, text);
      }
      const message = this.story.currentMessage,
        text = message ? translated(message) : null;
      if (
        text &&
        (message.text !== text.text ||
          message.speaker !== text.speaker ||
          JSON.stringify(message.runs) !== JSON.stringify(text.runs))
      ) {
        Object.assign(message, text);
        this.message(message);
        if (this.story.log.length) Object.assign(this.story.log.at(-1), message);
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
  async startTitle() {
    await this.particles?.close();
    this.particles = null;
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
    await this.particles?.close();
    this.titleFES = null;
    this.modal = null;
    this.windowFES = null;
    this.extraFES = null;
    this.touchEnabled = false;
    this.lastWait = false;
    this.renderer.clearBase();
    this.themeName = null;
    this.story = new ScenePlayer(this.game, this.host, this.globals, this.strings);
    this.story.stage.configureVRAM(this.vram);
    this.story.stage.motionLibrary = this.motionLibrary;
    this.story.stage.imageLoaded = (request) => this.host.imageLoaded(request);
    const replayBase = this.adv.value('sysflag', 'kaisou');
    if (replayBase !== '') this.story.replayFlagBase = Number(replayBase);
    this.story.language = this.language('lang_text_main');
    this.particles = new Particles(this.story.stage, {
      game: this.game,
      images: this.images,
      random: this.random,
      fps: 60,
    });
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
    for (let i = 0; i < 4; i++) {
      this.strings[900 + i] = this.theme.value('mes', `img0${i}`).replace(/\.hg3$/i, '');
      this.strings[910 + i] = this.theme.value('log', `img0${i}`).replace(/\.hg3$/i, '');
    }
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
  activeFES() {
    if (this.world) return [...this.nativeFES.values()].at(-1) ?? null;
    return (
      this.modal?.player ||
      (this.touchEnabled ? this.extraFES : null) ||
      this.windowFES ||
      this.titleFES
    );
  }
  pointerPlayers() {
    if (this.world) return [...this.nativeFES.values()].reverse();
    return this.modal
      ? [this.modal.player]
      : this.touchEnabled
        ? [this.extraFES]
        : [this.titleFES, this.windowFES, this.extraFES].filter(Boolean).reverse();
  }
  hover(x, y) {
    if (this.world) {
      this.world.input.pointer(x === null ? -2147483648 : x, y === null ? -2147483648 : y);
      return;
    }
    const players = this.pointerPlayers(),
      hit = x === null ? null : players.find((p) => p.hit(x, y));
    for (const p of players) p.hover(p === hit ? x : null, p === hit ? y : null);
  }
  beginDrag(x, y) {
    if (this.world) {
      this.pointerButton(x, y, 0, true);
      return false;
    }
    for (const p of this.pointerPlayers()) if (p.beginDrag(x, y)) return true;
    return false;
  }
  endDrag() {
    if (this.world) {
      this.inputBindings.mouse(0, false);
      return;
    }
    for (const p of this.pointerPlayers()) p.endDrag();
  }
  get dragging() {
    if (this.world) return this.world.input.dragging;
    return this.pointerPlayers().some((p) => p.dragging);
  }
  async step(count = 1) {
    for (let i = 0; i < count && !this.disposed; i++) {
      if (this.world) {
        this.inputBindings.sample();
        await this.world.tick();
        if (this.world.quitRequested) {
          this.mode = 'closed';
          await this.dispose();
          this.onClosed();
          return;
        }
        this.frame = this.world.frame;
        this.audio.setFrame(this.frame);
        continue;
      }
      this.frame++;
      this.audio.setFrame(this.frame);
      if (this.story) {
        if (!this.modal && !this.host.movieActive()) {
          this.story.stage.frame++;
          await this.story.stage.updateMotions();
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
      if (this.particles && !this.modal && !this.host.movieActive())
        await this.particles.update(this.story.stage.frame);
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
    if (this.disposed) return;
    if (this.world) {
      if (this.world.movies.renderGate) this.renderer.begin();
      else
        await this.stageRenderer.render(
          this.world.graphics.stage,
          this.audio.voiceInfo(),
          this.world.particles.drawItems(),
        );
      this.renderer.present();
      this.onState(this.status());
      return;
    }
    for (const p of [this.titleFES, this.windowFES, this.extraFES, this.modal?.player])
      if (p) await p.flush();
    if (this.story && !this.sceneHidden) {
      await this.stageRenderer.render(
        this.story.stage,
        this.audio.voiceInfo(),
        this.particles.drawItems(),
      );
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
    if (this.world) {
      this.inputBindings.tap(2);
      return;
    }
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
    if (this.world) {
      this.inputBindings.tap(0);
      return;
    }
    if (!this.activeFES()?.press()) this.advance();
  }
  cancel() {
    if (this.world) {
      this.inputBindings.tap(1);
      return;
    }
    if (this.video && !this.video.paused) {
      this.video.pause();
      this.video.hidden = true;
    } else if (this.touchEnabled || this.modal || !this.story) this.activeFES()?.rightClick();
    else this.host.systemAction(23).catch((e) => this.onError?.(e));
  }
  click(x, y) {
    if (this.world) {
      this.pointerButton(x, y, 0, true);
      this.pointerButton(x, y, 0, false);
      return;
    }
    const player = this.pointerPlayers().find((p) => p.hit(x, y));
    if (player) player.click(x, y);
    else {
      this.activeFES()?.click(x, y);
      this.advance();
    }
  }
  pointerButton(x, y, button, down) {
    if (!Number.isInteger(button) || button < 0 || button > 4) return;
    this.world.input.pointer(x, y);
    this.inputBindings.mouse(button, down);
  }
  touchContact(id, x, y, phase) {
    this.world.input.pointer(x, y);
    this.inputBindings.contact(id, x, y, phase);
  }
  async playMovie(name) {
    if (!this.video) throw new Error('Movie playback needs a video element');
    this.audio.stop('voice');
    const file =
        this.game.resolveCategory?.(name, 'movie') ?? this.game.resolve(name, ['mp4', 'webm']),
      source = file
        ? await this.game.movieSource(file, (type) => this.video.canPlayType(type))
        : null;
    if (!source)
      throw new Error(
        `Movie ${name} needs browser-compatible media; run npm run prepare:media -- <game-directory>`,
      );
    this.legacyMovieSource?.release?.();
    this.legacyMovieSource = source;
    this.video.src = source.url;
    this.video.hidden = false;
    this.video.onended = () => {
      this.video.hidden = true;
      this.legacyMovieSource?.release?.();
      this.legacyMovieSource = null;
    };
    await this.video.play();
  }
  async snapshot(includeUI = true) {
    if (this.world) {
      await this.world.resourceCache.settle();
      await this.world.movies.settle();
      const state = {
        format: 'catsystem2-web',
        sourceIdentity: this.identity,
        world: this.world.snapshot(),
        audio: this.audio.snapshot(),
        emote: this.emote.snapshot(),
      };
      checkpointBytes(state);
      return state;
    }
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
      particles: this.particles.snapshot(),
      random: this.random.snapshot(),
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
    if (this.world) {
      if (
        saved?.format !== 'catsystem2-web' ||
        saved.sourceIdentity !== this.identity ||
        !saved.world
      )
        throw new Error('Checkpoint does not match the current game or format');
      checkpointBytes(saved);
      const previous = this.world,
        previousAudio = this.audio,
        audio = new AudioMixer(this.game, this.audio.context, { deferPlayback: true }),
        next = this.createNativeWorld({ audio });
      try {
        await next.restore(saved.world);
        await audio.restore(saved.audio);
        await previous.flush();
      } catch (error) {
        try {
          await next.close({ flushFiles: false });
        } catch (cleanup) {
          this.host.nativeDiagnostic?.({ type: 'checkpoint-cleanup', message: cleanup.message });
        } finally {
          audio.stopAll();
        }
        throw error;
      }
      try {
        await previous.close({ flushFiles: false });
      } catch (cleanup) {
        this.host.nativeDiagnostic?.({ type: 'checkpoint-cleanup', message: cleanup.message });
      }
      previousAudio.stopAll();
      this.world = next;
      next.inputBindings.adopt(previous.inputBindings);
      this.nativeRuntime = next.runtime;
      this.nativeFES.clear();
      for (const record of next.objects.objects.values())
        if (record.kind === 34 && record.implementation.player)
          this.host.nativeFESLoaded(record, record.implementation.player, next);
      this.bindNativeBanks();
      audio.activate();
      this.emote.restore(saved.emote);
      this.frame = next.frame;
      this.mode = 'running';
      return;
    }
    if (
      !saved ||
      saved.format !== 'catsystem2-web' ||
      saved.sourceIdentity !== this.identity ||
      !saved.scene?.stack?.length
    )
      throw new Error('Checkpoint does not match the current game or format');
    checkpointBytes(saved);
    this.globals = { ...saved.globals };
    this.strings = { ...saved.strings };
    this.settings = { ...saved.settings };
    await this.startStory(saved.scene.stack[0].name);
    await this.story.restore(saved.scene);
    await this.particles.restore(saved.particles);
    this.random.restore(saved.random);
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
    if (this.world)
      return {
        mode: this.mode,
        sourceIdentity: this.identity,
        profile: this.nativeProfile,
        frame: this.world.frame,
        stack: [...this.nativeFES.values()].flatMap((player) => player.stack),
        tasks: [...this.world.objects.objects.values()].map(
          ({ id, kind, parent, name, exitCode }) => ({ id, kind, parent, name, exitCode }),
        ),
        scripts: [...this.world.runtime.scheduler.tasks.values()].map((task) => ({
          id: task.id,
          name: task.name,
          status: task.status,
          pc: task.machine.pc,
          steps: task.machine.steps,
          error: task.error,
        })),
        nativeCalls: Object.fromEntries(this.world.runtime.calls),
        unsupported: [
          ...this.unsupported,
          ...[...this.nativeFES.values()].flatMap((player) => [...player.unsupportedCommands]),
        ],
        audio: this.audio.context.state,
        resources: this.game.index.size,
      };
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
    if (this.disposed) return;
    this.disposed = true;
    if (this.world) this.world.disposalRequested = true;
    const errors = [],
      attempt = async (operation) => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.legacyMovieSource?.release?.();
    await attempt(() => this.host.nativeDispose?.());
    if (this.world?.frameSettled) await attempt(() => this.world.frameSettled);
    await attempt(() => this.world?.close());
    await attempt(() => this.steam?.close());
    await attempt(() => this.particles?.close());
    await attempt(() => this.emote?.dispose());
    await attempt(() => this.stageRenderer?.dispose());
    await attempt(() => this.renderer.dispose());
    await attempt(() => this.nativeStorage?.close());
    await attempt(() => this.saves?.close());
    await attempt(() => this.audio.dispose());
    if (errors.length) throw new AggregateError(errors, 'CatSystem2 cleanup failed');
  }
}
