// SPDX-License-Identifier: MPL-2.0
// Game 761CE0..7624C0; SDK 5FDC40..5FE420. Entries are 36-byte native records.
import { encodeCP932 } from '../kcs/strings.mjs';

export class NativeFESSoundTable {
  constructor(sound) {
    this.sound = sound;
    sound.state.table ??= {
      records: null,
      initialized: null,
      order: null,
      current: -1,
      repeat: 0,
      shuffled: 0,
    };
    this.state = sound.state.table;
  }
  get count() {
    return this.state.order?.length ?? 0;
  }
  resize(count) {
    count |= 0;
    if (count < 0) throw new RangeError('Native sound table allocation has a negative size');
    this.state.records = new Uint8Array(count * 36);
    // HeapAlloc(flags=0) leaves records uninitialized. Keep validity separate
    // from their backing storage so a premature read cannot become a false zero.
    this.state.initialized = new Uint8Array(count * 36);
    this.state.order = new Int32Array(count);
    if (this.state.current !== -1)
      throw new Error('Native sound table resize reads an uninitialized new order entry');
    this.resetOrder();
  }
  setRecord(index, name, enabled) {
    index |= 0;
    if (index < 0 || index >= this.count || !this.state.records) return;
    const bytes = encodeCP932(name),
      at = index * 36 + 4;
    if (at + bytes.length + 1 > this.state.records.length)
      throw new RangeError('Native sound table string exceeds its mapped allocation');
    this.state.records.set(bytes, at);
    this.state.records[at + bytes.length] = 0;
    this.state.initialized.fill(1, at, at + bytes.length + 1);
    new DataView(this.state.records.buffer).setUint32(index * 36, enabled >>> 0, true);
    this.state.initialized.fill(1, index * 36, index * 36 + 4);
  }
  initialized(at, size) {
    if (at < 0 || at + size > (this.state.records?.length ?? 0))
      throw new RangeError('Native sound table reads outside its record allocation');
    for (let i = at; i < at + size; i++)
      if (!this.state.initialized[i])
        throw new Error('Native sound table reads an uninitialized record');
  }
  enabled(index) {
    this.initialized(index * 36, 4);
    return new DataView(this.state.records.buffer).getUint32(index * 36, true);
  }
  recordName(index) {
    const at = index * 36 + 4;
    let end = at;
    for (;;) {
      this.initialized(end, 1);
      if (!this.state.records[end]) break;
      end++;
    }
    return new TextDecoder('shift_jis').decode(this.state.records.subarray(at, end));
  }
  entry(position) {
    if (!this.state.order || position < 0 || position >= this.count)
      throw new RangeError('Native sound table reads outside its order allocation');
    return this.state.order[position];
  }
  resetOrder() {
    if (!this.state.order) return;
    const selected = this.state.current === -1 ? -1 : this.entry(this.state.current);
    for (let i = 0; i < this.count; i++) this.state.order[i] = i;
    if (this.state.current !== -1) this.state.current = selected;
    this.state.shuffled = 0;
  }
  shuffle(random, pinnedID) {
    if (!this.state.order) return;
    if (this.sound.get('playing') && this.state.shuffled) this.sound.set('pendingLoad', 1);
    this.resetOrder();
    if (!this.count) throw new RangeError('Native sound table shuffle divides by zero');
    if (typeof random?.rand !== 'function')
      throw new Error('Native sound table shuffle requires the shared integer random stream');
    for (let i = 0; i < 1000; i++) {
      const a = (random.rand() >>> 0) % this.count,
        b = (random.rand() >>> 0) % this.count;
      [this.state.order[a], this.state.order[b]] = [this.state.order[b], this.state.order[a]];
    }
    if ((pinnedID | 0) >= 0) {
      const at = this.state.order.indexOf(pinnedID | 0);
      if (at !== -1)
        [this.state.order[0], this.state.order[at]] = [this.state.order[at], this.state.order[0]];
    }
    for (let i = 0; i < this.count; i++)
      if (this.enabled(this.entry(i))) {
        this.state.current = i;
        break;
      }
    if (this.sound.get('pendingLoad') && this.state.current !== -1) this.applySelection(false);
    this.state.shuffled = 1;
  }
  applySelection(pending = true) {
    const entry = this.entry(this.state.current);
    this.sound.writeString(44, this.recordName(entry));
    if (pending) this.sound.set('pendingLoad', 1);
    this.sound.set('active', this.enabled(entry));
  }
  selectPosition(position) {
    const count = this.count;
    position |= 0;
    if (position < 0) position = this.state.repeat ? count - 1 : 0;
    else if (position >= count) position = this.state.repeat ? 0 : count - 1;
    while (position < count && !this.enabled(this.entry(position))) position++;
    if (position === count && this.state.repeat) {
      position = 0;
      while (position < this.state.current && !this.enabled(this.entry(position))) position++;
    }
    if (position < count) {
      this.state.current = position;
      if (this.state.records) this.applySelection();
    } else {
      position = count - 1;
      while (position >= 0 && !this.enabled(this.entry(position))) position--;
      this.state.current = position;
      if (this.sound.get('playing')) this.sound.play(0);
    }
  }
  selectID(id) {
    const position = this.state.order?.indexOf(id | 0) ?? -1;
    // 7622F7 falls back to position zero if the requested ID was not found.
    this.selectPosition(position === -1 ? 0 : position);
  }
  getID() {
    return !this.state.order || this.state.current < 0 ? 0 : this.entry(this.state.current);
  }
  next() {
    this.selectPosition((this.state.current + 1) | 0);
  }
  reverse() {
    let position = (this.state.current - 1) | 0;
    while (position >= 0 && !this.enabled(this.entry(position))) position--;
    this.selectPosition(position);
  }
}
