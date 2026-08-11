// Pure helpers for the admin "update available" check.
//
// The check asks Docker Hub what is PUBLISHED rather than GitHub what is
// COMMITTED, because a commit is not installable until CI has built and pushed
// it. The registry answers the question actually being asked: is there a newer
// image I can pull right now?
//
// Everything here is pure so it can be unit-tested against captured Hub payloads
// (server/updateCheck.test.mjs); the HTTP fetch and the TTL cache live in
// server/app.js.

// Docker Hub repository names are lowercase alphanumerics plus [._-], one slash.
// Validated before interpolation so a misconfigured value can't reshape the URL.
export const DOCKER_REPO_PATTERN =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

// The immutable per-commit tag CI publishes alongside the moving one.
const SHA_TAG_PATTERN = /^sha-[0-9a-f]{7,40}$/;

// Every digest a Hub tag entry advertises: the single-platform `digest`, plus one
// per architecture under `images` for a multi-arch manifest list. Comparing
// against the whole set is what makes the moving-tag → sha-* match work whether
// CI pushed a plain manifest or an index.
export function tagDigests(entry) {
  const out = new Set();
  if (typeof entry?.digest === 'string' && entry.digest) out.add(entry.digest);
  for (const image of Array.isArray(entry?.images) ? entry.images : []) {
    if (typeof image?.digest === 'string' && image.digest) out.add(image.digest);
  }
  return out;
}

/**
 * Resolve what a `docker compose pull` would actually bring down.
 *
 * @param {object} moving  Hub tag entry for the moving tag (`latest`).
 * @param {object[]} tags  Hub tag list, newest first (`ordering=last_updated`).
 * @returns {{version: string, publishedAt: string|null, digest: string|null,
 *            matchedByDigest: boolean}}
 * @throws  when the repository publishes no sha-* tag to compare against.
 */
export function resolvePublishedVersion(moving, tags) {
  const movingDigests = tagDigests(moving);
  const shaTags = (Array.isArray(tags) ? tags : []).filter((t) =>
    SHA_TAG_PATTERN.test(String(t?.name || '')),
  );

  // Preferred: the sha-* tag pointing at the same image the moving tag does.
  let match = shaTags.find((t) => {
    for (const digest of tagDigests(t)) {
      if (movingDigests.has(digest)) return true;
    }
    return false;
  });
  const matchedByDigest = Boolean(match);
  // Fallback for a repository whose digests aren't exposed (or a moving tag
  // pushed without its sha-* sibling): assume the newest sha-* tag is the one.
  if (!match) match = shaTags[0];

  if (!match) {
    throw new Error('no sha-tagged image published for this repository');
  }

  return {
    version: String(match.name).slice('sha-'.length),
    publishedAt: moving?.last_updated || moving?.tag_last_pushed || match.last_updated || null,
    digest: movingDigests.values().next().value || null,
    matchedByDigest,
  };
}
