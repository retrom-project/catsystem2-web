// SPDX-License-Identifier: MPL-2.0
// Native FES input/task mapping: 628D60, 629E00, 62C480, 65C750.
// Each FES BUTTON owns a real base-plane task; the low button is independent.
const packet = (words) => ({ load: (address) => words[address / 4] >>> 0 });
const valid = (object) => object?.type === 'BUTTON' && !object.deleted && object.enable;
export class FESInput {
  constructor(record, world) {
    this.record = record;
    this.world = world;
    this.state = {
      lowButton: null,
      buttons: [],
      focus: null,
      pressed: null,
      source: 0,
      sleeping: false,
      control: false,
      lowPriority: null,
    };
  }
  get input() {
    return this.world.inputFor(this.record.id);
  }
  get player() {
    return this.record.implementation.player;
  }
  get instance() {
    return this.player?.root;
  }
  bounds(object) {
    const id = this.state.buttons.find(([key]) => key === object.key)?.[1],
      region = id == null ? null : this.input.get(id);
    return region ? [...region.bounds] : null;
  }
  async updateMouse() {
    // 62D9A0 queries 152 (outside-window), then 125 (virtual coordinates).
    const outside = await this.input.message(152);
    if (!Number.isInteger(outside))
      throw new Error('FES mouse gate requires native input message 152');
    if (outside) this.player.mouse = { x: -2147483648, y: -2147483648 };
    else {
      const coordinates = new Map();
      await this.input.message(125, 0, 4, {
        payload: { store: (address, value) => coordinates.set(address, value | 0) },
      });
      if (!coordinates.has(0) || !coordinates.has(4))
        throw new Error('FES virtual coordinates require both native input message 125 outputs');
      this.player.mouse = { x: coordinates.get(0), y: coordinates.get(4) };
    }
  }
  depth() {
    let depth = 1,
      parent = this.world.objects.objects.get(this.record.parent);
    while (parent && parent.kind !== 1) {
      depth++;
      parent = this.world.objects.objects.get(parent.parent);
    }
    return depth;
  }
  async tick() {
    if (!this.instance) return;
    this.player.nativeInput = this;
    await this.updateMouse();
    const control = Array.from({ length: 4 }, (_, i) => this.input.keys?.[12 * 4 + i] || 0).some(
      Boolean,
    );
    if (control !== this.state.control) {
      this.state.control = control;
      this.instance.skipControl = control;
      this.instance.skipPressed = control;
      this.instance.clickL = control ? -1 : 0;
    }
    if (this.state.focus && !valid(this.instance.byKey.get(this.state.focus)))
      this.state.focus = null;
    await this.sync();
  }
  async initializeLowButton() {
    const owner = this.record.id;
    if (this.state.lowButton === null && !this.state.lowDeleted) {
      this.state.lowButton = await this.world.objects.create({
        kind: 6,
        parent: owner,
        creator: owner,
        name: 'low button',
      });
      await this.world.graphics.send(
        this.state.lowButton,
        owner,
        89,
        0,
        0,
        packet([0, 0, this.world.game.width, this.world.game.height, this.depth(), 0]),
      );
    }
    return this.state.lowButton;
  }
  async sync() {
    if (!this.instance) return;
    const { graphics } = this.world,
      owner = this.record.id;
    await this.initializeLowButton();
    if (this.state.lowButton !== null) {
      const region = this.input.get(this.state.lowButton);
      if (region) {
        const priority = this.state.lowPriority ?? this.depth(),
          enabled = !this.state.sleeping;
        if (region.priority !== priority || region.enabled !== enabled) this.input.changed = true;
        region.priority = priority;
        region.enabled = enabled;
      }
    }
    const current = new Set(
      this.instance.objects
        .filter((object) => object.type === 'BUTTON' && !object.deleted)
        .map((o) => o.key),
    );
    for (const [key, id] of [...this.state.buttons])
      if (!current.has(key)) {
        await this.world.objects.destroy(id, owner);
        this.state.buttons = this.state.buttons.filter(([k]) => k !== key);
      }
    for (const object of this.instance.objects.filter((o) => current.has(o.key))) {
      const pair = await this.initializeObject(object);
      if (this.player.nativeImages?.supports(object)) continue;
      const id = pair[1],
        rect = this.instance.rect(object),
        bounds = rect
          ? [rect.x | 0, rect.y | 0, (rect.x + rect.w) | 0, (rect.y + rect.h) | 0]
          : [0, 0, 0, 0];
      const signature = JSON.stringify([
        bounds,
        object.pri,
        object.fullInput,
        object.enable,
        this.state.sleeping,
        object.hitTransparent,
        object.nativeImageHandle,
        object.lockedRect,
      ]);
      if (pair[2] === signature) continue;
      const created = await graphics.send(
        id,
        owner,
        89,
        0,
        0,
        packet([...bounds, (object.pri + 100) | 0, 0]),
      );
      if (!created && !object.lockedRect) await graphics.send(id, owner, 100, 0, 0, packet(bounds));
      const region = this.input.get(id);
      if (!region) throw new Error(`FES button ${object.key} has no input region`);
      region.priority = object.fullInput ? 100000 : (object.pri + 100) | 0;
      await graphics.send(id, owner, 92, 0, Number(object.enable && !this.state.sleeping));
      if (object.hitTransparent && object.nativeImageHandle)
        await graphics.send(id, owner, 97, 0, object.nativeImageHandle);
      else region.alpha = null;
      pair[2] = signature;
    }
  }
  async initializeObject(object) {
    let pair = this.state.buttons.find(([key]) => key === object.key);
    if (!pair) {
      const id = await this.world.objects.create({
        kind: 6,
        parent: this.record.id,
        creator: this.record.id,
        name: 'FE Button',
      });
      pair = [object.key, id];
      this.state.buttons.push(pair);
    }
    object.nativeInputTaskID = pair[1];
    return pair;
  }
  async propagation(sender, handled) {
    if (!handled)
      await this.world.graphics.send(
        sender,
        this.record.id,
        94,
        0,
        this.instance.inputPropagation ?? 1,
      );
  }
  async event(key, event) {
    const handled = await this.player.nativeEvent(key, event);
    await this.player.flush();
    return handled;
  }
  async focus(key) {
    if (this.state.focus === key) return;
    const old = this.state.focus;
    this.state.focus = key;
    if (old) await this.event(old, 'UNFOCUS');
    if (key) await this.event(key, 'FOCUS');
    this.player.focused = key ? { s: this.instance, o: this.instance.byKey.get(key) } : null;
  }
  async move(direction) {
    let current = this.instance.byKey.get(this.state.focus);
    if (!valid(current)) {
      const hovered = this.state.buttons.find(
        ([key, id]) =>
          valid(this.instance.byKey.get(key)) && this.input.hit(this.input.get(id), false),
      );
      current = hovered
        ? this.instance.byKey.get(hovered[0])
        : this.instance.byKey.get(this.instance.defaultButton);
      if (!valid(current)) return false;
      await this.focus(current.key);
      await this.warp(current);
      return true;
    }
    const directionIndex = { up: 0, down: 1, left: 2, right: 3 }[direction];
    await this.event(current.key, `PUSH_${direction.toUpperCase()}`);
    if (!current.keyblock) return false;
    const horizontal = directionIndex >= 2,
      step = directionIndex % 2 ? 1 : -1,
      seen = new Set();
    let { block, x, y } = current.keyblock;
    const all = this.instance.objects.filter(valid),
      blocks = this.instance.program.keyblocks;
    for (let iteration = 0; iteration < 10000; iteration++) {
      const area = blocks[block];
      if (!area) return false;
      if (horizontal) x += step;
      else y += step;
      if (x < 0 || y < 0 || x >= area.width || y >= area.height) {
        const nextBlock = area.links[directionIndex],
          next = blocks[nextBlock];
        if (!next) return false;
        block = nextBlock;
        x = horizontal ? (step > 0 ? 0 : next.width - 1) : Math.min(x, next.width - 1);
        y = horizontal ? Math.min(y, next.height - 1) : step > 0 ? 0 : next.height - 1;
      }
      const position = `${block},${x},${y}`;
      if (seen.has(position)) return false;
      seen.add(position);
      const cross = horizontal ? y : x,
        extent = horizontal ? blocks[block].height : blocks[block].width;
      for (let distance = 0; distance < extent; distance++)
        for (const other of distance ? [cross - distance, cross + distance] : [cross]) {
          if (other < 0 || other >= extent) continue;
          const target = all.find(
            (o) =>
              o.keyblock?.block === block &&
              o.keyblock.x === (horizontal ? x : other) &&
              o.keyblock.y === (horizontal ? other : y),
          );
          if (target) {
            await this.focus(target.key);
            await this.warp(target);
            return true;
          }
        }
    }
    throw new Error('FES KEYBLOCK navigation instruction budget');
  }
  async warp(object) {
    const rect = this.instance.rect(object);
    if (!rect) return;
    const x = (rect.x + (object.keyPosition?.x ?? 0)) | 0,
      y = (rect.y + (object.keyPosition?.y ?? 0)) | 0;
    this.input.pointer(x, y);
    this.player.mouse = { x, y };
    for (const region of this.input.regions) region.active = false;
    const id = this.state.buttons.find(([key]) => key === object.key)?.[1],
      region = id === undefined ? null : this.input.get(id);
    if (region) region.active = true;
  }
  async message([sender, message, w, l], context = {}) {
    if (!this.instance) return 1;
    sender =
      context.nativeSenderWorldID ??
      (this.world.resolveTaskID ? this.world.resolveTaskID(sender, this.record.id) : sender);
    if ([64, 65].includes(message) && this.world.resolveTaskID)
      w = this.world.resolveTaskID(w, this.record.id);
    await this.updateMouse();
    switch (message) {
      case 64: {
        if (this.state.sleeping) return 0;
        const pair = this.state.buttons.find(([, id]) => w != null && id === w >>> 0);
        if (l) {
          await this.focus(pair?.[0] ?? null);
        } else if (pair?.[0] === this.state.focus) await this.focus(null);
        await this.sync();
        return 0;
      }
      case 9: {
        this.state.source = this.input.source;
        this.instance.inputSource = this.state.source;
        if (this.state.sleeping) {
          await this.propagation(sender, false);
          return 0;
        }
        const focused = this.instance.byKey.get(this.state.focus),
          key = valid(focused) ? focused.key : null;
        this.state.pressed = key;
        let handled = false;
        if (l === 0 || l === 1) handled = await this.event(key, l ? 'PUSH_R' : 'PUSH_L');
        else if (l >= 4 && l <= 7)
          handled = await this.move(['up', 'down', 'left', 'right'][l - 4]);
        else if (l >= 8 && l <= 11)
          handled = await this.event(key, ['SCRL_U', 'SCRL_D', 'PAGE_U', 'PAGE_D'][l - 8]);
        else
          for (const object of this.instance.objects.filter(valid))
            if (object.hotkey === l) handled = (await this.event(object.key, 'PUSH_L')) || handled;
        await this.propagation(sender, handled);
        await this.sync();
        return 0;
      }
      case 10: {
        this.state.source = 0;
        let handled = false;
        if (!this.state.sleeping) {
          if (l === 0 || l === 1)
            handled = await this.event(this.state.pressed, l ? 'RELEASE_R' : 'RELEASE_L');
          else if (l >= 4 && l <= 7)
            handled = await this.event(
              this.state.pressed,
              `RELEASE_${['UP', 'DOWN', 'LEFT', 'RIGHT'][l - 4]}`,
            );
        }
        await this.propagation(sender, handled);
        await this.sync();
        return 0;
      }
      case 65: {
        const pair = this.state.buttons.find(([, id]) => w != null && id === w >>> 0);
        const handled = !this.state.sleeping && pair ? await this.event(pair[0], 'TOUCH') : false;
        await this.propagation(sender, handled);
        await this.sync();
        return 0;
      }
      default:
        return 1;
    }
  }
  async priority(value = -1) {
    this.state.lowPriority = value === -1 ? null : value | 0;
    await this.sync();
  }
  async deleteLowButton() {
    if (this.state.lowButton !== null)
      await this.world.objects.destroy(this.state.lowButton, this.record.id);
    this.state.lowButton = null;
    this.state.lowDeleted = true;
  }
  snapshot() {
    return structuredClone(this.state);
  }
  restore(state) {
    this.state = structuredClone(state);
    if (this.player) this.player.nativeInput = this;
  }
  async close() {
    for (const id of [this.state.lowButton, ...this.state.buttons.map(([, id]) => id)])
      if (id !== null) await this.world.objects.release(id);
    this.state.buttons = [];
    this.state.lowButton = null;
  }
}
