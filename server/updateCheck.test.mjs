// Tests for the Docker Hub "update available" resolution.
//
// Run: node server/updateCheck.test.mjs
//
// The payload shapes below are trimmed copies of real hub.docker.com/v2 tag
// responses — the multi-arch case (digests under `images`) is the one that
// actually ships, so it is covered first.

import assert from 'node:assert/strict';
import { DOCKER_REPO_PATTERN, resolvePublishedVersion, tagDigests } from './updateCheck.js';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAILED: ${name}`);
    throw err;
  }
}

const INDEX = 'sha256:aaaa';
const AMD64 = 'sha256:bbbb';
const OLD_INDEX = 'sha256:cccc';

// ── repository-name validation ───────────────────────────────────────────────
check('accepts ordinary repository names', () => {
  assert.ok(DOCKER_REPO_PATTERN.test('saralray/printfarm'));
  assert.ok(DOCKER_REPO_PATTERN.test('my-org/print_farm.v2'));
});

check('rejects names that could reshape the request URL', () => {
  for (const bad of [
    'printfarm', // no namespace
    'ns/repo/extra',
    'ns/repo?page=1',
    'ns/../etc',
    'NS/Repo', // Hub names are lowercase
    'ns/repo tags',
    '',
  ]) {
    assert.equal(DOCKER_REPO_PATTERN.test(bad), false, `should reject: ${bad}`);
  }
});

// ── digest collection ────────────────────────────────────────────────────────
check('collects both the top-level digest and per-architecture ones', () => {
  const digests = tagDigests({ digest: INDEX, images: [{ digest: AMD64 }, { digest: null }] });
  assert.deepEqual([...digests].sort(), [INDEX, AMD64].sort());
});

check('tolerates a tag entry with no digests at all', () => {
  assert.equal(tagDigests({}).size, 0);
  assert.equal(tagDigests(null).size, 0);
});

// ── resolution ───────────────────────────────────────────────────────────────
check('matches the moving tag to the sha-* tag sharing its digest', () => {
  const moving = { name: 'latest', digest: INDEX, last_updated: '2026-08-12T10:00:00Z' };
  const tags = [
    { name: 'latest', digest: INDEX, last_updated: '2026-08-12T10:00:00Z' },
    { name: 'sha-abc123def456', digest: INDEX, last_updated: '2026-08-12T09:59:00Z' },
    { name: 'sha-0000deadbeef', digest: OLD_INDEX, last_updated: '2026-08-01T00:00:00Z' },
  ];
  const out = resolvePublishedVersion(moving, tags);
  assert.equal(out.version, 'abc123def456');
  assert.equal(out.matchedByDigest, true);
  assert.equal(out.publishedAt, '2026-08-12T10:00:00Z');
  assert.equal(out.digest, INDEX);
});

check('matches through a multi-arch manifest list', () => {
  const moving = { name: 'latest', images: [{ digest: AMD64 }], last_updated: '2026-08-12T10:00:00Z' };
  const tags = [
    { name: 'sha-feedfacefeed', images: [{ digest: AMD64 }], last_updated: '2026-08-12T09:59:00Z' },
  ];
  assert.equal(resolvePublishedVersion(moving, tags).version, 'feedfacefeed');
});

check('is NOT fooled into the newest tag when latest points at an older build', () => {
  // This is the rollback case: `latest` was re-pointed at an older commit, so the
  // installable version is that older one — not the newest tag in the list.
  const moving = { name: 'latest', digest: OLD_INDEX, last_updated: '2026-08-12T12:00:00Z' };
  const tags = [
    { name: 'sha-newnewnewnew', digest: INDEX, last_updated: '2026-08-12T11:00:00Z' },
    { name: 'sha-0000deadbeef', digest: OLD_INDEX, last_updated: '2026-08-01T00:00:00Z' },
  ];
  const out = resolvePublishedVersion(moving, tags);
  assert.equal(out.version, '0000deadbeef');
  assert.equal(out.matchedByDigest, true);
});

check('falls back to the newest sha-* tag when no digest matches', () => {
  const moving = { name: 'latest', last_updated: '2026-08-12T10:00:00Z' }; // no digest exposed
  const tags = [
    { name: 'sha-111111111111', last_updated: '2026-08-12T09:00:00Z' },
    { name: 'sha-222222222222', last_updated: '2026-08-01T09:00:00Z' },
  ];
  const out = resolvePublishedVersion(moving, tags);
  assert.equal(out.version, '111111111111');
  assert.equal(out.matchedByDigest, false);
});

check('ignores tags that are not sha-<hex>', () => {
  const moving = { name: 'latest', digest: INDEX };
  const tags = [
    { name: 'latest', digest: INDEX },
    { name: 'sha-nothexadecimal', digest: INDEX },
    { name: 'v1.2.3', digest: INDEX },
    { name: 'sha-abcdef1', digest: INDEX }, // 7 chars is the shortest accepted
  ];
  assert.equal(resolvePublishedVersion(moving, tags).version, 'abcdef1');
});

check('throws when the repository publishes no sha-* tag', () => {
  assert.throws(
    () => resolvePublishedVersion({ name: 'latest', digest: INDEX }, [{ name: 'latest', digest: INDEX }]),
    /no sha-tagged image/,
  );
  assert.throws(() => resolvePublishedVersion({ name: 'latest' }, []), /no sha-tagged image/);
  assert.throws(() => resolvePublishedVersion({ name: 'latest' }, null), /no sha-tagged image/);
});

// ── the comparison the endpoint performs ─────────────────────────────────────
check('a 12-char published tag prefix-matches the full baked SHA', () => {
  const current = 'abc123def456789012345678901234567890abcd'; // 40-char APP_VERSION
  const { version } = resolvePublishedVersion(
    { name: 'latest', digest: INDEX },
    [{ name: 'sha-abc123def456', digest: INDEX }],
  );
  const updateAvailable = !version.startsWith(current) && !current.startsWith(version);
  assert.equal(updateAvailable, false, 'same commit must not report an update');
});

check('a different published commit reports an update', () => {
  const current = 'abc123def456789012345678901234567890abcd';
  const { version } = resolvePublishedVersion(
    { name: 'latest', digest: INDEX },
    [{ name: 'sha-999999999999', digest: INDEX }],
  );
  const updateAvailable = !version.startsWith(current) && !current.startsWith(version);
  assert.equal(updateAvailable, true);
});

console.log(`${passed} updateCheck assertions passed ✅`);
