import {
  MAX_FADE_SEC,
  clampFadeSec,
  fadeGain,
  resolveChapterFade,
  resolveFade,
  DEFAULT_FADE,
} from '../src/audio/fade';

let failures = 0;
function near(actual: number, expected: number, msg: string, tol = 1e-9) {
  if (Math.abs(actual - expected) > tol) {
    failures++;
    console.error(`FAIL ${msg}: expected ~${expected}, got ${actual}`);
  } else {
    console.log(`ok ${msg}`);
  }
}
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${msg}: expected ${e}, got ${a}`);
  } else {
    console.log(`ok ${msg}`);
  }
}

// --- clamp ---
near(clampFadeSec(2), 2, 'clamp keeps in range');
near(clampFadeSec(-1), 0, 'clamp negatives to 0');
near(clampFadeSec(9), MAX_FADE_SEC, 'clamp to 5s max');
near(clampFadeSec(NaN), 0, 'clamp NaN to 0');
near(clampFadeSec(Infinity), MAX_FADE_SEC, 'clamp Infinity to 5');

// --- no compression ---
{
  const r = resolveFade(10, 2, 3);
  near(r.fadeInSec, 2, 'no compression keeps fade-in');
  near(r.fadeOutSec, 3, 'no compression keeps fade-out');
  eq(r.compressed, false, 'compressed flag false');
}
// --- sum exactly equals segment: no compression ---
{
  const r = resolveFade(5, 2, 3);
  near(r.fadeInSec, 2, 'exact fit fade-in');
  near(r.fadeOutSec, 3, 'exact fit fade-out');
  eq(r.compressed, false, 'exact fit not compressed');
}
// --- sum exceeds segment: proportional compression tiles the segment ---
{
  const r = resolveFade(4, 3, 5);
  eq(r.compressed, true, 'overlong compressed flag');
  near(r.fadeInSec, 1.5, 'compressed fade-in (3 * 4/8)');
  near(r.fadeOutSec, 2.5, 'compressed fade-out (5 * 4/8)');
  near(r.fadeInSec + r.fadeOutSec, 4, 'compressed fades tile segment exactly');
}
// --- one side zero, the other compressed to full segment ---
{
  const r = resolveFade(2, 5, 0);
  near(r.fadeInSec, 2, 'only fade-in compressed to segment');
  near(r.fadeOutSec, 0, 'zero fade-out stays zero');
  near(r.fadeInSec + r.fadeOutSec, 2, 'tiles segment');
}
// --- zero / negative segment yields zero fades ---
eq(resolveFade(0, 1, 1), { fadeInSec: 0, fadeOutSec: 0, compressed: false }, 'zero segment');
eq(resolveFade(-3, 1, 1), { fadeInSec: 0, fadeOutSec: 0, compressed: false }, 'negative segment');
{
  const r = resolveFade(10, Infinity, Infinity);
  eq(
    { fadeInSec: r.fadeInSec, fadeOutSec: r.fadeOutSec, compressed: r.compressed },
    { fadeInSec: 5, fadeOutSec: 5, compressed: false },
    'infinite requests clamp to 5s',
  );
  const r2 = resolveFade(4, Infinity, Infinity);
  near(r2.fadeInSec + r2.fadeOutSec, 4, 'infinite overlong compresses without NaN');
}

// --- switch off -> null ---
eq(resolveChapterFade(10, DEFAULT_FADE), null, 'disabled fade resolves null');
eq(resolveChapterFade(10, { enabled: true, fadeInSec: 0, fadeOutSec: 0 }), {
  fadeInSec: 0,
  fadeOutSec: 0,
  compressed: false,
}, 'enabled zero fades resolves envelope');
eq(resolveChapterFade(10, undefined), null, 'missing fade resolves null');

// --- gain curve: fade in/out within bounds ---
{
  // segment 10s, fade-in 2s, fade-out 3s
  near(fadeGain(-1, 10, 2, 3), 0, 'before start is silence');
  near(fadeGain(0, 10, 2, 3), 0, 'start at silence');
  near(fadeGain(1, 10, 2, 3), 0.5, 'fade-in midpoint');
  near(fadeGain(2, 10, 2, 3), 1, 'fade-in reaches unity');
  near(fadeGain(5, 10, 2, 3), 1, 'middle stays unity');
  near(fadeGain(7, 10, 2, 3), 1, 'fade-out start at unity');
  near(fadeGain(8.5, 10, 2, 3), 0.5, 'fade-out midpoint');
  near(fadeGain(10, 10, 2, 3), 0, 'segment end at silence');
  near(fadeGain(11, 10, 2, 3), 0, 'beyond end stays silence');
}
// --- no fades: unity everywhere ---
near(fadeGain(0, 10, 0, 0), 1, 'no fades start unity');
near(fadeGain(10, 10, 0, 0), 1, 'no fades end unity');

// --- compressed case: continuous, no jump, never outside [0, 1] ---
{
  const seg = 4;
  const r = resolveFade(seg, 3, 5); // in 1.5, out 2.5, they meet at t=1.5
  near(fadeGain(0, seg, r.fadeInSec, r.fadeOutSec), 0, 'compressed start silence');
  near(fadeGain(r.fadeInSec, seg, r.fadeInSec, r.fadeOutSec), 1, 'junction reaches unity');
  near(
    fadeGain(seg - r.fadeOutSec, seg, r.fadeInSec, r.fadeOutSec),
    1,
    'junction starts fade-out at unity (no jump)',
  );
  near(fadeGain(seg, seg, r.fadeInSec, r.fadeOutSec), 0, 'compressed end silence');
  // sample the whole curve: bounded and monotonic in each leg
  let prev = 0;
  for (let i = 0; i <= 400; i++) {
    const t = (i / 400) * seg;
    const g = fadeGain(t, seg, r.fadeInSec, r.fadeOutSec);
    if (g < -1e-12 || g > 1 + 1e-12) {
      failures++;
      console.error(`FAIL curve out of range at ${t}: ${g}`);
    }
    if (t <= r.fadeInSec && g + 1e-9 < prev) {
      failures++;
      console.error(`FAIL fade-in not monotonic at ${t}`);
    }
    if (t >= seg - r.fadeOutSec + 1e-12 && i > 0 && g > prev + 1e-9) {
      failures++;
      console.error(`FAIL fade-out not monotonic at ${t}`);
    }
    prev = g;
  }
  console.log('ok compressed curve bounded and monotonic');
}
// --- gain never leaves the segment window for random fades ---
{
  let ok = true;
  for (let trial = 0; trial < 200; trial++) {
    const seg = 0.01 + Math.random() * 12;
    const reqIn = Math.random() * 5;
    const reqOut = Math.random() * 5;
    const r = resolveFade(seg, reqIn, reqOut);
    if (r.fadeInSec < -1e-12 || r.fadeOutSec < -1e-12 || r.fadeInSec + r.fadeOutSec > seg + 1e-9) {
      ok = false;
    }
    if (fadeGain(-0.001, seg, r.fadeInSec, r.fadeOutSec) !== (r.fadeInSec > 0 ? 0 : 1)) ok = false;
    if (fadeGain(seg + 0.001, seg, r.fadeInSec, r.fadeOutSec) !== (r.fadeOutSec > 0 ? 0 : 1)) {
      ok = false;
    }
  }
  if (!ok) {
    failures++;
    console.error('FAIL randomized bounds check');
  } else {
    console.log('ok randomized fades stay inside segment boundaries');
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
