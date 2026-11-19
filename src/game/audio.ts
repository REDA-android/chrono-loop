/**
 * Procedural WebAudio synthesizer for CHRONO LOOP (zero external audio files, 100% CSP-safe).
 */
export class ChronoAudio {
  private ctx: AudioContext | null = null;
  private muted = false;

  public unlock(): void {
    if (this.muted) return;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (!this.muted) this.unlock();
    return this.muted;
  }

  private playTone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = 'sine',
    gainPeak = 0.12,
    delay = 0
  ): void {
    if (this.muted || !this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playPlateOn(): void {
    this.playTone(440, 660, 0.16, 'triangle', 0.13);
    this.playTone(880, 1100, 0.18, 'sine', 0.08, 0.04);
  }

  public playShard(): void {
    this.playTone(784, 1175, 0.12, 'sine', 0.12);
    this.playTone(1175, 1568, 0.16, 'triangle', 0.09, 0.06);
  }

  public playLaserBlock(): void {
    this.playTone(220, 310, 0.1, 'sawtooth', 0.05);
  }

  public playRewind(): void {
    this.playTone(620, 180, 0.24, 'sawtooth', 0.09);
    this.playTone(340, 880, 0.26, 'triangle', 0.1, 0.12);
  }

  public playTick(urgent = false): void {
    this.playTone(urgent ? 980 : 620, urgent ? 980 : 620, 0.05, 'sine', urgent ? 0.08 : 0.04);
  }

  public playFail(): void {
    this.playTone(260, 90, 0.34, 'sawtooth', 0.13);
    this.playTone(190, 75, 0.36, 'triangle', 0.1, 0.08);
  }

  public playVictory(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.playTone(n, n, 0.32, 'triangle', 0.12, i * 0.08);
      this.playTone(n * 2, n * 2, 0.28, 'sine', 0.05, i * 0.08 + 0.02);
    });
  }
}
