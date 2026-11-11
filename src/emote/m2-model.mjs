// SPDX-License-Identifier: MPL-2.0
import { EmoteAnimation } from './animation.mjs';
import { EmoteGeometry } from './geometry.mjs';
import { M2Variables } from './m2-variables.mjs';
import { M2Controllers } from './m2-controllers.mjs';
import { NativeMT19937 } from '../ppi/random.mjs';

const f = Math.fround;

// One script-visible M2 player. Parsed PSB documents/textures can be shared;
// controller, DIF and geometry state never belong to that shared document.
export class M2Model {
  constructor(document, { random, profiles, program, randomInteger = null } = {}) {
    this.document = document;
    this.profiles = profiles;
    this.animation = new EmoteAnimation(document, {
      random,
      resolveAnchor: (label) => this.geometry.anchor(label),
    });
    this.geometry = new EmoteGeometry(document, this.animation);
    this.variables = new M2Variables(this.animation);
    this.bodyVariables = new M2Variables(this.animation);
    this._position = [0, 0];
    this.positionInitialized = false;
    this.scale = [1, 1];
    this.angle = 0;
    this.lastFrame = null;
    this.readyFrame = null;
    this.fadeFrames = profiles.fadeFrames;
    this.body = '';
    this.setProgram(program, { animate: false });
    this.integerRandom = randomInteger ? null : new NativeMT19937();
    this.external = new M2Controllers(
      this,
      randomInteger ?? (() => this.integerRandom.nextUint32()),
    );
  }
  get position() {
    return this._position;
  }
  set position(value) {
    this._position = value;
    this.positionInitialized = true;
  }
  setProgram(program, options) {
    if (this.lastFrame !== null && this.readyFrame !== null)
      this.readyFrame = Math.min(this.readyFrame, this.lastFrame);
    const pose = this.profiles.pose(program, this.body ? this.body.split(',') : []);
    if (this.pose && pose.model !== this.pose.model)
      throw new Error('M2 model replacement requires a new document owner');
    if (this.pose?.face !== pose.face) this.variables.codes = {};
    if (this.pose?.body !== pose.body) this.bodyVariables.codes = {};
    this.program = program;
    this.pose = pose;
    this.variables.apply(pose.face, pose.requestedCodes, options);
    this.bodyVariables.apply(pose.body, pose.requestedBodyCodes, options);
    pose.codes = this.variables.codes;
    pose.bodyCodes = this.bodyVariables.codes;
    if (this.idle !== pose.idle) {
      if (this.idle) this.animation.timelines.stop(this.idle);
      this.idle = pose.idle;
      if (this.idle && this.document.timelines.has(this.idle))
        this.animation.timelines.play(this.idle, 0);
    }
    this.external?.setPose(pose);
  }
  setBody(program, options) {
    this.body = program;
    this.setProgram(this.program, options);
  }
  update(frame) {
    frame >>>= 0;
    const initial = this.lastFrame === null,
      elapsed = initial ? 1 : (frame - this.lastAnimationFrame) >>> 0;
    this.firstFrame ??= frame;
    this.readyFrame ??= (frame + this.fadeFrames + 1) >>> 0;
    this.lastFrame = frame;
    const pose = this.pose,
      offset = f(1 - this.scale[0]);
    const context = { active: frame >= this.readyFrame, initial };
    this.variables.beforeUpdate();
    this.bodyVariables.beforeUpdate();
    this.external.beforeUpdate(frame, context);
    this.animation.setRoot('position', [
      f(f(this.position[0] + f(Math.trunc(pose.positionX))) + f(f(pose.scaleOffsetX) * offset)),
      f(f(this.position[1] + f(Math.trunc(pose.positionY))) + f(f(pose.scaleOffsetY) * offset)),
    ]);
    // The original PSB path uses the X factor for both axes. Y is retained
    // for queries and image fallback; it is not a second DLL scale argument.
    this.animation.setRoot('scale', [f(f(pose.scaleX) * this.scale[0])]);
    this.animation.setRoot('angle', this.angle);
    if (initial || context.active) {
      this.animation.update(elapsed);
      this.lastAnimationFrame = frame;
    }
    this.variables.pending = this.bodyVariables.pending = false;
    this.external.afterUpdate(frame, context);
    if (this.finishHold && !this.sameRenderPose(this.finishHold.base)) this.finishHold = null;
    if (!this.finishHold) this.geometry.update();
    return this.geometry;
  }
  get busy() {
    return this.variables.busy || this.bodyVariables.busy || Boolean(this.external?.busy);
  }
  prepareFadeSource() {
    // A document replacement captures the old program's requested pose, not
    // its transient automatic blink/lip values or an earlier crossfade.
    for (const variables of [this.variables, this.bodyVariables]) {
      for (const [name, value] of [...variables.targets, ...variables.pins])
        this.animation.setVariable(
          name,
          f(value * (variables.scales.get(name) ?? variables.scale)),
        );
    }
    for (const { controller } of this.animation.controls.transition) controller.reset();
    this.animation.update(1);
    this.finishHold = null;
    this.geometry.update();
  }
  requestFade(frames) {
    this.fadeFrames = frames >>> 0;
    if (this.lastFrame === null) return;
    this.prepareFadeSource();
    this.external.setPose(this.pose);
    this.external.blink.pending.clear();
    this.external.lip.pending.clear();
    this.firstFrame = (this.lastFrame + 1) >>> 0;
    this.readyFrame = (this.firstFrame + this.fadeFrames) >>> 0;
  }
  finish() {
    const rendered = this.finishHold?.rendered ?? this.renderPose();
    this.variables.finish();
    this.bodyVariables.finish();
    for (const { controller } of this.animation.controls.transition) controller.reset();
    this.animation.update(1);
    // Skip advances/settles controllers without redrawing the actor's retained
    // model target. A later visible parameter change invalidates that target.
    this.finishHold = { base: this.renderPose(), rendered };
  }
  renderPose() {
    return {
      bound: [...this.animation.bound],
      mirror: this.animation.mirrorChanged,
      root: Object.fromEntries(
        ['position', 'scale', 'angle', 'color'].map((name) => [
          name,
          typeof this.animation.root[name].value === 'number'
            ? [this.animation.root[name].value]
            : [...this.animation.root[name].value],
        ]),
      ),
    };
  }
  sameRenderPose(pose) {
    const a = this.animation;
    return (
      pose.mirror === a.mirrorChanged &&
      pose.bound.length === a.bound.size &&
      pose.bound.every(([name, value]) => Object.is(value, a.bound.get(name))) &&
      Object.entries(pose.root).every(([name, values]) =>
        values.every((v, i) =>
          Object.is(
            v,
            typeof a.root[name].value === 'number' ? a.root[name].value : a.root[name].value[i],
          ),
        ),
      )
    );
  }
  restoreRenderPose(pose) {
    this.animation.bound = new Map(pose.bound);
    this.animation.mirrorChanged = pose.mirror;
    for (const [name, values] of Object.entries(pose.root)) {
      if (typeof this.animation.root[name].value === 'number')
        this.animation.root[name].value = values[0];
      else this.animation.root[name].value.set(values);
    }
  }
  snapshot() {
    return structuredClone({
      finishHold: this.finishHold ?? null,
      program: this.program,
      body: this.body,
      position: this.position,
      positionInitialized: this.positionInitialized,
      scale: this.scale,
      angle: this.angle,
      lastFrame: this.lastFrame,
      lastAnimationFrame: this.lastAnimationFrame,
      idle: this.idle,
      animation: this.animation.snapshot(),
      variables: this.variables.snapshot(),
      bodyVariables: this.bodyVariables.snapshot(),
      readyFrame: this.readyFrame,
      fadeFrames: this.fadeFrames,
      firstFrame: this.firstFrame,
      external: this.external.snapshot(),
      integerRandom: this.integerRandom?.snapshot() ?? null,
    });
  }
  restore(state) {
    for (const key of [
      'program',
      'body',
      'position',
      'scale',
      'angle',
      'lastFrame',
      'lastAnimationFrame',
      'readyFrame',
      'fadeFrames',
      'firstFrame',
      'idle',
      'positionInitialized',
    ])
      this[key] = structuredClone(state[key]);
    this.pose = this.profiles.pose(this.program, this.body ? this.body.split(',') : []);
    this.animation.restore(state.animation);
    this.variables.restore(state.variables);
    this.bodyVariables.restore(state.bodyVariables);
    this.pose.codes = this.variables.codes;
    this.pose.bodyCodes = this.bodyVariables.codes;
    this.external.setPose(this.pose);
    this.external.restore(state.external);
    if (state.integerRandom) this.integerRandom.restore(state.integerRandom);
    this.finishHold = structuredClone(state.finishHold);
    if (this.finishHold) {
      const current = this.renderPose();
      this.restoreRenderPose(this.finishHold.rendered);
      this.geometry.update();
      this.restoreRenderPose(current);
    } else this.geometry.update();
  }
}
