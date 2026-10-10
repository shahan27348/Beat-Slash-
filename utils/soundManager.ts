/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.8;

  private init(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        return null;
      }
      // Compressor keeps stacked hit sounds from clipping.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Call from a user gesture so later sounds aren't blocked by autoplay policy. */
  unlock() { this.init(); }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private tone(freq: number, type: OscillatorType, start: number, duration: number, gain: number, endFreq?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private noiseBurst(start: number, duration: number, gain: number, filterType: BiquadFilterType, fromHz: number, toHz: number, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(fromHz, start);
    filter.frequency.exponentialRampToValueAtTime(toHz, start + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master!);
    src.start(start, Math.random() * 0.3);
    src.stop(start + duration + 0.02);
  }

  /** Saber slicing through a note. Brighter for better cuts. */
  playHit(judgement: 'perfect' | 'great' | 'good' = 'great') {
    if (!this.init()) return;
    const t = this.ctx!.currentTime;
    // Whoosh + crack
    this.noiseBurst(t, 0.12, 0.35, 'bandpass', 5000, 900, 0.8);
    this.tone(180, 'sine', t, 0.09, 0.35, 60); // body thump
    if (judgement === 'perfect') {
      this.tone(1320, 'sine', t, 0.18, 0.12);
      this.tone(1980, 'sine', t + 0.01, 0.16, 0.06);
    } else if (judgement === 'great') {
      this.tone(990, 'sine', t, 0.12, 0.08);
    }
  }

  playMiss() {
    if (!this.init()) return;
    const t = this.ctx!.currentTime;
    this.tone(140, 'triangle', t, 0.22, 0.25, 70);
    this.noiseBurst(t, 0.15, 0.12, 'lowpass', 600, 150);
  }

  playCombo(level: number) {
    if (!this.init()) return;
    const t = this.ctx!.currentTime;
    const base = 520 * Math.pow(1.122, level);
    [1, 1.25, 1.5, 2].forEach((m, i) => this.tone(base * m, 'triangle', t + i * 0.05, 0.18, 0.1));
  }

  playUi() {
    if (!this.init()) return;
    const t = this.ctx!.currentTime;
    this.tone(880, 'sine', t, 0.06, 0.12);
    this.tone(1320, 'sine', t + 0.03, 0.08, 0.08);
  }

  playCountdownBeep(freq: number = 440) {
    if (!this.init()) return;
    this.tone(freq, 'sine', this.ctx!.currentTime, 0.18, 0.25);
  }

  playGo() {
    if (!this.init()) return;
    const t = this.ctx!.currentTime;
    this.tone(880, 'square', t, 0.25, 0.12);
    this.tone(1320, 'sine', t, 0.3, 0.15);
  }

  playVictory() {
    if (!this.init()) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.13, 0.4, 0.18));
  }

  playDefeat() {
    if (!this.init()) return;
    const t = this.ctx!.currentTime;
    [400, 350, 300, 200].forEach((f, i) => this.tone(f, 'sawtooth', t + i * 0.18, 0.35, 0.08));
  }
}

export const soundManager = new SoundManager();
