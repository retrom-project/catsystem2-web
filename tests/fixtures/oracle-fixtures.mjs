// SPDX-License-Identifier: MPL-2.0
import { readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeABI } from '../../src/native/abi/index.mjs';
import { readEngineVersion } from '../../src/native/profile.mjs';

const references = JSON.parse(
  await readFile(new URL('../../references.json', import.meta.url), 'utf8'),
);
export const engineFixtures = Object.freeze([
  Object.freeze({
    profile: 'sdk-4.01-engine-2.6.1.74',
    variable: 'CATSYSTEM2_SDK_EXE',
    sha256: references.nativeReference.engineSha256,
  }),
  Object.freeze({
    profile: 'nekopara-vol3-engine-2.6.1.76',
    variable: 'CATSYSTEM2_ENGINE_EXE',
    sha256: references.gameNativeReference.preparedEngineSha256,
  }),
]);

export async function engineFixture(profile, { env = process.env, required = false } = {}) {
  const abi = nativeABI(profile),
    definition = engineFixtures.find((item) => item.profile === profile);
  if (!definition) throw new Error(`No reviewed oracle fixture for ${abi.id}`);
  const filename = env[definition.variable];
  if (!filename) {
    const reason = `Missing private oracle fixture ${definition.variable} for ${abi.id}`;
    if (required) throw new Error(reason);
    return { available: false, reason, profile };
  }
  const bytes = new Uint8Array(await readFile(filename));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== definition.sha256 || readEngineVersion(bytes) !== abi.engineVersion)
    throw new Error(
      `Oracle fixture ${definition.variable} must match the reviewed ${abi.id} SHA-256 and version`,
    );
  return { available: true, profile, bytes, sha256, filename };
}

export async function engineFixtureSet(options) {
  return Promise.all(engineFixtures.map(({ profile }) => engineFixture(profile, options)));
}

export async function oracleFixtureSet({ env = process.env, required = false } = {}) {
  const fixtures = await engineFixtureSet({ env, required });
  if (required)
    for (const fixture of fixtures)
      await access(join(dirname(fixture.filename), 'config/startup.xml'));
  const emote = JSON.parse(
    await readFile(new URL('./native-emote-golden.json', import.meta.url), 'utf8'),
  );
  const ppi = JSON.parse(
    await readFile(new URL('./ppi-native-golden.json', import.meta.url), 'utf8'),
  );
  async function privateFile(variable, filename, expected, label) {
    if (!filename) {
      const reason = `Missing private fixture ${variable} for ${label}`;
      if (required) throw new Error(reason);
      return { available: false, reason };
    }
    const bytes = await readFile(filename);
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error(`Private fixture ${variable} has an unreviewed SHA-256 for ${label}`);
    return { available: true, label };
  }
  fixtures.push(
    await privateFile(
      'CATSYSTEM2_EMOTE_DLL',
      env.CATSYSTEM2_EMOTE_DLL,
      emote.driverSHA256,
      'E-mote driver',
    ),
  );
  if (!env.CATSYSTEM2_PPI_FIXTURES) {
    const reason = 'Missing private fixture CATSYSTEM2_PPI_FIXTURES for frozen PPI DLLs';
    if (required) throw new Error(reason);
    fixtures.push({ available: false, reason });
  } else {
    for (const plugin of ppi.plugins)
      fixtures.push(
        await privateFile(
          'CATSYSTEM2_PPI_FIXTURES',
          `${env.CATSYSTEM2_PPI_FIXTURES}/${plugin.name}`,
          plugin.pluginSHA256,
          plugin.name,
        ),
      );
  }
  if (required) await access(new URL('../../.local/vendor/ppi/unicorn_x86.js', import.meta.url));
  return fixtures;
}
