// Rollback support for the admin update flow.
//
// THE PROBLEM: Watchtower can only ever re-pull the tag a container was started
// with (`:latest`). It has no concept of "switch to that other tag", so rolling
// back is not something Watchtower can be asked to do — the `:latest` tag itself
// has to be re-pointed at an older image in the registry, after which a perfectly
// ordinary Watchtower pull brings the farm back.
//
// WHY VIA CI: doing that retag from this container would mean holding a registry
// credential with WRITE scope. If the web tier were ever compromised, that
// credential lets an attacker push an arbitrary image which Watchtower then
// deploys as root on the farm host — a large escalation. Instead the retag runs
// in .github/workflows/rollback.yml, where the Docker Hub token already lives,
// and this module only *dispatches* that workflow using a fine-grained GitHub PAT
// scoped to one repo with `Actions: write`. The worst a leaked UPDATE_ROLLBACK_TOKEN
// achieves is re-deploying a commit CI already built from main.
//
// SECURITY: nothing here may surface a URL, token, or registry host to the
// caller. Every failure maps to a fixed operator-facing string; the detail is
// logged server-side only.

import { logger } from './logger.js';

const GITHUB_API = 'https://api.github.com';

// A SHA reaches a workflow input, an image tag name, and a URL path. Validate
// hard before it touches any of them.
//
// Deliberately STRICT: no trimming inside the validator. Accepting "abc1234\n"
// because trim() happens to clean it would mean the function reports a string as
// safe that is not the string a caller might actually use — a trap for the next
// caller that validates but forgets to normalize. Callers funnel through
// normalizeSha() instead, which normalizes and validates together.
const SHA_PATTERN = /^[0-9a-fA-F]{7,40}$/;

export function isValidSha(sha) {
  return typeof sha === 'string' && SHA_PATTERN.test(sha);
}

// Trim + lowercase + validate in one step. Returns the canonical SHA, or null if
// the input is not one. This is the only form callers should use before putting a
// value into a URL, a tag, or a workflow input.
export function normalizeSha(sha) {
  if (typeof sha !== 'string') return null;
  const canonical = sha.trim().toLowerCase();
  return SHA_PATTERN.test(canonical) ? canonical : null;
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'printfarm-update-rollback',
  };
}

async function githubFetch(url, token, init = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, headers: githubHeaders(token), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dispatches the rollback workflow. GitHub's dispatch endpoint returns 204 with
 * no body and no run id, so the caller records the dispatch time and
 * findRollbackRun() correlates the run afterwards.
 *
 * @returns {Promise<{ok: boolean, error?: string, dispatchedAt: number}>}
 */
export async function triggerRollbackWorkflow({ repo, branch, workflow, token, targetSha }) {
  const dispatchedAt = Date.now();
  if (!token || !repo) {
    return { ok: false, error: 'Rollback is not configured on this host', dispatchedAt };
  }
  const canonicalSha = normalizeSha(targetSha);
  if (!canonicalSha) {
    return { ok: false, error: 'Invalid rollback target', dispatchedAt };
  }
  const wf = encodeURIComponent(workflow || 'rollback.yml');
  const url = `${GITHUB_API}/repos/${repo}/actions/workflows/${wf}/dispatches`;
  try {
    const resp = await githubFetch(url, token, {
      method: 'POST',
      body: JSON.stringify({
        ref: branch || 'main',
        inputs: { target_sha: canonicalSha },
      }),
    });
    if (resp.status === 204) {
      return { ok: true, dispatchedAt };
    }
    // 404 here usually means the token lacks Actions scope or the workflow file
    // isn't on the target branch yet — both are operator misconfigurations, but
    // the specific URL must not leak to the browser.
    const body = await resp.text().catch(() => '');
    logger.error('rollback dispatch failed', { status: resp.status, body: body.slice(0, 300) });
    return {
      ok: false,
      error: resp.status === 404
        ? 'Rollback workflow not found — check the workflow file and token scope'
        : 'Could not start the rollback job',
      dispatchedAt,
    };
  } catch (error) {
    logger.error('rollback dispatch error', { error: error?.message });
    return { ok: false, error: 'Could not reach GitHub to start the rollback', dispatchedAt };
  }
}

/**
 * Finds the workflow run created by our dispatch and reports its progress.
 * Matches on created_at >= dispatch time (minus a minute of clock skew) rather
 * than an id, because workflow_dispatch does not return one.
 *
 * @returns {Promise<{status: 'pending'|'running'|'succeeded'|'failed', detail?: string}>}
 */
export async function pollRollbackWorkflow({ repo, workflow, token, dispatchedAt }) {
  if (!token || !repo) return { status: 'failed', detail: 'Rollback is not configured' };
  const wf = encodeURIComponent(workflow || 'rollback.yml');
  const url = `${GITHUB_API}/repos/${repo}/actions/workflows/${wf}/runs?per_page=10`;
  try {
    const resp = await githubFetch(url, token);
    if (!resp.ok) {
      logger.warn('rollback poll failed', { status: resp.status });
      return { status: 'running' }; // transient: keep waiting rather than failing the run
    }
    const data = await resp.json();
    const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
    const since = dispatchedAt - 60000;
    const mine = runs
      .filter((run) => new Date(run?.created_at || 0).getTime() >= since)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (!mine) return { status: 'pending' };
    if (mine.status !== 'completed') return { status: 'running' };
    if (mine.conclusion === 'success') return { status: 'succeeded' };
    logger.error('rollback workflow concluded unsuccessfully', { conclusion: mine.conclusion });
    return {
      status: 'failed',
      detail: mine.conclusion === 'failure'
        ? 'The rollback job failed — the target version may not have images published'
        : `The rollback job ended as ${String(mine.conclusion || 'unknown').replace(/[^a-z_]/gi, '')}`,
    };
  } catch (error) {
    logger.warn('rollback poll error', { error: error?.message });
    return { status: 'running' };
  }
}
