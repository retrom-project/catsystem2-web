// SPDX-License-Identifier: MPL-2.0
import { AudioMixer } from '../../src/audio.mjs';

export function audioFixture() {
  const context = {
    currentTime: 0,
    state: 'running',
    sources: [],
    destination: {},
    decodeAudioData: async () => ({
      duration: 2,
      sampleRate: 60,
      numberOfChannels: 1,
      length: 120,
      getChannelData: () => new Float32Array(120).fill(0.25),
    }),
    createBufferSource() {
      const node = {
        loop: false,
        onended: null,
        stopped: false,
        playbackRate: {
          value: 1,
          setValueAtTime(value) {
            this.value = value;
          },
        },
        connect() {},
        disconnect() {},
        start(when, offset) {
          this.when = when;
          this.offset = offset;
        },
        stop(when) {
          if (when === undefined) this.stopped = true;
          else this.stopWhen = when;
        },
      };
      this.sources.push(node);
      return node;
    },
    createGain: () => ({
      connect() {},
      disconnect() {},
      gain: {
        value: 1,
        setValueAtTime(value) {
          this.value = value;
        },
        setTargetAtTime(value) {
          this.value = value;
        },
      },
    }),
    createStereoPanner: () => ({ connect() {}, disconnect() {}, pan: { value: 0 } }),
    createChannelSplitter: () => ({ connect() {}, disconnect() {} }),
    createChannelMerger: () => ({ connect() {}, disconnect() {} }),
    createPanner: () => ({
      connect() {},
      disconnect() {},
      ...Object.fromEntries(
        ['positionX', 'positionY', 'positionZ'].map((key) => [
          key,
          {
            value: 0,
            setValueAtTime(value) {
              this.value = value;
            },
          },
        ]),
      ),
    }),
    advance(seconds) {
      this.currentTime += seconds;
      for (const node of this.sources)
        if (
          !node.stopped &&
          ((node.stopWhen !== undefined && this.currentTime >= node.stopWhen) ||
            (!node.loop && this.currentTime >= node.when + node.buffer.duration - node.offset))
        ) {
          node.stopped = true;
          node.onended?.();
        }
    },
    close() {
      this.state = 'closed';
    },
  };
  const game = {
    resolve: (name) => name,
    require: async () => new Uint8Array([1]),
    read: async () => null,
  };
  return { context, mixer: new AudioMixer(game, context) };
}
