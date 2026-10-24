import * as THREE from 'three';
import { createBulbs, type Bulb } from './bulbs';
import { at, backlitFabric, Parts, soak } from './parts';
import type { Roof } from './roof';
import type { Decor } from './styles';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2); // shape +y turns to north (-z)

const ROUGHNESS = 0.7;
const HEART_RED = '#ff4d6d';
const HEARTH = new THREE.Color('#ff6f7f');
const POST = { inset: 0.6, height: 2.1, maxSpan: 7 };
const SAG = 0.35;
const BULB_GAP = 0.55;
const WARM_BULBS = ['#ffd27a', '#ffe9a8', '#ffb35c'].map((c) => new THREE.Color(c).multiplyScalar(1.15));
const FLOWERS = ['#ff595e', '#ffca3a', '#ff8fab', '#b77dff', '#ffffff'];
const DECK_COLOR = '#d29a66';
const PARAPET_TOP = 0.9; // the city's parapet height above the roof
const BAND = { depth: 1.4, out: 0.1 };

/** Unit house silhouette with a chimney, roof up; about 1.9 wide and 1.8 tall. */
const HOUSE_OUTLINE: [number, number][] = [[-0.7, -0.8], [0.7, -0.8], [0.7, 0.1], [0.95, 0.1], [0.55, 0.458], [0.55, 0.8], [0.38, 0.8], [0.38, 0.61], [0, 0.95], [-0.95, 0.1], [-0.7, 0.1]];

function heartPath<T extends THREE.Path>(p: T, cx: number, cy: number, r: number): T {
  p.moveTo(cx, cy - r * 0.9);
  p.bezierCurveTo(cx - r * 1.4, cy + r * 0.1, cx - r * 0.7, cy + r * 1.2, cx, cy + r * 0.45);
  p.bezierCurveTo(cx + r * 0.7, cy + r * 1.2, cx + r * 1.4, cy + r * 0.1, cx, cy - r * 0.9);
  return p;
}

const HEART = { y: -0.3, r: 0.28 }; // the doorway heart, in house units

function houseEmblem(size: number, doorway: boolean): THREE.Shape {
  const s = new THREE.Shape(HOUSE_OUTLINE.map(([x, y]) => new THREE.Vector2(x * size, y * size)));
  if (doorway) s.holes.push(heartPath(new THREE.Path(), 0, HEART.y * size, HEART.r * size));
  return s;
}

/** Corners at least `gap` apart, farthest from the pad first. */
function cornerAnchors(corners: THREE.Vector2[], center: THREE.Vector2, gap: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const c of [...corners].sort((a, b) => b.distanceTo(center) - a.distanceTo(center))) {
    if (out.length < 4 && out.every((o) => o.distanceTo(c) > gap)) out.push(c);
  }
  return out;
}

const inward = (c: THREE.Vector2, center: THREE.Vector2, by: number) => c.clone().lerp(center, by / c.distanceTo(center));

/** A warm wooden deck over the whole roof and the parapet painted in the house color, so the roof stands out from its neighbors. */
function addRoofTerrace(p: Parts, corners: THREE.Vector2[], roof: number, center: THREE.Vector2, color: string) {
  const deck = new THREE.Shape(corners.map((c) => inward(c, center, 0.5)).map((c) => new THREE.Vector2(c.x, -c.y)));
  p.add(flat(new THREE.ShapeGeometry(deck)), DECK_COLOR, at(0, roof + 0.06, 0));
  const top = roof + PARAPET_TOP + 0.05, bottom = top - BAND.depth;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const along = b.clone().sub(a).normalize();
    const out = new THREE.Vector2(along.y, -along.x); // outward for the positive-area outer ring
    const a0 = a.clone().addScaledVector(out, BAND.out).addScaledVector(along, -BAND.out);
    const b0 = b.clone().addScaledVector(out, BAND.out).addScaledVector(along, BAND.out);
    const mid = a0.clone().add(b0).multiplyScalar(0.5), yaw = Math.atan2(-along.y, along.x);
    p.box(a0.distanceTo(b0), BAND.depth, 0.06, color, mid.x, (top + bottom) / 2, mid.y, new THREE.Euler(0, yaw, 0));
    p.box(a0.distanceTo(b0), 0.08, 0.3, '#ffffff', mid.x, top + 0.04, mid.y, new THREE.Euler(0, yaw, 0));
  });
}

/** Posts just inside the roof edge with a sagging wire between them; returns the bulb positions along it. */
function addStringLights(p: Parts, corners: THREE.Vector2[], roof: number, center: THREE.Vector2): THREE.Vector3[] {
  const bulbs: THREE.Vector3[] = [];
  const top = roof + POST.height;
  for (const [i, corner] of corners.entries()) {
    const a = inward(corner, center, POST.inset);
    const b = inward(corners[(i + 1) % corners.length], center, POST.inset);
    const spans = Math.max(1, Math.ceil(a.distanceTo(b) / POST.maxSpan));
    for (let s = 0; s < spans; s++) {
      const p0 = a.clone().lerp(b, s / spans), p1 = a.clone().lerp(b, (s + 1) / spans);
      p.beam(V(p0.x, roof, p0.y), V(p0.x, top + 0.1, p0.y), 0.08, '#ffffff');
      p.add(new THREE.SphereGeometry(0.09, 8, 6), '#ffd27a', at(p0.x, top + 0.14, p0.y));
      const wireAt = (t: number) => V(THREE.MathUtils.lerp(p0.x, p1.x, t), top - SAG * 4 * t * (1 - t), THREE.MathUtils.lerp(p0.y, p1.y, t));
      const segs = 8;
      for (let j = 0; j < segs; j++) p.beam(wireAt(j / segs), wireAt((j + 1) / segs), 0.025, '#5b4636');
      const n = Math.max(1, Math.round(p0.distanceTo(p1) / BULB_GAP));
      for (let k = 1; k < n; k++) {
        const bulb = wireAt(k / n).add(V(0, -0.12, 0));
        bulbs.push(bulb);
        p.add(new THREE.IcosahedronGeometry(0.08, 0), '#fff0c4', at(bulb.x, bulb.y, bulb.z));
      }
    }
  }
  return bulbs;
}

function addPlant(p: Parts, x: number, roof: number, z: number, kind: number) {
  p.add(new THREE.CylinderGeometry(0.45, 0.32, 0.65, 12), '#d9774b', at(x, roof + 0.325, z));
  p.add(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 12), '#c5653c', at(x, roof + 0.66, z));
  if (kind === 0) {
    p.add(new THREE.ConeGeometry(0.42, 2.0, 8), '#3f9a4a', at(x, roof + 1.7, z)); // a little cypress
  } else {
    p.add(new THREE.IcosahedronGeometry(0.6, 1), kind === 1 ? '#4caf50' : '#5cbf60', at(x, roof + 1.15, z));
    for (let k = 0; k < 5; k++) {
      const a = k * 1.26 + kind;
      p.add(new THREE.IcosahedronGeometry(0.13, 0), FLOWERS[(k + kind) % FLOWERS.length], at(x + Math.cos(a) * 0.45, roof + 1.35 + (k % 2) * 0.2, z + Math.sin(a) * 0.45));
    }
  }
}

/** A welcome flag in the house color with a heart on both faces, waving away from the pole. */
function addFlag(p: Parts, x: number, roof: number, z: number, color: string) {
  const pole = 3.8, w = 1.7, h = 1.05;
  p.add(new THREE.CylinderGeometry(0.05, 0.06, pole, 8), '#ffffff', at(x, roof + pole / 2, z));
  p.add(new THREE.SphereGeometry(0.11, 10, 8), '#ffd23f', at(x, roof + pole + 0.08, z));
  const cloth = new THREE.PlaneGeometry(w, h, 10, 1).translate(w / 2, 0, 0);
  const pos = cloth.attributes.position;
  const wave = (u: number) => Math.sin(u * 5.5) * 0.12 * u * u; // pinned at the pole, freer at the tip
  for (let i = 0; i < pos.count; i++) pos.setZ(i, wave(pos.getX(i) / w));
  cloth.computeVertexNormals();
  const flagY = roof + pole - h / 2 - 0.05;
  p.add(cloth, color, at(x, flagY, z));
  const hx = 0.42;
  for (const side of [1, -1]) {
    const heart = new THREE.ShapeGeometry(heartPath(new THREE.Shape(), 0, 0, 0.22)).rotateY(side < 0 ? Math.PI : 0);
    p.add(heart, '#ffffff', at(x + hx, flagY + 0.05, z + wave(hx / w) + side * 0.015));
  }
}

/**
 * "Our home" from the air: a big pad with a glowing house-and-heart emblem in the place color,
 * warm string lights along the roof edge that come on at night, potted plants and a welcome flag.
 */
export function createHomeDecor({ ring, height: roof, center, padRadius: R }: Roof, color: string, castShadow: boolean): Decor {
  const { x: cx, y: cz } = center;
  const corners = Array.from({ length: ring.length / 2 }, (_, i) => new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
  const deep = new THREE.Color(color).lerp(new THREE.Color('#1b1440'), 0.68);

  const decor = new Parts();
  addRoofTerrace(decor, corners, roof, center, color);
  decor.add(flat(new THREE.CircleGeometry(R, 64)), deep, at(cx, roof + 0.12, cz));
  decor.add(flat(new THREE.RingGeometry(R * 0.95, R * 0.99, 64)), '#ffffff', at(cx, roof + 0.14, cz));
  const emblem = R * 0.6;
  decor.add(flat(new THREE.ShapeGeometry(houseEmblem(emblem * 1.12, false), 6)), '#ffffff', at(cx, roof + 0.13, cz)); // white outline
  decor.add(flat(new THREE.ShapeGeometry(heartPath(new THREE.Shape(), 0, HEART.y * emblem, HEART.r * emblem * 1.05))), HEART_RED, at(cx, roof + 0.14, cz));
  const bulbSpots = addStringLights(decor, corners, roof, center);
  const [flagCorner, ...plantCorners] = cornerAnchors(corners, center, 4);
  const flag = inward(flagCorner, center, 1.2);
  addFlag(decor, flag.x, roof, flag.y, color);
  plantCorners.forEach((c, i) => {
    const pot = inward(c, center, 1.5);
    addPlant(decor, pot.x, roof, pot.y, i % 3);
  });
  const fabric = backlitFabric(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ROUGHNESS, side: THREE.DoubleSide }), 0.3);
  const decorMesh = new THREE.Mesh(decor.build(), fabric.material);
  decorMesh.castShadow = castShadow;
  decorMesh.receiveShadow = true;

  const glow = new Parts();
  glow.add(flat(new THREE.RingGeometry(R * 0.8, R * 0.88, 72)), '#ffffff', at(cx, roof + 0.16, cz));
  glow.add(flat(new THREE.ShapeGeometry(houseEmblem(emblem, true), 6)), '#ffffff', at(cx, roof + 0.16, cz));
  const glowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(deep, 0.35), emissive: color, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.35 });
  const glowMesh = new THREE.Mesh(glow.build(), glowMat);

  const bulbs = bulbSpots.map((position, i): Bulb => ({ position, color: WARM_BULBS[i % WARM_BULBS.length], size: 0.5 }));
  bulbs.push({ position: V(cx, roof + 0.4, cz - HEART.y * emblem), color: HEARTH, size: HEART.r * emblem * 4 }); // the heart lights up at night
  const lights = createBulbs(bulbs, Math.round(cx + cz));
  let boost = 1;
  return {
    objects: [decorMesh, glowMesh, lights.points],
    applyLighting(m) {
      fabric.setDaylight(m.daylight);
      soak(fabric.material, ROUGHNESS, m.wet);
      lights.applyLighting(m);
      boost = 1 + 1.2 * m.glow;
    },
    update(time, pointScale) {
      glowMat.emissiveIntensity = (0.55 + 0.2 * Math.sin(time * 2.2)) * boost;
      lights.update(time, pointScale);
    },
  };
}
