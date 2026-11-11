// SPDX-License-Identifier: MPL-2.0
import { NativeGraphicTask } from './graphics.mjs';
import { NativeSoundPacket } from './sound.mjs';
import { bitsFloat, floatBits } from '../kcs/vm.mjs';
import { MOTION_ABI, setMotionVector } from '../motion/abi.mjs';
import { M2Render } from '../emote/m2-render.mjs';
import { roundX87Single } from '../ppi/x87.mjs';
const f = Math.fround;

export class M2Task extends NativeGraphicTask {
  constructor(owner, record) {
    super(owner.world.graphics, record);
    this.owner = owner;
    this.m2 = {
      program: '',
      position: [0, 0],
      scale: [1, 1],
      angle: 0,
      positionInitialized: false,
      color: 0xffffffff,
      tone: [100, 100, 100],
      depth: 0.5,
      playing: true,
      blink: true,
      lip: true,
      mode: 0,
      effects: true,
      fadeFrames: null,
      soundEnabled: false,
      soundBank: 0xffffffff,
      soundTask: null,
      voiceName: '',
      voiceBank: 0,
      voiceFlags: 0,
    };
    this.makeGraph({
      type: 1,
      width: this.world.game.width,
      height: this.world.game.height,
      custom: true,
      vram: false,
    });
    owner.tasks.set(record.id, this);
    this.graphics.tasks.set(record.id, this);
  }
  get program() {
    return this.m2.program;
  }
  configure() {
    if (!this.model) return;
    const config = this.owner.modelConfiguration(this.program),
      enabled = !config || Boolean(config.motion),
      { external, variables, bodyVariables } = this.model;
    for (const v of [variables, bodyVariables]) {
      v.setPlaying(this.m2.playing);
      v.enabled = Boolean(enabled && (!config || config.eff_dif));
    }
    external.inertia.configure(this.owner.configuration.levels, this.owner.configuration.enabled);
    external.inertia.enabled = Boolean(this.m2.playing && enabled && (!config || config.eff_iner));
    const blink = Boolean(this.m2.blink && enabled && (!config || config.eff_blink)),
      lip = Boolean(this.m2.lip && enabled && (!config || config.eff_lip));
    if (blink !== external.blink.enabled) external.blink.setEnabled(blink);
    if (lip !== external.lip.enabled) external.lip.setEnabled(lip);
  }
  async load(program, _flags = 0) {
    // The reviewed manager accepts this wrapper flag but never reads it.
    if (!program) {
      this.unloadModel();
      this.m2.program = '';
      return 1;
    }
    await this.owner.initialize();
    const pose = this.owner.profiles?.pose(program);
    if (!pose) throw new Error('M2 has no model profiles');
    if (this.model?.pose.model === pose.model) this.model.setProgram(program);
    else {
      const next = await this.owner.model(program);
      if (this.m2.fadeFrames !== null) next.fadeFrames = this.m2.fadeFrames;
      if (this.m2.positionInitialized) next.position = this.m2.position.slice();
      next.scale = this.m2.scale.slice();
      next.angle = this.m2.angle;
      const obsolete = this.oldModel;
      this.oldModel = this.model;
      this.oldModel?.prepareFadeSource();
      this.model = next;
      this.owner.release(obsolete);
    }
    this.m2.program = program;
    this.configure();
    if (this.m2.soundEnabled) await this.installLip();
    return 1;
  }
  unloadModel() {
    const previous = this.model,
      old = this.oldModel;
    this.model = this.oldModel = null;
    this.owner.release(previous);
    this.owner.release(old);
    this.render?.close();
    this.render = null;
  }
  get busy() {
    return Boolean(
      this.model &&
        ((this.model.lastFrame !== null &&
          this.model.lastFrame >= this.model.firstFrame &&
          this.model.lastFrame < this.model.readyFrame) ||
          this.model.busy),
    );
  }
  async soundMessage(message, l = 0, packet = new NativeSoundPacket()) {
    const target = this.m2.soundTask ?? this.world.sound.primary(this.record.id)?.record.id;
    if (target == null) return undefined;
    const receiver = this.world.objects.objects.get(target);
    if (!receiver) return undefined;
    return this.world.sendNativeEngine(
      receiver.nativeID,
      this.record.id,
      message,
      this.m2.soundBank,
      l,
      { payload: packet, nativeSenderWorldID: this.record.id },
    );
  }
  async installLip() {
    if (!this.model || !this.m2.soundEnabled || this.m2.soundBank === 0xffffffff) return;
    for (const [message, kind] of [
      [220, 'lpb'],
      [221, 'lv'],
    ]) {
      const packet = new NativeSoundPacket();
      await this.soundMessage(message, 4, packet);
      const handle = packet.load(4);
      if (
        handle &&
        this.model.external.lip.install(
          this.world.runtime.handles.get(handle, 'sound-sidecar'),
          kind,
        )
      )
        return;
    }
    this.model.external.lip.samples = null;
  }
  async tick() {
    if (!this.model || !this.m2.soundEnabled || this.model.external.lip.samples) return;
    if (!(await this.soundMessage(185))) {
      this.model.external.lip.stop();
      return;
    }
    const packet = new NativeSoundPacket([0, 12, 80], 12 + 80 * 4);
    const count = await this.soundMessage(213, 4, packet);
    if (count > 0)
      this.model.external.lip.feedLevels(
        Array.from({ length: Math.min(80, count) }, (_, i) => packet.load(12 + i * 4)),
      );
  }
  async drawTick(frame) {
    if (!this.model || this.state.renderPaused) return;
    const soundFrame = await this.soundMessage(219);
    this.model.external.soundFrame = soundFrame === undefined ? undefined : soundFrame;
    const clock = (frame - (this.record.pausedFrames ?? 0)) >>> 0;
    this.model.update(clock);
    if (this.oldModel && clock >= this.model.readyFrame) {
      const old = this.oldModel;
      this.oldModel = null;
      this.owner.release(old);
    }
  }
  async message(words, context = {}) {
    const [sender, message, w, l] = words,
      memory = () =>
        context.payload ?? context.machine ?? this.machine(context.nativeSenderWorldID ?? sender),
      real = (at) => bitsFloat(memory().load(at)),
      name = (at) => (at ? memory().string(at) : null),
      variables = () => (this.model ? [this.model.variables, this.model.bodyVariables] : []),
      inertia = () => this.model?.external.inertia;
    switch (message) {
      case 3:
        this.unloadModel();
        return super.message(words, context);
      case 19:
        this.sync();
        return 0;
      case 49:
        this.m2.depth = roundX87Single((65000 - real(l + 8)) * f(1 / 65000));
        if (this.graph) setMotionVector(this.graph.kx2, MOTION_ABI.base, [0, 0, real(l + 8)]);
        this.sync();
        return undefined;
      case 50:
      case 52:
      case 56:
      case 57:
      case 58:
      case 67:
        return undefined;
      case 51:
        this.m2.position = [real(l), real(l + 4)];
        this.m2.positionInitialized = true;
        if (this.model) this.model.position = this.m2.position.slice();
        return undefined;
      case 55:
        this.m2.angle = real(l + 8);
        if (this.model) this.model.angle = this.m2.angle;
        return undefined;
      case 59:
        this.m2.color = l >>> 0;
        return undefined;
      case 62:
        this.m2.position.forEach((v, i) => memory().store(l + i * 4, floatBits(v)));
        return undefined;
      case 63:
        this.m2.color = ((this.m2.color & 0xffffff) | (l << 24)) >>> 0;
        return undefined;
      case 66:
        this.m2.scale = [real(l), real(l + 4)];
        if (this.model) this.model.scale = this.m2.scale.slice();
        return undefined;
      case 524:
        await this.load(name(l) ?? '', w);
        return undefined;
      case 525:
        this.unloadModel();
        this.m2.program = '';
        return undefined;
      case 526:
        this.m2.playing = Boolean(l);
        this.configure();
        return undefined;
      case 527:
        this.model?.finish();
        return undefined;
      case 528:
        return Number(this.busy);
      case 529: {
        const attribute = this.model?.pose.face.attributes[w];
        if (attribute && l)
          [attribute.x, attribute.y, attribute.extra].forEach((v, i) =>
            memory().store(l + i * 4, v),
          );
        return undefined;
      }
      case 530:
        for (const v of variables()) v.setSpeed(name(w), real(l));
        return undefined;
      case 531:
        for (const v of variables()) v.resetSpeed(name(w));
        return undefined;
      case 532:
        for (const v of variables()) v.setScale(name(w), real(l));
        return undefined;
      case 533:
        this.model?.setBody(name(l) ?? '');
        return undefined;
      case 534:
        if (this.model && l) memory().writeString(this.model.body, l);
        return undefined;
      case 535:
        this.m2.mode = l >>> 0;
        return undefined;
      case 536:
        this.m2.tone = [0, 1, 2].map((i) => memory().load(l + i * 4));
        return undefined;
      case 537:
        this.m2.tone.forEach((v, i) => memory().store(l + i * 4, v));
        return undefined;
      case 538:
        inertia()?.pause(name(w), Boolean(l));
        return undefined;
      case 539:
        inertia()?.reset();
        return undefined;
      case 540:
        this.m2.soundBank = w >>> 0;
        this.m2.soundEnabled = Boolean(l);
        if (this.m2.soundEnabled) await this.installLip();
        else {
          this.model?.external.lip.stop();
          if (this.model) this.model.external.lip.samples = null;
        }
        return undefined;
      case 541:
        this.m2.blink = Boolean(l);
        this.configure();
        return undefined;
      case 542:
        this.m2.lip = Boolean(l);
        this.configure();
        return undefined;
      case 543:
        this.model?.external.spline.start(name(l) ?? '');
        return undefined;
      case 544:
        this.model?.external.spline.stop();
        return undefined;
      case 545: {
        this.m2.fadeFrames = l >>> 0;
        if (this.model?.lastFrame != null) {
          const obsolete = this.oldModel;
          this.oldModel = await this.owner.model(this.model.program);
          this.oldModel.restore(this.model.snapshot());
          this.owner.release(obsolete);
        }
        this.model?.requestFade(this.m2.fadeFrames);
        return undefined;
      }
      case 546:
        this.m2.effectsOverride = l >>> 0;
        return undefined;
      case 547:
        this.m2.voiceName = name(l);
        this.m2.voiceBank = memory().load(l + 64);
        this.m2.voiceFlags = memory().load(l + 68);
        return undefined;
      case 548:
      case 549:
        this.m2.effects = message === 548;
        for (const variable of this.model?.pose.face.hitVariables ?? [])
          this.model.animation.setVariable(variable, Number(!this.m2.effects));
        return undefined;
      case 550:
        this.model?.external.actions.base.clear();
        return undefined;
      case 551:
        this.model?.external.actions.start(name(l) ?? '');
        return undefined;
      case 552:
        this.model?.external.actions.finish();
        return undefined;
      case 553:
        return Number(Boolean(this.model?.external.actions.current));
      case 554: {
        const definition = this.model?.pose.face,
          key = definition?.touchMappings[w]?.[l];
        this.owner.hits = (definition?.touchTables[key] ?? []).map(({ action, voice }) => [
          action,
          voice,
        ]);
        return Number(Boolean(key));
      }
      default:
        return super.message(words, context);
    }
  }
  async drawGPU(gpu) {
    if (
      !this.model ||
      !this.graph ||
      !this.state.shown ||
      this.graph.renderEnabled === false ||
      !new DataView(this.graph.kx2.buffer).getInt32(MOTION_ABI.display, true)
    )
      return;
    if (this.model.lastFrame === null) return;
    const starting =
      this.model.lastFrame < this.model.firstFrame + 2 &&
      this.model.lastFrame < this.model.readyFrame;
    if (starting && !this.oldModel) return;
    this.render ??= new M2Render(
      this.world.stageRenderer,
      this.world.game.width,
      this.world.game.height,
    );
    if (gpu !== this.world.stageRenderer.gpu) throw new Error('M2 requires its StageRenderer GPU');
    const frames = this.model.fadeFrames,
      fadeAlpha =
        frames && this.model.lastFrame < this.model.readyFrame
          ? Math.min(
              256,
              Math.trunc(((this.model.lastFrame - this.model.firstFrame - 1) * 256) / frames),
            )
          : 256;
    this.render.draw(starting ? this.oldModel.geometry : this.model.geometry, {
      context: this.graphics.d3dContext,
      ...this.m2,
      view: this.graphics.view,
      fadeAlpha: starting ? 256 : fadeAlpha,
      previous: this.oldModel?.geometry,
    });
  }
  snapshot() {
    return {
      plane: super.snapshot(),
      m2: structuredClone(this.m2),
      model: this.model?.snapshot() ?? null,
      oldModel: this.oldModel?.snapshot() ?? null,
    };
  }
  async restore(state) {
    super.restore(state.plane);
    this.m2 = structuredClone(state.m2);
    if (state.model) {
      this.model = await this.owner.model(state.model.program);
      this.model.restore(state.model);
    }
    if (state.oldModel) {
      this.oldModel = await this.owner.model(state.oldModel.program);
      this.oldModel.restore(state.oldModel);
    }
  }
  async close() {
    this.unloadModel();
    this.owner.tasks.delete(this.record.id);
    return super.close();
  }
}

// The reviewed SDK has a SimplePlane placeholder and no model driver.
export class M2PlaceholderTask extends NativeGraphicTask {
  async message(words, context = {}) {
    if (words[1] >= 498) {
      context.nativeUnhandled = true;
      return undefined;
    }
    const canonical = [...words];
    if (canonical[1] >= 37) canonical[1] += 2;
    return super.message(canonical, context);
  }
}
