// SPDX-License-Identifier: MPL-2.0
// Normal FES selection commands borrow current Settings, sound tree and RNG.
import { nativeDataString } from './data-text.mjs';
import { fesNarrowText } from '../fes/tokens.mjs';

const encoder = new TextEncoder();
export function fesSystemVoiceCommand(coordinator, name, args) {
  if (coordinator.closed) throw new Error('FES runtime owner is closed');
  if (name !== 'sysvoice' && name !== 'sysvoiceex')
    throw new Error('Unknown FES system voice command');
  const { instance, world } = coordinator,
    read = (index) => {
      if (args[index] === undefined) return null;
      const source = new Uint8Array(nativeDataString(args[index]));
      if (source.length >= 512)
        throw new RangeError('FES system voice token exceeds its 512-byte temporary');
      const bytes = new Uint8Array(nativeDataString(instance.argumentBytes(source)));
      if (bytes.length >= 512)
        throw new RangeError('FES system voice operand exceeds its 512-byte temporary');
      return bytes;
    },
    number = (bytes) => (bytes.length ? instance.value(fesNarrowText(bytes)) : 0),
    output = read(0);
  if (output === null) return 0;
  const destination = number(output) >>> 0,
    sound = world.soundConfiguration;
  if (name === 'sysvoiceex' && !sound.loaded) {
    instance.setGlobal(destination, -1);
    return 0;
  }
  let candidates = [];
  const fields = world.configuration.fields,
    enabled = (id) =>
      id >>> 0 < 48 && fields.systemVoice[(id >>> 0) * 32] !== 0 && fields.sysplay[id >>> 0] !== 0,
    second = read(1);
  if (second === null) {
    if (name === 'sysvoiceex') candidates = sound.systemVoiceCandidates();
    else for (let id = 0; id < 48; id++) if (enabled(id)) candidates.push(id);
  } else {
    for (let index = 1, bytes = second; bytes !== null; bytes = read(++index)) {
      if (name === 'sysvoice') {
        const id = number(bytes);
        if (enabled(id)) {
          if (candidates.length === 128)
            throw new RangeError('FES system voice candidates exceed the native stack capacity');
          candidates.push(id);
        }
      } else {
        const ids = [];
        let start = 0;
        for (let at = 0; at <= bytes.length; at++)
          if (at === bytes.length || bytes[at] === 44) {
            ids.push(number(bytes.subarray(start, at)));
            start = at + 1;
          }
        if (sound.systemVoiceAtIDPath(ids)) candidates.push(ids.at(-1));
      }
    }
  }
  if (!candidates.length) {
    instance.setGlobal(destination, -1);
    return 0;
  }
  const selected = candidates[(world.random.rand() >>> 0) % candidates.length];
  instance.setGlobal(destination, selected);
  const sink = world.host.nativeDebugOutput;
  if (typeof sink === 'function') {
    const emit = sink.bind(world.host);
    emit(encoder.encode('select ' + name + ' ' + selected));
  }
  return 0;
}
