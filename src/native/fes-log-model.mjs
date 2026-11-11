// SPDX-License-Identifier: MPL-2.0
// LOG rows remain owned by NativeDisplayLogs. This model only owns the FES
// viewport/ring/slot state and delegates real STRING children to its service.
const empty = new Uint8Array(),
  f = Math.fround,
  paletteNames = ['color', 'vcolor', 'acolor', 'vacolor', 'pcolor', 'vpcolor'],
  fields = [
    'count',
    'top',
    'head',
    'width',
    'height',
    'vramX',
    'vramY',
    'pri',
    'disp',
    'readyFlags',
    'allocationDirty',
    'positionDirty',
    'sizeDirty',
    'positionReference',
    'positionSelector',
    'sizeReference',
    'sizeSelector',
    'logHandle',
    'shiftSubX',
    'shiftSubY',
    'closed',
  ];
function requireLog(object) {
  if (object.nativeType !== 24 && object.nativeType !== 38)
    throw new TypeError('Expected LOGSTRING or LOGSTRING8');
}
function mod(value, size) {
  return ((value % size) + size) % size;
}
export function initializeFESLog(object) {
  requireLog(object);
  Object.assign(object, {
    count: 0,
    top: 0,
    head: 0,
    width: 0,
    height: 0,
    vramX: 0,
    vramY: 0,
    // Approved JS determinization of the game ctor's uninitialized top/PRI.
    // These are defined JS defaults, not asserted original ctor writes.
    pri: 0,
    disp: false,
    readyFlags: 0,
    allocationDirty: false,
    positionDirty: false,
    sizeDirty: false,
    positionReference: null,
    positionSelector: 0,
    sizeReference: null,
    sizeSelector: 0,
    logHandle: 0,
    shiftSubX: 0,
    shiftSubY: 0,
    closed: false,
    slots: null,
    positions: new Float32Array(),
    positionsReady: new Uint8Array(),
    palettes: paletteNames.map((_, i) =>
      Int32Array.from(i === 5 ? [0, 0, 0] : [-1, -16777216, -1]),
    ),
  });
  return object;
}
export function snapshotFESLog(object) {
  requireLog(object);
  const state = {};
  for (const field of fields) state[field] = object[field];
  state.slots = object.slots?.map((slot) => ({ ...slot })) ?? null;
  state.positions = object.positions.slice();
  state.positionsReady = object.positionsReady.slice();
  state.palettes = object.palettes.map((palette) => palette.slice());
  return state;
}
export function restoreFESLog(object, state) {
  requireLog(object);
  for (const field of fields) object[field] = state[field];
  object.slots = state.slots?.map((slot) => ({ ...slot })) ?? null;
  object.positions = state.positions.slice();
  object.positionsReady = state.positionsReady.slice();
  object.palettes = state.palettes.map((palette) => palette.slice());
  return object;
}

export class FESLogModel {
  constructor(object, logs, service) {
    requireLog(object);
    if (!logs?.get || !logs?.remake) throw new TypeError('A JS display-log authority is required');
    if (!service) throw new TypeError('A generated STRING child service is required');
    this.object = object;
    this.logs = logs;
    this.service = service;
    this.lineResult = { scene: empty, block: -1 };
    this.blockResult = new Int32Array(4);
    this.pathResult = new Int32Array(2);
    this.positionResult = new Int32Array(3);
    this.colorPacket = new Int32Array(3);
  }
  source() {
    return this.object.logHandle ? this.logs.get(this.object.logHandle) : null;
  }
  max() {
    return this.source()?.rows.length ?? 0;
  }
  boundBlock(rowIndex) {
    const source = this.source(),
      row = source?.rows[rowIndex];
    if (!row) return null;
    return source.blocks[(row.tag - source.blockBase) >>> 0] ?? null;
  }
  slot(displayIndex) {
    const o = this.object;
    if (!o.slots || o.count <= 0 || displayIndex >= o.count) return null;
    // The original linecolor loop does not run for negative display indices.
    return o.slots[displayIndex > 0 ? mod(o.head + displayIndex, o.count) : o.head] ?? null;
  }
  bind(handle = 0) {
    const o = this.object;
    handle >>>= 0;
    const model = handle ? this.logs.get(handle) : null;
    o.logHandle = handle;
    if (model) o.top = Math.max(0, model.rows.length - o.count);
    // Detach preserves top, cached children and disp. Binding itself never draws.
  }
  setCount(count) {
    const o = this.object;
    count |= 0;
    if (count < 0) throw new RangeError('Negative LOG COUNT has no defined allocation semantics');
    o.count = count;
    o.readyFlags |= 1;
    if (o.readyFlags === 3) o.allocationDirty = true;
  }
  setSize(width, height) {
    const o = this.object;
    o.width = width | 0;
    o.height = height | 0;
    o.readyFlags |= 2;
    if (o.readyFlags === 3) o.allocationDirty = true;
  }
  setSizeReference(name, selector = 0) {
    const o = this.object;
    o.sizeReference = String(name);
    o.sizeSelector = selector | 0;
    o.sizeDirty = true;
  }
  setPositionReference(name, selector = 0) {
    const o = this.object;
    o.positionReference = String(name);
    o.positionSelector = selector | 0;
    o.positionDirty = true;
  }
  setVRAM(x, y) {
    this.object.vramX = x | 0;
    this.object.vramY = y | 0;
  }
  async setPriority(priority) {
    const o = this.object;
    o.pri = priority | 0;
    if (!o.slots) return;
    for (const slot of o.slots) {
      if (slot.main !== null) await this.service.priority(slot.main, o.pri);
      if (slot.secondary !== null) await this.service.priority(slot.secondary, o.pri);
    }
  }
  async allocate() {
    const o = this.object;
    if (!o.allocationDirty) return false;
    // Only LOG-owned tables are replaced. Collection (name,index) insertion is
    // first wins: create() returns the existing generated element when present.
    // A smaller COUNT does not hide or destroy the unreferenced old groups.
    const slots = [],
      oldPositions = o.positions,
      oldReady = o.positionsReady,
      overlap = Math.min(o.count, oldReady.length);
    o.positions = new Float32Array(o.count * 2);
    o.positionsReady = new Uint8Array(o.count);
    // Approved deterministic replacement for uninitialized native positions:
    // retain known overlapping positions; authored POS2 is resolved again by
    // the driver, while genuinely new positions remain explicitly unresolved.
    o.positions.set(oldPositions.subarray(0, overlap * 2));
    o.positionsReady.set(oldReady.subarray(0, overlap));
    if (o.head < 0 || o.head >= o.count) o.head = 0;
    if (o.count === 0) o.disp = false;
    o.positionDirty = o.count > 0 && o.positionReference !== null;
    o.slots = slots;
    for (let index = 0; index < o.count; index++) {
      const mainName = `${o.baseName}_cs_${index}`,
        secondaryName = o.nativeType === 38 ? `${o.baseName}_cs_sub_${index}` : null,
        slot = {
          mainName,
          secondaryName,
          main: null,
          secondary: null,
          secondaryEnabled: false,
          sourceIndex: null,
          sourceAbsolute: null,
          sourceTag: null,
        };
      slots.push(slot);
      slot.main = await this.service.create({
        name: mainName,
        nativeType: o.nativeType === 38 ? 37 : 21,
        owner: 0,
        parentHandle: null,
        logObjectHandle: o.handle,
        slotIndex: index,
        secondary: false,
      });
      if (secondaryName !== null)
        slot.secondary = await this.service.create({
          name: secondaryName,
          nativeType: 37,
          owner: 0,
          parentHandle: null,
          logObjectHandle: o.handle,
          slotIndex: index,
          secondary: true,
        });
    }
    await this.configureChildren();
    o.allocationDirty = false;
    return true;
  }
  async configureChildren() {
    const o = this.object;
    if (!o.slots) return;
    for (let index = 0; index < o.slots.length; index++) {
      const slot = o.slots[index],
        // The original setter converts unsigned VRAM words to float32.
        x = f(o.vramX >>> 0),
        y = f((o.vramY + Math.imul(index, (o.height + 2) | 0)) >>> 0);
      if (slot.main !== null)
        await this.service.configure(slot.main, o.width, o.height, o.pri, x, y);
      if (slot.secondary !== null)
        await this.service.configure(
          slot.secondary,
          o.width,
          o.height,
          o.pri,
          f(x + f(o.width >>> 0)),
          y,
        );
      await this.normalColors(index);
    }
  }
  async setDisplayPosition(index, x, y) {
    const o = this.object;
    if (!o.slots || index < 0 || index >= o.count) return false;
    o.positions[index * 2] = f(x | 0);
    o.positions[index * 2 + 1] = f(y | 0);
    o.positionsReady[index] = 1;
    // The original position setter addresses physical slot[index], even with
    // a nonzero ring head. Scrolling/end-change repositions logical rows later.
    const slot = o.slots[index];
    if (slot.main !== null)
      await this.service.position(slot.main, o.positions[index * 2], o.positions[index * 2 + 1]);
    return true;
  }
  async moveSlot(displayIndex, includeSecondary) {
    const o = this.object,
      slot = this.slot(displayIndex);
    if (!slot) return;
    if (!o.positionsReady[displayIndex])
      throw new Error('LOG display position has not been resolved after allocation');
    const x = o.positions[displayIndex * 2],
      y = o.positions[displayIndex * 2 + 1];
    if (slot.main !== null) await this.service.position(slot.main, x, y);
    if (includeSecondary && slot.secondary !== null) {
      const endY = slot.main === null ? 0 : this.service.endY(slot.main);
      await this.service.position(
        slot.secondary,
        f(x + f(o.shiftSubX)),
        f(f(y + f(o.shiftSubY)) + f(endY)),
      );
    }
  }
  async colors(slot, colors) {
    if (slot.main !== null) await this.service.colors(slot.main, colors);
    if (slot.secondary !== null) await this.service.colors(slot.secondary, colors);
  }
  async normalColors(displayIndex) {
    const block = this.boundBlock((this.object.top + displayIndex) | 0),
      slot = this.slot(displayIndex);
    if (block && slot) await this.colors(slot, this.object.palettes[block[0] & 4 ? 1 : 0]);
    // Blank/out-of-range rows do not have a block; the native helper leaves
    // their existing child colors alone rather than fabricating a palette.
  }
  async reloadRow(displayIndex, show, secondaryPolicy) {
    const o = this.object,
      source = this.source(),
      slot = this.slot(displayIndex);
    if (!slot || !source) return;
    if (!o.positionsReady[displayIndex])
      throw new Error('LOG display position has not been resolved after allocation');
    const sourceIndex = (o.top + displayIndex) | 0,
      row = source.rows[sourceIndex];
    slot.sourceIndex = sourceIndex;
    slot.sourceAbsolute = row ? (source.rowBase + sourceIndex) >>> 0 : null;
    slot.sourceTag = row?.tag ?? null;
    if (slot.main !== null) {
      await this.service.source(slot.main, row?.first ?? null);
      await this.service.position(
        slot.main,
        o.positions[displayIndex * 2],
        o.positions[displayIndex * 2 + 1],
      );
      await this.normalColors(displayIndex);
      if (show) await this.service.display(slot.main, true);
      await this.service.draw(slot.main, -1);
    }
    const secondary =
      slot.secondary !== null && (secondaryPolicy === 'edge' || slot.secondaryEnabled);
    if (secondary) {
      const x = o.positions[displayIndex * 2],
        y = o.positions[displayIndex * 2 + 1],
        endY = slot.main === null ? 0 : this.service.endY(slot.main);
      await this.service.source(slot.secondary, row?.second ?? null);
      await this.service.position(
        slot.secondary,
        f(x + f(o.shiftSubX)),
        f(f(y + f(o.shiftSubY)) + f(endY)),
      );
      await this.normalColors(displayIndex);
      if (show) await this.service.display(slot.secondary, true);
      await this.service.draw(slot.secondary, -1);
    } else if (show && slot.secondary !== null) await this.service.display(slot.secondary, false);
  }
  async display(value = 1) {
    const o = this.object;
    if (!o.slots || o.count === 0 || !this.source()) return false;
    const shown = (value | 0) !== 0;
    if (!shown) {
      for (const slot of o.slots) {
        if (slot.main !== null) await this.service.display(slot.main, false);
        if (slot.secondary !== null) await this.service.display(slot.secondary, false);
      }
    } else {
      o.head = 0;
      for (let index = 0; index < o.count; index++) await this.reloadRow(index, true, 'enabled');
    }
    o.disp = shown;
    return true;
  }
  async position(top = 0) {
    const o = this.object,
      source = this.source();
    if (!source) return false;
    o.top = Math.min(Math.max(top | 0, 0), Math.max(0, source.rows.length - o.count));
    if (o.disp) await this.display(1);
    return true;
  }
  async page(delta = 0) {
    if (!this.source()) return false;
    return this.position((this.object.top + Math.imul(delta | 0, this.object.count)) | 0);
  }
  async next(delta = 1, selectionIndex = 0) {
    const o = this.object,
      source = this.source();
    if (selectionIndex === -1 || !o.slots || o.count === 0 || !source) return false;
    delta |= 0;
    if (delta === -2147483648) throw new RangeError('LOG next/rev abs(INT_MIN) is undefined');
    const candidate = Math.min(Math.max((o.top + delta) | 0, 0), source.rows.length - o.count);
    if (candidate < 0 || candidate === o.top) return false;
    o.top = candidate;
    if (Math.abs(delta) >= o.count) {
      o.head = 0;
      for (let index = 0; index < o.count; index++) await this.reloadRow(index, false, 'enabled');
    } else {
      o.head = mod(o.head + delta, o.count);
      if (delta > 0) {
        for (let index = o.count - delta; index < o.count; index++)
          await this.reloadRow(index, false, 'edge');
        for (let index = 0; index < o.count - delta; index++) await this.moveSlot(index, true);
      } else {
        for (let index = 0; index < -delta; index++) await this.reloadRow(index, false, 'edge');
        for (let index = -delta; index < o.count; index++) await this.moveSlot(index, true);
      }
    }
    return true;
  }
  rev(delta = -1, selectionIndex = 0) {
    return this.next(delta, selectionIndex); // An explicit rev argument is not negated.
  }
  positionQuery() {
    this.positionResult[0] = this.object.top;
    this.positionResult[1] = this.positionResult[2] = 0;
    return this.positionResult;
  }
  lineInfo(rowIndex) {
    const source = this.source(),
      block = this.boundBlock(rowIndex | 0);
    this.lineResult.scene = block ? (source.scenes[block[1]] ?? empty) : empty;
    this.lineResult.block = block ? block[2] | 0 : -1;
    return this.lineResult;
  }
  blockInfo(rowIndex) {
    const source = this.source(),
      index = rowIndex | 0,
      row = source?.rows[index],
      block = this.boundBlock(index),
      out = this.blockResult;
    out[0] = block ? (row.tag - source.blockBase) | 0 : -1;
    out[1] = block ? (block[3] - source.rowBase) | 0 : -1;
    out[2] = block ? (block[4] - source.rowBase) | 0 : -1;
    out[3] = block ? block[0] & 4 : 0;
    return out;
  }
  pathInfo(rowIndex) {
    const block = this.boundBlock(rowIndex | 0),
      out = this.pathResult;
    out[0] = block ? block[6] | 0 : -1;
    out[1] = block ? block[2] | 0 : -1;
    return out;
  }
  async lineColor(displayIndex, normal = 0, shadow = 0, ruby = 0) {
    const slot = this.slot(displayIndex | 0);
    if (!slot) return false;
    this.colorPacket[0] = normal | 0;
    this.colorPacket[1] = shadow | 0;
    this.colorPacket[2] = ruby | 0;
    await this.colors(slot, this.colorPacket);
    return true;
  }
  async blockColor(displayIndex, type = 0) {
    const o = this.object;
    displayIndex |= 0;
    if (!o.slots || displayIndex < 0 || displayIndex >= o.count) return false;
    const source = this.source(),
      block = this.boundBlock((o.top + displayIndex) | 0);
    if (!block) return false;
    type |= 0;
    const palette =
      type === 0
        ? block[0] & 4
          ? 1
          : 0
        : type === 1
          ? block[0] & 4
            ? 3
            : 2
          : type === 2
            ? block[0] & 4
              ? 5
              : 4
            : 0;
    for (
      let row = (block[3] - source.rowBase) | 0, end = (block[4] - source.rowBase) | 0;
      row <= end;
      row++
    ) {
      const slot = o.slots[row <= o.top ? o.head : mod(o.head + row - o.top, o.count)];
      if (slot) await this.colors(slot, o.palettes[palette]);
    }
    return true;
  }
  async layout(mode, args = [], evaluate = Number) {
    const o = this.object,
      palette = paletteNames.indexOf(mode);
    if (palette !== -1) {
      const out = o.palettes[palette];
      for (let color = 0; color < 3; color++) {
        const base = color * 3,
          r = args[base] === undefined ? 0 : evaluate(args[base]) | 0,
          g = args[base + 1] === undefined ? 0 : evaluate(args[base + 1]) | 0,
          b = args[base + 2] === undefined ? 0 : evaluate(args[base + 2]) | 0;
        out[color] = 0xff000000 | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
      }
      return { recognized: true, applied: true };
    }
    if (mode === 'shift_sub') {
      if (o.nativeType !== 38) return { recognized: true, applied: false };
      o.shiftSubX = args[0] === undefined ? 0 : evaluate(args[0]) | 0;
      o.shiftSubY = args[1] === undefined ? 0 : evaluate(args[1]) | 0;
      return { recognized: true, applied: true };
    }
    if (!this.service.supportsLayout(mode)) return { recognized: false, applied: false };
    let applied = false;
    const limit = Math.min(this.max(), o.slots?.length ?? 0);
    for (let index = 0; index < limit; index++) {
      const slot = o.slots[index];
      if (slot.main !== null)
        applied = (await this.service.layout(slot.main, mode, args, evaluate)).applied || applied;
      if (slot.secondary !== null)
        applied =
          (await this.service.layout(slot.secondary, mode, args, evaluate)).applied || applied;
    }
    return { recognized: true, applied };
  }
  async reset() {
    const o = this.object,
      limit = Math.min(this.max(), o.slots?.length ?? 0);
    for (let index = 0; index < limit; index++) {
      const slot = o.slots[index];
      if (slot.main !== null) await this.service.reset(slot.main);
      if (slot.secondary !== null) await this.service.reset(slot.secondary);
    }
  }
  async remake(mainLanguage = null, secondaryLanguage = null) {
    const o = this.object;
    if (o.nativeType !== 38) return false;
    const model = this.source();
    if (model) await this.logs.remake(model, mainLanguage, secondaryLanguage);
    if (o.slots) for (const slot of o.slots) slot.secondaryEnabled = secondaryLanguage !== null;
    return true;
  }
  async advance() {
    const o = this.object;
    if (o.nativeType !== 38 || !o.slots || o.count === 0) return;
    if (o.head < 0 || o.head >= o.count)
      throw new Error('LOG ring head is outside the new COUNT after reallocation');
    for (let index = 0; index < o.slots.length; index++) {
      const slot = o.slots[index];
      if (
        slot.main !== null &&
        slot.secondary !== null &&
        this.service.consumeEndChanged(slot.main)
      )
        await this.moveSlot(mod(index - o.head, o.count), slot.secondaryEnabled);
    }
  }
  async drive(resolveReference) {
    const o = this.object;
    if (o.closed) throw new Error('LOG model has been closed');
    if (o.sizeDirty) {
      const size = await resolveReference('size', o.sizeReference, o.sizeSelector);
      if (!size) throw new Error('LOG SIZE2 resource has no recovered rectangle');
      o.sizeDirty = false;
      this.setSize(size[2], size[3]);
    }
    await this.allocate();
    if (o.positionDirty && o.slots) {
      for (let index = 0; index < o.count; index++) {
        const rect = await resolveReference(
          'position',
          o.positionReference,
          (o.positionSelector + index) | 0,
        );
        if (!rect) throw new Error('LOG POS2 resource has no recovered rectangle');
        await this.setDisplayPosition(index, rect[0], rect[1]);
      }
      o.positionDirty = false;
    }
    await this.advance();
  }
  close() {
    // Generated STRING groups have factory owner0 and no PARENT link to LOG.
    // Their actual owner is the surrounding FES collection. Ordinary LOG delete
    // only drops its slot/position storage; complete FES teardown closes children.
    this.object.slots = null;
    this.object.positions = new Float32Array();
    this.object.positionsReady = new Uint8Array();
    this.object.closed = true;
  }
}
