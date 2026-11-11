// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSPluginRuntime } from '../src/ppi/js-runtime.mjs';
import { PPIRegistry, ppiVersion, ppiIdentity } from '../src/ppi/plugin-identity.mjs';
import { PPIHost } from '../src/ppi/host.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
import { authoredPPI } from './fixtures/ppi-js-fixture.mjs';
import { VERIFIED_PPI_VERSIONS } from '../src/ppi/verified-versions.mjs';

const bytes = nativeParticleFixture(),
  identity = await ppiIdentity(bytes, 'authored.ppi'),
  verified = [{ name: identity.name, version: identity.version, sha256: identity.sha256 }],
  options = {
    name: 'authored.ppi',
    count: 2,
    width: 64,
    height: 32,
    screenWidth: 320,
    screenHeight: 240,
  };
const registry = () => new PPIRegistry({ implementations: { authored: authoredPPI }, verified });

test('unverified version/hash warns once and continues the same implementation and host API', async () => {
  const warnings = [],
    r = new JSPluginRuntime({ registry: registry(), warn: (s) => warnings.push(s) });
  try {
    const known = await r.create(bytes, options);
    assert.equal(warnings.length, 0);
    for (let n = 0; n < 2; n++) {
      const unknown = await r.create(nativeParticleFixture({ version: 0x30009 }), options);
      unknown.host.SetRenderState(27, 1);
      assert.equal(unknown.version, 0x30009);
      assert.equal(unknown.host.version, 0x20002);
      assert.equal(unknown.module, known.module);
      assert.equal(unknown.active, true);
    }
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /authored\.ppi PPI=3\.9 sha256=[0-9a-f]{64}; continuing with authored-js/,
    );
    const changed = new Uint8Array(bytes.length + 1);
    changed.set(bytes);
    const sameVersion = await r.create(changed, options);
    assert.equal(sameVersion.version, 0x20002);
    assert.equal(sameVersion.active, true);
    assert.match(warnings[1], /PPI=2\.2.*continuing with authored-js/);
    const unknownContainer = await r.create(new Uint8Array([1, 2, 3]), options);
    assert.equal(unknownContainer.active, true);
    assert.match(warnings[2], /PPI=unknown.*continuing with authored-js/);
  } finally {
    r.close();
  }
});

test('unverified identity on a fresh restore warns once and closing a pending load prevents callbacks', async () => {
  const warnings = [],
    r = new JSPluginRuntime({ registry: registry(), warn: (s) => warnings.push(s) });
  let fresh;
  try {
    await r.create(nativeParticleFixture({ version: 0x10000 }), options);
    assert.equal(warnings.length, 1);
    fresh = await JSPluginRuntime.fromSnapshot(r.snapshot(), {
      registry: registry(),
      warn: (s) => warnings.push(s),
    });
    assert.equal(warnings.length, 2);
    assert.deepEqual(fresh.snapshot(), r.snapshot());
    fresh.restore(fresh.snapshot());
    assert.equal(warnings.length, 2);
    const pending = r.create(bytes, options);
    r.close();
    await assert.rejects(pending, /runtime is closed/);
    assert.equal(r.instances.size, 0);
    assert.equal(r.modules.size, 0);
  } finally {
    fresh?.close();
    r.close();
  }
});

test(
  'private pinned PPI versions agree with static identity data',
  {
    skip: !process.env.CATSYSTEM2_PPI_FIXTURES && 'requires private CATSYSTEM2_PPI_FIXTURES',
  },
  async () => {
    for (const expected of VERIFIED_PPI_VERSIONS) {
      const bytes = await readFile(
          join(process.env.CATSYSTEM2_PPI_FIXTURES, expected.name + '.ppi'),
        ),
        actual = await ppiIdentity(bytes, expected.name);
      assert.equal(ppiVersion(bytes), expected.version);
      assert.deepEqual(
        { name: actual.name, version: actual.version, sha256: actual.sha256 },
        expected,
      );
    }
  },
);

test('no implementation fails explicitly with name/version/hash, without choosing a fallback', async () => {
  const r = new JSPluginRuntime({ registry: registry() });
  try {
    await assert.rejects(r.create(bytes, { ...options, name: 'ptclpi/missing.ppi' }), (error) => {
      assert.equal(error.code, 'CATSYSTEM2_PPI_UNSUPPORTED');
      assert.match(
        error.message,
        /missing\.ppi PPI=2\.2 sha256=[0-9a-f]{64}; no JavaScript implementation/,
      );
      return true;
    });
    assert.equal(r.instances.size, 0);
    assert.equal(r.modules.size, 0);
    assert.equal(ppiVersion(bytes.subarray(0, 20)), null);
  } finally {
    r.close();
  }
});

test('fresh host restores shared module data, records, private state and RNG without Init/construct', async () => {
  let attached = { base: [1, 2, 3], pos: [4, 5, 6], disp: 1 };
  const r = new JSPluginRuntime({ registry: registry(), now: () => 17 }),
    first = await r.create(bytes, { ...options, attachPlane: 12, attachment: () => attached }),
    second = await r.create(bytes, options);
  let fresh;
  try {
    first.update(0);
    second.update(1);
    first.parameters.values[0] = 999;
    first.registers[0] = 7;
    const records = first.records(),
      vector = first.particle(0).pos;
    attached = null;
    first.update(2);
    assert.equal(first.records(), records);
    assert.equal(first.particle(0).pos, vector);
    assert.equal(first.parameters.values[0], 7);
    assert.deepEqual([...first.attachBase], [1, 2, 3]);
    const saved = r.snapshot(),
      frozen = structuredClone(saved);
    fresh = await JSPluginRuntime.fromSnapshot(saved, {
      registry: registry(),
      instanceOptions: () => ({ attachment: () => attached }),
    });
    assert.deepEqual(fresh.snapshot(), saved);
    assert.equal(fresh.modules.get('authored').shared.constructs, 2);
    for (const frame of [3, 11])
      for (const i of [first, second]) {
        i.update(frame);
        fresh.instances.get(i.id).update(frame);
      }
    assert.deepEqual(fresh.snapshot(), r.snapshot());
    assert.deepEqual(saved, frozen);
    first.attachPlane = -1;
    first.update(12);
    assert.deepEqual([...first.attachBase, ...first.attachPos], [0, 0, 0, 0, 0, 0]);
    first.stop();
    first.stop();
    assert.equal(first.module.shared.stops, 2);
    first.start();
    assert.equal(first.state.inits, 2);
    first.close();
    assert.equal(r.modules.size, 1);
    second.close();
    assert.equal(r.modules.size, 0);
  } finally {
    fresh?.close();
    r.close();
  }
});

test('host 2.1/2.2 APIs use typed JS references, preserve records and gate implementation slots', async () => {
  const r = new JSPluginRuntime({ registry: registry() }),
    i = await r.create(bytes, {
      ...options,
      readParticleData: (name) => (name === 'x' ? Uint8Array.of(1, 2, 3) : null),
    });
  try {
    assert.deepEqual(i.host.GetScreenSize(), [320, 240]);
    const host21 = new PPIHost(i, 0x20001);
    host21.SetZShift(0, 2.5);
    host21.SetZShift(-1, 99);
    assert.equal(i.zShifts[0], 2.5);
    assert.throws(() => host21.LoadParticleData('x'), /outside.*host API/);
    const target = new Uint8Array(3);
    assert.equal(i.host.LoadParticleData('x', target), 3);
    assert.deepEqual(target, Uint8Array.of(1, 2, 3));
    assert.equal(i.host.LoadParticleData('missing'), 0);
    i.host.SetRenderState(27, -1);
    i.host.SetSamplerState(5, 1);
    assert.equal(i.renderStates.get(27), 0xffffffff);
    assert.equal(i.samplerStates.get(5), 1);
    const p = i.particle(1);
    p.pos.set([1 / 3, -0, Infinity]);
    assert.equal(p.pos.x, Math.fround(1 / 3));
    assert.ok(Object.is(p.pos[1], -0));
    p.vertices[2].color = 0x12345678;
    assert.equal(new DataView(i.records().buffer).getUint32(148 + 48 + 12, true), 0x12345678);
    assert.throws(() => i.host.abs(-1), /recursive virtual slot/);
    assert.throws(() => i.host.service(99), /outside.*host API/);
    i.host.Exit();
    assert.equal(i.active, false);
    assert.equal(i.stopped, false);
  } finally {
    r.close();
  }
});
