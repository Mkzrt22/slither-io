/**
 * iso.ts — Isometric village renderer (Lucky Dungeon Tycoon).
 *
 * A procedural, asset-free isometric tycoon scene drawn on a canvas: a raised
 * stone platform, six building prisms that grow with their upgrade level,
 * wandering worker sprites, drifting smoke, and coin pops. Tapping a building
 * invokes the upgrade callback. Pure presentation — no game rules here.
 */
import { BUILDING_TYPES } from '../src/types.js';
import { BUILDING_CONFIGS } from '../src/VillageEngine.js';
const TILE_W = 54;
const TILE_H = 27;
const GRID = 7; // 7×7 platform
/** Warm wood/stone palettes per building, evoking a medieval tycoon. */
const PALETTES = {
    mine: { top: '#8a8f99', topLit: '#a9aeb8', left: '#5d626b', right: '#71767f', roof: '#caa24a', roofDark: '#9c7a2c' },
    farm: { top: '#caa36a', topLit: '#e3bd82', left: '#8a6e44', right: '#a07f4f', roof: '#7fc25a', roofDark: '#5a9a3c' },
    sawmill: { top: '#b07d4f', topLit: '#cd9560', left: '#7a5230', right: '#915f38', roof: '#8a5a36', roofDark: '#6a4326' },
    market: { top: '#c98a5a', topLit: '#e6a06a', left: '#8c5d38', right: '#a36e42', roof: '#d24f52', roofDark: '#a23335' },
    blacksmith: { top: '#6f7480', topLit: '#888d99', left: '#4a4e58', right: '#5b606a', roof: '#e0773c', roofDark: '#b3551f' },
    castle: { top: '#9aa0ad', topLit: '#bcc2cf', left: '#666b78', right: '#7a808d', roof: '#8a6fd6', roofDark: '#5f4aa2' },
};
/** Fixed footprint position of each building on the grid. */
const LAYOUT = {
    mine: { x: 1, y: 1 },
    farm: { x: 4, y: 1 },
    sawmill: { x: 1, y: 4 },
    market: { x: 3.2, y: 3.2 },
    blacksmith: { x: 5, y: 4 },
    castle: { x: 4, y: 5.2 },
};
export class IsoScene {
    constructor(canvas, onTapBuilding) {
        this.canvas = canvas;
        this.onTapBuilding = onTapBuilding;
        this.dpr = 1;
        this.ox = 0;
        this.oy = 0;
        this.raf = 0;
        this.last = 0;
        this.levels = {
            mine: 0, farm: 0, sawmill: 0, market: 0, blacksmith: 0, castle: 0,
        };
        this.workers = [];
        this.coins = [];
        this.hitboxes = [];
        this.t = 0;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('2D context unavailable');
        this.ctx = ctx;
        this.resize();
        window.addEventListener('resize', () => this.resize());
        canvas.addEventListener('click', (e) => this.handleTap(e));
        this.spawnWorkers(4);
    }
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
        this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.ox = rect.width / 2;
        this.oy = 30;
    }
    /** Updates building levels + worker count from the live profile. */
    setState(state) {
        let total = 0;
        for (const type of BUILDING_TYPES) {
            this.levels[type] = Math.max(0, Math.floor(state.buildings[type]));
            total += this.levels[type];
        }
        const target = Math.min(16, 3 + Math.floor(total / 3));
        while (this.workers.length < target)
            this.spawnWorkers(1);
        if (this.workers.length > target)
            this.workers.length = target;
        this.ensureRunning();
    }
    /** Bursts a few coins above a building (called on upgrade). */
    coinPop(type) {
        const b = LAYOUT[type];
        const p = this.toScreen(b.x + 0.5, b.y + 0.5, this.heightOf(type) + 14);
        for (let i = 0; i < 6; i++) {
            this.coins.push({ sx: p.x + (Math.random() - 0.5) * 20, sy: p.y, vy: -40 - Math.random() * 40, life: 0 });
        }
        this.ensureRunning();
    }
    start() { this.ensureRunning(); }
    stop() { if (this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
    } }
    spawnWorkers(n) {
        const hues = ['#e6c38a', '#d98a8a', '#8ab6e6', '#9ad98a', '#c79ae6', '#e6b08a'];
        for (let i = 0; i < n; i++) {
            const x = 0.5 + Math.random() * (GRID - 1);
            const y = 0.5 + Math.random() * (GRID - 1);
            this.workers.push({
                x, y, tx: x, ty: y, speed: 0.7 + Math.random() * 0.8, pause: Math.random() * 2,
                hue: hues[Math.floor(Math.random() * hues.length)],
            });
        }
    }
    heightOf(type) {
        const base = type === 'castle' ? 30 : 16;
        return base + Math.min(this.levels[type], 24) * 2.6;
    }
    toScreen(gx, gy, gz) {
        return {
            x: this.ox + (gx - gy) * (TILE_W / 2),
            y: this.oy + (gx + gy) * (TILE_H / 2) - gz,
        };
    }
    ensureRunning() {
        if (this.raf === 0) {
            this.last = performance.now();
            this.raf = requestAnimationFrame((t) => this.loop(t));
        }
    }
    loop(now) {
        const dt = Math.min((now - this.last) / 1000, 0.05);
        this.last = now;
        this.t += dt;
        this.update(dt);
        this.draw();
        this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    update(dt) {
        for (const w of this.workers) {
            if (w.pause > 0) {
                w.pause -= dt;
                continue;
            }
            const dx = w.tx - w.x;
            const dy = w.ty - w.y;
            const d = Math.hypot(dx, dy);
            if (d < 0.06) {
                // pick a new target near a building or random tile
                if (Math.random() < 0.6) {
                    const b = LAYOUT[BUILDING_TYPES[Math.floor(Math.random() * BUILDING_TYPES.length)]];
                    w.tx = b.x + (Math.random() - 0.5);
                    w.ty = b.y + 1 + Math.random() * 0.6;
                }
                else {
                    w.tx = 0.5 + Math.random() * (GRID - 1);
                    w.ty = 0.5 + Math.random() * (GRID - 1);
                }
                w.pause = Math.random() * 1.4;
            }
            else {
                w.x += (dx / d) * w.speed * dt;
                w.y += (dy / d) * w.speed * dt;
            }
        }
        for (const c of this.coins) {
            c.life += dt;
            c.sy += c.vy * dt;
            c.vy += 60 * dt;
        }
        this.coins = this.coins.filter((c) => c.life < 1);
    }
    draw() {
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
        this.drawPlatform();
        this.drawFloor();
        // Painter's algorithm: buildings + workers sorted by depth (gx+gy).
        this.hitboxes = [];
        const items = [];
        for (const type of BUILDING_TYPES) {
            const b = LAYOUT[type];
            items.push({ depth: b.x + b.y, render: () => this.drawBuilding(type) });
        }
        for (const w of this.workers) {
            items.push({ depth: w.x + w.y - 0.01, render: () => this.drawWorker(w) });
        }
        items.sort((a, z) => a.depth - z.depth);
        for (const it of items)
            it.render();
        // Coins on top.
        for (const c of this.coins) {
            ctx.globalAlpha = Math.max(0, 1 - c.life);
            ctx.fillStyle = '#ffe08a';
            ctx.strokeStyle = '#b3801c';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(c.sx, c.sy, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
    /** Thick stone base under the floor for the "raised establishment" look. */
    drawPlatform() {
        const ctx = this.ctx;
        const depth = 16;
        const a = this.toScreen(0, 0, 0);
        const b = this.toScreen(GRID, 0, 0);
        const c = this.toScreen(GRID, GRID, 0);
        const d = this.toScreen(0, GRID, 0);
        // left & right thickness faces
        ctx.fillStyle = '#3b3340';
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(c.x, c.y + depth);
        ctx.lineTo(d.x, d.y + depth);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#2c2632';
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x, b.y + depth);
        ctx.lineTo(c.x, c.y + depth);
        ctx.closePath();
        ctx.fill();
        // base top edge highlight handled by floor tiles
        void a;
    }
    drawFloor() {
        const ctx = this.ctx;
        for (let gx = 0; gx < GRID; gx++) {
            for (let gy = 0; gy < GRID; gy++) {
                const top = this.toScreen(gx, gy, 0);
                const right = this.toScreen(gx + 1, gy, 0);
                const bottom = this.toScreen(gx + 1, gy + 1, 0);
                const left = this.toScreen(gx, gy + 1, 0);
                const checker = (gx + gy) % 2 === 0;
                ctx.fillStyle = checker ? '#7c6a52' : '#6f5e48';
                ctx.beginPath();
                ctx.moveTo(top.x, top.y);
                ctx.lineTo(right.x, right.y);
                ctx.lineTo(bottom.x, bottom.y);
                ctx.lineTo(left.x, left.y);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.12)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }
    drawBuilding(type) {
        const ctx = this.ctx;
        const b = LAYOUT[type];
        const pal = PALETTES[type];
        const h = this.heightOf(type);
        const sx = 0.9;
        const sy = 0.9;
        const built = this.levels[type] > 0;
        // ground shadow
        const sc = this.toScreen(b.x + sx / 2, b.y + sy / 2, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(sc.x, sc.y, TILE_W * 0.5, TILE_H * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        if (!built) {
            // Empty plot: a faint outline + a small sign so players know to build.
            const t0 = this.toScreen(b.x, b.y, 2), t1 = this.toScreen(b.x + sx, b.y, 2);
            const t2 = this.toScreen(b.x + sx, b.y + sy, 2), t3 = this.toScreen(b.x, b.y + sy, 2);
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(t0.x, t0.y);
            ctx.lineTo(t1.x, t1.y);
            ctx.lineTo(t2.x, t2.y);
            ctx.lineTo(t3.x, t3.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);
            this.label(sc.x, t0.y - 6, BUILDING_CONFIGS[type].icon);
            this.hitboxes.push({ type, poly: [t0, t1, t2, t3] });
            return;
        }
        // Prism faces
        const Tb = this.toScreen(b.x, b.y, h);
        const Tr = this.toScreen(b.x + sx, b.y, h);
        const Tf = this.toScreen(b.x + sx, b.y + sy, h);
        const Tl = this.toScreen(b.x, b.y + sy, h);
        const Br = this.toScreen(b.x + sx, b.y, 0);
        const Bf = this.toScreen(b.x + sx, b.y + sy, 0);
        const Bl = this.toScreen(b.x, b.y + sy, 0);
        // right face
        ctx.fillStyle = pal.right;
        ctx.beginPath();
        ctx.moveTo(Tr.x, Tr.y);
        ctx.lineTo(Tf.x, Tf.y);
        ctx.lineTo(Bf.x, Bf.y);
        ctx.lineTo(Br.x, Br.y);
        ctx.closePath();
        ctx.fill();
        // left face
        ctx.fillStyle = pal.left;
        ctx.beginPath();
        ctx.moveTo(Tl.x, Tl.y);
        ctx.lineTo(Tf.x, Tf.y);
        ctx.lineTo(Bf.x, Bf.y);
        ctx.lineTo(Bl.x, Bl.y);
        ctx.closePath();
        ctx.fill();
        // windows/door hints on the front-left face
        ctx.fillStyle = 'rgba(255,210,120,0.55)';
        const winRows = Math.min(3, 1 + Math.floor(this.levels[type] / 6));
        for (let r = 0; r < winRows; r++) {
            const wy = 0.3 + r * 0.28;
            const wp = this.toScreen(b.x + 0.5, b.y + sy, h - 6 - r * 8);
            ctx.fillRect(wp.x - 3, wp.y - 4, 6, 7);
            void wy;
        }
        // top face
        ctx.fillStyle = pal.top;
        ctx.beginPath();
        ctx.moveTo(Tb.x, Tb.y);
        ctx.lineTo(Tr.x, Tr.y);
        ctx.lineTo(Tf.x, Tf.y);
        ctx.lineTo(Tl.x, Tl.y);
        ctx.closePath();
        ctx.fill();
        // roof (a raised colored cap)
        const rh = h + 12;
        const Rb = this.toScreen(b.x + 0.18, b.y + 0.18, h);
        const Rr = this.toScreen(b.x + sx - 0.18, b.y + 0.18, h);
        const Rf = this.toScreen(b.x + sx - 0.18, b.y + sy - 0.18, h);
        const Rl = this.toScreen(b.x + 0.18, b.y + sy - 0.18, h);
        const Apex = this.toScreen(b.x + sx / 2, b.y + sy / 2, rh);
        ctx.fillStyle = pal.roofDark;
        ctx.beginPath();
        ctx.moveTo(Rr.x, Rr.y);
        ctx.lineTo(Rf.x, Rf.y);
        ctx.lineTo(Apex.x, Apex.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = pal.roof;
        ctx.beginPath();
        ctx.moveTo(Rb.x, Rb.y);
        ctx.lineTo(Rr.x, Rr.y);
        ctx.lineTo(Apex.x, Apex.y);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(Rl.x, Rl.y);
        ctx.lineTo(Rb.x, Rb.y);
        ctx.lineTo(Apex.x, Apex.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = pal.roofDark;
        ctx.beginPath();
        ctx.moveTo(Rf.x, Rf.y);
        ctx.lineTo(Rl.x, Rl.y);
        ctx.lineTo(Apex.x, Apex.y);
        ctx.closePath();
        ctx.fill();
        // floating icon banner above
        this.label(Apex.x, Apex.y - 12, BUILDING_CONFIGS[type].icon);
        // level pip
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.arc(Apex.x + 12, Apex.y - 10, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe08a';
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(this.levels[type]), Apex.x + 12, Apex.y - 9);
        this.hitboxes.push({ type, poly: [Tb, Tr, Tf, Tl] });
    }
    drawWorker(w) {
        const ctx = this.ctx;
        const p = this.toScreen(w.x, w.y, 0);
        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // little bobbing walk
        const bob = w.pause > 0 ? 0 : Math.sin(this.t * 9 + w.x * 3) * 1.2;
        const bx = p.x, by = p.y - 9 + bob;
        // body
        ctx.fillStyle = w.hue;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        roundRectPath(ctx, bx - 3.2, by - 4, 6.4, 9, 2.4);
        ctx.fill();
        ctx.stroke();
        // head
        ctx.fillStyle = '#f1d3a8';
        ctx.beginPath();
        ctx.arc(bx, by - 7, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    label(x, y, text) {
        const ctx = this.ctx;
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
    }
    handleTap(e) {
        const rect = this.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        // Topmost first (drawn last = highest depth): iterate reversed.
        for (let i = this.hitboxes.length - 1; i >= 0; i--) {
            if (pointInPoly(px, py, this.hitboxes[i].poly)) {
                this.onTapBuilding(this.hitboxes[i].type);
                return;
            }
        }
    }
}
/** Rounded-rect path with a fallback for engines without ctx.roundRect. */
function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > py) !== (b.y > py) &&
            px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}
