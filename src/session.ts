import type { Eye } from './video-analysis/index.ts';
export type Direction = 'right' | 'down' | 'left' | 'up';
export const DIRECTIONS: Direction[] = ['right', 'down', 'left', 'up'];
export const SIZES = [120, 96, 72, 54, 40];

export function swipe(dx: number, dy: number): Direction | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const x = Math.abs(dx), y = Math.abs(dy);
  if (Math.max(x, y) < 35 || Math.max(x, y) < Math.min(x, y) * 1.4) return null;
  return x > y ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

export class TestSession {
  eye: Eye = 'right';
  answers: Record<Eye, boolean[]> = { right: [], left: [] };
  direction: Direction = 'right';
  paused = true;
  done = false;
  token = 0;
  readyAt = 0;
  private badSince: number | null = null;
  private goodSince: number | null = null;
  private random: () => number;

  constructor(random = Math.random) { this.random = random; }
  get index() { return this.answers[this.eye].length; }
  get size() { return SIZES[this.index] ?? 40; }

  private nextDirection() {
    const options = DIRECTIONS.filter(d => d !== this.direction);
    this.direction = options[Math.min(2, Math.floor(this.random() * 3))];
    this.token++;
  }

  suspend() {
    if (!this.paused) this.token++;
    this.paused = true; this.goodSince = null; this.badSince = null;
  }

  update(good: boolean, now: number, hard = false) {
    if (this.done) return;
    if (hard) { this.suspend(); return; }
    if (!good) {
      this.goodSince = null;
      this.badSince ??= now;
      if (now - this.badSince >= 500) this.suspend();
    } else {
      this.badSince = null;
      this.goodSince ??= now;
      if (this.paused && now - this.goodSince >= 600) {
        this.paused = false; this.nextDirection(); this.readyAt = now + 200;
      }
    }
  }

  canAnswer(now: number) { return !this.done && !this.paused && now >= this.readyAt; }

  answer(direction: Direction | null, token: number, now: number) {
    if (!this.canAnswer(now) || token !== this.token) return false;
    this.answers[this.eye].push(direction === this.direction);
    this.nextDirection(); this.readyAt = now + 350;
    if (this.index === 5) {
      if (this.eye === 'right') { this.eye = 'left'; this.suspend(); }
      else { this.done = true; this.suspend(); }
    }
    return true;
  }
}
