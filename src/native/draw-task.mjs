// SPDX-License-Identifier: MPL-2.0
// Drawing task constructor/message entry: game 5F3C00/5F3F50.
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { mapABIMessage } from './abi/messages.mjs';
import { bitsFloat, floatBits, nativeReply } from '../kcs.mjs';
import { affineBitmap, prepareBitmapAffine } from './image-affine.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeEngineWord } from './engine-message.mjs';
export class NativeDrawTask {
  constructor(graphics, record) {
    this.graphics = graphics;
    this.world = graphics.world;
    this.record = record;
    this.base = this.world.base(record);
    this.state = {
      renderer: null,
      offset: null,
      enabled: true,
      pending: false,
      baseImage: null,
      baseVisible: false,
      basePlane: 0,
      dirty: true,
      registrations: [],
    };
  }
  retained() {
    return this.world.retainedDraw ?? this.world.nativeEngine?.features.get('retained-draw');
  }
  async message(words, context = {}) {
    const { payload } = context;
    const [sender, message, w, l] = words;
    const store = (address, value) =>
      payload
        ? payload.store(address, value)
        : this.world.objects.machine(context.nativeSenderWorldID ?? sender).store(address, value);
    const load = (address) =>
      payload
        ? payload.load(address)
        : this.world.objects.machine(context.nativeSenderWorldID ?? sender).load(address);
    const key = (sender | (w << 16)) >>> 0;
    switch (message) {
      case 3:
        await this.close();
        return this.base.message(words, context);
      case 19:
        return 0; // Explicit original message handler branch.
      case 279: {
        if (this.state.renderer) await this.releaseRenderer();
        const bitmap = this.graphics.images.create(w, l, this.record.id);
        this.state.renderer = {
          bitmap,
          width: w,
          height: l,
          items: [],
          clearColor: 0,
          dirty: true,
          dirtyRects: [],
        };
        if (!this.state.basePlane) {
          const id = await this.world.objects.create({
            kind: 2,
            parent: this.record.id,
            creator: this.record.id,
            name: 'base plane',
          });
          this.state.basePlane = id;
          const [width, height] = this.graphics.virtualSize(),
            shape = new NativeGraphicsPacket([
              0,
              0,
              0,
              floatBits(width),
              floatBits(height),
              32,
              1,
              -1,
            ]);
          await this.graphics.send(id, this.record.id, 41, 0, 0, shape);
          await this.graphics.send(id, this.record.id, 47, 0, 0, null, 1);
          await this.setBasePriority(1000);
        }
        return 0;
      }
      case 280:
      case 282: {
        if (!this.state.renderer) return 0;
        const fields = Array.from({ length: 15 }, (_, i) => load(l + i * 4));
        if (context.imageOwnerHandle !== undefined) {
          fields[3] = context.imageOwnerHandle;
          const retained = this.retained() ?? (await this.world.getNativeFeature('retained-draw'));
          await retained.bind(this, key, fields, context);
          return 0;
        }
        if (context.nativePointer || fields.slice(1, 4).some(Boolean)) {
          const retained = this.retained() ?? (await this.world.getNativeFeature('retained-draw'));
          await retained.bind(this, key, fields, context);
          return 0;
        }
        if (!fields[0]) {
          if (fields.slice(1, 4).some(Boolean))
            throw new Error(
              `Drawing task ${this.record.id} source class ${fields.slice(0, 4)} requires its native resource adapter`,
            );
          return 0;
        }
        if (context.nativePointer)
          fields[0] = (await this.world.getNativeFeature('graphics-platform')).imageHandle(
            fields[0],
            context.nativeSenderWorldID ?? sender,
          );
        await this.upsert(key, {
          image: fields[0],
          position: fields.slice(4, 6).map(bitsFloat),
          base: fields.slice(6, 8).map(bitsFloat),
          rotation: bitsFloat(fields[8]),
          scale: fields.slice(9, 11).map(bitsFloat),
          alpha: fields[11],
          visible: Boolean(fields[12]),
          mode: fields[13],
          aux: fields[14],
        });
        return 0;
      }
      case 281:
        await this.remove(key);
        return 0;
      case 283:
        this.state.offset = [w | 0, l | 0];
        return 0;
      case 284:
        if (!this.state.offset)
          throw new Error(`Drawing task ${this.record.id} output offset has not been initialized`);
        store(w, this.state.offset[0]);
        store(l, this.state.offset[1]);
        return 0;
      case 285: {
        const handle = this.state.renderer?.bitmap || 0;
        store(
          l,
          handle && context.nativePointer
            ? await (await this.world.getNativeFeature('bitmap-memory')).wrapper(handle)
            : handle,
        );
        return 0;
      }
      case 286:
        this.state.pending = Boolean(l);
        this.state.enabled = Boolean(l);
        if (l) this.state.dirty = true;
        return 0;
      case 288:
        return this.state.renderer?.items.length || 0;
      case 287: {
        const item = this.entry(key);
        this.retained()?.visible(this, key, l);
        if (item && item.visible !== Boolean(l)) {
          this.mark(item);
          item.visible = Boolean(l);
          this.mark(item);
        }
        return 0;
      }
      case 289: {
        const item = this.entry(key);
        if (item) {
          this.mark(item);
          item.clip =
            l || payload
              ? Array.from({ length: 4 }, (_, i) => load(l + i * 4) | 0)
              : [0, 0, this.state.renderer.width, this.state.renderer.height];
          await this.retained()?.clip(this, key, item.clip);
          this.mark(item);
        }
        return 0;
      }
      case 290:
      case 310:
        this.state.dirty = true;
        await this.render(
          message === 310 ? Array.from({ length: 4 }, (_, i) => load(l + i * 4) | 0) : null,
        );
        return 0;
      case 291: {
        const renderer = this.state.renderer;
        if (renderer) {
          for (const item of [...renderer.items]) await this.remove(item.key);
          await this.graphics.images
            .get(renderer.bitmap)
            .fill(0, 0, renderer.width, renderer.height, renderer.clearColor);
          renderer.dirtyRects = [[0, 0, renderer.width, renderer.height]];
          if (this.state.baseVisible) await this.insertBaseImage();
        }
        return 0;
      }
      case 292:
        this.state.dirty = true;
        if (this.state.renderer)
          await this.render([0, 0, this.state.renderer.width, this.state.renderer.height], true);
        return 0;
      case 293: {
        if (!this.state.renderer) return 0;
        const name = payload
          ? payload.string(l)
          : this.world.objects.machine(context.nativeSenderWorldID ?? sender).string(l);
        await (this.retained() ?? (await this.world.getNativeFeature('retained-draw'))).load(
          this,
          key,
          name,
        );
        return 0;
      }
      case 295:
        if (this.state.renderer)
          await (this.retained() ?? (await this.world.getNativeFeature('retained-draw'))).enable(
            this,
            key,
            l,
          );
        return 0;
      case 296: {
        const image =
          context.nativePointer && l
            ? (await this.world.getNativeFeature('graphics-platform')).imageHandle(
                load(l),
                this.record.id,
              )
            : l;
        await this.setBaseImage(
          image,
          w ? Array.from({ length: 4 }, (_, i) => load(w + i * 4) | 0) : null,
        );
        return 0;
      }
      case 297: {
        await this.setBasePriority(l | 0);
        return 0;
      }
      case 298: {
        const item = this.entry(key);
        if (!item) return 0;
        store(l, item.layer);
        return 1;
      }
      case 299: {
        const item = this.entry(key);
        if (item) {
          this.mark(item);
          item.layer = l | 0;
          this.mark(item);
          return 1;
        }
        return 0;
      }
      case 300: {
        const item = this.entry(key);
        if (item) {
          this.mark(item);
          if (this.retained())
            await (this.retained() ?? (await this.world.getNativeFeature('retained-draw'))).refresh(
              this,
              key,
            );
          this.mark(this.entry(key));
        }
        return 0;
      }
      case 311: {
        const sound = await this.soundTarget(),
          links = this.state.registrations,
          link = links.find((entry) => entry.key === key);
        if (l === 0xffffffff) {
          if (link) {
            await this.soundMessage(sound, 211, link.bank, 0);
            await this.setAnimationVariable(key, 0, 0);
            links.splice(links.indexOf(link), 1);
          }
        } else {
          // Reassigning a key preserves its threshold. The original enables
          // the new bank without sending a disable to the old bank.
          if (link) link.bank = l;
          else links.push({ key, bank: l, threshold: 1000 });
          await this.soundMessage(sound, 211, l, 1);
        }
        return 0;
      }
      case 312:
        if (this.state.renderer) await this.setAnimationVariable(key, load(l), load(l + 4));
        return 0;
      case 313: {
        const link = this.state.registrations.find((entry) => entry.key === key);
        if (link) link.threshold = l >>> 0;
        return 0;
      }
      case 307:
        store(l, this.entry(key)?.image || 0);
        return 0;
      case 294:
      case 305:
      case 306:
        return 0; // Explicit original drawing-task empty branches.
      case 304:
        this.state.dirty = Boolean(l);
        return 0;
      default:
        if (message >= 279 && message <= 313 && message !== 303)
          throw new Error(
            `Native drawing message ${message} requires its complete retained renderer`,
          );
        return this.base.message(words, context);
    }
  }
  async setAnimationVariable(key, index, value) {
    return (
      this.retained() ?? (await this.world.getNativeFeature('retained-draw'))
    ).setAnimationVariable(this, key, index, value);
  }
  async soundTarget() {
    return nativeEngineWord(
      await this.world.sendNativeEngine(
        0,
        this.record.id,
        this.world.engineMessages.layout.rootStart + 3,
      ),
      'Draw sound task lookup',
    );
  }
  soundMessage(target, message, bank, value = 0) {
    const raw = mapABIMessage(this.world.profile, 'draw', 'raw', message);
    return this.world.sendNativeEngine(target, this.record.id, raw, bank, value);
  }
  async tick() {
    const links = this.state.registrations;
    if (!links.length) return;
    const sound = await this.soundTarget();
    for (const link of links.toSorted((a, b) => a.key - b.key)) {
      const level = nativeEngineWord(
        await this.soundMessage(sound, 212, link.bank),
        'Draw sound level query',
      );
      await this.setAnimationVariable(link.key, 0, Number(level >= link.threshold));
    }
  }
  snapshot() {
    return structuredClone(this.state);
  }
  async insertBaseImage() {
    if (!this.state.renderer || !this.state.baseImage) return;
    (
      await this.upsert(0, {
        image: this.state.baseImage,
        position: [0, 0],
        base: [0, 0],
        rotation: 0,
        scale: [1, 1],
        alpha: 255,
        visible: true,
        mode: 0,
        aux: 0,
      })
    ).layer = 0;
  }
  async setBaseImage(handle, rect = null) {
    await this.remove(0);
    if (handle) {
      const source = this.graphics.images.get(handle),
        copy = rect
          ? await source.crop(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])
          : source.clone();
      if (copy) {
        if (this.state.baseImage) await this.graphics.images.release(this.state.baseImage);
        copy.owner = this.record.id;
        this.state.baseImage = this.graphics.images.add(copy);
      }
      await this.insertBaseImage();
    }
    this.state.baseVisible = Boolean(handle);
    if (this.state.basePlane)
      await this.graphics.send(
        this.state.basePlane,
        this.record.id,
        47,
        0,
        Number(this.state.baseVisible),
        null,
        1,
      );
  }
  async setBasePriority(priority) {
    if (this.state.basePlane)
      await this.graphics.send(
        this.state.basePlane,
        this.record.id,
        49,
        0,
        0,
        new NativeGraphicsPacket([0, 0, floatBits(priority)]),
        1,
      );
  }
  entry(key) {
    return this.state.renderer?.items.find((item) => item.key === key >>> 0);
  }
  bounds(item) {
    if (item.mode) {
      const renderer = this.state.renderer,
        image = this.graphics.images.get(item.image);
      return prepareBitmapAffine({
        width: renderer.width,
        height: renderer.height,
        sourceWidth: image.width,
        sourceHeight: image.height,
        position: item.position,
        base: [
          Math.fround(item.base[0] - image.state.offsetX),
          Math.fround(item.base[1] - image.state.offsetY),
        ],
        rotation: item.rotation,
        scale: item.scale,
      }).area;
    }
    const image = this.graphics.images.get(item.image),
      x =
        ((image.state.offsetX | 0) +
          truncateFloat32(item.position[0]) -
          truncateFloat32(item.base[0])) |
        0,
      y =
        ((image.state.offsetY | 0) +
          truncateFloat32(item.position[1]) -
          truncateFloat32(item.base[1])) |
        0;
    return [x, y, x + image.width, y + image.height];
  }
  mark(item, previous = false) {
    const bounds = previous ? item.dirtyBounds : this.bounds(item);
    if (!bounds) throw new Error('Drawing entry has no previous dirty bounds');
    item.dirtyBounds = bounds;
    if (!item.visible) return;
    this.state.renderer.dirtyRects.push([...bounds]);
    this.state.renderer.dirty = true;
  }
  async upsert(key, values) {
    const renderer = this.state.renderer,
      old = this.entry(key);
    // Original resource setters may already have destroyed the previous bitmap.
    // Its last valid geometry still invalidates the pixels it occupied.
    if (old) this.mark(old, true);
    const source = this.graphics.images.get(values.image),
      alias =
        old && this.graphics.images.get(old.image).dataHandle === source.dataHandle
          ? old.image
          : this.graphics.images.alias(values.image, this.record.id);
    const item = {
      ...values,
      key: key >>> 0,
      layer: old?.layer ?? key >>> 16,
      image: alias,
      clip: old?.clip || [0, 0, renderer.width, renderer.height],
    };
    if (old) {
      renderer.items.splice(renderer.items.indexOf(old), 1, item);
      if (old.image !== alias) await this.graphics.images.release(old.image);
    } else renderer.items.push(item);
    this.mark(item);
    return item;
  }
  async remove(key) {
    const removed = await this.removeEntry(key);
    await this.retained()?.remove(this, key);
    return removed;
  }
  async removeEntry(key) {
    const renderer = this.state.renderer,
      item = this.entry(key);
    if (item) {
      this.mark(item, true);
      renderer.items.splice(renderer.items.indexOf(item), 1);
      await this.graphics.images.release(item.image);
    }
    return Boolean(item);
  }
  async rasterize(item, region) {
    if (!item.visible || !item.alpha) return;
    if (item.mode) {
      const input = this.graphics.images.get(item.image),
        output = this.graphics.images.get(this.state.renderer.bitmap);
      if (input.state.bpp !== 4 || output.state.bpp !== 4)
        throw new Error(
          `Drawing task ${this.record.id} affine bitmap formats ${input.state.bpp}→${output.state.bpp} require their native format conversion`,
        );
      affineBitmap(
        await output.pixels(),
        output.width,
        output.height,
        await input.pixels(),
        input.width,
        input.height,
        {
          position: item.position,
          base: [
            Math.fround(item.base[0] - input.state.offsetX),
            Math.fround(item.base[1] - input.state.offsetY),
          ],
          rotation: item.rotation,
          scale: item.scale,
          alpha: item.alpha,
          clip: [
            Math.max(item.clip[0], region[0]),
            Math.max(item.clip[1], region[1]),
            Math.min(item.clip[2], region[2]),
            Math.min(item.clip[3], region[3]),
          ],
        },
      );
      output.state.source = null;
      output.changed();
      return;
    }
    const image = this.graphics.images.get(item.image),
      bounds = this.bounds(item),
      source = image.state.clip;
    const area = [
      Math.max(bounds[0] + source[0], item.clip[0], region[0], 0),
      Math.max(bounds[1] + source[1], item.clip[1], region[1], 0),
      Math.min(bounds[0] + source[2], item.clip[2], region[2], this.state.renderer.width),
      Math.min(bounds[1] + source[3], item.clip[3], region[3], this.state.renderer.height),
    ];
    if (area[0] >= area[2] || area[1] >= area[3]) return;
    const pixels = await image.pixels(),
      opaque =
        item.alpha === 255 && pixels.every((value, index) => index % 4 !== 3 || value === 255);
    await this.graphics.images.get(this.state.renderer.bitmap).blit(image, {
      dx: area[0],
      dy: area[1],
      sx: area[0] - bounds[0],
      sy: area[1] - bounds[1],
      width: area[2] - area[0],
      height: area[3] - area[1],
      copy: opaque,
      alpha: item.alpha,
    });
  }
  async render(region = null, forceOutput = false) {
    const { renderer, dirty, enabled, offset } = this.state;
    if (!renderer || !dirty) return;
    if (!offset)
      throw new Error(`Drawing task ${this.record.id} output offset has not been initialized`);
    const bitmap = this.graphics.images.get(renderer.bitmap),
      areas = region ? [region] : renderer.dirtyRects;
    if (renderer.externalPaint) areas.push([0, 0, renderer.width, renderer.height]);
    const nativeRenderer = this.retained();
    if (nativeRenderer) await nativeRenderer.rasterize(this, areas, forceOutput);
    else
      for (const area of areas) {
        if (!renderer.externalPaint)
          await bitmap.fill(
            area[0],
            area[1],
            area[2] - area[0],
            area[3] - area[1],
            renderer.clearColor,
          );
        for (const item of renderer.items.toSorted((a, b) => a.layer - b.layer || a.key - b.key))
          await this.rasterize(item, area);
        if (enabled || forceOutput) await this.graphics.output(bitmap, offset, area);
      }
    if (!nativeRenderer && enabled && this.state.pending && !areas.length)
      await this.graphics.output(bitmap, offset);
    this.state.pending = false;
    renderer.dirty = false;
    renderer.externalPaint = false;
    if (!region) renderer.dirtyRects = [];
  }
  restore(state) {
    this.state = structuredClone(state);
  }
  async drawTick(frame) {
    if (!this.state.renderer || !this.state.enabled) return;
    await this.retained()?.update(this, frame);
    await this.render();
  }
  async close() {
    if (this.state.renderer) await this.releaseRenderer();
    if (this.state.baseImage) await this.graphics.images.release(this.state.baseImage);
    this.state.baseImage = null;
    this.graphics.drawTasks.delete(this.record.id);
    this.graphics.fesSurfaces.delete(this.record.id);
  }
  async releaseRenderer() {
    for (const item of [...this.state.renderer.items]) await this.removeEntry(item.key);
    await this.retained()?.removeSurface(this);
    await this.world.nativeEngine?.features
      .get('graphics-platform')
      ?.releaseOwnerImages(this.record.id);
    await this.graphics.images.release(this.state.renderer.bitmap);
    this.state.renderer = null;
  }
}

export const NATIVE_DRAW_IDS = Object.freeze([
  0x100, 0x101, 0x102, 0x103, 0x104, 0x105, 0x106, 0x107, 0x108, 0x153, 0x154, 0x155, 0x156, 0x1c7,
  0x1ce, 0x1cf, 0x1d0, 0x216, 0x291, 0x35e,
]);
export async function nativeDraw(id, args, _machine, task, world) {
  if (!NATIVE_DRAW_IDS.includes(id)) return undefined;
  const graphics = {
      send: (target, sender, message, w = 0, l = 0, payload) =>
        world.sendNativeEngine(target, sender, message, w, l, payload ? { payload } : {}),
    },
    done = () => nativeReply(2);
  const packet = (words = []) => {
    const data = new Uint32Array(Math.max(16, words.length));
    data.set(words);
    return {
      load: (at) => data[at / 4],
      store: (at, value) => {
        data[at / 4] = value;
      },
    };
  };
  switch (id) {
    case 0x100:
      await graphics.send(args[0], task.id, 279, args[1], args[2]);
      return done();
    case 0x101:
    case 0x103: {
      const fields = new Array(15).fill(0);
      fields[0] = args[2];
      fields.splice(4, 10, ...args.slice(3, 10), Math.min(255, args[10] >>> 0), args[11], args[12]);
      await graphics.send(args[0], task.id, id === 0x101 ? 280 : 282, args[1], 0, packet(fields));
      return done();
    }
    case 0x102:
      await graphics.send(args[0], task.id, 281, args[1]);
      return done();
    case 0x104:
      await graphics.send(args[0], task.id, 283, args[1], args[2]);
      return done();
    case 0x105: {
      const output = {
        value: 0,
        store(_address, value) {
          this.value = value;
        },
      };
      await graphics.send(args[0], task.id, 285, 0, 0, output);
      return nativeReply(1, output.value);
    }
    case 0x106:
      await graphics.send(args[0], task.id, 286, 0, args[1]);
      return done();
    case 0x108:
      await graphics.send(args[0], task.id, 288);
      return done();
    case 0x107:
      await graphics.send(args[0], task.id, 287, args[1], args[2]);
      return done();
    case 0x153:
      await graphics.send(
        args[0],
        task.id,
        289,
        args[1],
        0,
        packet([args[2], args[3], args[2] + args[4], args[3] + args[5]]),
      );
      return done();
    case 0x154:
    case 0x155:
    case 0x156:
      await graphics.send(args[0], task.id, id === 0x154 ? 290 : id === 0x155 ? 291 : 292);
      return done();
    case 0x1c7:
      await graphics.send(args[0], task.id, 296, 0, args[1]);
      return done();
    case 0x216:
      await graphics.send(args[0], task.id, 304, 0, args[1]);
      return done();
    case 0x35e:
      await graphics.send(args[0], task.id, 310, 0, 0, packet(args.slice(1, 5)));
      return done();
    case 0x291:
    case 0x1ce: {
      const output = packet([id === 0x1ce ? 0xffffffff : 0]);
      await graphics.send(args[0], task.id, id === 0x291 ? 307 : 298, args[1], 0, output);
      return nativeReply(1, output.load(0));
    }
    case 0x1cf:
      await graphics.send(args[0], task.id, 299, args[1], args[2]);
      return done();
    case 0x1d0:
      if (args.length !== 2) throw new Error('Native retained refresh expects two arguments');
      await graphics.send(args[0], task.id, 300, args[1], 0);
      return done();
  }
}
