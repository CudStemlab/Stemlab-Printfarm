// Print-time and filament estimator for queue submissions.
//
// A student uploads a model to /request; staff triaging the queue want to know
// roughly how long it will take and how much filament it will eat. Two sources,
// best first:
//
//   1. 'slicer'   — the upload is an already-sliced Orca / Bambu Studio project
//                   file, so Metadata/slice_info.config carries the slicer's own
//                   weight (grams) and prediction (seconds). Exact; no guessing.
//   2. 'geometry' — a raw mesh (STL / OBJ / mesh-only 3MF). We compute the solid
//                   volume and surface area from the triangles and apply the
//                   shell/infill/flow model below. Approximate — expect ±30-50%.
//   3. 'bbox'     — the mesh is open or non-manifold, so its signed volume is
//                   meaningless. Falls back to a fraction of the bounding box.
//                   Very rough; the UI marks it the same way as 'geometry'.
//
// Everything here is dependency-free and pure (the only I/O is reading env in
// estimateConfigFromEnv), so server/printEstimate.test.mjs can exercise it with
// plain `node`. See CLAUDE.md → "Verification without a runtime".

import { extractSliceInfoFrom3mf, readZipEntry } from './threemf.js';

function envNumber(name, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

// Defaults describe a typical classroom PLA print at 0.2 mm on a bed-slinger.
// They are all env-tunable because the right values depend on the farm's
// printers and profiles, and because TIME_FACTOR lets an operator correct a
// systematic bias after comparing a few estimates to reality — no code change.
export const DEFAULT_CONFIG = Object.freeze({
  shellMm: 1.0, // combined perimeter + skin thickness applied over the surface
  infill: 0.15, // fraction of the remaining interior that is actually extruded
  densityGCm3: 1.24, // PLA
  layerMm: 0.2,
  flowMm3S: 6, // effective volumetric extrusion rate, averaged over a whole print
  layerOverheadS: 2.5, // travel / z-hop / retraction per layer
  fixedOverheadS: 180, // heat-up, bed level, purge line
  timeFactor: 1.0, // operator calibration knob
  maxTriangles: 3_000_000,
  maxBytes: 64 * 1024 * 1024,
});

export function estimateConfigFromEnv() {
  return Object.freeze({
    shellMm: envNumber('PRINT_ESTIMATE_SHELL_MM', DEFAULT_CONFIG.shellMm, { min: 0.01, max: 20 }),
    infill: envNumber('PRINT_ESTIMATE_INFILL', DEFAULT_CONFIG.infill, { min: 0, max: 1 }),
    densityGCm3: envNumber('PRINT_ESTIMATE_DENSITY', DEFAULT_CONFIG.densityGCm3, {
      min: 0.1,
      max: 10,
    }),
    layerMm: envNumber('PRINT_ESTIMATE_LAYER_MM', DEFAULT_CONFIG.layerMm, { min: 0.01, max: 2 }),
    flowMm3S: envNumber('PRINT_ESTIMATE_FLOW_MM3S', DEFAULT_CONFIG.flowMm3S, {
      min: 0.1,
      max: 500,
    }),
    layerOverheadS: envNumber('PRINT_ESTIMATE_LAYER_OVERHEAD_S', DEFAULT_CONFIG.layerOverheadS, {
      min: 0,
      max: 60,
    }),
    fixedOverheadS: envNumber('PRINT_ESTIMATE_FIXED_OVERHEAD_S', DEFAULT_CONFIG.fixedOverheadS, {
      min: 0,
      max: 7200,
    }),
    timeFactor: envNumber('PRINT_ESTIMATE_TIME_FACTOR', DEFAULT_CONFIG.timeFactor, {
      min: 0.1,
      max: 10,
    }),
    maxTriangles: Math.floor(
      envNumber('PRINT_ESTIMATE_MAX_TRIANGLES', DEFAULT_CONFIG.maxTriangles, {
        min: 1000,
        max: 100_000_000,
      }),
    ),
    maxBytes: Math.floor(
      envNumber('PRINT_ESTIMATE_MAX_BYTES', DEFAULT_CONFIG.maxBytes, {
        min: 1024,
        max: 1024 * 1024 * 1024,
      }),
    ),
  });
}

// ── geometry accumulation ────────────────────────────────────────────────────

// Running totals over a triangle soup. Volume is the signed-tetrahedron sum
// (correct for any closed surface regardless of convexity); area is the sum of
// triangle areas; bounds give the model height, which drives the layer count.
function newAccumulator() {
  return {
    volume2x: 0, // sum of v0 · (v1 × v2); divided by 6 at the end
    area2x: 0, // sum of |(v1-v0) × (v2-v0)|; halved at the end
    triangles: 0,
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
}

function addTriangle(acc, ax, ay, az, bx, by, bz, cx, cy, cz) {
  // Signed volume of the tetrahedron (origin, a, b, c).
  acc.volume2x += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);

  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  acc.area2x += Math.sqrt(nx * nx + ny * ny + nz * nz);

  acc.triangles += 1;

  if (ax < acc.minX) acc.minX = ax;
  if (bx < acc.minX) acc.minX = bx;
  if (cx < acc.minX) acc.minX = cx;
  if (ax > acc.maxX) acc.maxX = ax;
  if (bx > acc.maxX) acc.maxX = bx;
  if (cx > acc.maxX) acc.maxX = cx;

  if (ay < acc.minY) acc.minY = ay;
  if (by < acc.minY) acc.minY = by;
  if (cy < acc.minY) acc.minY = cy;
  if (ay > acc.maxY) acc.maxY = ay;
  if (by > acc.maxY) acc.maxY = by;
  if (cy > acc.maxY) acc.maxY = cy;

  if (az < acc.minZ) acc.minZ = az;
  if (bz < acc.minZ) acc.minZ = bz;
  if (cz < acc.minZ) acc.minZ = cz;
  if (az > acc.maxZ) acc.maxZ = az;
  if (bz > acc.maxZ) acc.maxZ = bz;
  if (cz > acc.maxZ) acc.maxZ = cz;
}

// Scale the finished totals — used for a 3MF build item's transform and for the
// model's `unit` attribute. A linear scale s multiplies volume by s³ and area by
// s². For a general 3×3 transform we only have the determinant, so volume is
// exact and area uses det^(2/3) as an isotropic approximation.
function scaleAccumulator(acc, det) {
  const factor = Math.abs(det);
  if (!Number.isFinite(factor) || factor === 1) return acc;
  acc.volume2x *= factor;
  acc.area2x *= Math.cbrt(factor * factor);
  const linear = Math.cbrt(factor);
  acc.minX *= linear;
  acc.maxX *= linear;
  acc.minY *= linear;
  acc.maxY *= linear;
  acc.minZ *= linear;
  acc.maxZ *= linear;
  return acc;
}

function mergeAccumulator(target, other) {
  target.volume2x += other.volume2x;
  target.area2x += other.area2x;
  target.triangles += other.triangles;
  target.minX = Math.min(target.minX, other.minX);
  target.minY = Math.min(target.minY, other.minY);
  target.minZ = Math.min(target.minZ, other.minZ);
  target.maxX = Math.max(target.maxX, other.maxX);
  target.maxY = Math.max(target.maxY, other.maxY);
  target.maxZ = Math.max(target.maxZ, other.maxZ);
  return target;
}

function finishAccumulator(acc) {
  if (acc.triangles === 0 || !Number.isFinite(acc.minZ)) return null;
  return {
    volumeMm3: Math.abs(acc.volume2x) / 6,
    areaMm2: acc.area2x / 2,
    triangles: acc.triangles,
    width: acc.maxX - acc.minX,
    depth: acc.maxY - acc.minY,
    height: acc.maxZ - acc.minZ,
  };
}

// Yield to the event loop. Mesh parsing is CPU-bound and the web tier is a
// single Node process, so a 1M-triangle STL parsed straight through would stall
// every other request for a second or more. Callers await this every
// YIELD_EVERY triangles.
const YIELD_EVERY = 50_000;
function yieldToLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

// ── format parsers ───────────────────────────────────────────────────────────

// Binary STL: 80-byte header, uint32 facet count, then 50 bytes per facet
// (3 floats normal + 9 floats vertices + uint16 attribute byte count).
async function parseBinaryStl(buf, config) {
  if (buf.length < 84) return null;
  const count = buf.readUInt32LE(80);
  if (count === 0 || count > config.maxTriangles) return null;
  if (84 + count * 50 > buf.length) return null;

  const acc = newAccumulator();
  let offset = 84;
  for (let i = 0; i < count; i += 1) {
    // Skip the 12-byte normal; it is unreliable in the wild and unused here.
    const p = offset + 12;
    addTriangle(
      acc,
      buf.readFloatLE(p),
      buf.readFloatLE(p + 4),
      buf.readFloatLE(p + 8),
      buf.readFloatLE(p + 12),
      buf.readFloatLE(p + 16),
      buf.readFloatLE(p + 20),
      buf.readFloatLE(p + 24),
      buf.readFloatLE(p + 28),
      buf.readFloatLE(p + 32),
    );
    offset += 50;
    if (i % YIELD_EVERY === YIELD_EVERY - 1) await yieldToLoop();
  }
  return finishAccumulator(acc);
}

const ASCII_VERTEX_RE = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/i;

async function parseAsciiStl(text, config) {
  const acc = newAccumulator();
  const pending = [];
  let lineStart = 0;
  let processed = 0;

  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    lineStart = lineEnd + 1;

    const match = ASCII_VERTEX_RE.exec(line);
    if (match) {
      const x = Number.parseFloat(match[1]);
      const y = Number.parseFloat(match[2]);
      const z = Number.parseFloat(match[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
      pending.push(x, y, z);
      if (pending.length === 9) {
        addTriangle(acc, ...pending);
        pending.length = 0;
        if (acc.triangles > config.maxTriangles) return null;
      }
    }

    processed += 1;
    if (processed % YIELD_EVERY === 0) await yieldToLoop();
    if (lineEnd === text.length) break;
  }

  return finishAccumulator(acc);
}

// STL sniffing: an ASCII file starts with "solid", but so do some binary files
// written by careless exporters, so the declared facet count is the real test —
// it is what three.js's STLLoader does too.
async function parseStl(buf, config) {
  if (buf.length >= 84) {
    const count = buf.readUInt32LE(80);
    if (count > 0 && 84 + count * 50 === buf.length) {
      return parseBinaryStl(buf, config);
    }
  }
  const head = buf.subarray(0, 5).toString('ascii').toLowerCase();
  if (head === 'solid') {
    return parseAsciiStl(buf.toString('utf8'), config);
  }
  return parseBinaryStl(buf, config);
}

// OBJ: `v x y z` vertices (1-based, negative indices count back from the end)
// and `f` faces of any arity, fan-triangulated. Only the position component of
// each face element (`v`, `v/vt`, `v//vn`) matters here.
async function parseObj(text, config) {
  const xs = [];
  const ys = [];
  const zs = [];
  const acc = newAccumulator();
  let lineStart = 0;
  let processed = 0;

  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    lineStart = lineEnd + 1;

    if (line.length > 1) {
      const c0 = line.charCodeAt(0);
      // 'v' = 118, 'f' = 102
      if (c0 === 118 && (line[1] === ' ' || line[1] === '\t')) {
        const parts = line.trim().split(/\s+/);
        const x = Number.parseFloat(parts[1]);
        const y = Number.parseFloat(parts[2]);
        const z = Number.parseFloat(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          xs.push(x);
          ys.push(y);
          zs.push(z);
        }
      } else if (c0 === 102 && (line[1] === ' ' || line[1] === '\t')) {
        const parts = line.trim().split(/\s+/);
        const idx = [];
        for (let i = 1; i < parts.length; i += 1) {
          const raw = Number.parseInt(parts[i].split('/')[0], 10);
          if (!Number.isInteger(raw) || raw === 0) continue;
          const resolved = raw > 0 ? raw - 1 : xs.length + raw;
          if (resolved < 0 || resolved >= xs.length) continue;
          idx.push(resolved);
        }
        for (let i = 2; i < idx.length; i += 1) {
          const a = idx[0];
          const b = idx[i - 1];
          const c = idx[i];
          addTriangle(acc, xs[a], ys[a], zs[a], xs[b], ys[b], zs[b], xs[c], ys[c], zs[c]);
          if (acc.triangles > config.maxTriangles) return null;
        }
      }
    }

    processed += 1;
    if (processed % YIELD_EVERY === 0) await yieldToLoop();
    if (lineEnd === text.length) break;
  }

  return finishAccumulator(acc);
}

// 3MF core spec length units. The model's `unit` attribute defaults to
// millimetre, which is what every slicer writes, but honouring it costs almost
// nothing and a metre-unit file would otherwise be off by 10^9 in volume.
const UNIT_TO_MM = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
const VERTEX_RE = /<vertex\s+([^>]*?)\/?>/gi;
const TRIANGLE_RE = /<triangle\s+([^>]*?)\/?>/gi;
const ITEM_RE = /<item\s+([^>]*?)\/?>/gi;

function attr(attrs, name) {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i').exec(attrs);
  return match ? match[1] : null;
}

// Determinant of the 3×3 linear part of a 3MF item transform (a row-major list
// of 12 numbers: three basis vectors then a translation). Translation does not
// affect volume, so it is ignored.
function transformDeterminant(transform) {
  if (!transform) return 1;
  const n = transform.trim().split(/\s+/).map(Number);
  if (n.length < 9 || n.some((v) => !Number.isFinite(v))) return 1;
  const det =
    n[0] * (n[4] * n[8] - n[5] * n[7]) -
    n[1] * (n[3] * n[8] - n[5] * n[6]) +
    n[2] * (n[3] * n[7] - n[4] * n[6]);
  return Number.isFinite(det) && det !== 0 ? det : 1;
}

// Mesh-only 3MF (a model exported from CAD rather than sliced). Parsed from
// 3D/3dmodel.model with regex rather than a real XML parser: the web runtime
// image has no XML dependency for this, and the two element shapes involved are
// flat attribute-only tags.
async function parse3mfMesh(buf, config) {
  const data = readZipEntry(buf, '3D/3dmodel.model');
  if (!data) return null;
  const xml = data.toString('utf8');

  const unit = (attr(xml.slice(0, 2048), 'unit') || 'millimeter').toLowerCase();
  const unitScale = UNIT_TO_MM[unit] ?? 1;

  // Accumulate each <object> separately so a build <item>'s transform can scale
  // only that object's contribution.
  const byId = new Map();
  OBJECT_RE.lastIndex = 0;
  let objectMatch = OBJECT_RE.exec(xml);
  while (objectMatch !== null) {
    const id = attr(objectMatch[1], 'id');
    const body = objectMatch[2];
    const acc = newAccumulator();
    const vx = [];
    const vy = [];
    const vz = [];

    VERTEX_RE.lastIndex = 0;
    let vertexMatch = VERTEX_RE.exec(body);
    while (vertexMatch !== null) {
      vx.push(Number.parseFloat(attr(vertexMatch[1], 'x')));
      vy.push(Number.parseFloat(attr(vertexMatch[1], 'y')));
      vz.push(Number.parseFloat(attr(vertexMatch[1], 'z')));
      vertexMatch = VERTEX_RE.exec(body);
    }

    TRIANGLE_RE.lastIndex = 0;
    let triangleMatch = TRIANGLE_RE.exec(body);
    while (triangleMatch !== null) {
      const a = Number.parseInt(attr(triangleMatch[1], 'v1') ?? '', 10);
      const b = Number.parseInt(attr(triangleMatch[1], 'v2') ?? '', 10);
      const c = Number.parseInt(attr(triangleMatch[1], 'v3') ?? '', 10);
      if (
        Number.isInteger(a) &&
        Number.isInteger(b) &&
        Number.isInteger(c) &&
        a >= 0 &&
        b >= 0 &&
        c >= 0 &&
        a < vx.length &&
        b < vx.length &&
        c < vx.length &&
        Number.isFinite(vx[a]) &&
        Number.isFinite(vx[b]) &&
        Number.isFinite(vx[c])
      ) {
        addTriangle(acc, vx[a], vy[a], vz[a], vx[b], vy[b], vz[b], vx[c], vy[c], vz[c]);
        if (acc.triangles > config.maxTriangles) return null;
        if (acc.triangles % YIELD_EVERY === 0) await yieldToLoop();
      }
      triangleMatch = TRIANGLE_RE.exec(body);
    }

    if (acc.triangles > 0 && id) byId.set(id, acc);
    objectMatch = OBJECT_RE.exec(xml);
  }

  if (byId.size === 0) return null;

  // Build items reference objects, possibly several times and with transforms.
  // A file with no <build> section (or with unresolvable references) falls back
  // to counting every object once.
  const total = newAccumulator();
  let placed = 0;
  ITEM_RE.lastIndex = 0;
  let itemMatch = ITEM_RE.exec(xml);
  while (itemMatch !== null) {
    const ref = attr(itemMatch[1], 'objectid');
    const source = ref ? byId.get(ref) : null;
    if (source) {
      const det = transformDeterminant(attr(itemMatch[1], 'transform'));
      mergeAccumulator(total, scaleAccumulator({ ...source }, det));
      placed += 1;
    }
    itemMatch = ITEM_RE.exec(xml);
  }
  if (placed === 0) {
    for (const acc of byId.values()) mergeAccumulator(total, acc);
  }

  return finishAccumulator(scaleAccumulator(total, unitScale ** 3));
}

// ── the model ────────────────────────────────────────────────────────────────

// Turn geometry into grams and minutes.
//
//   shellV    = surface area × shell thickness, i.e. perimeters and skins
//               treated as one band wrapping the whole surface
//   materialV = shellV + the remaining interior at the infill fraction
//   time      = fixed overhead + extrusion at the effective flow rate
//               + a per-layer travel cost, scaled by the calibration factor
//
// This is a heuristic, not a slicer: it ignores supports, brims, variable layer
// height, and the fact that thin walls are all shell. Hence the ± in the UI.
function geometryToEstimate(geometry, pieces, config) {
  const modelV = geometry.volumeMm3;
  const shellV = Math.min(geometry.areaMm2 * config.shellMm, modelV);
  const rawMaterialV = shellV + (modelV - shellV) * config.infill;
  const materialV = Math.min(Math.max(rawMaterialV, modelV * config.infill), modelV);

  const gramsEach = (materialV / 1000) * config.densityGCm3;
  const layers = Math.max(1, Math.ceil(geometry.height / config.layerMm));
  const secondsEach =
    config.fixedOverheadS + materialV / config.flowMm3S + layers * config.layerOverheadS;

  return {
    grams: Math.round(gramsEach * pieces * 10) / 10,
    minutes: Math.max(1, Math.round((secondsEach * config.timeFactor * pieces) / 60)),
  };
}

function extensionOf(filename) {
  const name = String(filename || '');
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Estimate a queue submission's print time and filament usage.
 *
 * @param {Buffer} buffer   the uploaded model bytes
 * @param {string} filename used only to pick a parser
 * @param {{ pieces?: number, config?: object }} [options]
 * @returns {Promise<{ grams: number|null, minutes: number, source: 'slicer'|'geometry'|'bbox' }|null>}
 *   null when nothing usable could be read (unsupported/corrupt/oversized), which
 *   the caller records as estimate_source 'none' so it is not retried forever.
 */
export async function estimateFromModel(buffer, filename, options = {}) {
  const config = options.config ?? estimateConfigFromEnv();
  const pieces = Math.max(1, Math.floor(options.pieces ?? 1));
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  if (buffer.length > config.maxBytes) return null;

  const ext = extensionOf(filename);

  // A sliced project file wins outright — those are the slicer's own numbers.
  if (ext === '.3mf') {
    const sliced = extractSliceInfoFrom3mf(buffer);
    if (sliced && (sliced.grams !== null || sliced.seconds !== null)) {
      return {
        grams: sliced.grams === null ? null : Math.round(sliced.grams * pieces * 10) / 10,
        minutes:
          sliced.seconds === null
            ? Math.max(30, pieces * 60)
            : Math.max(1, Math.round((sliced.seconds * pieces) / 60)),
        source: 'slicer',
      };
    }
  }

  let geometry = null;
  if (ext === '.stl') {
    geometry = await parseStl(buffer, config);
  } else if (ext === '.obj') {
    geometry = await parseObj(buffer.toString('utf8'), config);
  } else if (ext === '.3mf') {
    geometry = await parse3mfMesh(buffer, config);
  }
  if (!geometry) return null;

  // A signed volume outside (0, bbox] means the surface is not closed — an open
  // or self-intersecting mesh. The number is then meaningless, so fall back to a
  // fraction of the bounding box and say so via the source.
  const bboxV = geometry.width * geometry.depth * geometry.height;
  let source = 'geometry';
  if (!(geometry.volumeMm3 > 0) || (bboxV > 0 && geometry.volumeMm3 > bboxV * 1.001)) {
    if (!(bboxV > 0)) return null;
    // Assume the part fills 30% of its bounding box, and use the box's own
    // surface area for the shell term — the mesh's area is as untrustworthy as
    // its volume once the surface is known to be open.
    const bboxArea =
      2 *
      (geometry.width * geometry.depth +
        geometry.width * geometry.height +
        geometry.depth * geometry.height);
    geometry = { ...geometry, volumeMm3: bboxV * 0.3, areaMm2: bboxArea };
    source = 'bbox';
  }

  const { grams, minutes } = geometryToEstimate(geometry, pieces, config);
  if (!Number.isFinite(grams) || !Number.isFinite(minutes) || grams <= 0) return null;
  return { grams, minutes, source };
}
