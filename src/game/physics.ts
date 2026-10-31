import { World, Vec2, Box, Circle, RevoluteJoint } from 'planck';
import type { Body, RevoluteJoint as MotorJoint } from 'planck';
import { DEFAULTS } from './settings.ts';
import type { Settings } from './settings.ts';
export { DEFAULTS } from './settings.ts';
export type { Settings } from './settings.ts';

export const STEP = 1 / 120;
export type CourseId = 'first-flight' | 'garden';
export type Input = { left: boolean; right: boolean; action: boolean };
export const NO_INPUT: Input = { left: false, right: false, action: false };

export type PartName = 'torso' | 'head' | 'thigh-l' | 'thigh-r' | 'shin-l' | 'shin-r' | 'foot-l' | 'foot-r';
export type Part = { name: PartName; body: Body; width: number; height: number };
export type Platform = { id: string; body: Body; width: number; height: number; pivot: boolean; recharge: boolean };
export type Snapshot = {
  x: number; y: number; vx: number; vy: number; angle: number;
  fuel: number; grounded: boolean; jets: boolean; wings: boolean;
  elapsed: number; progress: number; state: 'ready' | 'running' | 'fallen' | 'finished';
  tumbling: boolean; maxDistance: number;
  landings: number;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** All gameplay runs here, independent of rendering and wall-clock time. Coordinates: metres, Y up. */
export class Simulation {
  world!: World;
  parts: Part[] = [];
  platforms: Platform[] = [];
  joints: { joint: MotorJoint; type: 'hip' | 'knee' | 'ankle' | 'neck'; side: number }[] = [];
  torso!: Body;
  pivot!: Body;
  settings: Settings;
  course: CourseId;
  fuel = 0;
  elapsed = 0;
  grounded = false;
  jets = false;
  wings = false;
  wingLatched = false;
  stun = 0;
  phase = 0;
  maxDistance = 0;
  state: Snapshot['state'] = 'ready';
  private pendingImpact = 0;
  private supportGrace = 0;
  private airborneTime = 0;
  private landings = 0;
  private landingCandidate = 0;
  private settledTime = 0;

  constructor(settings: Partial<Settings> = {}, course: CourseId = 'first-flight') {
    this.settings = { ...DEFAULTS, ...settings };
    this.course = course;
    this.reset();
  }

  reset() {
    this.world = new World(Vec2(0, -18));
    this.parts = [];
    this.platforms = [];
    this.joints = [];
    this.fuel = this.settings.fuelCapacity;
    this.elapsed = this.phase = this.stun = this.pendingImpact = this.maxDistance = this.supportGrace = this.airborneTime = this.landings = 0;
    this.landingCandidate = this.settledTime = 0;
    this.grounded = this.jets = this.wings = this.wingLatched = false;
    this.state = 'ready';

    if (this.course === 'first-flight') {
      this.platform('runway', 1.5, -0.5, 11, 1);
      this.platform('landing', 10.4, -0.7, 5, 0.8);
      this.platform('step', 16.1, 0, 4, 1);
      this.pivot = this.platform('seesaw', 22, 0.36, 5.4, 0.28, true).body;
      this.platform('home', 29.3, -0.45, 8, 0.9);
    } else {
      this.platform('runway', 2.5, -0.5, 13, 1);
      this.platform('landing', 14.4, -0.8, 3.2, 0.8);
      this.platform('step', 19.4, 0, 3, 1);
      this.pivot = this.platform('seesaw', 25.3, 0.1, 7, 0.28, true).body;
      this.platform('recovery', 33.2, -0.45, 4, 0.9);
      this.platform('home', 43, -0.1, 12, 1.4);
      // Low freestanding block: an intentional foot-catch / impact experiment.
      this.platform('block', 40.5, 1, 0.5, 0.8, false, false);
    }
    const anchor = this.world.createBody();
    this.world.createJoint(RevoluteJoint({
      enableLimit: true, lowerAngle: -0.38, upperAngle: 0.38,
      enableMotor: true, motorSpeed: 0, maxMotorTorque: 0.8,
    }, anchor, this.pivot, this.pivot.getPosition()));

    this.makeFairy(2.1, 0.04);
    this.world.on('pre-solve', contact => {
      if (!contact.isTouching()) return;
      const a = contact.getFixtureA().getBody();
      const b = contact.getFixtureB().getBody();
      if (!this.parts.some(p => p.body === a || p.body === b)) return;
      const manifold = contact.getWorldManifold(null);
      if (!manifold) return;
      for (let i = 0; i < contact.getManifold().pointCount; i++) {
        const point = manifold.points[i];
        const va = a.getLinearVelocityFromWorldPoint(point), vb = b.getLinearVelocityFromWorldPoint(point);
        const closingSpeed = -((vb.x - va.x) * manifold.normal.x + (vb.y - va.y) * manifold.normal.y);
        this.pendingImpact = Math.max(this.pendingImpact, closingSpeed);
      }
    });
  }

  get totalMass() { return this.parts.reduce((n, p) => n + p.body.getMass(), 0); }
  get finishX() { return this.course === 'first-flight' ? 29.5 : 46; }

  private platform(id: string, x: number, y: number, width: number, height: number, pivot = false, recharge = true) {
    const body = this.world.createBody({ type: pivot ? 'dynamic' : 'static', position: Vec2(x, y), angularDamping: 0.9 });
    body.createFixture(Box(width / 2, height / 2), { density: pivot ? 2.3 : 0, friction: this.settings.friction, restitution: 0.03 });
    body.setUserData({ kind: 'platform', id, recharge });
    const platform = { id, body, width, height, pivot, recharge };
    this.platforms.push(platform);
    return platform;
  }

  private makeFairy(x: number, y: number) {
    const part = (name: PartName, dx: number, dy: number, w: number, h: number, density: number, round = false) => {
      const body = this.world.createDynamicBody({
        position: Vec2(x + dx, y + dy), angularDamping: this.settings.angularDamping,
        linearDamping: 0.04 + this.settings.airDrag, bullet: true, allowSleep: false,
      });
      body.createFixture(round ? Circle(w / 2) : Box(w / 2, h / 2), {
        density: density * this.settings.mass, friction: this.settings.friction,
        restitution: 0.02, filterGroupIndex: -1,
      });
      body.setUserData({ kind: 'fairy', name });
      this.parts.push({ name, body, width: w, height: h });
      return body;
    };
    this.torso = part('torso', 0, 1.25, 0.47, 0.66, 6);
    const head = part('head', 0, 1.83, 0.48, 0.48, 2.3, true);
    const joint = (a: Body, b: Body, ax: number, ay: number, type: 'hip' | 'knee' | 'ankle' | 'neck', side = 0) => {
      const limits = { hip: [-1.1, 1.1], knee: [-1.35, 0.15], ankle: [-0.65, 0.65], neck: [-0.4, 0.4] }[type];
      const j = this.world.createJoint(RevoluteJoint({
        enableLimit: true, lowerAngle: limits[0], upperAngle: limits[1],
        enableMotor: true, maxMotorTorque: 12, motorSpeed: 0, collideConnected: false,
      }, a, b, Vec2(x + ax, y + ay)))!;
      this.joints.push({ joint: j, type, side });
    };
    joint(this.torso, head, 0, 1.6, 'neck');
    for (const [side, label] of [[-1, 'l'], [1, 'r']] as const) {
      const dx = side * 0.15;
      const thigh = part(`thigh-${label}`, dx, 0.74, 0.18, 0.4, 3);
      const shin = part(`shin-${label}`, dx, 0.345, 0.15, 0.39, 2.5);
      const foot = part(`foot-${label}`, dx + 0.055, 0.115, 0.42, 0.23, 4);
      joint(this.torso, thigh, dx, 0.94, 'hip', side);
      joint(thigh, shin, dx, 0.54, 'knee', side);
      joint(shin, foot, dx, 0.15, 'ankle', side);
    }
  }

  updateSettings(next: Partial<Settings>) {
    const previousMass = this.settings.mass;
    const previousCapacity = this.settings.fuelCapacity;
    this.settings = { ...this.settings, ...next };
    this.fuel = clamp(this.fuel * this.settings.fuelCapacity / previousCapacity, 0, this.settings.fuelCapacity);
    for (const p of this.parts) {
      p.body.setAngularDamping(this.settings.angularDamping);
      p.body.setLinearDamping(0.04 + this.settings.airDrag);
      for (let f = p.body.getFixtureList(); f; f = f.getNext()) {
        f.setDensity(f.getDensity() * this.settings.mass / previousMass);
        f.setFriction(this.settings.friction);
      }
      p.body.resetMassData();
    }
    for (const p of this.platforms) p.body.getFixtureList()!.setFriction(this.settings.friction);
    // Existing contacts cache friction; refresh it as well as fixture material.
    for (let c = this.world.getContactList(); c; c = c.getNext()) c.resetFriction();
  }

  private supportingFeet() {
    for (let c = this.world.getContactList(); c; c = c.getNext()) {
      if (!c.isTouching()) continue;
      const a = c.getFixtureA().getBody();
      const b = c.getFixtureB().getBody();
      const ad = a.getUserData() as { kind?: string; name?: string; recharge?: boolean } | undefined;
      const bd = b.getUserData() as typeof ad;
      const manifold = c.getWorldManifold(null);
      if (!manifold) continue;
      if (ad?.name?.startsWith('foot') && bd?.recharge && -manifold.normal.y > 0.55) return true;
      if (bd?.name?.startsWith('foot') && ad?.recharge && manifold.normal.y > 0.55) return true;
    }
    return false;
  }

  step(input: Input = NO_INPUT, dt = STEP) {
    if (this.state === 'fallen' || this.state === 'finished') return;
    const s = this.settings;
    const direction = Number(input.right) - Number(input.left);
    if (this.state === 'ready' && (direction || input.action)) this.state = 'running';
    if (this.state === 'running') this.elapsed += dt;
    this.stun = Math.max(0, this.stun - dt);
    if (!input.action) this.wingLatched = false;

    this.jets = input.action && this.fuel > 0.00001 && !this.wingLatched;
    if (this.jets) this.fuel = Math.max(0, this.fuel - dt);
    if (input.action && this.fuel <= 0.00001) this.wingLatched = true;
    this.wings = input.action && this.wingLatched;
    if (this.wings) this.jets = false;
    if (this.grounded && !this.jets) this.fuel = Math.min(s.fuelCapacity, this.fuel + dt * s.fuelRegen);

    const upright = Math.cos(this.torso.getAngle()) > 0.4;
    this.supportGrace = this.grounded ? 0.07 : Math.max(0, this.supportGrace - dt);
    const supported = (this.grounded || this.supportGrace > 0) && upright && !this.jets && this.torso.getLinearVelocity().y < 2;
    const control = this.stun > 0 ? (s.flightAssist ? 0.4 : 0.16) : 1;
    const steeringControl = this.stun > 0 ? (s.flightAssist ? 0.75 : 0.16) : 1;
    const motorControl = this.stun > 0 ? 0.16 : 1;
    for (const { body } of this.parts) body.setLinearDamping(0.04 + (supported ? 0 : s.airDrag));
    if (supported) {
      this.phase += dt * (Math.abs(direction) ? 11 : 0);
      const vx = this.torso.getLinearVelocity().x;
      // A bounded traction assist supplements the joint gait. Never sets position or velocity.
      const accel = clamp((direction * 5.3 - vx) * 4, -18, 18);
      this.torso.applyForceToCenter(Vec2(accel * this.totalMass * control, 0), true);
      const targetAngle = -direction * 0.08;
      this.torso.applyTorque(clamp(wrap(targetAngle - this.torso.getAngle()) * 260 - this.torso.getAngularVelocity() * 30,
        -180, 180) * s.balance * s.mass * control, true);
      // Virtual leg extension: a bounded support spring, gated by real foot contact.
      // It cannot support the fairy over a gap or straighten a sideways ragdoll.
      const feet = this.parts.filter(p => p.name.startsWith('foot'));
      const footHeight = Math.min(...feet.map(p => p.body.getPosition().y));
      const extension = footHeight + 1.135 - this.torso.getPosition().y;
      const supportAcceleration = clamp(extension * 130 - this.torso.getLinearVelocity().y * 14, 0, 35);
      this.torso.applyForceToCenter(Vec2(0, supportAcceleration * this.totalMass * s.balance * control), true);
    } else {
      let torque = -direction * s.rotationTorque;
      if (s.flightAssist) {
        const angle = wrap(this.torso.getAngle());
        const limit = s.tiltLimit * Math.PI / 180;
        // Holding a direction aims toward a lean instead of accelerating into a flip.
        // Release brakes spin, then gently settles a normal flight pose toward upright.
        const error = direction ? wrap(-direction * limit - angle) : Math.abs(angle) < Math.PI / 2 ? -angle * 0.28 : 0;
        const targetRate = clamp(error * 5, -s.turnSpeed * Math.PI / 180, s.turnSpeed * Math.PI / 180);
        const inertia = this.parts.reduce((sum, p) => {
          const offset = Vec2.sub(p.body.getWorldCenter(), this.torso.getWorldCenter());
          return sum + p.body.getInertia() + p.body.getMass() * offset.lengthSquared();
        }, 0);
        torque = clamp((targetRate - this.torso.getAngularVelocity()) * s.turnBraking * inertia, -s.rotationTorque, s.rotationTorque);
      }
      this.torso.applyTorque(torque * steeringControl, true);
    }

    for (const { joint, type, side } of this.joints) {
      const cycle = Math.sin(this.phase + (side === 1 ? Math.PI : 0));
      let target = 0;
      if (supported) {
        // Place feet ahead of the centre of mass while accelerating; keep soles level.
        if (type === 'hip') target = -wrap(this.torso.getAngle()) + direction * 0.1 + cycle * 0.6 * direction;
        if (type === 'knee') target = direction ? -Math.max(0, cycle) * 1 : 0;
        if (type === 'ankle') target = -wrap(joint.getBodyA().getAngle());
      } else if (type === 'knee') target = -0.12;
      joint.setMotorSpeed(clamp((target - joint.getJointAngle()) * 18 - joint.getJointSpeed() * 0.7, -12, 12));
      const max = { hip: 65, knee: 50, ankle: 32, neck: 5 }[type];
      joint.setMaxMotorTorque(max * s.jointStrength * s.mass * motorControl);
    }

    if (this.jets) {
      const thrustDirection = this.torso.getWorldVector(Vec2(0, 1));
      const centre = this.parts.reduce((v, p) => {
        const point = p.body.getWorldCenter(), mass = p.body.getMass();
        return Vec2(v.x + point.x * mass / this.totalMass, v.y + point.y * mass / this.totalMass);
      }, Vec2());
      let jetMoment = 0;
      for (const part of this.parts.filter(p => p.name.startsWith('foot'))) {
        const force = Vec2(thrustDirection.x * this.totalMass * s.thrust / 2, thrustDirection.y * this.totalMass * s.thrust / 2);
        const point = part.body.getWorldCenter();
        jetMoment += (point.x - centre.x) * force.y - (point.y - centre.y) * force.x;
        part.body.applyForce(force, point, true);
      }
      // A limited stabilizer offsets most shoe/COM misalignment, never resets angle or spin.
      // It leaves commanded air torque and contact-driven rotation intact.
      this.torso.applyTorque(-clamp(jetMoment * (s.flightAssist ? 1 : 0.9) * Math.min(1, s.balance), -45, 45) * steeringControl, true);
    }
    if (this.wings) {
      for (const { body } of this.parts) {
        const v = body.getLinearVelocity();
        body.applyForceToCenter(Vec2(-v.x * body.getMass() * s.wingDrag * 0.12,
          Math.max(0, -v.y) * body.getMass() * s.wingDrag), true);
      }
    }

    this.pendingImpact = 0;
    this.world.step(dt, 10, 5);
    this.grounded = this.supportingFeet();
    if (!this.grounded) this.airborneTime += dt;
    else {
      if (this.airborneTime > 0.18 && Math.cos(this.torso.getAngle()) > 0.7 && this.pendingImpact < s.crashThreshold) this.landingCandidate = 0.8;
      this.airborneTime = 0;
    }
    this.landingCandidate = Math.max(0, this.landingCandidate - dt);
    if (this.landingCandidate > 0 && this.grounded && Math.cos(this.torso.getAngle()) > 0.8 && Math.abs(this.torso.getLinearVelocity().y) < 2 && this.stun === 0) {
      this.settledTime += dt;
      if (this.settledTime > 0.1) { this.landings++; this.landingCandidate = this.settledTime = 0; }
    } else this.settledTime = 0;
    if (this.pendingImpact > s.crashThreshold) this.stun = Math.min(s.flightAssist ? 0.75 : 1.3, this.pendingImpact * 0.09);
    const p = this.torso.getPosition();
    this.maxDistance = Math.max(this.maxDistance, p.x - 2.1);
    if (p.y < -8 || p.x < -7 || p.x > this.finishX + 12) this.state = 'fallen';
    if (p.x >= this.finishX && this.grounded && this.state === 'running') this.state = 'finished';
    if (this.state === 'fallen' || this.state === 'finished') this.jets = this.wings = false;
  }

  snapshot(): Snapshot {
    const p = this.torso.getPosition();
    const v = this.torso.getLinearVelocity();
    return {
      x: p.x, y: p.y, vx: v.x, vy: v.y, angle: this.torso.getAngle(),
      fuel: this.fuel / this.settings.fuelCapacity, grounded: this.grounded,
      jets: this.jets, wings: this.wings, elapsed: this.elapsed,
      progress: clamp((p.x - 2.1) / (this.finishX - 2.1), 0, 1), state: this.state,
      tumbling: this.stun > 0 || Math.cos(this.torso.getAngle()) < -0.1,
      maxDistance: this.maxDistance,
      landings: this.landings,
    };
  }
}
