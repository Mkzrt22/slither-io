/**
 * sfx.ts — Tiny synthesized sound effects (WebAudio, no assets).
 *
 * All sounds are generated on the fly with oscillators, so nothing ships in
 * the bundle and it works offline. The context is created lazily and resumed
 * on the first user gesture (mobile autoplay policy). A persisted mute flag
 * silences everything.
 */
const MUTE_KEY = 'ldt_muted';
export class Sfx {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.muted = (() => {
            try {
                return localStorage.getItem(MUTE_KEY) === '1';
            }
            catch {
                return false;
            }
        })();
    }
    /** Lazily creates/resumes the audio graph (call from a user gesture). */
    unlock() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended')
                void this.ctx.resume();
            return;
        }
        try {
            const Ctor = window.AudioContext ||
                window.webkitAudioContext;
            this.ctx = new Ctor();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.22;
            this.master.connect(this.ctx.destination);
        }
        catch {
            this.ctx = null;
        }
    }
    isMuted() { return this.muted; }
    setMuted(muted) {
        this.muted = muted;
        try {
            localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
        }
        catch { /* ignore */ }
    }
    tone(freq, dur, type, when = 0, gain = 1) {
        if (this.muted || !this.ctx || !this.master)
            return;
        const t0 = this.ctx.currentTime + when;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }
    /** Soft tick for taps/clicks. */
    click() { this.tone(420, 0.06, 'triangle', 0, 0.5); }
    /** Coin chime for income/upgrade. */
    coin() {
        this.tone(880, 0.08, 'square', 0, 0.5);
        this.tone(1320, 0.1, 'square', 0.05, 0.4);
    }
    /** Rising flourish for a building upgrade. */
    upgrade() {
        this.tone(523, 0.09, 'triangle', 0, 0.6);
        this.tone(659, 0.09, 'triangle', 0.07, 0.6);
        this.tone(784, 0.12, 'triangle', 0.14, 0.6);
    }
    /** Celebratory arpeggio for jackpots / village advances. */
    jackpot() {
        const notes = [523, 659, 784, 1047, 1319];
        notes.forEach((f, i) => this.tone(f, 0.16, 'square', i * 0.08, 0.5));
    }
    /** Low buzz for an error / not enough gold. */
    error() { this.tone(160, 0.18, 'sawtooth', 0, 0.4); }
}
