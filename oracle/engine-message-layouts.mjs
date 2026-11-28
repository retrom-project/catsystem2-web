// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../src/native/abi/index.mjs';
const SDK = 'sdk-4.01-engine-2.6.1.74',
  GAME = 'nekopara-vol3-engine-2.6.1.76';
export const NATIVE_ENGINE_MESSAGE_LAYOUTS = Object.freeze({
  [SDK]: Object.freeze({
    base: 0x4b9360,
    route: 0x4b96e0,
    packet: 0x4b9610,
    send: 0x4b9aa0,
    up: 0x4b9b80,
    topUp: 0x4bb030,
    root: 0x4baba0,
    rootCtor: 0x4b9d50,
    baseCtor: 0x4b8cd0,
    rootStart: nativeABI('sdk-4.01-engine-2.6.1.74').messages.root.start,
    captionWide: nativeABI('sdk-4.01-engine-2.6.1.74').messages.root.captionWide,
    rootField: nativeABI('sdk-4.01-engine-2.6.1.74').messages.root.field,
    soundReset: nativeABI('sdk-4.01-engine-2.6.1.74').messages.root.soundReset,
  }),
  [GAME]: Object.freeze({
    base: 0x5dd130,
    route: 0x5dd4a0,
    packet: 0x5dd3e0,
    send: 0x5dd860,
    up: 0x5dd940,
    topUp: 0x5dec70,
    root: 0x5deac0,
    rootCtor: 0x5ddaf0,
    baseCtor: 0x5dcab0,
    rootStart: nativeABI('nekopara-vol3-engine-2.6.1.76').messages.root.start,
    captionWide: nativeABI('nekopara-vol3-engine-2.6.1.76').messages.root.captionWide,
    rootField: nativeABI('nekopara-vol3-engine-2.6.1.76').messages.root.field,
    soundReset: nativeABI('nekopara-vol3-engine-2.6.1.76').messages.root.soundReset,
  }),
});
