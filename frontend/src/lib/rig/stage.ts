import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * 3D object viewer + exporter. Owns the renderer, neutral studio lighting with
 * a soft ground shadow, orbit controls, a camera auto-framed to the object's
 * bounds, resize handling, and OBJ + MTL / GLB export of the current object.
 *
 * Model in real-world metres, y-up, centred on the origin — exports inherit
 * the scene's units and orientation.
 *
 * There is no environment map, so high metalness has nothing to reflect and
 * renders near-black. Cap metalness around 0.3–0.4 and carry a metal look with
 * a brighter base colour.
 */
export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  basename: string;

  private readonly host: HTMLElement;
  private readonly key: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private readonly projectVec = new THREE.Vector3();
  private object: THREE.Object3D | null = null;
  private frameHook: (() => void) | null = null;

  constructor(host: HTMLElement, basename = 'model') {
    this.host = host;
    this.basename = basename.replace(/[^\w.-]+/g, '_');
    const { renderer, degraded } = createRenderer();
    this.renderer = renderer;

    // preserveDrawingBuffer keeps the last frame readable after compositing,
    // which is what lets screenshot tooling capture the scene.
    this.renderer.setPixelRatio(
      degraded ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.shadowMap.enabled = !degraded;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.insertBefore(this.renderer.domElement, host.firstChild);

    this.camera.position.set(3, 2.2, 4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // Neutral studio: soft sky/ground wash, a shadow-casting key light, and a
    // dim fill from behind so silhouettes never go black.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
    this.key = new THREE.DirectionalLight(0xffffff, 2.2);
    this.key.position.set(4, 7, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0002;
    this.scene.add(this.key);
    const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
    fill.position.set(-5, 3, -4);
    this.scene.add(fill);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.18 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.fit();
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(host);
    this.renderer.setAnimationLoop(() => {
      this.frameHook?.();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Runs once per rendered frame, before controls and the draw call. */
  onFrame(hook: (() => void) | null) {
    this.frameHook = hook;
  }

  get viewportSize() {
    return { w: this.host.clientWidth || 1, h: this.host.clientHeight || 1 };
  }

  /** World point → normalised device coordinates. The vector is reused. */
  project(x: number, y: number, z: number): THREE.Vector3 {
    return this.projectVec.set(x, y, z).project(this.camera);
  }

  private fit() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Show (and own) the object. Replaces any previous object, enables shadows on
   * every mesh, rests it on the ground plane, and frames the camera to its
   * bounds.
   */
  setObject(object: THREE.Object3D) {
    if (this.object) this.scene.remove(this.object);
    this.object = object;
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      // Rest the object on the ground without moving its origin.
      this.ground.position.y = box.min.y;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist =
        (sphere.radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.35;
      const dir = new THREE.Vector3(1, 0.55, 1.25).normalize();
      this.camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
      this.camera.near = Math.max(dist / 100, 0.01);
      this.camera.far = dist * 100;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(sphere.center);
      this.controls.update();
      const span = sphere.radius * 3;
      const shadowCam = this.key.shadow.camera;
      shadowCam.left = -span;
      shadowCam.right = span;
      shadowCam.top = span;
      shadowCam.bottom = -span;
      shadowCam.updateProjectionMatrix();
    }
    this.scene.add(object);
  }

  /**
   * Every mesh and material needs a unique name for the OBJ o/usemtl lines —
   * fill in stable fallbacks, and return the unique material list.
   */
  private nameParts(): THREE.Material[] {
    const mats: THREE.Material[] = [];
    const seen = new Set<string>();
    let meshI = 0;
    let matI = 0;
    this.object?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.name) mesh.name = 'part_' + meshI;
      meshI += 1;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        if (!m || mats.includes(m)) continue;
        if (!m.name) {
          m.name = 'mat_' + matI;
          matI += 1;
        }
        while (seen.has(m.name)) {
          m.name = m.name + '_' + matI;
          matI += 1;
        }
        seen.add(m.name);
        mats.push(m);
      }
    });
    return mats;
  }

  async exportObj() {
    if (!this.object) return;
    const { OBJExporter } = await import(
      'three/examples/jsm/exporters/OBJExporter.js'
    );
    const mats = this.nameParts();
    const base = this.basename;
    const obj =
      'mtllib ' + base + '.mtl\n' + new OBJExporter().parse(this.object);
    let mtl = '# Exported by conveyor-rig stage\n';
    for (const m of mats) {
      const c = (m as THREE.MeshStandardMaterial).color ?? {
        r: 0.8,
        g: 0.8,
        b: 0.8,
      };
      const rough = (m as THREE.MeshStandardMaterial).roughness ?? 0.5;
      const opacity = m.opacity ?? 1;
      mtl += 'newmtl ' + m.name + '\n';
      mtl +=
        'Kd ' + c.r.toFixed(4) + ' ' + c.g.toFixed(4) + ' ' + c.b.toFixed(4) + '\n';
      mtl += 'Ks 0.2000 0.2000 0.2000\n';
      mtl += 'Ns ' + Math.round((1 - rough) * 200) + '\n';
      mtl += 'd ' + opacity.toFixed(4) + '\n\n';
    }
    download(new Blob([obj], { type: 'text/plain' }), base + '.obj');
    download(new Blob([mtl], { type: 'text/plain' }), base + '.mtl');
  }

  async exportGlb() {
    if (!this.object) return;
    const { GLTFExporter } = await import(
      'three/examples/jsm/exporters/GLTFExporter.js'
    );
    this.nameParts();
    const buf = (await new GLTFExporter().parseAsync(this.object, {
      binary: true,
    })) as ArrayBuffer;
    download(
      new Blob([buf], { type: 'model/gltf-binary' }),
      this.basename + '.glb',
    );
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}

/**
 * Some sandboxed or headless views refuse a GPU context on the first, fanciest
 * set of options. Degrade step by step — own canvas plus an explicit context
 * that tolerates a software renderer — before giving up.
 */
function createRenderer(): { renderer: THREE.WebGLRenderer; degraded: boolean } {
  const canvas = document.createElement('canvas');
  const ctxOpts: WebGLContextAttributes = {
    alpha: true,
    preserveDrawingBuffer: true,
    failIfMajorPerformanceCaveat: false,
    antialias: false,
    depth: true,
    stencil: false,
  };
  const getCtx = (kind: string) => {
    try {
      return canvas.getContext(kind, ctxOpts) as WebGLRenderingContext | null;
    } catch {
      return null;
    }
  };
  const attempts: Array<() => THREE.WebGLRendererParameters | null> = [
    () => ({ antialias: true, alpha: true, preserveDrawingBuffer: true }),
    () => ({
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    }),
    () => {
      const c = getCtx('webgl2');
      return c && { canvas, context: c, antialias: false, alpha: true, preserveDrawingBuffer: true };
    },
    () => {
      const c = getCtx('webgl') || getCtx('experimental-webgl');
      return c && { canvas, context: c, antialias: false, alpha: true, preserveDrawingBuffer: true };
    },
  ];
  let lastErr: unknown = null;
  for (let i = 0; i < attempts.length; i++) {
    const opts = attempts[i]();
    if (!opts) continue;
    try {
      return { renderer: new THREE.WebGLRenderer(opts), degraded: i > 0 };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Error creating WebGL context.');
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
