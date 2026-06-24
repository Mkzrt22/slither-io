/**
 * scene.ts — Real-3D factory floor for the production-line game.
 *
 * Renders the simulation as a literal conveyor line: five machine stations in
 * a row joined by a moving belt, with food items riding it and physically
 * transforming stage by stage (crate → chopped → cooked → plated) before a
 * delivery scooter carries them off. Item spawn density tracks the line's real
 * throughput, the bottleneck station glows red, each station shows a live
 * buffer gauge and its assigned workers, and tapping a station selects it.
 *
 * Three.js is vendored/bundled; everything else is procedural, so the scene is
 * fully offline. Driven by setState(state) + a per-frame update loop.
 */

import * as THREE from 'three';
import { FactoryEngine } from '../../src/factory/FactoryEngine.js';
import { FactoryState, STATION_IDS, StationId } from '../../src/factory/types.js';
import { STATION_DEF_BY_ID } from '../../src/factory/config.js';
import { makeGlow, texStone } from '../iso3dtex.js';

const STATION_X: Record<StationId, number> = {
  receiving: -6, prep: -3, cooking: 0, plating: 3, delivery: 6,
};
const BELT_Z = 0;
const BELT_Y = 0.55;
const SPAN = 7.2; // belt runs from -SPAN..+SPAN on X

const STATION_COLOR: Record<StationId, number> = {
  receiving: 0x4a83c4, prep: 0x46b07a, cooking: 0xd8703a, plating: 0xc7a23a, delivery: 0xb2484a,
};

interface StationVis {
  id: StationId;
  group: THREE.Group;
  housing: THREE.Mesh;
  rotor: THREE.Mesh;
  gaugeFill: THREE.Mesh;
  ring: THREE.Mesh;        // bottleneck halo
  pick: THREE.Mesh;
  workerDots: THREE.Mesh[];
  rate: number;            // cached effective rate, for rotor speed
}

interface Item {
  group: THREE.Group;
  stages: THREE.Mesh[];    // 4 stage meshes, one visible at a time
  t: number;               // 0..1 along the belt
  stage: number;
}

interface Scooter {
  mesh: THREE.Group;
  t: number;               // 0..1 along the exit road
  active: boolean;
}

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
  private beltMat!: THREE.MeshStandardMaterial;
  private workerPool: THREE.Group[] = [];

  private state: FactoryState | null = null;
  private throughput = 0;       // units/sec, drives spawn rate
  private bottleneck: StationId = 'cooking';
  private spawnAccum = 0;
  private scooterAccum = 0;

  private raf = 0; private last = 0; private t = 0;
  private yaw = 0; private targetYaw = 0;
  private viewSize = 15; private targetViewSize = 15; private aspect = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragging = false; private dragMoved = 0; private lastPX = 0;
  private lastPinch = 0; private pinching = false;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onTapStation: (id: StationId) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    (this.renderer as unknown as { outputColorSpace: string }).outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene.background = new THREE.Color(0x161b24);
    this.scene.fog = new THREE.Fog(0x161b24, 28, 52);
    this.camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 200);
    this.camera.position.set(16, 18, 18);
    this.camera.lookAt(0, 1, 0);
    this.scene.add(this.world);

    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x40454f, 1.05));
    this.sun = new THREE.DirectionalLight(0xfff3df, 2.1);
    this.sun.position.set(10, 20, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -16; sc.right = 16; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.buildFloor();
    this.buildBelt();
    this.buildStations();
    this.buildDecor();
    this.resize();

    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  // --- Build ------------------------------------------------------------------

  private buildFloor(): void {
    const tex = texStone();
    tex.repeat.set(8, 6);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(34, 1, 24),
      new THREE.MeshStandardMaterial({ map: tex, color: 0x6b7078, roughness: 1 }),
    );
    floor.position.y = -0.5; floor.receiveShadow = true;
    this.world.add(floor);
    // Painted safety lane under the belt.
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(SPAN * 2 + 4, 0.02, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 1 }),
    );
    lane.position.set(0, 0.011, BELT_Z); lane.receiveShadow = true;
    this.world.add(lane);
    // Back wall for depth.
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(34, 9, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 1 }),
    );
    wall.position.set(0, 4, -6.4); wall.receiveShadow = true;
    this.world.add(wall);
  }

  private buildBelt(): void {
    this.beltMat = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.7, metalness: 0.2 });
    const belt = new THREE.Mesh(new THREE.BoxGeometry(SPAN * 2, 0.18, 1.1), this.beltMat);
    belt.position.set(0, BELT_Y - 0.1, BELT_Z); belt.receiveShadow = true; belt.castShadow = true;
    this.world.add(belt);
    // Belt rollers (visual ribs) + side rails.
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.5, metalness: 0.4 });
    for (const dz of [0.62, -0.62]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(SPAN * 2, 0.12, 0.08), railMat);
      rail.position.set(0, BELT_Y, BELT_Z + dz); rail.castShadow = true;
      this.world.add(rail);
    }
    // Legs.
    const legMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.8 });
    for (let x = -SPAN + 1; x <= SPAN; x += 2) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, BELT_Y, 0.18), legMat);
      leg.position.set(x, (BELT_Y - 0.1) / 2, BELT_Z + 0.5); this.world.add(leg);
      const leg2 = leg.clone(); leg2.position.z = BELT_Z - 0.5; this.world.add(leg2);
    }
  }

  private buildStations(): void {
    for (const id of STATION_IDS) {
      const def = STATION_DEF_BY_ID[id];
      const x = STATION_X[id];
      const group = new THREE.Group();
      group.position.set(x, 0, BELT_Z);

      const housing = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.5, 1.9),
        new THREE.MeshStandardMaterial({ color: STATION_COLOR[id], roughness: 0.55, metalness: 0.15 }),
      );
      housing.position.set(0, 1.3, -0.95); housing.castShadow = true; housing.receiveShadow = true;
      group.add(housing);
      // A canopy/arch the belt passes through.
      const arch = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.25, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6 }),
      );
      arch.position.set(0, 1.55, 0); arch.castShadow = true; group.add(arch);
      for (const dx of [-0.78, 0.78]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 1.0, 0.16),
          new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6 }),
        );
        post.position.set(dx, 1.05, 0); group.add(post);
      }
      // A spinning working part on top (speed ∝ cadence).
      const rotor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8),
        new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
      );
      rotor.rotation.z = Math.PI / 2; rotor.position.set(0, 2.2, -0.95); group.add(rotor);

      // Icon billboard above.
      const icon = this.makeIconSprite(def.icon);
      icon.position.set(0, 3.0, -0.95); group.add(icon);

      // Buffer gauge: a fill bar on the housing's front face (front face is at
      // local z ≈ 0, since the housing sits at z=-0.95 with depth 1.9).
      const gaugeBg = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.16, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 1 }),
      );
      gaugeBg.position.set(0, 0.78, 0.03); group.add(gaugeBg);
      const gaugeFill = new THREE.Mesh(
        new THREE.BoxGeometry(1.16, 0.12, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x57e08a, emissive: 0x1a5a30, emissiveIntensity: 0.5, roughness: 0.6 }),
      );
      gaugeFill.position.set(0, 0.78, 0.05); group.add(gaugeFill);

      // Bottleneck halo ring (hidden unless this station is the bottleneck).
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.25, 0.07, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xff3a2a, emissiveIntensity: 0.9, roughness: 0.5 }),
      );
      ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.06, -0.4); ring.visible = false;
      group.add(ring);

      // Invisible pick target.
      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 3.2, 2.4),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.set(0, 1.5, -0.5); pick.userData.id = id; group.add(pick);

      this.world.add(group);
      this.stations.set(id, {
        id, group, housing, rotor, gaugeFill, ring, pick, workerDots: [], rate: 1,
      });
    }
  }

  private buildDecor(): void {
    // A forklift parked by receiving.
    const fork = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.7, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xf0a826, roughness: 0.6 }),
    );
    body.position.y = 0.5; body.castShadow = true; fork.add(body);
    const mast = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1.3, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.7 }),
    );
    mast.position.set(0, 0.9, 0.6); fork.add(mast);
    for (const dz of [0.35, -0.35]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x14141a }));
      w.rotation.x = Math.PI / 2; w.position.set(0.42, 0.22, dz); fork.add(w);
      const w2 = w.clone(); w2.position.x = -0.42; fork.add(w2);
    }
    fork.position.set(STATION_X.receiving - 1.8, 0, BELT_Z + 2.4);
    fork.rotation.y = 0.4; this.world.add(fork);

    // Ingredient pallets near receiving.
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x9a6f3f, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), crateMat);
      crate.position.set(STATION_X.receiving - 2.6 + (i % 2) * 0.55, 0.25 + Math.floor(i / 2) * 0.52, BELT_Z - 1.6 + (i % 2) * 0.1);
      crate.castShadow = true; this.world.add(crate);
    }
    // Overhead lamps.
    for (const x of [-5, 0, 5]) {
      const lamp = makeGlow(0xfff0c0, 5); lamp.position.set(x, 6, BELT_Z); lamp.material.opacity = 0.5;
      this.world.add(lamp);
    }
  }

  private makeIconSprite(emoji: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '92px system-ui, "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(1.1, 1.1, 1);
    return spr;
  }

  // --- Items (the flowing goods) ----------------------------------------------

  private makeItem(): Item {
    const group = new THREE.Group();
    const stages: THREE.Mesh[] = [];
    // Stage 0: raw crate.
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.32, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xb07a44, roughness: 0.85 }),
    );
    // Stage 1: chopped (a low green heap).
    const chopped = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.24, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x6fb83f, roughness: 0.8 }),
    );
    // Stage 2: cooked dish (orange dome).
    const cooked = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xe0843a, roughness: 0.6, emissive: 0x3a1a00, emissiveIntensity: 0.3 }),
    );
    // Stage 3: plated/boxed (white box, red lid).
    const boxed = new THREE.Group() as unknown as THREE.Mesh;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.5 }));
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: 0xe8533a, roughness: 0.5 }));
    lid.position.y = 0.14; (boxed as unknown as THREE.Group).add(b, lid);
    for (const m of [crate, chopped, cooked, boxed]) {
      (m as THREE.Object3D).position.y = 0.2;
      (m as THREE.Object3D).castShadow = true;
      group.add(m as THREE.Object3D);
      stages.push(m);
    }
    group.position.y = BELT_Y;
    this.world.add(group);
    return { group, stages, t: 0, stage: 0 };
  }

  private setItemStage(item: Item, stage: number): void {
    if (stage === item.stage) return;
    item.stage = stage;
    for (let i = 0; i < item.stages.length; i++) item.stages[i].visible = i === stage;
  }

  // --- Scooters (delivery) ----------------------------------------------------

  private makeScooter(): Scooter {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.62), new THREE.MeshStandardMaterial({ color: 0xb2484a, roughness: 0.55 }));
    body.position.y = 0.24; body.castShadow = true; g.add(body);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xf4b942, emissive: 0xff8c1a, emissiveIntensity: 0.3, roughness: 0.5 }));
    box.position.set(0, 0.46, -0.28); g.add(box);
    for (const wz of [0.28, -0.28]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x14141a }));
      w.rotation.z = Math.PI / 2; w.position.set(0, 0.12, wz); g.add(w);
    }
    const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2f55c8 }));
    rider.position.set(0, 0.5, 0.04); g.add(rider);
    g.visible = false; this.world.add(g);
    return { mesh: g, t: 0, active: false };
  }

  private launchScooter(): void {
    let s = this.scooters.find((x) => !x.active);
    if (!s) {
      if (this.scooters.length >= 6) return;
      s = this.makeScooter(); this.scooters.push(s);
    }
    s.active = true; s.t = 0; s.mesh.visible = true;
  }

  // --- State sync -------------------------------------------------------------

  public setState(state: FactoryState): void {
    this.state = state;
    const now = Date.now();
    this.throughput = FactoryEngine.lineThroughput(state, now);
    this.bottleneck = FactoryEngine.bottleneck(state, now);
    for (const id of STATION_IDS) {
      const vis = this.stations.get(id);
      if (!vis) continue;
      const st = state.stations[id];
      vis.rate = FactoryEngine.stationRate(state, id, now);
      // Housing grows subtly with level so upgrades read visually.
      const grow = 1 + Math.min(st.level, 40) * 0.012;
      vis.housing.scale.set(grow, grow, grow);
      // Buffer gauge fill (delivery has no buffer → show flow instead).
      const cap = FactoryEngine.stationCapacity(state, id);
      const fill = id === 'delivery'
        ? Math.min(1, this.throughput / Math.max(0.001, vis.rate))
        : Math.min(1, st.output / Math.max(1, cap));
      vis.gaugeFill.scale.x = Math.max(0.02, fill);
      vis.gaugeFill.position.x = -0.58 * (1 - fill);
      (vis.gaugeFill.material as THREE.MeshStandardMaterial).color.setHex(
        fill > 0.92 ? 0xff7a3a : 0x57e08a,
      );
      // Bottleneck halo.
      vis.ring.visible = id === this.bottleneck;
      // Worker dots.
      this.syncWorkerDots(vis, st.workers);
    }
  }

  private syncWorkerDots(vis: StationVis, count: number): void {
    while (vis.workerDots.length < count) {
      const dot = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.12, 0.22, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0xf1d3a8, roughness: 0.8 }),
      );
      dot.castShadow = true;
      const i = vis.workerDots.length;
      dot.position.set(-0.7 + (i % 3) * 0.7, 0.4, 1.2 + Math.floor(i / 3) * 0.6);
      vis.group.add(dot); vis.workerDots.push(dot);
    }
    while (vis.workerDots.length > count) {
      const d = vis.workerDots.pop(); if (d) vis.group.remove(d);
    }
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
    // Gentle idle rotation when not interacting.
    if (!this.dragging && !this.pinching) this.targetYaw += dt * 0.03;
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 8);
    this.world.rotation.y = this.yaw;
    if (Math.abs(this.viewSize - this.targetViewSize) > 0.001) {
      this.viewSize += (this.targetViewSize - this.viewSize) * Math.min(1, dt * 8);
      this.updateCameraFrustum();
    }

    // Animated belt surface + spinning station rotors (speed ∝ cadence).
    if (this.beltMat.map) this.beltMat.map.offset.x -= dt * 0.6;
    const beltSpeed = Math.min(3.2, 0.6 + this.throughput * 0.5);
    for (const vis of this.stations.values()) {
      vis.rotor.rotation.x += dt * Math.min(14, 2 + vis.rate * 1.5);
      if (vis.ring.visible) {
        const p = 0.7 + Math.sin(this.t * 4) * 0.3;
        (vis.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = p;
      }
    }

    // Spawn items proportional to throughput.
    if (this.throughput > 0.0001 && this.items.length < 60) {
      this.spawnAccum += dt * this.throughput;
      while (this.spawnAccum >= 1) {
        this.spawnAccum -= 1;
        this.items.push(this.makeItem());
      }
    }
    // Advance items along the belt; transform stage by stage; sell at the end.
    const vel = beltSpeed / (SPAN * 2); // fraction/sec
    for (const item of this.items) {
      item.t += vel * dt;
      const x = -SPAN + item.t * (SPAN * 2);
      item.group.position.x = x;
      // Stage by which stations we've passed.
      const stage = x < STATION_X.prep ? 0 : x < STATION_X.cooking ? 1 : x < STATION_X.plating ? 2 : 3;
      this.setItemStage(item, stage);
      item.group.position.y = BELT_Y + Math.abs(Math.sin((x + this.t) * 6)) * 0.015;
    }
    // Recycle finished items (and fire a delivery scooter + coin pop).
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].t >= 1) {
        this.world.remove(this.items[i].group);
        this.items.splice(i, 1);
        this.scooterAccum += 1;
      }
    }
    if (this.scooterAccum >= 2) { this.scooterAccum = 0; this.launchScooter(); }

    // Drive scooters off to the right.
    for (const s of this.scooters) {
      if (!s.active) continue;
      s.t += dt * 0.5;
      const x = STATION_X.delivery + s.t * 6;
      s.mesh.position.set(x, 0, BELT_Z + 1.4);
      s.mesh.rotation.y = Math.PI / 2;
      if (s.t >= 1) { s.active = false; s.mesh.visible = false; }
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
