// Keeps the frame time near budget by moving the pixel ratio: down quickly when frames are slow, up slowly when there is headroom.
const WINDOW_MS = 1500;
const SLOW_MS = 19; // below ~52 fps
const FAST_MS = 13.5; // comfortably above 60 fps headroom
const STEP_DOWN = 0.15;
const STEP_UP = 0.1;
export const MIN_PIXEL_RATIO = 0.75;

export class DynamicResolution {
  ratio: number;
  max: number;
  private elapsed = 0;
  private frames = 0;
  private fastWindows = 0;

  constructor(start: number, max: number) {
    this.max = max;
    this.ratio = Math.min(Math.max(start, MIN_PIXEL_RATIO), max);
  }

  setMax(max: number) {
    this.max = max;
    this.ratio = Math.min(this.ratio, max);
  }

  /** Feed the real (unclamped) frame time. Returns the new ratio when it changes, else null. */
  sample(frameMs: number): number | null {
    this.elapsed += frameMs;
    this.frames++;
    if (this.elapsed < WINDOW_MS) return null;
    const avg = this.elapsed / this.frames;
    this.elapsed = 0;
    this.frames = 0;
    const before = this.ratio;
    if (avg > SLOW_MS) {
      this.fastWindows = 0;
      this.ratio = Math.max(MIN_PIXEL_RATIO, this.ratio - STEP_DOWN * Math.min(3, avg / SLOW_MS));
    } else if (avg < FAST_MS && ++this.fastWindows >= 2) {
      this.fastWindows = 0;
      this.ratio = Math.min(this.max, this.ratio + STEP_UP);
    }
    this.ratio = Math.round(this.ratio * 100) / 100;
    return this.ratio !== before ? this.ratio : null;
  }

  /** True when the ratio is already at the floor and frames are still slow: time to drop a quality tier. */
  get exhausted() { return this.ratio <= MIN_PIXEL_RATIO; }
}
