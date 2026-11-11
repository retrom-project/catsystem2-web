// SPDX-License-Identifier: MPL-2.0
// Semantic state and interaction for task kinds 40, 41 and 42. Resource decoding,
// skin composition, area/plane identities and actual retained drawing belong to
// the service supplied by the integrating World adapter. No guest data is used.

const packetNames = [
  'render',
  'bounds',
  'skin',
  'notify',
  'focus',
  'release',
  'enabled',
  'shown',
  'alpha',
  'rebuild',
  'touch',
  'unconsumed',
];
const notify27 = Object.freeze({ message: 27 }),
  updateBounds = Object.freeze({ updateBounds: true }),
  originBounds = Object.freeze({ updateBounds: true, originOnly: true }),
  clearBounds = Object.freeze({ clear: true });
function div32(value, divisor) {
  value |= 0;
  divisor |= 0;
  if (divisor === 0 || (value === -2147483648 && divisor === -1))
    throw new RangeError('Control geometry reaches an undefined native integer division');
  return Math.trunc(value / divisor) | 0;
}
function abs32(value) {
  value |= 0;
  if (value === -2147483648)
    throw new RangeError('Control range reaches the undefined abs(INT_MIN) boundary');
  return Math.abs(value);
}
function total(state) {
  return abs32((state.maximum - state.minimum) | 0);
}
function extent(state) {
  return state.kind === 42 ? total(state) : (total(state) - state.pageSize) | 0;
}
function axis(state) {
  return state.kind === 40 ? Number(state.direction === 0) : state.direction;
}
function origin(state, dimension) {
  return dimension ? state.top : state.left;
}
function clampPixel(state, value) {
  value |= 0;
  if (value < state.pixelMinimum) return state.pixelMinimum;
  if (value > state.pixelMaximum) return state.pixelMaximum;
  return value;
}
function knownPart(state, part, pressing = false) {
  return state.kind === 40
    ? part === 'track' ||
        part === 'decrement' ||
        part === 'increment' ||
        part === 'thumb' ||
        (!pressing && part === 'external')
    : part === 'track' || part === 'thumb';
}

// Signed multiply/divide order is intentional. In particular SLIDER multiplies
// value*travel before division; SCROLL and SCROLL2 quantize a step first.
export function snapControlValue(state) {
  const limit = extent(state);
  if (state.value <= 0) {
    state.value = 0;
    state.pixel = 0;
  } else if (state.value >= limit) {
    state.value = limit;
    state.pixel = state.pixelMaximum;
  } else if (state.kind === 42) {
    state.pixel = div32(
      div32(
        Math.imul(
          Math.imul(100, state.value),
          abs32((state.pixelMaximum - state.pixelMinimum) | 0),
        ),
        limit,
      ),
      100,
    );
  } else {
    const step = div32(Math.imul(100, (state.trackLength - state.thumbLength) | 0), limit);
    state.pixel = div32(Math.imul(state.value, step), 100);
  }
}
export function quantizeControlPixel(state) {
  const limit = extent(state);
  if (state.kind !== 42 && limit === 0) return 0;
  const travel =
      state.kind === 42
        ? abs32((state.pixelMaximum - state.pixelMinimum) | 0)
        : (state.trackLength - state.thumbLength) | 0,
    step = div32(Math.imul(100, travel), limit),
    pixel = Math.imul(100, state.pixel);
  const half = div32(step, 2);
  if (limit <= 0 || pixel < half) return 0;
  if (step <= 0) return limit;
  // This is the original half-threshold loop in constant time. For N>0,
  // step=trunc(B/N) where B is the signed int32 product 100*travel.
  // The checked thresholds h+k*step (0<=k<N, h=trunc(step/2)) lie between
  // 0 and B for both signs of step, since N*abs(step)<=abs(B). Therefore
  // none can wrap; only the unused increment after the last check may wrap.
  // With step<=0 a successful first comparison succeeds for every remainder.
  return Math.min(limit, Math.floor((pixel - half) / step) + 1);
}

export function createControlTaskState(kind) {
  if (kind !== 40 && kind !== 41 && kind !== 42)
    throw new RangeError(`Unsupported control task kind ${kind}`);
  return {
    kind,
    loaded: false,
    direction: 0,
    minimum: 0,
    maximum: kind === 41 ? 10 : 0,
    pageSize: kind === 41 ? 4 : 0,
    value: 0,
    pixel: 0,
    pixelMinimum: 0,
    pixelMaximum: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    planeX: 0,
    planeY: 0,
    trackStart: 0,
    trackLength: 0,
    thumbLength: 0,
    minimumThumb: 0,
    dragging: false,
    pressLocalX: 0,
    pressLocalY: 0,
    pressPixel: 0,
    repeatPart: null,
    nextRepeat: 0,
    state: 0,
    partStates: [0, 0, 0],
    alpha: 255,
    shown: true,
    enabled: true,
    inside: false,
    skinTable: [0, 0, 2, 3],
  };
}

export class ControlTaskModel {
  // service(operation, borrowedPacket, state) must consume packet fields before
  // awaiting/re-entering the same operation. Each operation has its own packet.
  // Snapshot the state and the adapter's resource/child IDs separately.
  constructor(kind, service, state = createControlTaskState(kind)) {
    if (kind !== 40 && kind !== 41 && kind !== 42)
      throw new RangeError(`Unsupported control task kind ${kind}`);
    if (state.kind !== kind) throw new TypeError('Control snapshot task kind mismatch');
    if (typeof service !== 'function') throw new TypeError('A control child service is required');
    this.state = state;
    this.service = service;
    this.packets = new Map(
      packetNames.map((name) => [
        name,
        {
          kind,
          part: null,
          value: 0,
          pixel: 0,
          x: 0,
          y: 0,
          thumbLength: 0,
          trackLength: 0,
          direction: 0,
          updateBounds: false,
          originOnly: false,
          clear: false,
          state: 0,
          frame: 0,
          flag: false,
          message: 0,
          alpha: 255,
        },
      ]),
    );
  }
  async emit(operation, part = null, options = null) {
    const s = this.state,
      p = this.packets.get(operation);
    p.part = part;
    p.value = s.value;
    p.alpha = s.alpha;
    p.pixel = s.pixel;
    p.direction = s.direction;
    p.thumbLength = s.thumbLength;
    p.trackLength = s.trackLength;
    p.updateBounds = options?.updateBounds ?? false;
    p.originOnly = options?.originOnly ?? false;
    p.clear = options?.clear ?? false;
    p.flag = options?.flag ?? false;
    p.message = options?.message ?? 0;
    p.state = options?.state ?? s.state;
    p.frame = options?.frame ?? 0;
    const d = axis(s),
      pixel = p.originOnly ? 0 : s.pixel;
    p.x = (s.left + s.planeX + (d === 0 ? pixel : 0)) | 0;
    p.y = (s.top + s.planeY + (d === 1 ? pixel : 0)) | 0;
    await this.service(operation, p, s);
  }
  recomputePage() {
    const s = this.state;
    if (s.kind === 42) return;
    const range = total(s);
    if (range <= s.pageSize) {
      s.thumbLength = s.trackLength;
      s.pixelMaximum = s.kind === 40 ? s.trackStart : s.pixelMinimum;
    } else {
      let length = div32(Math.imul(s.pageSize, s.trackLength), range);
      if (s.kind === 41 && length < s.minimumThumb) length = s.minimumThumb;
      s.thumbLength = length;
      s.pixelMaximum = (s.trackLength - length) | 0;
    }
    if (s.kind === 40) {
      s.value = 0;
      snapControlValue(s);
    }
  }
  // Only decoded geometry is accepted: this is not a replacement for HG image
  // loading or SCROLL's three mandatory metadata frames. A resource service
  // supplies trackStart/Length (40), minimumThumb (41), or thumbLength (42).
  async loadGeometry(geometry) {
    const s = this.state,
      rect = geometry.rect;
    if (s.kind === 40) {
      if (geometry.direction !== 0 && geometry.direction !== 1)
        throw new RangeError('SCROLL TYPE requires recovered direction 0 or 1');
      if (!Number.isInteger(geometry.trackStart) || !Number.isInteger(geometry.trackLength))
        throw new TypeError('SCROLL requires decoded trackStart/trackLength metadata');
      s.direction = geometry.direction;
      s.left = geometry.x | 0;
      s.top = geometry.y | 0;
      s.trackStart = geometry.trackStart | 0;
      s.trackLength = geometry.trackLength | 0;
    } else {
      if (!rect || rect.length !== 4) throw new TypeError('A control rectangle is required');
      if (s.kind === 41 && !Number.isInteger(geometry.minimumThumb))
        throw new TypeError('SCROLL2 requires decoded cap dimensions');
      if (s.kind === 42 && !Number.isInteger(geometry.thumbLength))
        throw new TypeError('SLIDER requires the decoded frame-0 thumb length');
      s.left = rect[0] | 0;
      s.top = rect[1] | 0;
      s.right = rect[2] | 0;
      s.bottom = rect[3] | 0;
      const width = (s.right - s.left) | 0,
        height = (s.bottom - s.top) | 0;
      s.direction = Number(width < height);
      s.trackLength = abs32(s.direction ? height : width);
      s.minimumThumb = geometry.minimumThumb | 0;
      if (s.kind === 42) {
        s.thumbLength = geometry.thumbLength | 0;
        s.pixelMaximum = ((s.direction ? height : width) - s.thumbLength) | 0;
      }
    }
    s.pixelMinimum = 0;
    s.planeX = geometry.planeX | 0;
    s.planeY = geometry.planeY | 0;
    this.recomputePage();
    s.loaded = true;
    await this.emit('render', null, s.kind === 40 ? updateBounds : originBounds);
  }
  async setRange(minimum, maximum, pageSize = this.state.pageSize) {
    const s = this.state;
    s.minimum = minimum | 0;
    s.maximum = maximum | 0;
    if (s.kind === 42) return; // 362 does not rebuild/reset either pixel or value.
    s.pageSize = pageSize | 0;
    this.recomputePage();
    if (s.kind === 41) {
      await this.emit('rebuild');
      if (s.loaded) await this.emit('render', null, originBounds);
    } else if (s.loaded) await this.emit('render', null, updateBounds);
  }
  async setValue(value, notify = false) {
    const s = this.state;
    s.value = value | 0;
    if (s.kind !== 40) {
      if (s.value < s.minimum) s.value = s.minimum;
      if (s.value > s.maximum) s.value = s.maximum;
    }
    if (s.kind === 40 || !s.dragging) snapControlValue(s);
    await this.emit('render', null, s.kind === 40 || !s.dragging ? updateBounds : null);
    if (notify) await this.emit('notify', null, notify27);
    if (s.kind === 40) await this.emit('release');
  }
  async skin(part, value) {
    const s = this.state;
    if ((s.kind === 40 || s.kind === 42) && !s.loaded) return false;
    if (s.kind === 40) {
      const index = part === 'decrement' ? 0 : part === 'increment' ? 1 : part === 'thumb' ? 2 : -1;
      if (index < 0) return false;
      s.partStates[index] = value;
    } else s.state = value;
    await this.emit('skin', part, { state: value });
    return true;
  }
  async setEnabled(value) {
    const s = this.state;
    s.enabled = (value | 0) !== 0;
    if (s.kind === 42) await this.skin('thumb', s.enabled ? 0 : 1);
    await this.emit('enabled', null, { flag: s.enabled });
  }
  async setShown(value) {
    const s = this.state;
    s.shown = (value | 0) !== 0;
    if (s.kind === 40) {
      // 354 toggles areas as well as planes. 355 may change them again later.
      s.enabled = s.shown;
      if (!s.shown) s.repeatPart = null;
      await this.emit('shown', null, { flag: s.shown });
      await this.emit('enabled', null, { flag: s.shown });
      return;
    }
    if (s.loaded) await this.emit('shown', null, { flag: s.shown });
  }
  async setAlpha(value) {
    this.state.alpha = value | 0;
    await this.emit('alpha');
  }
  setTable(slot, frame) {
    if (this.state.kind === 40 || slot >>> 0 > 3) return false;
    this.state.skinTable[slot >>> 0] = frame | 0;
    return true;
  }
  async reselectSkin() {
    if (this.state.kind === 40) return false;
    await this.skin('thumb', this.state.state);
    return true;
  }
  async unconsumed(part) {
    await this.emit('unconsumed', part);
    return false;
  }
  async step(delta) {
    const s = this.state;
    if ((delta < 0 && s.value <= 0) || (delta > 0 && s.value >= ((s.maximum - s.pageSize) | 0)))
      return false;
    s.value = (s.value + delta) | 0;
    snapControlValue(s);
    await this.emit('render', null, updateBounds);
    await this.emit('notify', null, notify27);
    return true;
  }
  async press(part, pointer, frame, source = 2, button = 0) {
    const s = this.state;
    if (!(source & 2) || !knownPart(s, part, true)) return this.unconsumed(part);
    if (button !== 0) {
      if (s.kind !== 40 || (button !== 8 && button !== 9)) return this.unconsumed(part);
      await this.step(button === 8 ? -1 : 1);
      return true;
    }
    if (s.kind === 40) {
      await this.skin(part, 3);
      if (part === 'decrement' || part === 'increment') {
        await this.step(part === 'decrement' ? -1 : 1);
        s.repeatPart = part;
        s.nextRepeat = ((frame >>> 0) + 30) >>> 0;
        return true;
      }
    }
    const d = axis(s);
    if (part === 'track') {
      if (s.kind === 42) {
        s.pixel = clampPixel(s, ((pointer[d] | 0) - div32(s.thumbLength, 2) - origin(s, d)) | 0);
        s.value = quantizeControlPixel(s);
        snapControlValue(s);
      } else {
        const before =
          (pointer[d] | 0) < ((origin(s, d) + (s.kind === 40 ? s.trackStart : 0) + s.pixel) | 0);
        s.value = before
          ? Math.max(0, (s.value - s.pageSize) | 0)
          : Math.min((s.maximum - s.pageSize) | 0, (s.value + s.pageSize) | 0);
        snapControlValue(s);
      }
      await this.emit('render', null, updateBounds);
      await this.emit('notify', null, notify27);
      if (s.kind !== 42) return true;
    }
    if (s.kind !== 42 && s.pixelMinimum >= s.pixelMaximum) return true;
    if (s.kind !== 40) await this.skin('thumb', 3);
    s.dragging = true;
    await this.emit('bounds', 'thumb', clearBounds);
    // Input already owns the capture. Message 125 reads its current pointer;
    // it is not a request to create another capture.
    s.pressLocalX = ((pointer[0] | 0) - s.left) | 0;
    s.pressLocalY = ((pointer[1] | 0) - s.top) | 0;
    s.pressPixel = s.pixel;
    return true;
  }
  async move(pointer) {
    const s = this.state;
    if (!s.dragging) return false;
    const d = axis(s),
      previous = s.value,
      anchor = d ? s.pressLocalY : s.pressLocalX;
    s.pixel = clampPixel(s, ((pointer[d] | 0) + s.pressPixel - anchor - origin(s, d)) | 0);
    s.value = quantizeControlPixel(s);
    await this.emit('render'); // Deliberately no snap and no bounds restoration.
    if (previous !== s.value) await this.emit('notify', null, notify27);
    return true;
  }
  async release(part, source = 2, button = 0) {
    const s = this.state;
    if (!(source & 2) || !knownPart(s, part, true)) return this.unconsumed(part);
    if (s.kind === 40 && (await this.skin(part, 0))) await this.emit('release');
    if (button !== 0) return this.unconsumed(part);
    const endsDrag = part === 'thumb' || (s.kind === 42 && part === 'track' && s.dragging);
    if (endsDrag) {
      if (s.kind !== 40) {
        await this.skin('thumb', 0);
        await this.emit('release');
      }
      s.dragging = false;
      await this.emit('bounds', 'thumb');
      s.value = quantizeControlPixel(s);
      snapControlValue(s);
      await this.emit('render', null, updateBounds);
    }
    if (s.kind === 40) {
      s.repeatPart = null;
      if (part === 'decrement' || part === 'increment') s.nextRepeat = 0;
    }
    return true; // No FES27 on any release path.
  }
  async focus(part, value, pointer) {
    const s = this.state;
    if (!knownPart(s, part)) return this.unconsumed(part);
    const focused = (value | 0) !== 0;
    if (s.kind === 40 || (part === 'thumb' && !s.dragging)) await this.skin(part, focused ? 2 : 0);
    if (s.kind === 40 && !focused) s.repeatPart = null;
    if (s.kind === 42) {
      const x = pointer[0] | 0,
        y = pointer[1] | 0,
        inside = x >= s.left && x < s.right && y >= s.top && y < s.bottom;
      if (inside !== s.inside) {
        s.inside = inside;
        await this.emit('focus', part, { flag: inside, message: 28 });
      }
    } else await this.emit('focus', part, { flag: focused, message: 28 });
    return true;
  }
  async touch(part) {
    await this.emit('touch', part);
  }
  async tick(frame, active = true) {
    const s = this.state;
    if (!active || s.kind !== 40 || s.repeatPart === null || s.nextRepeat > frame >>> 0) return;
    await this.step(s.repeatPart === 'decrement' ? -1 : 1);
    s.nextRepeat = (s.nextRepeat + 5) >>> 0; // One step per tick, no catch-up loop.
  }
  snapshot() {
    return structuredClone(this.state);
  }
}
