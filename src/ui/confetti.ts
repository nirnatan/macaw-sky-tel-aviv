const COLORS = ['#ff6b4a', '#ffc928', '#26c6a0', '#4aa3ff', '#ff7eb6', '#9b6bff', '#ffffff', '#ff9a2e'];
const GRAVITY = 1100; // px/s^2 at dpr 1
const TERMINAL_SPEED = 420;

interface Piece {
  x: number; y: number; vx: number; vy: number; rotation: number; spin: number;
  size: number; color: string; shape: 'rect' | 'circle' | 'star'; flip: number; flipSpeed: number;
}

const random = (min: number, max: number) => min + Math.random() * (max - min);

export function createConfetti(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const pieces: Piece[] = [];
  let last = performance.now();
  let frame = 0;

  const spawn = (x: number, y: number, angle: number, speed: number, spread: number): Piece => {
    const a = angle + random(-spread, spread);
    const v = speed * random(0.45, 1);
    return {
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rotation: random(0, 6.28), spin: random(-9, 9),
      size: random(7, 14) * dpr, color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      shape: (['rect', 'rect', 'circle', 'star'] as const)[Math.floor(Math.random() * 4)]!, flip: random(0, 6.28), flipSpeed: random(5, 14),
    };
  };

  const drawStar = (size: number) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? size * 0.22 : size * 0.5;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  };

  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i]!;
      p.vx *= Math.exp(-1.4 * dt);
      p.vy = Math.min(p.vy + GRAVITY * dpr * dt, TERMINAL_SPEED * dpr);
      p.x += p.vx * dt + Math.sin(p.flip) * 18 * dpr * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      p.flip += p.flipSpeed * dt;
      if (p.y > canvas.height + 30) { pieces.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2); ctx.fill(); }
      else drawStar(p.size);
      ctx.restore();
    }
    frame = pieces.length ? requestAnimationFrame(tick) : 0;
  };
  const ensureRunning = () => { if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); } };

  return {
    /** Cannon from a screen point: angle in radians (-PI/2 = straight up). */
    burst(xFraction: number, yFraction: number, angle: number, count: number) {
      for (let i = 0; i < count; i++) pieces.push(spawn(canvas.width * xFraction, canvas.height * yFraction, angle, 1500 * dpr * random(0.7, 1), 0.5));
      ensureRunning();
    },
    rain(count: number) {
      for (let i = 0; i < count; i++) pieces.push(spawn(random(0, canvas.width), -random(10, 200) * dpr, Math.PI / 2, 120 * dpr, 0.4));
      ensureRunning();
    },
    dispose() { cancelAnimationFrame(frame); frame = 0; pieces.length = 0; },
  };
}
