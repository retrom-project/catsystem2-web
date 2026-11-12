// SPDX-License-Identifier: MPL-2.0
import { FESDifImages } from './fes-dif-image.mjs';
import { fesImageFrameID, fesImagePosition } from './fes-image-model.mjs';
import { fesPanelPart } from './fes-panel-model.mjs';
import { NativeGlobalFile, nativeSavePath } from './persistence.mjs';
import { nativeFileTime, nativeSystemTime } from './file-time.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { bitmapBlur, bitmapTransfer } from './bitmap-pixels.mjs';
import { copyFESBitmapRectangle } from './fes-bitmap.mjs';
import { rasterTextGlyph } from './text-raster.mjs';
import { nativeTextUnits } from './text-scanner.mjs';
import { floatBits } from '../kcs.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

const f = Math.fround,
  isPanel = (object) => object.nativeType === 11 || object.nativeType === 12,
  colorRef = (word) => ((word & 255) << 16) | (word & 0xff00) | ((word >>> 16) & 255);
function state(object) {
  if (!isPanel(object) || !object.panel) throw new TypeError('PANEL typed state is absent');
  return object.panel;
}
function slotName(slot) {
  const value = slot | 0;
  return `save${value < 0 ? '-' + String(-value).padStart(3, '0') : String(value).padStart(4, '0')}.dat`;
}
function decimalDigit(value, divisor) {
  if (!divisor) return value | 0;
  const ten = Math.imul(10, divisor);
  if (!ten) throw new RangeError('PANEL decimal selector has an undefined zero denominator');
  return Math.trunc(((value | 0) % ten) / divisor) | 0;
}

export class FESPanelImages extends FESDifImages {
  constructor(world, services) {
    super(world, services);
    this.saveFiles = new WeakMap();
  }
  supports(object) {
    return isPanel(object) || super.supports(object);
  }
  async initialize(instance, object) {
    const resource = await super.initialize(instance, object);
    if (object.nativeType === 12) {
      const save = state(object).save;
      if (save.directory === null) {
        const name = this.world.objects.objects.get(instance.runtimeID)?.context?.contextName;
        if (typeof name !== 'string')
          throw new Error('SAVEPANEL requires its actual FES context directory');
        save.directory = name;
      }
    }
    return resource;
  }
  saveFile(object) {
    const saved = state(object).save?.file;
    if (!saved) return null;
    let cached = this.saveFiles.get(object);
    if (cached?.state !== saved) {
      const file = new NativeGlobalFile();
      file.restore(saved);
      cached = { state: saved, file };
      this.saveFiles.set(object, cached);
    }
    return cached.file;
  }
  async setSave(instance, object, slot, entry, start) {
    if (object.nativeType !== 12) throw new TypeError('setsave requires a SAVEPANEL');
    await this.initialize(instance, object);
    const save = state(object).save;
    save.filename = slotName(slot);
    save.entry = entry >>> 0;
    const path = nativeSavePath(save.directory, save.filename),
      file = await this.world.saveSlots.load(path);
    if (file) {
      save.file = file.snapshot();
      this.saveFiles.set(object, { state: save.file, file });
      const information = await this.world.storage.stat?.(path),
        time = information && nativeFileTime(information.modifiedMs),
        offset =
          this.world.runtime.services?.localOffsetMinutes?.() ?? -new Date().getTimezoneOffset(),
        date =
          time === null || time === undefined
            ? null
            : nativeSystemTime(time + BigInt(offset) * 600000000n);
      if (!date) throw new Error(`SAVEPANEL CSS file-time metadata is unavailable: ${path}`);
      save.date = [date[0], date[1], date[3], date[4], date[5], date[6]];
      const bytes = file.read(entry),
        first = start >>> 0;
      if (bytes && first < save.flags.length) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          count = Math.min(bytes.length >>> 2, save.flags.length - first);
        for (let index = 0; index < count; index++)
          save.flags[first + index] = view.getUint32(index * 4, true);
      }
    } else save.date.fill(0);
    // A failed CSS load preserves the previous container and private flags.
    object.imageChanged = true;
    await this.rebuildSavedParts(instance, object);
    return Boolean(file);
  }
  async decodeEntry(instance, bytes, selector = 0) {
    if (!bytes) return 0;
    const buffers = this.world.runtime.imageDataBuffers,
      pointer = buffers.createPointer(bytes);
    try {
      const decoded = await buffers.decodeImage(pointer, selector);
      if (!decoded) return 0;
      const handle = this.world.graphics.images.addDecoded(decoded.image, decoded.frame);
      this.world.graphics.images.get(handle).owner = instance.runtimeID;
      return handle;
    } catch (error) {
      this.world.host?.nativeDiagnostic?.({ type: 'panel-image-invalid', error: error.message });
      return 0;
    } finally {
      buffers.releasePointer(pointer);
    }
  }
  async replacePartBitmap(object, id, bitmap, kind, owned = true) {
    const part = fesPanelPart(object, id, true);
    if (part.ownBitmap && part.bitmap) {
      await this.world.graphics.images.release(part.bitmap);
      state(object).ownedBitmaps.delete(part.bitmap);
    }
    part.bitmap = bitmap;
    part.ownBitmap = Boolean(bitmap && owned);
    if (part.ownBitmap) state(object).ownedBitmaps.add(bitmap);
    part.kind = kind;
    return part;
  }
  async rebuildSavedParts(instance, object) {
    const save = state(object).save;
    if (!save) throw new TypeError('Saved part rebuilding requires SAVEPANEL state');
    const file = this.saveFile(object);
    for (const [id, definition] of [...save.definitions].sort(([a], [b]) => a - b)) {
      if (definition.kind === 0) {
        fesPanelPart(object, id, true).kind = 0;
        continue;
      }
      if (definition.kind === 1 || definition.kind === 7) {
        if (definition.selector === 'image-entry' || definition.selector === 'scaled-image-entry') {
          const bitmap = await this.decodeEntry(instance, file?.read(definition.entry));
          if (bitmap) {
            const part = await this.replacePartBitmap(object, id, bitmap, definition.kind);
            if (definition.kind === 7) {
              part.scaledWidth = definition.scaledWidth;
              part.scaledHeight = definition.scaledHeight;
              part.crop = definition.crop.slice();
            }
          }
        } else await this.replacePartBitmap(object, id, definition.bitmap, 1, false);
        continue;
      }
      if (definition.kind === 2) {
        const part = fesPanelPart(object, id, true);
        part.kind = 2;
        part.reference = structuredClone(definition.reference);
        continue;
      }
      let number = 0,
        text = null;
      if (definition.selector === 'string-entry') {
        const bytes = file?.read(definition.entry);
        if (!bytes || bytes.length >= 256) continue;
        const nul = bytes.indexOf(0);
        if (nul < 0) throw new Error('SAVEPANEL CSS string entry has no defined NUL terminator');
        text = bytes.slice(0, nul);
      } else {
        if (definition.selector === 'flag') number = save.flags[definition.flag >>> 0] | 0;
        else if (typeof definition.selector === 'number')
          number = save.date[definition.selector] | 0;
        else if (definition.selector === 'constant') number = definition.constant | 0;
        else throw new TypeError('Unsupported typed SAVEPANEL source selector');
        text = encodeCP932(String(number));
      }
      const part = fesPanelPart(object, id, true);
      if (definition.kind === 3 || definition.kind === 4) {
        Object.assign(part, {
          kind: 3,
          text,
          fontSize: definition.fontSize,
          color: definition.color,
          columns: definition.columns,
          styles: definition.styles.slice(),
          outlineColor: definition.outlineColor,
          maxLines: definition.maxLines,
          lineSpacing: definition.lineSpacing,
          font: definition.font,
        });
      } else if (definition.kind === 5 || definition.kind === 6) {
        Object.assign(part, {
          kind: definition.kind,
          number,
          divisor: definition.digits,
          directSelector: definition.directSelector,
          maxLines: 1,
          lineSpacing: 0,
        });
        if (definition.kind === 5) part.reference = structuredClone(definition.reference);
        else part.bitmap = definition.bitmap;
      } else throw new TypeError(`Unsupported typed SAVEPANEL part ${definition.kind}`);
    }
    object.imageChanged = true;
  }
  async panelMetadata(instance, object, selector, container = false) {
    const s = this.workspace(object),
      pointer = await this.cache(instance).data(this.filename(instance, object));
    if (!pointer) return null;
    s.metadata.fill(0);
    const result = nativeImageMetadata(
      this.world.runtime.imageDataBuffers.data(pointer),
      selector,
      container,
      s.metadata,
    );
    return result.success ? s.view : null;
  }
  async partPosition(instance, object, id) {
    const geometry = await this.panelMetadata(instance, object, id);
    if (!geometry)
      throw new Error(`PANEL part position metadata is unavailable: ${object.file}:${id}`);
    return [geometry.getInt32(0, true), geometry.getInt32(4, true)];
  }
  async compositePart(destination, source, position) {
    const s = source.state,
      args = this.workspace(destination).transfer;
    args.fill(0);
    args[1] = position[0] | 0;
    args[2] = position[1] | 0;
    args[3] = (destination.width - args[1]) | 0;
    args[4] = (destination.height - args[2]) | 0;
    args[6] = s.offsetX | 0;
    args[7] = s.offsetY | 0;
    args[8] = source.width;
    args[9] = source.height;
    args.operation = 'clipped-blend';
    await bitmapTransfer(this.world, destination, source, args, false);
  }
  async partImage(instance, object, id, part) {
    const images = this.world.graphics.images;
    if (part.kind === 0)
      return {
        bitmap: await this.cache(instance).load(this.filename(instance, object), id),
        owned: true,
        position: [0, 0],
      };
    if (part.kind === 1 || part.kind === 6) return { bitmap: part.bitmap, owned: false };
    if (part.kind === 2 || part.kind === 5) {
      const source = this.find(instance, part.reference);
      if (!source || (source.nativeType !== 2 && source.nativeType !== 6)) return { bitmap: 0 };
      const number = decimalDigit(part.number, part.divisor),
        selector = part.directSelector ? number >>> 0 : fesImageFrameID(source, number);
      return {
        bitmap: await this.cache(instance).load(this.filename(instance, source), selector),
        owned: true,
      };
    }
    if (part.kind === 7 && part.bitmap) {
      const clone = images.get(part.bitmap).clone();
      clone.owner = instance.runtimeID;
      const handle = images.add(clone);
      try {
        await clone.resize(part.scaledWidth >>> 0, part.scaledHeight >>> 0);
        return {
          bitmap: await copyFESBitmapRectangle(images, handle, part.crop, instance.runtimeID),
          owned: true,
        };
      } finally {
        await images.release(handle);
      }
    }
    return { bitmap: 0 };
  }
  async glyphBitmap(instance, object, size) {
    const r = this.resource(object),
      images = this.world.graphics.images;
    let image = r.panelGlyphBitmap ? images.get(r.panelGlyphBitmap) : null;
    const side = (size + 8) | 0;
    if (!image || image.width !== side || image.height !== side) {
      if (image) await images.release(r.panelGlyphBitmap);
      r.panelGlyphBitmap = images.create(side, side, instance.runtimeID);
      image = images.get(r.panelGlyphBitmap);
    }
    return image;
  }
  async fontResources(instance, object, part) {
    const images = this.world.graphics.images,
      map = new Map(),
      owned = new Set();
    let previous = '',
      decoded = 0,
      data = 0,
      shared = 0;
    if (part.userFonts.length) state(object).userFontChanged = false;
    const release = async () => {
      for (const handle of owned) await images.release(handle);
    };
    try {
      for (const specification of part.userFonts) {
        const file = this.expand(instance, specification.file),
          same = previous.toLowerCase() === file.toLowerCase(),
          code = specification.code & 65535;
        if (specification.frame === -1) {
          if (!same) {
            decoded = await this.cache(instance).load(file, 0);
            if (!decoded) continue;
            owned.add(decoded);
            previous = file;
          }
          if (!decoded)
            throw new Error('PANEL image-font cell has no decoded source for its current file');
          shared = decoded;
          if (!map.has(code))
            map.set(code, {
              bitmap: 0,
              rectangle: [
                specification.x,
                specification.y,
                specification.width,
                specification.height,
              ],
            });
        } else {
          if (!same) {
            data = await this.cache(instance).data(file);
            if (!data) continue;
            previous = file;
          }
          if (!data)
            throw new Error('PANEL image-font frame has no encoded source for its current file');
          const bytes = this.world.runtime.imageDataBuffers.data(data),
            bitmap = await this.decodeEntry(instance, bytes, specification.frame);
          if (bitmap) owned.add(bitmap);
          const image = bitmap ? images.get(bitmap) : null;
          if (!map.has(code))
            map.set(code, { bitmap, rectangle: [0, 0, image?.width ?? 0, image?.height ?? 0] });
        }
      }
      if (shared) {
        const source = images.get(shared),
          width = source.state.canvasWidth || source.width,
          height = source.state.canvasHeight || source.height,
          handle = images.create(width, height, instance.runtimeID),
          output = images.get(handle);
        owned.add(handle);
        // kcFont copies the physical image into an independent full canvas.
        // Existing source metadata only places that physical rectangle.
        const left = source.state.offsetX | 0,
          bottom = source.state.offsetY | 0,
          dx = Math.max(0, left),
          dy = Math.max(0, bottom),
          columns = Math.min(source.width, width - dx),
          rows = Math.min(source.height, height - dy);
        if (columns > 0 && rows > 0)
          await output.blit(source, {
            dx,
            dy: height - dy - rows,
            sx: 0,
            sy: source.height - rows,
            width: columns,
            height: rows,
            copy: true,
          });
        shared = handle;
      }
      return { map, shared, release };
    } catch (error) {
      await release();
      throw error;
    }
  }
  async textPart(instance, object, part, destination, position) {
    if (!part.text?.length) return;
    const runtime = await this.world.text.runtime(),
      row = new Int32Array(22),
      glyphBitmap = await this.glyphBitmap(instance, object, part.fontSize),
      parser = {
        glyphs: runtime.glyphs,
        character: (record) =>
          new TextDecoder('shift_jis').decode(
            Uint8Array.from(record[1] > 255 ? [record[1] >>> 8, record[1] & 255] : [record[1]]),
          ),
        font: () => ({
          face: part.font || this.world.configuration.fields.font.name,
          height: -part.fontSize,
          weight: 0,
          fixed: 0,
          escapement: 0,
          orientation: 0,
        }),
      };
    row[2] = colorRef(part.color);
    row[3] = colorRef(part.outlineColor);
    row[7] = part.fontSize;
    row[13] = part.styles[0];
    row[14] = part.styles[1];
    const fonts = await this.fontResources(instance, object, part);
    let x = position[0],
      y = position[1],
      line = 0,
      used = 0;
    try {
      for (const code of nativeTextUnits(part.text)) {
        if (used > ((Math.imul(part.fontSize, part.columns) - Math.trunc(part.fontSize / 2)) | 0)) {
          if (++line >= part.maxLines) break;
          x = position[0];
          y = (y + part.fontSize + part.lineSpacing) | 0;
          used = 0;
        }
        row[1] = code;
        row[6] = 0;
        const specification = fonts.map.get(code),
          handle = fonts.shared || specification?.bitmap,
          image = specification && handle ? this.world.graphics.images.get(handle) : null;
        if (specification && (!image || image.state.bpp !== 4)) row[1] = 0x8140;
        const frame =
            specification && image?.state.bpp === 4
              ? { width: image.width, height: image.height, rgba: await image.pixels() }
              : null,
          rectangle = specification?.rectangle,
          shape = rasterTextGlyph(parser, row, {
            image: frame,
            sourceRect: rectangle
              ? { x: rectangle[0], y: rectangle[1], width: rectangle[2], height: rectangle[3] }
              : null,
          }),
          pixels = await glyphBitmap.pixels();
        pixels.fill(0);
        const width = Math.min(shape.width, glyphBitmap.width),
          height = Math.min(shape.height, glyphBitmap.height);
        for (let yy = 0; yy < height; yy++)
          pixels.set(
            shape.rgba.subarray(yy * shape.width * 4, (yy * shape.width + width) * 4),
            (glyphBitmap.height - yy - 1) * glyphBitmap.width * 4,
          );
        await glyphBitmap.changed();
        await this.compositePart(destination, glyphBitmap, [x, y]);
        if (shape.width) {
          x = (x + shape.width) | 0;
          used = (used + shape.width) | 0;
        } else {
          x = (x + (code & 0xff00 ? part.fontSize : Math.trunc(part.fontSize / 2))) | 0;
          used = (used + part.fontSize) | 0;
        }
        if (part.styles[0] || part.styles[1]) {
          x = (x - 2) | 0;
          used = (used - 2) | 0;
        }
      }
    } finally {
      await fonts.release();
    }
  }
  async reload(instance, object) {
    if (!isPanel(object)) return super.reload(instance, object);
    const r = this.resource(object),
      images = this.world.graphics.images;
    if (object.sizeDirty) {
      const metadata = await this.panelMetadata(instance, object, 0, true);
      if (metadata) {
        const width = metadata.getInt32(16, true),
          height = metadata.getInt32(20, true),
          bitmap = images.create(width, height, instance.runtimeID);
        await this.replace(object, bitmap, 0);
        object.width = width;
        object.height = height;
      }
      object.sizeDirty = false;
    }
    if (!r.bitmap) return true;
    const output = images.get(r.bitmap);
    await output.fill(0, 0, output.width, output.height, 0);
    for (const id of state(object).displayIDs) {
      const part = fesPanelPart(object, id);
      if (!part) continue;
      if (part.kind === 3 || part.kind === 4) {
        if (part.text?.length)
          await this.textPart(
            instance,
            object,
            part,
            output,
            await this.partPosition(instance, object, id),
          );
        continue;
      }
      const input = await this.partImage(instance, object, id, part);
      if (input.bitmap) {
        try {
          await this.compositePart(
            output,
            images.get(input.bitmap),
            input.position ?? (await this.partPosition(instance, object, id)),
          );
        } finally {
          if (input.owned) await images.release(input.bitmap);
        }
      }
    }
    await this.tone(output, object.toneRGB);
    if (object.blurX !== 1 || object.blurY !== 1)
      await bitmapBlur(output, object.blurX, object.blurY);
    await this.replace(object, r.bitmap);
    return true;
  }
  async publish(instance, object, draw, sleeping) {
    if (!isPanel(object)) return super.publish(instance, object, draw, sleeping);
    const r = this.resource(object);
    if (!draw || object.renderID === -1) return;
    const key = (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0;
    if (
      r.binding &&
      (r.binding.surface !== draw.record.id || r.binding.key !== key || r.binding.kind !== 0)
    )
      await this.removeBinding(object);
    if (!r.bitmap) {
      await draw.remove(key);
      r.binding = null;
      return;
    }
    const s = this.workspace(object),
      fields = s.fields,
      plane = this.plane(instance, object, draw),
      point = fesImagePosition(instance, object);
    fields.fill(0);
    fields[0] = r.bitmap;
    fields[4] = floatBits(f(f(plane.x) + point[0]));
    fields[5] = floatBits(f(f(plane.y) + point[1]));
    fields[6] = floatBits(object.baseX);
    fields[7] = floatBits(object.baseY);
    fields[8] = floatBits(object.rotation);
    fields[9] = floatBits(object.scaleX);
    fields[10] = floatBits(object.scaleY);
    fields[11] = object.alpha >>> 0;
    fields[12] = sleeping ? 0 : object.displayValue >>> 0;
    fields[13] = object.coordinateMode >>> 0;
    await this.world.retainedDraw.bind(draw, key, fields);
    const left = plane.found ? plane.x : 0,
      top = plane.found ? plane.y : 0;
    [left, top, (left + plane.width) | 0, (top + plane.height) | 0].forEach((value, index) =>
      s.clip.store(index * 4, value),
    );
    await this.world.graphics.send(
      draw.record.id,
      instance.runtimeID,
      289,
      object.renderID,
      0,
      s.clip,
    );
    r.binding = { surface: draw.record.id, key, kind: 0, input: r.bitmap };
  }
  async update(instance, object, options = {}) {
    if (!isPanel(object)) return super.update(instance, object, options);
    if (object.deleted) return this.close(object);
    if (options.restoring && !object.imageResource) return;
    if (!object.imageResource) await this.initialize(instance, object);
    const r = this.resource(object);
    if (options.restoring) {
      if (r.bitmap) this.world.graphics.images.get(r.bitmap);
      if (r.panelGlyphBitmap) this.world.graphics.images.get(r.panelGlyphBitmap);
      for (const bitmap of state(object).ownedBitmaps) this.world.graphics.images.get(bitmap);
      return;
    }
    const draw = this.draw(instance),
      sleeping = !!instance.player.nativeInput?.state.sleeping,
      recompose = !!(object.sizeDirty || object.imageChanged),
      nextKey = draw
        ? (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0
        : null,
      moved = !!r.binding && (r.binding.surface !== draw?.record.id || r.binding.key !== nextKey);
    if (recompose) await this.reload(instance, object);
    if (moved && !draw) await this.removeBinding(object);
    if (object.dirty || recompose || moved) {
      await this.applyGeometry(instance, object, false);
      await this.publish(instance, object, draw, sleeping);
      object.dirty = object.sizeDirty = object.imageChanged = false;
    } else if (r.binding && r.sleeping !== sleeping)
      await this.world.graphics.send(
        r.binding.surface,
        instance.runtimeID,
        287,
        object.renderID,
        Number(object.disp && !sleeping),
      );
    if (object.priorityChanged && draw)
      await this.world.graphics.send(
        draw.record.id,
        instance.runtimeID,
        299,
        object.renderID,
        object.pri,
      );
    object.priorityChanged = false;
    r.sleeping = sleeping;
  }
  async closeObject(object) {
    if (isPanel(object)) {
      const panel = state(object);
      for (const handle of panel.ownedBitmaps) await this.world.graphics.images.release(handle);
      panel.ownedBitmaps.clear();
      for (const part of panel.parts.values())
        if (part.ownBitmap) {
          part.bitmap = 0;
          part.ownBitmap = false;
        }
    }
    await super.closeObject(object);
  }
  async cleanupEntry(instance, entry) {
    if (entry.image?.panelGlyphBitmap) {
      await this.world.graphics.images.release(entry.image.panelGlyphBitmap);
      entry.image.panelGlyphBitmap = 0;
    }
    await super.cleanupEntry(instance, entry);
  }
  async close(object) {
    if (isPanel(object) && object.imageResource && !object.imageResource.closed) {
      const images = this.world.graphics.images,
        r = this.resource(object);
      for (const handle of state(object).ownedBitmaps) await images.release(handle);
      state(object).ownedBitmaps.clear();
      for (const part of state(object).parts.values())
        if (part.ownBitmap) {
          part.bitmap = 0;
          part.ownBitmap = false;
        }
      if (r.panelGlyphBitmap) {
        await images.release(r.panelGlyphBitmap);
        r.panelGlyphBitmap = 0;
      }
    }
    return super.close(object);
  }
}
