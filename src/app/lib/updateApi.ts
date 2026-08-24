// Admin software-update client (Settings → Maintenance). The server compares the
// running image's baked commit SHA against the newest image published to Docker
// Hub (the moving tag's digest resolved back to its immutable sha-<12> tag) on the configured
// GitHub branch and — when a Watchtower sidecar is wired up — applies the update
// in place, tracking the whole thing as a durable "run" in the database.
//
// Everything here is admin-only server-side (server/rbac.js).
//
// The run model is why progress survives a closed tab: the update replaces the
// container serving this app, so the browser cannot be the source of truth. It
// polls /runs/active instead, and any admin on any device sees the same state.

export interface UpdateStatus {
  // Feature turned on (UPDATE_CHECK_REPO set on the server).
  enabled: boolean;
  // Running commit SHA baked into this image ("dev" for local builds).
  current: string | null;
  // Commit SHA of the newest PUBLISHED image (12 chars), or null when unknown.
  latest?: string | null;
  updateAvailable?: boolean;
  // When that image was pushed to the registry (field name predates the
  // GitHub → Docker Hub switch).
  latestCommittedAt?: string | null;
  checkedAt?: string | null;
  // A Watchtower sidecar is configured, so "Update now" can apply in place.
  canApply?: boolean;
  // 'baked' = a real commit SHA we can compare; 'dev'/'build-id' = a local build
  // whose version is not comparable, so no update can be offered.
  versionSource?: 'baked' | 'dev' | 'build-id';
  // A rollback token is configured, so the rollback button can be offered.
  canRollback?: boolean;
  // The version we were on before the last successful update — the rollback target.
  rollbackTarget?: string | null;
  // Set when the running version is the result of a deliberate rollback.
  pinnedVersion?: string | null;
  activeRunId?: number | null;
  // Present when the upstream check failed (e.g. GitHub unreachable).
  error?: string;
}

export type PreflightSeverity = 'block' | 'warn' | 'info';

export interface PreflightCheck {
  id: string;
  label: string;
  severity: PreflightSeverity;
  ok: boolean;
  detail: string | null;
}

export interface PreflightResult {
  ok: boolean;
  blocking: string[];
  checks: PreflightCheck[];
}

export type UpdateRunState =
  | 'queued' | 'retagging' | 'triggering' | 'applying' | 'verifying'
  | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export interface UpdateRun {
  id: number;
  kind: 'update' | 'rollback';
  state: UpdateRunState;
  fromVersion: string;
  toVersion: string | null;
  targetTag: string | null;
  schemaVersion: number | null;
  actorName: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  preflight: { checks?: PreflightCheck[] } | null;
  health: { passes?: number } | null;
  error: string | null;
  active: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  deadlineAt: string | null;
  finishedAt: string | null;
}

export interface UpdateRunEvent {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface ApplyResult {
  ok: boolean;
  runId?: number;
  error?: string;
  // Present on a 409 from failed pre-flight checks.
  checks?: PreflightCheck[];
}

async function readError(response: Response): Promise<{ error?: string; checks?: PreflightCheck[] }> {
  try {
    return (await response.json()) as { error?: string; checks?: PreflightCheck[] };
  } catch {
    return {};
  }
}

// Fetch the current-vs-latest version status. Returns a disabled status on any
// failure so the caller can simply hide the card. Pass `force` (manual "Check
// again") to bypass the server's TTL cache and re-poll GitHub immediately.
export async function fetchUpdateStatus(force = false): Promise<UpdateStatus> {
  try {
    const url = force ? '/api/admin/update-status?force=1' : '/api/admin/update-status';
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return { enabled: false, current: null };
    }
    return (await response.json()) as UpdateStatus;
  } catch {
    return { enabled: false, current: null };
  }
}

// Run the pre-flight checks without side effects, to render the checklist.
export async function fetchPreflight(kind: 'update' | 'rollback' = 'update'): Promise<PreflightResult | null> {
  try {
    const response = await fetch(`/api/admin/update/preflight?kind=${kind}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as PreflightResult;
  } catch {
    return null;
  }
}

// The in-flight run and its log, or null. Returns `unreachable` so the caller can
// distinguish "no update running" from "the server is mid-restart" — during an
// update the latter is expected and must not be rendered as a failure.
export async function fetchActiveRun(): Promise<{
  run: UpdateRun | null;
  events: UpdateRunEvent[];
  unreachable: boolean;
}> {
  try {
    const response = await fetch('/api/admin/update/runs/active', { cache: 'no-store' });
    if (!response.ok) return { run: null, events: [], unreachable: true };
    const data = (await response.json()) as { run: UpdateRun | null; events: UpdateRunEvent[] };
    return { run: data.run, events: data.events || [], unreachable: false };
  } catch {
    return { run: null, events: [], unreachable: true };
  }
}

export async function fetchUpdateRuns(limit = 10): Promise<UpdateRun[]> {
  try {
    const response = await fetch(`/api/admin/update/runs?limit=${limit}`, { cache: 'no-store' });
    if (!response.ok) return [];
    const data = (await response.json()) as { runs: UpdateRun[] };
    return data.runs || [];
  } catch {
    return [];
  }
}

export async function fetchUpdateRun(
  id: number,
): Promise<{ run: UpdateRun; events: UpdateRunEvent[] } | null> {
  try {
    const response = await fetch(`/api/admin/update/runs/${id}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as { run: UpdateRun; events: UpdateRunEvent[] };
  } catch {
    return null;
  }
}

// Trigger the update. The server now returns immediately with a runId rather
// than holding the request open across its own restart, but the container can
// still be recreated while the response is in flight — so a dropped connection
// is recovered by asking for the active run instead of being guessed at.
export async function applyUpdate(): Promise<ApplyResult> {
  try {
    const response = await fetch('/api/admin/update/apply', { method: 'POST' });
    if (response.ok) {
      const data = (await response.json()) as { runId?: number };
      return { ok: true, runId: data.runId };
    }
    const { error, checks } = await readError(response);
    return { ok: false, error, checks };
  } catch {
    // Connection dropped — recover the real run rather than assuming success.
    const { run } = await fetchActiveRun();
    if (run) return { ok: true, runId: run.id };
    return { ok: false, error: 'Lost contact with the server while starting the update.' };
  }
}

// Roll back to a previously published commit. Republishes the older images via
// CI, then updates to them.
export async function rollbackUpdate(targetVersion: string): Promise<ApplyResult> {
  try {
    const response = await fetch('/api/admin/update/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetVersion }),
    });
    if (response.ok) {
      const data = (await response.json()) as { runId?: number };
      return { ok: true, runId: data.runId };
    }
    const { error, checks } = await readError(response);
    return { ok: false, error, checks };
  } catch {
    const { run } = await fetchActiveRun();
    if (run) return { ok: true, runId: run.id };
    return { ok: false, error: 'Lost contact with the server while starting the rollback.' };
  }
}

// Abandon a wedged run. Releases this app's concurrency guard; it does NOT stop
// an update the updater has already begun.
export async function cancelUpdateRun(id: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/admin/update/runs/${id}/cancel`, { method: 'POST' });
    if (response.ok) return { ok: true };
    const { error } = await readError(response);
    return { ok: false, error };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}
