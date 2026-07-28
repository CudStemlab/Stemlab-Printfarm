// three.js scene for the queue's 3D model preview.
//
// This is the ONLY module in src/ that imports three. It is reached exclusively
// through the React.lazy() import in QueueModelViewerDialog, which is what keeps
// the ~640 KB `three` chunk (see the manualChunks rule in vite.config.js) off
// the first-paint path. Keep it framework-agnostic: it takes a host element and
// returns an imperative handle, so the React wrapper stays a thin lifecycle
// shim.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import type { ModelFormat } from './modelFormats';

export type ViewPreset = 'iso' | 'top' | 'front';

export interface ModelStats {
  // Bounding-box extents in millimetres, along the printing axes (Z up).
  width: number;
  depth: number;
  height: number;
  triangles: number;
  meshes: number;
  fileSizeBytes: number;
}

export interface ModelViewerOptions {
  buffer: ArrayBuffer;
  format: ModelFormat;
  fileSizeBytes: number;
  isDark: boolean;
  onContextLost?: () => void;
}

export interface ModelViewerHandle {
  stats: ModelStats;
  setWireframe(on: boolean): void;
  setTheme(isDark: boolean): void;
  setPreset(preset: ViewPreset): void;
  resetView(): void;
  dispose(): void;
}

// User-facing failure messages. They are deliberately generic — nothing here
// may leak a path, host or connection detail (see the error/telemetry invariant
// in CLAUDE.md).
export const EMPTY_MODEL_MESSAGE = 'This file contains no renderable geometry.';
const WEBGL_UNAVAILABLE_MESSAGE =
  '3D preview is not supported on this device or browser. Download the file to inspect it.';
const PARSE_FAILED_MESSAGE = 'This file could not be read as a 3D model. It may be corrupt.';

// Neutral "unpainted part" greys. These are model-render parameters, not UI
// chrome, so they have no theme token — the surface behind the canvas is a
// themed Tailwind class and the canvas itself is transparent.
const MESH_COLOR_LIGHT = 0x9aa4b2;
const MESH_COLOR_DARK = 0x8b95a5;

// Parsing is synchronous and CPU-bound (~0.2-2 s for typical files) and runs on
// the main thread on purpose. A worker is CSP-legal here (worker-src 'self'
// blob:) and would pay off for STL, whose single BufferGeometry transfers back
// cleanly — but OBJ and 3MF return a whole Object3D graph with materials,
// transforms and textures that is not structured-cloneable, so most of the
// parse would have to be re-paid on the main thread anyway. Revisit as an
// STL-only optimisation if real 40-50 MB files prove intolerable; the caller
// yields a frame first so the "Parsing…" state actually paints.
function parseModel(buffer: ArrayBuffer, format: ModelFormat): THREE.Object3D {
  if (format === 'stl') {
    // STLLoader sniffs binary-vs-ASCII itself (it checks the 84-byte header's
    // declared facet count against the byte length before falling back to text).
    const geometry = new STLLoader().parse(buffer);
    if (!geometry.getAttribute('normal')) {
      geometry.computeVertexNormals();
    }
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  }

  if (format === '3mf') {
    // Note: ThreeMFLoader reads the model's `unit` attribute but never applies
    // it as a scale, and does not expose it on the returned group. Millimetres
    // is the 3MF default and what every slicer writes, so the dimensions panel
    // states that assumption rather than implying certainty.
    return new ThreeMFLoader().parse(buffer);
  }

  // OBJ is ASCII by definition. Decode non-fatally so a stray non-UTF-8 byte in
  // a comment can't fail the whole parse.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  return new OBJLoader().parse(text);
}

// Aggregate bounding box and triangle count across the whole object graph, so a
// single STL Mesh and a multi-object 3MF/OBJ Group are handled identically.
export function computeModelStats(object: THREE.Object3D, fileSizeBytes: number): ModelStats {
  // 3MF build items carry per-item transforms; without this the union box is
  // computed in local space and reads wrong for anything but a single object.
  object.updateMatrixWorld(true);

  const bounds = new THREE.Box3();
  let triangles = 0;
  let meshes = 0;

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    // OBJLoader can also emit Line and Points objects — neither contributes
    // triangles, and neither is part of what gets printed.
    if (!mesh.isMesh || !mesh.geometry) return;

    const geometry = mesh.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    if (!position || position.count === 0) return;

    meshes += 1;

    const index = geometry.getIndex();
    let vertexCount = index ? index.count : position.count;
    if (Number.isFinite(geometry.drawRange.count)) {
      vertexCount = Math.min(vertexCount, geometry.drawRange.count);
    }
    const meshTriangles = Math.floor(vertexCount / 3);
    const instanced = mesh as THREE.InstancedMesh;
    triangles += instanced.isInstancedMesh ? meshTriangles * instanced.count : meshTriangles;

    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      // Clone before transforming — applyMatrix4 mutates in place, and the box
      // is cached on the geometry (and shared if two meshes reuse a geometry).
      bounds.union(geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
  });

  const size = bounds.isEmpty() ? new THREE.Vector3() : bounds.getSize(new THREE.Vector3());
  return {
    width: size.x,
    depth: size.y,
    height: size.z,
    triangles,
    meshes,
    fileSizeBytes,
  };
}

function disposeMaterial(material: THREE.Material) {
  // Textures are only reachable through the material's own properties (3MF can
  // carry base-colour textures), so walk the values and dispose what we find.
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

export function createModelViewer(
  host: HTMLElement,
  { buffer, format, fileSizeBytes, isDark, onContextLost }: ModelViewerOptions,
): ModelViewerHandle {
  let object: THREE.Object3D;
  try {
    object = parseModel(buffer, format);
  } catch {
    throw new Error(PARSE_FAILED_MESSAGE);
  }

  const stats = computeModelStats(object, fileSizeBytes);
  if (stats.triangles === 0) {
    throw new Error(EMPTY_MODEL_MESSAGE);
  }

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    throw new Error(WEBGL_UNAVAILABLE_MESSAGE);
  }

  // Transparent clear: the themed Tailwind surface behind the canvas supplies
  // the background, so light/dark follow the app's tokens for free. Theme
  // tokens are oklch(), which THREE.Color cannot parse, so reading them into
  // the scene is not an option anyway.
  renderer.setClearAlpha(0);
  // A 3x retina ratio means 9x the fragments for no visible gain on a preview.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  // Z-up: STL/3MF/OBJ from CAD and every slicer's build plate are Z-up, while
  // three defaults to Y-up. This MUST be set before OrbitControls is
  // constructed — the controls snapshot camera.up into their orbit quaternion
  // once, in the constructor, and never re-read it.
  camera.up.set(0, 0, 1);

  const sharedMaterial = new THREE.MeshStandardMaterial({
    color: isDark ? MESH_COLOR_DARK : MESH_COLOR_LIGHT,
    roughness: 0.55,
    metalness: 0.02,
    // Inverted facets are common in exported STLs; single-sided rendering turns
    // those into holes that look like model defects but aren't.
    side: THREE.DoubleSide,
  });

  // Replace every loader-assigned material with one shared material so the view
  // is consistent across formats and the wireframe toggle is a single flag.
  // The originals are orphaned, so keep them for disposal.
  const orphanedMaterials: THREE.Material[] = [];
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    orphanedMaterials.push(...previous.filter(Boolean));
    mesh.material = sharedMaterial;
  });
  scene.add(object);

  // Lighting rig: a scene-level hemisphere for ambient fill plus two
  // directionals parented to the camera, so the model stays evenly lit as it is
  // orbited (no dark side to hide a defect in). No env map — that would mean an
  // extra asset fetch for a preview.
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x445566, isDark ? 1.4 : 1.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, isDark ? 2.0 : 2.4);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
  keyLight.position.set(1, 1.4, 1);
  fillLight.position.set(-1, -0.4, 0.6);
  camera.add(keyLight, fillLight);
  scene.add(hemisphere, camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  // Damping requires controls.update() every frame, which means a permanent rAF
  // loop. A preview dialog can sit open for minutes, so we render on demand
  // instead and trade inertia for not pegging a mobile GPU on a static image.
  controls.enableDamping = false;
  // Pan should track the cursor rather than slide along the ground plane.
  controls.screenSpacePanning = true;

  let rafId = 0;
  let disposed = false;

  function invalidate() {
    if (disposed || rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderer.render(scene, camera);
    });
  }

  const PRESET_DIRECTIONS: Record<ViewPreset, THREE.Vector3> = {
    iso: new THREE.Vector3(1, -1, 0.8),
    front: new THREE.Vector3(0, -1, 0),
    // A pure +Z top view is degenerate against a +Z up vector (lookAt has no
    // defined roll). Tilting by ~0.06° keeps the orbit axis consistent with the
    // controls' cached quaternion while still reading as a top view, with +Y
    // pointing up the screen the way slicers show it.
    top: new THREE.Vector3(0, -0.001, 1),
  };

  let currentPreset: ViewPreset = 'iso';

  // The object never moves, so its world bounds are computed once and reused by
  // every re-frame (preset switch, reset, resize).
  const modelBox = new THREE.Box3().setFromObject(object);
  const modelCenter = modelBox.isEmpty()
    ? new THREE.Vector3()
    : modelBox.getCenter(new THREE.Vector3());
  const modelSize = modelBox.isEmpty()
    ? new THREE.Vector3(1, 1, 1)
    : modelBox.getSize(new THREE.Vector3());
  // Clamp so a degenerate (flat or single-point) mesh cannot produce a zero
  // distance and a NaN projection matrix.
  const modelRadius = Math.max(modelSize.length() * 0.5, 1e-4);

  function frame(preset: ViewPreset) {
    currentPreset = preset;

    const center = modelCenter;
    const radius = modelRadius;

    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    // Fit against whichever axis is tighter, so a wide part is not clipped on a
    // landscape canvas. 1.25 leaves a 25% margin around the model.
    const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.25;

    const direction = PRESET_DIRECTIONS[preset].clone().normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    // Tight near/far around the fitted distance keeps depth precision usable on
    // very large or very small parts.
    camera.near = Math.max(distance / 1000, 0.001);
    camera.far = distance * 10 + radius * 4;
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.minDistance = radius * 0.05;
    controls.maxDistance = distance * 8;
    controls.update();
    invalidate();
  }

  const resizeObserver = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (!rect) return;
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    // The dialog animates in and out, so the host is transiently zero-sized —
    // dividing by it would put NaN in the projection matrix.
    if (width < 1 || height < 1) return;
    // `false`: leave the canvas' inline CSS size alone, our stylesheet owns it.
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  });

  function handleContextLost(event: Event) {
    // Without preventDefault the context can never be restored, and the canvas
    // just stays frozen with no signal to the user.
    event.preventDefault();
    onContextLost?.();
  }
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

  // Size once up front so the first frame is not 1x1 if the host is already
  // laid out; the observer takes over from here.
  const initialWidth = Math.max(Math.floor(host.clientWidth), 1);
  const initialHeight = Math.max(Math.floor(host.clientHeight), 1);
  renderer.setSize(initialWidth, initialHeight, false);
  camera.aspect = initialWidth / initialHeight;
  camera.updateProjectionMatrix();

  controls.addEventListener('change', invalidate);
  resizeObserver.observe(host);
  frame('iso');

  return {
    stats,
    setWireframe(on: boolean) {
      sharedMaterial.wireframe = on;
      invalidate();
    },
    setTheme(nextIsDark: boolean) {
      sharedMaterial.color.setHex(nextIsDark ? MESH_COLOR_DARK : MESH_COLOR_LIGHT);
      hemisphere.intensity = nextIsDark ? 1.4 : 1.8;
      keyLight.intensity = nextIsDark ? 2.0 : 2.4;
      invalidate();
    },
    setPreset(preset: ViewPreset) {
      frame(preset);
    },
    resetView() {
      // Re-frames the camera AND re-centres the orbit target — someone who
      // panned far away and hits Reset expects the model back, not just a
      // rotation.
      frame(currentPreset);
    },
    dispose() {
      if (disposed) return;
      disposed = true;

      cancelAnimationFrame(rafId);
      rafId = 0;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      controls.removeEventListener('change', invalidate);
      controls.dispose();

      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.filter(Boolean).forEach(disposeMaterial);
        }
      });
      orphanedMaterials.forEach(disposeMaterial);
      scene.clear();

      renderer.dispose();
      // Browsers cap live WebGL contexts (~8-16). Without forceContextLoss the
      // context survives dispose() and roughly the tenth open of this dialog
      // fails outright with "Error creating WebGL context".
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
