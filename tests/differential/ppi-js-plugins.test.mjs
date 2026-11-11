// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSPluginRuntime } from '../../src/ppi/js-runtime.mjs';
import { PPIRegistry } from '../../src/ppi/plugin-identity.mjs';
import { PPI_IMPLEMENTATIONS } from '../../src/ppi/plugins/index.mjs';
import { VERIFIED_PPI_VERSIONS } from '../../src/ppi/verified-versions.mjs';
import { recordPPIFrames } from '../../oracle/plugin-frames.mjs';
import { compactPPIFrame } from '../../scripts/record-ppi-js-oracle.mjs';
import { PPI_SCENARIOS, scenarioPlist } from '../fixtures/ppi-js-scenarios.mjs';

const sha = (data) => createHash('sha256').update(data).digest('hex');
const baseline = JSON.parse(
  await readFile(new URL('../fixtures/ppi-js-plugins-golden.json', import.meta.url)),
);
const motion = JSON.parse(
  await readFile(new URL('../fixtures/ppi-js-motion-golden.json', import.meta.url)),
);
const plist = new Uint8Array(
  await readFile(new URL('../fixtures/ppi-native.plist', import.meta.url)),
);
const bytes = new Uint8Array([1, 2, 3]); // Authored identity carrier; the JS algorithms do not execute it.
function runtimeOptions(resource, attachment) {
  return {
    registry: new PPIRegistry({ implementations: PPI_IMPLEMENTATIONS }),
    warn: () => {},
    now: () => 0,
    readParticleData: () => resource,
    instanceOptions: () => ({ attachment: () => attachment.value }),
  };
}
function sameState(actual, expected, label) {
  for (const key of Object.keys(expected)) {
    if (key === 'records' && actual.records !== expected.records) {
      const a = Buffer.from(actual.records, 'hex'),
        b = Buffer.from(expected.records, 'hex');
      let at = 0;
      while (at < a.length && a[at] === b[at]) at++;
      assert.fail(
        label +
          ': record byte ' +
          at +
          ' (particle ' +
          Math.floor(at / 148) +
          ', field byte ' +
          (at % 148) +
          ') differs',
      );
    }
    assert.deepEqual(actual[key], expected[key], label + ' ' + key);
  }
}
function withoutTypedAllocation(callback) {
  const originals = new Map();
  for (const name of ['Uint8Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array']) {
    originals.set(name, globalThis[name]);
    globalThis[name] = new Proxy(globalThis[name], {
      construct() {
        throw new Error('Per-frame ' + name + ' allocation');
      },
    });
  }
  try {
    return callback();
  } finally {
    for (const [name, value] of originals) globalThis[name] = value;
  }
}

test('all twelve JS algorithms reproduce the frozen normal-engine DLL records and RNG exactly', async () => {
  assert.equal(baseline.controlWord, 0x7f);
  assert.equal(Object.keys(PPI_IMPLEMENTATIONS).length, 12);
  for (const row of baseline.plugins) {
    const key = row.name.replace('.ppi', ''),
      known = VERIFIED_PPI_VERSIONS.find((p) => p.name === key);
    assert.equal(row.pluginSHA256, known.sha256);
    const attachment = { value: baseline.options.attachment },
      runtime = new JSPluginRuntime(runtimeOptions(plist, attachment));
    try {
      const options = baseline.options;
      const p = await runtime.create(bytes, {
        ...options,
        name: row.name,
        attachment: () => attachment.value,
      });
      const actual = recordPPIFrames(p, baseline.frames).map(({ random, ...state }) => ({
        ...state,
        randomSHA256: sha(JSON.stringify(random)),
      }));
      for (let n = 0; n < actual.length; n++)
        sameState(actual[n], row.frames[n], row.name + '/' + n);
    } finally {
      runtime.close();
    }
  }
});

test('nondegenerate motion, tails, respawn, parameter changes and fresh checkpoints match DLL outputs', async (t) => {
  assert.equal(motion.controlWord, 0x7f);
  assert.equal(
    motion.inputsSHA256,
    sha(await readFile(new URL('../fixtures/ppi-js-scenarios.mjs', import.meta.url))),
  );
  assert.equal(
    motion.recorderSHA256,
    sha(await readFile(new URL('../../oracle/plugin-frames.mjs', import.meta.url))),
  );
  for (let at = 0; at < PPI_SCENARIOS.length; at++) {
    const scenario = PPI_SCENARIOS[at],
      expected = motion.cases[at];
    await t.test(expected.name + '/' + expected.label, async () => {
      const attachment = { value: scenario.options.attachment },
        resource = scenarioPlist(plist, scenario.plist),
        options = runtimeOptions(resource, attachment);
      let runtime = new JSPluginRuntime(options),
        p;
      try {
        const instanceOptions = scenario.options;
        p = await runtime.create(bytes, {
          ...instanceOptions,
          name: scenario.name + '.ppi',
          attachment: () => attachment.value,
        });
        sameState(compactPPIFrame(p, 'Init'), expected.states[0], 'Init');
        const records = p.records();
        for (let n = 0; n < scenario.actions.length; n++) {
          const action = scenario.actions[n];
          if (action.registers) p.setRegisters(action.registers);
          if (action.attachment) attachment.value = action.attachment;
          if (action.stop) p.stop();
          else if (action.start) p.start();
          else withoutTypedAllocation(() => p.update(action.frame));
          sameState(
            compactPPIFrame(p, action.stop ? 'Stop' : action.start ? 'Init' : 'Exec'),
            expected.states[n + 1],
            'action ' + n,
          );
          if (n < 3) assert.equal(p.records(), records);
          if (n === 3) {
            const saved = structuredClone(runtime.snapshot());
            runtime.close();
            runtime = await JSPluginRuntime.fromSnapshot(saved, options);
            p = [...runtime.instances.values()][0];
            sameState(compactPPIFrame(p, 'Exec'), expected.states[n + 1], 'fresh restore');
          }
        }
      } finally {
        runtime.close();
      }
    });
  }
});
