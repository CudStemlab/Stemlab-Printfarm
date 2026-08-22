// Unit tests for the queue print/filament estimator.
//
//   node server/printEstimate.test.mjs
//
// No runtime deps and no database — see CLAUDE.md → "Verification without a
// runtime". Every geometric assertion is against a shape whose volume and
// surface area are known analytically (a cube), so a regression in the
// tetrahedron sum or the triangle-area sum shows up as a hard failure rather
// than a plausible-looking number.

import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { estimateFromModel, DEFAULT_CONFIG } from './printEstimate.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

// The 12 triangles of an axis-aligned cube [0,s]³, wound outward. Volume s³,
// surface area 6s².
function cubeTriangles(s) {
  const v = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
    [0, 0, s],
    [s, 0, s],
    [s, s, s],
    [0, s, s],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2], // bottom (z = 0), normal -Z
    [4, 5, 6],
    [4, 6, 7], // top (z = s), normal +Z
    [0, 1, 5],
    [0, 5, 4], // front (y = 0)
    [1, 2, 6],
    [1, 6, 5], // right (x = s)
    [2, 3, 7],
    [2, 7, 6], // back (y = s)
    [3, 0, 4],
    [3, 4, 7], // left (x = 0)
  ];
  return faces.map(([a, b, c]) => [v[a], v[b], v[c]]);
}

function binaryStlCube(s) {
  const tris = cubeTriangles(s);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const tri of tris) {
    off += 12; // normal left as zeros — the parser ignores it
    for (const [x, y, z] of tri) {
      buf.writeFloatLE(x, off);
      buf.writeFloatLE(y, off + 4);
      buf.writeFloatLE(z, off + 8);
      off += 12;
    }
    off += 2; // attribute byte count
  }
  return buf;
}

function asciiStlCube(s) {
  const lines = ['solid cube'];
  for (const tri of cubeTriangles(s)) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (const [x, y, z] of tri) lines.push(`      vertex ${x} ${y} ${z}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid cube');
  return Buffer.from(lines.join('\n'), 'utf8');
}

function objCube(s) {
  const tris = cubeTriangles(s);
  const lines = ['# cube'];
  const index = new Map();
  const verts = [];
  for (const tri of tris) {
    for (const p of tri) {
      const key = p.join(',');
      if (!index.has(key)) {
        verts.push(p);
        index.set(key, verts.length); // 1-based
      }
    }
  }
  for (const [x, y, z] of verts) lines.push(`v ${x} ${y} ${z}`);
  for (const tri of tris) {
    lines.push(`f ${tri.map((p) => index.get(p.join(','))).join(' ')}`);
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

// Minimal ZIP writer (deflate, no data descriptor) so the 3MF fixtures exercise
// the same reader path a real slicer's output does.
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, contentBuf] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(contentBuf);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(8, 8); // deflate
    lfh.writeUInt32LE(0, 14); // crc — unchecked by this reader
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(contentBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lfh, nameBuf, comp);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(contentBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    centrals.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + comp.length;
  }
  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, eocd]);
}

function slicedThreeMf({ weight, prediction }) {
  const metadata = [
    weight === undefined ? '' : `      <metadata key="weight" value="${weight}"/>`,
    prediction === undefined ? '' : `      <metadata key="prediction" value="${prediction}"/>`,
  ]
    .filter(Boolean)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
${metadata}
      <filament id="1" type="PLA" color="#FFFFFF" used_g="12.5"/>
  </plate>
</config>`;
  return buildZip([['Metadata/slice_info.config', Buffer.from(xml, 'utf8')]]);
}

function meshThreeMf(s, { unit = 'millimeter', transform = null } = {}) {
  const v = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
    [0, 0, s],
    [s, 0, s],
    [s, s, s],
    [0, s, s],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${v.map(([x, y, z]) => `          <vertex x="${x}" y="${y}" z="${z}"/>`).join('\n')}
        </vertices>
        <triangles>
${faces.map(([a, b, c]) => `          <triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"${transform ? ` transform="${transform}"` : ''}/>
  </build>
</model>`;
  return buildZip([['3D/3dmodel.model', Buffer.from(xml, 'utf8')]]);
}

// Expected grams/minutes for a solid cube of side s, straight from the model in
// geometryToEstimate — recomputed here independently so a change to the formula
// has to be made deliberately in both places.
function expectedCube(s, pieces = 1, config = DEFAULT_CONFIG) {
  const modelV = s ** 3;
  const areaMm2 = 6 * s * s;
  const shellV = Math.min(areaMm2 * config.shellMm, modelV);
  const materialV = Math.min(
    Math.max(shellV + (modelV - shellV) * config.infill, modelV * config.infill),
    modelV,
  );
  const layers = Math.max(1, Math.ceil(s / config.layerMm));
  const secondsEach =
    config.fixedOverheadS + materialV / config.flowMm3S + layers * config.layerOverheadS;
  return {
    grams: Math.round((materialV / 1000) * config.densityGCm3 * pieces * 10) / 10,
    minutes: Math.max(1, Math.round((secondsEach * config.timeFactor * pieces) / 60)),
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

const SIDE = 20;
const opts = { config: DEFAULT_CONFIG };

await test('binary STL cube → geometry estimate matching the analytic volume', async () => {
  const result = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', opts);
  assert.equal(result.source, 'geometry');
  assert.deepEqual(
    { grams: result.grams, minutes: result.minutes },
    expectedCube(SIDE),
    'binary STL cube estimate',
  );
});

await test('ASCII STL cube matches the binary one exactly', async () => {
  const ascii = await estimateFromModel(asciiStlCube(SIDE), 'cube.stl', opts);
  const binary = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', opts);
  assert.equal(ascii.source, 'geometry');
  assert.deepEqual(ascii, binary, 'ASCII and binary STL must agree');
});

await test('OBJ cube matches the STL one exactly', async () => {
  const obj = await estimateFromModel(objCube(SIDE), 'cube.obj', opts);
  const stl = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', opts);
  assert.equal(obj.source, 'geometry');
  assert.deepEqual(obj, stl, 'OBJ and STL must agree');
});

await test('mesh-only 3MF cube matches the STL one exactly', async () => {
  const tmf = await estimateFromModel(meshThreeMf(SIDE), 'cube.3mf', opts);
  const stl = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', opts);
  assert.equal(tmf.source, 'geometry');
  assert.deepEqual(tmf, stl, '3MF mesh and STL must agree');
});

await test('3MF unit="centimeter" scales volume by 1000', async () => {
  const cm = await estimateFromModel(meshThreeMf(SIDE, { unit: 'centimeter' }), 'cube.3mf', opts);
  const mm = await estimateFromModel(meshThreeMf(SIDE * 10), 'cube.3mf', opts);
  assert.equal(cm.grams, mm.grams, 'a 20 cm cube must weigh the same as a 200 mm cube');
});

await test('3MF build-item transform scales the estimate by its determinant', async () => {
  // Uniform 2× scale → 8× volume, i.e. the same as a cube of twice the side.
  const scaled = await estimateFromModel(
    meshThreeMf(SIDE, { transform: '2 0 0 0 2 0 0 0 2 0 0 0' }),
    'cube.3mf',
    opts,
  );
  const doubled = await estimateFromModel(binaryStlCube(SIDE * 2), 'cube.stl', opts);
  assert.equal(scaled.grams, doubled.grams, 'transform determinant must scale grams');
});

await test('sliced 3MF wins over geometry and reports the slicer numbers', async () => {
  const buf = slicedThreeMf({ weight: 42.5, prediction: 5400 });
  const result = await estimateFromModel(buf, 'plate.gcode.3mf', opts);
  assert.deepEqual(result, { grams: 42.5, minutes: 90, source: 'slicer' });
});

await test('sliced 3MF sums weight and prediction across plates', async () => {
  const xml = `<config>
  <plate><metadata key="weight" value="10"/><metadata key="prediction" value="600"/></plate>
  <plate><metadata key="weight" value="5.5"/><metadata key="prediction" value="1200"/></plate>
</config>`;
  const buf = buildZip([['Metadata/slice_info.config', Buffer.from(xml, 'utf8')]]);
  const result = await estimateFromModel(buf, 'two-plates.3mf', opts);
  assert.deepEqual(result, { grams: 15.5, minutes: 30, source: 'slicer' });
});

await test('sliced 3MF with weight but no prediction keeps the quantity fallback', async () => {
  const result = await estimateFromModel(slicedThreeMf({ weight: 20 }), 'p.3mf', {
    ...opts,
    pieces: 2,
  });
  assert.equal(result.source, 'slicer');
  assert.equal(result.grams, 40);
  assert.equal(result.minutes, 120, 'falls back to max(30, pieces * 60) minutes');
});

await test('pieces scales grams and time', async () => {
  const one = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', { ...opts, pieces: 1 });
  const three = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', { ...opts, pieces: 3 });
  assert.deepEqual(
    { grams: three.grams, minutes: three.minutes },
    expectedCube(SIDE, 3),
    'three pieces',
  );
  assert.ok(Math.abs(three.grams - one.grams * 3) < 0.11, 'grams scale linearly');
});

await test('open (non-manifold) mesh falls back to the bbox source', async () => {
  // A single triangle: no enclosed volume at all.
  const tris = [
    [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 5],
    ],
  ];
  const buf = Buffer.alloc(84 + 50);
  buf.writeUInt32LE(1, 80);
  let off = 84 + 12;
  for (const [x, y, z] of tris[0]) {
    buf.writeFloatLE(x, off);
    buf.writeFloatLE(y, off + 4);
    buf.writeFloatLE(z, off + 8);
    off += 12;
  }
  const result = await estimateFromModel(buf, 'sheet.stl', opts);
  assert.equal(result.source, 'bbox');
  assert.ok(result.grams > 0 && result.minutes > 0, 'bbox fallback still yields numbers');
});

await test('garbage bytes yield no estimate', async () => {
  const junk = Buffer.from('this is not a model file at all, not even close', 'utf8');
  assert.equal(await estimateFromModel(junk, 'junk.stl', opts), null);
  assert.equal(await estimateFromModel(junk, 'junk.obj', opts), null);
  assert.equal(await estimateFromModel(junk, 'junk.3mf', opts), null);
});

await test('unsupported extension, empty buffer and oversized input yield null', async () => {
  assert.equal(await estimateFromModel(binaryStlCube(SIDE), 'cube.step', opts), null);
  assert.equal(await estimateFromModel(Buffer.alloc(0), 'cube.stl', opts), null);
  assert.equal(
    await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', {
      config: { ...DEFAULT_CONFIG, maxBytes: 10 },
    }),
    null,
  );
});

await test('a mesh over maxTriangles is refused rather than parsed', async () => {
  const result = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', {
    config: { ...DEFAULT_CONFIG, maxTriangles: 5 },
  });
  assert.equal(result, null, '12-triangle cube must be refused when the cap is 5');
});

await test('timeFactor scales minutes without touching grams', async () => {
  const base = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', opts);
  const doubled = await estimateFromModel(binaryStlCube(SIDE), 'cube.stl', {
    config: { ...DEFAULT_CONFIG, timeFactor: 2 },
  });
  assert.equal(doubled.grams, base.grams, 'timeFactor must not change filament');
  assert.ok(Math.abs(doubled.minutes - base.minutes * 2) <= 1, 'timeFactor doubles minutes');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
