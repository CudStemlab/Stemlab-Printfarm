// Tests for the rollback target validator (server/updateRollback.js).
// No test runner in this project — run directly:  node server/updateRollback.test.mjs
//
// This is security-relevant: the value validated here becomes a GitHub workflow
// input, a Docker image tag, and part of a URL. Anything that gets past these
// two functions is trusted by all three.

import assert from 'node:assert/strict';
import { isValidSha, normalizeSha } from './updateRollback.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

// Hostile or plainly malformed — BOTH functions must refuse these.
const HOSTILE = [
  '', 'abc', 'zzzzzzz', 'a'.repeat(41),
  '../../etc/passwd', 'abc1234/../x',
  'abc1234;rm -rf /', '$(id)', 'ab$c1234',
  'abc 1234', 'abc1234?x=1', 'abc1234%0a',
  null, undefined, 123, {}, [],
];

t('hostile input is rejected by both validators', () => {
  for (const value of HOSTILE) {
    assert.equal(isValidSha(value), false, `isValidSha accepted ${JSON.stringify(value)}`);
    assert.equal(normalizeSha(value), null, `normalizeSha accepted ${JSON.stringify(value)}`);
  }
});

t('canonical SHAs pass through unchanged', () => {
  for (const value of ['abc1234', '0123456789abcdef0123456789abcdef01234567']) {
    assert.equal(isValidSha(value), true);
    assert.equal(normalizeSha(value), value);
  }
});

// Case is accepted (hex cannot carry metacharacters) but canonicalized to the
// lowercase form git and the image tags actually use.
t('uppercase hex is accepted and lowercased', () => {
  assert.equal(isValidSha('DEADBEEF'), true);
  assert.equal(normalizeSha('DEADBEEF'), 'deadbeef');
  assert.equal(normalizeSha('AbC1234'), 'abc1234');
});

// The important asymmetry: isValidSha does NOT trim. A string with whitespace is
// not the string a caller would use, so reporting it "valid" would be a trap for
// any future caller that validates without normalizing. normalizeSha is the
// funnel that makes such a value safe.
t('whitespace is rejected by the strict check but canonicalized by the funnel', () => {
  for (const [input, want] of [
    ['abc1234\n', 'abc1234'],
    ['  ABC1234  ', 'abc1234'],
    ['\tabc1234', 'abc1234'],
  ]) {
    assert.equal(isValidSha(input), false, `isValidSha should not accept ${JSON.stringify(input)}`);
    assert.equal(normalizeSha(input), want);
  }
});

t('normalizeSha output always satisfies isValidSha', () => {
  for (const value of ['abc1234', '  DEADBEEF ', 'AbC1234\n']) {
    const canonical = normalizeSha(value);
    assert.notEqual(canonical, null);
    assert.equal(isValidSha(canonical), true);
  }
});

console.log(`\nALL ${n} ROLLBACK-VALIDATOR TESTS PASSED ✅`);
