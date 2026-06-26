/**
 * scene.ts — Real-3D factory floor for the production-line game (high detail).
 *
 * Renders the simulation as a literal conveyor line: five detailed machine
 * stations joined by a moving belt, with food items riding it and physically
 * transforming stage by stage (crate → chopped → cooked → plated) before a
 * delivery scooter carries them off. Item spawn density tracks the line's real
 * throughput, the bottleneck station glows red, each station shows a live
 * buffer gauge, blinking status lights, pulsing emissive panels, and its
 * assigned workers; cooking vents steam and prep throws sparks.
 *
 * Quality: PBR metal/roughness materials lit by a procedural environment map
 * (soft reflections), a textured industrial floor with hazard lanes, walls and
 * ceiling lamps, soft shadows, ACES tone-mapping, and additive glow sprites for
 * a bloom-like feel. Three.js is vendored/bundled; everything else is
 * procedural, so the scene is fully offline. Driven by setState() + a per-frame
 * update loop, preserving the same public API.
 */

import * as THREE from 'three';
import { FactoryEngine } from '../../src/factory/FactoryEngine.js';
import { FactoryState, STATION_IDS, StationId } from '../../src/factory/types.js';
import { STATION_DEF_BY_ID } from '../../src/factory/config.js';
import { makeGlow } from '../iso3dtex.js';

const STATION_X: Record<StationId, number> = {
  receiving: -6, prep: -3, cooking: 0, plating: 3, delivery: 6,
};
const BELT_Z = 0;
const BELT_Y = 0.6;
const SPAN = 7.2; // belt runs from -SPAN..+SPAN on X
const MACHINE_Z = -0.95;

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

interface StationVis {
  id: StationId;
  group: THREE.Group;
  housing: THREE.Mesh;            // scaled by level
  rotor: THREE.Mesh;             // spinning working part (speed ∝ cadence)
  gaugeFill: THREE.Mesh;
  ring: THREE.Mesh;              // bottleneck halo
  pick: THREE.Mesh;
  screenMat: THREE.MeshStandardMaterial;
  statusMat: THREE.MeshStandardMaterial;
  statusGlow: THREE.Sprite;
  fx: FxKind;
  fxAnchor: THREE.Vector3;       // world-ish local pos for particle spawns
  workerDots: THREE.Group[];
  rate: number;
}

interface Item { group: THREE.Group; stages: THREE.Object3D[]; t: number; stage: number; }
interface Scooter { mesh: THREE.Group; t: number; active: boolean; }
interface Particle { mesh: THREE.Mesh; vx: number; vy: number; life: number; max: number; }

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

  private readonly stations = new Map<StationId, StationVis>();
  private readonly items: Item[] = [];
  private readonly scooters: Scooter[] = [];
  private readonly particles: Particle[] = [];
  private beltMat!: THREE.MeshStandardMaterial;

  private state: FactoryState | null = null;
  private throughput = 0;
  private bottleneck: StationId = 'cooking';
  private spawnAccum = 0;
  private scooterAccum = 0;
  private steamAccum = 0;
  private sparkAccum = 0;

  private raf = 0; private last = 0; private t = 0;
  private yaw = 0; private targetYaw = 0;
  private viewSize = 13.5; private targetViewSize = 13.5; private aspect = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragging = false; private dragMoved = 0; private lastPX = 0;
  private lastPinch = 0; private pinching = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onTapStation: (id: StationId) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    (this.renderer as unknown as { outputColorSpace: string }).outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene.background = new THREE.Color(0x10141b);
    this.scene.fog = new THREE.Fog(0x10141b, 30, 60);
    this.camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 200);
    this.camera.position.set(14, 16, 18);
    this.camera.lookAt(0, 1.5, 0);
    this.scene.add(this.world);

    // Lighting: warm key + cool fill + rim, plus soft ambient.
    this.scene.add(new THREE.HemisphereLight(0xdce8ff, 0x2a2f38, 0.8));
    this.sun = new THREE.DirectionalLight(0xfff1da, 2.0);
    this.sun.position.set(9, 19, 11);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -16; sc.right = 16; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 0.6);
    rim.position.set(-12, 8, -10); this.scene.add(rim);

    this.buildEnvMap();
    this.buildEnvironment();
    this.buildBelt();
    this.buildStations();
    this.resize();

    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  // --- Procedural environment map (soft PBR reflections) ----------------------

  private buildEnvMap(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#33414f'); grad.addColorStop(0.5, '#465462'); grad.addColorStop(1, '#0d1117');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#fffdf2';
    for (const x of [70, 190, 310, 430]) g.fillRect(x, 18, 56, 14); // ceiling light strips
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    (tex as unknown as { colorSpace: string }).colorSpace = THREE.SRGBColorSpace;
    const env = pmrem.fromEquirectangular(tex).texture;
    this.scene.environment = env;
    tex.dispose(); pmrem.dispose();
  }

  // --- Environment: floor, walls, ceiling lamps, shelving ---------------------

  private buildEnvironment(): void {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(36, 1, 26),
      new THREE.MeshStandardMaterial({ map: this.texFloor(), color: 0x70767e, roughness: 0.85, metalness: 0.15 }),
    );
    floor.position.y = -0.5; floor.receiveShadow = true;
    this.world.add(floor);

    // Hazard-striped safety lane under the belt.
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(SPAN * 2 + 5, 0.02, 3.4),
      new THREE.MeshStandardMaterial({ map: this.texHazard(), roughness: 0.9 }),
    );
    lane.position.set(0, 0.012, BELT_Z); lane.receiveShadow = true;
    this.world.add(lane);

    // Back + side walls with panel texture.
    const wallMat = new THREE.MeshStandardMaterial({ map: this.texPanel(), color: 0x39404a, roughness: 0.8, metalness: 0.25 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(36, 10, 0.6), wallMat);
    back.position.set(0, 4.5, -7.2); back.receiveShadow = true; this.world.add(back);
    for (const sx of [-18, 18]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, 26), wallMat);
      side.position.set(sx, 4.5, 0); side.receiveShadow = true; this.world.add(side);
    }
    // Floor scuff base under the back wall.
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(36, 0.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xf0a826, roughness: 0.7 }),
    );
    skirt.position.set(0, 0.25, -6.9); this.world.add(skirt);

    // Ceiling lamp fixtures with glow.
    for (const x of [-6, 0, 6]) {
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.2, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.6, metalness: 0.4 }),
      );
      housing.position.set(x, 7.6, BELT_Z - 1); this.world.add(housing);
      const tube = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.1, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 1.4 }),
      );
      tube.position.set(x, 7.5, BELT_Z - 1); this.world.add(tube);
      const glow = makeGlow(0xfff0c8, 6); glow.position.set(x, 7.2, BELT_Z - 1); glow.material.opacity = 0.45;
      this.world.add(glow);
    }

    // Background shelving with crates for depth.
    for (const sx of [-12, 12]) {
      const rack = new THREE.Group();
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 0.8 });
      for (const sy of [0.0, 1.4, 2.8]) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.4), frameMat);
        shelf.position.set(0, sy + 0.5, 0); shelf.castShadow = true; rack.add(shelf);
        for (let i = -1; i <= 1; i++) {
          if (Math.abs(i) + (sy > 0 ? 1 : 0) === 2) continue;
          const crate = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.7, 0.8),
            new THREE.MeshStandardMaterial({ color: i % 2 ? 0x9a6f3f : 0xb0813f, roughness: 0.9 }),
          );
          crate.position.set(i * 1.05, sy + 0.95, 0); crate.castShadow = true; rack.add(crate);
        }
      }
      rack.position.set(sx, 0, -5.6); rack.rotation.y = sx < 0 ? 0.2 : -0.2; this.world.add(rack);
    }
  }

  private buildBelt(): void {
    this.beltMat = new THREE.MeshStandardMaterial({ map: this.texBelt(), color: 0x2a2e35, roughness: 0.55, metalness: 0.3 });
    const belt = new THREE.Mesh(new THREE.BoxGeometry(SPAN * 2, 0.16, 1.15), this.beltMat);
    belt.position.set(0, BELT_Y - 0.08, BELT_Z); belt.receiveShadow = true; belt.castShadow = true;
    this.world.add(belt);
    // Brushed-metal side rails.
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.35, metalness: 0.7 });
    for (const dz of [0.64, -0.64]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(SPAN * 2, 0.14, 0.08), railMat);
      rail.position.set(0, BELT_Y + 0.02, BELT_Z + dz); rail.castShadow = true; this.world.add(rail);
    }
    // Roller end-caps + support legs.
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b727c, roughness: 0.4, metalness: 0.6 });
    for (const ex of [-SPAN, SPAN]) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 16), steel);
      roller.rotation.x = Math.PI / 2; roller.position.set(ex, BELT_Y - 0.08, BELT_Z); this.world.add(roller);
    }
    const legMat = new THREE.MeshStandardMaterial({ color: 0x40454d, roughness: 0.7, metalness: 0.3 });
    for (let x = -SPAN + 1.2; x <= SPAN; x += 2.4) {
      for (const dz of [0.5, -0.5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, BELT_Y - 0.1, 0.16), legMat);
        leg.position.set(x, (BELT_Y - 0.1) / 2, BELT_Z + dz); leg.castShadow = true; this.world.add(leg);
      }
    }
  }

  // --- Detailed machines ------------------------------------------------------

  private buildStations(): void {
    for (const id of STATION_IDS) {
      const def = STATION_DEF_BY_ID[id];
      const color = STATION_COLOR[id];
      const accent = STATION_ACCENT[id];
      const group = new THREE.Group();
      group.position.set(STATION_X[id], 0, BELT_Z);

      const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.5 });
      const steel = new THREE.MeshStandardMaterial({ color: 0x868d97, roughness: 0.35, metalness: 0.75 });

      // Plinth.
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.34, 2.15), dark);
      plinth.position.set(0, 0.17, MACHINE_Z); plinth.castShadow = true; plinth.receiveShadow = true; group.add(plinth);

      // Main housing (scaled by level).
      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(1.55, 1.45, 1.75),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.55 }),
      );
      housing.position.set(0, 1.12, MACHINE_Z); housing.castShadow = true; housing.receiveShadow = true; group.add(housing);
      // Beveled top cap.
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 1.9), steel);
      cap.position.set(0, 1.92, MACHINE_Z); cap.castShadow = true; group.add(cap);

      // Tilted control panel with an emissive screen on the belt-facing side.
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 0.08), dark);
      panel.position.set(0, 0.92, MACHINE_Z + 0.92); panel.rotation.x = -0.32; group.add(panel);
      const screenMat = new THREE.MeshStandardMaterial({
        map: this.texScreen(def.icon, accent), emissive: accent, emissiveIntensity: 0.9, roughness: 0.3,
      });
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.46), screenMat);
      screen.position.set(0, 0.93, MACHINE_Z + 0.965); screen.rotation.x = -0.32; group.add(screen);

      // Side pipes.
      const pipeMat = new THREE.MeshStandardMaterial({ color: 0xb6bcc4, roughness: 0.3, metalness: 0.8 });
      for (const sx of [-0.86, 0.86]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5, 12), pipeMat);
        pipe.position.set(sx, 1.0, MACHINE_Z - 0.6); pipe.castShadow = true; group.add(pipe);
        const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), pipeMat);
        elbow.position.set(sx, 1.75, MACHINE_Z - 0.6); group.add(elbow);
      }

      // Feed hopper above the belt (funnel that drops onto the line).
      const hopper = new THREE.Mesh(
        new THREE.CylinderGeometry(0.46, 0.16, 0.55, 14, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x70767f, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide }),
      );
      hopper.position.set(0, 1.55, MACHINE_Z + 0.55); hopper.castShadow = true; group.add(hopper);

      // Spinning working part on top (speed ∝ cadence). Blades for prep, fan elsewhere.
      const rotorMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.3, metalness: 0.6 });
      const rotor = new THREE.Mesh(
        id === 'prep'
          ? new THREE.BoxGeometry(1.0, 0.05, 0.12)
          : new THREE.CylinderGeometry(0.07, 0.07, 0.95, 10),
        rotorMat,
      );
      rotor.rotation.z = Math.PI / 2; rotor.position.set(0, 2.16, MACHINE_Z); group.add(rotor);

      // Arch the belt passes through.
      const arch = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.28, 0.55), dark);
      arch.position.set(0, 1.62, 0); arch.castShadow = true; group.add(arch);
      for (const dx of [-0.8, 0.8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), dark);
        post.position.set(dx, 1.05, 0); post.castShadow = true; group.add(post);
      }

      // Blinking status light.
      const statusMat = new THREE.MeshStandardMaterial({ color: 0x223018, emissive: 0x55e070, emissiveIntensity: 1.2, roughness: 0.4 });
      const status = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), statusMat);
      status.position.set(0.66, 1.78, MACHINE_Z + 0.6); group.add(status);
      const statusGlow = makeGlow(0x66ff88, 0.8); statusGlow.position.copy(status.position); group.add(statusGlow);

      // Icon billboard above.
      const icon = this.makeIconSprite(def.icon);
      icon.position.set(0, 2.75, MACHINE_Z); group.add(icon);

      // Buffer gauge on the housing front.
      const gaugeBg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 1 }));
      gaugeBg.position.set(0, 0.5, MACHINE_Z + 0.9); group.add(gaugeBg);
      const gaugeFill = new THREE.Mesh(
        new THREE.BoxGeometry(1.16, 0.12, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x57e08a, emissive: 0x1a5a30, emissiveIntensity: 0.6, roughness: 0.5 }),
      );
      gaugeFill.position.set(0, 0.5, MACHINE_Z + 0.92); group.add(gaugeFill);

      // Bottleneck halo ring on the floor.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.3, 0.08, 10, 28),
        new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff3a2a, emissiveIntensity: 1.0, roughness: 0.5 }),
      );
      ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.05, MACHINE_Z + 0.2); ring.visible = false; group.add(ring);

      // Invisible pick target.
      const pick = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.2, 2.4), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.set(0, 1.4, MACHINE_Z + 0.4); pick.userData.id = id; group.add(pick);

      this.world.add(group);
      this.stations.set(id, {
        id, group, housing, rotor, gaugeFill, ring, pick, screenMat, statusMat, statusGlow,
        fx: STATION_FX[id], fxAnchor: new THREE.Vector3(STATION_X[id], 1.9, MACHINE_Z + 0.55),
        workerDots: [], rate: 1,
      });

      if (id === 'cooking') this.addBurner(group, accent);
    }
  }

  /** A glowing burner under the cooking station for extra warmth. */
  private addBurner(group: THREE.Group, accent: number): void {
    const burner = makeGlow(accent, 1.6); burner.position.set(0, 0.55, 0.2); group.add(burner);
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
  private texFloor(): THREE.Texture {
    const { c, g } = this.paintCanvas(256);
    g.fillStyle = '#3a4049'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2400; i++) { g.fillStyle = ['#41474f', '#33383f', '#454c54'][(Math.random() * 3) | 0]; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 3;
    for (let p = 0; p <= 256; p += 64) { g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke(); }
    return this.finish(c, 8, 6);
  }
  private texHazard(): THREE.Texture {
    const { c, g } = this.paintCanvas(128);
    g.fillStyle = '#1c2026'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f0b21f';
    for (let x = -128; x < 256; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 14, 0); g.lineTo(x + 14 - 40, 128); g.lineTo(x - 40, 128); g.closePath(); g.fill(); }
    // Clear centre lane.
    g.fillStyle = '#22262d'; g.fillRect(0, 26, 128, 76);
    return this.finish(c, 12, 1);
  }
  private texPanel(): THREE.Texture {
    const { c, g } = this.paintCanvas(256);
    g.fillStyle = '#3a414b'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 4;
    for (let p = 0; p <= 256; p += 64) { g.strokeRect(p, 0, 64, 256); g.strokeRect(0, p, 256, 64); }
    g.fillStyle = '#5a626d';
    for (let y = 16; y < 256; y += 64) for (let x = 16; x < 256; x += 64) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
    return this.finish(c, 6, 2);
  }
  private texBelt(): THREE.Texture {
    const { c, g } = this.paintCanvas(128);
    g.fillStyle = '#23262d'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#181b21';
    for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 8, 128);
    return this.finish(c, SPAN * 2, 1);
  }
  private texScreen(emoji: string, accent: number): THREE.Texture {
    const { c, g } = this.paintCanvas(128);
    g.fillStyle = '#0b0f14'; g.fillRect(0, 0, 128, 128);
    g.font = '64px system-ui, "Segoe UI Emoji", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 64, 48);
    const hex = '#' + (accent & 0xffffff).toString(16).padStart(6, '0');
    g.fillStyle = hex;
    for (let i = 0; i < 4; i++) g.fillRect(18 + i * 26, 86, 18, 6 + (i % 2) * 16);
    const t = new THREE.CanvasTexture(c);
    (t as unknown as { colorSpace: string }).colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter;
    return t;
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

  // --- Items ------------------------------------------------------------------

  private makeItem(): Item {
    const group = new THREE.Group();
    const stages: THREE.Object3D[] = [];
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), new THREE.MeshStandardMaterial({ color: 0xb07a44, roughness: 0.8, metalness: 0.05 }));
    const chopped = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x6fb83f, roughness: 0.75 }));
    const cooked = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe0843a, roughness: 0.5, metalness: 0.1, emissive: 0x3a1a00, emissiveIntensity: 0.35 }));
    const boxed = new THREE.Group();
    boxed.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.45 })));
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: 0xe8533a, roughness: 0.45 })); lid.position.y = 0.14; boxed.add(lid);
    for (const m of [crate, chopped, cooked, boxed]) { m.position.y = 0.2; (m as THREE.Mesh).castShadow = true; group.add(m); stages.push(m); }
    group.position.y = BELT_Y;
    this.world.add(group);
    return { group, stages, t: 0, stage: 0 };
  }
  private setItemStage(item: Item, stage: number): void {
    if (stage === item.stage) return;
    item.stage = stage;
    for (let i = 0; i < item.stages.length; i++) item.stages[i].visible = i === stage;
  }

  // --- Scooters ---------------------------------------------------------------

  private makeScooter(): Scooter {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.62), new THREE.MeshStandardMaterial({ color: 0xb2484a, roughness: 0.4, metalness: 0.3 }));
    body.position.y = 0.24; body.castShadow = true; g.add(body);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xf4b942, emissive: 0xff8c1a, emissiveIntensity: 0.35, roughness: 0.5 }));
    box.position.set(0, 0.46, -0.28); g.add(box);
    for (const wz of [0.28, -0.28]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.6 })); w.rotation.z = Math.PI / 2; w.position.set(0, 0.12, wz); g.add(w); }
    const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2f55c8, roughness: 0.6 })); rider.position.set(0, 0.5, 0.04); g.add(rider);
    g.visible = false; this.world.add(g);
    return { mesh: g, t: 0, active: false };
  }
  private launchScooter(): void {
    let s = this.scooters.find((x) => !x.active);
    if (!s) { if (this.scooters.length >= 6) return; s = this.makeScooter(); this.scooters.push(s); }
    s.active = true; s.t = 0; s.mesh.visible = true;
  }

  // --- Particles (steam / sparks) ---------------------------------------------

  private spawnParticle(anchor: THREE.Vector3, kind: 'steam' | 'spark'): void {
    if (this.particles.length > 90) return;
    const mat = kind === 'steam'
      ? new THREE.MeshStandardMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.5, roughness: 1 })
      : new THREE.MeshStandardMaterial({ color: 0xffb24a, emissive: 0xff7a1a, emissiveIntensity: 1.5, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(
      kind === 'steam' ? new THREE.SphereGeometry(0.14, 8, 6) : new THREE.SphereGeometry(0.05, 6, 5),
      mat,
    );
    mesh.position.copy(anchor); mesh.position.x += (Math.random() - 0.5) * 0.4; mesh.position.z += (Math.random() - 0.5) * 0.3;
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
    for (const id of STATION_IDS) {
      const vis = this.stations.get(id); if (!vis) continue;
      const st = state.stations[id];
      vis.rate = FactoryEngine.stationRate(state, id, now);
      const grow = 1 + Math.min(st.level, 40) * 0.012;
      vis.housing.scale.set(grow, grow, grow);
      const cap = FactoryEngine.stationCapacity(state, id);
      const fill = id === 'delivery' ? Math.min(1, this.throughput / Math.max(0.001, vis.rate)) : Math.min(1, st.output / Math.max(1, cap));
      vis.gaugeFill.scale.x = Math.max(0.02, fill);
      vis.gaugeFill.position.x = -0.58 * (1 - fill);
      (vis.gaugeFill.material as THREE.MeshStandardMaterial).color.setHex(fill > 0.92 ? 0xff7a3a : 0x57e08a);
      vis.ring.visible = id === this.bottleneck;
      this.syncWorkerDots(vis, st.workers);
    }
  }

  private syncWorkerDots(vis: StationVis, count: number): void {
    while (vis.workerDots.length < count) {
      const w = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.24, 4, 8), new THREE.MeshStandardMaterial({ color: 0xdfe6ef, roughness: 0.6 }));
      body.position.y = 0.42; body.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.7 }));
      head.position.y = 0.74;
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
      hat.position.y = 0.88; // chef toque
      w.add(body, head, hat);
      const i = vis.workerDots.length;
      w.position.set(-0.7 + (i % 3) * 0.7, 0, 1.25 + Math.floor(i / 3) * 0.6);
      vis.group.add(w); vis.workerDots.push(w);
    }
    while (vis.workerDots.length > count) { const d = vis.workerDots.pop(); if (d) vis.group.remove(d); }
  }

  // --- Loop -------------------------------------------------------------------

  public start(): void { if (this.raf === 0) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.loop(t)); } }
  public stop(): void { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

  private loop(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now; this.t += dt;
    try { this.update(dt); this.renderer.render(this.scene, this.camera); }
    catch (err) { console.warn('[factory] render halted', err); this.stop(); return; }
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number): void {
    if (!this.dragging && !this.pinching) this.targetYaw += dt * 0.03;
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
    this.world.rotation.y = this.yaw;
    if (Math.abs(this.viewSize - this.targetViewSize) > 0.001) {
      this.viewSize += (this.targetViewSize - this.viewSize) * Math.min(1, dt * 8);
      this.updateCameraFrustum();
    }

    if (this.beltMat.map) this.beltMat.map.offset.x -= dt * 0.7;
    const beltSpeed = Math.min(3.4, 0.6 + this.throughput * 0.5);

    for (const vis of this.stations.values()) {
      vis.rotor.rotation.x += dt * Math.min(16, 2 + vis.rate * 1.5);
      // Pulse the screen + status light; bottleneck status blinks red.
      const isNeck = vis.id === this.bottleneck;
      vis.screenMat.emissiveIntensity = 0.7 + Math.sin(this.t * 3 + vis.rate) * 0.25;
      const blink = 0.6 + 0.4 * Math.sin(this.t * (isNeck ? 9 : 3));
      vis.statusMat.emissive.setHex(isNeck ? 0xff4a3a : 0x55e070);
      vis.statusMat.emissiveIntensity = 0.6 + blink;
      (vis.statusGlow.material as THREE.SpriteMaterial).color.setHex(isNeck ? 0xff6a4a : 0x66ff88);
      vis.statusGlow.material.opacity = 0.4 + blink * 0.4;
      if (vis.ring.visible) (vis.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + Math.sin(this.t * 4) * 0.4;
    }

    // Spawn items proportional to throughput.
    if (this.throughput > 0.0001 && this.items.length < 60) {
      this.spawnAccum += dt * this.throughput;
      while (this.spawnAccum >= 1) { this.spawnAccum -= 1; this.items.push(this.makeItem()); }
    }
    const vel = beltSpeed / (SPAN * 2);
    for (const item of this.items) {
      item.t += vel * dt;
      const x = -SPAN + item.t * (SPAN * 2);
      item.group.position.x = x;
      const stage = x < STATION_X.prep ? 0 : x < STATION_X.cooking ? 1 : x < STATION_X.plating ? 2 : 3;
      this.setItemStage(item, stage);
      item.group.position.y = BELT_Y + Math.abs(Math.sin((x + this.t) * 6)) * 0.015;
      item.group.rotation.y += dt * 0.5;
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].t >= 1) { this.world.remove(this.items[i].group); this.items.splice(i, 1); this.scooterAccum += 1; }
    }
    if (this.scooterAccum >= 2) { this.scooterAccum = 0; this.launchScooter(); }

    for (const s of this.scooters) {
      if (!s.active) continue;
      s.t += dt * 0.5;
      s.mesh.position.set(STATION_X.delivery + s.t * 6, 0, BELT_Z + 1.5);
      s.mesh.rotation.y = Math.PI / 2;
      if (s.t >= 1) { s.active = false; s.mesh.visible = false; }
    }

    // Steam / spark emitters scale with the relevant station's activity.
    const cook = this.stations.get('cooking');
    if (cook && this.throughput > 0.001) {
      this.steamAccum += dt * (2 + cook.rate * 0.5);
      while (this.steamAccum >= 1) { this.steamAccum -= 1; this.spawnParticle(cook.fxAnchor, 'steam'); }
    }
    const prep = this.stations.get('prep');
    if (prep && this.throughput > 0.001) {
      this.sparkAccum += dt * (3 + prep.rate * 0.6);
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
      if (this.lastPinch > 0 && d > 0) this.targetViewSize = Math.max(9, Math.min(26, this.targetViewSize * (this.lastPinch / d)));
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
    this.targetViewSize = Math.max(9, Math.min(26, this.targetViewSize + e.deltaY * 0.01));
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
    const picks = [...this.stations.values()].map((v) => v.pick);
    const hits = this.raycaster.intersectObjects(picks, false);
    if (hits.length > 0) {
      const id = hits[0].object.userData.id as StationId | undefined;
      if (id) this.onTapStation(id);
    }
  }
}
