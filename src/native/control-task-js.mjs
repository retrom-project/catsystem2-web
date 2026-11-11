// SPDX-License-Identifier: MPL-2.0
// Real JS World control tasks. The interaction model owns numbers/timing; this
// adapter owns resource pixels, retained entries, actual areas and VRAM planes.
import { ControlTaskModel } from './control-task-model.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { bitmapTransfer } from './bitmap-pixels.mjs';
import { openImage } from '../formats/hg3.mjs';
import { floatBits } from '../kcs.mjs';
import { NATIVE_UNWRITTEN_WORD, nativeEngineWord } from './engine-message.mjs';
import { nativeABI } from './abi/index.mjs';

export function controlTaskBehavior(profile) {
  return nativeABI(profile).fes.controlResources;
}

const f = Math.fround;
const partNames = ['track', 'decrement', 'increment', 'thumb', 'external'];
const baseFrames = [0, 10, 20, 100, 200];
const signedWords = (memory, address, count) =>
  Array.from({ length: count }, (_, index) => memory.load(address + index * 4) | 0);
function metadata(bytes, selector) {
  const output = new Uint8Array(36);
  if (!nativeImageMetadata(bytes, selector, false, output).success) return null;
  const v = new DataView(output.buffer);
  return Array.from({ length: 9 }, (_, index) => v.getInt32(index * 4, true));
}
function resourceState() {
  return {
    bytes: null,
    frames: [],
    metadata: [],
    parts: [],
    composites: [],
    current: 0,
    drawIDs: [],
    areas: {},
    planes: [],
    descriptorPosition: [0, 0],
  };
}

export class JSControlTask {
  constructor(world, record, behavior) {
    if (!['state-direct'].includes(behavior?.scroll2Skin))
      throw new Error('A verified SCROLL2 skin selector policy is required');
    if (![40, 41, 42].includes(record.kind))
      throw new Error(`Unsupported control task ${record.kind}`);
    this.world = world;
    this.record = record;
    this.behavior = behavior;
    record.flags = 0; // Original derived tasks retain Base flags0.
    this.base = world.base(record);
    this.resource = resourceState();
    this.config = null;
    this.model = new ControlTaskModel(record.kind, (...args) => this.service(...args));
    this.drawFields = new Uint32Array(15);
    this.drawFields[9] = this.drawFields[10] = floatBits(1);
    this.drawFields[11] = 255;
    this.drawFields[12] = 1;
    this.packets = new Map(
      ['area', 'vector', 'shape', 'pointer'].map((name) => [name, new NativeGraphicsPacket()]),
    );
    this.point = new Int32Array(2);
    this.transfer = new Int32Array(10);
    this.loading = false;
    this.closed = false;
  }
  get kind() {
    return this.record.kind;
  }
  get input() {
    const input = this.world.inputFor(this.record.id);
    if (!input) throw new Error('Control task has no Input in its owning Top');
    return input;
  }
  get draw() {
    const draw = this.world.graphics.drawTasks.get(this.config?.drawID);
    if (!draw?.state.renderer)
      throw new Error('Control task requires an initialized Draw World ID');
    return draw;
  }
  packet(name, values) {
    const p = this.packets.get(name);
    p.data.fill(0);
    values.forEach((value, index) => p.store(index * 4, value));
    return p;
  }
  async send(target, message, w = 0, l = 0, payload = null, flags = 0) {
    return this.world.sendEngine(
      target,
      this.record.id,
      message,
      w,
      l,
      payload ? { payload, flags } : { flags },
    );
  }
  key(priority) {
    return (this.world.nativeTaskID(this.record.id) | (priority << 16)) >>> 0;
  }
  async bind(bitmap, priority, x, y, alpha = 255) {
    if (!bitmap) return false; // Original Draw282 with no source leaves its entry intact.
    const fields = this.drawFields;
    fields[0] = bitmap;
    fields[4] = floatBits(x);
    fields[5] = floatBits(y);
    fields[11] = alpha >>> 0;
    const key = this.key(priority);
    if (!this.resource.drawIDs.includes(key)) this.resource.drawIDs.push(key);
    return this.world.retainedDraw.bind(this.draw, key, fields);
  }
  async pointer() {
    const p = this.packets.get('pointer');
    await this.input.message(125, 0, 4, { memory: p });
    this.point[0] = p.load(0) | 0;
    this.point[1] = p.load(4) | 0;
    return this.point;
  }
  async frame(id, offset = null) {
    id >>>= 0;
    let pair = this.resource.frames.find((entry) => entry[0] === id);
    if (!pair) {
      if (!this.resource.bytes) return 0;
      this.image ??= await openImage(this.resource.bytes);
      const frame = this.image.frame(id);
      if (!frame) return 0;
      await this.image.decode(frame);
      const handle = this.world.graphics.images.addDecoded(this.image, frame);
      this.world.graphics.images.get(handle).owner = this.record.id;
      pair = [id, handle];
      this.resource.frames.push(pair);
    }
    if (offset) {
      const state = this.world.graphics.images.get(pair[1]).state;
      state.offsetX = offset[0];
      state.offsetY = offset[1];
    }
    return pair[1];
  }
  async area(part, bounds, priority) {
    let id = this.resource.areas[part];
    if (id === undefined) {
      id = await this.world.objects.create({
        kind: 6,
        parent: this.record.id,
        creator: this.record.id,
        name: this.kind === 40 ? 'scrl btn' : 'slider btn',
      });
      this.resource.areas[part] = id;
    }
    const p = this.packet('area', [...bounds, priority, this.world.nativeTaskID(id)]);
    await this.send(id, 89, 0, 0, p);
    return id;
  }
  async bounds(clear = false) {
    const id = this.resource.areas.thumb;
    if (id === undefined) return;
    const region = this.input.get(id);
    if (!region) return;
    if (clear) region.bounds = [0, 0, 0, 0];
    else region.bounds = this.thumbBounds();
    this.input.changed = true;
  }
  thumbBounds() {
    const s = this.model.state;
    if (this.kind === 40) {
      const [a, b, c] = this.resource.metadata;
      const capOffset = (a[s.direction ? 0 : 1] - b[s.direction ? 0 : 1]) | 0;
      if (s.direction === 0) {
        const x = (s.left + b[0]) | 0,
          y = (s.top + s.pixel + b[1]) | 0;
        return [x, (y + capOffset) | 0, (x + b[2]) | 0, (y + s.thumbLength + c[3]) | 0];
      }
      const x = (s.left + s.pixel + b[0]) | 0,
        y = (s.top + b[1]) | 0;
      return [(x + capOffset) | 0, y, (x + s.thumbLength + c[2]) | 0, (y + b[3]) | 0];
    }
    const header = this.resource.metadata[0];
    const x = (s.left + (s.direction ? 0 : s.pixel)) | 0;
    const y = (s.top + (s.direction ? s.pixel : 0)) | 0;
    if (this.kind === 42) return [x, y, (x + header[2]) | 0, (y + header[3]) | 0];
    return [
      x,
      y,
      (x + (s.direction ? header[2] : s.thumbLength)) | 0,
      (y + (s.direction ? s.thumbLength : header[3])) | 0,
    ];
  }
  async plane(width, height, x, y, textureX, textureY, priority) {
    const id = await this.world.objects.create({
      kind: 2,
      parent: this.record.id,
      creator: this.record.id,
      name: 'scrl pl',
    });
    this.resource.planes.push(id);
    await this.send(
      id,
      41,
      0,
      0,
      this.packet('shape', [0, 0, 0, floatBits(width), floatBits(height), 32, 1, -1]),
    );
    await this.vector(id, 51, 0, x, y, 0);
    await this.vector(id, 51, 1, textureX, textureY, 0);
    await this.vector(id, 49, 0, 0, 0, priority);
    await this.send(id, 63, 0, this.model.state.alpha, null, 1);
    return id;
  }
  vector(id, message, w, x, y, z) {
    return this.send(
      id,
      message,
      w,
      0,
      this.packet('vector', [floatBits(x), floatBits(y), floatBits(z)]),
      1,
    );
  }
  async load(config) {
    if (this.closed) throw new Error('Cannot load a released control task');
    if (!config || !Number.isInteger(config.drawID) || typeof config.file !== 'string')
      throw new TypeError('Control load requires a Draw World ID and resolved image filename');
    const fields =
      this.kind === 40
        ? ['type', 'vramX', 'vramY', 'x', 'y', 'priority', 'planePriority']
        : ['priority', 'planeX', 'planeY'];
    if (
      fields.some((key) => !Number.isInteger(config[key])) ||
      (this.kind !== 40 &&
        (!config.rect ||
          config.rect.length !== 4 ||
          [...config.rect].some((value) => !Number.isInteger(value))))
    )
      throw new TypeError('Control load requires complete typed geometry and priorities');
    const oldAreas = this.resource.areas;
    await this.unload(this.kind === 40);
    this.config = structuredClone(config);
    this.draw;
    this.model.state.loaded = false;
    const bytes = await this.world.imageFiles.readResolved(config.file);
    if (!bytes?.length) return false;
    this.resource.bytes = bytes.slice();
    this.image = null;
    if (this.kind !== 40) this.resource.areas = oldAreas;
    try {
      if (this.kind === 40) await this.loadScroll();
      else await this.loadRectangle();
      return true;
    } catch (error) {
      await this.unload(this.kind === 40);
      this.model.state.loaded = false;
      throw error;
    }
  }
  async loadScroll() {
    const c = this.config,
      s = this.model.state;
    if (c.type !== 0 && c.type !== 1) throw new RangeError('SCROLL load requires TYPE0 or TYPE1');
    this.resource.metadata = [1000, 1001, 1002].map((id) => metadata(this.resource.bytes, id));
    if (this.resource.metadata.some((entry) => !entry))
      throw new Error('SCROLL requires mandatory frame1000/1001/1002 metadata');
    const background = await this.frame(0);
    if (!background) throw new Error('SCROLL background frame0 is unavailable');
    const image = this.world.graphics.images.get(background).state;
    const axis = c.type ? 0 : 1,
      perpendicularX = c.type ? 0 : image.canvasWidth;
    const perpendicularY = c.type ? image.canvasHeight : 0;
    const [a, b, tail] = this.resource.metadata;
    if (b[axis + 2] <= 0) throw new Error('SCROLL metadata has no progressing track extent');
    this.resource.parts = [];
    for (let index = 0; index < 5; index++) {
      const bitmap = await this.frame(baseFrames[index]);
      this.resource.parts.push(bitmap);
      const factor = index < 3 ? 0 : index - 2;
      await this.bind(
        bitmap,
        (c.priority + index) | 0,
        f((c.vramX + perpendicularX * factor) >>> 0),
        f((c.vramY + perpendicularY * factor) >>> 0),
      );
    }
    // Allocate in the original order: all five areas, then all five planes.
    for (const part of partNames)
      this.resource.areas[part] = await this.world.objects.create({
        kind: 6,
        parent: this.record.id,
        creator: this.record.id,
        name: 'scrl btn',
      });
    const decrement = this.world.graphics.images.get(this.resource.parts[1]).state;
    const increment = this.world.graphics.images.get(this.resource.parts[2]).state;
    const rect = (im) => [
      (c.x + im.offsetX) | 0,
      (c.y + im.offsetY) | 0,
      (c.x + im.offsetX + im.width) | 0,
      (c.y + im.offsetY + im.height) | 0,
    ];
    await this.area('decrement', rect(decrement), (c.priority + 3) | 0);
    await this.area('increment', rect(increment), (c.priority + 2) | 0);
    // The horizontal original also starts this sum with metadata1000.height.
    const total = (a[3] + b[axis + 2] + tail[axis + 2]) | 0;
    const startX = (c.x + a[0]) | 0,
      startY = (c.y + a[1]) | 0;
    await this.area(
      'thumb',
      [startX, startY, (startX + increment.width) | 0, (startY + total) | 0],
      (c.priority + 4) | 0,
    );
    await this.area(
      'track',
      [
        startX,
        startY,
        (startX + (c.type ? total : increment.width)) | 0,
        (startY + (c.type ? increment.height : total)) | 0,
      ],
      (c.priority + 1) | 0,
    );
    const container = new Uint8Array(36);
    if (!nativeImageMetadata(this.resource.bytes, 0, true, container).success)
      throw new Error('SCROLL resource container metadata is unavailable');
    const containerView = new DataView(container.buffer);
    await this.area(
      'external',
      [
        c.x,
        c.y,
        (c.x + containerView.getInt32(8, true)) | 0,
        (c.y + containerView.getInt32(12, true)) | 0,
      ],
      c.priority,
    );
    const offset = this.draw.state.offset;
    if (!offset) throw new Error('SCROLL target Draw has no output offset');
    await this.plane(
      image.canvasWidth,
      image.canvasHeight,
      c.x,
      c.y,
      f((offset[0] + c.vramX) >>> 0),
      f((offset[1] + c.vramY) >>> 0),
      c.planePriority,
    );
    for (const header of this.resource.metadata)
      await this.plane(
        header[2],
        header[3],
        f((c.x + header[0]) | 0),
        f((c.y + header[1]) | 0),
        f((offset[0] + c.vramX + perpendicularX + header[0]) >>> 0),
        f((offset[1] + c.vramY + perpendicularY + header[1]) >>> 0),
        (c.planePriority + 100) | 0,
      );
    const decoration = metadata(this.resource.bytes, 200);
    this.resource.metadata.push(decoration);
    if (decoration)
      await this.plane(
        decoration[2],
        decoration[3],
        f((c.x + decoration[0]) | 0),
        f((c.y + decoration[1]) | 0),
        f((offset[0] + c.vramX + 2 * perpendicularX + decoration[0]) >>> 0),
        f((offset[1] + c.vramY + 2 * perpendicularY + decoration[1]) >>> 0),
        (c.planePriority + 110) | 0,
      );
    else {
      const id = await this.world.objects.create({
        kind: 2,
        parent: this.record.id,
        creator: this.record.id,
        name: 'scrl pl',
      });
      this.resource.planes.push(id); // Wrapper exists; absent decoration has no graph.
    }
    await this.model.loadGeometry({
      direction: c.type,
      x: c.x,
      y: c.y,
      trackStart: b[axis],
      trackLength: b[axis + 2],
    });
    // Alpha belongs to dedicated planes; raw VRAM source descriptors stay255.
    s.loaded = true;
  }
  async loadRectangle() {
    const c = this.config,
      s = this.model.state;
    if (!Array.isArray(c.rect) && !(c.rect instanceof Int32Array))
      throw new TypeError('Rectangle control load requires its complete authored rectangle');
    const header = metadata(this.resource.bytes, 0);
    if (!header) throw new Error('Rectangle control frame0 metadata is unavailable');
    this.resource.metadata = [header];
    const vertical = ((c.rect[2] - c.rect[0]) | 0) < ((c.rect[3] - c.rect[1]) | 0);
    let minimumThumb = 0;
    if (this.kind === 41) {
      for (let state = 0; state < 4; state++)
        for (let piece = 0; piece < 4; piece++) {
          const frame = await this.frame(state * 100 + piece);
          if (!frame) continue;
          const data = this.world.graphics.images.get(frame).state;
          if (piece < 3) data.offsetX = data.offsetY = 0;
          else data[vertical ? 'offsetY' : 'offsetX'] = 0;
          if (state === 0 && piece > 0 && piece < 3)
            minimumThumb += vertical ? data.height : data.width;
        }
    } else {
      this.resource.current = await this.frame(0);
      if (!this.resource.current) throw new Error('SLIDER frame0 bitmap is unavailable');
    }
    this.loading = true;
    try {
      await this.model.loadGeometry({
        rect: [...c.rect],
        planeX: c.planeX,
        planeY: c.planeY,
        minimumThumb,
        thumbLength: header[vertical ? 5 : 4],
      });
    } finally {
      this.loading = false;
    }
    if (this.kind === 41) await this.compose();
    const hadTrack = this.resource.areas.track !== undefined;
    await this.area('track', [...c.rect], c.priority);
    let initial;
    if (this.kind === 41) {
      const bitmap = this.world.graphics.images.get(this.resource.composites[0]).state;
      initial = [s.left, s.top, (s.left + bitmap.width) | 0, (s.top + bitmap.height) | 0];
    } else
      initial = [
        (s.left + header[0]) | 0,
        (s.top + header[1]) | 0,
        (s.left + header[0] + header[2]) | 0,
        (s.top + header[1] + header[3]) | 0,
      ];
    await this.area('thumb', initial, (c.priority + 1) | 0);
    if (this.kind === 41 && hadTrack) await this.bounds();
    await this.rectangleRender(true, false);
  }
  async compose() {
    const s = this.model.state,
      images = this.world.graphics.images;
    const previous = this.resource.composites;
    this.resource.composites = [];
    try {
      for (let state = 0; state < 4; state++) {
        const pieces = [];
        for (let piece = 0; piece < 4; piece++) pieces.push(await this.frame(state * 100 + piece));
        let cross = 0;
        for (const handle of pieces.slice(0, 3))
          if (handle) {
            const bitmap = images.get(handle);
            cross = Math.max(cross, s.direction ? bitmap.width : bitmap.height);
          }
        const bitmapHandle = images.create(
          s.direction ? cross : s.thumbLength,
          s.direction ? s.thumbLength : cross,
          this.record.id,
        );
        this.resource.composites.push(bitmapHandle);
        const destination = images.get(bitmapHandle);
        let at = 0;
        for (const index of [1, 0, 2]) {
          if (!pieces[index]) continue;
          const source = images.get(pieces[index]);
          const width = !s.direction && index === 0 ? s.thumbLength - s.minimumThumb : source.width;
          const height =
            s.direction && index === 0 ? s.thumbLength - s.minimumThumb : source.height;
          if (width > 0 && height > 0)
            await this.transferBitmap(
              destination,
              source,
              s.direction ? 0 : at,
              s.direction ? at : 0,
              width,
              height,
              true,
            );
          at = (at + (s.direction ? height : width)) | 0;
        }
        if (pieces[3]) {
          const source = images.get(pieces[3]);
          const x = s.direction ? 0 : (destination.width >>> 1) - (source.width >>> 1);
          const y = s.direction ? (destination.height >>> 1) - (source.height >>> 1) : 0;
          if (source.width > 0 && source.height > 0)
            await this.transferBitmap(
              destination,
              source,
              x,
              y,
              source.width,
              source.height,
              false,
            );
        }
      }
      this.resource.current = this.resource.composites[0];
    } finally {
      for (const handle of previous) if (handle) await images.release(handle);
    }
  }
  transferBitmap(destination, source, x, y, width, height, copy) {
    const args = this.transfer;
    args.fill(0);
    args[1] = x;
    args[2] = y;
    args[3] = width;
    args[4] = height;
    args[8] = source.width;
    args[9] = source.height;
    return bitmapTransfer(this.world, destination, source, args, copy, this.record);
  }
  async scrollRender(updateBounds) {
    if (!this.model.state.loaded || this.resource.planes.length < 4) return;
    const s = this.model.state,
      [a, b, tail, decoration] = this.resource.metadata;
    const ids = this.resource.planes,
      axis = s.direction ? 0 : 1;
    const middleX = f((s.left + b[0] + (axis === 0 ? s.pixel : 0)) | 0);
    const middleY = f((s.top + b[1] + (axis === 1 ? s.pixel : 0)) | 0);
    await this.vector(ids[2], 51, 0, middleX, middleY, 0);
    const integerMiddle = Math.trunc(axis === 0 ? middleX : middleY) | 0;
    const capOffset = (a[axis] - b[axis]) | 0;
    await this.vector(
      ids[1],
      51,
      0,
      axis === 0 ? f((integerMiddle + capOffset) | 0) : f((s.left + a[0]) | 0),
      axis === 1 ? f((integerMiddle + capOffset) | 0) : f((s.top + a[1]) | 0),
      0,
    );
    await this.vector(
      ids[3],
      51,
      0,
      axis === 0 ? f((integerMiddle + s.thumbLength) | 0) : f((s.left + tail[0]) | 0),
      axis === 1 ? f((integerMiddle + s.thumbLength) | 0) : f((s.top + tail[1]) | 0),
      0,
    );
    const scale = f(f(s.thumbLength) / f(s.trackLength));
    await this.vector(ids[2], 66, 0, axis === 0 ? scale : 1, axis === 1 ? scale : 1, 0);
    if (decoration) {
      const position = [(s.left + decoration[0]) | 0, (s.top + decoration[1]) | 0];
      position[axis] =
        (position[axis] +
          s.pixel +
          Math.trunc(s.thumbLength / 2) -
          Math.trunc(decoration[axis + 2] / 2)) |
        0;
      await this.vector(ids[4], 51, 0, position[0], position[1], 0);
    }
    if (updateBounds) await this.bounds();
  }
  async rectangleRender(originOnly, updateBounds) {
    if (!this.model.state.loaded || !this.config) return;
    const s = this.model.state,
      pixel = originOnly ? 0 : s.pixel;
    const x = (s.left + s.planeX + (s.direction ? 0 : pixel)) | 0;
    const y = (s.top + s.planeY + (s.direction ? pixel : 0)) | 0;
    this.resource.descriptorPosition[0] = x;
    this.resource.descriptorPosition[1] = y;
    await this.bind(this.resource.current, this.config.priority, f(x), f(y), s.alpha);
    if (updateBounds && !s.dragging) await this.bounds();
  }
  async skin(part, state) {
    if (!this.resource.bytes) return;
    if (this.kind === 40) {
      const index = partNames.indexOf(part);
      if (index < 1 || index > 3) return;
      if (state === -1) {
        await this.draw.remove(this.key((this.config.priority + index) | 0));
        if (index === 3) await this.draw.remove(this.key((this.config.priority + 4) | 0));
        return;
      }
      const c = this.config,
        background = this.world.graphics.images.get(this.resource.parts[0]).state;
      const perpendicularX = c.type ? 0 : background.canvasWidth;
      const perpendicularY = c.type ? background.canvasHeight : 0;
      const frame = await this.frame(baseFrames[index] + state);
      this.resource.parts[index] = frame;
      await this.bind(
        frame,
        (c.priority + index) | 0,
        f((c.vramX + (index === 3 ? perpendicularX : 0)) >>> 0),
        f((c.vramY + (index === 3 ? perpendicularY : 0)) >>> 0),
      );
      if (index === 3) {
        const decoration = await this.frame(200 + state);
        this.resource.parts[4] = decoration;
        await this.bind(
          decoration,
          (c.priority + 4) | 0,
          f((c.vramX + 2 * perpendicularX) >>> 0),
          f((c.vramY + 2 * perpendicularY) >>> 0),
        );
      }
      return;
    }
    if (state === -1) {
      await this.draw.remove(this.key(this.config.priority));
      return;
    }
    this.resource.current =
      this.kind === 41
        ? (this.resource.composites[state] ?? 0)
        : await this.frame(this.model.state.skinTable[state]);
    // Skin selection preserves the descriptor's last submitted position.
    const [x, y] = this.resource.descriptorPosition;
    await this.bind(
      this.resource.current,
      this.config.priority,
      f(x),
      f(y),
      this.model.state.alpha,
    );
  }
  async service(operation, p, s) {
    switch (operation) {
      case 'render':
        if (this.loading) return;
        return this.kind === 40
          ? this.scrollRender(p.updateBounds)
          : this.rectangleRender(p.originOnly, p.updateBounds);
      case 'bounds':
        return this.bounds(p.clear);
      case 'skin':
        return this.skin(p.part, p.state);
      case 'notify':
        return this.world.sendEngine(this.record.parent, this.record.id, 27, 0, p.value);
      case 'focus':
        return this.world.sendEngine(this.record.parent, this.record.id, 28, 0, Number(p.flag));
      case 'release':
        return this.input.message(145);
      case 'touch':
        if (this.kind === 40) this.world.host.nativeLog?.('scroll touch');
        return this.input.message(155);
      case 'unconsumed':
        if (this.eventSender !== undefined) return this.send(this.eventSender, 94, 0, 1, null, 1);
        throw new Error('Unconsumed control event has no actual sender World ID');
      case 'enabled':
        for (const id of Object.values(this.resource.areas))
          await this.send(id, 92, 0, Number(p.flag));
        return;
      case 'shown':
        if (this.kind === 40) {
          for (const id of this.resource.planes)
            await this.send(id, 47, 0, Number(p.flag), null, 1);
        } else if (s.loaded)
          await this.send(this.config.drawID, 287, this.config.priority, Number(p.flag));
        return;
      case 'alpha':
        if (this.kind === 40) {
          for (const id of this.resource.planes) await this.send(id, 63, 0, p.alpha, null, 1);
        } else await this.rectangleRender(false, false);
        return;
      case 'rebuild':
        if (this.resource.bytes) await this.compose();
        return;
      default:
        throw new Error(`Unimplemented control service ${operation}`);
    }
  }
  memory(sender, context) {
    return this.world.engineMessages.memory(sender, context);
  }
  loadPacket(sender, address, context) {
    const memory = this.memory(sender, context),
      kind = this.kind;
    const bytes =
      typeof memory.bytes === 'function' ? memory.bytes(address, 292) : memory.read(address, 292);
    if (bytes.length !== 292) throw new RangeError('Control load packet crosses sender memory');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const word = (offset) => view.getInt32(offset, true);
    const stringAt = kind === 40 ? 8 : 4;
    const end = bytes.indexOf(0, stringAt);
    if (end < 0 || end >= stringAt + 260)
      throw new RangeError('Control filename crosses its packet');
    const nativeID = word(kind === 40 ? 4 : 0) >>> 0;
    const drawID = this.world.resolveTaskID(nativeID, this.record.id);
    if (drawID === null) throw new Error('Control Draw native ID is outside its Top namespace');
    const config = {
      drawID,
      file: new TextDecoder('shift_jis').decode(bytes.subarray(stringAt, end)),
      priority: word(kind === 40 ? 284 : 264),
    };
    if (kind === 40)
      Object.assign(config, {
        type: word(0),
        vramX: word(268),
        vramY: word(272),
        x: word(276),
        y: word(280),
        planePriority: word(288),
      });
    else
      Object.assign(config, {
        rect: [word(268), word(272), word(276), word(280)],
        planeX: word(284),
        planeY: word(288),
      });
    return config;
  }
  part(nativeID) {
    for (const [part, id] of Object.entries(this.resource.areas))
      if (this.world.objects.objects.get(id)?.nativeID === nativeID >>> 0) return part;
    return null;
  }
  async message(words, context = {}) {
    const [sender, message, w, l] = words;
    context.nativeUnhandled = false;
    const state = this.model.state;
    const senderWorld =
      context.nativeSenderWorldID ?? this.world.resolveTaskID(sender, this.record.id);
    const model = this.model;
    const loadID = this.kind === 40 ? 353 : this.kind === 41 ? 368 : 359;
    if (message === loadID) {
      await this.load(this.loadPacket(senderWorld, l, context));
      return NATIVE_UNWRITTEN_WORD;
    }
    const offset = this.kind === 40 ? 353 : this.kind === 41 ? 368 : 359;
    switch (message - offset) {
      case 1:
        if (this.kind === 41) await model.setEnabled(l);
        else await model.setShown(l);
        return NATIVE_UNWRITTEN_WORD;
      case 2:
        if (this.kind === 40 || this.kind === 42) {
          await model.setEnabled(l);
          return NATIVE_UNWRITTEN_WORD;
        }
        await model.setRange(...signedWords(this.memory(senderWorld, context), l, 3));
        return NATIVE_UNWRITTEN_WORD;
      case 3:
        if (this.kind === 40)
          await model.setRange(...signedWords(this.memory(senderWorld, context), l, 3));
        else if (this.kind === 41) await model.setValue(l, w !== 0);
        else await model.setRange(...signedWords(this.memory(senderWorld, context), l, 2));
        return NATIVE_UNWRITTEN_WORD;
      case 4:
        if (this.kind === 40) await model.setValue(l, w !== 0);
        else if (this.kind === 41) return state.direction;
        else await model.setValue(l, w !== 0);
        return NATIVE_UNWRITTEN_WORD;
      case 5:
        if (this.kind === 40) await model.setAlpha(l);
        else if (this.kind === 41) await model.setShown(l);
        else return state.direction;
        return NATIVE_UNWRITTEN_WORD;
      case 6:
        if (this.kind === 41 || this.kind === 42) {
          await model.setAlpha(l);
          return NATIVE_UNWRITTEN_WORD;
        }
        break;
      case 7:
        if (this.kind !== 40) {
          model.setTable(w, l);
          return NATIVE_UNWRITTEN_WORD;
        }
        break;
      case 8:
        if (this.kind !== 40) {
          await model.reselectSkin();
          return NATIVE_UNWRITTEN_WORD;
        }
        break;
    }
    if (message === 6) {
      if (state.dragging) await model.move(signedWords(this.memory(senderWorld, context), l, 2));
      return NATIVE_UNWRITTEN_WORD;
    }
    if (message === 9 || message === 10 || message === 64 || message === 65) {
      const previous = this.eventSender;
      this.eventSender = senderWorld;
      try {
        if (message === 65) await model.touch(this.part(w));
        else {
          const part = this.part(w);
          if (!part) await model.unconsumed(null);
          else if (message === 64) await model.focus(part, l, await this.pointer());
          else {
            const source = nativeEngineWord(await this.send(this.resource.areas[part], 95));
            if (message === 9)
              await model.press(
                part,
                await this.pointer(),
                ((this.record.effectiveFrame ?? 0) - (this.record.pausedFrames ?? 0)) >>> 0,
                source,
                l,
              );
            else await model.release(part, source, l);
          }
        }
      } finally {
        this.eventSender = previous;
      }
      return NATIVE_UNWRITTEN_WORD;
    }
    return this.base.message(words, context);
  }
  async tick(frame) {
    // Base has already visited children; its original derived argument is the
    // incoming parent clock (lastFrame), not the paused local getter used by press.
    await this.model.tick(this.record.lastFrame ?? frame, !this.record.destroyRequested);
  }
  snapshot() {
    return structuredClone({
      config: this.config,
      resource: this.resource,
      model: this.model.snapshot(),
    });
  }
  restore(state) {
    const saved = structuredClone(state);
    this.config = saved.config;
    this.resource = saved.resource;
    this.image = null;
    this.model = new ControlTaskModel(this.kind, (...args) => this.service(...args), saved.model);
  }
  async unload(destroyChildren) {
    if (this.config) {
      const draw = this.world.graphics.drawTasks.get(this.config.drawID);
      if (draw?.state.renderer) for (const key of this.resource.drawIDs) await draw.remove(key);
    }
    for (const handle of this.resource.composites)
      if (handle) await this.world.graphics.images.release(handle);
    for (const [, handle] of this.resource.frames)
      if (handle) await this.world.graphics.images.release(handle);
    const areas = this.resource.areas;
    if (destroyChildren)
      for (const id of [...Object.values(areas), ...this.resource.planes])
        await this.world.objects.destroy(id, this.record.id);
    this.resource = resourceState();
    if (!destroyChildren) this.resource.areas = areas;
    this.image = null;
  }
  async close() {
    if (this.closed) return;
    await this.unload(this.kind === 40);
    this.closed = true;
  }
}

export function installJSControlTasks(
  world,
  { behavior = controlTaskBehavior(world.profile) } = {},
) {
  if (behavior?.scroll2Skin !== 'state-direct')
    throw new Error('A verified SCROLL2 skin selector policy is required');
  if ([...world.objects.objects.values()].some((record) => [40, 41, 42].includes(record.kind)))
    throw new Error('Install JS control factories before creating or restoring control tasks');
  for (const kind of [40, 41, 42])
    world.objects.factories.set(kind, (record) => new JSControlTask(world, record, behavior));
}
