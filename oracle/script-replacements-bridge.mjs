// SPDX-License-Identifier: MPL-2.0
// Shared PE callers use the same SCRIPT map as KCS formatting and FES tokens.
// The byte-writing algorithm is independently compared with both original
// map traversal/replacement routines by verify-native-script-replacement.mjs.
export class NativeScriptReplacementsBridge {
  constructor(engine, configuration) {
    if (!configuration?.scriptReplacements)
      throw new Error('Native SCRIPT replacement requires the shared configuration rules');
    Object.assign(this, { engine, configuration });
    const p = engine.process;
    this.memory = {
      bytes: (address, size) => ({
        set: (bytes) => {
          if (bytes.length > size)
            throw new RangeError('Native SCRIPT write crosses its destination view');
          p.write(address, Uint8Array.from(bytes));
        },
      }),
    };
    engine.patch(
      engine.profile.startsWith('sdk-') ? 0x5c4d60 : 0x713680,
      'shared SCRIPT replacement rules',
      2,
      ([out, source]) => {
        configuration.scriptReplacements.write(this.memory, out, p.stringBytes(source));
        return 0;
      },
      { calleePops: true },
    );
    engine.registerFeature('script-replacements', this);
  }
  snapshot() {
    return {};
  }
  restore() {}
}
