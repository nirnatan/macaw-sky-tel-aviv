import * as THREE from 'three';
import { damp, type Player, type WorldQuery } from './controller';

// Third-person chase camera with a short drag-to-look orbit that springs back.
export class ChaseCamera {
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private orbitYaw = 0;
  private orbitPitch = 0;
  private dragging = false;
  private lastDrag = 0;
  private dist = 4;
  private roll = 0;
  private readonly lastBird = new THREE.Vector3();

  readonly camera: THREE.PerspectiveCamera;
  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    let px = 0, py = 0;
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // touch drags belong to the on-screen joystick
      this.dragging = true; px = e.clientX; py = e.clientY;
    });
    window.addEventListener('pointerup', () => { this.dragging = false; this.lastDrag = performance.now(); });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.orbitYaw -= (e.clientX - px) * 0.006;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + (e.clientY - py) * 0.004, -0.6, 1.1);
      px = e.clientX; py = e.clientY;
    });
  }

  snap(player: Player, world: WorldQuery) {
    this.update(1, player, world, true);
  }

  update(dt: number, player: Player, world: WorldQuery, snap = false) {
    const cam = this.camera;
    const flying = player.flying;
    if (!this.dragging && performance.now() - this.lastDrag > 1500) {
      this.orbitYaw = damp(this.orbitYaw, 0, 2.5, dt);
      this.orbitPitch = damp(this.orbitPitch, 0, 2.5, dt);
    }

    const speedNorm = THREE.MathUtils.clamp(player.speed / 44, 0, 1);
    const wantDist = flying ? 2.3 + speedNorm * 2.2 : 1.5;
    this.dist = snap ? wantDist : damp(this.dist, wantDist, 2, dt);

    const yaw = player.yaw + this.orbitYaw;
    const pitchFollow = flying ? player.pitch * 0.45 : 0;
    const elev = (flying ? 0.2 : 0.32) + this.orbitPitch - pitchFollow;
    this.desired.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev))
      .multiplyScalar(this.dist).add(player.position);

    const pushed = world.collide(this.desired, 0.35);
    if (pushed) this.desired.copy(pushed);
    const top = world.surfaceAt(this.desired.x, this.desired.z).height + 0.5; // never inside a building or under the ground
    if (this.desired.y < top) this.desired.y = top;

    if (!snap) { // carry the camera with the bird so smoothing only lags the offset, never the flight speed
      cam.position.add(this.tmp.subVectors(player.position, this.lastBird));
      this.look.add(this.tmp);
    }
    this.lastBird.copy(player.position);
    const k = snap ? 1 : 1 - Math.exp(-(flying ? 7 : 5) * dt);
    cam.position.lerp(this.desired, k);

    player.forward(this.fwd);
    this.target.copy(player.position).addScaledVector(this.fwd, flying ? 1.8 : 0.6);
    this.target.y += flying ? 0.3 : 0.2;
    this.look.lerp(this.target, snap ? 1 : 1 - Math.exp(-12 * dt));
    cam.lookAt(this.look);

    this.roll = damp(this.roll, flying ? -player.bank * 0.22 : 0, 4, dt);
    cam.rotateZ(this.roll);

    const fov = 60 + player.boost * 16 + speedNorm * 6;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 3, dt); cam.updateProjectionMatrix(); }
  }
}
