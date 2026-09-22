/**
 * Thin wrapper around Web Audio API for buffer playback.
 * Supports full-file playback and segment (chapter) preview, with optional
 * fade in/out gain curves for chapter audition.
 */

/** Playback segment gain envelope (seconds, relative to the segment start). */
export interface PlayEnvelope {
  fadeInSec: number;
  fadeOutSec: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** per-source node carrying the fade curve */
  private sourceGain: GainNode | null = null;
  private master: GainNode | null = null;
  /** ctx.currentTime at which playback started */
  private startedAt = 0;
  /** buffer offset at which playback started */
  private offset = 0;
  private stopAt: number | null = null;
  private stopTimer: number | null = null;
  playing = false;
  onEnded: (() => void) | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  async decode(file: File): Promise<AudioBuffer> {
    const ctx = this.ensureCtx();
    const data = await file.arrayBuffer();
    this.stop();
    this.buffer = await ctx.decodeAudioData(data);
    return this.buffer;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get hasBuffer(): boolean {
    return this.buffer !== null;
  }

  /** Current playback position in seconds (buffer timeline). */
  getTime(): number {
    if (!this.playing || !this.ctx) return this.offset;
    const t = this.offset + (this.ctx.currentTime - this.startedAt);
    return Math.min(t, this.duration);
  }

  /**
   * Play the buffer from `from`. When `to` is given the source is scheduled to
   * stop there (segment / chapter preview). `envelope` schedules a gain curve
   * on a fresh per-source GainNode: fade-in rises from silence and fade-out
   * falls back to silence before `to`. Every call stops and disconnects the
   * previous source first, so sounds can never overlap or linger.
   */
  play(from: number, to?: number, envelope?: PlayEnvelope): void {
    if (!this.buffer) return;
    const ctx = this.ensureCtx();
    this.stopSource();
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(this.master!);
    const dur = this.buffer.duration;
    const start = Math.max(0, Math.min(from, dur));
    this.offset = start;
    this.startedAt = ctx.currentTime;
    this.stopAt = to !== undefined ? Math.min(to, dur) : null;

    this.scheduleEnvelope(gain, ctx.currentTime, start, envelope);

    source.onended = () => {
      // onended also fires on manual stop(); guard with playing flag
      if (this.playing) {
        this.playing = false;
        this.offset = this.stopAt ?? this.offset;
        this.clearTimer();
        this.onEnded?.();
      }
    };

    if (this.stopAt !== null && this.stopAt > start) {
      source.start(0, start, this.stopAt - start);
    } else {
      source.start(0, start);
    }
    this.source = source;
    this.sourceGain = gain;
    this.playing = true;
  }

  /**
   * Schedule the fade curve using explicit timestamps. All breakpoints stay
   * inside [t0, t0 + segLen], so the curve never ramps past the segment end.
   */
  private scheduleEnvelope(
    gain: GainNode,
    t0: number,
    start: number,
    envelope: PlayEnvelope | undefined,
  ): void {
    const param = gain.gain;
    param.cancelScheduledValues(t0);
    if (!envelope || this.stopAt === null) {
      param.setValueAtTime(1, t0);
      return;
    }
    const segLen = this.stopAt - start;
    if (!(segLen > 0)) {
      param.setValueAtTime(1, t0);
      return;
    }
    const fadeIn = Math.max(0, Math.min(envelope.fadeInSec, segLen));
    const fadeOut = Math.max(0, Math.min(envelope.fadeOutSec, segLen));

    if (fadeIn > 0) {
      param.setValueAtTime(0, t0);
      param.linearRampToValueAtTime(1, t0 + fadeIn);
    } else {
      param.setValueAtTime(1, t0);
    }
    if (fadeOut > 0) {
      // Hold unity until the fade-out starts (keeps the curve continuous).
      param.setValueAtTime(1, t0 + segLen - fadeOut);
      param.linearRampToValueAtTime(0, t0 + segLen);
    }
  }

  pause(): number {
    const t = this.getTime();
    this.stop();
    this.offset = t;
    return t;
  }

  stop(): void {
    this.playing = false;
    this.stopSource();
    this.clearTimer();
  }

  private stopSource(): void {
    if (this.source) {
      const s = this.source;
      const g = this.sourceGain;
      this.source = null;
      this.sourceGain = null;
      this.playing = false;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
      if (g) g.disconnect();
    }
  }

  private clearTimer(): void {
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
