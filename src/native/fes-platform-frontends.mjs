// SPDX-License-Identifier: MPL-2.0
// Normal FES frontends share the coordinator's existing scheduling FIFO.
import { nativeDataString } from './data-text.mjs';
import { fesNarrowText } from '../fes/tokens.mjs';
import { fesRawTail } from '../fes/source.mjs';
import { FESFontEnumeration } from './fes-fonts.mjs';
import { fesShellError } from './fes-shell-errors.mjs';

export const FES_PLATFORM_COMMANDS = Object.freeze([
  'clipboard',
  'config_open',
  'fontcom',
  'opensite',
]);
const operations = new Set(['fes-clipboard', 'fes-configuration', 'fes-open-site']),
  narrow = new TextDecoder('shift_jis'),
  owned = (bytes) => new Uint8Array(nativeDataString(bytes));
function boolean(value, name) {
  if (![true, false, 0, 1].includes(value))
    throw new TypeError('FES clipboard ' + name + ' must report success or failure');
  return Boolean(value);
}

export class FESPlatformFrontends {
  constructor(coordinator) {
    this.coordinator = coordinator;
    this.world = coordinator.world;
    this.instance = coordinator.instance;
    this.fonts = new FESFontEnumeration(this.world);
    this.closed = false;
    this.inFlight = null;
  }
  expand(token) {
    return owned(this.instance.argumentBytes(token));
  }
  number(token) {
    return this.instance.value(fesNarrowText(this.expand(token)));
  }
  command(name, args, source) {
    if (this.closed) throw new Error('FES platform owner is closed');
    if (!FES_PLATFORM_COMMANDS.includes(name))
      throw new Error('Unknown FES platform frontend command');
    if (name === 'fontcom') {
      this.fontCommand(args, source);
      return 0;
    }
    if (name === 'config_open') return this.queue('fes-configuration');
    if (args[0] === undefined) return 0;
    const first = this.expand(args[0]);
    if (first.length >= 1024)
      throw new RangeError('FES platform operand exceeds its 1024-byte temporary');
    let bytes = first;
    if (name === 'opensite' && args[1] !== undefined) {
      const second = this.expand(args[1]);
      if (second.length >= 1024)
        throw new RangeError('FES platform operand exceeds its 1024-byte temporary');
      bytes = new Uint8Array(first.length + second.length + 3);
      bytes.set(first);
      bytes.set([58, 47, 47], first.length);
      bytes.set(second, first.length + 3);
    }
    if (bytes.length >= 2048)
      throw new RangeError('FES platform payload exceeds its 2048-byte destination');
    return this.queue(name === 'clipboard' ? 'fes-clipboard' : 'fes-open-site', bytes);
  }
  fontCommand(args, source) {
    if (args[0] === undefined) return;
    const mode = fesNarrowText(this.expand(args[0]));
    if (mode === 'init') return this.fonts.initialize();
    if (this.fonts.names === null || args[1] === undefined) return;
    if (!['count', 'get', 'search', 'default'].includes(mode)) return;
    const index = this.number(args[1]);
    if (mode === 'count') this.instance.setGlobal(index, this.fonts.names.length);
    else if (mode === 'get') {
      if (args[2] !== undefined)
        this.coordinator.writeString(this.number(args[2]), this.fonts.get(index));
    } else if (mode === 'search') {
      const tail = fesRawTail(source, 3);
      if (tail.length) this.instance.setGlobal(index, this.fonts.search(tail));
    } else this.coordinator.writeString(index, this.world.nativeDefaultFontBytes());
  }
  queue(operation, bytes) {
    if (this.closed) throw new Error('FES platform owner is closed');
    this.coordinator.pendingRecords.push({ operation, ...(bytes ? { bytes: owned(bytes) } : {}) });
    return -3;
  }
  supports(record) {
    return operations.has(record.operation);
  }
  async consume(record) {
    if (this.closed) return;
    if (this.inFlight) throw new Error('FES platform FIFO is already being drained');
    const flight = {
      operation: record.operation,
      modal: record.operation === 'fes-configuration',
      promise: null,
    };
    this.inFlight = flight;
    flight.promise = this.perform(record, flight);
    try {
      await flight.promise;
    } catch (error) {
      if (!this.closed) throw error;
    } finally {
      if (this.inFlight === flight) this.inFlight = null;
    }
  }
  async perform(record, flight) {
    if (this.closed) return;
    if (record.operation === 'fes-configuration')
      return this.world.window.action('fes-configuration', { owner: this.instance.runtimeID });
    if (record.operation === 'fes-open-site') {
      const result = await this.world.window.action('fes-open-site', {
        owner: this.instance.runtimeID,
        bytes: owned(record.bytes),
      });
      if (this.closed) return;
      if (!Number.isInteger(result) || result < 0 || result > 0xffffffff)
        throw new TypeError('FES external open must report its real ShellExecute result');
      const error = fesShellError(result, this.world.globalStrings);
      if (error && !this.closed) {
        flight.modal = true;
        await this.world.window.action('fes-message-box', {
          ...error,
          owner: this.instance.runtimeID,
        });
      }
      return;
    }
    const clipboard = this.world.host.nativeClipboard;
    for (const method of ['open', 'empty', 'write', 'close'])
      if (typeof clipboard?.[method] !== 'function')
        throw new Error('FES clipboard requires its platform ' + method + ' service');
    if (!boolean(await clipboard.open(this.world.window.handle), 'open')) return;
    try {
      if (this.closed) return;
      boolean(await clipboard.empty(), 'empty');
      if (this.closed) return;
      boolean(await clipboard.write(narrow.decode(record.bytes)), 'write');
    } finally {
      boolean(await clipboard.close(), 'close');
    }
  }
  snapshot() {
    if (this.inFlight) throw new Error('Cannot snapshot FES while a platform action is in flight');
    return { fonts: this.fonts.snapshot() };
  }
  restore(state) {
    this.fonts.restore(state.fonts);
    this.closed = false;
  }
  async close() {
    this.closed = true;
    this.fonts.close();
    this.coordinator.pendingRecords = this.coordinator.pendingRecords.filter(
      (record) => !this.supports(record),
    );
    const flight = this.inFlight;
    if (flight?.modal) {
      await this.world.window.action('fes-owner-close', {
        owner: this.instance.runtimeID,
      });
    }
  }
}
