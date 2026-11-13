// SPDX-License-Identifier: MPL-2.0
// Native FES input/task mapping: 628D60, 629E00, 62C480, 65C750.
// Each FES BUTTON owns a real base-plane task; the low button is independent.
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import {
  navigateFESButton,
  fesButtonCursorPoint,
  findFESInitialButton,
} from './fes-button-navigation.mjs';
const packet = (words) => new NativeGraphicsPacket(words);
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
      activeLock: 0,
      savedMouse: null,
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
  referenceFor(object) {
    if (this.instance.collection) return this.instance.collection.reference(object);
    // The direct JS-authored FESPlayer API retains its explicit CP932 name boundary.
    return { nameBytes: new Uint8Array(encodeCP932(object.baseName)), index: object.index ?? 0 };
  }
  referenceObject(reference) {
    if (!reference?.nameBytes.length || !this.instance) return null;
    if (this.instance.collection)
      return this.instance.collection.lookup(reference.nameBytes, reference.index);
    const name = new TextDecoder('shift_jis').decode(reference.nameBytes);
    return (
      this.instance.objects.find(
        (object) => object.baseName === name && (object.index ?? 0) === reference.index,
      ) ?? null
    );
  }
  get focused() {
    const object = this.referenceObject(this.state.focus);
    return object ? { s: this.instance, o: object } : null;
  }
  setFocusTarget(target) {
    if (target && target.s !== this.instance) throw new Error('FES focus has a different owner');
    this.state.focus = target ? this.referenceFor(target.o) : null;
  }
  bounds(object) {
    const id = this.state.buttons.find(([key]) => key === object.key)?.[1],
      region = id == null ? null : this.input.get(id);
    return region ? [...region.bounds] : null;
  }
  async updateMouse() {
    const player = this.player,
      instance = this.instance,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !instance?.runtime?.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live()) return;
    const input = this.input;
    // 62D9A0 queries 152 (outside-window), then 125 (virtual coordinates).
    const outside = await input.message(152);
    if (!live()) return;
    if (!Number.isInteger(outside))
      throw new Error('FES mouse gate requires native input message 152');
    if (outside) player.mouse = { x: -2147483648, y: -2147483648 };
    else {
      const coordinates = new Map();
      await input.message(125, 0, 4, {
        payload: { store: (address, value) => coordinates.set(address, value | 0) },
      });
      if (!live()) return;
      if (!coordinates.has(0) || !coordinates.has(4))
        throw new Error('FES virtual coordinates require both native input message 125 outputs');
      player.mouse = { x: coordinates.get(0), y: coordinates.get(4) };
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
    const focused = this.referenceObject(this.state.focus);
    if (focused?.nativeType === 6 && !focused.enable) this.state.focus = null;
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
    // Canonical FES resource entries own all Button allocations and delayed
    // cleanup. This map only borrows the latest child selected by each key.
    if (this.instance.runtime) return;
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
  registerObject(object, taskID) {
    const pair = [object.key, taskID];
    this.state.buttons = this.state.buttons.filter(([key]) => key !== object.key);
    this.state.buttons.push(pair);
    object.nativeInputTaskID = taskID;
    return pair;
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
    const current = this.referenceObject(this.state.focus),
      target = key == null ? null : this.instance.byKey.get(key),
      reference = target ? this.referenceFor(target) : null,
      old = this.state.focus;
    if (
      reference === null
        ? old === null
        : old &&
          old.index === reference.index &&
          old.nameBytes.length === reference.nameBytes.length &&
          old.nameBytes.every((byte, at) => byte === reference.nameBytes[at])
    )
      return;
    this.state.focus = reference;
    if (current) await this.event(current.key, 'UNFOCUS');
    if (target) await this.event(target.key, 'FOCUS');
  }
  async consumeActiveReference(reference) {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live()) return;
    const top = this.world.engineMessages.closestTop(this.record),
      inputID = top?.implementation.input;
    if (this.world.objects.objects.get(inputID)?.kind !== 11)
      throw new Error('FES setact requires its owning Top Input task');
    const input = (active) =>
        this.world.engineMessages.dispatch(inputID, this.record.id, 93, 0, active, { flags: 1 }),
      event = (ref, name) => {
        const object = this.referenceObject(ref);
        return object ? instance.dispatchEvent(object, name) : false;
      };
    try {
      await this.updateMouse();
      if (!live()) return;
      const old = this.state.focus;
      if (old?.nameBytes.length) {
        await input(0);
        if (!live()) return;
        await event(old, 'UNFOCUS');
        if (!live()) return;
      }
      this.state.focus = reference;
      if (reference === null) {
        await this.world.engineMessages.dispatch(inputID, this.record.id, 145, 0, 1, { flags: 1 });
      } else if (reference.nameBytes.length) {
        await input(1);
        if (!live()) return;
        await event(reference, 'FOCUS');
      }
    } catch (error) {
      if (live()) throw error;
    }
  }
  async consumeAutoMove({ x, y }) {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live() || !this.world.fesConfiguration.get('autocur')) return;
    const top = this.world.engineMessages.closestTop(this.record),
      inputID = top?.implementation.input;
    if (this.world.objects.objects.get(inputID)?.kind !== 11)
      throw new Error('FES automove requires its owning Top Input task');
    const point = new Int32Array(2);
    let written = 0;
    try {
      await this.world.engineMessages.dispatch(inputID, this.record.id, 125, 0, 4, {
        flags: 0,
        payload: {
          store: (address, value) => {
            if (address !== 0 && address !== 4)
              throw new RangeError('FES automove output is outside its two initialized words');
            point[address >>> 2] = value | 0;
            written |= address === 0 ? 1 : 2;
            // The constructor's original output is not known. Only an actual
            // complete Input writer establishes this owner's saved point.
            if (written === 3) this.state.savedMouse = Array.from(point);
          },
        },
      });
      if (!live()) return;
      if (written !== 3) throw new Error('FES automove requires both native Input125 outputs');
      await this.world.engineMessages.dispatch(
        inputID,
        this.record.id,
        137,
        4,
        ((x & 65535) | ((y & 65535) << 16)) >>> 0,
        { flags: 0 },
      );
    } catch (error) {
      if (live()) throw error;
    }
  }
  async consumeButtonSimulation({ index, value }) {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live()) return;
    const top = this.world.engineMessages.closestTop(this.record),
      inputID = top?.implementation.input;
    if (this.world.objects.objects.get(inputID)?.kind !== 11)
      throw new Error('FES btnsimulate requires its owning Top Input task');
    try {
      await this.world.engineMessages.dispatch(inputID, this.record.id, 154, index, value, {
        flags: 0,
      });
    } catch (error) {
      if (live()) throw error;
    }
  }
  async consumeRestoreMove() {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live() || !this.world.fesConfiguration.get('autocur')) return;
    const point = this.state.savedMouse;
    if (point === null)
      throw new Error('FES restoremove requires a known complete saved mouse point');
    // The original consumer reads Y then X here, not when the record is queued.
    const y = point[1] & 65535,
      x = point[0] & 65535,
      top = this.world.engineMessages.closestTop(this.record),
      inputID = top?.implementation.input;
    if (this.world.objects.objects.get(inputID)?.kind !== 11)
      throw new Error('FES restoremove requires its owning Top Input task');
    try {
      await this.world.engineMessages.dispatch(
        inputID,
        this.record.id,
        137,
        4,
        (x | (y << 16)) >>> 0,
        { flags: 0 },
      );
    } catch (error) {
      if (live()) throw error;
    }
  }
  async consumeReact() {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live() || !this.state.focus?.nameBytes.length) return;
    try {
      await this.updateMouse();
      if (!live()) return;
      const top = this.world.engineMessages.closestTop(this.record),
        inputID = top?.implementation.input;
      if (this.world.objects.objects.get(inputID)?.kind !== 11)
        throw new Error('FES react requires its owning Top Input task');
      await this.world.engineMessages.dispatch(inputID, this.record.id, 93, 0, 1, { flags: 1 });
      if (!live()) return;
      // The native consumer reads the current name/index after the Input query.
      const object = this.referenceObject(this.state.focus);
      if (object) await instance.dispatchEvent(object, 'FOCUS');
    } catch (error) {
      if (live()) throw error;
    }
  }
  async consumeRelease(sender, keyIndex, context) {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live()) return 0;
    this.state.source = 0;
    try {
      if (this.state.sleeping) {
        await this.propagation(sender, false);
        return 0;
      }
      await this.updateMouse();
      if (!live()) return 0;
      const key = this.state.pressed,
        event =
          keyIndex === 0
            ? 'RELEASE_L'
            : keyIndex === 1
              ? 'RELEASE_R'
              : keyIndex >= 4 && keyIndex <= 7
                ? `RELEASE_${['UP', 'DOWN', 'LEFT', 'RIGHT'][keyIndex - 4]}`
                : null;
      let handled = false;
      if (event !== null && (key === null || instance.byKey.has(key))) {
        handled = await player.nativeEvent(key, event);
        if (!live()) return 0;
        await player.flush();
        if (!live()) return 0;
      }
      if (handled && keyIndex < 2) {
        const top = this.world.engineMessages.closestTop(this.record),
          inputID = top?.implementation.input;
        if (this.world.objects.objects.get(inputID)?.kind !== 11)
          throw new Error('FES release requires its owning Top Input task');
        await this.world.engineMessages.dispatch(inputID, this.record.id, 145, 0, 0, {
          flags: 0,
          executorEntry: context.executorEntry,
        });
      } else if (!handled) await this.propagation(sender, false);
      if (!live()) return 0;
      await runtime.sync({ resourcesOnly: true, executorEntry: context.executorEntry });
      if (!live()) return 0;
      await this.sync();
      return 0;
    } catch (error) {
      if (live()) throw error;
      return 0;
    }
  }
  async consumePush(sender, keyIndex, context) {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live()) return 0;
    try {
      this.state.source = this.input.source;
      instance.inputSource = this.state.source;
      if (this.state.sleeping) {
        await this.propagation(sender, false);
        return 0;
      }
      await this.updateMouse();
      if (!live()) return 0;
      const focused = this.referenceObject(this.state.focus),
        key = valid(focused) ? focused.key : null;
      this.state.pressed = key;
      const handled = await player.nativeEvent(key, keyIndex ? 'PUSH_R' : 'PUSH_L');
      if (!live()) return 0;
      await player.flush();
      if (!live()) return 0;
      await this.propagation(sender, handled);
      if (!live()) return 0;
      await runtime.sync({ resourcesOnly: true, executorEntry: context.executorEntry });
      if (!live()) return 0;
      await this.sync();
      return 0;
    } catch (error) {
      if (live()) throw error;
      return 0;
    }
  }
  async consumeHover(taskID, entered, context) {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live() || this.state.sleeping) return 0;
    try {
      await this.updateMouse();
      if (!live()) return 0;
      const entry = runtime.resources.entries.find(
        (entry) => entry.savedType === 6 && taskID != null && entry.buttonTaskID === taskID,
      );
      if (entry) {
        const reference = { nameBytes: new Uint8Array(entry.nameBytes), index: entry.index | 0 };
        // Both native branches zero all36 active-reference bytes before the event.
        this.state.focus = { nameBytes: new Uint8Array(), index: 0 };
        if (entered) this.state.focus = reference;
        const object = this.referenceObject(reference);
        if (object) await instance.dispatchEvent(object, entered ? 'FOCUS' : 'UNFOCUS');
        if (!live()) return 0;
        if (entered) {
          await runtime.sync({ resourcesOnly: true, executorEntry: context.executorEntry });
          return 0;
        }
      }
      // Read after UNFOCUS: its real script may have changed both lock and reference.
      if (!this.state.activeLock) {
        this.state.focus = { nameBytes: new Uint8Array(), index: -1 };
        this.state.pressed = null;
      }
      await runtime.sync({ resourcesOnly: true, executorEntry: context.executorEntry });
    } catch (error) {
      if (live()) throw error;
    }
    return 0;
  }
  async moveDirection(direction, context) {
    const player = this.player,
      instance = this.instance,
      runtime = instance.runtime,
      // Both native default/current probes require raw6 and DWORD enable!=0;
      // canonical collection lookup already excludes a deleted map object.
      eligible = (object) => object?.nativeType === 6 && !!object.enable,
      live = () =>
        this.player === player &&
        this.instance === instance &&
        !runtime.closed &&
        this.record.state !== 'releasing' &&
        this.world.objects.objects.get(this.record.id) === this.record;
    if (!live()) return true;
    let outcome,
      selectedDefault = false;
    try {
      if (!this.referenceObject(this.state.focus)) {
        const point = new Int32Array(2),
          top = this.world.engineMessages.closestTop(this.record),
          inputID = top?.implementation.input;
        if (this.world.objects.objects.get(inputID)?.kind !== 11)
          throw new Error('FES initial direction requires its owning Top Input task');
        await this.world.engineMessages.dispatch(inputID, this.record.id, 125, 0, 4, {
          ...context,
          flags: 0,
          payload: {
            store: (address, value) => {
              if (address !== 0 && address !== 4)
                throw new RangeError(
                  'FES initial point output is outside its two initialized words',
                );
              point[address >>> 2] = value | 0;
            },
          },
        });
        if (!live()) return true;
        const hit = await findFESInitialButton(instance, this.world, point, live);
        if (!live()) return true;
        if (hit) this.state.focus = hit;
        else {
          const object = this.referenceObject(instance.defaultButton);
          if (!eligible(object)) return false;
          outcome = { button: object, controlChanged: false };
          selectedDefault = true;
        }
      }
      outcome ??= navigateFESButton(instance, this.state.focus, direction);
      if (!outcome.button && !outcome.controlChanged) {
        if (eligible(this.referenceObject(this.state.focus))) return false;
        const object = this.referenceObject(instance.defaultButton);
        if (!eligible(object)) return true;
        outcome = { button: object, controlChanged: false };
        selectedDefault = true;
      }
    } catch (error) {
      if (live()) throw error;
      return true;
    }
    if (outcome.controlChanged) {
      try {
        await runtime.sync({ resourcesOnly: true, executorEntry: context.executorEntry });
      } catch (error) {
        if (live()) throw error;
      }
      return true;
    }
    if (!outcome.button) return false;
    this.state.focus = selectedDefault
      ? {
          nameBytes: new Uint8Array(instance.defaultButton.nameBytes),
          index: instance.defaultButton.index,
        }
      : this.referenceFor(outcome.button);
    const reference = this.state.focus;
    try {
      await player.nativeEvent(
        outcome.button.key,
        ['PUSH_UP', 'PUSH_DOWN', 'PUSH_LEFT', 'PUSH_RIGHT'][direction],
      );
      if (!live()) return true;
      const object = this.referenceObject(reference);
      if (!object || ![1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25].includes(object.nativeType))
        return false;
      const point = fesButtonCursorPoint(instance, object),
        top = this.world.engineMessages.closestTop(this.record),
        inputID = top?.implementation.input;
      if (this.world.objects.objects.get(inputID)?.kind !== 11)
        throw new Error('FES direction requires its owning Top Input task');
      await this.world.engineMessages.dispatch(
        inputID,
        this.record.id,
        138,
        1,
        ((point[0] & 65535) | ((point[1] & 65535) << 16)) >>> 0,
        { ...context, flags: 0 },
      );
      if (live()) await runtime.sync({ resourcesOnly: true, executorEntry: context.executorEntry });
      return true;
    } catch (error) {
      if (live()) throw error;
      return true;
    }
  }
  async move(direction, context = {}) {
    let current = this.referenceObject(this.state.focus);
    if (this.instance.runtime)
      return this.moveDirection({ up: 0, down: 1, left: 2, right: 3 }[direction], context);
    if (!valid(current)) {
      const hovered = this.state.buttons.find(
        ([key, id]) =>
          valid(this.instance.byKey.get(key)) && this.input.hit(this.input.get(id), false),
      );
      current = hovered
        ? this.instance.byKey.get(hovered[0])
        : this.instance.runtime
          ? this.referenceObject(this.instance.defaultButton)
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
    const x = (rect.x + (object.auxiliaryWidth | 0)) | 0,
      y = (rect.y + (object.auxiliaryHeight | 0)) | 0;
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
    if (message === 64 && this.instance.runtime) return this.consumeHover(w, l, context);
    if (message === 9 && this.instance.runtime && (l === 0 || l === 1))
      return this.consumePush(sender, l, context);
    if (message === 10 && this.instance.runtime) return this.consumeRelease(sender, l, context);
    await this.updateMouse();
    switch (message) {
      case 64: {
        if (this.state.sleeping) return 0;
        const pair = this.state.buttons.find(([, id]) => w != null && id === w >>> 0);
        if (l) {
          await this.focus(pair?.[0] ?? null);
        } else if (pair?.[0] === this.referenceObject(this.state.focus)?.key)
          await this.focus(null);
        await this.sync();
        return 0;
      }
      case 9: {
        const player = this.player,
          instance = this.instance;
        this.state.source = this.input.source;
        this.instance.inputSource = this.state.source;
        if (this.state.sleeping) {
          await this.propagation(sender, false);
          return 0;
        }
        const focused = this.referenceObject(this.state.focus),
          key = valid(focused) ? focused.key : null;
        this.state.pressed = key;
        let handled = false;
        if (l === 0 || l === 1) handled = await this.event(key, l ? 'PUSH_R' : 'PUSH_L');
        else if (l >= 4 && l <= 7)
          handled = await this.move(['up', 'down', 'left', 'right'][l - 4], context);
        else if (l >= 8 && l <= 11)
          handled = await this.event(key, ['SCRL_U', 'SCRL_D', 'PAGE_U', 'PAGE_D'][l - 8]);
        else
          for (const object of this.instance.objects.filter(valid))
            if (object.hotkey === l) handled = (await this.event(object.key, 'PUSH_L')) || handled;
        if (
          l >= 4 &&
          l <= 7 &&
          (this.player !== player ||
            this.instance !== instance ||
            instance.runtime?.closed ||
            this.record.state === 'releasing' ||
            this.world.objects.objects.get(this.record.id) !== this.record)
        )
          return 0;
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
    const point = state.savedMouse;
    if (
      point !== null &&
      (!Array.isArray(point) ||
        point.length !== 2 ||
        point.some(
          (value) => !Number.isInteger(value) || value < -2147483648 || value > 2147483647,
        ))
    )
      throw new Error('FES saved mouse point must be unknown or two initialized int32 words');
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
