// SPDX-License-Identifier: MPL-2.0
// String task kinds 48 and 63.
// Recovered native resource ranges are selected per ABI. Other resource
// producers use the World's canonical message numbers.
import { nativeABI } from './abi/index.mjs';
import { NativeGraphicTask } from './graphics.mjs';
import { NativeBitmap } from './image.mjs';
import { NativeTextRuntime, NativeTextWriter } from './text.mjs';
import { nvTextConfig, textConfig, unpackTextConfiguration } from './text-config.mjs';
import { CanvasTextGlyphs } from '../render/native-text.mjs';
import { MOTION_ABI, setMotionVector } from '../motion/abi.mjs';
import { nativeReply } from '../kcs.mjs';
import { nativeEngineWord, NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';
import { nativeDataMapped } from './data-text.mjs';
import { installNativeLegacyText } from './text-legacy.mjs';
import { installNativeDisplayLogs } from './text-log.mjs';
const copyTextFrame = NativeTextWriter.prototype.frame;

export class NativeTextService {
  constructor(world, { glyphs = new CanvasTextGlyphs() } = {}) {
    this.world = world;
    this.core = new NativeTextRuntime({ profile: world.profile }, { world, glyphs });
    this.fes = null;
    this.log = null;
  }
  async runtime() {
    await (this.ready ??= this.core.ready());
    return this.core;
  }
  snapshot() {
    return this.core.snapshot({ windows: false });
  }
  async restore(state) {
    if (state.writers.length || state.fonts.length) await this.runtime();
    this.core.restore(state, { windows: false });
  }
  close() {
    return this.core.close();
  }
  create(record) {
    const task =
      record.kind === 49 ? new NativeNVTextTask(this, record) : new NativeTextTask(this, record);
    this.world.graphics.tasks.set(record.id, task);
    return task;
  }
}

export class NativeTextTask {
  constructor(service, record) {
    Object.assign(this, {
      service,
      record,
      world: service.world,
      graphics: service.world.graphics,
    });
    this.plane = new NativeGraphicTask(this.graphics, record);
    this.text = {
      writer: null,
      config: null,
      source: '',
      sourceEvents: [],
      output: 0,
      vram: [0, 0],
      active: false,
      elapsed: 0,
      lastFrame: 0,
      pageLimit: 0,
    };
  }
  get mode() {
    return this.record.kind === 63 ? 'utf8' : 'cp932';
  }
  get firstMessage() {
    if (this.mode === 'cp932') {
      const messages = nativeABI(this.world.profile).text.resourceMessages;
      if (messages.cp932UsesNativeMessages) return messages.first.cp932;
    }
    return this.mode === 'utf8' ? 469 : 449;
  }
  get graph() {
    return this.plane.graph;
  }
  get state() {
    return this.plane.state;
  }
  makeGraph(shape) {
    return this.plane.makeGraph(shape);
  }
  sync() {
    return this.plane.sync();
  }
  drawGPU(gpu) {
    return this.plane.drawGPU(gpu);
  }
  now() {
    return ((this.record.effectiveFrame ?? 0) - (this.record.pausedFrames ?? 0)) >>> 0;
  }
  async writer() {
    return this.text.writer === null ? null : (await this.service.runtime()).get(this.text.writer);
  }
  memory(sender, context) {
    return (
      context.payload ||
      context.machine ||
      this.world.objects.machine(context.nativeSenderWorldID ?? sender)
    );
  }
  readString(memory, address) {
    return new TextDecoder(this.mode === 'utf8' ? 'utf-8' : 'shift_jis').decode(
      this.readBytes(memory, address),
    );
  }
  readBytes(memory, address) {
    const bytes = [];
    for (let i = 0; i < 1024 * 1024; i++) {
      const value = memory.bytes(address + i, 1)[0];
      if (!value) return Uint8Array.from(bytes);
      bytes.push(value);
    }
    throw new Error('Native text string exceeds its memory boundary');
  }
  async output(region = null) {
    const writer = await this.writer();
    if (!writer || !this.text.output) return;
    const readFrame = writer.frame,
      frame = Reflect.apply(readFrame, writer, []),
      ownsPixels =
        readFrame === copyTextFrame &&
        frame.rgba instanceof Uint8ClampedArray &&
        frame.rgba.buffer !== writer.pixels.rgba.buffer,
      bitmap = new NativeBitmap(this.graphics.images, {
        ...frame,
        rgba: ownsPixels ? null : frame.rgba,
        bpp: 4,
        canvasWidth: frame.width,
        canvasHeight: frame.height,
        offsetX: 0,
        offsetY: 0,
        baseX: 0,
        baseY: 0,
        clip: [0, 0, frame.width, frame.height],
        source: null,
        attributes: [],
      });
    if (ownsPixels) bitmap.state.rgba = frame.rgba;
    await this.graphics.output(bitmap, this.text.vram, region);
  }
  async dirtyOutput() {
    const writer = await this.writer();
    if (!writer || !this.text.output) return;
    const region = writer.dirty();
    if (region[0] < region[2] && region[1] < region[3]) {
      await this.output(region);
      writer.clearDirty();
    }
  }
  async restart() {
    const writer = await this.writer();
    if (!writer || !this.graph || !this.state.shown) return;
    this.text.active = true;
    await writer.draw(this.text.elapsed, this.text.pageLimit);
    await this.output();
    writer.clearDirty();
    this.text.lastFrame = this.now();
  }
  async tick() {
    if (this.record.userValue) return;
    const writer = await this.writer();
    if (!writer || !this.text.active) return;
    this.text.active = !(await writer.draw(this.text.elapsed, this.text.pageLimit));
    await this.dirtyOutput();
    const now = this.now();
    this.text.elapsed = (this.text.elapsed + now - this.text.lastFrame) >>> 0;
    this.text.lastFrame = now;
  }
  async message(words, context = {}) {
    if (context.fromHost) {
      const runtime = await this.service.runtime();
      return runtime.fromHost(() => this.message(words, { ...context, fromHost: false }));
    }
    const [sender, message, w, l] = words,
      operation = message - this.firstMessage,
      resourceMessages = nativeABI(this.world.profile).text.resourceMessages,
      nativeCP932 = this.mode === 'cp932' && resourceMessages.cp932UsesNativeMessages,
      reply = nativeCP932 ? NATIVE_UNWRITTEN_WORD : 0;
    if (operation < 0 || operation > resourceMessages.maxOperation) {
      if (message === 47 && !this.text.output) return 0;
      return this.plane.message(words, context);
    }
    const runtime = await this.service.runtime(),
      bindings = runtime.bindings(this.mode),
      packetSize = bindings.packetSize ?? bindings.configSize + 16,
      configEnd = 4 + (bindings.nativeConfig?.size ?? bindings.configSize),
      memory = this.memory(sender, context),
      pointer = l !== 0 || context.payload;
    let writer = await this.writer();
    if (operation === 0) {
      if (pointer && memory?.load(l) === packetSize)
        if (memory.write) memory.write(l, await runtime.defaultPacket(this.mode));
        else memory.bytes(l, packetSize).set(await runtime.defaultPacket(this.mode));
      return reply;
    }
    if (operation === 1 || operation === 2) {
      if (!pointer) return reply;
      if (!memory) throw new Error('Native text configuration requires sender memory');
      if (!writer && operation === 2) return reply;
      if (!writer) {
        writer = await runtime.create(this.mode);
        this.text.writer = writer.pointer;
      } else if (operation === 1) {
        await writer.clear();
        this.text.sourceEvents = [];
        this.text.source = '';
      }
      if (memory.load(l) !== packetSize) return reply;
      this.text.config = memory.bytes(l, packetSize).slice();
      const config = unpackTextConfiguration(
          bindings,
          this.text.config,
          bindings.nativeConfig &&
            textConfig(this.world.profile, this.mode, this.world.configuration),
        ),
        view = new DataView(this.text.config.buffer);
      this.text.vram = [view.getInt32(configEnd, true), view.getInt32(configEnd + 4, true)];
      this.text.output = view.getUint32(configEnd + 8, true);
      await writer.configure(config);
      if (operation === 1) {
        this.text.sourceEvents = [];
        this.text.elapsed = this.text.pageLimit = 0;
        this.text.active = false;
        this.text.source = '';
        this.text.sourceEvents = [];
        const dimensions = new DataView(config.buffer, config.byteOffset, config.byteLength);
        this.makeGraph({
          type: 1,
          width: dimensions.getUint32(4, true),
          height: dimensions.getUint32(8, true),
          vram: true,
        });
        const position =
          nativeCP932 && !resourceMessages.cp932SignedVramPosition
            ? this.text.vram.map((word) => word >>> 0)
            : this.text.vram;
        setMotionVector(this.graph.textureTransform, MOTION_ABI.pos, [...position, 0]);
        this.sync();
      } else if (this.mode === 'utf8') {
        await writer.clear();
        if (this.text.source) await writer.appendSource(this.text.source);
      } else if (resourceMessages.cp932ReconfigureRetainsPageMarkers) {
        await writer.clear();
        for (const event of this.text.sourceEvents) {
          if (event.kind === 'mark') await writer.mark();
          else await writer.appendEncoded(event.bytes);
        }
      }
      await this.output();
      if (operation === 2) await this.restart();
      return reply;
    }
    if (operation === 5 || operation === 17) {
      if (!writer) throw new Error('Native text remaining query requires an initialized writer');
      return writer.remaining(operation === 5 ? -1 : this.text.pageLimit);
    }
    if (operation === 18) {
      if (pointer && (writer || resourceMessages.emptyEngineQueryWritesZero)) {
        if (!memory) throw new Error('Native text engine query requires sender memory');
        memory.store(l, writer?.enginePointer() ?? 0);
      }
      return reply;
    }
    if (!writer && !(nativeCP932 && operation === 4)) return reply;
    switch (operation) {
      case 3: {
        if (!memory) throw new Error('Native text append requires sender memory');
        const bytes = this.readBytes(memory, l).slice();
        this.text.sourceEvents.push({ kind: 'append', bytes });
        const text = await writer.appendEncoded(bytes);
        if (this.mode === 'utf8') this.text.source += text;
        return reply;
      }
      case 4:
        await writer?.clear();
        this.text.elapsed = this.text.pageLimit = 0;
        this.text.active = false;
        this.text.source = '';
        this.text.sourceEvents = [];
        await this.output();
        return reply;
      case 6:
        if (this.graph) {
          const pageLimit =
            nativeCP932 && !resourceMessages.cp932DrawUsesPageLimit ? -1 : this.text.pageLimit;
          await writer.draw(-1, pageLimit);
          await this.dirtyOutput();
          this.text.active = false;
        }
        return reply;
      case 7:
        this.text.sourceEvents.push({ kind: 'mark' });
        await writer.mark();
        if (this.mode === 'utf8') this.text.source += '\uffff';
        return reply;
      case 8:
        this.text.pageLimit = l | 0;
        await this.restart();
        return reply;
      case 9:
        if (context.resourceBytes) {
          await writer.userFont(context.resourceBytes);
          context.consumeResource?.();
        } else if (!l) await writer.resourceMessage(9, 0, 0);
        else if (context.nativePointer && this.world.transitionalExe?.readTextResource)
          await writer.userFont(await this.world.transitionalExe.readTextResource(this.world, l));
        else if (nativeCP932 && !context.nativePointer) {
          const buffers = this.world.runtime.imageDataBuffers,
            source = buffers.pointer(l);
          await writer.userFont(buffers.data(source));
          buffers.releasePointer(source);
        } else throw new Error('Native text image font requires a mounted image-data resource');
        return reply;
      case 10:
        if (!nativeCP932 || writer.imageFont)
          await writer.resourceMessage(10, nativeCP932 ? w & 0xffff : w, l);
        return reply;
      case 11: {
        if (!memory) throw new Error('Native text cursor query requires sender memory');
        const [x, y] = await writer.endPosition();
        memory.store(w, x);
        memory.store(l, y);
        return reply;
      }
      case 12:
        await writer.speed(l);
        return reply;
      case 13: {
        if (!memory) throw new Error('Native text category edit requires sender memory');
        // The task parses category strings as CP932 even in STRING8 mode.
        const bytes = [];
        for (let i = 0; i < 1024 * 1024; i++) {
          const value = memory.bytes(l + i, 1)[0];
          bytes.push(value);
          if (!value) {
            await writer.category(w, Uint8Array.from(bytes.slice(0, -1)));
            return 0;
          }
        }
        throw new Error('Native text category string exceeds its memory boundary');
      }
      case 14:
        return writer.lineCount();
      case 15:
        await writer.shift(l);
        await this.dirtyOutput();
        return 0;
      case 16:
        if (!memory) throw new Error('Native text profile requires sender memory');
        await writer.profileEncoded(w, this.readBytes(memory, l));
        return 0;
      case 19:
        await writer.resourceMessage(19, w, 0);
        return 0;
      default:
        throw new Error(
          `Native text task ${this.record.id} engine message ${message} has no recovered resource adapter`,
        );
    }
  }
  snapshot() {
    return { plane: this.plane.snapshot(), text: structuredClone(this.text) };
  }
  async restore(state) {
    await this.plane.restore(state.plane);
    this.text = structuredClone(state.text);
    if (this.text.writer !== null) await this.writer();
  }
  async close({ fromHost = false } = {}) {
    if (this.text.writer === null) {
      await this.plane.close();
      return;
    }
    const runtime = await this.service.runtime(),
      close = async () => {
        const writer = await this.writer();
        if (writer) await writer.close();
        await this.plane.close();
      };
    return fromHost ? runtime.fromHost(close) : close();
  }
}

// NV text owns section parsers and two text channels. Its packet/message
// layout differs from STRING, including the independently frozen SDK layout.
export class NativeNVTextTask extends NativeTextTask {
  constructor(service, record) {
    super(service, record);
    this.text.sectionPending = false;
    this.text.done = true;
  }
  get mode() {
    return 'nv';
  }
  get firstMessage() {
    return 489;
  }
  async dirtyOutput() {
    const writer = await this.writer();
    if (!writer || !this.text.output) return;
    const region = writer.dirty();
    if (region[0] < region[2] && region[1] < region[3]) {
      await this.output(region);
      writer.clearDirty();
      this.text.done = (await writer.remaining()) === 0;
    }
  }
  async clearOutput() {
    const writer = await this.writer();
    if (writer && this.text.output) {
      const frame = writer.frame();
      await this.graphics.fill(...this.text.vram, frame.width, frame.height, 0);
    }
  }
  async restart() {
    const writer = await this.writer();
    if (!writer || !this.graph) return;
    if (!this.state.shown) {
      this.text.active = false;
      return;
    }
    // The primary parser's frame mode follows the NV rectangle in the normalized configuration.
    this.text.active = writer.configView.getInt32(136, true) !== 0;
    if (this.text.sectionPending) {
      this.text.elapsed = 0;
      this.text.sectionPending = false;
    }
    await writer.draw(this.text.active ? this.text.elapsed : -1, this.text.pageLimit);
    await this.output();
    writer.clearDirty();
    this.text.lastFrame = this.now();
  }
  async tick(frame = this.record.effectiveFrame ?? 0) {
    const writer = await this.writer();
    if (!writer || !this.text.active) return;
    if (this.text.sectionPending) {
      this.text.elapsed = 0;
      this.text.lastFrame = this.now();
      this.text.sectionPending = false;
    }
    this.text.active = !(await writer.draw(this.text.elapsed, this.text.pageLimit));
    await this.dirtyOutput();
    this.text.elapsed = (this.text.elapsed + (frame >>> 0) - this.text.lastFrame) >>> 0;
    this.text.lastFrame = frame >>> 0;
  }
  async message(words, context = {}) {
    if (context.fromHost) {
      const runtime = await this.service.runtime();
      return runtime.fromHost(() => this.message(words, { ...context, fromHost: false }));
    }
    const [sender, message, w, l] = words,
      operation = message - 489;
    if (operation < 0 || operation > 17) {
      if (message === 47) {
        if (!this.text.output) return 0;
        const value = await this.plane.message(words, context);
        if (l) await this.output();
        else await this.clearOutput();
        return value;
      }
      return this.plane.message(words, context);
    }
    const runtime = await this.service.runtime(),
      bindings = runtime.bindings('nv'),
      memory = this.memory(sender, context);
    let writer = await this.writer();
    if (operation === 0) {
      if ((l || context.payload) && memory?.load(l) === bindings.packetSize) {
        const bytes = await runtime.defaultPacket('nv');
        if (memory.write) memory.write(l, bytes);
        else memory.bytes(l, bytes.length).set(bytes);
      }
      return 0;
    }
    if (operation === 1 || operation === 2) {
      if (!l && !context.payload) return 0;
      if (!memory) throw new Error('Native NV text configuration requires sender memory');
      if (!writer && operation === 2) return 0;
      if (!writer) {
        writer = await runtime.create('nv');
        this.text.writer = writer.pointer;
      } else if (operation === 1) {
        await writer.clear();
        this.text.sourceEvents = [];
        this.text.source = '';
      }
      if (memory.load(l) !== bindings.packetSize) return 0;
      this.text.config = memory.bytes(l, bindings.packetSize).slice();
      const view = new DataView(this.text.config.buffer),
        at = 4 + (bindings.nativeConfig?.size ?? bindings.configSize);
      this.text.vram = [view.getInt32(at, true), view.getInt32(at + 4, true)];
      this.text.output = view.getUint32(at + 8, true);
      await writer.configure(
        unpackTextConfiguration(
          bindings,
          this.text.config,
          bindings.nativeConfig && nvTextConfig(this.world.profile, this.world.configuration),
        ),
      );
      if (operation === 1) {
        this.text.sourceEvents = [];
        this.text.elapsed = this.text.pageLimit = 0;
        this.text.active = false;
        this.makeGraph({
          type: 1,
          width: view.getUint32(4, true),
          height: view.getUint32(8, true),
          vram: true,
        });
        setMotionVector(this.graph.textureTransform, MOTION_ABI.pos, [...this.text.vram, 0]);
        this.sync();
        await writer.erase();
        await this.output();
      } else {
        await writer.reflow();
        await this.restart();
      }
      return 0;
    }
    if (operation === 6) {
      if (!writer) throw new Error('Native NV remaining query requires an initialized writer');
      return writer.remaining();
    }
    if (!writer && (operation === 14 || operation === 17))
      throw new Error(
        `Native NV ${operation === 14 ? 'section' : 'redraw'} requires an initialized writer`,
      );
    if (!writer) return 0;
    switch (operation) {
      case 3:
        {
          const bytes = this.readBytes(memory, l).slice();
          this.text.sourceEvents.push({ kind: 'append', bytes });
          await writer.appendEncoded(bytes);
        }
        this.text.done = false;
        return 0;
      case 4:
        this.text.sourceEvents.push({
          kind: 'secondary',
          bytes: this.readBytes(memory, l).slice(),
        });
        await writer.appendSecondaryEncoded(this.text.sourceEvents.at(-1).bytes);
        this.text.done = false;
        return 0;
      case 5:
        this.text.sourceEvents = [];
        await writer.clear();
        await writer.erase();
        await this.output();
        this.text.elapsed = this.text.pageLimit = 0;
        this.text.active = false;
        return 0;
      case 7:
        if (this.graph) {
          await writer.draw(-1, -1);
          await this.dirtyOutput();
          this.text.active = false;
        }
        return 0;
      case 8:
        this.text.sourceEvents.push({ kind: 'mark' });
        await writer.mark();
        return 0;
      case 9:
        this.text.pageLimit = l | 0;
        await this.restart();
        return 0;
      case 10:
        if (context.resourceBytes) {
          await writer.userFont(context.resourceBytes);
          context.consumeResource?.();
        } else if (!l) await writer.userFont(null);
        else if (context.nativePointer && this.world.transitionalExe?.readTextResource)
          await writer.userFont(await this.world.transitionalExe.readTextResource(this.world, l));
        else throw new Error('Native NV image font requires its owned native image-data resource');
        return 0;
      case 11:
        await writer.resourceMessage(10, w, l);
        return 0;
      case 12: {
        const position = await writer.endPosition();
        if (!position) return 0;
        const [x, y] = position;
        memory.store(w, x);
        memory.store(l, y);
        return 0;
      }
      case 13:
        await writer.speed(l);
        return 0;
      case 14:
        this.text.sourceEvents.push({ kind: 'section' });
        await writer.section();
        this.text.sectionPending = true;
        return 0;
      case 15:
        await this.output();
        return 0;
      case 16:
        await this.clearOutput();
        return 0;
      case 17:
        await writer.redraw();
        await this.output();
        return 0;
      default:
        throw new Error(`Unrecovered NV text operation ${operation}`);
    }
  }
}

export function installNativeText(world, { glyphs } = {}) {
  installNativeLegacyText(world);
  installNativeDisplayLogs(world);
  const service = new NativeTextService(world, { glyphs });
  world.text = service;
  for (const kind of [48, 49, 63]) world.objects.register(kind, (record) => service.create(record));
  for (const id of NATIVE_TEXT_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      nativeText(id, args, machine, task, world),
    );
  return service;
}

export const NATIVE_TEXT_IDS = Object.freeze([
  0x263, 0x264, 0x265, 0x266, 0x267, 0x268, 0x269, 0x26a, 0x26b, 0x26c, 0x26d, 0x2b7, 0x374,
]);
export async function nativeText(id, args, machine, task, world) {
  if (!NATIVE_TEXT_IDS.includes(id)) return undefined;
  const abi = world.profile && nativeABI(world.profile),
    messages = abi?.text.resourceMessages,
    nativeCP932 = messages?.cp932UsesNativeMessages,
    first = nativeCP932 ? messages.first.cp932 : 449;
  if (nativeCP932) {
    const expected = abi.tables.main.entries[id].signature.argumentWords;
    if (args.length !== expected)
      throw new Error(`Text native ${id} expects ${expected} arguments`);
  }
  const send = (operation, w = 0, l = 0, payload = null) =>
    world.sendNativeEngine
      ? world.sendNativeEngine(
          args[0],
          task.id,
          first + operation,
          w,
          l,
          payload ? { payload } : {},
        )
      : world.graphics.send(args[0], task.id, first + operation, w, l, payload);
  const configure = (operation) =>
    nativeCP932 && !nativeDataMapped(machine, args[1])
      ? send(operation)
      : send(operation, 0, args[1], machine);
  const remaining = async (operation) => {
    const reply = await send(operation);
    return nativeReply(1, nativeCP932 ? nativeEngineWord(reply, 'Native text remaining') : reply);
  };
  switch (id) {
    case 0x263:
      await configure(0);
      break;
    case 0x264:
      await configure(1);
      break;
    case 0x265:
      await configure(2);
      break;
    case 0x266: {
      const format = world.runtime.services?.formatBytes;
      if (typeof format !== 'function')
        throw new Error('Native text append requires the original KCS formatter');
      const source = Uint8Array.from([...format(args[1], machine), 0]),
        view = new DataView(source.buffer),
        payload = {
          load: (at) => view.getUint32(at, true),
          store: (at, value) => view.setUint32(at, value, true),
          bytes: (at, size) => source.subarray(at, at + size),
        };
      await send(3, 0, 0, payload);
      break;
    }
    case 0x267:
      await send(4);
      break;
    case 0x268:
      return remaining(5);
    case 0x269:
      await send(6);
      break;
    case 0x26a:
      await send(7);
      break;
    case 0x26b:
      await send(8, 0, args[1]);
      break;
    case 0x26c: {
      if (!args[1]) break;
      if (nativeCP932) {
        await send(9, 0, args[1]);
        break;
      }
      const buffers = world.runtime.imageDataBuffers,
        source = buffers.pointer(args[1]),
        context = {
          resourceBytes: buffers.data(source).slice(),
          consumeResource: () => buffers.releasePointer(source),
        };
      if (world.sendNativeEngine) {
        await world.sendNativeEngine(args[0], task.id, 458, 0, 0, context);
        break;
      }
      const targetID = world.resolveTaskID ? world.resolveTaskID(args[0], task.id) : args[0],
        target = world.graphics.get(targetID);
      if (target)
        await target.message(
          [world.nativeTaskID ? world.nativeTaskID(task.id) : task.id, 458, 0, 0],
          context,
        );
      break;
    }
    case 0x26d:
      await send(10, args[1], args[2]);
      break;
    case 0x2b7:
      await send(12, 0, args[1]);
      break;
    case 0x374:
      return remaining(17);
  }
  return nativeReply(2);
}
