/**
 * effects.ts — Visual juice layer (Lucky Dungeon Tycoon).
 *
 * Pure presentation helpers with no game knowledge: a canvas particle system
 * (coins, confetti, sparks, floating numbers), eased number counters, and the
 * animated slot-reel controller. Everything here is cosmetic — the model is
 * authoritative and never waits on these.
 */
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const CONFETTI_COLORS = ['#f6c244', '#5fd4f5', '#6fe08a', '#f06d6d', '#c08af5', '#ffffff'];
export class ParticleSystem {
    constructor(canvas) {
        this.canvas = canvas;
        this.particles = [];
        this.raf = 0;
        this.last = 0;
        this.dpr = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('2D canvas context unavailable');
        }
        this.ctx = ctx;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }
    /** Matches the backing store to the CSS size and device pixel ratio. */
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
        this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    cssSize() {
        return {
            w: this.canvas.width / this.dpr,
            h: this.canvas.height / this.dpr,
        };
    }
    /** Fountain of coins bursting upward from (x, y). */
    burstCoins(x, y, count) {
        for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
            const speed = 180 + Math.random() * 260;
            this.particles.push({
                kind: 'coin',
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: 720,
                life: 0,
                maxLife: 1.1 + Math.random() * 0.5,
                size: 9 + Math.random() * 7,
                rot: Math.random() * Math.PI,
                vrot: (Math.random() - 0.5) * 12,
                color: '#f6c244',
            });
        }
        this.ensureRunning();
    }
    /** Gem shower (cooler palette) for premium wins. */
    burstGems(x, y, count) {
        for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
            const speed = 160 + Math.random() * 240;
            this.particles.push({
                kind: 'gem',
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: 640,
                life: 0,
                maxLife: 1.2 + Math.random() * 0.5,
                size: 9 + Math.random() * 6,
                rot: Math.random() * Math.PI,
                vrot: (Math.random() - 0.5) * 10,
                color: '#5fd4f5',
            });
        }
        this.ensureRunning();
    }
    /** Full-width confetti rain for jackpots. */
    confetti(count) {
        const { w } = this.cssSize();
        for (let i = 0; i < count; i++) {
            this.particles.push({
                kind: 'confetti',
                x: Math.random() * w,
                y: -20 - Math.random() * 60,
                vx: (Math.random() - 0.5) * 120,
                vy: 120 + Math.random() * 160,
                gravity: 60,
                life: 0,
                maxLife: 2.4 + Math.random() * 1.2,
                size: 6 + Math.random() * 7,
                rot: Math.random() * Math.PI,
                vrot: (Math.random() - 0.5) * 16,
                color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            });
        }
        this.ensureRunning();
    }
    /** Quick burst of sparks (e.g. on a boss hit). */
    sparks(x, y, count, color = '#fff3c4') {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 120 + Math.random() * 260;
            this.particles.push({
                kind: 'spark',
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: 240,
                life: 0,
                maxLife: 0.45 + Math.random() * 0.4,
                size: 2 + Math.random() * 3,
                rot: 0,
                vrot: 0,
                color,
            });
        }
        this.ensureRunning();
    }
    /** A rising, fading number/word above the scene. */
    floatText(x, y, text, color, big = false) {
        this.particles.push({
            kind: 'text',
            x,
            y,
            vx: (Math.random() - 0.5) * 24,
            vy: -70,
            gravity: 0,
            life: 0,
            maxLife: 1.3,
            size: big ? 30 : 19,
            rot: 0,
            vrot: 0,
            color,
            text,
            fontWeight: big ? 800 : 700,
        });
        this.ensureRunning();
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
        const ctx = this.ctx;
        const { w, h } = this.cssSize();
        ctx.clearRect(0, 0, w, h);
        for (const p of this.particles) {
            p.life += dt;
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vrot * dt;
            const k = p.life / p.maxLife;
            const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
            ctx.globalAlpha = Math.max(0, alpha);
            switch (p.kind) {
                case 'coin':
                case 'gem':
                    this.drawCoin(p);
                    break;
                case 'confetti':
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rot);
                    ctx.fillStyle = p.color;
                    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                    ctx.restore();
                    break;
                case 'spark':
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                case 'text':
                    ctx.font = `${p.fontWeight ?? 700} ${p.size}px "Segoe UI", system-ui, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.lineWidth = 4;
                    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                    ctx.strokeText(p.text ?? '', p.x, p.y);
                    ctx.fillStyle = p.color;
                    ctx.fillText(p.text ?? '', p.x, p.y);
                    break;
            }
        }
        ctx.globalAlpha = 1;
        this.particles = this.particles.filter((p) => p.life < p.maxLife);
        if (this.particles.length > 0) {
            this.raf = requestAnimationFrame((t) => this.loop(t));
        }
        else {
            this.raf = 0;
            ctx.clearRect(0, 0, w, h);
        }
    }
    drawCoin(p) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // Squash horizontally to fake a spinning disc.
        const squash = Math.abs(Math.cos(p.rot));
        ctx.scale(0.35 + 0.65 * squash, 1);
        const grad = ctx.createRadialGradient(-p.size * 0.3, -p.size * 0.3, 1, 0, 0, p.size);
        if (p.kind === 'gem') {
            grad.addColorStop(0, '#bfefff');
            grad.addColorStop(1, '#2aa3c9');
        }
        else {
            grad.addColorStop(0, '#fff0bd');
            grad.addColorStop(1, '#d79a26');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = p.kind === 'gem' ? '#1d7d9e' : '#a9741a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }
}
// ---------------------------------------------------------------------------
// Eased number counter
// ---------------------------------------------------------------------------
export class NumberTween {
    constructor(el, format, initial) {
        this.el = el;
        this.format = format;
        this.raf = 0;
        this.startVal = 0;
        this.startTime = 0;
        this.duration = 520;
        this.displayed = initial;
        this.target = initial;
        el.textContent = format(initial);
    }
    /** Eases toward `value`; pass animate=false to snap instantly. */
    set(value, animate = true) {
        if (value === this.target) {
            return;
        }
        this.target = value;
        if (!animate) {
            this.displayed = value;
            this.el.textContent = this.format(value);
            return;
        }
        this.startVal = this.displayed;
        this.startTime = performance.now();
        if (this.raf === 0) {
            this.raf = requestAnimationFrame((t) => this.step(t));
        }
    }
    step(now) {
        const k = Math.min(1, (now - this.startTime) / this.duration);
        this.displayed = this.startVal + (this.target - this.startVal) * easeOutCubic(k);
        this.el.textContent = this.format(this.displayed);
        if (k < 1) {
            this.raf = requestAnimationFrame((t) => this.step(t));
        }
        else {
            this.displayed = this.target;
            this.el.textContent = this.format(this.target);
            this.raf = 0;
        }
    }
}
// ---------------------------------------------------------------------------
// Animated slot reels
// ---------------------------------------------------------------------------
const ALL_SYMBOLS = ['COIN', 'BAG', 'GEM', 'SHIELD', 'SWORD', 'SKULL'];
export class SlotReels {
    /**
     * @param container element holding exactly three `.reel-col > .reel-strip`.
     * @param cellHtml  renders one symbol cell's inner HTML.
     * @param cellPx    height of a single symbol cell in CSS pixels.
     */
    constructor(container, cellHtml, cellPx) {
        this.cellHtml = cellHtml;
        this.cellPx = cellPx;
        this.spinSeq = 0;
        this.cols = Array.from(container.querySelectorAll('.reel-col'));
        this.strips = this.cols.map((c) => c.querySelector('.reel-strip'));
        for (let i = 0; i < this.strips.length; i++) {
            this.renderStrip(i, this.randomCells(6, ALL_SYMBOLS[i % ALL_SYMBOLS.length]));
        }
    }
    randomCells(n, last) {
        const cells = [];
        for (let i = 0; i < n - 1; i++) {
            cells.push(ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)]);
        }
        cells.push(last);
        return cells;
    }
    renderStrip(i, cells) {
        const strip = this.strips[i];
        strip.style.transition = 'none';
        strip.style.transform = 'translateY(0)';
        strip.innerHTML = cells
            .map((s) => `<div class="reel-cell" style="height:${this.cellPx}px">${this.cellHtml(s)}</div>`)
            .join('');
    }
    /**
     * Spins all three reels to land on `target`, staggered. Resolves when the
     * last reel settles. Calls `onLand(reelIndex)` as each reel stops.
     */
    spinTo(target, onLand) {
        const seq = ++this.spinSeq;
        const spins = [22, 26, 30]; // cells scrolled per reel
        const baseDur = 850;
        const promises = this.strips.map((strip, i) => {
            return new Promise((resolve) => {
                const cellsBefore = spins[i];
                const cells = [];
                for (let c = 0; c < cellsBefore; c++) {
                    cells.push(ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)]);
                }
                cells.push(target[i]);
                this.renderStrip(i, cells);
                strip.parentElement?.classList.add('reel-spinning');
                const endY = -(cells.length - 1) * this.cellPx;
                const dur = baseDur + i * 220;
                // Next frame: animate to the landing position.
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (seq !== this.spinSeq) {
                            resolve();
                            return;
                        }
                        strip.style.transition = `transform ${dur}ms cubic-bezier(0.12, 0.7, 0.18, 1)`;
                        strip.style.transform = `translateY(${endY}px)`;
                        const done = () => {
                            strip.removeEventListener('transitionend', done);
                            strip.parentElement?.classList.remove('reel-spinning');
                            strip.parentElement?.classList.add('reel-land');
                            setTimeout(() => strip.parentElement?.classList.remove('reel-land'), 260);
                            if (seq === this.spinSeq) {
                                onLand(i);
                            }
                            resolve();
                        };
                        strip.addEventListener('transitionend', done);
                        // Safety timeout in case transitionend is missed.
                        setTimeout(done, dur + 120);
                    });
                });
            });
        });
        return Promise.all(promises).then(() => undefined);
    }
}
