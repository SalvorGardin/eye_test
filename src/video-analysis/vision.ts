export type Eye = 'left' | 'right';
export type Point = { x: number; y: number; z?: number };
export type EyeSignal = { x: number; y: number; open: number; center: Point; width: number };
export type Baseline = { left: EyeSignal; right: EyeSignal; yaw: number; pitch: number };
export type Observation = {
  at: number;
  valid: boolean;
  reason: string;
  covered: Record<Eye, boolean | null>;
  gaze: boolean | null;
  signals: Baseline | null;
};

// ponytail: coarse screen-gaze/hand-over-eye heuristics; tune on real iPads before replacing with a trained classifier.
export const LIMITS = { gazeX: 0.24, gazeY: 0.18, yaw: 0.24, pitch: 0.19, eyeOpen: 0.075, staleMs: 750 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function inside(p: Point, polygon: Point[]) {
  if (polygon.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const value = cross(polygon[i], polygon[(i + 1) % polygon.length], p);
    if (Math.abs(value) < 1e-9) continue;
    if (sign && Math.sign(value) !== sign) return false;
    sign = Math.sign(value);
  }
  return true;
}

function eyeSignal(face: Point[], eye: Eye): EyeSignal {
  const [ai, bi, top, bottom, iris] = eye === 'left' ? [362, 263, 386, 374, 473] : [33, 133, 159, 145, 468];
  const [a, b] = [face[ai], face[bi]].sort((a, b) => a.x - b.x);
  const width = distance(a, b);
  const ux = (b.x - a.x) / width, uy = (b.y - a.y) / width;
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const p = face[iris];
  return {
    center, width,
    x: ((p.x - a.x) * ux + (p.y - a.y) * uy) / width,
    y: (-(p.x - center.x) * uy + (p.y - center.y) * ux) / width,
    open: distance(face[top], face[bottom]) / width,
  };
}

export function unknown(at: number, reason = 'Расположите лицо перед камерой'): Observation {
  return { at, valid: false, reason, covered: { left: null, right: null }, gaze: null, signals: null };
}

export function observe(faces: Point[][], hands: Point[][], at: number, baseline: Baseline | null): Observation {
  if (faces.length !== 1) return unknown(at, faces.length > 1 ? 'В кадре должен быть один человек' : undefined);
  const face = faces[0];
  if (face.length < 478 || face.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return unknown(at);
  const left = eyeSignal(face, 'left'), right = eyeSignal(face, 'right');
  const span = distance(left.center, right.center);
  const height = distance(face[10], face[152]);
  if (span < 0.065 || height < 0.12 || left.width < 0.012 || right.width < 0.012) return unknown(at, 'Подвиньтесь ближе: лицо слишком маленькое');
  const midpoint = { x: (left.center.x + right.center.x) / 2, y: (left.center.y + right.center.y) / 2 };
  const signals: Baseline = {
    left, right,
    yaw: (face[1].x - midpoint.x) / span,
    pitch: (face[1].y - midpoint.y) / height,
  };
  if (Object.values(signals).some(v => typeof v === 'number' && !Number.isFinite(v))) return unknown(at);
  const polygons = hands.filter(hand => hand.length >= 21 && hand.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).map(hull);
  const covered = (signal: EyeSignal) => polygons.some(poly =>
    [-0.22, 0, 0.22].filter(offset => inside({ x: signal.center.x + offset * signal.width, y: signal.center.y }, poly)).length >= 2);
  const cover = { left: covered(left), right: covered(right) };
  const visible = (['left', 'right'] as Eye[]).filter(eye => !cover[eye] && signals[eye].open >= LIMITS.eyeOpen);
  let gaze: boolean | null = null;
  if (baseline && visible.length) {
    gaze = Math.abs(signals.yaw - baseline.yaw) < LIMITS.yaw && Math.abs(signals.pitch - baseline.pitch) < LIMITS.pitch &&
      visible.every(eye => Math.abs(signals[eye].x - baseline[eye].x) < LIMITS.gazeX && Math.abs(signals[eye].y - baseline[eye].y) < LIMITS.gazeY);
  }
  return { at, valid: true, reason: '', covered: cover, gaze, signals };
}

export function condition(observation: Observation, testedEye: Eye, now: number): string | null {
  if (now - observation.at > LIMITS.staleMs) return 'Камера не передаёт свежие кадры';
  if (!observation.valid) return observation.reason;
  const other = testedEye === 'right' ? 'left' : 'right';
  if (observation.covered[other] !== true) return `Прикройте ${other === 'left' ? 'левый' : 'правый'} глаз ладонью`;
  if (observation.covered[testedEye] !== false) return 'Освободите глаз, которым проходите тест';
  if (!observation.signals || observation.signals[testedEye].open < LIMITS.eyeOpen) return 'Откройте глаз, которым проходите тест';
  if (observation.gaze !== true) return 'Посмотрите на экран';
  return null;
}

export class Calibration {
  step: 'center' | 'left' | 'right' | 'done' = 'center';
  baseline: Baseline | null = null;
  progress = 0;
  since: number | null = null;
  lastAt = -Infinity;
  samples: Baseline[] = [];
  hint = 'Смотрите на точку в центре экрана. Оба глаза открыты.';

  reset() {
    this.step = 'center'; this.baseline = null; this.progress = 0; this.since = null; this.samples = []; this.lastAt = -Infinity;
    this.hint = 'Смотрите на точку в центре экрана. Оба глаза открыты.';
  }

  update(o: Observation, now: number) {
    if (this.step === 'done') return;
    if (o.at === this.lastAt) return;
    if (o.at - this.lastAt > LIMITS.staleMs) { this.since = null; this.samples = []; }
    this.lastAt = o.at;
    let okay = o.valid && now - o.at <= LIMITS.staleMs;
    if (this.step === 'center') {
      const s = o.signals;
      okay = okay && !!s && !o.covered.left && !o.covered.right &&
        s.left.open >= LIMITS.eyeOpen && s.right.open >= LIMITS.eyeOpen &&
        Math.abs(s.yaw) < 0.25 && Math.abs(s.left.x - 0.5) < 0.25 && Math.abs(s.right.x - 0.5) < 0.25;
      if (okay && s && this.samples.length) {
        const first = this.samples[0];
        okay = Math.abs(s.yaw - first.yaw) < 0.08 && Math.abs(s.pitch - first.pitch) < 0.07 &&
          Math.abs(s.left.x - first.left.x) < 0.1 && Math.abs(s.right.x - first.right.x) < 0.1;
      }
      this.hint = !o.valid ? o.reason : 'Смотрите на точку. Держите голову ровно, оба глаза открыты.';
      if (okay && s) this.samples.push(s);
    } else {
      const tested = this.step === 'left' ? 'right' : 'left';
      const reason = condition(o, tested, now);
      okay = okay && reason === null;
      this.hint = reason ?? 'Отлично. Подержите руку ещё немного.';
    }
    if (!okay) { this.since = null; this.progress = 0; this.samples = []; return; }
    this.since ??= now;
    const duration = this.step === 'center' ? 2000 : 1000;
    this.progress = Math.min(1, (now - this.since) / duration);
    if (this.progress < 1 || (this.step === 'center' && this.samples.length < 10)) return;
    if (this.step === 'center') {
      const samples = this.samples;
      const mean = (read: (s: Baseline) => number) => samples.reduce((sum, sample) => sum + read(sample), 0) / samples.length;
      this.baseline = {
        left: { ...samples[0].left, x: mean(s => s.left.x), y: mean(s => s.left.y) },
        right: { ...samples[0].right, x: mean(s => s.right.x), y: mean(s => s.right.y) },
        yaw: mean(s => s.yaw), pitch: mean(s => s.pitch),
      };
      this.step = 'left';
    } else this.step = this.step === 'left' ? 'right' : 'done';
    this.since = null; this.progress = 0; this.samples = [];
  }
}
