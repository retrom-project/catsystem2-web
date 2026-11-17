// SPDX-License-Identifier: MPL-2.0
// Finite CsSound borrows the Root's existing SoundTask and its global device banks.
import { scriptError } from '../javascript/program.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeABI } from './abi/index.mjs';
import { mapABIMessage } from './abi/messages.mjs';
import { nativeEngineWord } from './engine-message.mjs';
import { nativeCategoryFilename } from './resource-file.mjs';
import { NativeSoundPacket } from './sound.mjs';

const categories = new Map([
  ['bgm', 0],
  ['se', 1],
  ['voice', 2],
  ['sysvoice', 2],
]);
const cstring = (value) =>
  typeof value === 'string' && !value.includes('\0') && encodeCP932(value).length < 260;
const signed32 = (value) => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;

export class SDKJavaScriptSounds {
  constructor(world, owner) {
    this.world = world;
    this.owner = owner;
    this.closed = false;
  }
  records() {
    return [...this.world.runtime.handles.records].filter(
      ([, record]) => record.type === 'javascript-sound' && record.value.owner === this.owner.id,
    );
  }
  checkOpen() {
    if (
      this.closed ||
      this.owner.implementation?.closed ||
      this.world.objects.objects.get(this.owner.id) !== this.owner
    )
      throw new Error('JavaScript sound owner is closed');
  }
  sound(reference) {
    this.checkOpen();
    if (
      !reference ||
      Object.keys(reference).length !== 1 ||
      !Number.isSafeInteger(reference.hostObject)
    )
      throw new Error('Invalid JavaScript sound reference');
    const sound = this.world.runtime.handles.get(reference.hostObject, 'javascript-sound');
    if (sound.owner !== this.owner.id) throw new Error('JavaScript sound belongs to another owner');
    this.receiver(sound);
    return sound;
  }
  receiver(sound) {
    const record = this.world.objects.objects.get(sound.task),
      receiver = this.world.sound.get(sound.task);
    if (
      record?.kind !== 13 ||
      !receiver ||
      this.world.engineMessages.closestTop(record.id) !==
        this.world.engineMessages.closestTop(this.owner.id)
    )
      throw new Error('JavaScript sound lost its owned Root SoundTask');
    return record;
  }
  host(operation, args, location) {
    this.checkOpen();
    const unsupported = () => {
      throw scriptError(
        'Unsupported JavaScript host import',
        location,
        'CsSound arguments or method',
      );
    };
    if (operation.construct === 'CsSound') {
      if (args.length) return unsupported();
      return { wait: { sound: null, operation: 'construct' } };
    }
    const sound = this.sound(operation.receiver),
      request = { sound: operation.receiver.hostObject, operation: operation.member };
    if (operation.member === 'load') {
      if (args.length !== 2 || !args.every(cstring) || !categories.has(args[1]))
        return unsupported();
      return { wait: { ...request, name: args[0], category: args[1] } };
    }
    if (operation.member === 'play') {
      if (args.length > 1 || (args.length && !signed32(args[0])) || !categories.has(sound.category))
        return unsupported();
      return { wait: { ...request, loop: args.length ? args[0] : 1 } };
    }
    if (operation.member === 'stop' && !args.length) return { wait: request };
    return unsupported();
  }
  send(sound, message, w = 0, l = 0, payload) {
    const receiver = this.receiver(sound);
    return this.world.sendNativeEngine(
      receiver.nativeID,
      this.owner.id,
      mapABIMessage(this.world.profile, 'sound', 'raw', message),
      w >>> 0,
      l >>> 0,
      { flags: 0, ...(payload ? { payload } : {}) },
    );
  }
  volume(category) {
    const index = categories.get(category),
      config = this.world.configuration,
      bytes = config.blocks[0];
    const voice = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (config.voiceMuted(index)) return 0;
    // Producer 5C50E0 already multiplied master into words0..3. Consumer 545B00
    // still performs signed low32 IMUL and truncating division for object volume100.
    return Math.trunc(Math.imul(voice.getUint32(index * 4, true), 100) / 100) >>> 0;
  }
  async complete(request) {
    this.checkOpen();
    if (request.operation === 'construct') {
      const nativeID = nativeEngineWord(
        await this.world.sendNativeEngine(
          0,
          this.owner.id,
          nativeABI(this.world.profile).messages.root.start + 3,
          0,
          0,
          { flags: 0 },
        ),
        'JavaScript SoundTask query',
      );
      this.checkOpen();
      const sound = {
        owner: this.owner.id,
        task: this.world.resolveTaskID(nativeID, this.owner.id),
        bank: 0xffffffff,
        file: '',
        category: '',
      };
      this.receiver(sound);
      return { hostObject: this.world.runtime.handles.add('javascript-sound', sound) };
    }
    const sound = this.sound({ hostObject: request.sound });
    if (request.operation === 'load') {
      const file = nativeCategoryFilename(this.world.game, request.name, 'sound') ?? '';
      if (!cstring(file)) throw new Error('JavaScript sound filename exceeds its owned CString');
      const category = new NativeSoundPacket();
      category.writeString(request.category, 0);
      const group = nativeEngineWord(
        await this.send(sound, 209, 0, 0, category),
        'JavaScript sound group query',
      );
      this.checkOpen();
      const packet = new NativeSoundPacket([], 280);
      packet.store(4, group);
      packet.writeString(file, 12);
      packet.store(272, 1);
      const bank = nativeEngineWord(
        await this.send(sound, 205, 0, 0, packet),
        'JavaScript allocated sound load',
      );
      this.checkOpen();
      sound.bank = bank;
      sound.file = file;
      sound.category = request.category;
    } else if (request.operation === 'play') {
      await this.send(sound, 186, sound.bank, this.volume(sound.category));
      this.checkOpen();
      await this.send(sound, 182, sound.bank, request.loop);
      this.checkOpen();
    } else if (request.operation === 'stop') {
      await this.send(sound, 184, sound.bank, 0);
      this.checkOpen();
    } else throw new Error('Invalid JavaScript sound continuation');
    return undefined;
  }
  validate(cells) {
    for (const [handle, record] of this.records()) {
      const sound = this.sound({ hostObject: handle });
      if (
        record.value !== sound ||
        !Number.isInteger(sound.bank) ||
        (sound.bank !== 0xffffffff &&
          (sound.bank < 0 || sound.bank >= this.world.sound.bankCount)) ||
        !cstring(sound.file) ||
        (sound.category !== '' && !categories.has(sound.category))
      )
        throw new Error('Invalid JavaScript sound checkpoint');
    }
    for (const value of cells) this.sound(value);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    // The bank, pending decoder and fade belong to the shared SoundTask, not CsSound.
    for (const [handle] of this.records())
      this.world.runtime.handles.release(handle, 'javascript-sound');
  }
}
