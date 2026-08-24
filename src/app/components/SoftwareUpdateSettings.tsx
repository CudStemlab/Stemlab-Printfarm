import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download,
  Info, Loader2, RefreshCw, RotateCcw, XCircle,
} from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './ui/alert-dialog';
import {
  applyUpdate, cancelUpdateRun, fetchActiveRun, fetchPreflight, fetchUpdateRuns,
  fetchUpdateStatus, rollbackUpdate,
  type PreflightCheck, type UpdateRun, type UpdateRunEvent, type UpdateStatus,
} from '../lib/updateApi';

const short = (sha: string | null | undefined) =>
  typeof sha === 'string' && sha.length > 0 ? sha.slice(0, 7) : '—';

function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function duration(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// The run is polled rather than pushed: an update recreates the container
// serving this app, so a socket would drop mid-flight anyway.
const RUN_POLL_INTERVAL_MS = 3000;

const RUN_STATE_LABEL: Record<string, string> = {
  queued: 'Queued',
  retagging: 'Republishing older version',
  triggering: 'Starting',
  applying: 'Restarting containers',
  verifying: 'Verifying health',
  succeeded: 'Succeeded',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled',
};

const TERMINAL_BAD = new Set(['failed', 'timed_out']);

function runBadgeClass(state: string): string {
  if (state === 'succeeded') return 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30';
  if (TERMINAL_BAD.has(state)) return 'bg-destructive/15 text-destructive border-destructive/30';
  if (state === 'cancelled') return 'bg-muted text-muted-foreground border-border';
  return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
}

function CheckRow({ check }: { check: PreflightCheck }) {
  const blocking = check.severity === 'block' && !check.ok;
  const Icon = check.ok ? CheckCircle2 : blocking ? XCircle : check.severity === 'info' ? Info : AlertTriangle;
  const tone = check.ok
    ? 'text-green-600 dark:text-green-400'
    : blocking
      ? 'text-destructive'
      : check.severity === 'info'
        ? 'text-muted-foreground'
        : 'text-amber-600 dark:text-amber-400';
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <span className={check.ok ? 'text-muted-foreground' : undefined}>{check.label}</span>
        {check.detail ? <p className="text-xs text-muted-foreground">{check.detail}</p> : null}
      </div>
    </div>
  );
}

// Admin-only "update available" card. Compares the running image's commit SHA
// (baked at build time) against the newest image published to the registry, runs pre-flight
// checks, and — when a Watchtower sidecar is configured — applies the update in
// place while tracking it as a durable server-side run.
export function SoftwareUpdateSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [preflight, setPreflight] = useState<PreflightCheck[]>([]);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [run, setRun] = useState<UpdateRun | null>(null);
  const [events, setEvents] = useState<UpdateRunEvent[]>([]);
  const [history, setHistory] = useState<UpdateRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // Tracks the run we last saw active, so the completion toast fires once.
  const lastActiveRunId = useRef<number | null>(null);

  const refreshStatus = useCallback(async (force = false) => {
    const next = await fetchUpdateStatus(force);
    setStatus(next);
    return next;
  }, []);

  const refreshPreflight = useCallback(async () => {
    const result = await fetchPreflight('update');
    if (result) {
      setPreflight(result.checks);
      setBlocking(result.blocking);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistory(await fetchUpdateRuns(10));
  }, []);

  // Manual "Check again": force a fresh GitHub poll (bypassing the server's TTL
  // cache) so a just-published image shows up right away, and keep the reload icon
  // spinning for a beat so the animation is visible even when the fetch is fast.
  const handleCheck = useCallback(async () => {
    setChecking(true);
    await Promise.all([
      refreshStatus(true),
      refreshPreflight(),
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);
    setChecking(false);
  }, [refreshStatus, refreshPreflight]);

  useEffect(() => {
    void (async () => {
      const next = await refreshStatus();
      if (next.enabled) {
        await Promise.all([refreshPreflight(), refreshHistory()]);
      }
      setLoading(false);
    })();
  }, [refreshStatus, refreshPreflight, refreshHistory]);

  // Poll the active run from mount — not just after clicking "Update now". This
  // is what makes progress genuinely survive closing the tab, navigating away,
  // or a different admin opening Settings mid-update: the run lives on the
  // server, and the browser is only ever a viewer of it.
  useEffect(() => {
    if (!status?.enabled) return undefined;
    let cancelled = false;

    const tick = async () => {
      const { run: active, events: log, unreachable } = await fetchActiveRun();
      if (cancelled) return;
      // Mid-update the server is briefly gone. That is expected, not an error —
      // hold the last known state and show a "restarting" hint instead.
      if (unreachable) {
        setRestarting(true);
        return;
      }
      setRestarting(false);
      if (active) {
        lastActiveRunId.current = active.id;
        setRun(active);
        setEvents(log);
        return;
      }
      // A run we were watching just finished: refresh everything and report.
      if (lastActiveRunId.current !== null) {
        const finishedId = lastActiveRunId.current;
        lastActiveRunId.current = null;
        setRun(null);
        setEvents([]);
        const [next, runs] = await Promise.all([fetchUpdateStatus(true), fetchUpdateRuns(10)]);
        if (cancelled) return;
        setStatus(next);
        setHistory(runs);
        void refreshPreflight();
        const finished = runs.find((entry) => entry.id === finishedId);
        if (finished?.state === 'succeeded') {
          toast.success(`Now running ${short(finished.toVersion)}.`);
        } else if (finished && TERMINAL_BAD.has(finished.state)) {
          toast.error(finished.error || 'The update did not complete.');
        }
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), RUN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status?.enabled, refreshPreflight]);

  const handleApply = async () => {
    setConfirmOpen(false);
    setStarting(true);
    const result = await applyUpdate();
    setStarting(false);
    if (result.ok) {
      toast('Update started', {
        description:
          'It runs on the server — you can close this tab or navigate away. Reopen Settings any time to see where it got to.',
      });
      const { run: active, events: log } = await fetchActiveRun();
      if (active) {
        lastActiveRunId.current = active.id;
        setRun(active);
        setEvents(log);
      }
    } else {
      if (result.checks) {
        setPreflight(result.checks);
        setBlocking(result.checks.filter((c) => c.severity === 'block' && !c.ok).map((c) => c.id));
      }
      toast.error(result.error || 'Could not start the update.');
    }
  };

  const handleRollback = async () => {
    setRollbackOpen(false);
    if (!status?.rollbackTarget) return;
    setStarting(true);
    const result = await rollbackUpdate(status.rollbackTarget);
    setStarting(false);
    if (result.ok) {
      toast('Rollback started', {
        description: 'Republishing the older version, then restarting the containers.',
      });
      const { run: active, events: log } = await fetchActiveRun();
      if (active) {
        lastActiveRunId.current = active.id;
        setRun(active);
        setEvents(log);
      }
    } else {
      toast.error(result.error || 'Could not start the rollback.');
    }
  };

  const handleCancel = async () => {
    if (!run) return;
    const result = await cancelUpdateRun(run.id);
    if (result.ok) {
      toast('Update run abandoned.');
      setRun(null);
      setEvents([]);
      lastActiveRunId.current = null;
      void refreshHistory();
    } else {
      toast.error(result.error || 'Could not cancel the run.');
    }
  };

  // Feature turned off on the server → nothing to show.
  if (!loading && status && !status.enabled) {
    return null;
  }

  const updateAvailable = Boolean(status?.updateAvailable);
  const canApply = Boolean(status?.canApply);
  const canRollback = Boolean(status?.canRollback && status?.rollbackTarget);
  const isPinned = Boolean(status?.pinnedVersion && status.pinnedVersion === status.current);
  const hasBlockers = blocking.length > 0;
  const warnings = preflight.filter((check) => check.severity === 'warn' && !check.ok);
  const blockers = preflight.filter((check) => check.severity === 'block' && !check.ok);
  const lastRun = history[0] || null;
  const lastRunFailed = Boolean(lastRun && TERMINAL_BAD.has(lastRun.state) && !run);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-medium">Software updates</h3>
          <p className="text-sm text-muted-foreground">
            Check whether a newer published version of the print-farm app is
            available for this site.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleCheck()}
          disabled={loading || checking || Boolean(run)}
        >
          <RefreshCw className={loading || checking ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {checking ? 'Checking…' : 'Check again'}
        </Button>
      </div>

      <div className="mt-4 space-y-4">
        {loading && !status ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : status?.error ? (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Could not reach the update server. Showing the running version only.
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Running: <code className="font-mono">{short(status?.current)}</code>
          </span>
          {status?.latest ? (
            <span className="text-muted-foreground">
              Latest: <code className="font-mono">{short(status?.latest)}</code>
              {relativeTime(status?.latestCommittedAt) ? (
                <span className="text-muted-foreground"> · {relativeTime(status?.latestCommittedAt)}</span>
              ) : null}
            </span>
          ) : null}
        </div>

        {/* A build with no stamped commit cannot be compared to anything, so say
            that plainly rather than offering an update that can never resolve. */}
        {status?.enabled && status.versionSource && status.versionSource !== 'baked' ? (
          <p className="text-sm text-muted-foreground">
            This build has no commit stamped into it, so updates cannot be checked
            from here. That is normal for a local development build.
          </p>
        ) : null}

        {/* ── In-flight run ─────────────────────────────────────────────── */}
        {run ? (
          <div className="space-y-3 rounded border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium">
                  {run.kind === 'rollback' ? 'Rolling back' : 'Updating'} ·{' '}
                  {RUN_STATE_LABEL[run.state] || run.state}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void handleCancel()}>
                Abandon
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Running on the server — safe to close this tab or navigate away.
              {restarting ? ' Reconnecting to the app…' : ''}
            </p>
            {events.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded bg-muted p-3 font-mono text-xs text-foreground">
                {events.map((entry, index) => (
                  <div key={index} className={entry.level === 'error' ? 'text-destructive' : undefined}>
                    <span className="text-muted-foreground">
                      {new Date(entry.at).toLocaleTimeString()}
                    </span>{' '}
                    {entry.message}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Last run failed → offer the way back ──────────────────────── */}
        {lastRunFailed ? (
          <div className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" />
              The last {lastRun?.kind === 'rollback' ? 'rollback' : 'update'}{' '}
              {lastRun?.state === 'timed_out' ? 'timed out' : 'failed'}.
            </div>
            {lastRun?.error ? <p className="text-xs text-muted-foreground">{lastRun.error}</p> : null}
            {canRollback ? (
              <Button variant="outline" size="sm" onClick={() => setRollbackOpen(true)} disabled={starting}>
                <RotateCcw className="h-4 w-4" />
                Roll back to {short(status?.rollbackTarget)}
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* ── Pre-flight + apply ────────────────────────────────────────── */}
        {!run && updateAvailable && !isPinned ? (
          <div className="space-y-3">
            <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
              Update available
            </Badge>
            {canApply ? (
              <>
                {preflight.length > 0 ? (
                  <div className="space-y-2 rounded border border-border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pre-flight
                    </p>
                    {preflight.map((check) => <CheckRow key={check.id} check={check} />)}
                    {!preflight.find((c) => c.id === 'backup-fresh')?.ok ? (
                      <a
                        className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-foreground"
                        href="/api/admin/backup/download"
                        download
                      >
                        <Download className="h-3 w-3" />
                        Download a backup first
                      </a>
                    ) : null}
                  </div>
                ) : null}
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={starting || hasBlockers}
                  title={hasBlockers ? 'Resolve the blocking pre-flight checks first' : undefined}
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {starting ? 'Starting…' : 'Update now'}
                </Button>
                {hasBlockers ? (
                  <p className="text-xs text-destructive">
                    Blocked: {blockers.map((check) => check.label).join(', ')}.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                One-click apply is not configured on this host. Update from the
                server with:
                <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-xs">
                  docker compose -f docker-compose.yml -f docker-compose.deploy.yml pull &amp;&amp; docker compose -f docker-compose.yml -f docker-compose.deploy.yml up -d
                </code>
              </p>
            )}
          </div>
        ) : null}

        {/* ── Pinned by a deliberate rollback ───────────────────────────── */}
        {!run && isPinned ? (
          <div className="space-y-2">
            <Badge className="bg-muted text-muted-foreground border-border">
              Pinned to {short(status?.current)}
            </Badge>
            <p className="text-sm text-muted-foreground">
              This version was restored by a rollback, so it will stay put until you
              choose to move.{' '}
              {status?.latest && status.latest !== status.current
                ? `The newest published version is ${short(status.latest)}.`
                : ''}
            </p>
            {canApply && status?.latest && status.latest !== status.current ? (
              <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} disabled={starting}>
                <Download className="h-4 w-4" />
                Re-apply latest
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* ── Up to date ────────────────────────────────────────────────── */}
        {!run && !updateAvailable && !isPinned && status && !status.error && status.latest ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              You are on the latest version.
            </div>
            {canRollback ? (
              <Button variant="outline" size="sm" onClick={() => setRollbackOpen(true)} disabled={starting}>
                <RotateCcw className="h-4 w-4" />
                Roll back to {short(status?.rollbackTarget)}
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* ── History ───────────────────────────────────────────────────── */}
        {history.length > 0 ? (
          <div className="border-t border-border pt-3">
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowHistory((open) => !open)}
            >
              {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Update history ({history.length})
            </button>
            {showHistory ? (
              <div className="mt-2 space-y-2">
                {history.map((entry) => (
                  <div key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <Badge className={runBadgeClass(entry.state)}>
                      {RUN_STATE_LABEL[entry.state] || entry.state}
                    </Badge>
                    <span className="font-mono text-muted-foreground">
                      {short(entry.fromVersion)} → {short(entry.toVersion)}
                    </span>
                    {entry.kind === 'rollback' ? (
                      <span className="text-muted-foreground">rollback</span>
                    ) : null}
                    <span className="text-muted-foreground">
                      {relativeTime(entry.startedAt)}
                      {entry.actorUsername ? ` · ${entry.actorUsername}` : ''}
                      {duration(entry.startedAt, entry.finishedAt)
                        ? ` · ${duration(entry.startedAt, entry.finishedAt)}`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Confirm update ─────────────────────────────────────────────── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Update to {short(status?.latest)}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  The app will pull the new images and restart. Expect about a
                  minute where the dashboard, webcams, and status polling are
                  unavailable.
                </p>
                {warnings.length > 0 ? (
                  <div className="space-y-1">
                    <p className="font-medium text-amber-600 dark:text-amber-400">Worth knowing:</p>
                    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                      {warnings.map((check) => (
                        <li key={check.id}>{check.detail || check.label}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleApply()}>Update now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm rollback ───────────────────────────────────────────── */}
      <AlertDialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Roll back to {short(status?.rollbackTarget)}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This republishes the older version and restarts the containers.
                  It takes a few minutes, because the images are rebuilt into place
                  before anything restarts.
                </p>
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  Database migrations are not reversed. Rolling the app back does
                  not roll the schema back — the older build has to tolerate the
                  newer database.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRollback()}>Roll back</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
