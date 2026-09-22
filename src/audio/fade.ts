/**
 * Preview-only fade in/out gain curves for chapter audition.
 *
 * These settings live in the workbench UI only: they are not stored on the
 * chapter data nor included in any export (WebVTT / JSON stay unchanged).
 *
 * The functions here are pure and covered by scripts/test-fade.ts.
 */

/** Max configurable fade duration in seconds (UI range 0–5s). */
export const MAX_FADE_SEC = 5;

/** Per-chapter audition fade settings. */
export interface ChapterFade {
  enabled: boolean;
  /** fade-in time at the chapter start, seconds (0–5) */
  fadeInSec: number;
  /** fade-out time before the chapter end, seconds (0–5) */
  fadeOutSec: number;
}

export const DEFAULT_FADE: ChapterFade = {
  enabled: false,
  fadeInSec: 1,
  fadeOutSec: 1,
};

/** Clamp a requested fade duration to the allowed 0–5s range. */
export function clampFadeSec(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(MAX_FADE_SEC, Math.max(0, v));
}

export interface ResolvedFade {
  /** actual fade-in duration used for the playback segment */
  fadeInSec: number;
  /** actual fade-out duration used for the playback segment */
  fadeOutSec: number;
  /** true when the request exceeded the segment and was compressed */
  compressed: boolean;
}

/**
 * Resolve the actual fade durations for a segment of `segmentSec`.
 *
 * Requests are clamped to [0, 5]. When fade-in + fade-out exceed the segment
 * length, both are scaled by the same factor so they exactly tile the segment
 * (they never overlap each other and never cross the segment boundaries).
 *
 * @param segmentSec actual playback interval length (e.g. chapter end - start)
 */
export function resolveFade(
  segmentSec: number,
  reqInSec: number,
  reqOutSec: number,
): ResolvedFade {
  const fadeInSec = Number.isFinite(reqInSec) ? clampFadeSec(reqInSec) : MAX_FADE_SEC;
  const fadeOutSec = Number.isFinite(reqOutSec) ? clampFadeSec(reqOutSec) : MAX_FADE_SEC;
  if (!(segmentSec > 0)) return { fadeInSec: 0, fadeOutSec: 0, compressed: false };
  const sum = fadeInSec + fadeOutSec;
  if (sum === 0 || sum <= segmentSec) {
    return { fadeInSec, fadeOutSec, compressed: false };
  }
  const scale = segmentSec / sum;
  return {
    fadeInSec: fadeInSec * scale,
    fadeOutSec: fadeOutSec * scale,
    compressed: true,
  };
}

/** Resolve settings for a chapter preview; null when the switch is off. */
export function resolveChapterFade(
  segmentSec: number,
  fade: ChapterFade | null | undefined,
): ResolvedFade | null {
  if (!fade?.enabled) return null;
  return resolveFade(segmentSec, fade.fadeInSec, fade.fadeOutSec);
}

/**
 * Linear gain at time `t` (seconds from the segment start) for a resolved
 * envelope: silence → linear ramp up to unity → linear ramp down to silence.
 *
 * The curve is continuous — including the compressed case where fade-in end
 * equals fade-out start at gain 1 — so it can never produce a jump.
 */
export function fadeGain(
  t: number,
  segmentSec: number,
  fadeInSec: number,
  fadeOutSec: number,
): number {
  if (!(segmentSec > 0)) return 1;
  if (t <= 0) return fadeInSec > 0 ? 0 : 1;
  if (t >= segmentSec) return fadeOutSec > 0 ? 0 : 1;
  if (fadeInSec > 0 && t < fadeInSec) return t / fadeInSec;
  if (fadeOutSec > 0 && t > segmentSec - fadeOutSec) {
    return (segmentSec - t) / fadeOutSec;
  }
  return 1;
}
