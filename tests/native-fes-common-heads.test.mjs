// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as abiAPI from '../src/native/abi/index.mjs';
import {
  lookupFESCommonHead,
  FES_COMMON_HEAD_BINDING_REVIEWS,
} from '../src/native/abi/fes-common-heads.mjs';

const bytes = (value) => new TextEncoder().encode(value),
  sdk = 'sdk-4.01-engine-2.6.1.74',
  game = 'nekopara-vol3-engine-2.6.1.76',
  sdkOnly = ['calljs', 'endjs', 'execjs'],
  gameOnly = [
    'cgreg_getlist',
    'dbgstru8',
    'm2_getconf',
    'm2_resetview',
    'm2_setconf',
    'm2_waiteff',
    'steam_achievement',
    'steam_achievement_reset',
    'steam_enablescreenshot',
    'steam_init',
    'steam_isbroadcast',
    'steam_isenable',
  ];

for (const [profile, count, additions] of [
  [sdk, 122, sdkOnly],
  [game, 131, gameOnly],
]) {
  test(`native FES common catalogue keeps registered presence separate from dispatch: ${profile}`, async () => {
    const abi = abiAPI.nativeABI(profile),
      missing = structuredClone(abi);
    delete missing.fes.commonHeads;
    // The old validator accepts this missing registration, even though the ABI exists.
    assert.throws(() => abiAPI.validateABI(missing), /FES common head registration/);

    const registration = abi.fes.commonHeads,
      sdkRegistration = abiAPI.nativeABI(sdk).fes.commonHeads,
      gameRegistration = abiAPI.nativeABI(game).fes.commonHeads,
      members = (value) => [...value.shared, ...value.additions].sort(),
      sdkMembers = members(sdkRegistration),
      gameMembers = members(gameRegistration),
      union = [...new Set([...sdkMembers, ...gameMembers])].sort(),
      intersection = sdkMembers.filter((word) => gameMembers.includes(word));
    assert.equal(registration.count, count);
    assert.equal(registration.complete, true);
    assert.equal(registration.comparison, 'byte-exact-cstring');
    assert.equal(registration.shared.length, 119);
    assert.deepEqual(registration.additions, additions);
    assert.strictEqual(sdkRegistration.shared, gameRegistration.shared);
    assert.equal(sdkMembers.length, 122);
    assert.equal(gameMembers.length, 131);
    assert.equal(intersection.length, 119);
    assert.equal(union.length, 134);
    assert.deepEqual(
      gameMembers.filter((word) => !sdkMembers.includes(word)),
      gameOnly,
    );
    assert.deepEqual(
      sdkMembers.filter((word) => !gameMembers.includes(word)),
      sdkOnly,
    );
    assert.ok(Object.isFrozen(registration));
    assert.ok(Object.isFrozen(registration.shared));
    assert.deepEqual(abiAPI.validateABI(JSON.parse(JSON.stringify(abi))), abi);

    const query = abiAPI.nativeFESCommonHead,
      keyword = bytes('if'),
      selected = query(profile, keyword);
    assert.equal(selected.kind, 'present');
    assert.equal(selected.entry.keyword, 'if');
    keyword.fill(120);
    assert.equal(selected.entry.keyword, 'if');
    assert.strictEqual(query(sdk, bytes('if')).entry, query(game, bytes('if')).entry);
    assert.strictEqual(
      query(profile, Uint8Array.from([...bytes('if'), 0, ...bytes('AFTER_NUL')])).entry,
      selected.entry,
    );
    for (const absent of ['IF', 'if ', '__proto__', 'definitely_not_native_common'])
      assert.deepEqual(query(profile, bytes(absent)), { kind: 'absent' });
    assert.deepEqual(query(profile, new Uint8Array()), { kind: 'absent' });
    assert.throws(
      () => query('unregistered-fes-profile', undefined),
      /Unregistered CatSystem2 ABI/,
    );
    assert.throws(() => query(profile, 'if'), /narrow bytes/);

    for (const word of sdkOnly) {
      const actual = query(sdk, bytes(word));
      assert.equal(actual.kind, 'present');
      assert.equal(actual.entry.semanticLink, null);
      assert.equal(actual.entry.dispatchBinding, null);
      assert.deepEqual(query(game, bytes(word)), { kind: 'absent' });
    }
    for (const word of gameOnly) {
      assert.equal(query(game, bytes(word)).kind, 'present');
      assert.deepEqual(query(sdk, bytes(word)), { kind: 'absent' });
    }

    // These are navigation IDs only. No audit status is a native handler binding.
    const audit = JSON.parse(
        await readFile(new URL('../scripts/fes-audit.contracts.json', import.meta.url), 'utf8'),
      ),
      auditIDs = new Set(audit.contracts.map((row) => row.id));
    let linked = 0,
      pending = 0;
    for (const word of union) {
      const owner = sdkMembers.includes(word) ? sdk : game,
        result = query(owner, bytes(word));
      assert.equal(result.kind, 'present');
      const entry = result.entry;
      assert.equal(entry.keyword, word);
      assert.equal(
        entry.semanticLink,
        word === 'resetactive' ? 'fes.reference.cn.resetactive' : null,
      );
      assert.equal(entry.dispatchBinding, word === 'resetactive' ? 'active-reference-null' : null);
      assert.ok(Object.isFrozen(entry));
      assert.ok(Object.isFrozen(entry.nameCrossrefs));
      if (entry.nameCrossrefs.length) linked++;
      else pending++;
      for (const crossref of entry.nameCrossrefs) {
        assert.equal(crossref.kind, 'name-crossref-only');
        assert.ok(auditIDs.has(crossref.contractId));
        assert.ok(Object.isFrozen(crossref));
      }
    }
    assert.equal(linked, 77);
    assert.equal(pending, 57);
    assert.deepEqual(query(sdk, bytes('calljs')).entry.nameCrossrefs, []);
    assert.deepEqual(query(profile, bytes('btnsimulate')).entry.nameCrossrefs, [
      {
        contractId: 'fes-extension.drag---dragimg---draghelp---btnsimulate',
        kind: 'name-crossref-only',
      },
    ]);

    const ownReview = registration.reviewedBindings[0],
      otherReview = (profile === sdk ? gameRegistration : sdkRegistration).reviewedBindings[0];
    assert.equal(registration.reviewedBindings.length, 1);
    assert.ok(Object.isFrozen(registration.reviewedBindings));
    assert.deepEqual(FES_COMMON_HEAD_BINDING_REVIEWS[ownReview], {
      binding: 'active-reference-null',
      operandGetters: 0,
      returnWord: 0,
      recordCode: profile === sdk ? 14 : 11,
      referenceBytes: 36,
      reference: 'null',
    });
    assert.strictEqual(
      query(sdk, bytes('resetactive')).entry,
      query(game, bytes('resetactive')).entry,
    );
    const unqualified = structuredClone(registration);
    unqualified.reviewedBindings = [];
    const present = lookupFESCommonHead(unqualified, bytes('resetactive'));
    assert.equal(present.kind, 'present');
    assert.equal(present.entry.semanticLink, null);
    assert.equal(present.entry.dispatchBinding, null);
    assert.deepEqual(
      present.entry.nameCrossrefs,
      query(profile, bytes('resetactive')).entry.nameCrossrefs,
    );

    const rejects = (change) => {
      const invalid = structuredClone(abi);
      change(invalid.fes.commonHeads);
      assert.throws(() => abiAPI.validateABI(invalid), /FES common head registration/);
    };
    rejects((value) => {
      value.comparison = 'case-insensitive';
    });
    rejects((value) => {
      value.complete = false;
    });
    rejects((value) => {
      value.count++;
    });
    rejects((value) => {
      value.additions[0] = value.shared[0];
    });
    rejects((value) => {
      value.additions[0] = 'unknown_catalogue_member';
    });
    rejects((value) => {
      value.shared[1] = value.shared[0];
    });
    rejects((value) => {
      value.additions.pop();
      value.count--;
    });
    rejects((value) => {
      value.unreviewed = true;
    });
    rejects((value) => {
      delete value.reviewedBindings;
    });
    rejects((value) => {
      value.reviewedBindings = ['unregistered-common-binding-review'];
    });
    rejects((value) => {
      value.reviewedBindings = [otherReview];
    });
    rejects((value) => {
      value.reviewedBindings = [ownReview, ownReview];
    });
  });
}
