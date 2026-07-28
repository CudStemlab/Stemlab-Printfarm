// Model-format helpers for the queue's 3D preview.
//
// Deliberately three.js-free: QueueItem and QueueModelViewerDialog import this
// to decide whether a job is previewable at all, and they must not drag the
// ~640 KB three chunk into the eager bundle. Everything that touches three
// lives in ./modelViewer.ts, which is only reached through a dynamic import.

export type ModelFormat = 'stl' | '3mf' | 'obj';

// Mirrors QUEUE_ALLOWED_FILE_EXT in server/app.js — the print-request intake
// only accepts these three, and all three have a pure-JS three.js loader (the
// CSP has no 'wasm-unsafe-eval', so a WASM decoder would be blocked).
const EXTENSION_FORMATS: Record<string, ModelFormat> = {
  stl: 'stl',
  '3mf': '3mf',
  obj: 'obj',
};

// Above this the model is not downloaded at all — parsing it in a browser tab
// is not a reasonable ask. Sits above the server's 50 MB QUEUE_UPLOAD_MAX_BYTES
// so a file at the intake ceiling still gets the "preview anyway" path below.
export const PREVIEW_HARD_LIMIT_BYTES = 64 * 1024 * 1024;

// Above this we warn and require an explicit confirmation before downloading.
// A 24 MB binary STL is roughly 480k triangles; three's STLLoader emits a
// non-indexed position + normal buffer (36 bytes per triangle each), so the
// typed arrays alone are ~35 MB before the GPU copy. Fine on a desktop, a
// coin-flip on a low-memory Chromebook or phone.
export const PREVIEW_SOFT_LIMIT_BYTES = 24 * 1024 * 1024;

// Past this triangle count the viewer still works but interaction gets choppy;
// we surface a non-blocking warning rather than pretending otherwise (there is
// no cheap decimator available client-side).
export const HIGH_DETAIL_TRIANGLES = 1_500_000;

// Resolve a previewable format from the stored filename, falling back to the
// MIME type when the name is unhelpful. Returns null for anything we cannot
// render, which is the caller's cue to hide the preview action entirely rather
// than open a dialog that only apologises.
export function detectModelFormat(filename?: string | null, mime?: string | null): ModelFormat | null {
  const extension = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension && EXTENSION_FORMATS[extension]) {
    return EXTENSION_FORMATS[extension];
  }

  const normalizedMime = mime?.toLowerCase() ?? '';
  if (normalizedMime.includes('3mf')) return '3mf';
  if (normalizedMime.includes('stl')) return 'stl';
  if (normalizedMime.includes('obj')) return 'obj';

  return null;
}
