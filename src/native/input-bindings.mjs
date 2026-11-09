// SPDX-License-Identifier: MPL-2.0
// Browser devices feed the four binding slots of each native logical key.
// KEYCUSTOMIZE/KEY owns the actual bindings; names and menu labels do not.
const categories = ['keyboard', 'mouse', 'joypad', 'touch'];
const sources = [1, 2, 4, 8];
const keyCodes = {
  Enter: 13,
  NumpadEnter: 13,
  Escape: 27,
  Space: 32,
  Tab: 9,
  Backspace: 8,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Insert: 45,
  Delete: 46,
  CapsLock: 20,
  NumLock: 144,
  ScrollLock: 145,
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
  NumpadMultiply: 106,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadDecimal: 110,
  NumpadDivide: 111,
};
export function browserVirtualKey(event) {
  if (event.isComposing || event.keyCode === 229) return 0;
  if (event.keyCode > 0 && event.keyCode < 256) return event.keyCode;
  if (keyCodes[event.code]) return keyCodes[event.code];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(event.code)) return 96 + Number(event.code.slice(6));
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) return 111 + Number(event.code.slice(1));
  return 0;
}

export class NativeInputBindings {
  constructor(input, configuration) {
    Object.assign(this, { input, configuration });
    this.down = Object.fromEntries(categories.map((name) => [name, new Set()]));
    this.events = [];
    this.nativeMode = false;
    this.nativeEvents = [];
    this.touchEvents = [];
    this.contacts = new Map();
    this.pulses = [];
    this.browserKeys = new Map();
    this.logical = [];
    this.logicalDown = new Set();
    this.live = new Uint32Array(320);
    this.sampled = new Uint32Array(320);
    this.repeat = new Uint32Array(80);
    this.injected = new Uint32Array(80);
    this.mouseState = new Uint32Array(8);
    this.pointerActivation = false;
    // The original window's script gate starts enabled. WinMain loads the
    // separate user preference after these browser bindings already exist.
    this.joypadEnabled = 1;
    this.touchHoldEnabled = 0;
    this.touchActive = false;
    this.inside = 0;
  }
  key(category, code, down) {
    if (!categories.includes(category) || !Number.isInteger(code) || code < 1 || code > 255)
      throw new Error('Invalid native device binding');
    this.events.push({ category, code, down: !!down });
    if (category === 'keyboard' || category === 'mouse') {
      const at = code >>> 5,
        mask = 1 << (code & 31);
      this.mouseState[at] = down ? this.mouseState[at] | mask : this.mouseState[at] & ~mask;
    }
  }
  keyboard(event, down) {
    const code = browserVirtualKey(event);
    if (!code || (event.repeat && this.browserKeys.has(event.code))) return;
    if (down) this.browserKeys.set(event.code, code);
    else this.browserKeys.delete(event.code);
    this.key('keyboard', code, down || [...this.browserKeys.values()].includes(code));
    const modifier = {
      ShiftLeft: 160,
      ShiftRight: 161,
      ControlLeft: 162,
      ControlRight: 163,
      AltLeft: 164,
      AltRight: 165,
    }[event.code];
    if (modifier) this.key('keyboard', modifier, down);
  }
  mouse(button, down) {
    const nativeButton = [1, 2, 3, 4, 5][button];
    if (!nativeButton)
      throw new RangeError('Browser mouse button is outside the native five-button set');
    this.key('mouse', nativeButton, down);
  }
  releasePointer() {
    if (this.nativeMode) {
      const held = new Set(this.down.mouse);
      for (const event of [...this.nativeEvents, ...this.events])
        if (event.category === 'mouse') {
          if (event.down) held.add(event.code);
          else held.delete(event.code);
        }
      for (const code of held) this.key('mouse', code, false);
      for (const id of this.contacts.keys()) {
        const point = this.contacts.get(id);
        this.contact(id, point.x, point.y, 'up');
      }
      return;
    }
    this.events = this.events.filter((event) => event.category !== 'mouse');
    for (const code of this.down.mouse) this.apply('mouse', code, false);
    this.down.mouse.clear();
    this.pulses = [];
    this.mouseState[0] &= ~0x3e;
  }
  contact(id, x, y, phase) {
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !['down', 'move', 'up'].includes(phase)
    )
      throw new Error('Invalid browser touch contact');
    const contact = { id: id >>> 0, x, y, phase };
    this.touchEvents.push(contact);
    if (phase === 'up') this.contacts.delete(id);
    else this.contacts.set(id, { x, y });
    this.touchActive = this.contacts.size > 0;
  }
  wheel(up) {
    this.pulses.push(up ? 6 : 7);
  }
  tap(index) {
    if (!Number.isInteger(index) || index < 0 || index >= 80)
      throw new Error('Invalid native logical key');
    this.logical.push({ index, down: true }, { index, down: false });
  }
  acceptsKeyboard(event) {
    const code = browserVirtualKey(event),
      limit = this.configuration.authorMode ? 80 : 32;
    return (
      !!code &&
      this.configuration.keys.rows
        .slice(0, limit)
        .some((row) => row.enabled && row.keyboard.includes(code))
    );
  }
  gamepad(pads) {
    const pad = Array.from(pads).find((p) => p?.connected),
      next = new Set();
    if (pad && this.configuration.keys.enableJoypad && this.joypadEnabled) {
      if (pad.axes[1] < -0.5 || pad.buttons[12]?.pressed) next.add(1);
      if (pad.axes[1] > 0.5 || pad.buttons[13]?.pressed) next.add(2);
      if (pad.axes[0] < -0.5 || pad.buttons[14]?.pressed) next.add(3);
      if (pad.axes[0] > 0.5 || pad.buttons[15]?.pressed) next.add(4);
      for (let i = 0; i < Math.min(32, pad.buttons.length); i++)
        if (pad.buttons[i]?.pressed) next.add(i + 5);
    }
    for (const code of this.down.joypad)
      if (!next.has(code)) this.events.push({ category: 'joypad', code, down: false });
    for (const code of next)
      if (!this.down.joypad.has(code)) this.events.push({ category: 'joypad', code, down: true });
  }
  // 70F930/70F830/70FA30 update sampled-on-press and live-on-both-edge
  // masks. The repeat word belongs to the logical key, shared by four slots.
  // Mouse and touch callbacks test both maps, preferring a touch-map match.
  apply(category, code, down, sourceOverride) {
    const source = sourceOverride ?? sources[categories.indexOf(category)],
      limit = this.configuration.authorMode ? 80 : 32;
    for (let index = 0; index < limit; index++) {
      const row = this.configuration.keys.rows[index];
      if (!row.enabled) continue;
      for (let slot = 0; slot < 4; slot++) {
        let selected = category;
        if (category === 'mouse' || category === 'touch')
          selected = row.touch[slot] === code ? 'touch' : row.mouse[slot] === code ? 'mouse' : null;
        else if (row[category][slot] !== code) selected = null;
        if (!selected) continue;
        const at = index * 4 + slot;
        if (down) {
          this.sampled[at] |= source;
          this.live[at] |= source;
        } else this.live[at] &= ~source;
        this.repeat[index] = row[`rep_${selected}`][slot] >>> 0;
      }
    }
  }
  releaseAll() {
    this.events = [];
    this.nativeEvents = this.nativeMode ? [{ category: 'reset' }] : [];
    this.touchEvents = [];
    this.contacts.clear();
    this.touchActive = false;
    this.pulses = [];
    this.browserKeys.clear();
    this.logical = [];
    this.logicalDown.clear();
    this.live.fill(0);
    this.sampled.fill(0);
    this.injected.fill(0);
    this.mouseState.fill(0);
    for (const keys of Object.values(this.down)) keys.clear();
    this.sync();
  }
  clearKeys() {
    this.browserKeys.clear();
    for (const keys of Object.values(this.down)) keys.clear();
    this.live.fill(0);
    this.sampled.fill(0);
    this.mouseState.fill(0);
    this.sync();
  }
  cancelWheel() {
    this.pulses = [];
    for (const code of [6, 7]) this.apply('mouse', code, false, 16);
  }
  killTouch() {
    this.touchActive = false;
    this.events = this.events.filter((e) => e.category !== 'touch');
    for (const code of this.down.touch) this.apply('touch', code, false);
    this.down.touch.clear();
  }
  setJoypad(enabled) {
    this.joypadEnabled = enabled >>> 0;
    if (!enabled)
      for (const code of this.down.joypad)
        this.events.push({ category: 'joypad', code, down: false });
  }
  setPulse(index, count) {
    if (index >= 80) throw new RangeError('Input pulse index crosses the key table');
    this.injected[index] = count;
  }
  query(index, slot) {
    if (this.injected[index]) {
      this.injected[index]--;
      return 1;
    }
    return this.sampled[index * 4 + slot];
  }
  finishFrame() {
    this.sampled.set(this.live);
    this.sync();
  }
  sync(input = this.input) {
    for (let index = 0; index < 80; index++)
      for (let slot = 0; slot < 4; slot++) {
        const at = index * 4 + slot;
        input.key(index, !!this.sampled[at], this.sampled[at], slot);
        input.repeatEnabled[at] = Number(!!this.repeat[index]);
      }
  }
  sample() {
    this.sampled.set(this.live);
    if (this.nativeMode) {
      this.nativeEvents.push(...this.events.splice(0));
      this.nativeEvents.push(
        ...this.pulses.splice(0).map((code) => ({ category: 'wheel', code, down: true })),
      );
    }
    while (this.events.length) {
      const event = this.events.shift();
      if (event.down) this.down[event.category].add(event.code);
      else this.down[event.category].delete(event.code);
      this.apply(event.category, event.code, event.down);
    }
    const pulse = this.pulses.shift();
    if (pulse) {
      this.apply('mouse', pulse, true, 16);
      this.apply('mouse', pulse, false, 16);
    }
    const logicalSeen = new Set();
    while (this.logical.length && !logicalSeen.has(this.logical[0].index)) {
      const event = this.logical.shift();
      logicalSeen.add(event.index);
      if (event.down) this.logicalDown.add(event.index);
      else this.logicalDown.delete(event.index);
    }
    for (const index of this.logicalDown) {
      this.sampled[index * 4] |= 1;
    }
    this.sync();
  }
  snapshot() {
    return structuredClone(
      Object.fromEntries(
        Object.entries(this).filter(([key]) => !['input', 'configuration'].includes(key)),
      ),
    );
  }
  restore(state) {
    Object.assign(this, structuredClone(state));
    this.sync();
  }
  adopt(other) {
    this.restore(other.snapshot());
  }
}
