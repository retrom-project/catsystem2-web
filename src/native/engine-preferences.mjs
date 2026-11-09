// SPDX-License-Identifier: MPL-2.0
// WinMain loads the user's setup after copying the game defaults.
const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    directory: 3972,
    filename: 0x208,
    wide: true,
    read: 0x71fda0,
    volumes: 0x714270,
  },
  'sdk-4.01-engine-2.6.1.74': {
    directory: 2672,
    filename: 0x104,
    wide: false,
    read: 0x5d0400,
    volumes: 0x5c50e0,
  },
};

export async function readNativeStartupPreferences(engine, readSaved, diagnostic) {
  const { process: p, kernel, refs } = engine,
    layout = ABI[engine.profile],
    directory = p.string(refs.owner + layout.directory, layout.wide),
    file = p.string(refs.owner + layout.filename, layout.wide),
    path = kernel.path(directory + '\\' + file).toLowerCase(),
    bytes = (await readSaved?.(file)) ?? null;
  const provider = 'startup-setup.xml';
  if (bytes)
    kernel.registerFiles(provider, {
      read: (name) => (name.toLowerCase() === path ? bytes : undefined),
    });
  try {
    // The wrapper passes both groups and recomputes effective volume even
    // when no setup is present. Keep the reader's own result for diagnostics.
    const loaded = await p.callAsync(layout.read, [3], refs.owner);
    await p.callAsync(layout.volumes, [], refs.owner);
    if (loaded) engine.configurationMemory.pull();
    else if (bytes) diagnostic?.({ type: 'preferences-invalid', file });
  } finally {
    if (bytes) kernel.fileProviders.delete(provider);
  }
}
