/**
 * iso3dtex.ts — Procedural textures & glow helpers for the 3D village.
 *
 * Everything is generated on a 2D canvas at runtime (no image assets), so the
 * game stays fully offline. Textures are cached by key.
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

/** Mossy grass ground. */
export function texGrass(): THREE.Texture {
  return cached('grass', () => {
    const s = 256; const { c, g } = canvas(s);
    g.fillStyle = '#5f8a3c'; g.fillRect(0, 0, s, s);
    speckle(g, s, 1400, ['#6f9a44', '#558236', '#6aa048', '#4f7a32'], 1, 3);
    return finalize(c, 4);
  });
}

/** Cut-stone platform tiles with mortar lines. */
export function texStone(): THREE.Texture {
  return cached('stone', () => {
    const s = 256; const { c, g } = canvas(s);
    g.fillStyle = '#8a8170'; g.fillRect(0, 0, s, s);
    const tile = 64;
    for (let y = 0; y < s; y += tile) {
      const off = ((y / tile) % 2) * (tile / 2);
      for (let x = -tile; x < s; x += tile) {
        g.fillStyle = ['#928879', '#867c6c', '#9a9080', '#7f7666'][(Math.random() * 4) | 0];
        g.fillRect(x + off + 2, y + 2, tile - 4, tile - 4);
      }
    }
    speckle(g, s, 700, ['#787060', '#9a9282'], 1, 2);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
    for (let y = 0; y <= s; y += tile) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
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

/** Vertical wooden planks (tinted toward `hex`). */
export function texPlanks(hex: number): THREE.Texture {
  return cached(`plank_${hex}`, () => {
    const s = 128; const { c, g } = canvas(s);
    const base = '#' + hex.toString(16).padStart(6, '0');
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const planks = 6; const w = s / planks;
    for (let i = 0; i < planks; i++) {
      const shade = 0.86 + Math.random() * 0.26;
      g.fillStyle = shadeHex(hex, shade);
      g.fillRect(i * w + 1, 0, w - 2, s);
      g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, s); g.stroke();
    }
    speckle(g, s, 200, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.07)'], 1, 2);
    return finalize(c, 1);
  });
}

/** Rough stone blocks (tinted toward `hex`). */
export function texStoneWall(hex: number): THREE.Texture {
  return cached(`wall_${hex}`, () => {
    const s = 128; const { c, g } = canvas(s);
    g.fillStyle = shadeHex(hex, 0.8); g.fillRect(0, 0, s, s);
    const bw = 42, bh = 26;
    for (let y = 0, row = 0; y < s; y += bh, row++) {
      const off = (row % 2) * (bw / 2);
      for (let x = -bw; x < s; x += bw) {
        g.fillStyle = shadeHex(hex, 0.86 + Math.random() * 0.28);
        g.fillRect(x + off + 1.5, y + 1.5, bw - 3, bh - 3);
      }
    }
    return finalize(c, 1);
  });
}

/** Roof shingles in rows (tinted toward `hex`). */
export function texShingle(hex: number): THREE.Texture {
  return cached(`shingle_${hex}`, () => {
    const s = 128; const { c, g } = canvas(s);
    g.fillStyle = shadeHex(hex, 0.7); g.fillRect(0, 0, s, s);
    const rh = 18;
    for (let y = 0, row = 0; y < s; y += rh, row++) {
      const off = (row % 2) * 14;
      for (let x = -28; x < s; x += 28) {
        g.fillStyle = shadeHex(hex, 0.82 + Math.random() * 0.3);
        g.beginPath();
        g.moveTo(x + off, y); g.lineTo(x + off + 26, y);
        g.lineTo(x + off + 26, y + rh - 2); g.arc(x + off + 13, y + rh - 2, 13, 0, Math.PI);
        g.closePath(); g.fill();
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
