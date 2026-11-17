// SPDX-License-Identifier: MPL-2.0
// Fresh application startup fills the same owners used by scripts and snapshots.
import { nativeABI } from './abi/index.mjs';
import { applyNativePreferences } from './preferences.mjs';
import { applyNativeSoundPreferences, nativeSoundConfigurationFilename } from './sound-config.mjs';
import { parseNativeXML } from './xml.mjs';
import { nativeStartupSeed, seedNativeStartupRandom } from './startup-author.mjs';
import { checkNativeStartupResources } from './startup-resources.mjs';

export async function initializeNativeStartupInputs(world) {
  // Explicit data-only Worlds already supply their initialized owners.
  if (!world.bootstrapOwner) return;
  const { configuration, storage, profile, host } = world,
    abi = nativeABI(profile),
    diagnostic = (detail) => host.nativeDiagnostic?.(detail);
  if (abi.startup.resourceCheck !== 'after-preferences') await checkNativeStartupResources(world);
  // This constructor position differs between the registered ABIs. Explicit
  // input overrides only this constructor, never the subsequent author reset.
  seedNativeStartupRandom(world.random, nativeStartupSeed(world.clock));
  if (!world.bootstrapOwner.seedFromClock)
    seedNativeStartupRandom(world.random, world.bootstrapOwner.explicitSeed);
  const file = world.preferencesName,
    saved = (await storage.readSaved?.(file)) ?? null;
  if (saved && !applyNativePreferences(configuration, saved))
    diagnostic({ type: 'preferences-invalid', file });
  // WinMain recomputes effective volumes even if setup is missing or invalid.
  configuration.deriveVolumes();
  // The primary Input owner exists before setup; its task is created below.
  world.input.configureCursor();
  const screen = configuration.screen;
  world.graphics.view.configure({
    virtualWidth: screen.virtualWidth,
    virtualHeight: screen.virtualHeight,
    clientWidth: screen.currentWidth,
    clientHeight: screen.currentHeight,
    drawingRectangle: [0, 0, screen.currentWidth, screen.currentHeight],
  });
  if (abi.startup.resourceCheck === 'after-preferences') await checkNativeStartupResources(world);
}

export async function initializeNativeStartupSound(world) {
  if (!world.bootstrapOwner) return;
  const { soundConfiguration: sound, storage, profile, host } = world,
    abi = nativeABI(profile),
    diagnostic = (detail) => host.nativeDiagnostic?.(detail);
  // A resource document and the user's same-named saved tree are separate inputs.
  sound.filename = nativeSoundConfigurationFilename(world.startupDocument);
  sound.loaded = false;
  sound.master = null;
  sound.parts = [];
  sound.groups.clear();
  sound.dirty = false;
  if (!sound.filename) return;
  const bytes = await world.runtime.read(sound.filename, 'config');
  if (bytes === null || bytes === undefined) return;
  // The original reports an opened, malformed resource as loaded but unparsed.
  sound.loaded = true;
  let document;
  try {
    document = parseNativeXML(bytes, abi.xmlEncoding);
  } catch {
    diagnostic({ type: 'sound-configuration-invalid', file: sound.filename });
    return;
  }
  sound.load(document);
  // The original reaches saved preferences only after the resource XML and
  // its MASTER/PART tree have loaded successfully.
  const preferences = (await storage.readSaved?.(sound.filename)) ?? null;
  if (preferences && !applyNativeSoundPreferences(sound, preferences))
    diagnostic({ type: 'preferences-invalid', file: sound.filename });
}
