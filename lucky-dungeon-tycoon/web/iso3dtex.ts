/**
 * iso3dtex.ts — Procedural textures & glow helpers for the 3D village.
 *
 * Everything is generated on a 2D canvas at runtime (no image assets), so the
 * game stays fully offline. Textures carry hand-faked detail — bevels, wood
 * grain, knots, moss, cracks, cobbles and wildflowers — and are cached by key.
 */

import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function canvas(size = 256): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d')!;
  return { c, g };
}

function finalize(c: HTMLCanvasElement, repeat = 1): THREE.Texture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  (tex as unknown as { colorSpace: string }).colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function speckle(g: CanvasRenderingContext2D, size: number, n: number, colors: string[], min = 1, max = 3): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = min + Math.random() * (max - min);
    g.beginPath();
    g.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    g.fill();
  }
}

/** Mossy grass ground with turf patches and scattered wildflowers. */
export function texGrass(): THREE.Texture {
  return cached('grass', () => {
    const s = 512; const { c, g } = canvas(s);
    g.fillStyle = '#5f8a3c'; g.fillRect(0, 0, s, s);
    // Large soft turf patches (lighter & darker) for big-scale variation.
    for (let i = 0; i < 44; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 30 + Math.random() * 80;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const light = Math.random() > 0.5;
      grad.addColorStop(0, light ? 'rgba(150,200,95,0.22)' : 'rgba(55,95,38,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // Fine blades.
    speckle(g, s, 5200, ['#6f9a44', '#558236', '#6aa048', '#4f7a32', '#79a850'], 1, 2.4);
    // Tiny wildflowers dotted through the turf.
    for (let i = 0; i < 80; i++) {
      g.fillStyle = ['#f4d03f', '#ffffff', '#e88bb0', '#f4d03f', '#bda0ff'][(Math.random() * 5) | 0];
      g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 1.4 + Math.random() * 1.4, 0, Math.PI * 2); g.fill();
    }
    return finalize(c, 4);
  });
}

/** Cut-stone platform tiles with bevelled edges, cracks and mortar lines. */
export function texStone(): THREE.Texture {
  return cached('stone', () => {
    const s = 512; const { c, g } = canvas(s);
    g.fillStyle = '#8a8170'; g.fillRect(0, 0, s, s);
    const tile = 96;
    for (let y = 0; y < s; y += tile) {
      const off = ((y / tile) % 2) * (tile / 2);
      for (let x = -tile; x < s; x += tile) {
        const bx = x + off + 3, by = y + 3, bw = tile - 6, bh = tile - 6;
        g.fillStyle = ['#928879', '#867c6c', '#9a9080', '#7f7666'][(Math.random() * 4) | 0];
        g.fillRect(bx, by, bw, bh);
        // Bevel: light along top/left, shadow along bottom/right.
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(bx, by + bh); g.lineTo(bx, by); g.lineTo(bx + bw, by); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.30)';
        g.beginPath(); g.moveTo(bx + bw, by); g.lineTo(bx + bw, by + bh); g.lineTo(bx, by + bh); g.stroke();
      }
    }
    speckle(g, s, 1600, ['#787060', '#9a9282', '#6e6656'], 1, 2);
    // Hairline cracks for weathering.
    g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      let x = Math.random() * s, y = Math.random() * s;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 44; y += (Math.random() - 0.5) * 44; g.lineTo(x, y); }
      g.stroke();
    }
    return finalize(c, 3);
  });
}

/** Dirt path. */
export function texDirt(): THREE.Texture {
  return cached('dirt', () => {
    const s = 128; const { c, g } = canvas(s);
    g.fillStyle = '#9c8b6e'; g.fillRect(0, 0, s, s);
    speckle(g, s, 500, ['#8a795c', '#ab9a78', '#7a6a50'], 1, 3);
    return finalize(c, 1);
  });
}

/** Rounded cobblestones for the walkways. */
export function texCobble(): THREE.Texture {
  return cached('cobble', () => {
    const s = 256; const { c, g } = canvas(s);
    g.fillStyle = '#5f5645'; g.fillRect(0, 0, s, s);
    const cs = 34;
    for (let y = -cs; y < s + cs; y += cs) {
      const off = (((y / cs) | 0) % 2) * (cs / 2);
      for (let x = -cs; x < s + cs; x += cs) {
        const cx = x + off + cs / 2 + (Math.random() - 0.5) * 5;
        const cy = y + cs / 2 + (Math.random() - 0.5) * 5;
        const r = cs * 0.42 + Math.random() * 3;
        const shade = 0.82 + Math.random() * 0.5;
        const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
        grad.addColorStop(0, shadeHex(0x9c8b6e, shade * 1.05));
        grad.addColorStop(1, shadeHex(0x645a47, shade * 0.85));
        g.fillStyle = grad;
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      }
    }
    return finalize(c, 1);
  });
}

/** Vertical wooden planks with grain, knots and bevelled seams (tinted toward `hex`). */
export function texPlanks(hex: number): THREE.Texture {
  return cached(`plank_${hex}`, () => {
    const s = 256; const { c, g } = canvas(s);
    const base = '#' + hex.toString(16).padStart(6, '0');
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const planks = 6; const w = s / planks;
    for (let i = 0; i < planks; i++) {
      const shade = 0.86 + Math.random() * 0.26;
      g.fillStyle = shadeHex(hex, shade);
      g.fillRect(i * w + 1, 0, w - 2, s);
      // Wood grain: faint wavy streaks running the length of the plank.
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const gx = i * w + 4 + Math.random() * (w - 8);
        g.beginPath(); g.moveTo(gx, 0);
        for (let y = 0; y <= s; y += 16) g.lineTo(gx + Math.sin(y * 0.05 + k) * 1.6, y);
        g.stroke();
      }
      // Occasional knot.
      if (Math.random() < 0.55) {
        g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(i * w + w / 2, Math.random() * s, 3, 5, 0, 0, Math.PI * 2); g.stroke();
      }
      // Seam shadow + inner highlight for a carved-edge look.
      g.strokeStyle = 'rgba(0,0,0,0.30)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, s); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(i * w + 2.5, 0); g.lineTo(i * w + 2.5, s); g.stroke();
    }
    speckle(g, s, 280, ['rgba(0,0,0,0.10)', 'rgba(255,255,255,0.06)'], 1, 2);
    return finalize(c, 1);
  });
}

/** Rough stone blocks with bevelled edges and mossy mortar (tinted toward `hex`). */
export function texStoneWall(hex: number): THREE.Texture {
  return cached(`wall_${hex}`, () => {
    const s = 256; const { c, g } = canvas(s);
    g.fillStyle = shadeHex(hex, 0.8); g.fillRect(0, 0, s, s);
    const bw = 56, bh = 34;
    for (let y = 0, row = 0; y < s; y += bh, row++) {
      const off = (row % 2) * (bw / 2);
      for (let x = -bw; x < s; x += bw) {
        const rx = x + off + 2, ry = y + 2, rw = bw - 4, rh = bh - 4;
        g.fillStyle = shadeHex(hex, 0.86 + Math.random() * 0.28);
        g.fillRect(rx, ry, rw, rh);
        g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(rx, ry + rh); g.lineTo(rx, ry); g.lineTo(rx + rw, ry); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.32)';
        g.beginPath(); g.moveTo(rx + rw, ry); g.lineTo(rx + rw, ry + rh); g.lineTo(rx, ry + rh); g.stroke();
      }
    }
    // Moss creeping through the mortar.
    speckle(g, s, 150, ['rgba(90,120,60,0.40)', 'rgba(70,100,45,0.34)'], 1, 2.6);
    return finalize(c, 1);
  });
}

/** Roof shingles in overlapping rows with highlight & shadow (tinted toward `hex`). */
export function texShingle(hex: number): THREE.Texture {
  return cached(`shingle_${hex}`, () => {
    const s = 256; const { c, g } = canvas(s);
    g.fillStyle = shadeHex(hex, 0.7); g.fillRect(0, 0, s, s);
    const rh = 30;
    for (let y = 0, row = 0; y < s; y += rh, row++) {
      const off = (row % 2) * 24;
      for (let x = -48; x < s; x += 46) {
        g.fillStyle = shadeHex(hex, 0.82 + Math.random() * 0.3);
        g.beginPath();
        g.moveTo(x + off, y); g.lineTo(x + off + 44, y);
        g.lineTo(x + off + 44, y + rh - 3); g.arc(x + off + 22, y + rh - 3, 22, 0, Math.PI);
        g.closePath(); g.fill();
        // Top highlight + curved bottom shadow give each shingle depth.
        g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x + off, y); g.lineTo(x + off + 44, y); g.stroke();
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.beginPath(); g.arc(x + off + 22, y + rh - 3, 22, 0.25, Math.PI - 0.25); g.fill();
      }
    }
    return finalize(c, 1);
  });
}

/** Soft radial glow sprite texture (white → transparent). */
export function texGlow(): THREE.Texture {
  return cached('glow', () => {
    const s = 128; const { c, g } = canvas(s);
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    (tex as unknown as { colorSpace: string }).colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** An additive glow sprite (fake bloom) of the given colour and world size. */
export function makeGlow(color: number, size: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: texGlow(), color, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 1,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const t = make();
  cache.set(key, t);
  return t;
}

function shadeHex(hex: number, factor: number): string {
  const r = Math.min(255, ((hex >> 16) & 255) * factor);
  const g = Math.min(255, ((hex >> 8) & 255) * factor);
  const b = Math.min(255, (hex & 255) * factor);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
