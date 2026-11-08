// SPDX-License-Identifier: MPL-2.0
// InputTask: game 5E69A0/5E6DF0/5E7680, SDK 4C2C60/4C30B0/4C38F0.
import { nativeReply } from '../kcs/vm.mjs';
import { nativeEngineWord, NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
const decodeCP932 = (bytes) => new TextDecoder('shift_jis', { ignoreBOM: true }).decode(bytes);

const emptyRect = ([left, top, right, bottom]) => left >= right || top >= bottom;
const contains = ([left, top, right, bottom], x, y) =>
  x >= left && x < right && y >= top && y < bottom;
const readWord = (bytes, index) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(index * 4, true);
const words = (memory, pointer, count) =>
  Array.from({ length: count }, (_, i) => memory.load(pointer + i * 4) >>> 0);
const bytesAt = (memory, pointer, size) =>
  memory.bytes ? memory.bytes(pointer, size) : memory.read(pointer, size);
const writeBytes = (memory, address, bytes) =>
  memory.write ? memory.write(address, bytes) : bytesAt(memory, address, bytes.length).set(bytes);
const noop = () => {};

export const NATIVE_INPUT_IDS = Object.freeze([
  ...Array.from({ length: 11 }, (_, i) => 0x90 + i),
  0x11d,
  0x11e,
  0x18b,
  0x18c,
]);

// 5E6CE0/4C2FA0 sample the canvas rectangle through the bitmap color getter;
// this includes its origin offset and the lack of alpha in 24-bit colors.
export async function nativeInputBitmapMask(bitmap) {
  const state = bitmap.state,
    width = state.canvasWidth || bitmap.width,
    height = state.canvasHeight || bitmap.height,
    stride = Math.ceil(width / 8),
    bytes = new Uint8Array(stride * height);
  if (![3, 4].includes(state.bpp))
    throw new Error(`Native input bitmap mask has no host pixel codec for bpp ${state.bpp}`);
  if (state.bpp === 4) {
    const rgba = await bitmap.pixels();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const px = (x - state.offsetX) >>> 0,
          py = (y - state.offsetY) >>> 0;
        if (px < bitmap.width && py < bitmap.height && rgba[(py * bitmap.width + px) * 4 + 3])
          bytes[y * stride + (x >>> 3)] |= 1 << (x & 7);
      }
  }
  return { width, height, bytes };
}

export class NativeInput {
  constructor({
    dispatch,
    cursor = noop,
    textInput,
    frameRate = 60,
    configuration,
    services = {},
  } = {}) {
    Object.assign(this, { dispatch, cursor, textInput, services, configuration });
    this.frameRate = frameRate >>> 0;
    this.regions = [];
    this.nextSequence = 1;
    this.x = this.y = this.previousX = this.previousY = 0;
    this.changed = false;
    this.frame = 0;
    this.dragging = false;
    this.dragX = this.dragY = 0;
    this.dragThreshold = 2;
    this.captures = new Uint32Array(80);
    this.lastReceivers = new Uint32Array(80).fill(0xffffffff);
    this.keys = new Uint32Array(320);
    this.sources = new Uint32Array(320);
    this.held = new Uint32Array(320);
    this.previous = new Uint32Array(320);
    this.handled = new Uint32Array(320);
    this.repeatEnabled = new Uint8Array(320).fill(1);
    this.enabled = new Uint32Array(80).fill(1);
    this.pulses = new Uint32Array(80);
    this.repeatStart = 30;
    this.repeatInterval = 5;
    this.source = 0;
    this.text = '';
    this.textBytes = new Uint8Array(256);
    this.textFailure = null;
    this.textStatus = 2;
    this.textRequest = 0;
    this.cursorVisible = true;
    this.cursorEnabled = 1;
    this.cursorAutoHide = configuration ? readWord(configuration.blocks[2], 4) : 0;
    this.cursorHideFrames = configuration
      ? Math.imul(60, readWord(configuration.blocks[2], 5)) >>> 0
      : 0;
    this.idleFrames = 0;
    this.cursorBlocked = 0;
    this.forceCursor = false;
    this.foreground = true;
    this.pointerActivation = false;
    this.warp = null;
    this.mouseState = new Uint8Array(32);
  }
  // Priorities are signed. Equal priorities retain list order; changing a
  // priority removes and appends the record before the stable native sort.
  ordered() {
    return this.regions.toSorted(
      (a, b) => (b.priority | 0) - (a.priority | 0) || a.sequence - b.sequence,
    );
  }
  get(owner) {
    return this.ordered().find((record) => record.owner === owner >>> 0) ?? null;
  }
  register({
    owner,
    receiver = owner,
    bounds = [0, 0, 0, 0],
    priority = 0,
    flags = 0,
    mask = 7,
    extra = 0,
    raw,
  } = {}) {
    if (
      !Number.isInteger(owner) ||
      owner < 0 ||
      bounds.length !== 4 ||
      bounds.some((n) => !Number.isInteger(n))
    )
      throw new Error('Invalid native input registration');
    const record = {
      owner: owner >>> 0,
      receiver: receiver >>> 0,
      bounds: bounds.map((n) => n | 0),
      priority: priority >>> 0,
      flags: flags >>> 0,
      mask: mask >>> 0,
      extra: extra >>> 0,
      active: 0,
      enabled: 1,
      hoverEnabled: 1,
      dragEnabled: 1,
      alpha: null,
      sequence: this.nextSequence++,
      ...(raw ? { raw: raw.slice() } : {}),
    };
    this.regions.push(record);
    return record;
  }
  unregister(owner) {
    const record = this.get(owner),
      at = this.regions.indexOf(record);
    if (at >= 0) this.regions.splice(at, 1);
    return at >= 0;
  }
  priority(owner, priority) {
    const record = this.get(owner);
    if (record) {
      record.priority = priority >>> 0;
      record.sequence = this.nextSequence++;
    }
  }
  pointer(x, y, blocked) {
    this.x = x | 0;
    this.y = y | 0;
    if (blocked !== undefined) this.cursorBlocked = Number(blocked) >>> 0;
  }
  key(index, down, source = 1, device = 0) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= 80 ||
      !Number.isInteger(device) ||
      device < 0 ||
      device >= 4
    )
      throw new Error('Native input key/device is outside the 80 by 4 table');
    const at = index * 4 + device;
    this.keys[at] = Number(!!down);
    this.sources[at] = source >>> 0;
  }
  queryKey(index, slot = 0) {
    if (index < 0 || index >= 80 || slot < 0 || slot > 3)
      throw new RangeError('Native input device query crosses its key table');
    if (this.services.queryKey) return this.services.queryKey(index, slot) >>> 0;
    if (this.pulses[index]) {
      this.pulses[index]--;
      return 1;
    }
    const at = index * 4 + slot;
    return this.keys[at] ? this.sources[at] : 0;
  }
  virtualPoint(x = this.x, y = this.y) {
    const point = this.services.screenToVirtual?.(x, y) ?? [x, y];
    return [point[0] | 0, point[1] | 0];
  }
  alphaHit(record, x = this.x, y = this.y) {
    const alpha = record?.alpha;
    if (!alpha) return true;
    x = (x - record.bounds[0]) | 0;
    y = (y - record.bounds[1]) | 0;
    return (
      x >= 0 &&
      y >= 0 &&
      x < alpha.width &&
      y < alpha.height &&
      !!(alpha.bytes[y * Math.ceil(alpha.width / 8) + (x >>> 3)] & (1 << (x & 7)))
    );
  }
  hit(record, allowEmpty = true, point = this.virtualPoint()) {
    if (!record) return false;
    return (
      ((allowEmpty && emptyRect(record.bounds)) || contains(record.bounds, ...point)) &&
      this.alphaHit(record, ...point)
    );
  }
  async send(record, message, wParam, lParam, context) {
    if (!this.dispatch) throw new Error('Native input task has no engine message router');
    return context
      ? this.dispatch(record.owner, message, wParam, lParam, context)
      : this.dispatch(record.owner, message, wParam, lParam);
  }
  consumed(reply) {
    if (reply && typeof reply === 'object' && 'routed' in reply) {
      if (!reply.routed) return false;
      return nativeEngineWord(reply.result, 'Input target reply') === 0;
    }
    if (reply === NATIVE_UNWRITTEN_WORD)
      throw new Error('Native input target did not initialize its result word');
    return reply === 0;
  }
  async hover(x = this.x, y = this.y) {
    const point = this.virtualPoint(x, y),
      regions = this.ordered();
    let owner =
      regions.find(
        (record) =>
          record.enabled &&
          record.hoverEnabled &&
          (record.alpha
            ? this.alphaHit(record, ...point)
            : !emptyRect(record.bounds) && contains(record.bounds, ...point)),
      )?.owner ?? -1;
    for (const record of regions) {
      if (!record.enabled || !record.hoverEnabled || !record.active) continue;
      if (record.owner === owner) owner = -1;
      else {
        await this.send(record, 8, ...point);
        record.active = 0;
      }
    }
    if (owner !== -1) {
      const record = this.get(owner);
      if (record && !record.active) {
        record.active = 1;
        await this.send(record, 7, ...point);
      }
    }
  }
  async route(index, down, source, repeat = false) {
    if (this.dragging) return false;
    const point = this.virtualPoint(...(this.routePoint ?? [this.x, this.y]));
    this.source = source >>> 0;
    if (down && !repeat) {
      this.captures[index] = 0;
    }
    const captured = this.captures[index],
      regions = this.ordered();
    // Repeat selects exactly the captured record, or the first list record
    // when the initial press was not consumed. It never searches past it.
    const candidates = repeat
      ? [regions.find((r) => !captured || r.owner === captured)].filter(Boolean)
      : regions;
    let result = false;
    for (const record of candidates) {
      if (!record.enabled) continue;
      if (down && (!(record.mask & source) || (source & 2 && !this.hit(record, true, point))))
        continue;
      if (!down && captured && record.owner !== captured) continue;
      if (this.consumed(await this.send(record, 4, index, Number(!!down)))) {
        if (down && !repeat) this.captures[index] = record.owner;
        result = true;
        break;
      }
    }
    if (!down) this.captures[index] = 0;
    return result;
  }
  async click() {
    const point = this.virtualPoint(this.previousX, this.previousY);
    let consumed = false;
    for (const record of this.ordered())
      if (record.enabled && this.hit(record, true, point))
        consumed = this.consumed(await this.send(record, 5, 0, 0)) || consumed;
    return consumed;
  }
  async drag() {
    const from = this.virtualPoint(this.dragX, this.dragY),
      to = this.virtualPoint(this.previousX, this.previousY);
    for (const record of this.ordered())
      if (
        record.enabled &&
        record.dragEnabled &&
        record.mask & 2 &&
        (emptyRect(record.bounds) || contains(record.bounds, ...from))
      ) {
        const packet = new NativeInputPacket(20);
        packet.store(4, from[0]);
        packet.store(8, from[1]);
        packet.store(12, to[0]);
        packet.store(16, to[1]);
        await this.send(record, 6, 4, 12, { payload: packet });
      }
  }
  async notifyCursor(visible) {
    await this.services.notifyCursor?.(Number(!!visible));
  }
  showCursor(visible) {
    this.cursorVisible = !!visible;
    return this.cursor(this.cursorVisible);
  }
  async cancelDrag() {
    if (!this.dragging) return;
    this.routePoint = [this.previousX, this.previousY];
    let stop = false;
    for (let slot = 0; slot < 4 && !stop; slot++)
      for (let index = 0; index < 80 && !stop; index++) {
        const at = index * 4 + slot;
        if (!this.enabled[index] || !this.held[at]) continue;
        this.held[at] = this.handled[at] = 0;
        const source = this.previous[at];
        this.handled[at] = Number(await this.route(index, false, source === 16 ? 2 : source));
        stop = !!this.handled[at];
        this.previous[at] = 0;
      }
    delete this.routePoint;
    this.dragging = false;
    await this.services.clearKeys?.();
  }
  async tick(frame) {
    this.frame = frame >>> 0;
    await this.services.poll?.();
    const sampled = this.services.pointer?.();
    if (sampled) this.pointer(sampled.x, sampled.y, sampled.blocked);
    let localX = this.x,
      localY = this.y;
    if (this.warp && (this.warp.remaining | 0) > 0) {
      const oldX = localX,
        oldY = localY,
        remaining = this.warp.remaining | 0;
      const x = (oldX + Math.trunc(((this.warp.x - oldX) | 0) / remaining)) | 0,
        y = (oldY + Math.trunc(((this.warp.y - oldY) | 0) / remaining)) | 0;
      this.pointer(x, y);
      await this.services.warp?.(x, y);
      this.warp.remaining = remaining <= 1 ? 0 : (remaining + this.warp.started - this.frame) | 0;
      if (remaining > 1 && this.warp.remaining <= 0) this.warp.remaining = 1;
      if (oldX || oldY) {
        await this.hover(x, y);
        if (this.cursorAutoHide && this.cursorEnabled && !this.cursorVisible) {
          this.showCursor(true);
          await this.notifyCursor(true);
        }
      }
      this.idleFrames = 0;
      // Both fixed executables store interpolated Y into the local X slot.
      // Keep this native quirk: subsequent hit tests use [newY, oldY].
      localX = y;
      if (!this.warp.remaining) this.warp = null;
    } else if (localX === this.previousX && localY === this.previousY && !this.changed) {
      if (this.cursorBlocked) {
        if (this.foreground) {
          this.idleFrames = (this.idleFrames + 1) >>> 0;
          if (
            this.cursorAutoHide &&
            this.cursorEnabled &&
            this.cursorVisible &&
            this.idleFrames >= this.cursorHideFrames
          ) {
            this.showCursor(false);
            await this.notifyCursor(false);
          }
        }
      } else if (!this.forceCursor) {
        this.idleFrames = 0;
        if (this.cursorAutoHide && this.cursorEnabled && !this.cursorVisible) this.showCursor(true);
      }
    } else {
      await this.hover(localX, localY);
      const moved = localX !== this.previousX || localY !== this.previousY;
      if (!this.forceCursor && moved) this.idleFrames = 0;
      if (
        this.cursorAutoHide &&
        this.cursorEnabled &&
        !this.cursorVisible &&
        !this.forceCursor &&
        moved
      ) {
        this.showCursor(true);
        await this.notifyCursor(true);
      }
      this.forceCursor = false;
    }
    this.previousX = localX;
    this.previousY = localY;
    this.routePoint = [localX, localY];
    let stop = false;
    for (let slot = 0; slot < 4 && !stop; slot++)
      for (let index = 0; index < 80 && !stop; index++) {
        if (!this.enabled[index]) continue;
        const at = index * 4 + slot,
          source = this.queryKey(index, slot);
        let delivered = false;
        if (source) {
          if (source !== this.previous[at] || source === 16) {
            this.previous[at] = source;
            this.held[at] = 1;
          } else this.held[at] = (this.held[at] + 1) >>> 0;
        } else if (this.held[at]) {
          this.held[at] = this.handled[at] = 0;
          this.dragging = false;
          const oldSource = this.previous[at];
          this.handled[at] = Number(
            await this.route(index, false, oldSource === 16 ? 2 : oldSource),
          );
          this.previous[at] = 0;
          this.captures[index] = 0;
          if (this.handled[at]) stop = true;
        }
        const held = this.held[at];
        if (held === 1) {
          this.dragX = this.x;
          this.dragY = this.y;
          this.dragging = false;
          this.handled[at] = Number(
            await this.route(index, true, this.previous[at] === 16 ? 2 : this.previous[at]),
          );
          delivered = true;
        } else if (
          held &&
          ((held === this.repeatStart &&
            (this.services.repeat ? this.services.repeat(index, slot) : this.repeatEnabled[at])) ||
            (held & 0x80000000 && (held & 0x7fffffff) === this.repeatInterval))
        ) {
          this.held[at] = 0x80000000;
          this.handled[at] = Number(
            await this.route(index, true, this.previous[at] === 16 ? 2 : this.previous[at], true),
          );
          delivered = true;
        }
        if ((delivered || (held && !(held & 0x80000000))) && this.handled[at]) stop = true;
      }
    if (this.services.takePointerActivation?.() || this.pointerActivation) {
      this.pointerActivation = false;
      this.dragX = this.x;
      this.dragY = this.y;
      await this.click();
    }
    const mouseDown = (this.queryKey(0, 0) | this.queryKey(0, 1)) & 2;
    if (mouseDown) {
      const dx = (this.previousX - this.dragX) | 0,
        dy = (this.previousY - this.dragY) | 0;
      if (
        this.dragging
          ? dx || dy
          : Math.abs(dx) >= this.dragThreshold || Math.abs(dy) >= this.dragThreshold
      ) {
        this.dragging = true;
        await this.drag();
        this.dragX = this.previousX;
        this.dragY = this.previousY;
      }
    }
    await this.services.finishFrame?.();
    this.changed = false;
    const mouse = this.services.mouseState?.();
    if (mouse) this.mouseState.set(mouse);
    delete this.routePoint;
    return 1;
  }
  beginText(text, originalBytes = encodeCP932(text)) {
    if (!this.textInput) throw new Error('Native text input service is unavailable');
    if (originalBytes.length > 255)
      throw new RangeError('Native text input crosses its 256-byte buffer');
    this.textBytes.set(originalBytes);
    this.textBytes[originalBytes.length] = 0;
    this.text = text;
    this.textFailure = null;
    this.textStatus = 0;
    const request = ++this.textRequest;
    Promise.resolve(this.textInput(text, { maxLength: 16 }))
      .then((result) => {
        if (request !== this.textRequest) return;
        this.text = result === null ? text : String(result);
        if (result !== null) {
          const bytes = encodeCP932(this.text);
          if (bytes.length > 255)
            throw new RangeError('Native text input crosses its 256-byte buffer');
          this.textBytes.set(bytes);
          this.textBytes[bytes.length] = 0;
        }
        this.textStatus = result === null ? 2 : 1;
      })
      .catch((error) => {
        this.textFailure = String(error?.message ?? error);
      });
  }
  async message(message, w = 0, l = 0, context = {}) {
    const memory = () =>
      typeof context.memory === 'function'
        ? context.memory()
        : context.memory || context.payload || context.machine;
    const requiredMemory = () => {
      const m = memory();
      if (!m) throw new Error(`Input message ${message} requires caller memory`);
      return m;
    };
    const owner = () => (context.resolveOwner?.(w) ?? w) >>> 0;
    const record = () => this.get(owner());
    switch (message) {
      case 3:
        this.cursor(true);
        return undefined;
      case 19:
        if (!this.configuration) throw new Error('Native input configuration is unavailable');
        this.cursorAutoHide = readWord(this.configuration.blocks[2], 4);
        this.cursorHideFrames = Math.imul(60, readWord(this.configuration.blocks[2], 5)) >>> 0;
        if (this.cursorAutoHide && this.cursorEnabled) {
          this.showCursor(true);
          await this.notifyCursor(true);
        }
        await this.services.joypad?.(this.configuration.keys.enableJoypad);
        break;
      case 91:
        if (!this.services.devicePointer)
          throw new Error('Native input device pointer service is unavailable');
        requiredMemory().store(l, await this.services.devicePointer());
        break;
      case 125: {
        const point = this.virtualPoint();
        requiredMemory().store(w, point[0]);
        requiredMemory().store(l, point[1]);
        break;
      }
      case 126: {
        const raw = bytesAt(requiredMemory(), l, 60).slice(),
          view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const rawOwner = view.getUint32(0, true),
          resolved = context.resolveOwner?.(rawOwner) ?? rawOwner;
        this.register({
          owner: resolved,
          priority: w,
          mask: view.getUint32(8, true),
          bounds: Array.from({ length: 4 }, (_, i) => view.getInt32(12 + i * 4, true)),
          raw,
        });
        break;
      }
      case 127:
        this.unregister(context.resolveOwner?.(l) ?? l);
        break;
      case 128:
        this.priority(owner(), l);
        break;
      case 129:
        if (record())
          record().bounds = l ? words(requiredMemory(), l, 4).map((v) => v | 0) : [0, 0, 0, 0];
        this.changed = true;
        break;
      case 130:
        if (record() && l) record().bounds.forEach((v, i) => requiredMemory().store(l + i * 4, v));
        break;
      case 131:
        if (record()) record().mask = l >>> 0;
        break;
      case 132:
        for (const r of this.ordered())
          if (r.owner === owner()) r.active = l >>> 0;
          else if (l) r.active = 0;
        break;
      case 133:
        return record() ? Number(record().active) >>> 0 : NATIVE_UNWRITTEN_WORD;
      case 134:
        if (record()) record().enabled = l >>> 0;
        this.changed = true;
        break;
      case 135:
        if (record()) record().hoverEnabled = l >>> 0;
        this.changed = true;
        break;
      case 136:
        return this.source === 16 ? 2 : this.source;
      case 137:
        if (this.configuration && !readWord(this.configuration.blocks[2], 3)) break;
        return this.message(138, w, l, context);
      case 138: {
        if (!this.foreground) break;
        const point = this.services.virtualToScreen?.(l & 65535, l >>> 16) ?? [l & 65535, l >>> 16];
        if (!point) break;
        await this.cancelDrag();
        this.warp = { x: point[0] | 0, y: point[1] | 0, remaining: w >>> 0, started: this.frame };
        break;
      }
      case 139: {
        const m = requiredMemory(),
          input = [];
        for (let offset = 0; offset <= 255; offset++) {
          const byte = bytesAt(m, l + offset, 1)[0];
          if (!byte) break;
          input.push(byte);
          if (offset === 255) throw new RangeError('Native text input crosses its 256-byte buffer');
        }
        const bytes = Uint8Array.from(input);
        this.beginText(decodeCP932(bytes), bytes);
        break;
      }
      case 140:
        if (this.textFailure) throw new Error(this.textFailure);
        return this.textStatus >>> 0;
      case 141: {
        const size = this.textBytes.indexOf(0);
        writeBytes(requiredMemory(), l, this.textBytes.subarray(0, size < 0 ? 256 : size + 1));
        break;
      }
      case 142:
        this.cursorAutoHide = w >>> 0;
        this.cursorHideFrames = Math.floor((Math.imul(l, this.frameRate) >>> 0) / 60);
        if (w && this.cursorEnabled) {
          this.showCursor(true);
          await this.notifyCursor(true);
        }
        break;
      case 143:
        break; // Both original platform functions consist of return 1.
      case 144:
        return (
          (this.queryKey(w, 0) |
            this.queryKey(w, 1) |
            this.queryKey(w, 2) |
            this.queryKey(w, 3)) >>>
          0
        );
      case 145:
        for (const r of this.regions) r.active = 0;
        this.previousX = this.previousY = -1;
        this.forceCursor = true;
        break;
      case 146:
        if (record()) {
          if (!l) record().alpha = null;
          else {
            if (!this.services.alphaMask)
              throw new Error('Native input alpha-mask bitmap service is unavailable');
            record().alpha = await this.services.alphaMask(l, context);
          }
        }
        break;
      case 147: {
        let text;
        if (context.nativePointer && w === 0) {
          if (this.configuration?.profile !== 'sdk-4.01-engine-2.6.1.74')
            throw new Error(
              'Game Input147 NULL source leaves the UTF16 conversion buffer uninitialized',
            );
          text = null;
        } else {
          const m = requiredMemory();
          text = m.string ? m.string(w) : decodeCP932(m.stringBytes(w));
        }
        if (!this.services.cursorImage)
          throw new Error('Native cursor image service is unavailable');
        await this.services.cursorImage(text, l & 65535, l >>> 16);
        break;
      }
      case 148:
        requiredMemory().store(l, Number(this.cursorVisible));
        break;
      case 149: {
        const result = await this.cursor(l >>> 0);
        this.cursorEnabled = this.services.cursorEnabled
          ? (await this.services.cursorEnabled()) >>> 0
          : result === undefined
            ? l >>> 0
            : Number(result) >>> 0;
        break;
      }
      case 150:
        if (w >= 80) throw new RangeError('Native input key gate crosses the 80-key table');
        this.enabled[w] = l;
        break;
      case 151:
        this.enabled.fill(1);
        break;
      case 152:
        return Number(!this.cursorBlocked);
      case 153:
        if (record()) record().dragEnabled = l >>> 0;
        break;
      case 154:
        if (w >= 80) throw new RangeError('Native input pulse crosses the 80-key table');
        if (this.services.setPulse) this.services.setPulse(w, l);
        else this.pulses[w] = l;
        break;
      case 155:
        if (!this.services.killTouch)
          throw new Error('Native input touch reset service is unavailable');
        await this.services.killTouch();
        break;
      case 156:
        if (!this.services.touchHold)
          throw new Error('Native input touch hold service is unavailable');
        await this.services.touchHold(l);
        break;
      case 157:
        if (!this.services.cancelWheel)
          throw new Error('Native input wheel reset service is unavailable');
        await this.services.cancelWheel();
        break;
      case 158:
        if (this.cursorAutoHide && this.cursorEnabled) {
          this.showCursor(true);
          await this.notifyCursor(true);
        }
        this.idleFrames = 0;
        break;
      case 159:
        if (l) writeBytes(requiredMemory(), l, this.mouseState);
        break;
      default:
        return undefined;
    }
    return NATIVE_UNWRITTEN_WORD;
  }
  snapshot() {
    if (this.textRequest && !this.textStatus)
      throw new Error('Native text input must settle before checkpointing');
    return structuredClone(
      Object.fromEntries(
        Object.entries(this).filter(
          ([key]) =>
            ![
              'dispatch',
              'cursor',
              'textInput',
              'configuration',
              'services',
              'routePoint',
            ].includes(key),
        ),
      ),
    );
  }
  restore(state) {
    Object.assign(this, structuredClone(state));
  }
}

export class NativeInputPacket {
  constructor(size = 64) {
    this.data = new Uint8Array(size);
  }
  bytes(address, length) {
    if (address < 0 || address + length > this.data.length)
      throw new RangeError('Input packet pointer is outside its allocation');
    return this.data.subarray(address, address + length);
  }
  load(address) {
    return new DataView(this.data.buffer).getUint32(address, true);
  }
  store(address, value) {
    new DataView(this.data.buffer).setUint32(address, value >>> 0, true);
  }
}

export async function nativeInput(id, args, machine, task, world) {
  const count =
    id === 0x18b
      ? 3
      : id === 0x18c
        ? 0
        : id === 0x11d
          ? 1
          : id === 0x11e
            ? 0
            : [4, 0, 2, 2, 2, 2, 3, 1, 0, 1, 2][id - 0x90];
  if (count === undefined) return undefined;
  if (args.length !== count)
    throw new Error(`KCS input native 0x${id.toString(16)} expects ${count} arguments`);
  if (!world?.sendNativeEngine) return undefined;
  const target = nativeEngineWord(
    await world.sendNativeEngine(0, task.id, world.engineMessages.layout.rootStart + 2),
    'Input task root query',
  );
  const context = { machine };
  const send = (message, w = 0, l = 0, ctx = context) =>
    world.sendNativeEngine(target, task.id, message, w, l, ctx);
  switch (id) {
    case 0x90: {
      const packet = new NativeInputPacket();
      packet.store(4, world.nativeTaskID(task.id));
      packet.store(12, args[3]);
      if (args[2]) packet.bytes(16, 16).set(machine.bytes(args[2], 16));
      // The owner is always the caller; args[0] supplies the packet sender.
      await send(126, args[1], 4, { payload: packet, nativeSender: args[0] });
      break;
    }
    case 0x91:
      await send(127, 0, world.nativeTaskID(task.id));
      break;
    case 0x92:
      await send(128, args[0], args[1]);
      break;
    case 0x93:
      await send(129, args[0], args[1]);
      break;
    case 0x94:
      await send(131, args[0], args[1]);
      break;
    case 0x95:
      await send(125, args[0], args[1]);
      break;
    case 0x96:
      await send(137, args[2], ((args[0] & 65535) | ((args[1] & 65535) << 16)) >>> 0);
      break;
    case 0x97:
      await send(139, 0, args[0]);
      break;
    case 0x98:
      return nativeReply(1, nativeEngineWord(await send(140), 'Input text status'));
    case 0x99:
      await send(141, 0, args[0]);
      break;
    case 0x9a:
      await send(142, args[0], args[1]);
      break;
    case 0x11d: {
      const result = await send(144, args[0]);
      return nativeReply(
        1,
        result === NATIVE_UNWRITTEN_WORD
          ? 0
          : nativeEngineWord(result, 'Input four-source key query'),
      );
    }
    case 0x11e:
      await send(145);
      break;
    case 0x18b: {
      let mapped = true;
      try {
        if (machine.region) machine.region(args[0] >>> 0, 1);
        else bytesAt(machine, args[0], 1);
      } catch {
        mapped = false;
      }
      await send(
        147,
        mapped ? args[0] : 0,
        ((args[1] & 65535) | ((args[2] & 65535) << 16)) >>> 0,
        mapped ? context : { ...context, nativePointer: true },
      );
      break;
    }
    case 0x18c: {
      let result = NATIVE_UNWRITTEN_WORD;
      await send(148, 0, 4, {
        payload: {
          store: (at, value) => {
            if (at !== 4) throw new Error('Native cursor visibility output address changed');
            result = value;
          },
        },
      });
      return nativeReply(1, nativeEngineWord(result, 'Input cursor visibility output'));
    }
  }
  return nativeReply(2);
}
