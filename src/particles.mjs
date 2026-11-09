// SPDX-License-Identifier: MPL-2.0
import { readKCS } from './kcs.mjs';
import { ParticleScriptInstance } from './ppi/script.mjs';
import { NativePPIRuntime } from './ppi/native.mjs';
import { ParticleRandom } from './ppi/random.mjs';
import { loadUnicorn } from './ppi/backend.mjs';
import { linearInterpolate, roundInteger } from './ppi/numeric.mjs';
import { scriptParticles, ppiParticles, particleGeometry } from './ppi/geometry.mjs';
import { ParticlesGL } from './render/particles-gl.mjs';

const normalize = (name) => name.replaceAll('\\', '/').toLowerCase();
const white = { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
export class Particles {
  constructor(
    stage,
    {
      game,
      images,
      unicornFactory = loadUnicorn,
      random = new ParticleRandom(),
      fps = 60,
      attachment,
      now,
      clock,
      epoch = 0,
      onDebug = null,
      nativeThread,
      projectGeometry = particleGeometry,
    } = {},
  ) {
    this.stage = stage;
    this.game = game;
    this.images = images;
    this.unicornFactory = unicornFactory;
    this.random = random;
    this.fps = fps;
    this.attachment = attachment;
    this.onDebug = onDebug;
    this.nativeThread = nativeThread;
    this.projectGeometry = projectGeometry;
    this.clock = clock;
    this.epoch = epoch;
    this.now = clock ? () => clock.now() : now || (() => (this.frame * 1000) / this.fps);
    this.banks = new Map();
    this.resources = new Map();
    this.unsupported = new Set();
    this.events = [];
    this.frame = stage.frame;
    this.sequence = 0;
  }
  number(value, fallback = 0) {
    if (value === undefined) return fallback;
    const n = typeof value === 'number' ? value : this.stage.evaluate(value);
    if (!Number.isFinite(n)) throw new Error(`Invalid particle number ${value}`);
    return Math.trunc(n) | 0;
  }
  resource(category, name, extension) {
    if (typeof this.game.resolveCategory === 'function') {
      const resolved = this.game.resolveCategory(name, category);
      if (resolved === null) throw new Error(`Missing ${category} resource: ${name}`);
      return resolved;
    }

    const file = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${extension}`;
    const candidates = name.includes('/')
      ? [file]
      : [`${category}/${file}`, `${category}.int/${file}`, file];
    const found = candidates.find((candidate) => this.game.has(candidate));
    if (!found) throw new Error(`Missing ${category} resource: ${name}`);
    return found;
  }
  get hasLooseLibraries() {
    return Boolean(this.game.nativeResources && this.game.readLoose);
  }
  async readPlugin(name) {
    if (!this.hasLooseLibraries) return this.game.require(name);
    const path = name.replace(/^c:[\\/]catsystem2-web[\\/]/i, ''),
      bytes = await this.game.readLoose(path);
    if (bytes === null) throw new Error(`Missing loose particle library: ${name}`);
    return bytes;
  }
  async preloadData() {
    if (this.dataReady) return;
    const entry = this.game.nativeResources?.entries.find(
      (entry) => normalize(entry.name) === 'ptcldat',
    );
    const prefixes = entry
      ? [entry.archive, entry.directory]
          .filter(Boolean)
          .map((name) => normalize(name).replace(/\/$/, '') + '/')
      : ['ptcldat/', 'ptcldat.int/'];
    const keys = [...(this.game.qualifiedIndex?.keys() || [])].filter((key) =>
      prefixes.some((prefix) => normalize(key).startsWith(prefix)),
    );
    let bytes = 0;
    const loaded = new Map();
    for (const key of keys) {
      const hit = this.game.lookup?.(key) || key;
      let data = loaded.get(hit);
      if (!data) {
        data = await this.game.require(key);
        bytes += data.length;
        if (bytes > 128 * 1024 * 1024) throw new Error('Particle resource budget exceeded');
        loaded.set(hit, data);
      }
      this.resources.set(normalize(key), data);
      if (!this.game.resolveCategory)
        for (const prefix of prefixes)
          if (normalize(key).startsWith(prefix))
            this.resources.set(normalize(key).slice(prefix.length), data);
    }
    this.dataReady = true;
  }
  data(name) {
    if (this.game.resolveCategory) {
      const resolved = this.game.resolveCategory(name, 'ptcldat');
      return resolved === null ? null : this.resources.get(normalize(resolved)) || null;
    }
    return this.resources.get(normalize(name)) || null;
  }
  async nativeRuntime() {
    if (!this.runtime) {
      this.runtimeLoading ||= NativePPIRuntime.open({
        unicornFactory: this.unicornFactory,
        random: this.random,
        now: this.now,
        clock: this.clock,
        epoch: this.clock?.epoch ?? this.epoch,
        nativeThread: this.nativeThread,
      }).then((runtime) => (this.runtime = runtime));
      await this.runtimeLoading;
    }
    return this.runtime;
  }
  create(key) {
    if (this.closed) throw new Error('Particle host is closed');
    if (this.banks.has(key)) throw new Error(`Particle bank already exists: ${key}`);
    const bank = {
      key,
      order: this.sequence++,
      loaded: false,
      started: false,
      alpha: 255,
      attachPlane: -1,
      attachmentNamespace: 'graph',
      registers: new Float32Array(32),
      speed: 1,
      clockStart: null,
    };
    this.banks.set(key, bank);
    this.metadata(bank);
    return bank;
  }
  metadata(bank) {
    this.stage.emitters[String(bank.key)] = {
      family: bank.family,
      program: bank.program,
      texture: bank.texture,
      count: bank.count,
      priority: bank.priority,
      active: Boolean(bank.started && bank.instance?.active),
      alpha: bank.alpha,
    };
  }
  refreshAttachment(bank) {
    if (bank.attachPlane === -1) {
      bank.attachment = null;
      return -1;
    }
    const provider = this.attachment || this.stage.particleAttachment;
    if (typeof provider !== 'function')
      throw new Error(`Particle attachment ${bank.attachPlane} has no native graph mapping`);
    const attachment = provider(bank.attachPlane, {
      namespace: bank.attachmentNamespace,
      bank: bank.key,
    });
    if (!attachment && (bank.family !== 'plugin' || bank.attachmentNamespace !== 'graph'))
      throw new Error(`Particle attachment graph is unavailable: ${bank.attachPlane}`);
    if (bank.attachmentNamespace === 'cst' && !Number.isInteger(attachment.id))
      throw new Error('CST particle attachment requires its resolved native graph id');
    bank.attachment = attachment;
    return attachment?.id ?? bank.attachPlane;
  }
  async load(key, spec) {
    if (!this.game || !this.images)
      throw new Error('Particles require game resources and an image store');
    if (this.banks.has(key)) this.end(key, { stop: false });
    const bank = this.create(key);
    Object.assign(bank, {
      ...spec,
      key,
      order: bank.order,
      loaded: false,
      started: false,
      alpha: spec.alpha ?? 255,
      registers: new Float32Array(32),
      clockStart: null,
      attachPlane: spec.attachPlane ?? -1,
      attachmentNamespace: spec.attachmentNamespace || 'graph',
      speed: spec.speed ?? 1,
    });
    if (!['script', 'plugin'].includes(bank.family))
      throw new Error(`Unknown particle executable family ${bank.family}`);
    if (!Number.isSafeInteger(bank.count) || bank.count < 0 || bank.count > 1000000)
      throw new RangeError('Invalid particle count');
    if (!Number.isFinite(bank.priority)) throw new Error('Invalid particle priority');
    const category = bank.family === 'plugin' ? 'ptclpi' : 'ptcl';
    bank.program =
      bank.family === 'plugin' && this.hasLooseLibraries
        ? this.game.nativeResources.resolveLoose(bank.program, category)
        : this.resource(category, bank.program, bank.family === 'plugin' ? 'ppi' : 'kcs');
    if (bank.program === null) throw new Error(`Missing ${category} mount for ${spec.program}`);
    let texture;
    if (bank.texture) {
      try {
        texture = this.resource('image', bank.texture, 'hg3');
      } catch (error) {
        if (!String(error.message).startsWith('Missing image resource:')) throw error;
        this.events.push({ type: 'missing-texture', name: bank.texture, bank: key });
      }
    }
    bank.texture = texture || null;
    bank.image = texture ? await this.images.frame(texture) : white;
    bank.width = texture ? bank.image.width : 256;
    bank.height = texture ? bank.image.height : 256;
    const attachPlane = this.refreshAttachment(bank);
    const common = {
      name: bank.program,
      count: bank.count,
      width: bank.width,
      height: bank.height,
      screenWidth: this.stage.width,
      screenHeight: this.stage.height,
      fps: this.fps,
      priority: bank.priority,
      registers: spec.registers || [],
      attachPlane,
      attachment: () => bank.attachment,
      random: this.random,
      onDebug: this.onDebug,
      autoStart: false,
    };
    const bytes = await (bank.family === 'plugin'
      ? this.readPlugin(bank.program)
      : this.game.require(bank.program));
    if (bank.family === 'plugin') {
      await this.preloadData();
      const runtime = await this.nativeRuntime();
      bank.instance = await runtime.create(bytes, {
        ...common,
        readParticleData: (name) => this.data(name),
      });
    } else {
      const script = await readKCS(bytes);
      script.name = bank.program;
      bank.instance = new ParticleScriptInstance(script, common);
      bank.instance.stop();
    }
    bank.registers.set(bank.instance.registers);
    bank.loaded = true;
    bank.nativeRenderOrder = this.stage.nativeGraphics?.allocateRenderOrder?.();
    this.metadata(bank);
    if (spec.autoStart) this.start(key);
    return bank;
  }
  get(key) {
    return this.banks.get(key) || null;
  }
  start(key) {
    const bank = this.require(key);
    if (!bank.loaded) throw new Error(`Particle bank ${key} has no loaded executable`);
    bank.instance.attachPlane = this.refreshAttachment(bank);
    bank.instance.start();
    bank.started = true;
    bank.clockStart = null;
    bank.clockLast = null;
    bank.clockValue = 0;
    bank.retireAt = null;
    this.metadata(bank);
  }
  stop(key) {
    const bank = this.banks.get(key);
    if (!bank) return;
    if (bank.family === 'plugin' && bank.attachmentNamespace === 'graph' && bank.instance)
      bank.instance.attachPlane = this.refreshAttachment(bank);
    bank.instance?.stop();
    bank.started = false;
    bank.retireAt = null;
    this.metadata(bank);
  }
  end(key, { stop = true } = {}) {
    const bank = this.banks.get(key);
    if (!bank) return;
    if (stop) this.stop(key);
    bank.instance?.close?.({ stop: false });
    if (bank.instance) bank.instance.active = false;
    this.banks.delete(key);
    delete this.stage.emitters[String(key)];
  }
  require(key) {
    const bank = this.banks.get(key);
    if (!bank) throw new Error(`Particle bank is absent: ${key}`);
    return bank;
  }
  set(key, values) {
    const bank = this.require(key);
    if (values.length > 32) throw new Error('Particle accepts at most 32 registers');
    bank.registers.fill(0);
    bank.registers.set(values);
    bank.instance?.setRegisters(bank.registers);
  }
  alpha(key, value = 255) {
    const bank = this.require(key);
    bank.alpha = value | 0;
    this.metadata(bank);
  }
  attach(key, plane, namespace = 'graph') {
    const bank = this.require(key);
    bank.attachPlane = namespace === 'graph' && !plane ? -1 : plane | 0;
    bank.attachmentNamespace = namespace;
    if (bank.instance) bank.instance.attachPlane = this.refreshAttachment(bank);
  }
  busy(key) {
    if (key === undefined || key === null)
      return [...this.banks.values()].some((bank) => bank.started && bank.instance?.active);
    return Boolean(this.banks.get(key)?.started && this.banks.get(key)?.instance?.active);
  }
  async message(key, message, payload) {
    switch (message) {
      case 0x13a:
        return this.load(key, payload);
      case 0x13b:
        return this.start(key);
      case 0x13c:
        return this.stop(key);
      case 0x13d:
        return this.end(key, { stop: false });
      case 0x13e:
        return Number(this.busy(key));
      case 0x13f:
        return this.set(key, payload);
      case 0x140:
        return this.alpha(key, payload);
      case 0x141:
        return this.attach(key, payload);
      default:
        throw new Error(`Unknown particle task message 0x${message.toString(16)}`);
    }
  }
  async command(verb, args) {
    if (!['particle', 'particle2', 'particle3'].includes(verb))
      throw new Error(`Unknown particle scene command ${verb}`);
    const words = [...args],
      hasBank = /^\d+$/.test(words[0] || ''),
      bankNumber = hasBank ? this.number(words.shift()) : null,
      sub = words.shift();
    if (bankNumber !== null && (bankNumber < 0 || bankNumber > 3))
      throw new Error('CST particle bank must be between 0 and 3');
    if (sub === 'stop') {
      for (const key of bankNumber === null ? [0, 1, 2, 3] : [bankNumber]) this.end(key);
      return;
    }
    if (bankNumber === null || !sub) throw new Error(`Malformed ${verb} command`);
    if (sub === 'set') {
      if (this.banks.has(bankNumber))
        this.set(
          bankNumber,
          words.slice(0, 32).map((value) => this.number(value)),
        );
      return;
    }
    if (sub === 'alpha') {
      if (this.banks.has(bankNumber)) this.alpha(bankNumber, this.number(words[0], 255));
      return;
    }
    if (sub === 'fade') {
      const bank = this.banks.get(bankNumber);
      if (!bank) return;
      const frames = this.number(words[0], 30) >>> 0,
        from = this.number(words[1]),
        to = this.number(words[2], 255);
      this.alpha(bankNumber, from);
      bank.fade = { frames, from, to, start: null };
      return;
    }
    const attached = verb !== 'particle';
    if (words.length < (attached ? 4 : 3)) throw new Error(`Incomplete ${verb} load command`);
    const texture = words.shift(),
      count = this.number(words.shift()) >>> 0,
      priority = this.number(words.shift()),
      attachPlane = attached ? this.number(words.shift()) : -1;
    if (this.banks.has(bankNumber)) this.end(bankNumber);
    await this.load(bankNumber, {
      family: verb === 'particle3' ? 'plugin' : 'script',
      program: sub,
      texture,
      count,
      priority,
      attachPlane,
      attachmentNamespace: 'cst',
      registers: words.slice(0, 32).map((value) => this.number(value)),
      autoStart: true,
      autoRelease: true,
    });
  }
  update(frame = this.stage.frame) {
    if (!Number.isSafeInteger(frame) || frame < 0) throw new Error('Invalid particle update clock');
    this.frame = frame;
    for (const bank of [...this.banks.values()]) this.updateBank(bank.key, frame);
  }
  updateBank(key, frame) {
    if (!Number.isSafeInteger(frame) || frame < 0) throw new Error('Invalid particle update clock');
    this.frame = frame;
    const bank = this.require(key);
    if (bank.retireAt !== null && bank.retireAt !== undefined && frame >= bank.retireAt) {
      this.end(bank.key);
      return;
    }
    if (bank.fade) {
      const fade = bank.fade;
      if (fade.start === null) fade.start = frame;
      else {
        const elapsed = frame - fade.start;
        bank.alpha =
          elapsed >= fade.frames
            ? fade.to
            : roundInteger(linearInterpolate(fade.from, fade.to, 0, fade.frames, elapsed));
        if (elapsed >= fade.frames) bank.fade = null;
      }
    }
    if (bank.started && bank.instance.active) {
      bank.instance.attachPlane = this.refreshAttachment(bank);
      if (bank.clockStart === null) {
        bank.clockStart = frame;
        bank.clockLast = frame;
        bank.clockValue = 0;
      } else {
        bank.clockValue = (bank.clockValue + Math.imul(frame - bank.clockLast, bank.speed)) >>> 0;
        bank.clockLast = frame;
      }
      bank.instance.update(bank.clockValue);
      if (!bank.instance.active && bank.autoRelease) bank.retireAt = frame + 1;
    }
    if (bank.started && !bank.instance.active && bank.autoRelease && bank.retireAt == null)
      bank.retireAt = frame + 1;
    this.metadata(bank);
  }
  async drawBatch(bank) {
    const projection = this.stage.nativeGraphics?.projection();
    const particles =
        bank.family === 'plugin' ? ppiParticles(bank.instance) : scriptParticles(bank.instance),
      alpha = bank.alpha >= 255 ? 256 : bank.alpha;
    return {
      geometry: await this.projectGeometry(particles, {
        width: projection?.width ?? this.stage.width,
        height: projection?.height ?? this.stage.height,
        priority: bank.priority,
        alpha,
        zShifts: bank.instance.zShifts,
        screenMatrix: projection?.screenMatrix ?? bank.screenMatrix,
        screenShift: projection?.screenShift ?? bank.screenShift,
      }),
      image: bank.image,
      options: {
        context: this.stage.nativeGraphics?.d3dContext,
        drawType: 0,
        blendMode: bank.instance.blendMode,
        renderStates: bank.instance.renderStates,
        samplerStates: bank.instance.samplerStates,
      },
    };
  }
  async drawBank(key, gpu) {
    const bank = this.require(key);
    if (!bank.started || !bank.instance.active) return;
    const batch = await this.drawBatch(bank);
    gpu.drawGeometry(batch.geometry, batch.image, batch.options);
  }
  drawItems() {
    return [...this.banks.values()]
      .filter(
        (bank) => bank.started && bank.instance?.active && bank.alpha !== 0 && !bank.externalDraw,
      )
      .map((bank) => ({
        type: 'particle',
        priority: bank.priority,
        order: bank.order,
        nativeRenderOrder: bank.nativeRenderOrder,
        drawGPU: async (gpu) => this.drawBank(bank.key, gpu),
        draw: async (context) => {
          this.gpu ||= new ParticlesGL(this.stage.width, this.stage.height);
          const batch = await this.drawBatch(bank),
            canvas = this.gpu.render(batch.geometry, batch.image, context.canvas, batch.options);
          context.save();
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.globalAlpha = 1;
          context.globalCompositeOperation = 'copy';
          context.drawImage(canvas, 0, 0);
          context.restore();
        },
      }));
  }
  snapshot() {
    return {
      frame: this.frame,
      sequence: this.sequence,
      random: this.random.snapshot(),
      runtime: this.runtime?.snapshot() || null,
      banks: [...this.banks.values()].map((bank) => ({
        key: bank.key,
        order: bank.order,
        nativeRenderOrder: bank.nativeRenderOrder,
        family: bank.family,
        program: bank.program,
        texture: bank.texture,
        count: bank.count,
        priority: bank.priority,
        alpha: bank.alpha,
        attachPlane: bank.attachPlane,
        attachmentNamespace: bank.attachmentNamespace,
        speed: bank.speed,
        clockStart: bank.clockStart,
        clockLast: bank.clockLast,
        clockValue: bank.clockValue,
        retireAt: bank.retireAt,
        fade: structuredClone(bank.fade),
        autoRelease: bank.autoRelease,
        externalDraw: bank.externalDraw,
        screenMatrix: bank.screenMatrix,
        screenShift: bank.screenShift,
        loaded: bank.loaded,
        started: bank.started,
        registers: bank.registers.slice(),
        nativeID: bank.family === 'plugin' ? bank.instance.id : null,
        script: bank.family === 'script' ? bank.instance.snapshot() : null,
      })),
    };
  }
  async restore(state) {
    this.close();
    this.closed = false;
    this.banks = new Map();
    this.stage.emitters = {};
    this.frame = state.frame;
    this.sequence = state.sequence;
    // Native memory is restored once, atomically, before its JavaScript owners.
    if (state.runtime) {
      await this.preloadData();
      this.runtime = await NativePPIRuntime.fromSnapshot(state.runtime, {
        unicornFactory: this.unicornFactory,
        random: this.random,
        now: this.now,
        clock: this.clock,
        epoch: this.clock?.epoch ?? this.epoch,
        nativeThread: this.nativeThread,
        readPlugin: ({ name }) => this.readPlugin(name),
        instanceOptions: (saved) => ({
          attachment: () =>
            [...this.banks.values()].find((bank) => bank.nativeID === saved.id)?.attachment,
          readParticleData: (name) => this.data(name),
        }),
      });
    }
    for (const saved of state.banks) {
      const bank = { ...saved, registers: new Float32Array(saved.registers) };
      this.banks.set(bank.key, bank);
      bank.image = bank.texture ? await this.images.frame(bank.texture) : white;
      bank.width = bank.texture ? bank.image.width : 256;
      bank.height = bank.texture ? bank.image.height : 256;
      if (bank.family === 'plugin') bank.instance = this.runtime.instances.get(saved.nativeID);
      else {
        const script = await readKCS(await this.game.require(bank.program));
        script.name = bank.program;
        bank.instance = new ParticleScriptInstance(script, {
          count: bank.count,
          width: bank.width,
          height: bank.height,
          screenWidth: this.stage.width,
          screenHeight: this.stage.height,
          priority: bank.priority,
          fps: this.fps,
          random: this.random,
          attachment: () => bank.attachment,
        });
        bank.instance.restore(saved.script);
      }
      bank.instance.attachPlane = this.refreshAttachment(bank);
      this.metadata(bank);
    }
    this.random.restore(state.random);
  }
  close() {
    if (this.closed) return;
    for (const key of [...this.banks.keys()]) this.end(key);
    this.runtime?.close();
    this.runtime = null;
    this.runtimeLoading = null;
    this.gpu?.close();
    this.gpu = null;
    this.closed = true;
  }
}
