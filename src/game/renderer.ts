import { Application, Graphics, Text } from 'pixi.js';
import { Vec2 } from 'planck';
import type { Body } from 'planck';
import { Simulation } from './physics';

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number };
const C = { sky: 0x192b32, rock: 0x34494a, edge: 0x52635a, grass: 0xb2c976, lime: 0xd8f36a, pink: 0xf6b9bf, cream: 0xf1edcf };
const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

/** Rendering reads physics. It never moves bodies or supplies collision geometry. */
export class GameRenderer {
  app = new Application();
  private background = new Graphics();
  private terrain = new Graphics();
  private trail = new Graphics();
  private fairy = new Graphics();
  private debugLayer = new Graphics();
  private labels = new Map<string, Text>();
  private particles: Particle[] = [];
  private cameraX = -2.5;
  private cameraY = 0;
  private scale = 48;
  private time = 0;
  private disposed = false;
  debug = false;

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host, background: C.sky, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
      preference: 'webgl', powerPreference: 'low-power',
    });
    if (this.disposed) return;
    host.prepend(this.app.canvas);
    this.app.canvas.setAttribute('aria-label', 'Jetshoes Fairy physics course');
    this.app.stage.addChild(this.background, this.terrain, this.trail, this.fairy, this.debugLayer);
  }

  resetCamera() { this.cameraX = -2.5; this.cameraY = 0; this.particles = []; }

  private point(x: number, y: number): [number, number] {
    return [(x - this.cameraX) * this.scale, this.app.screen.height * 0.73 - (y - this.cameraY) * this.scale];
  }

  private label(id: string, text: string, x: number, y: number, color = C.cream, size = 10, alpha = 0.65) {
    let label = this.labels.get(id);
    if (!label) {
      label = new Text({ text, style: { fontFamily: 'monospace', fontSize: size, letterSpacing: 1.5, fill: color } });
      label.anchor.set(0.5);
      this.app.stage.addChild(label);
      this.labels.set(id, label);
    }
    label.text = text;
    label.position.set(x, y);
    label.alpha = alpha;
  }

  render(sim: Simulation, dt: number) {
    this.time += dt;
    const { width: w, height: h } = this.app.screen;
    this.scale = Math.max(30, Math.min(54, h / 10.3)) * sim.settings.viewScale;
    const p = sim.torso.getPosition();
    const targetX = Math.max(-2.5, p.x - (w / this.scale) * 0.3);
    const targetY = Math.max(0, p.y - 5 / sim.settings.viewScale);
    const follow = 1 - Math.exp(-dt * 5);
    this.cameraX += (targetX - this.cameraX) * follow;
    this.cameraY += (targetY - this.cameraY) * follow;
    for (const t of this.labels.values()) t.alpha = 0;
    this.drawSky(w, h);
    this.drawCourse(sim);
    this.drawFairy(sim, dt);
    this.drawDebug(sim);
  }

  private drawSky(w: number, h: number) {
    const g = this.background.clear();
    g.rect(0, 0, w, h).fill(C.sky);
    // Soft bands, distant ridges, drifting mist, and deterministic stars. No external assets.
    for (let i = 0; i < 18; i++) {
      g.rect(0, h * i / 18, w, h / 18 + 1).fill({ color: 0x49615b, alpha: i / 18 * 0.15 });
    }
    for (let i = 0; i < 75; i++) {
      const x = ((noise(i + 1) * w * 2 - this.cameraX * 2) % (w + 20) + w + 20) % (w + 20);
      const y = noise(i + 84) * h * 0.63;
      g.circle(x, y, i % 7 === 0 ? 1.5 : 0.7).fill({ color: C.cream, alpha: 0.12 + noise(i + 33) * 0.3 });
    }
    const mx = w * 0.78 - this.cameraX * 0.8;
    g.circle(mx, h * 0.22, 27).fill({ color: C.cream, alpha: 0.04 });
    g.circle(mx, h * 0.22, 19).fill({ color: C.cream, alpha: 0.12 });
    g.circle(mx + 8, h * 0.22 - 5, 18).fill(C.sky);
    for (let layer = 0; layer < 3; layer++) {
      const pts: number[] = [-100, h + 100];
      const offset = (this.cameraX * (4 + layer * 4)) % 190;
      for (let i = -2; i < w / 95 + 3; i++) {
        pts.push(i * 95 - offset, h * (0.58 + layer * 0.12) - noise(i + layer * 32) * h * 0.17);
      }
      pts.push(w + 200, h + 100);
      g.poly(pts).fill({ color: [0x2c4145, 0x354e4e, 0x3e5750][layer], alpha: 0.4 });
    }
    for (let i = 0; i < 5; i++) {
      const x = (noise(i + 63) * w * 2 - this.time * (2 + i) - this.cameraX * 2) % (w * 1.4);
      g.ellipse(x, h * (0.42 + noise(i) * 0.5), 95 + i * 35, 10 + i * 3).fill({ color: 0xb6d5bc, alpha: 0.025 });
    }
  }

  private drawCourse(sim: Simulation) {
    const g = this.terrain.clear();
    for (const platform of sim.platforms) {
      const { body, width, height, pivot, id } = platform;
      const transform = (x: number, y: number) => {
        const v = body.getWorldPoint(Vec2(x, y)); return this.point(v.x, v.y);
      };
      const a = transform(-width / 2, height / 2), b = transform(width / 2, height / 2);
      const c = transform(width / 2, -height / 2), d = transform(-width / 2, -height / 2);
      if (a[0] > this.app.screen.width + 100 || b[0] < -100) continue;
      if (!pivot && id !== 'block') {
        const bottom = transform(width * 0.08, -height / 2 - Math.min(width * 0.3, 2.2));
        g.poly([...a, ...b, ...c, ...transform(width * 0.26, -height / 2 - 0.65), ...bottom, ...d])
          .fill(C.rock).stroke({ color: C.edge, width: 1, alpha: 0.5 });
        for (let i = 0; i < width * 2; i++) {
          const x = -width / 2 + noise(i + width) * width;
          const top = transform(x, -0.1), end = transform(x + noise(i) * 0.3, -height / 2 - noise(i + 5) * 0.6);
          g.moveTo(...top).lineTo(...end).stroke({ color: 0x648078, width: 1, alpha: 0.14 });
        }
      } else {
        g.poly([...a, ...b, ...c, ...d]).fill(pivot ? 0x8b9270 : 0x596860).stroke({ color: C.grass, width: 1 });
      }
      g.moveTo(...a).lineTo(...b).stroke({ color: C.grass, width: pivot ? 5 : 4 });
      if (!pivot && id !== 'block') {
        for (let i = 0; i < width * 4; i++) {
          const x = -width / 2 + i / 4;
          const base = transform(x, height / 2), tip = transform(x + 0.025, height / 2 + 0.04 + noise(i) * 0.09);
          g.moveTo(...base).lineTo(...tip).stroke({ color: i % 3 ? C.grass : C.lime, width: 1.5, alpha: 0.7 });
          if (i % 11 === 4) {
            const bloom = transform(x, height / 2 + 0.2);
            g.moveTo(...base).lineTo(...bloom).stroke({ color: C.grass, width: 1 });
            g.circle(...bloom, 2.4).fill(C.pink);
          }
        }
      }
      if (pivot) {
        const [px, py] = this.point(body.getPosition().x, body.getPosition().y);
        g.poly([px - 13, py + 30, px, py + 7, px + 13, py + 30]).fill(0x657765);
        g.circle(px, py, 5).fill(C.cream).stroke({ color: 0x192b32, width: 2 });
        this.label('pivot', 'WEIGHT SHIFTS EVERYTHING', px, py + 58, C.grass, 9, 0.65);
      }
    }
    const [sx, sy] = this.point(2.1, 0);
    g.moveTo(sx - 22, sy - 3).lineTo(sx - 22, sy - 47).stroke({ color: C.cream, alpha: 0.4, width: 1 });
    g.poly([sx - 21, sy - 47, sx + 3, sy - 40, sx - 21, sy - 32]).fill({ color: C.cream, alpha: 0.65 });
    this.label('start', 'START', sx - 20, sy + 34, C.cream, 9, 0.4);
    const runway = sim.platforms.find(p => p.id === 'runway')!;
    const landing = sim.platforms.find(p => p.id === 'landing')!;
    const home = sim.platforms.find(p => p.id === 'home')!;
    const [lx, ly] = this.point(runway.body.getPosition().x + runway.width / 2 - 1, 0);
    this.label('gap', '01 / COMMIT TO THE GAP', lx + 65, ly + 91, C.cream, 9, 0.45);
    const [px, py] = this.point(landing.body.getPosition().x, 1);
    this.label('landing', '02 / STICK THE LANDING', px, py - 34, C.cream, 9, 0.45);
    const [fx, fy] = this.point(sim.finishX, home.body.getPosition().y + home.height / 2);
    g.moveTo(fx, fy).lineTo(fx, fy - 105).stroke({ color: C.cream, width: 3 });
    for (let x = 0; x < 5; x++) for (let y = 0; y < 3; y++) {
      g.rect(fx + x * 7, fy - 105 + y * 7, 7, 7).fill((x + y) % 2 ? C.sky : C.lime);
    }
    this.label('finish', 'HOME, IN ONE PIECE.', fx, fy + 38, C.lime, 10, 0.85);
  }

  private drawFairy(sim: Simulation, dt: number) {
    const g = this.fairy.clear();
    const pos = sim.torso.getPosition();
    const xy = (body: Body, x: number, y: number) => {
      const v = body.getWorldPoint(Vec2(x, y)); return this.point(v.x, v.y);
    };
    const txy = (x: number, y: number) => xy(sim.torso, x, y);
    // Paired wings expand physically readable silhouettes when braking.
    for (const side of [-1, 1]) {
      const spread = sim.wings ? 1 : 0.52;
      const flutter = Math.sin(this.time * (sim.wings ? 26 : 5)) * 0.08;
      const points: number[] = [];
      for (let i = 0; i <= 20; i++) {
        const a = i / 20 * Math.PI * 2;
        points.push(...txy(side * (0.2 + spread * 0.35 + Math.cos(a) * spread * 0.4), 0.19 + Math.sin(a) * 0.48 + flutter));
      }
      g.poly(points).fill({ color: sim.wings ? C.lime : 0xd7e7d5, alpha: sim.wings ? 0.55 : 0.25 })
        .stroke({ color: C.cream, alpha: 0.45, width: 1 });
      g.moveTo(...txy(0, -0.1)).lineTo(...txy(side * spread * 0.75, 0.45)).stroke({ color: C.cream, width: 1, alpha: 0.3 });
    }

    const order = ['thigh-l', 'shin-l', 'foot-l', 'thigh-r', 'shin-r', 'foot-r', 'torso', 'head'];
    for (const name of order) {
      const part = sim.parts.find(p => p.name === name)!;
      const { body, width, height } = part;
      const [cx, cy] = this.point(body.getPosition().x, body.getPosition().y);
      if (name === 'head') {
        g.circle(cx, cy, width / 2 * this.scale).fill(C.pink);
        g.poly([...xy(body, -0.25, 0.02), ...xy(body, -0.21, 0.24), ...xy(body, 0.06, 0.32), ...xy(body, 0.24, 0.16), ...xy(body, 0.16, 0.08)])
          .fill(0xd889a4);
        for (const side of [-1, 1]) {
          g.circle(...xy(body, side * 0.09, -0.035), 1.8).fill(0x293338);
          const base = xy(body, side * 0.1, 0.21), tip = xy(body, side * 0.18, 0.4);
          g.moveTo(...base).lineTo(...tip).stroke({ color: C.pink, width: 1.5 });
          g.circle(...tip, 2).fill(C.lime);
        }
      } else if (name === 'torso') {
        g.poly([...xy(body, -width / 2, height / 2), ...xy(body, width / 2, height / 2),
          ...xy(body, width * 0.65, -height / 2), ...xy(body, -width * 0.65, -height / 2)])
          .fill(C.lime).stroke({ color: 0x354638, width: 1 });
        g.moveTo(...xy(body, -0.23, -0.17)).lineTo(...xy(body, 0.23, -0.17)).stroke({ color: 0x6a8252, width: 2 });
        // Little arms are cosmetic; legs and shoes are simulated.
        for (const side of [-1, 1]) {
          g.moveTo(...xy(body, side * 0.23, 0.15)).lineTo(...xy(body, side * 0.34, -0.12))
            .stroke({ color: C.pink, width: 4, cap: 'round' });
        }
      } else if (name.startsWith('foot')) {
        g.poly([...xy(body, -width / 2, height / 2), ...xy(body, width / 2, height / 2),
          ...xy(body, width / 2, -height / 2), ...xy(body, -width / 2, -height / 2)]).fill(0xe2a8a1);
        g.moveTo(...xy(body, -width / 2, -height / 2)).lineTo(...xy(body, width / 2, -height / 2))
          .stroke({ color: C.cream, width: 3 });
        g.circle(...xy(body, 0, -height / 2), 2.7).fill(sim.jets ? C.lime : 0x56615c);
        if (sim.jets && dt > 0 && this.particles.length < 180) {
          const jet = body.getWorldPoint(Vec2(0, -height / 2));
          const up = sim.torso.getWorldVector(Vec2(0, 1));
          const life = 0.2 + Math.random() * 0.25;
          this.particles.push({ x: jet.x, y: jet.y, vx: -up.x * 5 + (Math.random() - 0.5),
            vy: -up.y * 5 + (Math.random() - 0.5), life, max: life, size: 2 + Math.random() * 4 });
          const nozzle = xy(body, 0, -height / 2);
          const end = this.point(jet.x - up.x * (0.5 + Math.sin(this.time * 70) * 0.1), jet.y - up.y * 0.5);
          g.moveTo(...nozzle).lineTo(...end).stroke({ color: C.lime, width: 5, cap: 'round' });
        }
      } else {
        g.moveTo(...xy(body, 0, height / 2)).lineTo(...xy(body, 0, -height / 2))
          .stroke({ color: name.startsWith('thigh') ? 0xb0c188 : C.pink, width: width * this.scale, cap: 'round' });
      }
    }
    const particles = this.trail.clear();
    this.particles = this.particles.filter(p => p.life > 0);
    for (const p of this.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      particles.circle(...this.point(p.x, p.y), Math.max(0.1, p.size * p.life / p.max))
        .fill({ color: C.lime, alpha: Math.max(0, p.life / p.max * 0.7) });
    }
    if (sim.state === 'ready') {
      const [x, y] = this.point(pos.x, pos.y + 1.3);
      this.label('you', 'YOU ↓', x, y - 8 + Math.sin(this.time * 2) * 3, C.lime, 10, 0.85);
    }
  }

  private drawDebug(sim: Simulation) {
    const g = this.debugLayer.clear();
    if (!this.debug) return;
    for (let b = sim.world.getBodyList(); b; b = b.getNext()) {
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const shape = f.getShape();
        if (shape.getType() === 'polygon') {
          const vertices = (shape as unknown as { m_vertices: { x: number; y: number }[] }).m_vertices;
          const points = vertices.flatMap(v => { const p = b.getWorldPoint(v); return this.point(p.x, p.y); });
          g.poly(points).stroke({ color: 0x8af4d1, width: 1, alpha: 0.8 });
        } else if (shape.getType() === 'circle') {
          g.circle(...this.point(b.getPosition().x, b.getPosition().y), shape.getRadius() * this.scale)
            .stroke({ color: 0x8af4d1, width: 1 });
        }
      }
    }
    for (const { joint } of sim.joints) {
      const a = joint.getAnchorA();
      g.circle(...this.point(a.x, a.y), 2.5).fill(C.pink);
    }
    for (let c = sim.world.getContactList(); c; c = c.getNext()) {
      if (!c.isTouching()) continue;
      const m = c.getWorldManifold(null);
      if (!m) continue;
      for (let i = 0; i < c.getManifold().pointCount; i++) {
        const p = m.points[i];
        g.circle(...this.point(p.x, p.y), 4).fill(0xff785f);
        g.moveTo(...this.point(p.x, p.y)).lineTo(...this.point(p.x + m.normal.x * 0.5, p.y + m.normal.y * 0.5))
          .stroke({ color: 0xff785f, width: 1.5 });
      }
    }
    const p = sim.torso.getPosition(), v = sim.torso.getLinearVelocity();
    g.moveTo(...this.point(p.x, p.y)).lineTo(...this.point(p.x + v.x * 0.2, p.y + v.y * 0.2))
      .stroke({ color: C.lime, width: 2 });
  }
}
