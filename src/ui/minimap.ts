import type { HudFrame } from '../contracts';
import type { CityData } from '../world/data';
import { renderCityMap, type CityMap } from './cityMap';
import { UI_TEXT } from './strings';

const VIEW_RADIUS = 650; // meters from the bird to the rim
const PIN_COLORS = { school: '#ff6247', gan: '#26c6a0' } as const;

export function createMinimap(data: CityData) {
  const canvas = document.createElement('canvas');
  canvas.className = 'mc-minimap';
  const ctx = canvas.getContext('2d')!;
  let map: CityMap | null = null;
  let size = 0;

  setTimeout(() => { void renderCityMap(data).then((m) => { map = m; }); }, 60); // after first paint; renders in slices so animations keep running

  new ResizeObserver(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    size = Math.round(canvas.clientWidth * dpr);
    canvas.width = size;
    canvas.height = size;
  }).observe(canvas);

  const drawPin = (x: number, y: number, color: string, found: boolean, time: number, unit: number) => {
    const pulse = (time * 1.4) % 1;
    if (!found) {
      ctx.beginPath(); ctx.arc(x, y, unit * (5 + pulse * 9), 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.globalAlpha = 1 - pulse; ctx.lineWidth = unit * 2; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(x, y, unit * (found ? 5 : 6 + Math.sin(time * 6) * 0.8), 0, Math.PI * 2);
    ctx.fillStyle = found ? '#ffc928' : color; ctx.fill();
    ctx.lineWidth = unit * 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, unit * 2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  };

  return {
    element: canvas,
    draw(frame: HudFrame, time: number) {
      if (size === 0) return;
      const half = size / 2;
      const unit = size / 150; // 1 unit = 1 css px at the default 150px size
      const { heading, x: px, z: pz } = frame.player;
      const pxPerMeter = (half - unit * 4) / VIEW_RADIUS;
      const cos = Math.cos(heading), sin = Math.sin(heading);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath(); ctx.arc(half, half, half - unit * 3, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#69b8d2'; ctx.fillRect(0, 0, size, size);
      if (map) {
        ctx.translate(half, half); ctx.rotate(-heading); ctx.scale(pxPerMeter, pxPerMeter); ctx.translate(-px, -pz);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(map.canvas, map.minX, map.minZ, map.widthMeters, map.heightMeters);
      }
      ctx.restore();

      ctx.beginPath(); ctx.arc(half, half, half - unit * 3, 0, Math.PI * 2);
      ctx.lineWidth = unit * 5; ctx.strokeStyle = '#ffd36b'; ctx.stroke();
      ctx.lineWidth = unit * 1.4; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();

      const rimLimit = half - unit * 14;
      for (const hud of frame.targets) {
        const spot = data.targets[hud.id];
        const dx = spot.x - px, dz = spot.z - pz;
        let sx = (dx * cos + dz * sin) * pxPerMeter;
        let sy = (-dx * sin + dz * cos) * pxPerMeter;
        const dist = Math.hypot(sx, sy);
        const outside = dist > rimLimit;
        if (outside) { sx = (sx / dist) * rimLimit; sy = (sy / dist) * rimLimit; }
        drawPin(half + sx, half + sy, PIN_COLORS[hud.id], hud.found, time, unit * (outside ? 0.8 : 1));
      }

      const nx = -sin, ny = -cos; // north on the rotated map
      const nr = half - unit * 8.5;
      ctx.beginPath(); ctx.arc(half + nx * nr, half + ny * nr, unit * 8, 0, Math.PI * 2);
      ctx.fillStyle = '#c0392b'; ctx.fill(); ctx.lineWidth = unit * 1.6; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${unit * 10}px Rubik, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(UI_TEXT.north.he, half + nx * nr, half + ny * nr + unit * 0.6);

      ctx.save();
      ctx.translate(half, half); ctx.scale(unit, unit);
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4.500); ctx.lineTo(-8, 9); ctx.closePath();
      ctx.shadowColor = 'rgba(60,20,0,.5)'; ctx.shadowBlur = 5;
      ctx.fillStyle = '#fff6d6'; ctx.fill(); ctx.shadowBlur = 0;
      ctx.lineWidth = 2.200; ctx.strokeStyle = '#d9542a'; ctx.stroke();
      ctx.restore();
    },
  };
}
