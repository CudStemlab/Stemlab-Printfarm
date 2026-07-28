// Queue → "Preview model in 3D".
//
// Owns everything around the canvas: fetching the stored model bytes, the size
// guard, progress/parse/error states, the stats panel and the view controls.
//
// It must never reference three at value level — the heavy renderer is behind
// the React.lazy() below, which is what keeps the `three` chunk off first
// paint. Types from lib/modelViewer come across with `import type` only
// (erased at compile time, so they create no runtime import edge).

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTheme } from 'next-themes';
import {
  Box,
  Grid3x3,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { PrintJob } from '../types';
import { formatBytes, formatMaxTwoDecimals } from '../lib/numberFormat';
import { logAuditEvent } from '../lib/auditApi';
import {
  detectModelFormat,
  HIGH_DETAIL_TRIANGLES,
  PREVIEW_HARD_LIMIT_BYTES,
  PREVIEW_SOFT_LIMIT_BYTES,
} from '../lib/modelFormats';
import type { ModelStats, ViewPreset } from '../lib/modelViewer';
import type { ModelViewerControls } from './ModelViewerCanvas';

// Fetched the first time an operator opens a preview, then cached by the
// browser (hashed filename, immutable) — never on first paint. Same pattern as
// the esptool-js import in lib/statusLightSerial.ts.
const ModelViewerCanvas = lazy(() => import('./ModelViewerCanvas'));

type Phase = 'idle' | 'confirm-large' | 'downloading' | 'parsing' | 'ready' | 'error';

const VIEW_PRESETS: { value: ViewPreset; label: string }[] = [
  { value: 'iso', label: 'Iso' },
  { value: 'top', label: 'Top' },
  { value: 'front', label: 'Front' },
];

interface QueueModelViewerDialogProps {
  job: PrintJob;
  children: ReactNode;
}

export function QueueModelViewerDialog({ job, children }: QueueModelViewerDialogProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [declaredSize, setDeclaredSize] = useState(0);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [wireframe, setWireframe] = useState(false);

  const controlsRef = useRef<ModelViewerControls | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const format = useMemo(() => detectModelFormat(job.filename), [job.filename]);

  const load = useCallback(
    async (skipSizeConfirmation: boolean) => {
      // hasFile is true exactly when the server stored bytes, which is also
      // exactly when stlFileUrl is the synthesized same-origin route. A legacy
      // external link would fail CORS and connect-src 'self' anyway.
      const rawUrl = job.stlFileUrl;
      if (!rawUrl || !format) {
        setPhase('error');
        setError('Preview is not available for this file.');
        return;
      }

      const url = new URL(rawUrl, window.location.origin);
      if (url.origin !== window.location.origin) {
        setPhase('error');
        setError('Preview is only available for files stored in the print farm.');
        return;
      }

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      setError(null);
      setProgress(0);
      setPhase('downloading');

      try {
        const response = await fetch(url.toString(), {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error('You are not allowed to view this file.');
        }
        if (response.status === 404) {
          throw new Error('The model file is no longer stored for this job.');
        }
        if (!response.ok) {
          throw new Error('The model file could not be loaded. Try again in a moment.');
        }

        const total = Number(response.headers.get('Content-Length')) || 0;
        setDeclaredSize(total);

        // Size is checked from the header before the body is read, so an
        // oversized model is never pulled across the network at all.
        if (total > PREVIEW_HARD_LIMIT_BYTES) {
          controller.abort();
          throw new Error(
            `This model is too large to preview in the browser (${formatBytes(total)}). Download it and open it in your slicer instead.`,
          );
        }
        if (total > PREVIEW_SOFT_LIMIT_BYTES && !skipSizeConfirmation) {
          controller.abort();
          setDeclaredSize(total);
          setPhase('confirm-large');
          return;
        }

        const downloaded = await readWithProgress(response, total, setProgress);
        if (controller.signal.aborted) return;

        setBuffer(downloaded);
        setPhase('parsing');
        // Yield a frame so the "Parsing…" state actually paints before the
        // synchronous parse blocks the main thread — without this the user sees
        // nothing at all for the duration of the parse.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (controller.signal.aborted) return;
        setPhase('ready');
      } catch (caught) {
        // The dialog closing (or a re-load) aborts the transfer on purpose —
        // that is not an error worth showing. Note the size guards abort and
        // then throw their own Error, which is not an AbortError, so those
        // still surface.
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setPhase('error');
        setError(caught instanceof Error ? caught.message : 'The model could not be loaded.');
      }
    },
    [format, job.stlFileUrl],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      // Previewing pulls a student's model bytes, so it is audited like the
      // other queue actions.
      logAuditEvent('queue.preview', job.id, { filename: job.filename });
      void load(false);
      return;
    }

    // Closing mid-download cancels the transfer instead of finishing it into a
    // buffer nobody will read; releasing the buffer lets a large model be
    // garbage-collected rather than pinned for the page's lifetime.
    abortRef.current?.abort();
    abortRef.current = null;
    controlsRef.current = null;
    setPhase('idle');
    setError(null);
    setProgress(0);
    setBuffer(null);
    setStats(null);
    setWireframe(false);
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  const registerControls = useCallback((controls: ModelViewerControls | null) => {
    controlsRef.current = controls;
  }, []);

  const handleStats = useCallback((next: ModelStats) => setStats(next), []);

  const handleError = useCallback((message: string) => {
    setPhase('error');
    setError(message);
  }, []);

  const handleContextLost = useCallback(() => {
    setPhase('error');
    setError('The 3D preview stopped unexpectedly. Close and reopen it to retry.');
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {/* p-0 with per-section padding: the default p-6 would eat the canvas. */}
      <DialogContent className="w-[calc(100%-1rem)] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border px-4 py-3 text-left sm:px-6">
          {/* pr-8 clears the dialog's built-in absolute close button. */}
          <DialogTitle className="truncate pr-8">{job.filename || 'Model preview'}</DialogTitle>
          <DialogDescription>
            {job.submitterName ? `Submitted by ${job.submitterName}. ` : ''}
            Drag to orbit, scroll to zoom, right-drag to pan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col lg:flex-row">
          <div className="relative h-[52vh] min-h-0 flex-1 bg-muted lg:h-[68vh]">
            {phase === 'ready' && buffer && format ? (
              <Suspense fallback={<CanvasMessage icon="spinner" text="Preparing viewer…" />}>
                <ModelViewerCanvas
                  buffer={buffer}
                  format={format}
                  fileSizeBytes={buffer.byteLength}
                  wireframe={wireframe}
                  isDark={isDark}
                  onStats={handleStats}
                  onError={handleError}
                  onContextLost={handleContextLost}
                  registerControls={registerControls}
                />
              </Suspense>
            ) : null}

            {phase === 'downloading' ? (
              <CanvasMessage icon="spinner" text="Downloading model…">
                {declaredSize > 0 ? (
                  <div className="w-48 space-y-1">
                    <Progress value={progress} />
                    <p className="text-center text-xs text-muted-foreground">
                      {formatMaxTwoDecimals(progress)}% of {formatBytes(declaredSize)}
                    </p>
                  </div>
                ) : null}
              </CanvasMessage>
            ) : null}

            {phase === 'parsing' ? <CanvasMessage icon="spinner" text="Parsing model…" /> : null}

            {phase === 'confirm-large' ? (
              <CanvasMessage
                icon="warning"
                text={`This is a large model (${formatBytes(declaredSize)}). The preview may be slow, and may not load on a phone.`}
              >
                <Button type="button" size="sm" onClick={() => void load(true)}>
                  Preview anyway
                </Button>
              </CanvasMessage>
            ) : null}

            {phase === 'error' ? <CanvasMessage icon="warning" text={error ?? 'Preview failed.'} /> : null}
          </div>

          <div className="shrink-0 space-y-4 border-t border-border p-4 lg:w-64 lg:border-l lg:border-t-0">
            <div>
              <h3
                className="text-sm font-medium text-foreground"
                title="STL and OBJ files carry no units; the print farm assumes millimetres, matching slicer defaults."
              >
                Dimensions (mm)
              </h3>
              <dl className="mt-2 space-y-1 text-sm">
                <StatRow label="Width (X)" value={stats ? `${formatMaxTwoDecimals(stats.width)} mm` : '—'} />
                <StatRow label="Depth (Y)" value={stats ? `${formatMaxTwoDecimals(stats.depth)} mm` : '—'} />
                <StatRow label="Height (Z)" value={stats ? `${formatMaxTwoDecimals(stats.height)} mm` : '—'} />
              </dl>
            </div>

            <div>
              <dl className="space-y-1 text-sm">
                <StatRow
                  label="Triangles"
                  value={stats ? stats.triangles.toLocaleString('en-US') : '—'}
                />
                {stats && stats.meshes > 1 ? (
                  <StatRow label="Objects" value={stats.meshes.toLocaleString('en-US')} />
                ) : null}
                <StatRow
                  label="File size"
                  value={stats ? formatBytes(stats.fileSizeBytes) : '—'}
                />
              </dl>
            </div>

            {stats && stats.triangles > HIGH_DETAIL_TRIANGLES ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                Very high detail — interaction may stutter.
              </p>
            ) : null}

            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1">
                {VIEW_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={phase !== 'ready'}
                    onClick={() => controlsRef.current?.setPreset(preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={phase !== 'ready'}
                onClick={() => controlsRef.current?.resetView()}
              >
                <RotateCcw className="size-4 mr-2" />
                Reset view
              </Button>
              <Button
                type="button"
                variant={wireframe ? 'default' : 'outline'}
                size="sm"
                className="w-full"
                disabled={phase !== 'ready'}
                aria-pressed={wireframe}
                onClick={() => setWireframe((previous) => !previous)}
              >
                <Grid3x3 className="size-4 mr-2" />
                Wireframe
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Stream the body so a large model over a slow link shows real progress rather
// than a silent wait. Content-Length survives to the browser (nginx does not
// gzip this route), so the percentage is accurate; environments without stream
// support fall back to a single arrayBuffer() read.
async function readWithProgress(
  response: Response,
  total: number,
  onProgress: (percent: number) => void,
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader || !total) {
    return response.arrayBuffer();
  }

  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(100, (received / total) * 100));
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function CanvasMessage({
  icon,
  text,
  children,
}: {
  icon: 'spinner' | 'warning';
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      {icon === 'spinner' ? (
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      ) : (
        <Box className="size-6 text-muted-foreground" />
      )}
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}
