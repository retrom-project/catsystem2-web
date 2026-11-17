// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  NATIVE_ABIS,
  nativeABI,
  nativeABIBehavior,
  validateABI,
} from '../src/native/abi/index.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { readEngineVersion, selectNativeProfile } from '../src/native/profile.mjs';

for (const profile of Object.keys(NATIVE_ABIS)) {
  test(`normal ABI configuration layout does not require original Engine addresses: ${profile}`, () => {
    const abi = structuredClone(nativeABI(profile));
    delete abi.configuration.memory;
    delete abi.text.configurationLayout.ownerOffset;
    assert.strictEqual(validateABI(abi), abi);
    for (const change of [
      (value) => {
        delete value.text.configurationLayout.bytes;
      },
      (value) => {
        value.text.configurationLayout.bytes += 4;
      },
      (value) => {
        value.text.configurationLayout.keyStride = 1;
      },
      (value) => {
        value.text.configurationLayout.fontBytes = 0;
      },
      (value) => {
        value.text.configurationLayout.encoding = 'UTF-8';
      },
      (value) => {
        value.configuration.blockSizes[0] = 4;
      },
      (value) => {
        value.configuration.blockSizes[1]++;
      },
    ]) {
      const invalid = structuredClone(abi);
      change(invalid);
      assert.throws(() => validateABI(invalid), /Invalid ABI behavior data/);
    }
    assert.equal(Object.hasOwn(abi.configuration, 'memory'), false);
    assert.equal(Object.hasOwn(abi.text.configurationLayout, 'ownerOffset'), false);
  });
}

function versionImage(version) {
  const bytes = new Uint8Array(1024),
    view = new DataView(bytes.buffer),
    u16 = (at, value) => view.setUint16(at, value, true),
    u32 = (at, value) => view.setUint32(at, value, true);
  bytes.set([77, 90]);
  u32(60, 128);
  bytes.set([80, 69, 0, 0], 128);
  u16(134, 1);
  u16(148, 224);
  u16(152, 0x10b);
  u32(264, 4096);
  u32(268, 256);
  u32(384, 256);
  u32(388, 4096);
  u32(392, 256);
  u32(396, 512);
  for (const [at, name, target] of [
    [0, 16, 0x80000018],
    [24, 1, 0x80000030],
    [48, 1041, 72],
  ]) {
    u16(512 + at + 14, 1);
    u32(512 + at + 16, name);
    u32(512 + at + 20, target);
  }
  u32(584, 4096 + 88);
  u32(588, 92);
  u16(600, 92);
  u16(602, 52);
  Array.from('VS_VERSION_INFO').forEach((character, index) =>
    u16(606 + index * 2, character.charCodeAt(0)),
  );
  u32(640, 0xfeef04bd);
  u32(644, 0x10000);
  const [a, b, c, d] = version.split('.').map(Number);
  u32(648, (a << 16) | b);
  u32(652, (c << 16) | d);
  return bytes;
}

test('ABI selection is exact and reports unknown, missing and conflicting engine candidates', async () => {
  const sdk = versionImage('2.6.1.74'),
    game = versionImage('2.6.1.76'),
    unknown = versionImage('2.6.1.99');
  assert.equal(readEngineVersion(sdk), '2.6.1.74');
  const source = (records) => ({
    names: () => Object.keys(records),
    require: async (name) => records[name],
  });
  const sdkProfile = 'sdk-4.01-engine-2.6.1.74';
  const selected = await selectNativeProfile(
    source({ 'cs2_open.exe': sdk, 'StView.exe': versionImage('1.0.0.0') }),
  );
  assert.equal(selected.profile, sdkProfile);
  assert.equal(selected.module.name, 'cs2_open.exe');
  assert.deepEqual(selected.module.resource, sdk.subarray(600, 692));
  await assert.rejects(
    selectNativeProfile(source({ 'unknown.exe': unknown })),
    /unknown.exe.*2.6.1.99.*reviewed per-version ABI data/,
  );
  await assert.rejects(selectNativeProfile(source({})), /unique supported/);
  await assert.rejects(
    selectNativeProfile(source({ 'a.exe': sdk, 'b.exe': game })),
    /a.exe.*b.exe/,
  );
  await assert.rejects(
    selectNativeProfile(source({ 'a.exe': sdk, 'copy.exe': sdk })),
    /a.exe.*copy.exe/,
  );
  await assert.rejects(selectNativeProfile(source({}), 'unregistered'), /Unregistered.*ABI/);
  assert.deepEqual(await selectNativeProfile(source({}), sdkProfile), {
    profile: sdkProfile,
    module: null,
  });
  assert.deepEqual(await selectNativeProfile({}, sdkProfile), {
    profile: sdkProfile,
    module: null,
  });
  assert.equal(
    (await selectNativeProfile(source({ 'cs2_open.exe': sdk }), sdkProfile)).module.name,
    'cs2_open.exe',
  );
  assert.deepEqual(
    await selectNativeProfile(source({ 'a.exe': sdk, 'copy.exe': sdk }), sdkProfile),
    { profile: sdkProfile, module: null },
  );
  assert.deepEqual(await selectNativeProfile(source({ 'unknown.exe': unknown }), sdkProfile), {
    profile: sdkProfile,
    module: null,
  });
  for (const name of ['toString', 'constructor', '__proto__'])
    await assert.rejects(selectNativeProfile(source({}), name), /Unregistered.*ABI/);
});

test('reviewed ABI services expose independent capabilities and serializable layouts', () => {
  const sdk = nativeABI('sdk-4.01-engine-2.6.1.74'),
    game = nativeABI('nekopara-vol3-engine-2.6.1.76');
  assert.deepEqual([sdk.sound.banks, game.sound.banks], [32, 64]);
  assert.deepEqual(
    [sdk.graphics.textureCapsPolicy, game.graphics.textureCapsPolicy],
    ['virtual-d3d9', 'virtual-d3d9'],
  );
  assert.deepEqual(
    [sdk.graphics.texturedBoundsQuery, game.graphics.texturedBoundsQuery],
    ['model-and-pages', 'model-and-pages'],
  );
  assert.deepEqual([sdk.messages.tilePlaneCommand, game.messages.tilePlaneCommand], [44, 46]);
  assert.deepEqual([sdk.layouts.memoryFile.wide, game.layouts.memoryFile.wide], [false, true]);
  assert.deepEqual(
    [sdk.layouts.motionCheckpoint.nameBytes, game.layouts.motionCheckpoint.nameBytes],
    [32, 64],
  );
  assert.deepEqual([sdk.sound.controlBytes, game.sound.controlBytes], [120, 140]);
  assert.deepEqual(
    [sdk.text.resourceMessages.first.cp932, game.text.resourceMessages.first.cp932],
    [444, 449],
  );
  assert.deepEqual(
    [sdk.text.resourceMessages.first.nv, game.text.resourceMessages.first.nv],
    [463, 489],
  );
  for (const abi of [sdk, game]) {
    assert.deepEqual(validateABI(JSON.parse(JSON.stringify(abi))), abi);
    assert.ok(Object.isFrozen(abi.configuration.memory.scalarFields));
    const missingTextureCaps = structuredClone(abi);
    delete missingTextureCaps.graphics.textureCapsPolicy;
    assert.throws(() => validateABI(missingTextureCaps), /behavior data/);
    const invalidTextureCaps = structuredClone(abi);
    invalidTextureCaps.graphics.textureCapsPolicy = 'unregistered';
    assert.throws(() => validateABI(invalidTextureCaps), /behavior data/);
    const missingTexturedQuery = structuredClone(abi);
    delete missingTexturedQuery.graphics.texturedBoundsQuery;
    assert.throws(() => validateABI(missingTexturedQuery), /behavior data/);
    const invalidTexturedQuery = structuredClone(abi);
    invalidTexturedQuery.graphics.texturedBoundsQuery = 'unregistered';
    assert.throws(() => validateABI(invalidTexturedQuery), /behavior data/);
    const missingCapability = structuredClone(abi);
    delete missingCapability.capabilities.steam;
    assert.throws(() => validateABI(missingCapability), /behavior data/);
    const missing = structuredClone(abi);
    delete missing.text;
    assert.throws(() => validateABI(missing), /behavior data/);
    const rule = structuredClone(abi);
    rule.messages.channels.base.canonical.push({ min: 10, max: 1, offset: 2 });
    assert.throws(() => validateABI(rule), /message rule/);
    const executable = structuredClone(abi);
    executable.text.transform = () => {};
    assert.throws(() => validateABI(executable), /plain data/);
  }
  assert.equal(nativeABI(sdk.profile).plugins.emoteDriver, 'placeholder');
  assert.equal(game.capabilities.embeddedJavaScript, false);
});

const sdkGoldens = {
  'control/canonical': 'e3230052a1bee7ac07b825ae89fcab481b31a07e31a07afd603c186caa08211e',
  // Stage7 corrects only the independently verified kind34 inverse (331→326).
  'control/raw': 'b21fd23310916477247949f10f8ec54a280232a3681e2bb3c01a81b820120c29',
  'screen/canonical': '9abb84a23c969ed05acf4b228aa5d45e8d382a6548e1c276bd1e70165cd76b07',
  'screen/raw': '7a87eba2e58a8dcf328bd71216772670c52abd1a77bffba6297286729851076c',
  'area/canonical': '7e52f3e717f6eb5c7f7bd06712112cdd43f881826e76c048084ffaeaecff77d8',
  'area/raw': 'd061722e9cd46fdd0f862b6fac6d164aca9a63555d4c3cbdbe49b978f7fb1e09',
};
const identityGolden = '3d117551a52e0dbfcd62466d43977057af5a48f35cb71f98998f67780a3e9cc8';

test('ABI message data retains every original control, screen and area boundary for both versions', () => {
  // These complete transport hashes are the two captured version corpora,
  // not a default for every independently registered engine.
  for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
    for (const [key, golden] of Object.entries(sdkGoldens)) {
      const abi = nativeABI(profile);
      const [channel, direction] = key.split('/'),
        bytes = Buffer.alloc(71 * 605 * 4);
      let index = 0;
      for (let kind = 0; kind <= 70; kind++)
        for (let message = -4; message <= 600; message++)
          bytes.writeInt32LE(
            mapABIMessage(abi.profile, channel, direction, message, kind),
            index++ * 4,
          );
      const expected = abi.engineVersion === '2.6.1.74' ? golden : identityGolden;
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${abi.id}/${key}`);
    }
  assert.throws(
    () => mapABIMessage(Object.keys(NATIVE_ABIS)[0], 'missing', 'raw', 0),
    /Unknown ABI message/,
  );
});

test('67 admits the reviewed Sound and Script cursor message without admitting its neighbors', () => {
  const profile = 'bokutomo-engine-2.6.1.67',
    other = 'rebellions-jp-engine-2.6.1.63';
  for (const direction of ['canonical', 'raw']) {
    assert.equal(mapABIMessage(profile, 'sound', direction, 22), 22);
    assert.throws(() => mapABIMessage(profile, 'sound', direction, 21), /Unreviewed ABI message/);
    assert.throws(() => mapABIMessage(other, 'sound', direction, 22), /Unreviewed ABI message/);
  }
  for (const field of ['soundBaseOnly', 'scriptForward']) {
    assert.deepEqual(nativeABIBehavior(profile, 'messages.' + field), [22]);
    assert.throws(() => nativeABIBehavior(other, 'messages.' + field), /Unreviewed ABI behavior/);
    for (const words of [22, [22, 22], [-1], [0x100000000]]) {
      const invalid = structuredClone(nativeABI(profile));
      invalid.messages[field] = words;
      assert.throws(() => validateABI(invalid), /Invalid ABI message policy/);
    }
  }
});

test('the optional Sound same-ID policy accepts only booleans', () => {
  const abi = structuredClone(nativeABI('sdk-4.01-engine-2.6.1.74')),
    field = 'sameIdAllowsUnconfiguredSoundTree';
  assert.equal(abi.sound[field], true);
  assert.strictEqual(validateABI(abi), abi);
  for (const invalid of [null, 0, 1, 'true', []]) {
    abi.sound[field] = invalid;
    assert.throws(() => validateABI(abi), /Invalid ABI Sound same-ID policy/);
  }
  abi.sound[field] = false;
  assert.strictEqual(validateABI(abi), abi);
  delete abi.sound[field];
  assert.strictEqual(validateABI(abi), abi);
});

test('normal Root ABI protocol fields are strict while original field offsets remain separate', () => {
  for (const registered of Object.values(NATIVE_ABIS)) {
    const normal = structuredClone(registered);
    delete normal.messages.root.field;
    assert.equal(validateABI(normal), normal);
    for (const field of ['start', 'captionWide', 'soundReset']) {
      const missing = structuredClone(normal);
      delete missing.messages.root[field];
      assert.throws(() => validateABI(missing), /Root protocol/);
    }
    for (const [field, value] of [
      ['start', -1],
      ['start', 0x100000000],
      ['start', 30.5],
      ['captionWide', 0],
      ['captionWide', null],
      ['soundReset', -1],
      ['soundReset', 0x100000000],
      ['soundReset', 192.5],
    ]) {
      const invalid = structuredClone(normal);
      invalid.messages.root[field] = value;
      assert.throws(() => validateABI(invalid), /Root protocol/);
    }
  }
});

for (const profile of Object.keys(NATIVE_ABIS)) {
  test(`normal ABI keeps original-only structure layouts optional: ${profile}`, () => {
    const abi = structuredClone(nativeABI(profile));
    if (abi.layouts === null) {
      assert.throws(() => nativeABIBehavior(profile, 'layouts'), /Unreviewed ABI behavior/);
      assert.equal(typeof abi.unreviewed.layouts, 'string');
    } else {
      for (const name of ['motionCheckpoint', 'memoryFile', 'systemInformation'])
        delete abi.layouts[name];
      assert.ok(abi.layouts.textCores, 'reviewed normal text layout remains present');
    }
    assert.strictEqual(validateABI(abi), abi);
    assert.equal(abi.tables.main.entries.length, nativeABI(profile).tables.main.entries.length);
    assert.throws(() => nativeABI('cs2-unregistered-own-layout'), /Unregistered CatSystem2 ABI/);
  });
}

test('finite old ABI normal requirements reject missing data and do not invent unknown capabilities', () => {
  for (const profile of ['rebellions-jp-engine-2.6.1.63', 'bokutomo-engine-2.6.1.67']) {
    const abi = nativeABI(profile);
    assert.deepEqual(validateABI(structuredClone(abi)), abi);
    for (const path of [
      'language.storage',
      'fes.controlResources',
      'plugins.requiredRenderer',
      'graphics.texturedBoundsQuery',
    ])
      assert.throws(() => nativeABIBehavior(profile, path), /Unreviewed ABI behavior/);
    for (const mutate of [
      (data) => {
        delete data.startup.applicationServices;
      },
      (data) => {
        data.startup.applicationServices = ['root-script'];
      },
      (data) => {
        data.startup.applicationServices.push('textures');
      },
      (data) => {
        delete data.configuration.defaults.font;
      },
      (data) => {
        data.configuration.defaults.window.pop();
      },
      (data) => {
        data.sound.legacyVolumeAliases.bgm = 3;
      },
      (data) => {
        delete data.unreviewed['capabilities.steam'];
      },
      (data) => {
        data.capabilities.steam = false;
      },
    ]) {
      const invalid = structuredClone(abi);
      mutate(invalid);
      assert.throws(() => validateABI(invalid), /Invalid ABI/);
    }
    assert.equal(abi.capabilities.steam, null);
    assert.equal(typeof abi.unreviewed['capabilities.steam'], 'string');
    assert.equal(abi.tables.main.entries[0x181].status, 'unknown');
  }
});
