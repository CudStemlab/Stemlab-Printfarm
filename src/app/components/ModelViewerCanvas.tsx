// React lifecycle shim around the imperative three.js viewer.
//
// Loaded only through React.lazy() from QueueModelViewerDialog — it must keep a
// default export for that, and it is the first module in the chain that pulls
// in `three` (via lib/modelViewer). Nothing that renders eagerly may import it.

import { useEffect, useRef } from 'react';
import type { ModelFormat } from '../lib/modelFormats';
import type { ModelStats, ModelViewerHandle, ViewPreset } from '../lib/modelViewer';
import { createModelViewer } from '../lib/modelViewer';

export interface ModelViewerControls {
  setPreset(preset: ViewPreset): void;
  resetView(): void;
}

export interface ModelViewerCanvasProps {
  buffer: ArrayBuffer;
  format: ModelFormat;
  fileSizeBytes: number;
  wireframe: boolean;
  isDark: boolean;
  onStats(stats: ModelStats): void;
  onError(message: string): void;
  onContextLost(): void;
  registerControls(controls: ModelViewerControls | null): void;
}

export default function ModelViewerCanvas({
  buffer,
  format,
  fileSizeBytes,
  wireframe,
  isDark,
  onStats,
  onError,
  onContextLost,
  registerControls,
}: ModelViewerCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ModelViewerHandle | null>(null);

  // Callbacks are held in refs so the scene effect below can depend on the
  // model alone. A callback in the dep array would tear down and rebuild the
  // WebGL context on every parent render.
  const callbacksRef = useRef({ onStats, onError, onContextLost, registerControls });
  callbacksRef.current = { onStats, onError, onContextLost, registerControls };

  // Mirrors of the visual props, so the scene effect can read the current value
  // at creation time without taking a dependency on it.
  const wireframeRef = useRef(wireframe);
  const isDarkRef = useRef(isDark);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let handle: ModelViewerHandle | null = null;
    try {
      handle = createModelViewer(host, {
        buffer,
        format,
        fileSizeBytes,
        isDark: isDarkRef.current,
        onContextLost: () => callbacksRef.current.onContextLost(),
      });
      handleRef.current = handle;
      handle.setWireframe(wireframeRef.current);
      callbacksRef.current.onStats(handle.stats);
      callbacksRef.current.registerControls({
        setPreset: (preset) => handleRef.current?.setPreset(preset),
        resetView: () => handleRef.current?.resetView(),
      });
    } catch (error) {
      callbacksRef.current.onError(
        error instanceof Error ? error.message : 'This model could not be displayed.',
      );
    }

    return () => {
      callbacksRef.current.registerControls(null);
      handleRef.current = null;
      // Full teardown incl. forceContextLoss — this is also what makes the
      // StrictMode double-mount in dev correct rather than a context leak.
      handle?.dispose();
    };
    // Keyed on the model only: theme and wireframe are pushed through the
    // handle by the effects below, never by rebuilding the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer, format, fileSizeBytes]);

  useEffect(() => {
    wireframeRef.current = wireframe;
    handleRef.current?.setWireframe(wireframe);
  }, [wireframe]);

  useEffect(() => {
    isDarkRef.current = isDark;
    handleRef.current?.setTheme(isDark);
  }, [isDark]);

  return <div ref={hostRef} className="h-full w-full" />;
}
