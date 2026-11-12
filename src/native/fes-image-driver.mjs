// SPDX-License-Identifier: MPL-2.0
// Entries own image wrappers; objects own current references and encoded bytes.
// Draw independently owns retained aliases and animation.
import {
  createFESImageSelector,
  fesImageFrameID,
  fesImagePosition,
  fesPositionQuery,
} from './fes-image-model.mjs';
import { markFESObjectDirty } from './fes-common-model.mjs';
import { fesPlaneRenderingState } from './fes-plane-driver.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { FESImageTable } from './fes-image-table-model.mjs';
import { composeFESWindow } from './fes-window-image.mjs';
import { copyFESBitmapRectangle } from './fes-bitmap.mjs';
import { bitmapBlur, bitmapTransfer } from './bitmap-pixels.mjs';
import { nativeImagePathParts } from './image-file.mjs';
import { nativeCategoryFilename } from './resource-file.mjs';
import { MOTION_ABI } from '../motion/abi.mjs';
import { floatBits } from '../kcs.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { nativeDataString } from './data-text.mjs';

const f = Math.fround,
  filenameDecoder = new TextDecoder('shift_jis'),
  types = new Set([1, 2, 6, 16, 17, 18, 19, 20, 22]),
  wrapperTypes = new Set([...types, 11, 12]),
  modelTypes = new Set([...wrapperTypes, 25]),
  tableTypes = new Set([16, 17, 18, 19, 20]),
  copySources = new Set([2, 6, 11, 12]),
  imageMetrics = [
    'width',
    'height',
    'canvasWidth',
    'canvasHeight',
    'offsetX',
    'offsetY',
    'baseX',
    'baseY',
  ];

// Run before the typed header applier. initialize() below does not reset fields.
export function initializeFESImage(object) {
  if (!modelTypes.has(object.nativeType))
    throw new TypeError(`Unsupported FES image type ${object.nativeType}`);
  Object.assign(object, {
    x: 0,
    y: 0,
    imageOriginX: 0,
    imageOriginY: 0,
    baseX: 0,
    baseY: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    alpha: 255,
    pri: -1,
    renderID: -1,
    oldPriority: -1,
    priorityChanged: false,
    width: -1,
    height: -1,
    color: 0,
    mask: 0,
    disp: false,
    displayValue: 0,
    displayDelta: 0,
    imageEncodedPointer: 0,
    imageAuxiliaryBitmap: 0,
    imageResourceEntryID: null,
    file: '',
    fileSingle: false,
    dirty: false,
    sizeDirty: false,
    baseHandlingMode: 0,
    coordinateMode: 0,
    toneRGB: [100, 100, 100],
    blurX: 1,
    blurY: 1,
    filterMode: 0,
    positionReference: null,
    positionPending: false,
    sizeReference: null,
    sizePending: false,
    referenceRequest: null,
    copyRequest: null,
    planeReference: null,
    parentPlaneID: 0,
    clip: [0, 0, 0, 0],
    clipEnabled: false,
    auxiliarySizeMode: false,
    auxiliaryWidth: 0,
    auxiliaryHeight: 0,
    anmFile: '',
    anmEnabled: false,
    anmPending: false,
    imageTable: null,
    tableFile: '',
    tablePending: false,
    baseOption: new Uint8Array(),
  });
  if (object.nativeType === 16 || object.nativeType === 17) {
    object.fileBytes = new Uint8Array();
    object.toneTable = null;
    Object.defineProperty(object, 'file', {
      configurable: true,
      enumerable: false,
      get() {
        return filenameDecoder.decode(this.fileBytes);
      },
    });
  }
  if (object.nativeType !== 1 && object.nativeType !== 25)
    Object.assign(object, createFESImageSelector());
  if (object.nativeType === 6)
    Object.assign(object, {
      buttonType: 0,
      buttonLock: 0,
      lockedPosition: null,
      fullInput: false,
      fullInputChanged: false,
      nativeInputTaskID: null,
    });
  return object;
}

export function setFESImageFile(object, name, source) {
  if (object.nativeType === 16 || object.nativeType === 17) {
    if (!(source instanceof Uint8Array))
      throw new TypeError('BGTABLE current FILE requires its original expanded bytes');
    const bytes = nativeDataString(source);
    if (
      bytes.length !== object.fileBytes.length ||
      bytes.some((byte, at) => byte !== object.fileBytes[at])
    ) {
      object.fileBytes = new Uint8Array(bytes);
      object.imageChanged = true;
    }
    return;
  }
  name = String(name);
  if (object.file !== name) {
    object.file = name;
    object.imageChanged = true;
  }
}

export class FESImages {
  constructor(world, { cacheFor, lookup } = {}) {
    if (!world?.graphics?.images || typeof cacheFor !== 'function' || typeof lookup !== 'function')
      throw new TypeError(
        'FES images require their World, owning encoded-byte cache and canonical collection lookup',
      );
    Object.assign(this, { world, cacheFor, lookup });
    this.scratch = new WeakMap();
    this.tables = new WeakMap();
    this.activeResources = new WeakMap();
  }
  supports(object) {
    return types.has(object.nativeType);
  }
  workspace(object) {
    let s = this.scratch.get(object);
    if (!s) {
      s = {
        fields: new Array(15).fill(0),
        clip: new NativeGraphicsPacket(),
        area: new NativeGraphicsPacket(),
        metadata: new Uint8Array(36),
        view: null,
        transfer: new Int32Array(10),
        rectangle: new Int32Array(4),
        plane: { x: 0, y: 0, width: 0, height: 0, inputX: 0, inputY: 0, found: false },
      };
      s.view = new DataView(s.metadata.buffer);
      this.scratch.set(object, s);
    }
    return s;
  }
  resource(object) {
    const r = this.activeResources.get(object) ?? object.imageResource;
    if (!r) throw new Error(`FES image ${object.key} has not been initialized`);
    return r;
  }
  currentBitmap(object) {
    return object.imageAuxiliaryBitmap || object.imageResource?.bitmap || 0;
  }
  makeResource(instance, entryID = null) {
    return {
      owner: instance.runtimeID,
      entryID,
      bitmap: 0,
      source: 0,
      binding: null,
      closed: false,
    };
  }
  async withResource(object, resource, operation) {
    if (!resource || resource.closed) throw new Error('FES image entry has no live wrapper');
    const previous = this.activeResources.get(object);
    this.activeResources.set(object, resource);
    try {
      return await operation();
    } finally {
      if (previous) this.activeResources.set(object, previous);
      else this.activeResources.delete(object);
    }
  }
  async allocateEntry(instance, object, entry) {
    if (!wrapperTypes.has(object.nativeType) || entry.savedType !== object.nativeType)
      throw new TypeError('FES image entry allocation requires its current wrapper family');
    if (entry.image) throw new Error('FES resource entry already has an image wrapper');
    if (object.imageAuxiliaryBitmap) {
      await this.world.graphics.images.release(object.imageAuxiliaryBitmap);
      object.imageAuxiliaryBitmap = 0;
    }
    entry.image = this.makeResource(instance, entry.id);
    object.imageResource = entry.image;
    object.imageResourceEntryID = entry.id;
    object.nativeImageHandle = 0;
    object.nativeImageMetrics = null;
    return entry.image;
  }
  async visitEntry(instance, object, entry, options = {}) {
    if (!wrapperTypes.has(object.nativeType))
      throw new TypeError('FES explicit image wrapper visit requires its current wrapper family');
    // A stale STRING entry can resolve to a newly declared CIMAGE. Both
    // original drivers leave its NULL wrapper untouched while all three
    // work gates are zero; SIZE initialization still requires that wrapper.
    if (
      entry.image == null &&
      object.nativeType === 1 &&
      object.sizeDirty === false &&
      object.dirty === false &&
      object.displayDelta === 0
    )
      return 0;
    return this.withResource(object, entry.image, () => this.update(instance, object, options));
  }
  validateEntry(instance, object, entry) {
    const r = entry.image;
    if (!r || r.closed || r.owner !== instance.runtimeID || r.entryID !== entry.id)
      throw new Error('FES image checkpoint has an invalid resource wrapper');
    if (r.bitmap) this.world.graphics.images.get(r.bitmap);
    if (r.source) this.world.renderSources.get(r.source);
    if (entry.savedType === 6) {
      const child = this.world.objects.objects.get(entry.buttonTaskID);
      if (!child || child.kind !== 6 || child.parent !== instance.runtimeID)
        throw new Error('FES Button checkpoint has no owned kind6 entry task');
    }
    if (object?.imageResourceEntryID === entry.id) {
      object.imageResource = r;
      if (object.imageEncodedPointer)
        this.world.runtime.imageDataBuffers.require(object.imageEncodedPointer);
      if (object.imageAuxiliaryBitmap) this.world.graphics.images.get(object.imageAuxiliaryBitmap);
    }
  }
  async refBitmap(instance, object, bitmapHandle) {
    if (![1, 2].includes(object.nativeType))
      throw new TypeError('FES bitmap refex requires CIMAGE or IMAGE');
    const images = this.world.graphics.images;
    if (object.imageAuxiliaryBitmap) await images.release(object.imageAuxiliaryBitmap);
    object.imageAuxiliaryBitmap = 0;
    object.imageAuxiliaryBitmap = bitmapHandle ? images.alias(bitmapHandle, instance.runtimeID) : 0;
    object.dirty = true;
  }
  async initialize(instance, object) {
    if (!this.supports(object))
      throw new TypeError(`Unsupported FES image type ${object.nativeType}`);
    if (object.deleted) return this.close(object);
    if (!object.imageResource) object.imageResource = this.makeResource(instance);
    const r = this.resource(object);
    if (r.owner !== instance.runtimeID || r.closed)
      throw new Error(`FES image ${object.key} has a different or released owner`);
    if (object.nativeType === 6 && object.nativeInputTaskID == null) {
      const input = instance.player.nativeInput;
      if (!input?.initializeObject)
        throw new Error('FES BUTTON requires its actual FES input owner');
      await input.initializeObject(object);
    }
    return r;
  }
  find(instance, reference) {
    if (!reference) return null;
    return this.lookup(instance, reference);
  }
  expand(instance, name) {
    return instance.player.expand ? instance.player.expand(name) : name;
  }
  cache(instance) {
    const cache = this.cacheFor(instance);
    if (!cache?.data || !cache?.load) throw new Error('FES image has no owning encoded-byte cache');
    return cache;
  }
  setEncodedData(object, pointer) {
    const buffers = this.world.runtime.imageDataBuffers;
    if (pointer) buffers.retainPointer(pointer);
    if (object.imageEncodedPointer) buffers.releasePointer(object.imageEncodedPointer);
    object.imageEncodedPointer = pointer;
  }
  dataFor(_instance, object) {
    const pointer = object.imageEncodedPointer;
    return pointer ? this.world.runtime.imageDataBuffers.data(pointer) : null;
  }
  draw(instance) {
    const id = instance.player.surface;
    const draw = this.world.graphics.drawTasks.get(id);
    return draw?.state.renderer ? draw : null;
  }
  async geometry(instance, object, reference) {
    const s = this.workspace(object),
      pointer = await this.cache(instance).data(this.expand(instance, reference.name));
    if (!pointer) return null;
    s.metadata.fill(0);
    return nativeImageMetadata(
      this.world.runtime.imageDataBuffers.data(pointer),
      reference.index,
      false,
      s.metadata,
    ).success
      ? s.view
      : null;
  }
  async applyGeometry(instance, object, size) {
    const reference = size ? object.sizeReference : object.positionReference;
    if (!reference || (size ? !object.sizePending : !object.positionPending)) return;
    if (!size) object.positionPending = false;
    const v = await this.geometry(instance, object, reference);
    // Native cached geometry leaves caller words unchanged on a missing file.
    // No known geometry can be invented from uninitialized locals.
    if (!v)
      throw new Error(
        `FES ${size ? 'SIZE2' : 'POS2'} resource geometry is unavailable: ${reference.name}`,
      );
    if (size) {
      object.width = v.getInt32(8, true);
      object.height = v.getInt32(12, true);
      if (!object.auxiliarySizeMode) {
        object.auxiliaryWidth = (object.width - 16) | 0;
        object.auxiliaryHeight = (object.height - 8) | 0;
      }
    } else {
      const x = f(v.getInt32(0, true)),
        y = f(v.getInt32(4, true));
      if (object.x !== x || object.y !== y) {
        object.x = x;
        object.y = y;
        markFESObjectDirty(instance, object);
      }
    }
  }
  plane(instance, object, draw) {
    const out = this.workspace(object).plane;
    Object.assign(out, {
      x: 0,
      y: 0,
      width: draw?.state.renderer.width ?? 0,
      height: draw?.state.renderer.height ?? 0,
      inputX: 0,
      inputY: 0,
      found: false,
    });
    if (object.parentPlaneID) {
      const id = this.world.resolveTaskID(object.parentPlaneID, instance.runtimeID),
        plane = id === null ? null : this.world.graphics.get(id);
      if (!plane?.graph)
        throw new Error(`FES parent plane ${object.parentPlaneID} has no live graph`);
      // Parent-plane raw message queries are kept synchronous here through the
      // already-authoritative JS graph fields; no task/PE identifier is reused.
      const texture = new DataView(
        plane.graph.textureTransform.buffer,
        plane.graph.textureTransform.byteOffset,
        plane.graph.textureTransform.byteLength,
      );
      const geometry = new DataView(
        plane.graph.kx2.buffer,
        plane.graph.kx2.byteOffset,
        plane.graph.kx2.byteLength,
      );
      out.x = truncateFloat32(texture.getFloat32(MOTION_ABI.pos, true));
      out.y = truncateFloat32(texture.getFloat32(MOTION_ABI.pos + 4, true));
      out.width = truncateFloat32(plane.state.rect[2]);
      out.height = truncateFloat32(plane.state.rect[3]);
      out.inputX =
        (truncateFloat32(geometry.getFloat32(MOTION_ABI.pos, true)) -
          truncateFloat32(geometry.getFloat32(MOTION_ABI.base, true))) |
        0;
      out.inputY =
        (truncateFloat32(geometry.getFloat32(MOTION_ABI.pos + 4, true)) -
          truncateFloat32(geometry.getFloat32(MOTION_ABI.base + 4, true))) |
        0;
      out.found = true;
    } else {
      const plane = this.find(instance, object.planeReference);
      if (plane?.nativeType === 4) {
        out.x = truncateFloat32(plane.vramX);
        out.y = truncateFloat32(plane.vramY);
        out.width = plane.width | 0;
        out.height = plane.height | 0;
        out.found = true;
        const state = fesPlaneRenderingState(instance, plane);
        out.inputX = (truncateFloat32(state.position[0]) - truncateFloat32(state.base[0])) | 0;
        out.inputY = (truncateFloat32(state.position[1]) - truncateFloat32(state.base[1])) | 0;
      }
    }
    return out;
  }
  async replace(object, bitmap = undefined, source = undefined) {
    const r = this.resource(object),
      images = this.world.graphics.images;
    if (bitmap !== undefined) {
      if (r.bitmap && r.bitmap !== bitmap) await images.release(r.bitmap);
      r.bitmap = bitmap;
      if (r === object.imageResource && !object.imageAuxiliaryBitmap) {
        object.nativeImageHandle = bitmap;
        object.nativeImageMetrics = bitmap
          ? Object.fromEntries(imageMetrics.map((k) => [k, images.get(bitmap).state[k]]))
          : null;
      }
    }
    if (source !== undefined) {
      if (r.source && r.source !== source) await this.world.renderSources.release(r.source);
      r.source = source;
    }
  }
  async token(instance, object, name, selector) {
    if (!name) return { handle: 0, normal: true };
    if (name.includes(',')) {
      const resolved = nativeCategoryFilename(this.world.game, name, 'image');
      const handle = resolved === null ? 0 : await this.world.imageComposites.load(resolved);
      if (handle) this.world.graphics.images.get(handle).owner = instance.runtimeID;
      return { handle, normal: false };
    }
    return { handle: await this.cache(instance).load(name, selector), normal: true };
  }
  async tone(bitmap, values) {
    if (bitmap.state.bpp !== 4 || values.every((v) => v === 100)) return;
    const luts = values.map((value) => {
        const lut = new Uint8Array(256);
        let next = 0;
        for (let n = 0; n < 256; n++) {
          lut[n] = Math.min(255, Math.floor(next / 100));
          next = (next + (value >>> 0)) >>> 0;
        }
        return lut;
      }),
      pixels = await bitmap.pixels();
    for (let at = 0; at < pixels.length; at += 4)
      for (let channel = 0; channel < 3; channel++)
        pixels[at + channel] = luts[channel][pixels[at + channel]];
    bitmap.state.source = null;
    await bitmap.changed();
  }
  async normalize(instance, object, bitmap, preserveSize) {
    const s = bitmap.state,
      previous = [object.baseX, object.baseY, object.imageOriginX, object.imageOriginY];
    if (object.baseHandlingMode === 0) {
      object.baseX = f((s.baseX - s.offsetX) | 0);
      object.baseY = f((s.baseY - s.offsetY) | 0);
      object.imageOriginX = f(s.baseX);
      object.imageOriginY = f(s.baseY);
      s.offsetX = s.offsetY = 0;
      s.canvasWidth = s.width;
      s.canvasHeight = s.height;
    } else if (object.baseHandlingMode === 1) {
      object.imageOriginX = object.imageOriginY = 0;
      object.baseX = f(s.baseX);
      object.baseY = f(s.baseY);
    }
    if (
      (object.baseHandlingMode === 0 || object.baseHandlingMode === 1) &&
      (!preserveSize || object.width === -1 || object.height === -1)
    ) {
      object.width = s.width;
      object.height = s.height;
      if (!object.auxiliarySizeMode) {
        object.auxiliaryWidth = (s.width - 16) | 0;
        object.auxiliaryHeight = (s.height - 8) | 0;
      }
    }
    if (
      previous.some(
        (v, i) => v !== [object.baseX, object.baseY, object.imageOriginX, object.imageOriginY][i],
      )
    )
      markFESObjectDirty(instance, object);
    await this.tone(bitmap, object.toneRGB);
    s.mask = object.mask >>> 0;
    await bitmap.changed();
    if (object.blurX !== 1 || object.blurY !== 1)
      await bitmapBlur(bitmap, object.blurX, object.blurY);
  }
  clearRequests(object) {
    object.imageChanged = false;
    object.copyRequest = null;
    object.referenceRequest = null;
  }
  async reload(instance, object) {
    const images = this.world.graphics.images,
      r = this.resource(object);
    if (object.nativeType === 1) {
      await this.applyGeometry(instance, object, true);
      const h = images.create(object.width, object.height, instance.runtimeID),
        b = images.get(h);
      await b.fill(0, 0, object.width, object.height, object.color);
      object.imageOriginX = f(b.state.offsetX);
      object.imageOriginY = f(b.state.offsetY);
      b.state.offsetX = b.state.offsetY = 0;
      b.state.canvasWidth = b.width;
      b.state.canvasHeight = b.height;
      b.state.mask = object.mask >>> 0;
      await b.changed();
      await this.replace(object, h);
      return true;
    }
    if (object.nativeType === 22) {
      const file = this.expand(instance, object.file);
      this.clearRequests(object);
      const pointer = await this.cache(instance).data(file);
      if (!pointer) return false;
      await this.applyGeometry(instance, object, true);
      const h = await composeFESWindow(
        images,
        object.width,
        object.height,
        (id) => this.cache(instance).load(file, id),
        instance.runtimeID,
      );
      await this.replace(object, h);
      return true;
    }
    if (object.referenceRequest || object.copyRequest) {
      const reference = object.referenceRequest ?? object.copyRequest,
        copy = !!object.copyRequest,
        source = this.find(instance, reference);
      this.clearRequests(object);
      if (!source || !copySources.has(source.nativeType)) return 'preserve';
      const sourceHandle = this.currentBitmap(source);
      if (!sourceHandle) throw new Error('FES image copy/reference requires decoded source pixels');
      let h;
      if (copy) {
        const rectangle = this.workspace(object).rectangle;
        rectangle.set(reference.rectangle);
        if (!rectangle[2] || !rectangle[3]) {
          rectangle[0] = rectangle[1] = 0;
          rectangle[2] = object.width;
          rectangle[3] = object.height;
        }
        h = await copyFESBitmapRectangle(images, sourceHandle, rectangle, instance.runtimeID);
        await this.normalize(instance, object, images.get(h), true);
      } else {
        const bitmap = images.get(sourceHandle).clone();
        bitmap.owner = instance.runtimeID;
        h = images.add(bitmap);
        bitmap.state.mask = object.mask >>> 0;
        await bitmap.changed();
      }
      await this.replace(object, h);
      return true;
    }
    const name = this.expand(instance, object.file);
    this.clearRequests(object);
    if (object.idIndex >>> 0 === 0xffffffff) {
      const pointer = await this.cache(instance).data(name);
      this.setEncodedData(object, pointer);
      const source = pointer
        ? await this.world.renderSources.decode(this.world.runtime.imageDataBuffers.data(pointer))
        : 0;
      if (source) {
        const state = this.world.renderSources.get(source);
        for (const h of [state.bitmap, ...state.frames.map((frame) => frame.bitmap)])
          if (h) images.get(h).owner = instance.runtimeID;
      }
      await this.replace(object, undefined, source);
      return true;
    }
    const selector = fesImageFrameID(object);
    if (object.fileSingle) {
      const loaded = await this.token(instance, object, name, selector);
      // A comma composition mutates the wrapper but its original return is0;
      // this direct-load branch therefore skips normalizing those pixels.
      if (loaded.handle && loaded.normal)
        await this.normalize(instance, object, images.get(loaded.handle), false);
      if (loaded.handle) await this.replace(object, loaded.handle);
      return true;
    }
    let handle = 0,
      anchor = false;
    for (const token of name.split(' ').filter(Boolean)) {
      const { stem, extension } = nativeImagePathParts(token),
        match = /^(.*):([+-]?\d+)$/.exec(stem),
        loaded = await this.token(
          instance,
          object,
          match ? match[1] + extension : token,
          match ? Number(match[2]) >>> 0 : selector,
        );
      if (!anchor) {
        if (loaded.handle) {
          if (handle) await images.release(handle);
          handle = loaded.handle;
          anchor = loaded.normal;
        }
      } else if (loaded.handle) {
        try {
          const destination = images.get(handle),
            source = images.get(loaded.handle),
            args = this.workspace(object).transfer;
          args.fill(0);
          args[1] = -destination.state.offsetX;
          args[2] = -destination.state.offsetY;
          args[3] = args[8] = source.width;
          args[4] = args[9] = source.height;
          await bitmapTransfer(this.world, destination, source, args, false, {
            id: instance.runtimeID,
          });
        } finally {
          await images.release(loaded.handle);
        }
      }
    }
    if (!name) {
      await this.replace(object, 0);
      return true;
    }
    handle ||= r.bitmap;
    if (handle) await this.normalize(instance, object, images.get(handle), true);
    if (handle) await this.replace(object, handle);
    return true;
  }
  async removeBinding(object) {
    const r = this.resource(object),
      b = r.binding;
    if (b) {
      const draw = this.world.graphics.drawTasks.get(b.surface),
        record = draw && this.world.retainedDraw.record(draw, b.key);
      if (
        record &&
        (b.source !== undefined
          ? record.source === b.source
          : record.kind === b.kind && record.input === b.input)
      )
        await draw.remove(b.key);
    }
    r.binding = null;
  }
  async publish(instance, object, draw, sleeping) {
    const r = this.resource(object);
    if (!draw || object.renderID === -1) return;
    const key = (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0,
      kind = r.bitmap ? 0 : r.source ? 2 : -1,
      input = r.bitmap || r.source;
    if (
      r.binding &&
      (r.binding.surface !== draw.record.id ||
        r.binding.key !== key ||
        r.binding.kind !== kind ||
        (kind === 2 && r.binding.input !== input))
    )
      await this.removeBinding(object);
    if (kind < 0) {
      await draw.remove(key);
      r.binding = null;
      return;
    }
    if (r.bitmap) {
      const b = this.world.graphics.images.get(r.bitmap);
      if (object.clipEnabled) b.state.clip = object.clip.slice();
      b.state.mask = object.mask >>> 0;
      await b.changed();
    }
    const s = this.workspace(object),
      fields = s.fields,
      plane = this.plane(instance, object, draw),
      position = fesImagePosition(instance, object);
    fields.fill(0);
    fields[kind] = input;
    let x, y;
    if (object.nativeType === 1) {
      x = f(f(plane.x) + position[0]);
      y = f(f(plane.y) + position[1]);
    } else if (object.nativeType !== 22 && object.coordinateMode && r.bitmap) {
      x = f(f(plane.x) + f(object.x));
      y = f(f(plane.y) + f(object.y));
    } else {
      x = f(f(f(plane.x) + f(object.baseX)) + position[0]);
      y = f(f(f(plane.y) + f(object.baseY)) + position[1]);
    }
    fields[4] = floatBits(x);
    fields[5] = floatBits(y);
    fields[6] = floatBits(object.baseX);
    fields[7] = floatBits(object.baseY);
    fields[8] = floatBits(object.rotation);
    fields[9] = floatBits(object.scaleX);
    fields[10] = floatBits(object.scaleY);
    fields[11] = object.alpha >>> 0;
    fields[12] = Number(object.disp && !sleeping);
    fields[13] = object.coordinateMode >>> 0;
    await this.world.retainedDraw.bind(draw, key, fields);
    const left = plane.found ? plane.x : 0,
      top = plane.found ? plane.y : 0;
    [left, top, (left + plane.width) | 0, (top + plane.height) | 0].forEach((v, i) =>
      s.clip.store(i * 4, v),
    );
    await this.world.graphics.send(
      draw.record.id,
      instance.runtimeID,
      289,
      object.renderID,
      0,
      s.clip,
    );
    r.binding = {
      surface: draw.record.id,
      key,
      kind,
      input,
      source: this.world.retainedDraw.record(draw, key).source,
    };
  }
  async button(instance, object, reloaded, dirty, priorityChanged, draw, sleeping) {
    if (!reloaded && !dirty && !priorityChanged && this.resource(object).sleeping === sleeping)
      return;
    if (reloaded || dirty) await this.applyGeometry(instance, object, true);
    const r = this.resource(object),
      id = object.nativeInputTaskID,
      s = this.workspace(object),
      plane = this.plane(instance, object, draw),
      point = fesPositionQuery(instance, object, 'image');
    const left = (point[0] + plane.inputX) | 0,
      top = (point[1] + plane.inputY) | 0,
      bitmap = r.bitmap ? this.world.graphics.images.get(r.bitmap) : null,
      width = object.width < 0 && bitmap ? bitmap.width : object.width,
      height = object.height < 0 && bitmap ? bitmap.height : object.height;
    const bounds = s.rectangle;
    bounds.set([left, top, (left + width) | 0, (top + height) | 0]);
    if (reloaded) {
      [...bounds, (object.pri + 100) | 0, 0].forEach((v, i) => s.area.store(i * 4, v));
      const created = await this.world.graphics.send(id, instance.runtimeID, 89, 0, 0, s.area);
      if (!created && !object.buttonLock) {
        bounds.forEach((v, i) => s.area.store(i * 4, v));
        await this.world.graphics.send(id, instance.runtimeID, 100, 0, 0, s.area);
      }
      if (object.buttonType && r.bitmap)
        await this.world.graphics.send(id, instance.runtimeID, 97, 0, r.bitmap);
    } else if (dirty) {
      if (object.fullInput) {
        bounds.set([-10000, -10000, 10000, 10000]);
        bounds.forEach((v, i) => s.area.store(i * 4, v));
        const top = this.world.engineMessages.closestTop(instance.runtimeID),
          inputID = top?.implementation.input;
        if (inputID == null) throw new Error('FES full-input requires its owning Input task');
        await this.world.sendEngine(
          inputID,
          instance.runtimeID,
          100,
          this.world.nativeTaskID(id),
          0,
          { payload: s.area },
        );
      } else {
        bounds.forEach((v, i) => s.area.store(i * 4, v));
        await this.world.graphics.send(id, instance.runtimeID, 100, 0, 0, s.area);
      }
    }
    if (reloaded || dirty || r.sleeping !== sleeping)
      await this.world.graphics.send(
        id,
        instance.runtimeID,
        92,
        0,
        Number(object.enable && !sleeping),
      );
    if (!reloaded && priorityChanged) {
      const region = this.world.inputFor(instance.runtimeID).get(id);
      if (region) {
        region.priority = object.fullInput ? 100000 : (object.pri + 100) | 0;
        this.world.inputFor(instance.runtimeID).changed = true;
      }
    }
  }
  async update(instance, object, { restoring = false } = {}) {
    if (object.deleted) return this.close(object);
    if (restoring && !object.imageResource && !this.activeResources.has(object)) return;
    if (!object.imageResource && !this.activeResources.has(object))
      await this.initialize(instance, object);
    const r = this.resource(object);
    if (restoring) {
      if (r.bitmap) this.world.graphics.images.get(r.bitmap);
      if (r.source) this.world.renderSources.get(r.source);
      if (object.imageEncodedPointer)
        this.world.runtime.imageDataBuffers.require(object.imageEncodedPointer);
      return;
    }
    if (object.tablePending) {
      object.tablePending = false;
      await this.loadTable(instance, object, object.tableFile);
    }
    const draw = this.draw(instance),
      sleeping = !!instance.player.nativeInput?.state.sleeping,
      needPixels =
        object.nativeType === 1
          ? object.sizeDirty
          : !!(
              object.imageChanged ||
              object.sizeDirty ||
              object.referenceRequest ||
              object.copyRequest
            ),
      dirty = object.dirty,
      priorityChanged = object.priorityChanged || object.fullInputChanged;
    let reloaded = false;
    if (needPixels) {
      const result = await this.reload(instance, object);
      if (result === 'preserve') {
        object.sizeDirty = object.dirty = false;
        return;
      }
      reloaded = result === true;
      if (reloaded || object.nativeType !== 22) object.sizeDirty = false;
    }
    const nextKey = draw
        ? (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0
        : null,
      moved = !!r.binding && (r.binding.surface !== draw?.record.id || r.binding.key !== nextKey);
    if (moved && !draw) await this.removeBinding(object);
    if (object.dirty || reloaded || moved) {
      await this.applyGeometry(instance, object, false);
      await this.publish(instance, object, draw, sleeping);
      object.dirty = false;
    } else if (r.sleeping !== sleeping && r.binding) {
      const b = r.binding,
        target = this.world.graphics.drawTasks.get(b.surface);
      if (target)
        await this.world.graphics.send(
          b.surface,
          instance.runtimeID,
          287,
          object.renderID,
          Number(object.disp && !sleeping),
        );
    }
    if (object.nativeType === 6)
      await this.button(
        instance,
        object,
        reloaded || needPixels,
        dirty || object.fullInputChanged,
        priorityChanged,
        draw,
        sleeping,
      );
    if (object.anmPending) {
      object.anmPending = false;
      if (draw && object.anmEnabled) {
        const path = nativeCategoryFilename(
            this.world.game,
            this.expand(instance, object.anmFile),
            'image',
          ),
          program = nativeImagePathParts(path).stem + '.anm',
          key = (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0;
        await this.world.retainedDraw.load(draw, key, program);
      }
      if (draw) {
        const key = (this.world.nativeTaskID(instance.runtimeID) | (object.renderID << 16)) >>> 0;
        await this.world.retainedDraw.enable(draw, key, Number(object.anmEnabled));
      }
    }
    if (object.priorityChanged && draw)
      await this.world.graphics.send(
        draw.record.id,
        instance.runtimeID,
        299,
        object.renderID,
        object.pri,
      );
    object.priorityChanged = object.fullInputChanged = false;
    r.sleeping = sleeping;
  }
  table(object) {
    if (!tableTypes.has(object.nativeType)) return null;
    if (!object.imageTable) return null;
    let cached = this.tables.get(object);
    if (!cached || cached.state !== object.imageTable) {
      cached = { state: object.imageTable, table: FESImageTable.restore(object.imageTable) };
      this.tables.set(object, cached);
    }
    if (object.nativeType === 19 || object.nativeType === 20)
      cached.table.setBaseOption(object.baseOption);
    return cached.table;
  }
  async loadTable(instance, object, name) {
    if (!tableTypes.has(object.nativeType))
      throw new TypeError('TABLE requires a typed FES image table');
    const file = this.expand(instance, name);
    object.tablePending = false;
    object.tableFile = file;
    const game = this.world.game,
      bytes = game.readCategory ? await game.readCategory(file, 'fes') : await game.read(file);
    if (!bytes?.length) return false;
    const table = new FESImageTable(object.nativeType, bytes);
    if (object.nativeType === 19 || object.nativeType === 20)
      table.setBaseOption(object.baseOption);
    object.tableFile = file;
    object.imageTable = table.snapshot();
    this.tables.delete(object);
    return true;
  }
  selectTable(object, selectors) {
    const result = this.table(object)?.select(selectors) ?? null;
    if (result === null) return false;
    if (object.nativeType === 16 || object.nativeType === 17)
      setFESImageFile(object, undefined, result);
    else object.file = filenameDecoder.decode(result);
    object.imageChanged = true;
    return true;
  }
  tableMax(object, selectors) {
    return this.table(object)?.max(selectors) ?? 0;
  }
  async close(object) {
    const r = object.imageResource;
    if (!r || r.closed) return;
    await this.removeBinding(object);
    await this.replace(object, 0, 0);
    await this.closeObject(object);
    if (object.nativeType === 6 && object.nativeInputTaskID != null) {
      const id = object.nativeInputTaskID,
        input = this.world.objects.objects.get(r.owner)?.implementation?.player?.nativeInput;
      if (this.world.objects.objects.has(id)) await this.world.objects.destroy(id, r.owner);
      if (input) input.state.buttons = input.state.buttons.filter(([key]) => key !== object.key);
      object.nativeInputTaskID = null;
    }
    r.closed = true;
  }
  async closeObject(object) {
    this.setEncodedData(object, 0);
    if (object.imageAuxiliaryBitmap) {
      await this.world.graphics.images.release(object.imageAuxiliaryBitmap);
      object.imageAuxiliaryBitmap = 0;
    }
  }
  async cleanupEntry(instance, entry) {
    const r = entry.image;
    if (r && !r.closed) {
      const draw = this.draw(instance),
        images = this.world.graphics.images;
      let match = null;
      if (draw && r.bitmap) {
        const data = images.get(r.bitmap).dataHandle;
        for (const item of draw.state.renderer.items.toSorted((a, b) => a.key - b.key)) {
          const record = this.world.retainedDraw.record(draw, item.key),
            source = record ? this.world.renderSources.get(record.source) : null,
            handle = source?.bitmap || (!record ? item.image : 0);
          if (handle && images.get(handle).dataHandle === data) {
            match = item.key;
            break;
          }
        }
      }
      if (match !== null) await draw.remove(match);
      else if (r.binding) {
        const record = draw && this.world.retainedDraw.record(draw, r.binding.key);
        if (
          record &&
          (r.binding.source !== undefined
            ? record.source === r.binding.source
            : record.kind === r.binding.kind && record.input === r.binding.input)
        )
          await draw.remove(r.binding.key);
      }
      r.binding = null;
      if (r.bitmap) await images.release(r.bitmap);
      if (r.source) await this.world.renderSources.release(r.source);
      r.bitmap = r.source = 0;
      r.closed = true;
    }
    if (entry.buttonTaskID != null) {
      const taskID = entry.buttonTaskID,
        input = instance.player.nativeInput;
      if (this.world.objects.objects.has(taskID))
        await this.world.sendEngine(taskID, instance.runtimeID, 3);
      if (input) input.state.buttons = input.state.buttons.filter(([, id]) => id !== taskID);
      entry.buttonTaskID = null;
    }
  }
}
