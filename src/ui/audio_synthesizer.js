// ──────────────────────────────────────────────────────────────────────────────
// SIMT-Flow: Web Audio API Tactile Sound Synthesizer
// ──────────────────────────────────────────────────────────────────────────────
// Generates subtle, realistic tactile audio cues (mechanical relay clicks,
// clock pulses, hazard warning tones, warp switch chirps, verification fanfare)
// entirely using the browser's native Web Audio API — zero external files needed.
// ──────────────────────────────────────────────────────────────────────────────

export class AudioSynthesizer {
    constructor() {
        this.ctx = null;
        this.enabled = false; // Default off, toggleable via header button
        this.volume = 0.15;   // Subtle, non-intrusive volume

        // Restore user preference if stored
        try {
            const saved = localStorage.getItem('simt_flow_audio');
            if (saved !== null) {
                this.enabled = saved === 'true';
            }
        } catch (e) {
            // Ignore localStorage errors in private windows
        }
    }

    _initContext() {
        if (!this.ctx && typeof window !== 'undefined') {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.enabled) {
            this._initContext();
            this.playClick();
        }
        try {
            localStorage.setItem('simt_flow_audio', String(this.enabled));
        } catch (e) {}
        return this.enabled;
    }

    /**
     * Subtle mechanical relay click for clock step forward.
     */
    playClick() {
        if (!this.enabled) return;
        this._initContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Very short high-frequency transient click (relay snap)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.025);

        gain.gain.setValueAtTime(this.volume * 0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.025);
    }

    /**
     * Subtle reverse acoustic sweep for rewind step backward.
     */
    playRewind() {
        if (!this.enabled) return;
        this._initContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(250, now);
        osc.frequency.exponentialRampToValueAtTime(900, now + 0.035);

        gain.gain.setValueAtTime(this.volume * 0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.035);
    }

    /**
     * Soft dual-tone acoustic warning on pipeline stall or hazard.
     */
    playHazard() {
        if (!this.enabled) return;
        this._initContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(330, now + 0.04);

        gain.gain.setValueAtTime(this.volume * 0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.09);
    }

    /**
     * High-tech harmonic chord on verification suite pass.
     */
    playFanfare() {
        if (!this.enabled) return;
        this._initContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const startTime = now + idx * 0.06;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(this.volume * 0.5, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(startTime);
            osc.stop(startTime + 0.35);
        });
    }
}
