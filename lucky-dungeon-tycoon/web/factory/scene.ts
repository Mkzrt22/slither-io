/**
 * scene.ts — Real-3D food campus for the production-line game (high detail).
 *
 * The simulation is the same five-stage flow (receiving → prep → cooking →
 * plating → delivery), but staged as a CAMPUS rather than a conveyor: five
 * distinct buildings sit on a map, each with its own architecture, rooftop
 * sign, buffer gauge, status light and working chefs. Goods travel between
 * buildings along roads on a DIFFERENT vehicle per leg — a forklift, a cargo
 * trike, an electric tug + trolley, a box van — and delivery scooters leave the
 * map to sell. Traffic density tracks the line's real throughput, and the
 * bottleneck building glows red.
 *
 * Quality: PBR materials lit by a procedural environment map, GTAO + UnrealBloom
 * + ACES + SMAA post-processing (with a Perf fallback), soft shadows, steam and
 * sparks. Three.js is vendored/bundled; everything else is procedural, so the
 * scene is fully offline. Public API unchanged: setState() + update loop.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FactoryEngine } from '../../src/factory/FactoryEngine.js';
import { FactoryState, STATION_IDS, StationId } from '../../src/factory/types.js';
import { MANAGER_BY_ID, STATION_DEF_BY_ID } from '../../src/factory/config.js';
import { makeGlow } from '../iso3dtex.js';

export type GfxQuality = 'ultra' | 'basic';

/** Building footprint centres on the campus map (x, z). */
const BUILDING_POS: Record<StationId, [number, number]> = {
  receiving: [-14.5, -7.0],
  prep: [-16.0, 7.0],
  cooking: [0.0, 11.0],
  plating: [16.0, 7.0],
  delivery: [14.5, -7.0],
};
/** Plaza centre; buildings face it and dock toward it. */
const PLAZA_C: [number, number] = [0, 2];
/** How far in front of each building its road dock sits (world units). */
const DOCK_OFFSET = 3.0;

const STATION_COLOR: Record<StationId, number> = {
  receiving: 0x3f73b4, prep: 0x3aa06e, cooking: 0xd06536, plating: 0xc09a36, delivery: 0xb04246,
};
const STATION_ACCENT: Record<StationId, number> = {
  receiving: 0x7cc0ff, prep: 0x7dffb0, cooking: 0xff9a3a, plating: 0xffe27a, delivery: 0xff8a8a,
};
type FxKind = 'steam' | 'spark' | null;
const STATION_FX: Record<StationId, FxKind> = {
  receiving: null, prep: 'spark', cooking: 'steam', plating: 'steam', delivery: null,
};

interface BuildingVis {
  id: StationId;
  group: THREE.Group;
  body: THREE.Mesh;              // scaled by level
  gaugeFill: THREE.Mesh;
  ring: THREE.Mesh;             // bottleneck halo
  pick: THREE.Mesh;
  screenMat: THREE.MeshStandardMaterial;
  statusMat: THREE.MeshStandardMaterial;
  statusGlow: THREE.Sprite;
  fx: FxKind;
  fxAnchor: THREE.Vector3;
  npcs: THREE.Group[];
  managerFigure: THREE.Group | null;
  managerId: string | null;
  door: THREE.Vector3;          // road/vehicle anchor (world space)
  rate: number;
}

const RARITY_COLOR: Record<string, number> = {
  COMMON: 0xffffff, RARE: 0x5fa8ff, EPIC: 0xb46ad8, LEGENDARY: 0xffd24a,
};

interface Vehicle { group: THREE.Group; t: number; speed: number; active: boolean; }
interface Leg {
  from: THREE.Vector3; to: THREE.Vector3;
  make: () => THREE.Group; pool: Vehicle[]; accum: number; turn: number;
}
interface Particle { mesh: THREE.Mesh; vx: number; vy: number; life: number; max: number; }
interface Roamer { mesh: THREE.Group; x: number; z: number; tx: number; tz: number; speed: number; pause: number; phase: number; }

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export class FactoryScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly world = new THREE.Group();
  private readonly sun: THREE.DirectionalLight;

  private readonly buildings = new Map<StationId, BuildingVis>();
  private readonly legs: Leg[] = [];
  private readonly particles: Particle[] = [];
  private readonly roamers: Roamer[] = [];

  // Day/night cycle: emissive materials that brighten after dark, the star
  // field, and the current darkness factor (0 = noon, 1 = deep night).
  private hemi!: THREE.HemisphereLight;
  private readonly nightMats: { mat: THREE.MeshStandardMaterial; day: number; night: number }[] = [];
  private stars: THREE.Points | null = null;
  private dayT = 40; // start mid-morning
  private night = 0;
  private readonly daySky = new THREE.Color(0x24344a);
  private readonly nightSky = new THREE.Color(0x080b12);
  private readonly skyColor = new THREE.Color();

  // Floating "+€" income sprites over the delivery depot.
  private readonly floaters: { sprite: THREE.Sprite; life: number }[] = [];
  private incomeAccum = 0;
  private revPerSec = 0;

  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private quality: GfxQuality = 'ultra';

  private state: FactoryState | null = null;
  private throughput = 0;
  private bottleneck: StationId = 'cooking';
  private steamAccum = 0;
  private sparkAccum = 0;
  private centerFlag: THREE.Mesh | null = null;

  private raf = 0; private last = 0; private t = 0;
  private yaw = 0; private targetYaw = 0;
  private viewSize = 42; private targetViewSize = 42; private aspect = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragging = false; private dragMoved = 0; private lastPX = 0;
  private lastPinch = 0; private pinching = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onTapStation: (id: StationId) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    (this.renderer as unknown as { outputColorSpace: string }).outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;

    this.scene.background = new THREE.Color(0x121821);
    this.scene.fog = new THREE.Fog(0x121821, 50, 95);
    this.camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 240);
    this.camera.position.set(26, 28, 30);
    this.camera.lookAt(0, 0.8, 2.0);
    this.scene.add(this.world);

    this.hemi = new THREE.HemisphereLight(0xdce8ff, 0x2b3038, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1da, 2.05);
    this.sun.position.set(16, 30, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 110;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 0.55);
    rim.position.set(-12, 8, -10); this.scene.add(rim);

    this.buildEnvMap();
    this.buildGround();
    this.buildBuildings();
    this.buildRoads();
    this.buildVehicles();
    this.buildProps();
    this.buildCenterpiece();
    this.buildStars();
    this.spawnRoamers(14);
    this.resize();
    this.initQuality();
    this.setupPost();

    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  // --- Post-processing pipeline ----------------------------------------------

  private initQuality(): void {
    try {
      const forced = (window as unknown as { LCT_GFX?: string }).LCT_GFX;
      const saved = localStorage.getItem('chef_gfx');
      const q = forced ?? saved;
      if (q === 'basic' || q === 'ultra') this.quality = q;
    } catch { /* default ultra */ }
  }

  private setupPost(): void {
    if (this.quality !== 'ultra' || this.composer) return;
    try {
      const size = new THREE.Vector2(); this.renderer.getSize(size);
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      (gtao as unknown as { output: number }).output = 0;
      (gtao as unknown as { blendIntensity: number }).blendIntensity = 0.6;
      (gtao as unknown as { updateGtaoMaterial(p: object): void }).updateGtaoMaterial({
        radius: 0.9, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16, screenSpaceRadius: false,
      });
      composer.addPass(gtao);
      const bloom = new UnrealBloomPass(size, 0.42, 0.4, 0.85);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      composer.addPass(new SMAAPass(size.x, size.y));
      this.composer = composer; this.bloomPass = bloom;
    } catch (err) {
      console.warn('[factory] post-processing unavailable, using direct render', err);
      this.composer = null; this.quality = 'basic';
    }
  }

  public setQuality(q: GfxQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    try { localStorage.setItem('chef_gfx', q); } catch { /* ignore */ }
    if (q === 'ultra') this.setupPost();
  }
  public getQuality(): GfxQuality { return this.quality; }

  // --- Day/night cycle ---------------------------------------------------------

  /** Registers an emissive material to fade between day/night intensities. */
  private nightReactive(mat: THREE.MeshStandardMaterial, day: number, night: number): void {
    this.nightMats.push({ mat, day, night });
  }

  /** A sparse star field, visible only after dark (fog-exempt). */
  private buildStars(): void {
    const N = 260;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = 0.12 + Math.random() * 0.55; // upper sky band
      const r = 95;
      pos[i * 3] = Math.cos(u) * Math.cos(v * Math.PI / 2) * r;
      pos[i * 3 + 1] = Math.sin(v * Math.PI / 2) * r * 0.7;
      pos[i * 3 + 2] = Math.sin(u) * Math.cos(v * Math.PI / 2) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xdfe8ff, size: 0.45, sizeAttenuation: true,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    this.scene.add(this.stars);
  }

  private static readonly DAY_CYCLE = 160;

  /** Jumps the clock: 0.25 = noon, 0.75 = midnight (QA / screenshots). */
  public setTimeOfDay(phase01: number): void {
    this.dayT = phase01 * FactoryScene.DAY_CYCLE;
  }

  /**
   * Advances the sun around the campus on a ~2.5 min cycle. Noon is bright
   * and warm; night drops the key light, darkens sky/fog, reveals stars, and
   * hands the scene to the emissives (lamps, windows, signs) + bloom.
   */
  private updateDayNight(dt: number): void {
    const CYCLE = FactoryScene.DAY_CYCLE;
    this.dayT += dt;
    const ang = ((this.dayT / CYCLE) % 1) * Math.PI * 2;
    const elev = Math.sin(ang);
    const day = Math.max(0, Math.min(1, (elev + 0.3) / 0.7));
    this.night = 1 - day;

    this.sun.position.set(Math.cos(ang) * 26, 8 + Math.max(-4, elev * 30), Math.sin(ang) * 18 + 10);
    this.sun.intensity = 0.22 + day * 1.85;
    // Warmer key light near the horizon (sunrise/sunset).
    const warmth = Math.max(0, 1 - Math.abs(elev) * 2.2);
    this.sun.color.setHSL(0.09 + 0.02 * (1 - warmth), 0.5 * warmth + 0.18, 0.85 - warmth * 0.12);
    this.hemi.intensity = 0.32 + day * 0.55;

    this.skyColor.copy(this.nightSky).lerp(this.daySky, day);
    (this.scene.background as THREE.Color).copy(this.skyColor);
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(this.skyColor);

    if (this.stars) (this.stars.material as THREE.PointsMaterial).opacity = this.night * 0.9;
    for (const e of this.nightMats) {
      e.mat.emissiveIntensity = e.day + (e.night - e.day) * this.night;
    }
  }

  // --- Environment map --------------------------------------------------------

  private buildEnvMap(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#5a7088'); grad.addColorStop(0.5, '#43525f'); grad.addColorStop(1, '#11161d');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#fffdf2';
    for (const x of [70, 190, 310, 430]) g.fillRect(x, 14, 56, 12);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    (tex as unknown as { colorSpace: string }).colorSpace = THREE.SRGBColorSpace;
    const env = pmrem.fromEquirectangular(tex).texture;
    this.scene.environment = env;
    tex.dispose(); pmrem.dispose();
  }

  // --- Ground & roads ---------------------------------------------------------

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(90, 1, 84),
      new THREE.MeshStandardMaterial({ map: this.texGround(), color: 0x6a7a5e, roughness: 0.95, metalness: 0.05 }),
    );
    ground.position.y = -0.5; ground.receiveShadow = true; this.world.add(ground);
    // A subtle plaza pad under the central building cluster.
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(25, 64),
      new THREE.MeshStandardMaterial({ map: this.texConcrete(), color: 0x82868d, roughness: 0.9 }),
    );
    plaza.rotation.x = -Math.PI / 2; plaza.position.set(0, 0.012, 2); plaza.receiveShadow = true; this.world.add(plaza);
  }

  private buildRoads(): void {
    const ids = STATION_IDS;
    // Roads connect the building DOCKS (where vehicles actually drive), so the
    // traffic always rides on the tarmac and never tucks under a building.
    for (let i = 0; i < ids.length - 1; i++) {
      this.addRoad(this.dockOf(ids[i]), this.dockOf(ids[i + 1]));
    }
    // Exit road (scooters leave) + customer arrival road from the delivery dock.
    const d = this.dockOf('delivery');
    this.addRoad(d, new THREE.Vector2(d.x - 5, 18));
    this.addRoad(d, new THREE.Vector2(d.x + 6, 19));
  }

  private dockOf(id: StationId): THREE.Vector2 {
    const v = this.buildings.get(id)!.door;
    return new THREE.Vector2(v.x, v.z);
  }

  private addRoad(a: THREE.Vector2, b: THREE.Vector2): void {
    const dx = b.x - a.x, dz = b.y - a.y;
    const len = Math.hypot(dx, dz);
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.05, len + 1.2),
      new THREE.MeshStandardMaterial({ map: this.texRoad(len), color: 0x3a3e44, roughness: 0.95 }),
    );
    road.position.set((a.x + b.x) / 2, 0.05, (a.y + b.y) / 2);
    road.rotation.y = Math.atan2(dx, dz);
    road.receiveShadow = true; this.world.add(road);
    // A junction pad at each end so corners read cleanly.
    for (const p of [a, b]) {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.05, 2.4),
        new THREE.MeshStandardMaterial({ color: 0x34383e, roughness: 0.95 }),
      );
      pad.position.set(p.x, 0.048, p.y); pad.receiveShadow = true; this.world.add(pad);
    }
    // A few kerb lamps along the road (one side, sparse).
    const n = Math.max(1, Math.floor(len / 6));
    for (let i = 1; i <= n; i++) {
      const f = i / (n + 1);
      const px = a.x + dx * f, pz = a.y + dz * f;
      const off = 1.5;
      const nx = -dz / len, nz = dx / len;
      this.addLamp(px + nx * off, pz + nz * off);
    }
  }

  private addLamp(x: number, z: number): void {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6, metalness: 0.5 }),
    );
    pole.position.set(x, 0.85, z); pole.castShadow = true; this.world.add(pole);
    // A small shaded head: a dim emissive bulb under a hood. The bloom pass
    // gives it a *subtle* halo — no additive sprite, which was blowing out.
    const hood = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.05, 0.18, 10),
      new THREE.MeshStandardMaterial({ color: 0x33373e, roughness: 0.6, metalness: 0.5 }),
    );
    hood.position.set(x, 1.78, z); this.world.add(hood);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2d2, emissive: 0xffdf9a, emissiveIntensity: 0.9 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), bulbMat);
    bulb.position.set(x, 1.66, z); this.world.add(bulb);
    this.nightReactive(bulbMat, 0.2, 1.7); // street lights come on at dusk
  }

  // --- Buildings --------------------------------------------------------------

  private buildBuildings(): void {
    for (const id of STATION_IDS) {
      const def = STATION_DEF_BY_ID[id];
      const [x, z] = BUILDING_POS[id];
      const color = STATION_COLOR[id];
      const accent = STATION_ACCENT[id];
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.scale.setScalar(1.55); // bigger, more substantial buildings
      // Face the plaza centre so the facade (door/sign/windows on +z) and the
      // dock in front of it point at the road network.
      const dirX = PLAZA_C[0] - x, dirZ = PLAZA_C[1] - z;
      const dl = Math.hypot(dirX, dirZ) || 1;
      group.rotation.y = Math.atan2(dirX, dirZ);

      const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.45 });
      const concrete = new THREE.MeshStandardMaterial({ color: 0x5e646c, roughness: 0.92 });

      // Plot pad — dark concrete so the building sits on it, not on a white slab.
      const pad = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 2.7), concrete);
      pad.position.y = 0.06; pad.receiveShadow = true; group.add(pad);

      // Main body (scaled by level).
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.7, 2.0),
        new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }),
      );
      body.position.set(0, 1.0, -0.1); body.castShadow = true; body.receiveShadow = true; group.add(body);
      // Trim band.
      const trim = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.18, 2.1), dark);
      trim.position.set(0, 1.78, -0.1); group.add(trim);

      this.addRoof(group, id, dark);

      // Facade: a service door and two warm-lit windows.
      const doorMat = new THREE.MeshStandardMaterial({ color: 0x565d67, roughness: 0.5, metalness: 0.5 });
      const fdoor = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.08), doorMat);
      fdoor.position.set(0, 0.55, 1.01); group.add(fdoor);
      const winMat = new THREE.MeshStandardMaterial({ color: 0x14181f, emissive: 0xffce7a, emissiveIntensity: 0.45, roughness: 0.3 });
      this.nightReactive(winMat, 0.12, 1.35); // warm windows glow after dark
      for (const wx of [-0.78, 0.78]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.06), winMat);
        win.position.set(wx, 1.05, 1.01); group.add(win);
      }

      // Illuminated facade sign board with the station pictogram (no floating frame).
      const screenMat = new THREE.MeshStandardMaterial({ color: 0x0e1117, emissive: accent, emissiveIntensity: 0.6, roughness: 0.4 });
      const signBoard = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.46, 0.09), screenMat);
      signBoard.position.set(0, 1.5, 1.0); group.add(signBoard);
      const icon = this.makeIconSprite(def.icon);
      icon.scale.set(0.6, 0.6, 1); icon.position.set(0, 1.5, 1.08); group.add(icon);

      // Buffer gauge on the front trim.
      const gaugeBg = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.05), new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 1 }));
      gaugeBg.position.set(0, 1.78, 0.96); group.add(gaugeBg);
      const gaugeFill = new THREE.Mesh(
        new THREE.BoxGeometry(1.64, 0.13, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x57e08a, emissive: 0x1a5a30, emissiveIntensity: 0.6, roughness: 0.5 }),
      );
      gaugeFill.position.set(0, 1.78, 0.98); group.add(gaugeFill);

      // Status light.
      const statusMat = new THREE.MeshStandardMaterial({ color: 0x223018, emissive: 0x55e070, emissiveIntensity: 1.2, roughness: 0.4 });
      const status = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), statusMat);
      status.position.set(1.05, 2.0, 0.6); group.add(status);
      const statusGlow = makeGlow(0x66ff88, 0.5); statusGlow.position.copy(status.position); statusGlow.material.opacity = 0.5; group.add(statusGlow);

      // Bottleneck halo on the pad.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.9, 0.09, 10, 32),
        new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff3a2a, emissiveIntensity: 1.0, roughness: 0.5 }),
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.visible = false; group.add(ring);

      // Pick target.
      const pick = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.4, 3.0), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.y = 1.5; pick.userData.id = id; group.add(pick);

      this.world.add(group);
      // Dock: a point on the plaza-facing side of the building, where roads
      // meet and vehicles arrive/depart.
      const door = new THREE.Vector3(x + (dirX / dl) * DOCK_OFFSET, 0, z + (dirZ / dl) * DOCK_OFFSET);
      const vis: BuildingVis = {
        id, group, body, gaugeFill, ring, pick, screenMat, statusMat, statusGlow,
        fx: STATION_FX[id], fxAnchor: new THREE.Vector3(x, 2.4, z - 0.2),
        npcs: [], managerFigure: null, managerId: null, door, rate: 1,
      };
      this.buildings.set(id, vis);
    }
  }

  /** Per-type roof / extras so each building reads as a distinct place. */
  private addRoof(group: THREE.Group, id: StationId, dark: THREE.MeshStandardMaterial): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.35, metalness: 0.7 });
    switch (id) {
      case 'receiving': {
        // Loading dock: a roller door + a parked delivery truck.
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.5, metalness: 0.5 }));
        door.position.set(0, 0.7, 0.96); group.add(door);
        const truck = new THREE.Group();
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0x3f73b4, roughness: 0.4, metalness: 0.4 }));
        cab.position.set(0, 0.6, 0); cab.castShadow = true; truck.add(cab);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.0, 1.4), new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5 }));
        box.position.set(0, 0.7, 1.2); box.castShadow = true; truck.add(box);
        for (const [wx, wz] of [[0.42, 0.1], [-0.42, 0.1], [0.45, 1.4], [-0.45, 1.4]] as Array<[number, number]>) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0x14141a })); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.18, wz); truck.add(w);
        }
        truck.position.set(0, 0, 2.6); group.add(truck);
        break;
      }
      case 'cooking': {
        // Pitched roof with two steaming chimneys.
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.6, 0.9, 4), dark);
        roof.rotation.y = Math.PI / 4; roof.position.set(0, 2.3, -0.1); roof.scale.z = 1.3; group.add(roof);
        for (const cx of [-0.7, 0.7]) {
          const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.7, 12), metal);
          ch.position.set(cx, 2.7, -0.5); ch.castShadow = true; group.add(ch);
        }
        break;
      }
      case 'plating': {
        // Clean flat roof + a glass canopy.
        const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 2.2), metal);
        roof.position.set(0, 2.0, -0.1); group.add(roof);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.1), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.5 }));
        glass.position.set(0, 0.7, 1.0); group.add(glass);
        break;
      }
      case 'delivery': {
        // Dispatch depot: flat roof + two van bays with a parked van.
        const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 2.2), dark);
        roof.position.set(0, 1.95, -0.1); group.add(roof);
        const van = this.makeVan(); van.scale.setScalar(0.9); van.position.set(0.4, 0, 2.4); van.rotation.y = Math.PI; group.add(van);
        break;
      }
      default: {
        // prep: sawtooth factory roof.
        for (const rx of [-0.6, 0.6]) {
          const tooth = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.7, 0.7, 3), dark);
          tooth.rotation.y = Math.PI / 2; tooth.position.set(rx, 2.1, -0.1); tooth.scale.z = 1.4; group.add(tooth);
        }
      }
    }
  }

  // --- Vehicles (different per leg) -------------------------------------------

  private buildVehicles(): void {
    const ids = STATION_IDS;
    const makers = [
      () => this.makeForklift(),  // receiving → prep
      () => this.makeTrike(),     // prep → cooking
      () => this.makeTug(),       // cooking → plating
      () => this.makeVanCargo(),  // plating → delivery
    ];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = this.buildings.get(ids[i])!.door.clone();
      const b = this.buildings.get(ids[i + 1])!.door.clone();
      this.legs.push({ from: a, to: b, make: makers[i], pool: [], accum: 0, turn: Math.atan2(b.x - a.x, b.z - a.z) });
    }
    // Exit leg: scooters leave delivery toward the front of the map.
    const d = this.buildings.get('delivery')!.door.clone();
    const exit = new THREE.Vector3(d.x - 5, 0, 18);
    this.legs.push({ from: d, to: exit, make: () => this.makeScooter(), pool: [], accum: 0, turn: Math.atan2(exit.x - d.x, exit.z - d.z) });
    // Customer cars arrive at the delivery point to pick up orders.
    const arrival = new THREE.Vector3(d.x + 6, 0, 19);
    this.legs.push({ from: arrival, to: d, make: () => this.makeCar(), pool: [], accum: 0, turn: Math.atan2(d.x - arrival.x, d.z - arrival.z) });
  }

  private makeCar(): THREE.Group {
    const g = new THREE.Group();
    const cols = [0xd84a4a, 0x4a8fd8, 0x4ad88f, 0xd8c44a, 0xb46ad8, 0xe0863a];
    const col = cols[(Math.random() * cols.length) | 0];
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.34, 1.35), new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.5 }));
    body.position.y = 0.36; body.castShadow = true; g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.32, 0.72), new THREE.MeshStandardMaterial({ color: 0x223044, roughness: 0.15, metalness: 0.3 }));
    cabin.position.set(0, 0.66, -0.05); g.add(cabin);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
    head.position.set(0, 0.68, 0.08); g.add(head);
    // Dim headlights (kept below the bloom threshold).
    for (const hx of [0.24, -0.24]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b0, emissiveIntensity: 0.6 }));
      lamp.position.set(hx, 0.34, 0.66); g.add(lamp);
    }
    this.wheels(g, [[0.38, 0.46], [-0.38, 0.46], [0.38, -0.46], [-0.38, -0.46]], 0.15);
    g.visible = false;
    return g;
  }

  private spawnVehicle(leg: Leg): void {
    let v = leg.pool.find((x) => !x.active);
    if (!v) {
      if (leg.pool.length >= 5) return;
      // Speed is per-road so world-speed stays constant on the bigger map.
      const len = Math.max(4, leg.from.distanceTo(leg.to));
      v = { group: leg.make(), t: 0, speed: (2.8 + Math.random() * 0.8) / len, active: false };
      this.world.add(v.group);
      leg.pool.push(v);
    }
    v.active = true; v.t = 0; v.group.visible = true;
    v.group.rotation.y = leg.turn;
  }

  // --- Vehicle meshes ---------------------------------------------------------

  private wheels(g: THREE.Group, spots: Array<[number, number]>, r = 0.13): void {
    const m = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.6 });
    for (const [x, z] of spots) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08, 12), m);
      w.rotation.z = Math.PI / 2; w.position.set(x, r, z); g.add(w);
    }
  }

  private makeForklift(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.8), new THREE.MeshStandardMaterial({ color: 0xf0a826, roughness: 0.5, metalness: 0.3 }));
    body.position.y = 0.45; body.castShadow = true; g.add(body);
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6 }));
    cage.position.set(0, 0.85, -0.1); g.add(cage);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.6 }));
    mast.position.set(0, 0.7, 0.42); g.add(mast);
    // Pallet + crate cargo on the forks.
    const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a6a3e, roughness: 0.9 }));
    pallet.position.set(0, 0.2, 0.55); g.add(pallet);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), new THREE.MeshStandardMaterial({ map: this.texCrate(), color: 0xb0813f, roughness: 0.85 }));
    crate.position.set(0, 0.45, 0.55); crate.castShadow = true; g.add(crate);
    this.addDriver(g, 0, 0.7, -0.1);
    this.wheels(g, [[0.28, 0.25], [-0.28, 0.25], [0.26, -0.25], [-0.26, -0.25]]);
    g.visible = false;
    return g;
  }

  private makeTrike(): THREE.Group {
    const g = new THREE.Group();
    const cart = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x3aa06e, roughness: 0.5 }));
    cart.position.set(0, 0.4, -0.3); cart.castShadow = true; g.add(cart);
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0xcaa24a, roughness: 0.7 }));
    bin.position.set(0, 0.7, -0.3); g.add(bin);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.3), new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6 }));
    head.position.set(0, 0.45, 0.4); g.add(head);
    this.addDriver(g, 0, 0.55, 0.18);
    this.wheels(g, [[0, 0.5], [0.3, -0.45], [-0.3, -0.45]], 0.14);
    g.visible = false;
    return g;
  }

  private makeTug(): THREE.Group {
    const g = new THREE.Group();
    const tug = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x586070, roughness: 0.4, metalness: 0.5 }));
    tug.position.set(0, 0.4, 0.35); tug.castShadow = true; g.add(tug);
    this.addDriver(g, 0, 0.6, 0.4);
    // Towed covered trolley with trays (steams a little).
    const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.5 }));
    trolley.position.set(0, 0.5, -0.45); trolley.castShadow = true; g.add(trolley);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 0.74), new THREE.MeshStandardMaterial({ color: 0xc09a36, roughness: 0.5 }));
    lid.position.set(0, 0.82, -0.45); g.add(lid);
    this.wheels(g, [[0.22, 0.5], [-0.22, 0.5], [0.26, -0.5], [-0.26, -0.5]], 0.12);
    g.visible = false;
    return g;
  }

  private makeVan(): THREE.Group {
    const g = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xb04246, roughness: 0.4, metalness: 0.35 }));
    cab.position.set(0, 0.5, 0.5); cab.castShadow = true; g.add(cab);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.85, 1.0), new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.5 }));
    box.position.set(0, 0.62, -0.35); box.castShadow = true; g.add(box);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 1.02), new THREE.MeshStandardMaterial({ color: 0xb04246, emissive: 0x401015, emissiveIntensity: 0.3, roughness: 0.5 }));
    stripe.position.set(0, 0.62, -0.35); g.add(stripe);
    this.wheels(g, [[0.4, 0.45], [-0.4, 0.45], [0.42, -0.5], [-0.42, -0.5]], 0.15);
    return g;
  }
  private makeVanCargo(): THREE.Group {
    const g = this.makeVan(); this.addDriver(g, 0, 0.72, 0.5); g.visible = false; return g;
  }

  private makeScooter(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.62), new THREE.MeshStandardMaterial({ color: 0xb2484a, roughness: 0.4, metalness: 0.3 }));
    body.position.y = 0.24; body.castShadow = true; g.add(body);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xf4b942, emissive: 0xff8c1a, emissiveIntensity: 0.4, roughness: 0.5 }));
    box.position.set(0, 0.46, -0.28); g.add(box);
    this.addDriver(g, 0, 0.5, 0.04);
    this.wheels(g, [[0, 0.28], [0, -0.28]], 0.12);
    g.visible = false;
    return g;
  }

  private addDriver(g: THREE.Group, x: number, y: number, z: number): void {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2f55c8, roughness: 0.7 }));
    body.position.set(x, y, z); g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
    head.position.set(x, y + 0.22, z); g.add(head);
  }

  // --- Props (campus dressing) -----------------------------------------------

  private buildProps(): void {
    // Perimeter fence ringing the larger lot.
    const postMat = new THREE.MeshStandardMaterial({ color: 0x40454e, roughness: 0.7, metalness: 0.4 });
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 22) {
      const rx = 30, rz = 26;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), postMat);
      post.position.set(Math.cos(a) * rx, 0.4, 2 + Math.sin(a) * rz); this.world.add(post);
    }
    // Crate stacks scattered around the bigger plaza.
    const spots: Array<[number, number]> = [
      [-5, 1], [5, 0.5], [-7, -2], [7, -2.5], [0.5, 3.5], [-10, 3], [10, 3],
      [-3, 9], [3, 9], [-9, -4], [9, -4], [0, -3],
    ];
    for (const [x, z] of spots) {
      const g = new THREE.Group();
      const k = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < k; i++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), new THREE.MeshStandardMaterial({ map: this.texCrate(), color: i % 2 ? 0xb0813f : 0x9a6f3f, roughness: 0.85 }));
        c.position.set((i % 2) * 0.57, 0.28 + Math.floor(i / 2) * 0.57, 0); c.castShadow = true; g.add(c);
      }
      g.position.set(x, 0, z); g.rotation.y = Math.random() * Math.PI; this.world.add(g);
    }
    // Trees and planters lining the wider campus.
    for (const [x, z] of [[-20, 13], [20, 13], [-21, -10], [21, -10], [-13, 16], [13, 16], [0, 19], [-22, 3], [22, 3]] as Array<[number, number]>) {
      this.makeTree(x, z);
    }
    // Two parked box trucks in a yard at the back.
    for (const [x, z, rot] of [[-9, -11, 0.3], [-6.5, -11.2, 0.3]] as Array<[number, number, number]>) {
      const truck = this.makeVan(); truck.scale.setScalar(1.4); truck.position.set(x, 0, z); truck.rotation.y = rot; this.world.add(truck);
    }
    // A water tower landmark.
    const tower = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.4, metalness: 0.6 }));
    tank.position.y = 5.5; tank.castShadow = true; tower.add(tank);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 16), new THREE.MeshStandardMaterial({ color: 0x586070, roughness: 0.5, metalness: 0.5 }));
    cone.position.y = 6.9; tower.add(cone);
    for (const [lx, lz] of [[1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]] as Array<[number, number]>) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.4, 0.16), new THREE.MeshStandardMaterial({ color: 0x40454e, roughness: 0.6, metalness: 0.5 }));
      leg.position.set(lx, 2.2, lz); leg.castShadow = true; tower.add(leg);
    }
    tower.position.set(20, 0, -12); this.world.add(tower);
  }

  private makeTree(x: number, z: number): void {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 }));
    trunk.position.set(x, 0.5, z); trunk.castShadow = true; this.world.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4e8a3c, roughness: 0.9, flatShading: true });
    const l1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), leafMat);
    l1.position.set(x, 1.5, z); l1.castShadow = true; this.world.add(l1);
    const l2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), leafMat);
    l2.position.set(x + 0.3, 1.9, z - 0.2); l2.castShadow = true; this.world.add(l2);
  }

  private makeBench(x: number, z: number, ry: number): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 0.85 });
    const b = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.34), mat);
    seat.position.y = 0.32; seat.castShadow = true; b.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 0.06), mat);
    back.position.set(0, 0.5, -0.14); b.add(back);
    for (const lx of [-0.42, 0.42]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.3), mat);
      leg.position.set(lx, 0.16, 0); b.add(leg);
    }
    b.position.set(x, 0, z); b.rotation.y = ry; this.world.add(b);
  }

  /**
   * A landscaped roundabout filling the open plaza centre: a kerbed lawn with
   * trees, a fountain, benches, and an illuminated company sign with a waving
   * flag — so the big map doesn't read as a dead expanse of concrete.
   */
  private buildCenterpiece(): void {
    const [cx, cz] = PLAZA_C;
    const g = new THREE.Group(); g.position.set(cx, 0, cz);
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.35, metalness: 0.7 });

    // Kerb ring + lawn.
    const kerb = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.1, 0.34, 40), new THREE.MeshStandardMaterial({ color: 0x7d828b, roughness: 0.9 }));
    kerb.position.y = 0.17; kerb.receiveShadow = true; g.add(kerb);
    const lawn = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 0.36, 40), new THREE.MeshStandardMaterial({ map: this.texGround(), color: 0x5f7048, roughness: 1 }));
    lawn.position.y = 0.19; lawn.receiveShadow = true; g.add(lawn);

    // Central fountain.
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.4, 24), new THREE.MeshStandardMaterial({ color: 0x8a909a, roughness: 0.6, metalness: 0.3 }));
    basin.position.y = 0.4; basin.castShadow = true; g.add(basin);
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x4f9fd0, roughness: 0.1, metalness: 0.4, emissive: 0x1a4a6a, emissiveIntensity: 0.3 });
    this.nightReactive(waterMat, 0.2, 0.8); // underwater lighting at night
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.08, 24), waterMat);
    water.position.y = 0.58; g.add(water);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 12), steel);
    spout.position.y = 0.9; g.add(spout);

    // Company sign pylon with a glowing board + pictogram.
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), new THREE.MeshStandardMaterial({ color: 0x40454e, roughness: 0.6, metalness: 0.5 }));
    post.position.set(-2.5, 1.3, 1.4); post.castShadow = true; g.add(post);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x12161d, emissive: 0xffb24a, emissiveIntensity: 0.55, roughness: 0.4 });
    this.nightReactive(boardMat, 0.4, 1.4); // the campus sign blazes at night
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.95, 0.14), boardMat);
    board.position.set(-2.5, 2.9, 1.4); g.add(board);
    const logo = this.makeIconSprite('🍔'); logo.scale.set(0.8, 0.8, 1); logo.position.set(-2.5, 2.9, 1.5); g.add(logo);

    // Flagpole with a waving flag (animated).
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.6, 8), steel);
    pole.position.set(2.6, 1.8, -1.6); pole.castShadow = true; g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6, 6, 1), new THREE.MeshStandardMaterial({ color: 0xe0843a, roughness: 0.6, side: THREE.DoubleSide }));
    flag.position.set(3.1, 3.2, -1.6); g.add(flag);
    this.centerFlag = flag;

    // Trees + benches around the lawn.
    for (const a of [0.6, 2.4, 4.1]) {
      const tx = cx + Math.cos(a) * 2.6, tz = cz + Math.sin(a) * 2.6;
      this.makeTree(tx, tz);
    }
    this.makeBench(cx - 1.6, cz + 2.6, 0.2);
    this.makeBench(cx + 1.6, cz + 2.6, -0.2);

    this.world.add(g);
  }

  // --- NPCs -------------------------------------------------------------------

  private spawnRoamers(n: number): void {
    for (let i = 0; i < n; i++) {
      const mesh = this.makeChef();
      const x = (Math.random() - 0.5) * 24, z = 2 + (Math.random() - 0.5) * 22;
      mesh.position.set(x, 0, z); this.world.add(mesh);
      this.roamers.push({ mesh, x, z, tx: x, tz: z, speed: 0.7 + Math.random() * 0.7, pause: Math.random() * 2, phase: Math.random() * 6 });
    }
  }

  private makeChef(): THREE.Group {
    const w = new THREE.Group();
    const coat = new THREE.Color().setHSL(0.08 + Math.random() * 0.5, 0.15, 0.85);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.26, 4, 8), new THREE.MeshStandardMaterial({ color: coat, roughness: 0.6 }));
    body.position.y = 0.44; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
    head.position.y = 0.74;
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    hat.position.y = 0.9;
    w.add(body, head, hat);
    return w;
  }

  /** A head-chef figure: bigger, with a rarity-coloured toque and a glow. */
  private makeManagerChef(rarity: string): THREE.Group {
    const w = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.34, 4, 8), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.55 }));
    body.position.y = 0.55; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
    head.position.y = 0.95;
    const col = RARITY_COLOR[rarity] ?? 0xffffff;
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.26, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: col, emissiveIntensity: 0.35, roughness: 0.5 }));
    hat.position.y = 1.2;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.03, 8, 16), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.4 }));
    band.rotation.x = Math.PI / 2; band.position.y = 1.08; hat.add(band);
    w.add(body, head, hat);
    const glow = makeGlow(col, 0.9); glow.position.set(0, 1.3, 0); glow.material.opacity = 0.5; w.add(glow);
    return w;
  }

  private syncManagerFigure(vis: BuildingVis, managerId: string | null): void {
    if (managerId === vis.managerId) return;
    vis.managerId = managerId;
    if (vis.managerFigure) { vis.group.remove(vis.managerFigure); vis.managerFigure = null; }
    if (managerId) {
      const def = MANAGER_BY_ID[managerId];
      const fig = this.makeManagerChef(def?.rarity ?? 'COMMON');
      fig.position.set(-1.1, 0, 1.5); // by the door, beside the line workers
      vis.group.add(fig); vis.managerFigure = fig;
    }
  }

  private syncNpcs(vis: BuildingVis, count: number): void {
    while (vis.npcs.length < count) {
      const chef = this.makeChef();
      const i = vis.npcs.length;
      const a = (i / 5) * Math.PI * 2;
      chef.position.set(Math.cos(a) * 1.4, 0, 1.0 + Math.sin(a) * 0.6);
      (chef as unknown as { userData: { phase: number } }).userData = { phase: Math.random() * 6 };
      vis.group.add(chef); vis.npcs.push(chef);
    }
    while (vis.npcs.length > count) { const c = vis.npcs.pop(); if (c) vis.group.remove(c); }
  }

  // --- Procedural textures ----------------------------------------------------

  private paintCanvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    return { c, g: c.getContext('2d')! };
  }
  private finish(c: HTMLCanvasElement, rx = 1, ry = 1): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4;
    (t as unknown as { colorSpace: string }).colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  private texGround(): THREE.Texture {
    const { c, g } = this.paintCanvas(256);
    g.fillStyle = '#5f6e52'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { g.fillStyle = ['#677a56', '#566348', '#6f8060'][(Math.random() * 3) | 0]; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    return this.finish(c, 10, 9);
  }
  private texConcrete(): THREE.Texture {
    const { c, g } = this.paintCanvas(256);
    g.fillStyle = '#82868d'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 3;
    for (let p = 0; p <= 256; p += 64) { g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke(); }
    for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    return this.finish(c, 4, 4);
  }
  private texRoad(len: number): THREE.Texture {
    const { c, g } = this.paintCanvas(64);
    g.fillStyle = '#34383e'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#e8c84a';
    for (let y = 6; y < 64; y += 22) g.fillRect(29, y, 6, 12); // dashed centre line
    g.fillStyle = '#5a5f66'; g.fillRect(2, 0, 3, 64); g.fillRect(59, 0, 3, 64); // kerbs
    return this.finish(c, 1, Math.max(1, Math.round(len / 1.7)));
  }
  private texCrate(): THREE.Texture {
    const { c, g } = this.paintCanvas(64);
    g.fillStyle = '#9a6f3f'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 4; g.strokeRect(3, 3, 58, 58);
    g.beginPath(); g.moveTo(3, 3); g.lineTo(61, 61); g.moveTo(61, 3); g.lineTo(3, 61); g.stroke();
    return this.finish(c, 1, 1);
  }

  /** Crisp gold "+X €" billboard for the income floaters. */
  private makeTextSprite(text: string): THREE.Sprite {
    const { c, g } = this.paintCanvas(256);
    c.height = 96;
    g.font = '700 52px system-ui, "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(text, 128, 48);
    g.fillStyle = '#7be0a0'; g.fillText(text, 128, 48);
    const tex = new THREE.CanvasTexture(c);
    (tex as unknown as { colorSpace: string }).colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(3.4, 1.3, 1);
    return spr;
  }

  /** Compact € formatter for the floaters (12, 1.4K, 2.1M…). */
  private fmtShort(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(Math.max(1, Math.round(n)));
  }

  private makeIconSprite(emoji: string): THREE.Sprite {
    const { c, g } = this.paintCanvas(128);
    g.font = '92px system-ui, "Segoe UI Emoji", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    (tex as unknown as { colorSpace: string }).colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(1.1, 1.1, 1);
    return spr;
  }

  // --- Particles --------------------------------------------------------------

  private spawnParticle(anchor: THREE.Vector3, kind: 'steam' | 'spark'): void {
    if (this.particles.length > 90) return;
    const mat = kind === 'steam'
      ? new THREE.MeshStandardMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.5, roughness: 1 })
      : new THREE.MeshStandardMaterial({ color: 0xffb24a, emissive: 0xff7a1a, emissiveIntensity: 1.5, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(kind === 'steam' ? new THREE.SphereGeometry(0.14, 8, 6) : new THREE.SphereGeometry(0.05, 6, 5), mat);
    mesh.position.copy(anchor); mesh.position.x += (Math.random() - 0.5) * 0.5; mesh.position.z += (Math.random() - 0.5) * 0.4;
    this.world.add(mesh);
    this.particles.push({
      mesh,
      vx: kind === 'spark' ? (Math.random() - 0.5) * 1.6 : (Math.random() - 0.5) * 0.2,
      vy: kind === 'steam' ? 0.6 + Math.random() * 0.4 : 1.2 + Math.random(),
      life: 0, max: kind === 'steam' ? 1.8 : 0.5,
    });
  }

  // --- State sync -------------------------------------------------------------

  public setState(state: FactoryState): void {
    this.state = state;
    const now = Date.now();
    this.throughput = FactoryEngine.lineThroughput(state, now);
    this.bottleneck = FactoryEngine.bottleneck(state, now);
    this.revPerSec = FactoryEngine.revenuePerSecond(state, now);
    for (const id of STATION_IDS) {
      const vis = this.buildings.get(id); if (!vis) continue;
      const st = state.stations[id];
      vis.rate = FactoryEngine.stationRate(state, id, now);
      const grow = 1 + Math.min(st.level, 40) * 0.01;
      vis.body.scale.set(1, grow, 1); vis.body.position.y = 1.0 * grow;
      const cap = FactoryEngine.stationCapacity(state, id);
      const fill = id === 'delivery' ? Math.min(1, this.throughput / Math.max(0.001, vis.rate)) : Math.min(1, st.output / Math.max(1, cap));
      vis.gaugeFill.scale.x = Math.max(0.02, fill);
      vis.gaugeFill.position.x = -0.82 * (1 - fill);
      (vis.gaugeFill.material as THREE.MeshStandardMaterial).color.setHex(fill > 0.92 ? 0xff7a3a : 0x57e08a);
      vis.ring.visible = id === this.bottleneck;
      this.syncNpcs(vis, Math.min(5, 1 + st.workers));
      this.syncManagerFigure(vis, st.managerId);
    }
  }

  // --- Loop -------------------------------------------------------------------

  public start(): void { if (this.raf === 0) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.loop(t)); } }
  public stop(): void { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

  private loop(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now; this.t += dt;
    try {
      this.update(dt);
      if (this.quality === 'ultra' && this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    } catch (err) { console.warn('[factory] render halted', err); this.stop(); return; }
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number): void {
    if (!this.dragging && !this.pinching) this.targetYaw += dt * 0.025;
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
    this.world.rotation.y = this.yaw;
    if (Math.abs(this.viewSize - this.targetViewSize) > 0.001) {
      this.viewSize += (this.targetViewSize - this.viewSize) * Math.min(1, dt * 8);
      this.updateCameraFrustum();
    }

    this.updateDayNight(dt);
    if (this.centerFlag) this.centerFlag.rotation.y = Math.sin(this.t * 4) * 0.25;

    // Building life: pulsing screens, blinking status (red on bottleneck), halo.
    for (const vis of this.buildings.values()) {
      const isNeck = vis.id === this.bottleneck;
      // Facade signs pulse, and burn brighter after dark.
      vis.screenMat.emissiveIntensity = (0.7 + Math.sin(this.t * 3 + vis.rate) * 0.25) * (0.75 + this.night * 0.9);
      const blink = 0.6 + 0.4 * Math.sin(this.t * (isNeck ? 9 : 3));
      vis.statusMat.emissive.setHex(isNeck ? 0xff4a3a : 0x55e070);
      vis.statusMat.emissiveIntensity = 0.6 + blink;
      (vis.statusGlow.material as THREE.SpriteMaterial).color.setHex(isNeck ? 0xff6a4a : 0x66ff88);
      vis.statusGlow.material.opacity = 0.4 + blink * 0.4;
      if (vis.ring.visible) (vis.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.sin(this.t * 4) * 0.4;
      // NPC idle bob.
      for (const npc of vis.npcs) {
        const ph = (npc as unknown as { userData: { phase: number } }).userData.phase;
        npc.position.y = Math.abs(Math.sin((this.t + ph) * 4)) * 0.05;
      }
      // Head chef gently bobs and turns to oversee the station.
      if (vis.managerFigure) {
        vis.managerFigure.position.y = Math.abs(Math.sin(this.t * 3)) * 0.06;
        vis.managerFigure.rotation.y = Math.sin(this.t * 0.7) * 0.5;
      }
    }

    // Traffic: spawn vehicles per leg proportional to throughput.
    const flow = this.throughput;
    for (const leg of this.legs) {
      if (flow > 0.0001) {
        leg.accum += dt * (0.35 + flow * 0.45);
        if (leg.accum >= 1) { leg.accum -= 1; this.spawnVehicle(leg); }
      }
      for (const v of leg.pool) {
        if (!v.active) continue;
        v.t += v.speed * dt;
        const x = leg.from.x + (leg.to.x - leg.from.x) * v.t;
        const z = leg.from.z + (leg.to.z - leg.from.z) * v.t;
        v.group.position.set(x, 0, z);
        v.group.rotation.y = leg.turn;
        v.group.position.y = Math.abs(Math.sin((this.t + v.t) * 12)) * 0.02;
        if (v.t >= 1) { v.active = false; v.group.visible = false; }
      }
    }

    // Wandering chefs.
    for (const r of this.roamers) {
      if (r.pause > 0) { r.pause -= dt; continue; }
      const dx = r.tx - r.x, dz = r.tz - r.z; const d = Math.hypot(dx, dz);
      if (d < 0.12) { r.tx = (Math.random() - 0.5) * 24; r.tz = 2 + (Math.random() - 0.5) * 22; r.pause = Math.random() * 1.8; }
      else {
        r.x += (dx / d) * r.speed * dt; r.z += (dz / d) * r.speed * dt;
        r.mesh.position.x = r.x; r.mesh.position.z = r.z;
        r.mesh.rotation.y = Math.atan2(dx, dz);
        r.mesh.position.y = Math.abs(Math.sin((this.t + r.phase) * 9)) * 0.06;
      }
    }

    // Steam / sparks at the relevant buildings.
    const cook = this.buildings.get('cooking');
    if (cook && flow > 0.001) {
      this.steamAccum += dt * (2 + cook.rate * 0.4);
      while (this.steamAccum >= 1) { this.steamAccum -= 1; this.spawnParticle(cook.fxAnchor, 'steam'); }
    }
    const prep = this.buildings.get('prep');
    if (prep && flow > 0.001) {
      this.sparkAccum += dt * (3 + prep.rate * 0.5);
      while (this.sparkAccum >= 1) { this.sparkAccum -= 1; this.spawnParticle(prep.fxAnchor, 'spark'); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt; p.vy -= dt * (p.max < 1 ? 4 : 0.2);
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt;
      const k = 1 - p.life / p.max;
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, (p.max < 1 ? 0.9 : 0.5) * k);
      if (p.max >= 1) p.mesh.scale.setScalar(1 + p.life * 1.5);
      if (p.life >= p.max) { this.world.remove(p.mesh); this.particles.splice(i, 1); }
    }

    // Floating "+€" over the dispatch depot as revenue lands (idle juice).
    if (this.revPerSec > 0.01) {
      this.incomeAccum += dt;
      if (this.incomeAccum >= 1.6 && this.floaters.length < 6) {
        const gained = this.revPerSec * this.incomeAccum;
        this.incomeAccum = 0;
        const spr = this.makeTextSprite(`+${this.fmtShort(gained)} €`);
        const [dx, dz] = BUILDING_POS.delivery;
        spr.position.set(dx + (Math.random() - 0.5) * 1.4, 4.4, dz + (Math.random() - 0.5) * 1.2);
        this.world.add(spr);
        this.floaters.push({ sprite: spr, life: 0 });
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life += dt;
      f.sprite.position.y += dt * 1.3;
      const a = f.life < 0.2 ? f.life / 0.2 : Math.max(0, 1 - (f.life - 0.2) / 1.3);
      (f.sprite.material as THREE.SpriteMaterial).opacity = a;
      if (f.life >= 1.5) {
        this.world.remove(f.sprite);
        const m = f.sprite.material as THREE.SpriteMaterial;
        m.map?.dispose(); m.dispose();
        this.floaters.splice(i, 1);
      }
    }
  }

  // --- Camera / input ---------------------------------------------------------

  private updateCameraFrustum(): void {
    const vs = this.viewSize;
    this.camera.left = (-vs * this.aspect) / 2; this.camera.right = (vs * this.aspect) / 2;
    this.camera.top = vs / 2; this.camera.bottom = -vs / 2;
    this.camera.updateProjectionMatrix();
  }
  public resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    this.renderer.setSize(w, h, false); this.aspect = w / h; this.updateCameraFrustum();
    this.composer?.setSize(w, h);
  }
  private onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) { this.dragging = true; this.dragMoved = 0; this.lastPX = e.clientX; }
    if (this.pointers.size === 2) { this.pinching = true; this.lastPinch = this.pinchDistance(); }
  }
  private onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinching && this.pointers.size >= 2) {
      const d = this.pinchDistance();
      if (this.lastPinch > 0 && d > 0) this.targetViewSize = Math.max(13, Math.min(48, this.targetViewSize * (this.lastPinch / d)));
      this.lastPinch = d;
    } else if (this.dragging) {
      const dx = e.clientX - this.lastPX; this.lastPX = e.clientX;
      this.dragMoved += Math.abs(dx); this.targetYaw -= dx * 0.008;
    }
  }
  private onPointerUp(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size < 2) { this.pinching = false; this.lastPinch = 0; }
    if (this.pointers.size === 0) { if (this.dragging && this.dragMoved < 6) this.tap(e); this.dragging = false; }
  }
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.targetViewSize = Math.max(13, Math.min(48, this.targetViewSize + e.deltaY * 0.01));
  }
  private pinchDistance(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
  private tap(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const picks = [...this.buildings.values()].map((v) => v.pick);
    const hits = this.raycaster.intersectObjects(picks, false);
    if (hits.length > 0) {
      const id = hits[0].object.userData.id as StationId | undefined;
      if (id) this.onTapStation(id);
    }
  }
}
