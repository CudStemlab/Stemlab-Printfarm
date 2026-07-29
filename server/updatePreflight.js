// Pre-flight checks for the admin software update / rollback flow.
//
// Before this existed, "Update now" went straight to Watchtower: an admin could
// recreate every container with the database already unreachable, with the
// updater sidecar misconfigured, or with half the farm mid-print, and only find
// out afterwards — with no record of the state things were in.
//
// Severity contract:
//   'block' — the update genuinely cannot succeed (or cannot be reasoned about).
//             There is deliberately NO override path: every blocking check here
//             is a hard failure, not a judgement call, so an override switch
//             would only teach admins to click through real problems.
//   'warn'  — worth knowing and worth recording, but the admin decides. Shown in
//             the confirm dialog and persisted into update_runs.preflight.
//   'info'  — context only.
//
// SECURITY: check `detail` strings are rendered in the browser. They must never
// contain the Watchtower URL, image prefix, registry hostnames, or any other
// infrastructure address — see the no-infra-leak invariant in CLAUDE.md.

import { listPrinters, listQueueData, listAuditLogs } from './postgres.js';
import { logger } from './logger.js';

// A backup older than this makes the `backup-fresh` check warn. Not blocking:
// plenty of farms take backups out-of-band, and blocking on it would be wrong.
const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function check(id, label, severity, ok, detail = null) {
  return { id, label, severity, ok, detail };
}

// Probe the updater without caring what it says: Watchtower's /v1/update rejects
// an unauthenticated GET, so 401/403/404/405 all prove the service is listening,
// which is the only thing this check is asking. Only a transport failure counts
// as unreachable.
async function probeUpdater(watchtowerUrl) {
  if (!watchtowerUrl) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(watchtowerUrl, { method: 'HEAD', signal: controller.signal });
    return true;
  } catch (error) {
    // Log the real reason server-side; the caller only ever sees a generic string.
    logger.warn('update preflight: updater probe failed', { error: error?.message });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function lastBackupAgeMs() {
  try {
    const logs = await listAuditLogs(200);
    const entries = Array.isArray(logs) ? logs : [];
    const backup = entries.find((entry) => typeof entry?.action === 'string' && entry.action.startsWith('backup.'));
    if (!backup?.createdAt) return null;
    const at = new Date(backup.createdAt).getTime();
    return Number.isFinite(at) ? Date.now() - at : null;
  } catch {
    return null;
  }
}

/**
 * Runs every pre-flight check.
 *
 * @param {object} opts
 * @param {'update'|'rollback'} opts.kind
 * @param {boolean} opts.versionComparable  runningVersion() is a real baked SHA
 * @param {boolean} opts.databaseOk         from checkReadiness()
 * @param {string}  opts.watchtowerUrl
 * @param {boolean} opts.canApply           WATCHTOWER_TOKEN configured
 * @param {boolean} opts.rollbackConfigured UPDATE_ROLLBACK_TOKEN configured
 * @param {number|null} opts.schemaVersion  applied migration high-water mark
 * @returns {Promise<{ok: boolean, blocking: string[], checks: object[]}>}
 */
export async function runUpdatePreflight(opts) {
  const {
    kind = 'update',
    versionComparable = false,
    databaseOk = false,
    watchtowerUrl = '',
    canApply = false,
    rollbackConfigured = false,
    schemaVersion = null,
  } = opts || {};

  const checks = [];

  checks.push(check(
    'version-stamped',
    'Running version is identifiable',
    'block',
    versionComparable,
    versionComparable
      ? null
      : 'This build has no commit stamped into it, so the server cannot tell what it is running or whether an update would change anything.',
  ));

  checks.push(check(
    'db-reachable',
    'Database is reachable',
    'block',
    databaseOk,
    databaseOk ? null : 'The database is not responding. Restarting the app now risks losing in-flight writes.',
  ));

  const updaterOk = canApply && (await probeUpdater(watchtowerUrl));
  checks.push(check(
    'updater-reachable',
    'Updater service is reachable',
    'block',
    updaterOk,
    updaterOk
      ? null
      : canApply
        ? 'The updater service did not respond.'
        : 'One-click updates are not configured on this host.',
  ));

  // Active prints: a WARNING, not a blocker. Recreating web/nginx does not stop a
  // print — Bambu and Moonraker printers keep printing autonomously — so calling
  // this a blocker would overstate it and train admins to ignore it. What it does
  // interrupt is polling, telemetry, and any in-flight AMS/Home Assistant action.
  let printing = [];
  try {
    const printers = await listPrinters(true);
    printing = (Array.isArray(printers) ? printers : [])
      .filter((printer) => String(printer?.status || '').toLowerCase() === 'printing')
      .map((printer) => {
        const progress = Number(printer?.currentJob?.progress);
        return Number.isFinite(progress)
          ? `${printer.name} (${progress.toFixed(2)}%)`
          : String(printer?.name || 'unnamed printer');
      });
  } catch (error) {
    logger.warn('update preflight: printer read failed', { error: error?.message });
  }
  checks.push(check(
    'active-prints',
    'No prints in progress',
    'warn',
    printing.length === 0,
    printing.length === 0
      ? null
      : `${printing.length} printer${printing.length === 1 ? '' : 's'} printing: ${printing.join(', ')}. `
        + 'The prints themselves keep running, but status polling and webcams drop for about a minute while containers restart.',
  ));

  let pending = 0;
  try {
    const { queue } = await listQueueData();
    pending = Array.isArray(queue) ? queue.length : 0;
  } catch (error) {
    logger.warn('update preflight: queue read failed', { error: error?.message });
  }
  checks.push(check(
    'queue-in-flight',
    'Print queue is clear',
    'warn',
    pending === 0,
    pending === 0 ? null : `${pending} unprinted job${pending === 1 ? '' : 's'} in the queue. They are stored in the database and survive the restart.`,
  ));

  const backupAge = await lastBackupAgeMs();
  const backupFresh = backupAge !== null && backupAge < BACKUP_MAX_AGE_MS;
  checks.push(check(
    'backup-fresh',
    'Recent backup on record',
    'warn',
    backupFresh,
    backupFresh
      ? `Last backup ${Math.round(backupAge / 3600000)} h ago.`
      : 'No backup recorded in the last 24 hours. Download one before updating if this farm holds data you cannot re-create.',
  ));

  // Always present, never passing — this is a standing property of the system,
  // not a condition that can be satisfied. Migrations only ever roll forward.
  checks.push(check(
    'migration-forward-only',
    'Database migrations are forward-only',
    'warn',
    false,
    schemaVersion === null
      ? 'Rolling back to an older image does not undo database migrations.'
      : `Schema is at migration #${schemaVersion}. Rolling an image back does not undo migrations — an older build must still tolerate the newer schema.`,
  ));

  checks.push(check(
    'rollback-available',
    'Rollback is configured',
    kind === 'rollback' ? 'block' : 'info',
    rollbackConfigured,
    rollbackConfigured ? null : 'Rollback is not configured on this host, so this update could not be reverted from the dashboard.',
  ));

  const blocking = checks.filter((entry) => entry.severity === 'block' && !entry.ok).map((entry) => entry.id);
  return { ok: blocking.length === 0, blocking, checks };
}
